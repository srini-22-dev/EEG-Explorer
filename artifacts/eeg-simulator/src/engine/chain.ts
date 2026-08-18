/**
 * Recording chain (briefing §9) and reference operators (§7).
 *
 * Everything between the scalp potential and the number stored on disk. Skipping
 * this layer is why synthetic data often looks "too clean": real records carry an
 * amplifier passband, a per-channel noise floor, a common component from the
 * reference electrode, gain mismatches, and always a few bad channels.
 *
 * Note the division of labour §7 insists on: potentials are generated with
 * respect to infinity, and the montage reference is applied strictly afterward as
 * its own pipeline stage. Mixing the two makes source-localisation ground truth
 * wrong.
 */

import { Gaussian, deriveSeed } from './rng';

/**
 * Causal one-pole high-pass, matching a real amplifier's ~0.016-0.1 Hz corner.
 * Deliberately causal rather than zero-phase: hardware distorts phase, and a
 * filtfilt here would remove a distortion that real recordings have.
 */
export class AmplifierHighPass {
  private a: number;
  private prevIn = 0;
  private prevOut = 0;
  constructor(dt: number, cornerHz = 0.05) {
    const rc = 1 / (2 * Math.PI * cornerHz);
    this.a = rc / (rc + dt);
  }
  next(x: number): number {
    const y = this.a * (this.prevOut + x - this.prevIn);
    this.prevIn = x;
    this.prevOut = y;
    return y;
  }
}

/** Simple one-pole anti-alias / low-pass, standing in for the amplifier's roll-off. */
export class AmplifierLowPass {
  private a: number;
  private state = 0;
  constructor(dt: number, cornerHz = 100) {
    this.a = Math.exp(-dt * 2 * Math.PI * cornerHz);
  }
  next(x: number): number {
    this.state = this.a * this.state + (1 - this.a) * x;
    return this.state;
  }
}

export type ChannelDefect =
  | { kind: 'ok' }
  /** High electrode impedance: elevated broadband noise, and more line pickup. */
  | { kind: 'noisy'; noiseMultiplier: number; lineMultiplier: number }
  /** Disconnected lead: flat but for a tiny noise floor. */
  | { kind: 'flat' }
  /** Intermittent contact: drops in and out. */
  | { kind: 'intermittent'; meanGoodSec: number; meanBadSec: number };

export type ChannelChainOptions = {
  /** Instrument noise floor RMS, microvolts (§9: ~0.5-1.5). */
  sensorNoiseRms?: number;
  /** Reference-electrode noise RMS, added identically to every channel. */
  referenceNoiseRms?: number;
  /** SD of per-channel gain mismatch, as a fraction. */
  gainSpread?: number;
  highPassHz?: number;
  lowPassHz?: number;
};

/**
 * Per-channel recording chain. One instance covers all channels so the reference
 * noise — which is genuinely common to every channel — can be generated once.
 */
export class RecordingChain {
  private hp: AmplifierHighPass[];
  private lp: AmplifierLowPass[];
  private noise: Gaussian[];
  private refNoise: Gaussian;
  private gains: Float64Array;
  private defects: ChannelDefect[];
  private intermittentOn: boolean[];
  private intermittentLeft: number[];
  private sensorNoiseRms: number;
  private referenceNoiseRms: number;

  constructor(
    seed: number,
    private dt: number,
    private nChannels: number,
    defects: ChannelDefect[] = [],
    opts: ChannelChainOptions = {},
  ) {
    const {
      sensorNoiseRms = 0.9,
      referenceNoiseRms = 0.6,
      gainSpread = 0.04,
      highPassHz = 0.05,
      lowPassHz = 100,
    } = opts;

    this.sensorNoiseRms = sensorNoiseRms;
    this.referenceNoiseRms = referenceNoiseRms;
    this.hp = [];
    this.lp = [];
    this.noise = [];
    this.gains = new Float64Array(nChannels);
    this.defects = [];
    this.intermittentOn = [];
    this.intermittentLeft = [];

    const g = new Gaussian(deriveSeed(seed, 'chain'));
    this.refNoise = new Gaussian(deriveSeed(seed, 'refnoise'));
    for (let c = 0; c < nChannels; c++) {
      this.hp.push(new AmplifierHighPass(dt, highPassHz));
      this.lp.push(new AmplifierLowPass(dt, lowPassHz));
      this.noise.push(new Gaussian(deriveSeed(seed, `sensor${c}`)));
      this.gains[c] = 1 + gainSpread * g.next();
      this.defects.push(defects[c] ?? { kind: 'ok' });
      this.intermittentOn.push(true);
      this.intermittentLeft.push(0);
    }
  }

  /**
   * Change one channel's defect mid-recording. Electrode contact is not a
   * property fixed when the montage was applied: a lead comes off, or a
   * technologist re-gels it, and the channel's character changes from that
   * moment on. Only the defect changes — the filters, gain and noise stream keep
   * their state, so nothing else about the channel jumps.
   */
  setDefect(c: number, d: ChannelDefect) {
    this.defects[c] = d;
  }

  /**
   * Apply the chain in place. `line` is the mains waveform, passed separately
   * because a high-impedance electrode picks up disproportionately more of it.
   */
  process(x: Float64Array, line = 0, lineAmp = 0) {
    const ref = this.refNoise.next() * this.referenceNoiseRms;
    for (let c = 0; c < this.nChannels; c++) {
      const d = this.defects[c];
      let v = x[c];
      let noiseMul = 1;
      let lineMul = 1;

      if (d.kind === 'flat') {
        v = 0;
        noiseMul = 0.25;
        lineMul = 0.2;
      } else if (d.kind === 'noisy') {
        noiseMul = d.noiseMultiplier;
        lineMul = d.lineMultiplier;
      } else if (d.kind === 'intermittent') {
        if (this.intermittentLeft[c] <= 0) {
          this.intermittentOn[c] = !this.intermittentOn[c];
          const mean = this.intermittentOn[c] ? d.meanGoodSec : d.meanBadSec;
          this.intermittentLeft[c] = Math.max(1, Math.round(mean / this.dt));
        }
        this.intermittentLeft[c]--;
        if (!this.intermittentOn[c]) { v = 0; noiseMul = 3; }
      }

      v = v * this.gains[c] + ref + line * lineAmp * lineMul
        + this.noise[c].next() * this.sensorNoiseRms * noiseMul;
      v = this.hp[c].next(v);
      x[c] = this.lp[c].next(v);
    }
  }
}

/**
 * Pick a plausible set of bad channels. §9: "Realistic datasets always contain
 * some bad channels" — a simulator where every electrode is perfect trains
 * readers not to look for the ones that aren't.
 */
export function sampleDefects(seed: number, nChannels: number, burden = 1): ChannelDefect[] {
  const g = new Gaussian(deriveSeed(seed, 'defects'));
  const out: ChannelDefect[] = new Array(nChannels).fill(null).map(() => ({ kind: 'ok' } as ChannelDefect));
  const nNoisy = Math.min(nChannels, Math.round(g.range(0, 2.2 * burden)));
  for (let i = 0; i < nNoisy; i++) {
    const c = Math.floor(g.uniform() * nChannels);
    out[c] = { kind: 'noisy', noiseMultiplier: g.range(3, 9), lineMultiplier: g.range(2, 6) };
  }
  if (g.uniform() < 0.18 * burden) {
    out[Math.floor(g.uniform() * nChannels)] = { kind: 'flat' };
  }
  if (g.uniform() < 0.22 * burden) {
    out[Math.floor(g.uniform() * nChannels)] =
      { kind: 'intermittent', meanGoodSec: g.range(8, 30), meanBadSec: g.range(0.5, 3) };
  }
  return out;
}

/**
 * Average reference. §7 warns this is itself a distortion when electrode
 * coverage is limited — with a 19-electrode 10-20 array it is, so this is
 * applied as an explicit, inspectable stage rather than assumed away.
 */
export function applyAverageReference(x: Float64Array) {
  let mean = 0;
  for (let i = 0; i < x.length; i++) mean += x[i];
  mean /= x.length;
  for (let i = 0; i < x.length; i++) x[i] -= mean;
}

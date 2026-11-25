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
import type { FilterSettings, MainsContacts } from '../utils/simTypes';

/**
 * Amplifier low-frequency-filter corner, in Hz — equivalently a time constant of
 * 1/(2*pi*fc) = 0.64 s. Routine clinical EEG runs an LFF of 0.53-1 Hz (TC 0.3-0.16 s);
 * this sits deliberately below that, at the conservative end, so delta survives
 * essentially intact while slow artifacts still show the recovery swing a real
 * record has (see AmplifierHighPass).
 */
export const CLINICAL_LFF_HZ = 0.25;

/**
 * Causal one-pole high-pass, standing in for the amplifier's low-frequency filter.
 * Deliberately causal rather than zero-phase: hardware distorts phase, and a
 * filtfilt here would remove a distortion that real recordings have.
 *
 * That distortion is visible on the page, and it is the point of the corner value.
 * A causal high-pass returns a transient to baseline by driving it *past* baseline,
 * so every slow artifact — blink, eye opening, sweat, movement — carries a smaller
 * opposite-going recovery swing, and its size is set here rather than by any
 * generator. At the previous 0.05 Hz (TC 3.2 s) a ~300 ms blink overshot by ~5% of
 * peak spread over 3.2 s: arithmetically present, invisible to a reader, and wrong
 * for a clinical teaching record. At 0.25 Hz the same blink overshoots ~18% within
 * ~0.2 s of its peak — what a learner actually sees (IK-001) — while delta is barely
 * touched: |H(f)| = f/sqrt(f^2 + fc^2) is 0.89 at 0.5 Hz and 0.97 at 1 Hz, so N3 slow
 * waves, FIRDA and ictal clonic slowing all survive.
 */
/*
 * Note on this class vs `AmplifierLowPass` below. This one keeps the
 * non-prewarped form `a = rc/(rc+dt)`, which is the same class of approximation
 * the low-pass was fixed for — and it is left deliberately. The approximation
 * degrades only as the corner approaches the sample rate, and this filter runs at
 * the opposite end of the spectrum: at the production operating point
 * (CLINICAL_LFF_HZ = 0.25 Hz, fs = 250 Hz) `2*pi*fc*dt` is 0.0063, and the
 * measured response is -3.02 dB at the corner — 0.02 dB from ideal. It stays
 * negligible across every LFF a clinical amplifier offers (at 1 Hz, the ACNS
 * ceiling, the product is still only 0.025). Measured error becomes visible
 * (~1 dB) only at fc/fs ratios like 5 Hz at 64 Hz, which this engine never runs.
 * Rewriting it would change blink morphology, which IK-001 asserts on, for no
 * clinical gain.
 */
export class AmplifierHighPass {
  private a: number;
  private prevIn = 0;
  private prevOut = 0;
  constructor(private dt: number, cornerHz = CLINICAL_LFF_HZ) {
    this.a = 0;
    this.setCorner(cornerHz);
  }
  /** Move the corner mid-recording (the reader's low-cut setting); state is kept. */
  setCorner(cornerHz: number) {
    const rc = 1 / (2 * Math.PI * cornerHz);
    this.a = rc / (rc + this.dt);
  }
  next(x: number): number {
    const y = this.a * (this.prevOut + x - this.prevIn);
    this.prevIn = x;
    this.prevOut = y;
    return y;
  }
}

/**
 * First-order anti-alias / low-pass, standing in for the amplifier's roll-off.
 *
 * Bilinear-transformed with frequency prewarping, so its -3 dB point is `cornerHz`
 * by construction at any sample rate. It previously used the impulse-invariant
 * pole `a = exp(-2*pi*fc*dt)` with no feed-forward zero, which only approximates
 * an `fc` corner while `2*pi*fc*dt << 1`. At this engine's fs = 250 Hz and the
 * default fc = 100 Hz that product is **2.51**, not << 1, and the filter was
 * effectively a pass-through: measured -0.4 dB at 40 Hz, -0.9 at 70, -1.3 at 100
 * and only -1.4 dB at Nyquist, with its true -3 dB point above the representable
 * band. A filter labelled "100 Hz low-pass" was removing essentially nothing, which
 * mattered because the EMG generator puts real power above 70 Hz.
 *
 * The bilinear form fixes that: unity gain at DC, a zero at Nyquist (so it actually
 * rolls off), and -3 dB at fc exactly. `k = tan(pi*fc*dt)` is the prewarp;
 * `b = k/(1+k)` and `a = (1-k)/(1+k)`, and note b == (1-a)/2.
 */
export class AmplifierLowPass {
  private a: number;
  private b: number;
  private prevIn = 0;
  private prevOut = 0;
  constructor(private dt: number, cornerHz = 100) {
    this.a = 0; this.b = 1;
    this.setCorner(cornerHz);
  }
  /** Move the corner mid-recording (the reader's high-cut setting); state is kept. */
  setCorner(cornerHz: number) {
    // tan diverges as fc approaches Nyquist, so clamp just below it. A corner at
    // or above Nyquist is meaningless anyway — there is nothing up there to remove.
    const nyquist = 0.5 / this.dt;
    const fc = Math.min(cornerHz, nyquist * 0.98);
    const k = Math.tan(Math.PI * fc * this.dt);
    this.a = (1 - k) / (1 + k);
    this.b = k / (1 + k);
  }
  next(x: number): number {
    const y = this.b * (x + this.prevIn) + this.a * this.prevOut;
    this.prevIn = x;
    this.prevOut = y;
    return y;
  }
}

/**
 * Mains notch: a second-order IIR band-stop (the RBJ cookbook notch). An EEG
 * machine's notch removes the interference and anything else near that frequency —
 * EMG included, so a notched record can make muscle look cleaner than it is. Causal,
 * like the rest of the chain.
 *
 * Width: -3 dB at 0.82 and 1.18 of the mains frequency (41 and 59 Hz for 50 Hz), the
 * one clinical recorder's notch found documented (University of Zurich sleep
 * laboratory, "Filter characteristics": "Notch filter for 50-Hz-rejection ... -3 dB
 * points at 41 and 59 Hz"), so Q = 50 / 18. It was Q 30 (1.7 Hz wide), a number with
 * no source; mains drifts (here +/-0.05 Hz, the grid's own wander), and that narrow
 * notch left about 6% of the fundamental at a 0.05 Hz offset, so on a record with
 * heavy mains it could not give the background back (2026-11-25, Step 29).
 */
export const NOTCH_Q = 50 / 18;

export class NotchFilter {
  private b0: number; private b1: number; private b2: number; private a1: number; private a2: number;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(dt: number, hz: number, q = NOTCH_Q) {
    const w0 = 2 * Math.PI * hz * dt, alpha = Math.sin(w0) / (2 * q), a0 = 1 + alpha;
    this.b0 = 1 / a0; this.b1 = -2 * Math.cos(w0) / a0; this.b2 = 1 / a0;
    this.a1 = -2 * Math.cos(w0) / a0; this.a2 = (1 - alpha) / a0;
  }
  next(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
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

/**
 * How much more (or less) mains a defective contact picks up than a good one: a
 * high-impedance electrode more, a disconnected one almost none. `process` applies
 * it; the annotation of mains reads it too, so its box follows the bad contact.
 */
/**
 * The mains pickup of the one poorly connected electrode, relative to the 0.5-1.5 of
 * a good contact (2026-11-23).
 *
 * Mains reaches every electrode, and almost all of it is equal at all of them, so a
 * differential amplifier rejects it: on a bipolar row each electrode's share cancels
 * its neighbour's. What reaches the page is the imbalance a high-impedance contact
 * makes — so mains is drawn on the rows of that electrode and hardly anywhere else.
 * learningeeg's only mains figure (Artifacts, "60 Hz electrode artifact": "the Fp1
 * electrode is likely not well connected") shows exactly that: a solid band on the two
 * rows that hold Fp1 and nothing on the other sixteen. Before this, with every contact
 * good, the toggle put 2.4-2.7 uV peak to peak on the median row (0.4 mm at 7 uV/mm,
 * thinner than the trace) and the notch filter had nothing visible to take away.
 *
 * The size is read off that figure against its own background, the one scale an
 * uncalibrated figure keeps (read skill): the band is 37 px peak to peak (interquartile
 * 36-37) on both Fp1 rows, against a median of 42 px for the 1st-99th percentile span of
 * nine cleanly traced background rows on that slow-wave-sleep page — 0.88. The engine's
 * N3 page has a median row of 60-68 uV by the same estimator, so the band is set to
 * ~57 uV peak to peak at the default 5 uV mains, through the app's 70 Hz high cut.
 * One figure: the ratio is a reading of it, not a range from several.
 */
export const MAINS_CONTACT_COUPLING = 7;

/**
 * Many poor contacts (ArtifactParams.mainsContacts 'many', owner 2026-11-23): the
 * picture of a hastily applied or dry-electrode cap, where contact is worst through
 * hair and best on the bare forehead. Each scalp electrode picks up extra mains in
 * proportion to its region's weight, times its own scatter of 0.6-1.4; the ears keep
 * good contact, so an ear-referenced page shows each electrode's excess.
 *
 * Read off the owner's reference (Zeto, "Impact of Digital EEG Filter on EEG Signal
 * Morphology": one referential page, unfiltered and filtered). Fast activity on each row
 * of the unfiltered page, measured as the vertical extent over three pixel columns
 * (about two mains cycles) less the same on the filtered page, over the filtered page's
 * median row peak to peak: frontopolar 0.2, frontal 0.3, central and mid-temporal 0.8
 * (median; C4 1.6, C3 0.8), parietal and posterior temporal 1.2, occipital 2.2 or more
 * (the two occipital rows merge, so that is a floor). The weights are those ratios over
 * the occipital one. Limits of that source: a 674 px image with no stated filters or
 * reference, at a resolution where mains cannot be told from muscle; read as mains on
 * many poor contacts by the owner's choice.
 *
 * MAINS_MANY_GAIN puts the occipital channels' 50 Hz at about 2.2 times the median row,
 * peak to peak, of the engine's awake ear-referenced page, at the default 5 uV.
 */
export const MAINS_MANY_WEIGHT = { Fp: 0.09, F: 0.14, C: 0.36, P: 0.55, O: 1 } as const;
export const MAINS_MANY_GAIN = 2.6;

/** The region an electrode's mains weight comes from, or null for an ear reference. */
export function mainsManyRegion(electrode: string): keyof typeof MAINS_MANY_WEIGHT | null {
  if (/^A[12]$/.test(electrode)) return null;
  if (electrode.startsWith('Fp')) return 'Fp';
  if (electrode.startsWith('O')) return 'O';
  if (electrode.startsWith('P') || electrode === 'T5' || electrode === 'T6') return 'P';
  if (electrode.startsWith('C') || electrode === 'T3' || electrode === 'T4') return 'C';
  return 'F';
}

export function defectLineMultiplier(d: ChannelDefect): number {
  return d.kind === 'noisy' ? d.lineMultiplier : d.kind === 'flat' ? 0.2 : 1;
}

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
  private notch: NotchFilter[] | null = null;
  private notchHz: number | null = null;
  private noise: Gaussian[];
  private refNoise: Gaussian;
  private gains: Float64Array;
  /**
   * How much of the mains field each electrode picks up, relative to the nominal
   * amplitude. Interference is a common-mode signal that the differential amplifier
   * rejects; what reaches the page is the part unequal electrode impedances turn
   * into a difference, so it is never the same on two electrodes. It used to be
   * identical on all of them — and therefore cancelled exactly in every bipolar,
   * average and ear-referenced montage: with the toggle on, the page showed
   * nothing unless a bad electrode was also present (measured 0.0 uV on all
   * eighteen double-banana rows, 2026-10-12). No source gives the spread a number;
   * 0.5-1.5 leaves neighbours differing by a visible fraction of the nominal
   * amplitude: fuzz that varies from row to row, worst where a contact is poor, as
   * the toggle's description says (it said "uniform thickening of every trace"
   * until 2026-10-23, which no bipolar page can show).
   */
  private lineCoupling: Float64Array;
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
      highPassHz = CLINICAL_LFF_HZ,
      lowPassHz = 100,
    } = opts;

    this.sensorNoiseRms = sensorNoiseRms;
    this.referenceNoiseRms = referenceNoiseRms;
    this.hp = [];
    this.lp = [];
    this.noise = [];
    this.gains = new Float64Array(nChannels);
    this.lineCoupling = new Float64Array(nChannels);
    this.defects = [];
    this.intermittentOn = [];
    this.intermittentLeft = [];

    const g = new Gaussian(deriveSeed(seed, 'chain'));
    // Own stream, so adding it left every existing subject's gains unchanged.
    const gLine = new Gaussian(deriveSeed(seed, 'linecoupling'));
    this.refNoise = new Gaussian(deriveSeed(seed, 'refnoise'));
    for (let c = 0; c < nChannels; c++) {
      this.lineCoupling[c] = gLine.range(0.5, 1.5);
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
   * The reader's filter settings (the top bar). The chain's own defaults (0.25 Hz,
   * 100 Hz, no notch) are what the validation gate measures against; the app starts
   * at the routine clinical 1 Hz / 70 Hz (`DEFAULT_FILTERS`).
   * Change the filters mid-recording, as a reader turns the knobs: each filter keeps
   * its state, so the trace bends rather than jumps. A notch switched on starts empty.
   */
  setFilters(f: FilterSettings) {
    for (let c = 0; c < this.nChannels; c++) {
      this.hp[c].setCorner(f.lowCutHz);
      this.lp[c].setCorner(f.highCutHz);
    }
    if (f.notchHz == null) this.notch = null;
    else if (this.notchHz !== f.notchHz) {
      this.notch = Array.from({ length: this.nChannels }, () => new NotchFilter(this.dt, f.notchHz!));
    }
    this.notchHz = f.notchHz;
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

  /** How much of the mains this electrode picks up, relative to the others. */
  lineCouplingAt(c: number): number {
    return this.lineCoupling[c];
  }

  // The two ways the mains can reach the page (ArtifactParams.mainsContacts): one
  // poorly connected electrode, or many. `lineCoupling` is whichever is in use.
  private mainsOne: Float64Array | null = null;
  private mainsMany: Float64Array | null = null;

  /**
   * The poor contacts the mains shows on: electrode `contact` for one
   * (MAINS_CONTACT_COUPLING), and each electrode's extra pickup for many
   * (MAINS_MANY_WEIGHT). Starts with one.
   */
  setMainsContacts(contact: number, manyExtra: number[]) {
    this.mainsOne = Float64Array.from(this.lineCoupling);
    this.mainsOne[contact] = MAINS_CONTACT_COUPLING;
    this.mainsMany = this.lineCoupling.map((k, c) => k + manyExtra[c]);
    this.lineCoupling = this.mainsOne;
  }

  setMainsMode(mode: MainsContacts) {
    const next = mode === 'many' ? this.mainsMany : this.mainsOne;
    if (next) this.lineCoupling = next;
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
      const lineMul = defectLineMultiplier(d);

      if (d.kind === 'flat') {
        v = 0;
        noiseMul = 0.25;
      } else if (d.kind === 'noisy') {
        noiseMul = d.noiseMultiplier;
      } else if (d.kind === 'intermittent') {
        if (this.intermittentLeft[c] <= 0) {
          this.intermittentOn[c] = !this.intermittentOn[c];
          const mean = this.intermittentOn[c] ? d.meanGoodSec : d.meanBadSec;
          this.intermittentLeft[c] = Math.max(1, Math.round(mean / this.dt));
        }
        this.intermittentLeft[c]--;
        if (!this.intermittentOn[c]) { v = 0; noiseMul = 3; }
      }

      v = v * this.gains[c] + ref + line * lineAmp * lineMul * this.lineCoupling[c]
        + this.noise[c].next() * this.sensorNoiseRms * noiseMul;
      v = this.hp[c].next(v);
      v = this.lp[c].next(v);
      x[c] = this.notch ? this.notch[c].next(v) : v;
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

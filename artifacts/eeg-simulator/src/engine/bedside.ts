/**
 * Two more artifacts at the contacts and leads, past the leadfield like a pop:
 *
 *   - Pulse artifact (`pulse`, IK-051). An electrode over a scalp artery moves with
 *     each pulse: Tatum et al. 2011, "a ... rhythmic slow wave after the QRS complex
 *     that is typically time-locked by 200 milliseconds", "usually ... in a single
 *     channel"; eegpedia, "The QRS complex happens slightly ahead of the pulse
 *     artifact (200-300 ms)". So: at every R wave of the one heart (the ECG row), a
 *     pressure-shaped slow wave on one electrode, 0.25 s later.
 *   - IV drip artifact (`iv-drip`, IK-052). Redding et al. 1969: "a curious polyphasic
 *     spike-like artifact ... in one or more electrodes coincident with each falling
 *     droplet", from "a static charge on the contents of the i.v. bottle". So: one
 *     spike, stored per subject and replayed at each drop, on one to three leads, at
 *     the drip's regular rate.
 */

import { Gaussian } from './rng';

// --- Pulse ---------------------------------------------------------------------

/** R wave to the start of the pulse wave, s (mid-range of eegpedia's 200-300 ms; Tatum: "typically ... 200 milliseconds"). */
export const PULSE_DELAY_S = 0.25;
/** The pulse wave: a quick rise and a slower fall, like an arterial pressure wave (owner's choice of shape). */
const PULSE_RISE_S = 0.12, PULSE_FALL_S = 0.4;
export const PULSE_S = PULSE_RISE_S + PULSE_FALL_S;
/**
 * Microvolts at the electrode, peak. Sized against eegpedia's F3 figure, where the wave
 * is about 2.5x the neighbouring rows' background, peak to peak (IK-051): 40 gave 1.91
 * against F3's four nearest channels (Step 29, 2026-11-25), so 40 x 2.5 / 1.91.
 */
export const PULSE_UV = 52;

export class PulseArtifact {
  /** Seconds since each pending R wave; a fast heart can start a pulse before the last has ended. */
  private since: number[] = [];
  /** True on the sample a pulse wave begins. */
  started = false;

  constructor(private dt: number) {}

  /** Advance; `rWave` on the sample an R wave begins. Returns microvolts at the electrode. */
  next(rWave: boolean): number {
    if (rWave) this.since.push(0);
    this.started = false;
    let v = 0;
    for (let k = 0; k < this.since.length; k++) {
      const s = this.since[k] - PULSE_DELAY_S;
      if (s >= 0 && s - this.dt < 0) this.started = true;
      if (s >= 0 && s <= PULSE_S) {
        const shape = s < PULSE_RISE_S
          ? (1 - Math.cos(Math.PI * s / PULSE_RISE_S)) / 2
          : (1 + Math.cos(Math.PI * (s - PULSE_RISE_S) / PULSE_FALL_S)) / 2;
        // Surface-negative, so up. Not asserted by IK-051: an electrode moving on an
        // artery can deflect either way.
        v -= PULSE_UV * shape;
      }
      this.since[k] += this.dt;
    }
    this.since = this.since.filter(t => t <= PULSE_DELAY_S + PULSE_S + this.dt);
    return v;
  }
}

// --- IV drip -------------------------------------------------------------------

/** Microvolts at the most-coupled lead, peak (owner's choice: no source gives a size). */
export const DRIP_UV = 70;
/** The spike: three alternating lobes over about 60 ms (Redding 1969: "polyphasic spike-like"). */
const LOBE_SD_S = 0.005, LOBE_GAP_S = 0.018;
export const DRIP_S = 0.07;
/** Drop-to-drop variation of the interval (owner's choice: a gravity drip is regular). */
const DRIP_CV = 0.03;

export class IvDrip {
  private g: Gaussian;
  private readonly template: Float64Array;
  private untilDrop: number;
  private pos = Infinity;
  private amp = 1;
  private ratePerMin = 30;
  /** True on the sample a drop falls. */
  started = false;
  /** The leads the drip's charge reaches, and how much (1 at the most). */
  readonly coupling: number[];

  constructor(seed: number, private dt: number, electrodes: string[]) {
    this.g = new Gaussian(seed);
    // One spike per subject, kept and replayed: three lobes of alternating sign, each a
    // little different, the first the largest.
    const n = Math.round(DRIP_S / dt);
    this.template = new Float64Array(n);
    const lobes = [1, -this.g.range(0.6, 0.9), this.g.range(0.25, 0.5)];
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const t = i * dt;
      let v = 0;
      lobes.forEach((a, k) => { v += a * Math.exp(-((t - (0.012 + k * LOBE_GAP_S)) ** 2) / (2 * LOBE_SD_S ** 2)); });
      this.template[i] = v;
      peak = Math.max(peak, Math.abs(v));
    }
    for (let i = 0; i < n; i++) this.template[i] /= peak;
    // One to three scalp leads ("one or more electrodes").
    const scalp = electrodes.map((e, c) => (/^A[12]$/.test(e) ? -1 : c)).filter(c => c >= 0);
    const count = 1 + Math.floor(this.g.uniform() * 3);
    const chosen: number[] = [];
    while (chosen.length < count) {
      const c = scalp[Math.floor(this.g.uniform() * scalp.length)];
      if (!chosen.includes(c)) chosen.push(c);
    }
    this.coupling = electrodes.map((_, c) => {
      const k = chosen.indexOf(c);
      return k < 0 ? 0 : k === 0 ? 1 : this.g.range(0.5, 0.9);
    });
    this.untilDrop = this.g.uniform() * 60 / this.ratePerMin;
  }

  setRate(perMin: number) { this.ratePerMin = Math.max(1, perMin); }

  /** Advance one sample. Returns the spike now at unit coupling, microvolts. */
  next(): number {
    this.untilDrop -= this.dt;
    this.started = false;
    if (this.untilDrop <= 0) {
      this.untilDrop += (60 / this.ratePerMin) * Math.max(0.5, 1 + DRIP_CV * this.g.next());
      this.pos = 0;
      this.amp = this.g.range(0.9, 1.1);
      this.started = true;
    }
    if (this.pos >= this.template.length) return 0;
    return DRIP_UV * this.amp * this.template[this.pos++];
  }
}

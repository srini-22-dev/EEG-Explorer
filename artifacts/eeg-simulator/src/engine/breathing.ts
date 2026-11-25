/**
 * Breathing, and the two artifacts that keep time with it (IK-049, IK-050).
 *
 * `RespirationGenerator` is the patient's breathing: the trace a respiration belt
 * draws on the Resp row, as the ECG generator draws the ECG row. Like the heart it
 * always runs, whether or not anything on the page shows it, so switching an
 * artifact on never moves the breaths.
 *
 * The artifacts do not go through the leadfield: they are not fields from inside the
 * head but things happening at the contacts and the leads, like a pop.
 *   - Breathing artifact (`respiration` toggle). eegpedia: "Slow and rhythmic
 *     activity, synchronous with the body movements of respiration, due to
 *     mechanically affecting the impedance of usually one electrode", or "Sharp
 *     waves synchronously with inhalation or exhalation and involve the electrodes on
 *     which the patient is lying". So: one smooth wave per breath on one electrode (a
 *     third of it on its neighbours, as T6 beside P4 in eegpedia's figure), or a
 *     sharp wave on O1 and O2, where a supine head rests, at each inspiration.
 *   - Water in the ventilator tubing (`ventilator` toggle). Villamar & Albuja 2022:
 *     bursts of "identical morphology and duration" at every ventilator breath, about
 *     1 s, "crescendo-and-decrescendo", larger on the ventilator's side, gone after
 *     suctioning. One template per subject, replayed identically; every lead picks
 *     it up a different amount (the tubing lies across some leads more than others),
 *     which is what keeps it from cancelling on a bipolar row.
 */

import { Gaussian, deriveSeed } from './rng';
import { electrodePositions3D } from '../utils/electrodePositions3D';
import type { PatientState } from '../utils/simTypes';

/** Inspiration is a third of each breath (I:E 1:2, the owner's setting). */
const INSPIRATION_SHARE = 1 / 3;
/** Breath-to-breath variation of the interval, by state (owner's setting): regular in NREM, irregular in REM. */
const BREATH_CV: Record<PatientState, number> = { awake: 0.1, drowsy: 0.1, n1: 0.05, n2: 0.05, n3: 0.05, rem: 0.2 };

export class RespirationGenerator {
  private g: Gaussian;
  private phase = 0;
  private interval: number;
  /** This subject's own breathing rate, breaths a minute (12-18). */
  readonly ownRate: number;
  private ventRate: number | null = null;
  /** Lung volume now, 0 (end of expiration) to 1 (end of inspiration). */
  volume = 0;
  /** True on the sample an inspiration begins. */
  inspirationStarted = false;

  constructor(seed: number, private dt: number) {
    this.g = new Gaussian(seed);
    this.ownRate = this.g.range(12, 18);
    this.interval = 60 / this.ownRate;
    // Start partway through a breath, so subjects do not all inhale at t = 0.
    this.phase = this.g.uniform() * this.interval;
  }

  /** On the ventilator at this many breaths a minute, or breathing on its own (null). Takes effect at the next breath. */
  setVentilator(ratePerMin: number | null) { this.ventRate = ratePerMin; }
  private rateScale = 1;
  /** Spontaneous breathing faster or slower than this subject's own rate (recording conditions); never the ventilator's. */
  setRateScale(k: number) { this.rateScale = k; }
  /** Breaths a minute now: the ventilator's, or this subject's own times the scale. */
  get rate(): number { return this.ventRate ?? this.ownRate * this.rateScale; }

  next(state: PatientState): number {
    this.phase += this.dt;
    this.inspirationStarted = false;
    if (this.phase >= this.interval) {
      this.phase -= this.interval;
      this.inspirationStarted = true;
      this.interval = this.ventRate != null
        ? 60 / this.ventRate
        : (60 / (this.ownRate * this.rateScale)) * Math.max(0.5, 1 + BREATH_CV[state] * this.g.next());
    }
    const u = this.phase / this.interval;
    this.volume = u < INSPIRATION_SHARE
      ? (1 - Math.cos(Math.PI * u / INSPIRATION_SHARE)) / 2
      : (1 + Math.cos(Math.PI * (u - INSPIRATION_SHARE) / (1 - INSPIRATION_SHARE))) / 2;
    return this.volume;
  }
}

// --- Breathing artifact --------------------------------------------------------

/**
 * Microvolts at the electrode, peak. Sized against eegpedia's figure, where the wave is
 * about twice its own row's background, peak to peak (IK-049): 70 gave 2.97 on P4-AVG
 * (Step 29, 2026-11-25), so 70 x 2 / 2.97. The sharp form has no figure; it is kept in
 * the same proportion to the wave as before (60 : 70).
 */
export const BREATHING_WAVE_UV = 47;
export const BREATHING_SHARP_UV = 40;
/** The smooth wave: begins this long after inspiration starts and lasts this long (eegpedia figure: about 0.4 s). */
const WAVE_DELAY_S = 0.1;
export const WAVE_S = 0.45;
/** The sharp wave on the electrodes lain on: rise and fall, seconds. */
const SHARP_RISE_S = 0.04, SHARP_FALL_S = 0.12;
/** Share at an electrode next to the one affected (eegpedia figure: T6 beside P4). */
const NEIGHBOUR_SHARE = 0.3;
/** Electrodes closer than this (unit-sphere chord) are neighbours: adjacent 10-20 sites are 0.35-0.45 apart. */
const NEIGHBOUR_CHORD = 0.5;

/** How much of a contact artifact on `centre` electrodes reaches each electrode. */
export function contactCoupling(electrodes: string[], centre: string[]): number[] {
  const near = (a: string, b: string) => {
    const pa = electrodePositions3D[a], pb = electrodePositions3D[b];
    if (!pa || !pb) return false;
    return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) < NEIGHBOUR_CHORD;
  };
  return electrodes.map(e => (centre.includes(e) ? 1 : centre.some(c => near(c, e)) ? NEIGHBOUR_SHARE : 0));
}

/** The breathing artifact's waveform, one per breath, sample by sample. */
export class BreathingArtifact {
  private g: Gaussian;
  private t = Infinity;
  private amp = 1;
  /** True on the sample a wave begins. */
  started = false;

  constructor(seed: number, private dt: number) { this.g = new Gaussian(seed); }

  /** Advance; `inspiration` on the sample a breath begins. Returns microvolts at the electrode. */
  next(inspiration: boolean, form: 'electrode' | 'lying'): number {
    if (inspiration) { this.t = 0; this.amp = this.g.logNormal(1, 0.1); }
    this.started = false;
    const t = this.t;
    this.t += this.dt;
    if (form === 'electrode') {
      const s = t - WAVE_DELAY_S;
      if (s >= 0 && s - this.dt < 0) this.started = true;
      if (s < 0 || s > WAVE_S) return 0;
      // Surface-negative, so up, as eegpedia's figure draws it on P4. Polarity is
      // not asserted by IK-049: an impedance change can go either way.
      return -BREATHING_WAVE_UV * this.amp * (1 - Math.cos(2 * Math.PI * s / WAVE_S)) / 2;
    }
    if (t === 0) this.started = true;
    if (t > SHARP_RISE_S + SHARP_FALL_S) return 0;
    const shape = t < SHARP_RISE_S ? t / SHARP_RISE_S : Math.exp(-(t - SHARP_RISE_S) / (SHARP_FALL_S / 3));
    return -BREATHING_SHARP_UV * this.amp * shape;
  }
}

// --- Water in the ventilator tubing --------------------------------------------

/**
 * The burst template's length. The source's bursts last "approximately 1 second" as seen;
 * a waxing-and-waning (sin^2) envelope is above a tenth of its peak for 0.8 of its length,
 * so 1 s of template read as 0.75 s (Step 29, 2026-11-25). 1.25 s reads as about 1 s.
 */
export const BURST_S = 1.25;
/** Microvolts at the most-coupled lead, peak (owner's choice: no source gives a size). */
export const WATER_UV = 60;
/** After suctioning, how long until water comes back, and how long it then takes to build up fully (owner's choice). */
const DRY_S = 30, REFILL_S = 60;

export class WaterInTubing {
  private readonly template: Float64Array;
  private pos = Infinity;
  private sinceSuction = Infinity;
  /** True on the sample a burst begins. */
  started = false;

  constructor(seed: number, private dt: number) {
    // One burst, kept and replayed: sharp activity at 10-15 Hz (owner's choice; the
    // source says "polysharp/polyspike" and "paroxysmal fast activity") under a
    // waxing-then-waning envelope, its frequency wandering a little within the burst.
    const g = new Gaussian(seed);
    const n = Math.round(BURST_S / dt);
    this.template = new Float64Array(n);
    let phase = 0, f = g.range(10, 15), peak = 0;
    for (let i = 0; i < n; i++) {
      f = Math.min(15, Math.max(10, f + 0.4 * g.next()));
      phase += 2 * Math.PI * f * dt;
      const env = Math.sin(Math.PI * i / n) ** 2;
      // A sharpened sine: pointed peaks, rounded troughs.
      const v = env * (Math.sin(phase) + 0.35 * Math.sin(2 * phase + 0.6));
      this.template[i] = v;
      peak = Math.max(peak, Math.abs(v));
    }
    for (let i = 0; i < n; i++) this.template[i] /= peak;
  }

  /** The technologist suctions the tubing. */
  suction() { this.sinceSuction = 0; }

  /** How much water is back in the tubing, 0-1. */
  get waterLevel(): number { return this.water; }
  private get water(): number {
    return Math.min(1, Math.max(0, (this.sinceSuction - DRY_S) / REFILL_S));
  }

  /** Advance; `breath` on the sample a ventilator breath begins. Returns the burst now, at unit coupling, microvolts. */
  next(breath: boolean): number {
    this.sinceSuction += this.dt;
    this.started = false;
    if (breath && this.water > 0) { this.pos = 0; this.started = true; }
    if (this.pos >= this.template.length) return 0;
    return WATER_UV * this.water * this.template[this.pos++];
  }
}

/**
 * How much of the water's charge each lead picks up: more on the ventilator's side,
 * and differently on every lead (where the tubing lies). Its own stream.
 */
export function tubingCoupling(seed: number, electrodes: string[], side: 'left' | 'right'): number[] {
  const g = new Gaussian(deriveSeed(seed, 'tubingCoupling'));
  const draws = electrodes.map(() => g.range(0.4, 1));
  return electrodes.map((e, c) => {
    const x = electrodePositions3D[e]?.[0] ?? 0;            // + is left
    const towards = side === 'left' ? x : -x;
    const sideFactor = Math.abs(x) < 0.05 ? 0.65 : towards > 0 ? 1 : 0.4;
    return /^A[12]$/.test(e) ? 0 : sideFactor * draws[c];
  });
}

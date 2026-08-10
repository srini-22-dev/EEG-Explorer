/**
 * Burst / event-based rhythms (briefing §3.3).
 *
 * Sensorimotor beta and much of alpha are not sustained rhythms at all — they
 * are sequences of short high-amplitude transients. The "sustained power" seen
 * in trial-averaged analyses is an artifact of averaging over bursts. A
 * generator that emits continuous beta therefore gets the first-order statistics
 * right and the temporal structure completely wrong, and any burst-detection or
 * ERD/ERS method benchmarked against it is being tested on the wrong signal.
 *
 * Recipe followed here: burst onsets from a gamma renewal process, each burst a
 * windowed wavelet whose duration, peak frequency, amplitude and phase are drawn
 * from distributions, summed. Burst amplitude and lifetime are heavy-tailed, so
 * both are drawn log-normal.
 */

import { Gaussian } from './rng';

type Burst = {
  /** samples remaining until this burst ends */
  remaining: number;
  /** total length in samples */
  length: number;
  /** samples elapsed */
  elapsed: number;
  omega: number;
  phase: number;
  amp: number;
};

export type BurstOptions = {
  /** Centre frequency, Hz. */
  freq: number;
  /** SD of per-burst peak-frequency variation, Hz. */
  freqSpread?: number;
  /** Median burst duration, seconds (beta: ~0.15, i.e. 2-4 cycles). */
  medianDuration?: number;
  /** Log-SD of burst duration — heavy tail. */
  durationSigma?: number;
  /** Mean interval between burst onsets, seconds. */
  meanInterval?: number;
  /**
   * Shape parameter of the gamma renewal process. 1 = Poisson (fully random);
   * higher values make onsets more regular. Real burst trains sit slightly above
   * Poisson, so 1.5 is a reasonable default.
   */
  renewalShape?: number;
  /** Log-SD of burst amplitude — heavy tail. */
  ampSigma?: number;
  /** Target output RMS in microvolts. */
  rms?: number;
};

export class BurstyOscillator {
  private g: Gaussian;
  private dt: number;
  private active: Burst[] = [];
  private samplesToNext = 0;
  private scale = 1;
  private currentRms = 1;

  private freq: number;
  private freqSpread: number;
  private medianDuration: number;
  private durationSigma: number;
  private meanInterval: number;
  private renewalShape: number;
  private ampSigma: number;

  /** Set for the current sample: is at least one burst in progress? Ground truth. */
  bursting = false;

  constructor(seed: number, dt: number, opts: BurstOptions) {
    const {
      freq,
      freqSpread = 1.5,
      medianDuration = 0.15,
      durationSigma = 0.45,
      meanInterval = 0.8,
      renewalShape = 1.5,
      ampSigma = 0.6,
      rms = 1,
    } = opts;

    this.g = new Gaussian(seed);
    this.dt = dt;
    this.freq = freq;
    this.freqSpread = freqSpread;
    this.medianDuration = medianDuration;
    this.durationSigma = durationSigma;
    this.meanInterval = meanInterval;
    this.renewalShape = renewalShape;
    this.ampSigma = ampSigma;

    this.scheduleNext();

    // Empirical amplitude calibration, as with the Hopf oscillator: burst
    // statistics interact in a way that has no useful closed form.
    const warm = Math.ceil(20 / dt);
    for (let i = 0; i < warm; i++) this.next();
    const measureN = Math.ceil(120 / dt);
    let sumSq = 0;
    for (let i = 0; i < measureN; i++) {
      const v = this.next();
      sumSq += v * v;
    }
    const measured = Math.sqrt(sumSq / measureN);
    this.scale = measured > 0 ? rms / measured : 1;
    this.currentRms = rms;
  }

  /**
   * Gamma renewal interval, via the sum of `shape` exponentials. Poisson onsets
   * (shape 1) produce implausible near-simultaneous doublets; a modest shape
   * keeps bursts separated without making them metronomic.
   */
  private scheduleNext() {
    const k = Math.max(1, Math.round(this.renewalShape));
    let t = 0;
    for (let i = 0; i < k; i++) t += this.g.exponential(this.meanInterval / k);
    this.samplesToNext = Math.max(1, Math.round(t / this.dt));
  }

  private spawn() {
    const duration = this.g.logNormal(this.medianDuration, this.durationSigma);
    const length = Math.max(2, Math.round(duration / this.dt));
    this.active.push({
      remaining: length,
      length,
      elapsed: 0,
      omega: 2 * Math.PI * Math.max(0.5, this.freq + this.freqSpread * this.g.next()),
      phase: this.g.uniform() * 2 * Math.PI,
      amp: this.g.logNormal(1, this.ampSigma),
    });
  }

  next(): number {
    if (--this.samplesToNext <= 0) {
      this.spawn();
      this.scheduleNext();
    }

    let sum = 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      // Gaussian window, truncated at the burst length. Centring the window and
      // using length/5 as sigma puts the burst's energy inside its stated
      // duration without a hard edge, which would otherwise splatter broadband.
      const centre = b.length / 2;
      const sigma = b.length / 5;
      const d = b.elapsed - centre;
      const env = Math.exp(-(d * d) / (2 * sigma * sigma));
      sum += b.amp * env * Math.cos(b.omega * b.elapsed * this.dt + b.phase);
      b.elapsed++;
      if (--b.remaining <= 0) this.active.splice(i, 1);
    }
    this.bursting = this.active.length > 0;
    return sum * this.scale;
  }

  setRms(rms: number) {
    if (this.currentRms > 0) this.scale *= rms / this.currentRms;
    this.currentRms = rms;
  }
}

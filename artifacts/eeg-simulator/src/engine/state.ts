/**
 * Slow latent vigilance state (briefing §6).
 *
 * Real ten-minute recordings are never stationary: vigilance drifts, alpha waxes
 * and wanes over tens of seconds, and artifact rates cluster rather than arriving
 * uniformly. §6 singles this out — "this alone makes long records look far more
 * authentic" — and §12 lists "everything stationary over the whole record" as a
 * failure mode.
 *
 * One latent variable in [0,1] (0 = drowsy, 1 = alert) drives every band's gain
 * and the artifact rates together, so the whole recording drifts coherently
 * instead of each component wandering independently.
 */

import { AperiodicSource } from './aperiodic';
import { deriveSeed } from './rng';

/** The latent state is slow; it runs on a decimated clock. */
const STATE_HZ = 10;

export type VigilanceGains = {
  /** Posterior alpha: maximal in relaxed wakefulness, attenuated by drowsiness. */
  alpha: number;
  /** Beta: tracks alertness and muscle tone. */
  beta: number;
  /** Theta: rises as vigilance falls. */
  theta: number;
  /** Delta: rises as vigilance falls, more steeply than theta. */
  delta: number;
  /** Scalp EMG: falls as the subject relaxes. */
  emg: number;
  /** Multiplier on blink/saccade rates. */
  ocularRate: number;
};

export class VigilanceState {
  private drift: AperiodicSource;
  private decimate: number;
  private counter = 0;
  private raw = 0;

  /** Current latent vigilance in [0,1]. Ground truth for the sidecar log. */
  value = 0.5;

  constructor(seed: number, dt: number, private bias = 0.5) {
    // Long-memory drift so vigilance wanders over tens of seconds to minutes
    // rather than jittering; chi ~0.6 gives that without being a random walk.
    this.decimate = Math.max(1, Math.round(1 / (STATE_HZ * dt)));
    this.drift = new AperiodicSource(deriveSeed(seed, 'vigilance'), 1 / STATE_HZ, {
      exponent: 0.6, fLo: 0.004, fHi: 0.5, components: 6, rms: 1,
    });
    this.step();
  }

  private step() {
    this.raw = this.drift.next();
    // Logistic squash keeps the state bounded without clipping, which would
    // otherwise flatten the distribution at the extremes.
    this.value = 1 / (1 + Math.exp(-(this.raw * 1.1 + (this.bias - 0.5) * 4)));
  }

  setBias(bias: number) { this.bias = bias; }

  advance() {
    if (this.counter <= 0) {
      this.step();
      this.counter = this.decimate;
    }
    this.counter--;
  }

  gains(): VigilanceGains {
    const v = this.value;
    return {
      // Alpha peaks in relaxed wakefulness — high but not maximal vigilance —
      // and drops off at both ends (drowsiness, and active attention).
      alpha: 0.35 + 1.15 * Math.exp(-Math.pow((v - 0.65) / 0.28, 2)),
      beta: 0.5 + 1.0 * v,
      theta: 1.6 - 1.1 * v,
      delta: 1.9 - 1.5 * v,
      emg: 0.35 + 1.3 * v,
      ocularRate: 0.4 + 1.2 * v,
    };
  }
}

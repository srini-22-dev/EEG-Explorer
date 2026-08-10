/**
 * Seeded pseudo-random number generation.
 *
 * Every stochastic process in the engine draws from an explicit, seeded stream
 * rather than the global `Math.random()`. Two reasons, both required by the
 * briefing: a given seed must reproduce a given recording exactly (§14's
 * ground-truth logging is worthless if the signal can't be regenerated), and
 * per-subject parameter sampling (§12's "no inter-subject variability" failure
 * mode) needs streams that can be forked without coupling one source's noise to
 * another's.
 */

/** mulberry32 — small, fast, and good enough for signal synthesis. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministically derive a child seed from a parent seed and a label. */
export function deriveSeed(seed: number, label: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Standard normal draws. Box–Muller produces two at a time, so the spare is
 * cached — halving the transcendental calls matters when every source advances
 * several noise processes on every one of 250 samples per second.
 */
export class Gaussian {
  private rng: () => number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.rng = makeRng(seed);
  }

  next(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let u = 0, v = 0, s = 0;
    do {
      u = this.rng() * 2 - 1;
      v = this.rng() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * f;
    return u * f;
  }

  /** Uniform in [0,1). */
  uniform(): number {
    return this.rng();
  }

  /** Uniform in [lo,hi). */
  range(lo: number, hi: number): number {
    return lo + this.rng() * (hi - lo);
  }

  /**
   * Log-normal with the given median and geometric SD. Burst amplitudes and
   * oscillation envelopes are approximately log-normal in real EEG (§11.2), so
   * this is the default marginal for anything amplitude-like.
   */
  logNormal(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.next());
  }

  /** Exponential with the given mean — inter-event intervals of a Poisson process. */
  exponential(mean: number): number {
    return -Math.log(1 - this.rng()) * mean;
  }
}

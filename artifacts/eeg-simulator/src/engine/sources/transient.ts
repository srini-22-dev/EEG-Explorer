/**
 * The transient (event) source primitive.
 *
 * The engine's neural generators (`aperiodic.ts`, `oscillator.ts`, `bursts.ts`)
 * are all *continuous* processes — they always have a value. But most clinical
 * graphoelements are *events*: a spike fires, plays out its spike-and-slow-wave
 * morphology over ~0.9 s, then nothing until the next one. This primitive supplies
 * that missing shape: a seeded scheduler that triggers a morphology waveform at
 * intervals and returns 0 between events.
 *
 * The scalar it returns is the source amplitude in microvolts *at its strongest
 * electrode* — the leadfield column built from the source's geometry then spreads
 * it across the scalp. It carries no geometry of its own; the family descriptor
 * that owns it pairs it with a `SourceSpec` (see `registry.ts`).
 */

import { Gaussian } from '../rng';

export type TransientSchedule =
  /** Fixed rate with optional proportional jitter on each interval. */
  | { kind: 'periodic'; period: number; jitterFrac?: number }
  /** Exponential inter-event intervals — a Poisson process. */
  | { kind: 'renewal'; meanInterval: number };

export type TransientOptions<E = void> = {
  schedule: TransientSchedule;
  /**
   * Waveform value (µV, at the peak electrode) as a function of seconds since
   * onset. The second argument carries the per-event parameters drawn by `onset`
   * (amplitude, duration, …), fixed for the lifetime of one event — this is how a
   * graphoelement varies from occurrence to occurrence the way real ones do.
   */
  morphology: (dt: number, event: E) => number;
  /**
   * Optional per-event parameter draw, called once at each onset with the source's
   * seeded RNG. Whatever it returns is handed to `morphology` for that event. Omit
   * for graphoelements whose shape is identical every time.
   */
  onset?: (g: Gaussian) => E;
  /** Event duration in seconds; after this the event ends and the next is scheduled. */
  duration: number;
};

export class TransientSource<E = void> {
  private g: Gaussian;
  private dt: number;
  private schedule: TransientSchedule;
  private morphology: (dt: number, event: E) => number;
  private drawEvent?: (g: Gaussian) => E;
  private duration: number;

  private clock = 0;
  /** Absolute time of the next scheduled onset; -1 until first scheduled. */
  private nextOnset = -1;
  /** Onset time of the event currently playing out, or -1 when idle. */
  private onset = -1;
  /** Parameters drawn for the event currently playing out. */
  private eventParams!: E;

  constructor(seed: number, dt: number, opts: TransientOptions<E>) {
    this.g = new Gaussian(seed);
    this.dt = dt;
    this.schedule = opts.schedule;
    this.morphology = opts.morphology;
    this.drawEvent = opts.onset;
    this.duration = opts.duration;
  }

  private drawInterval(): number {
    if (this.schedule.kind === 'renewal') {
      return this.g.exponential(this.schedule.meanInterval);
    }
    const { period, jitterFrac = 0 } = this.schedule;
    return period * (1 + (this.g.uniform() - 0.5) * 2 * jitterFrac);
  }

  /**
   * Advance one sample.
   *
   * When disabled, the source is fully quiescent and its schedule is cleared, so
   * re-enabling begins a fresh event soon rather than resuming a stale one — the
   * clinically correct behaviour for a toggle that says "show me a spike focus".
   */
  next(enabled: boolean): number {
    if (!enabled) {
      this.onset = -1;
      this.nextOnset = -1;
      // Keep the clock running so absolute-time morphologies stay continuous, but
      // it is only ever compared against freshly scheduled onsets.
      this.clock += this.dt;
      return 0;
    }

    this.clock += this.dt;

    if (this.nextOnset < 0) {
      // First enabled sample: schedule the first event a short, seeded delay out.
      this.nextOnset = this.clock + this.drawInterval();
    }

    if (this.onset < 0 && this.clock >= this.nextOnset) {
      this.onset = this.clock;
      // Draw this event's parameters once, at onset, so they stay fixed while it
      // plays out. Order matters for reproducibility: the interval that scheduled
      // this onset was already drawn, so these draws follow it deterministically.
      if (this.drawEvent) this.eventParams = this.drawEvent(this.g);
    }

    if (this.onset >= 0) {
      const dt = this.clock - this.onset;
      if (dt >= this.duration) {
        this.onset = -1;
        this.nextOnset = this.clock + this.drawInterval();
        return 0;
      }
      return this.morphology(dt, this.eventParams);
    }

    return 0;
  }

  /** True while an event is playing out. */
  get active(): boolean {
    return this.onset >= 0;
  }
}

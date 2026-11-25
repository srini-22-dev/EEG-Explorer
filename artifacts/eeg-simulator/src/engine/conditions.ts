/**
 * Recording conditions over time: what a patient in a given setting DOES during a
 * record, as multipliers on the artifact layer's own generators.
 *
 * The level's recipe (utils/recordingConditions.ts) decides which artifacts can be on
 * the page and at what settings. This decides when they happen. Muscle is the case
 * that needs it most: a muscle toggle held on draws a patient clenching for the whole
 * record, and no patient does that. A real one tenses in episodes — when anxious at
 * the start, when swallowing, when turned by a nurse — and is still in between.
 *
 * Three processes, each from this director's own random stream ('conditions'), so
 * every subject's own generators are untouched:
 *   - muscle EPISODES: a renewal process of on and off stretches, each on-stretch
 *     drawing which muscles contract, ramped in and out over 0.3 s (a contraction
 *     builds over a few hundred milliseconds; a step would be a pop, not muscle);
 *   - an ocular RATE multiplier: a settling trend (an anxious patient blinks a lot at
 *     first) times a slow Ornstein-Uhlenbeck wander;
 *   - ACTIVITY episodes: stretches of handling or moving about, during which movement
 *     artifact is frequent, and rare or absent in between.
 *
 * The patient reasoning behind each number sits with its schedule below. Everything
 * here is compressed in time — a real patient spreads these over an hour — so that
 * each level shows its typical artifacts within about two minutes (owner, 2026-11-25:
 * decide these "by considering a real patient and what they would do"; the details
 * are not shown in the app).
 */

import { Gaussian, deriveSeed } from './rng';
import type { ConditionLevel, EmgRegion } from '../utils/simTypes';

type MuscleSchedule = {
  /** Mean off-stretch, seconds, at the start of the record and once settled. */
  offEarlyS: number; offLateS: number;
  /** Time constant of the settling from early to late, seconds. */
  settleS: number;
  /** On-stretch, seconds, uniform between the two. */
  onS: [number, number];
  /** Which muscles an episode contracts, by weight. */
  groups: [weight: number, regions: EmgRegion[]][];
};

type OcularSchedule = {
  /** Rate multiplier at the start and once settled, and the settling time constant. */
  early: number; late: number; settleS: number;
  /** SD of the log-rate wander (time constant 30 s). */
  driftSd: number;
};

type ActivitySchedule = {
  /** Mean quiet stretch and the active stretch, seconds. */
  offS: number; onS: [number, number];
  /** Movement-rate multiplier while active and while quiet. */
  scaleOn: number; scaleOff: number;
};

type Schedule = { muscle?: MuscleSchedule; ocular?: OcularSchedule; activity?: ActivitySchedule };

const BOTH_TEMPORALIS: EmgRegion[] = ['temporalisL', 'temporalisR'];
const ALL_MUSCLES: EmgRegion[] = ['temporalisL', 'temporalisR', 'frontalis', 'nuchal'];

export const SCHEDULES: Record<Exclude<ConditionLevel, 'none'>, Schedule> = {
  // A textbook page: nothing happens.
  ideal: {},
  // A cooperative volunteer in a shielded room after careful preparation: still, and
  // relaxed from the start. The only muscle is a swallow or a brief jaw set now and
  // then; blinking is steady.
  controlled: {
    muscle: { offEarlyS: 80, offLateS: 80, settleS: 1, onS: [0.8, 2], groups: [[1, BOTH_TEMPORALIS]] },
    ocular: { early: 1, late: 1, settleS: 1, driftSd: 0.15 },
  },
  // An adult outpatient: anxious on the couch at first — clenching the jaw, frowning,
  // blinking a lot — and settling over the first couple of minutes. Jaw clenching is
  // the commonest muscle on a routine record, sometimes on one side; frowning brings
  // the frontalis.
  routine: {
    muscle: {
      offEarlyS: 12, offLateS: 60, settleS: 120, onS: [1.5, 6],
      groups: [[0.55, BOTH_TEMPORALIS], [0.25, ['frontalis']], [0.1, ['temporalisL']], [0.1, ['temporalisR']]],
    },
    ocular: { early: 1.6, late: 0.8, settleS: 90, driftSd: 0.2 },
  },
  // Up and about at home, unsupervised: talking, turning the head, walking, eating
  // (the chewing toggle's own runs). Muscle is frequent and often the neck; blinking
  // varies with whatever they are doing; movement comes in stretches of activity.
  ambulatory: {
    muscle: {
      offEarlyS: 20, offLateS: 20, settleS: 1, onS: [2, 10],
      groups: [[0.35, BOTH_TEMPORALIS], [0.35, ['nuchal']], [0.15, ['frontalis']], [0.15, [...BOTH_TEMPORALIS, 'nuchal']]],
    },
    ocular: { early: 1.2, late: 1.2, settleS: 1, driftSd: 0.35 },
    activity: { offS: 60, onS: [20, 40], scaleOn: 6, scaleOff: 0.5 },
  },
  // Sedated and ventilated: still, except for brief episodes of agitation (every
  // muscle at once) and nursing care — turning, suctioning, repositioning — which
  // moves the head and leads for half a minute and leaves it alone otherwise.
  icu: {
    muscle: { offEarlyS: 120, offLateS: 120, settleS: 1, onS: [3, 10], groups: [[1, ALL_MUSCLES]] },
    activity: { offS: 120, onS: [20, 40], scaleOn: 10, scaleOff: 0 },
  },
  // The record a technologist redoes: a restless patient who never settles.
  worst: {
    muscle: {
      offEarlyS: 6, offLateS: 6, settleS: 1, onS: [3, 15],
      groups: [[0.4, ALL_MUSCLES], [0.3, BOTH_TEMPORALIS], [0.3, ['nuchal', 'frontalis']]],
    },
    ocular: { early: 1.5, late: 1.5, settleS: 1, driftSd: 0.4 },
    activity: { offS: 30, onS: [15, 40], scaleOn: 6, scaleOff: 1 },
  },
};

const RAMP_S = 0.3;
const DRIFT_TAU_S = 30;

export class ConditionsDirector {
  private readonly g: Gaussian;
  private readonly s: Schedule;
  private t = 0;

  /** Muscle envelope now, 0 (still) to 1 (the toggle's full contraction). */
  emg = 0;
  /** The muscles this episode contracts; null between episodes and with no muscle schedule. */
  emgRegions: EmgRegion[] | null = null;
  /** How hard this episode contracts, relative to the toggle's severity (0.6-1.4): no two clenches are alike. */
  emgIntensity = 1;
  /** Multiplier on blink and saccade rates. */
  ocularRate = 1;
  /** Multiplier on the movement rate; changes only at the edge of an activity stretch. */
  movementScale = 1;
  /** Set on the sample an activity stretch starts or ends, so the layer can reschedule. */
  activityEdge: 'start' | 'end' | null = null;

  private emgOn = false;
  private emgLeft: number;
  private drift = 0;
  private activeOn = false;
  private activityLeft: number;

  constructor(level: Exclude<ConditionLevel, 'none'>, seed: number, private readonly dt: number) {
    this.g = new Gaussian(deriveSeed(seed, 'conditions'));
    this.s = SCHEDULES[level];
    // A record starts quiet: the first muscle episode and the first activity stretch
    // come after an off-stretch, not on the first sample.
    this.emgLeft = this.s.muscle ? this.g.exponential(this.offMean()) : Infinity;
    this.activityLeft = this.s.activity ? this.g.exponential(this.s.activity.offS) : Infinity;
    // With no muscle schedule a Muscle toggle switched on by hand is held, as in Custom.
    if (!this.s.muscle) this.emg = 1;
    if (this.s.activity) this.movementScale = this.s.activity.scaleOff;
    if (this.s.ocular) this.ocularRate = this.s.ocular.early;
  }

  private offMean(): number {
    const m = this.s.muscle!;
    return m.offLateS + (m.offEarlyS - m.offLateS) * Math.exp(-this.t / m.settleS);
  }

  private pickGroup(groups: MuscleSchedule['groups']): EmgRegion[] {
    let u = this.g.uniform() * groups.reduce((a, [w]) => a + w, 0);
    for (const [w, r] of groups) { if ((u -= w) <= 0) return r; }
    return groups[groups.length - 1][1];
  }

  /** Advance one sample. */
  step() {
    const dt = this.dt;
    this.t += dt;
    const m = this.s.muscle;
    if (m) {
      this.emgLeft -= dt;
      if (this.emgLeft <= 0) {
        this.emgOn = !this.emgOn;
        if (this.emgOn) {
          this.emgRegions = this.pickGroup(m.groups);
          this.emgLeft = this.g.range(m.onS[0], m.onS[1]);
          this.emgIntensity = this.g.range(0.6, 1.4);
        } else {
          this.emgLeft = this.g.exponential(this.offMean());
        }
      }
      // Ramp toward the target; the regions are kept until the ramp-down ends.
      const target = this.emgOn ? 1 : 0;
      const stepUp = dt / RAMP_S;
      this.emg = target > this.emg ? Math.min(target, this.emg + stepUp) : Math.max(target, this.emg - stepUp);
      if (this.emg === 0 && !this.emgOn) this.emgRegions = null;
    }
    const o = this.s.ocular;
    if (o) {
      // Ornstein-Uhlenbeck in log rate: decays toward 0, stationary SD driftSd.
      const a = dt / DRIFT_TAU_S;
      this.drift += -a * this.drift + o.driftSd * Math.sqrt(2 * a) * this.g.next();
      this.ocularRate = (o.late + (o.early - o.late) * Math.exp(-this.t / o.settleS)) * Math.exp(this.drift);
    }
    const act = this.s.activity;
    this.activityEdge = null;
    if (act) {
      this.activityLeft -= dt;
      if (this.activityLeft <= 0) {
        this.activeOn = !this.activeOn;
        this.activityEdge = this.activeOn ? 'start' : 'end';
        this.movementScale = this.activeOn ? act.scaleOn : act.scaleOff;
        this.activityLeft = this.activeOn ? this.g.range(act.onS[0], act.onS[1]) : this.g.exponential(act.offS);
      }
    }
  }

  /** Whether this level has activity stretches at all (movement otherwise comes at its own rate). */
  get hasActivity(): boolean { return this.s.activity != null; }
  /** An activity stretch is under way. */
  get activityOn(): boolean { return this.activeOn; }

  /** A draw from this director's stream, for the layer's rescheduling (seconds to the next movement). */
  exponential(mean: number): number { return this.g.exponential(mean); }
}

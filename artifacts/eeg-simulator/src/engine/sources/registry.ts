/**
 * The pattern-source contract and registry.
 *
 * Every toggleable clinical element — sleep graphoelement, normal variant,
 * artifact, non-epileptiform abnormality, interictal discharge, ictal evolution —
 * is a `PatternSourceDescriptor`: a piece of geometry (a `SourceSpec` built with
 * `sourceUnder`) plus a stateful generator that emits a scalar microvolt value
 * each sample. The engine appends every descriptor's geometry to the leadfield and
 * sums its generator's output at the electrodes, exactly as it does for background
 * and rhythm sources. Toggling a pattern on/off is just gating that one source, so
 * any number of patterns compose additively at the electrode level.
 *
 * This is the single shared contract the family files implement. The types below
 * are frozen: each family (`sleep.ts`, `variants.ts`, …) exports an array of these
 * descriptors and nothing here needs to know what is inside them.
 */

import type { SourceSpec } from '../forward';
import type { PatientState, IctalHemisphere } from '../../utils/simTypes';

/**
 * The rhythm bands the engine's ongoing background is decomposed into. A pattern
 * can suppress specific bands of that background (see `bandGate`) — e.g. an
 * encephalopathic slowing that abolishes the alpha PDR while leaving broadband
 * background intact. The engine owns the source→band mapping; this is only the
 * vocabulary the hook speaks in.
 */
export type Band = 'background' | 'alpha' | 'mu' | 'theta' | 'delta' | 'beta';

/** Per-sample context handed to every pattern generator. */
export type SampleContext = {
  /** Elapsed simulated time this sample, seconds. */
  t: number;
  dt: number;
  state: PatientState;
  /** Whether this source's toggle is active AND its state requirement (if any) is met. */
  enabled: boolean;
  /** Continuous vigilance level, 0..1 (from `state.ts`). */
  vigilance: number;
  /**
   * Amplitude multiplier for ictal sources (1 = default severity). Only the
   * ictal generators (`ictal.ts`) consult this; every other generator ignores it.
   */
  ictalIntensity: number;
  /**
   * Multiplier on an ictal source's discharge frequency (1 = the textbook rate).
   * Scales both ends of a pattern's scripted frequency sweep together, so the
   * evolution keeps its shape. Only the ictal generators consult this.
   */
  ictalFrequency: number;
  /**
   * Which side a focal seizure originates on. Only consulted by the focal
   * temporal and focal frontal ictal generators — absence and GTC are
   * generalised and ignore it.
   */
  ictalHemisphere: IctalHemisphere;
};

export interface PatternGenerator {
  /**
   * Additive scalar (µV at this source's peak electrode). Return 0 when the source
   * is contributing nothing this sample. A continuous generator may keep advancing
   * its internal state even when `ctx.enabled` is false (to preserve phase); a
   * transient one should stay quiescent — that choice belongs to the generator.
   */
  next(ctx: SampleContext): number;
  /**
   * Optional multiplier applied to the ONGOING background + rhythm activity, for
   * patterns that suppress rather than add (burst-suppression, post-ictal). Return
   * 1 for no effect. Only consulted while the descriptor's toggle is active.
   */
  gate?(ctx: SampleContext): number;
  /**
   * Optional PER-BAND multipliers on the ongoing background + rhythm activity, for
   * patterns that reshape the spectrum rather than merely add to or scale it — the
   * canonical case is encephalopathic generalised slowing, which abolishes the
   * alpha PDR while leaving the broadband background. Only the bands you return are
   * affected (others default to 1); composes multiplicatively with `gate` and with
   * other active patterns' band gates. Only consulted while the toggle is active.
   */
  bandGate?(ctx: SampleContext): Partial<Record<Band, number>>;
}

export type PatternSourceDescriptor = {
  /** Unique leadfield source id; also the label passed to `deriveSeed`. */
  id: string;
  /** Pattern toggle id(s) from `patterns.ts` that enable this source. */
  toggles: string[];
  /** If set, the source is only active in these patient states. */
  states?: PatientState[];
  /**
   * How `states` combines with the toggle to decide whether the source is active:
   *
   *  - `false` / omitted (default): the toggle gates it, and `states` merely
   *    *restricts* where the toggle has effect — `enabled = toggleOn && stateOk`.
   *    This is the norm: spikes, artifacts, a drowsy-only variant.
   *  - `true`: the state itself is a trigger — `enabled = toggleOn || stateInList`.
   *    Used for graphoelements that *define* a stage: N2 is not N2 without spindles
   *    and K-complexes, so they appear whenever the state is N2, and the toggle is
   *    an additional way to force them (e.g. to show a spindle while awake).
   */
  stateIntrinsic?: boolean;
  /** Geometry for the leadfield column (build with `sourceUnder`). */
  spec: SourceSpec;
  /** Factory: build the stateful generator. `seed` is already derived from `id`. */
  make(seed: number, dt: number): PatternGenerator;
};

import { SLEEP_SOURCES } from './sleep';
import { VARIANT_SOURCES } from './variants';
import { NON_EPILEPTIFORM_SOURCES } from './nonEpileptiform';
import { EPILEPTIFORM_SOURCES } from './epileptiform';
import { ICTAL_SOURCES } from './ictal';
import { ARTIFACT_PATTERN_SOURCES } from './artifactsPatterns';
import { ACTIVATION_SOURCES } from './activation';

/** The complete, ordered list of pattern sources the engine builds into its leadfield. */
export const PATTERN_SOURCES: PatternSourceDescriptor[] = [
  ...SLEEP_SOURCES,
  ...VARIANT_SOURCES,
  ...NON_EPILEPTIFORM_SOURCES,
  ...EPILEPTIFORM_SOURCES,
  ...ICTAL_SOURCES,
  ...ARTIFACT_PATTERN_SOURCES,
  ...ACTIVATION_SOURCES,
];

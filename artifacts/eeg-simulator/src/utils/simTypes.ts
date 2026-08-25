/**
 * Shared simulation types.
 *
 * These describe the *inputs* the UI hands to the signal layer — the clinical
 * state and the set of toggled patterns — not any one generator's internals.
 * They live here, standalone, so that both the streaming engine (`src/engine`)
 * and the React UI can depend on them without either importing the other.
 */

export type PatientState = 'awake' | 'drowsy' | 'n1' | 'n2' | 'n3';

export type IctalHemisphere = 'left' | 'right';

/** Per-toggle seizure parameters: amplitude, discharge frequency, and (for focal seizures) onset side. */
export type IctalParams = {
  /** Amplitude multiplier applied to this ictal source. 1 = default severity, range 0-3. */
  intensity: number;
  /**
   * Multiplier on this seizure's DISCHARGE frequency. 1 = the textbook rate,
   * range 0.5-2.
   *
   * It scales both ends of each pattern's scripted frequency sweep by the same
   * factor, so the *evolution* — absence slowing 3.2 -> 2.5 Hz, GTC clonic
   * 3 -> 1.5 Hz, focal temporal 6 -> 3.5 Hz, focal frontal 18 -> 3 Hz — keeps
   * its shape and its proportional slowing, which is the diagnostic feature.
   * Only the band it occupies moves. It does not touch post-ictal delta or the
   * phase durations, neither of which is a discharge rate.
   */
  frequency: number;
  /** Which side this focal seizure originates on. Ignored by generalised seizures (absence, GTC). */
  hemisphere: IctalHemisphere;
};

/** Keyed by ictal toggle id (see `ICTAL_TOGGLE_IDS`) — each seizure pattern has independent state. */
export type IctalParamsMap = Record<string, IctalParams>;

export const ICTAL_TOGGLE_IDS = [
  'absence-ictal', 'gtc-ictal', 'focal-temporal-ictal', 'focal-frontal-ictal',
] as const;

export function defaultIctalParamsMap(): IctalParamsMap {
  return Object.fromEntries(
    ICTAL_TOGGLE_IDS.map(id => [id, { intensity: 1, frequency: 1, hemisphere: 'left' as IctalHemisphere }])
  );
}

/**
 * Which muscle is contracting. Scalp EMG is not one phenomenon: each muscle has
 * its own territory, so which one is tense decides which channels are ruined.
 * Temporalis (jaw) sits under T3/T4 and can be genuinely one-sided; frontalis
 * (brow) sits over Fp1/Fp2; the posterior cervical sheet sits behind O1/O2 and
 * T5/T6, which is why neck tone buries the posterior dominant rhythm.
 */
export type EmgRegion = 'temporalisL' | 'temporalisR' | 'frontalis' | 'nuchal';

/** `'any'` lets pops land on a random electrode, as they did before the selector existed. */
export const POP_TARGET_ANY = 'any';

/**
 * Per-artifact settings, the artifact-layer counterpart of `IctalParams`.
 *
 * These are *contextual* controls: the UI only shows a group once its artifact
 * toggle is on. Every field is optional on the engine side — an omitted field
 * means "leave the generator as constructed", so a caller that never sets these
 * (`validateEngine.ts`) sees unchanged behaviour.
 */
export type ArtifactParams = {
  /** Blinks per minute. */
  blinkRatePerMin: number;
  /** Saccades per minute. */
  saccadeRatePerMin: number;
  /** Which muscles are contracting; an empty list silences EMG without touching the toggle. */
  emgRegions: EmgRegion[];
  /** EMG amplitude multiplier — resting tone through to a hard jaw clench. */
  emgSeverity: number;
  /** Electrode pops are confined to this electrode, or `POP_TARGET_ANY`. */
  popTarget: string;
  /** Mean number of pops per minute. */
  popRatePerMin: number;
  /**
   * Electrodes whose contact has been broken and not restored. The engine pops
   * the electrode as contact fails, then flattens it until it is removed here.
   */
  detachedElectrodes: string[];
  /** Sweat-drift amplitude multiplier. */
  sweatSeverity: number;
  /** Heart rate driving both the ECG display channel and the scalp cardiac artifact. */
  ecgBpm: number;
  /** Mean number of movement transients per minute. */
  movementRatePerMin: number;
  /** Movement-transient amplitude multiplier. */
  movementSeverity: number;
  /** Mains frequency: 50 Hz across most of the world, 60 Hz in the Americas. */
  lineFreq: 50 | 60;
  /** Mains amplitude in microvolts. */
  lineAmpUv: number;
};

export function defaultArtifactParams(): ArtifactParams {
  return {
    blinkRatePerMin: 16,
    saccadeRatePerMin: 25,
    emgRegions: ['temporalisL', 'temporalisR', 'frontalis'],
    emgSeverity: 1,
    popTarget: POP_TARGET_ANY,
    popRatePerMin: 1,
    detachedElectrodes: [],
    sweatSeverity: 1,
    ecgBpm: 68,
    movementRatePerMin: 0.7,
    movementSeverity: 1,
    lineFreq: 50,
    lineAmpUv: 5,
  };
}

/** Selectable paper speeds (mm/s) and display sensitivities (µV/mm). These are
 *  the only values the Display panel offers; the canvas treats both as plain
 *  numeric multipliers, so the sets can change here without touching geometry. */
export const SPEED_VALUES = [10, 20, 30] as const;
export const SENSITIVITY_VALUES = [1, 3, 5, 7, 10, 15, 30] as const;
export type Speed = (typeof SPEED_VALUES)[number];
export type Sensitivity = (typeof SENSITIVITY_VALUES)[number];

export type SimSettings = {
  speed: Speed;
  sensitivity: Sensitivity;
  patientState: PatientState;
  activePatterns: Set<string>;
  /** Independent intensity/hemisphere state per ictal toggle. */
  ictalParams: IctalParamsMap;
  /** Contextual settings for the artifact toggles. */
  artifactParams: ArtifactParams;
};

/**
 * Shared simulation types.
 *
 * These describe the *inputs* the UI hands to the signal layer — the clinical
 * state and the set of toggled patterns — not any one generator's internals.
 * They live here, standalone, so that both the streaming engine (`src/engine`)
 * and the React UI can depend on them without either importing the other.
 */

export type PatientState = 'awake' | 'drowsy' | 'n1' | 'n2' | 'n3';

export type SimSettings = {
  speed: 15 | 30 | 60;
  sensitivity: 5 | 7 | 10 | 15;
  patientState: PatientState;
  activePatterns: Set<string>;
};

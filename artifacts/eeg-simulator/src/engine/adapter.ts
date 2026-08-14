/**
 * Bridge between the streaming engine and the app's per-sample rendering loop.
 *
 * The canvas wants a map of electrode voltages for each successive sample; the
 * engine produces exactly that, but as a stateful stream that must be advanced
 * in order. This adapter owns the engine instance and keeps the sample clock.
 *
 * All clinical content — background, rhythms, sleep grapho-elements, benign
 * variants, abnormalities, epileptiform and ictal patterns, and artifacts — now
 * lives inside the engine as forward-modelled sources. The adapter's only job is
 * to translate the UI's `activePatterns` set into engine toggles each sample and
 * copy the resulting electrode potentials out; it no longer adds any voltage of
 * its own.
 */

import { EegEngine } from './engine';
import type { PatientState, SimSettings } from '../utils/simTypes';

export class SimulationSource {
  private engine: EegEngine;
  private buf: Float64Array;
  private voltages: Record<string, number> = {};
  private state: PatientState = 'awake';
  readonly dt: number;

  /** Elapsed simulated time, seconds. Advances only when `next()` is called. */
  t = 0;

  constructor(seed = Math.floor(Math.random() * 1e9), fs = 250) {
    this.engine = new EegEngine({ seed, fs });
    this.buf = new Float64Array(this.engine.electrodes.length);
    this.dt = 1 / fs;
    for (const name of this.engine.electrodes) this.voltages[name] = 0;
    // ECG is a recorded display channel, not a scalp electrode, so the engine
    // supplies it separately rather than through the leadfield projection.
    this.voltages['ECG'] = 0;
  }

  setPatientState(state: PatientState) {
    if (state === this.state) return;
    this.state = state;
    this.engine.setPatientState(state);
  }

  /**
   * Advance one sample and return the electrode voltage map.
   *
   * The returned object is reused between calls to avoid allocating 21 numbers
   * 250 times a second; callers must consume it before the next call.
   */
  next(settings: SimSettings): Record<string, number> {
    this.setPatientState(settings.patientState as PatientState);

    // The engine's own artifact generators (own topographies, leadfield-
    // projected) are gated by the "Artifacts"
    // toggles, read fresh every sample so a checkbox flips instantly without
    // rebuilding the engine (see `EegEngine.setArtifactGates`'s doc comment).
    // `chewing` is a pattern source, not an engine artifact generator, so it is
    // handled by `setActivePatterns` below rather than here. `ecgScalp` (cardiac
    // scalp contamination) and `movement` have no UI toggle at all yet, so they
    // stay off — leaving them on would reintroduce artifacts nobody asked for on
    // a supposedly clean background.
    const ap = settings.activePatterns;
    this.engine.setArtifactGates({
      blink: ap.has('blink'),
      saccade: ap.has('eye-movement'),
      emg: ap.has('muscle'),
      pop: ap.has('electrode-pop'),
      sweat: ap.has('sweat'),
      line: ap.has('50hz'),
      ecgScalp: false,
      movement: false,
    });

    // Every non-artifact clinical toggle (sleep, variants, abnormalities,
    // epileptiform, ictal, chewing) is a pattern source inside the engine.
    this.engine.setActivePatterns(ap);

    this.engine.next(this.buf);
    this.t += this.dt;

    const names = this.engine.electrodes;
    for (let i = 0; i < names.length; i++) {
      this.voltages[names[i]] = this.buf[i];
    }
    this.voltages['ECG'] = this.engine.ecgChannelValue;
    return this.voltages;
  }

  get groundTruth() {
    return this.engine.groundTruth;
  }
}

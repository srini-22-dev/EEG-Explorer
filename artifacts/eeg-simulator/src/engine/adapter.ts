/**
 * Bridge between the streaming engine and the app's per-sample rendering loop.
 *
 * The canvas wants a map of electrode voltages for each successive sample; the
 * engine produces exactly that, but as a stateful stream that must be advanced in
 * order. This adapter owns the engine instance, keeps the sample clock, and
 * layers the toggleable clinical graphoelements on top of the generated
 * background.
 */

import { EegEngine, type PatientState } from './engine';
import { getPatternVoltage, getBackgroundGate, type SimSettings } from '../utils/eegGenerator';
import type { Electrode } from '../utils/montages';

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
    this.engine.next(this.buf);
    this.t += this.dt;

    const gate = getBackgroundGate(this.t, settings);
    const names = this.engine.electrodes;
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      this.voltages[name] =
        this.buf[i] * gate + getPatternVoltage(name as Electrode, this.t, settings);
    }
    return this.voltages;
  }

  get groundTruth() {
    return this.engine.groundTruth;
  }
}

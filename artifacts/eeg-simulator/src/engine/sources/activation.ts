/**
 * Activation procedure sources — intermittent photic stimulation and
 * hyperventilation.
 *
 * These are not spontaneous patterns: they are the two provocations performed in
 * essentially every routine EEG, and every report has a section for them. A
 * learner who has only ever seen a resting record has never seen the two
 * responses they will be asked about first — the occipital photic driving
 * response, and the hyperventilation build-up of generalised slowing.
 *
 * Both are *procedures with a time course*, which makes them different from the
 * other sources in this directory. What matters clinically is not a single epoch
 * but the evolution: how the driving response tracks the flash rate as the
 * stimulator steps through its series, and how the HV build-up grows over
 * minutes and then resolves. So each one runs a scripted clock that starts when
 * the toggle is switched on and resets when it is switched off (the same
 * `if (!ctx.enabled) { reset(); return 0; }` idiom the ictal sources use) —
 * watching a procedure from the middle would teach nothing.
 *
 * Only the NORMAL (physiological) responses are modelled here. The abnormal
 * photoparoxysmal response and HV-induced absence seizures are separate
 * findings, and the existing generalised spike-wave toggles already show that
 * morphology; coupling them to these sources would need cross-source
 * signalling the registry contract deliberately does not have.
 */

import { sourceUnder } from '../forward';
import { HopfOscillator } from '../oscillator';
import { deriveSeed } from '../rng';
import type { PatternSourceDescriptor } from './registry';

const TWO_PI = 2 * Math.PI;

// ---------------------------------------------------------------------------
// Intermittent photic stimulation (IPS).
//
// A strobe is flashed at the patient's eyes in a stepped series of frequencies.
// The normal finding is the PHOTIC DRIVING RESPONSE: rhythmic activity over the
// occipital regions, time-locked to the flashes, at the flash frequency and/or
// its harmonics. Three facts define it and are modelled here:
//
//  1. It is OCCIPITAL and SYMMETRIC — a persistently asymmetric driving response
//     is the abnormality. One bilateral source spanning O1/O2.
//  2. It occurs AT THE FLASH FREQUENCY, so it steps as the stimulator steps.
//     Phase is accumulated sample by sample rather than computed from absolute
//     time, so a frequency change never produces a phase discontinuity.
//  3. It is FREQUENCY-TUNED: best elicited in the 8-20 Hz range, near the
//     subject's own alpha frequency, and rarely seen below ~4 Hz or above
//     ~30 Hz. `drivingGain` is that tuning curve.
//
// Timing is the one deliberate compression. Clinically a train runs ~10 s with
// >=7 s between steps, so a full 1-30 Hz series takes close to four minutes and
// the informative part (8-20 Hz) does not begin until a minute in. Here the
// trains are 6 s with 3 s rests, which puts the whole series inside two minutes
// of scrolling display. That shortens the PROCEDURE, not the physiology: the
// stepped structure, the flash-locking, the harmonic content and the tuning are
// all unchanged, and the driving response builds within a flash or two in any
// case.
// ---------------------------------------------------------------------------
const PHOTIC_STEPS = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30]; // Hz
const PHOTIC_TRAIN = 6;   // seconds of flashing per step
const PHOTIC_REST = 3;    // seconds between steps
const PHOTIC_RAMP = 0.5;  // seconds to build up / drop off within a train
const PHOTIC_STEP_LEN = PHOTIC_TRAIN + PHOTIC_REST;
const PHOTIC_SERIES = PHOTIC_STEPS.length * PHOTIC_STEP_LEN;

/**
 * Relative driving amplitude at a flash frequency. A Gaussian centred at 14 Hz
 * (width 6) gives the alpha-range optimum and the fall-off past ~25 Hz; the
 * `f^2 / (f^2 + 25)` factor suppresses the low steps, where a normal subject
 * shows little or no driving even though the lamp is flashing.
 */
const drivingGain = (f: number): number =>
  Math.exp(-((f - 14) ** 2) / (2 * 6 ** 2)) * (f * f) / (f * f + 25);

const photic: PatternSourceDescriptor = {
  id: 'photic',
  toggles: ['photic'],
  // Activation procedures are performed on an awake, cooperative patient.
  states: ['awake', 'drowsy'],
  spec: sourceUnder('photic', ['O1', 'O2'], { extent: 0.4 }),
  make() {
    let clock = 0;
    let phase = 0;

    return {
      next(ctx) {
        if (!ctx.enabled) { clock = 0; phase = 0; return 0; }
        clock += ctx.dt;

        const inSeries = clock % PHOTIC_SERIES;
        const step = Math.floor(inSeries / PHOTIC_STEP_LEN);
        const inStep = inSeries - step * PHOTIC_STEP_LEN;
        const freq = PHOTIC_STEPS[step];

        // The lamp is off between trains: no flashes, no driving.
        if (inStep > PHOTIC_TRAIN) return 0;

        // Advance the driving phase only while the train is running, so the
        // response stays locked to the flashes rather than to wall-clock time.
        phase += TWO_PI * freq * ctx.dt;

        // Raised-cosine build-up/drop-off at the edges of the train.
        const ramp = Math.min(
          1,
          inStep / PHOTIC_RAMP,
          (PHOTIC_TRAIN - inStep) / PHOTIC_RAMP,
        );
        const env = 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, ramp));

        // Fundamental plus a second harmonic: harmonic driving is characteristic
        // of a real response, and it is why a 6 Hz flash train can produce
        // visible 12 Hz activity. Normalised so the peak stays ~1.
        const wave = (Math.sin(phase) + 0.35 * Math.sin(2 * phase)) / 1.25;
        return 38 * drivingGain(freq) * env * wave;
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Hyperventilation (HV).
//
// Three minutes of overbreathing drops arterial CO2; the resulting cerebral
// vasoconstriction produces the HV BUILD-UP: generalised, high-voltage rhythmic
// slowing that grows over the procedure and then resolves. Four facts are
// modelled:
//
//  1. It BUILDS gradually and is most marked in the last minute — hence the
//     quadratic envelope rather than a linear ramp or a step.
//  2. It EVOLVES from theta to delta as it deepens. The theta term scales with
//     the envelope and the delta term with its square, so early build-up is
//     theta-dominant and only a full response shows prominent delta.
//  3. It RESOLVES within about a minute of stopping. A normal build-up that
//     persists well beyond that is itself a finding.
//  4. In adults it is FRONTALLY predominant and generalised: one broad source
//     under Fz.
//
// The slowing is built from the engine's own Hopf oscillators, as `gen-slowing`
// is, so it wanders in frequency and amplitude instead of reading as a pair of
// metronomic sines.
//
// A normal build-up is not an abnormality, and the alpha rhythm is attenuated by
// it rather than abolished — so `bandGate` scales alpha down with the envelope
// to a floor of 0.5, unlike `gen-slowing`, which takes the PDR to 0.15 because
// loss of the PDR is the point there.
// ---------------------------------------------------------------------------
const HV_BUILD = 180;    // seconds of overbreathing (the standard 3 minutes)
const HV_RECOVER = 60;   // seconds for the build-up to resolve afterwards
const HV_REST = 30;      // quiet seconds before the procedure is repeated
const HV_CYCLE = HV_BUILD + HV_RECOVER + HV_REST;

const hyperventilation: PatternSourceDescriptor = {
  id: 'hyperventilation',
  toggles: ['hyperventilation'],
  states: ['awake', 'drowsy'],
  spec: sourceUnder('hyperventilation', ['Fz'], { extent: 0.8 }),
  make(seed, dt) {
    const theta = new HopfOscillator(deriveSeed(seed, 'hv-theta'), dt, {
      freq: 5.0, rms: 18, freqWander: 0.8, damping: -2.2,
    });
    const delta = new HopfOscillator(deriveSeed(seed, 'hv-delta'), dt, {
      freq: 2.5, rms: 24, freqWander: 0.5, damping: -1.4,
    });

    let clock = 0;
    let env = 0; // shared with bandGate, which runs after next() each sample

    return {
      next(ctx) {
        // Advance the oscillators every sample so their phase is continuous
        // across the rest interval, exactly as `gen-slowing` does.
        const th = theta.next();
        const de = delta.next();
        if (!ctx.enabled) { clock = 0; env = 0; return 0; }
        clock += ctx.dt;

        const inCycle = clock % HV_CYCLE;
        if (inCycle < HV_BUILD) {
          const u = inCycle / HV_BUILD;
          env = u * u;
        } else if (inCycle < HV_BUILD + HV_RECOVER) {
          const u = (inCycle - HV_BUILD) / HV_RECOVER;
          env = Math.exp(-3 * u);
        } else {
          env = 0;
        }

        return th * env + de * env * env;
      },
      bandGate: () => ({ alpha: 1 - 0.5 * env }),
    };
  },
};

export const ACTIVATION_SOURCES: PatternSourceDescriptor[] = [photic, hyperventilation];

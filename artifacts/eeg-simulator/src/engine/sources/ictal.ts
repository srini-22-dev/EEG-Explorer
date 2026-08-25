/**
 * Ictal / seizure sources — absence, generalised tonic-clonic, focal temporal
 * (with contralateral spread), focal frontal.
 *
 * These are the hardest patterns in the engine: a seizure is not a rhythm, it
 * is a SCRIPTED EVOLUTION — frequency and amplitude change on a clinically
 * specific timeline, and that evolution is the diagnosis (absence = abrupt
 * on/off 3 Hz spike-wave; GTC = recruiting -> clonic slowing -> post-ictal
 * suppression; focal temporal = subtle theta build with late contralateral
 * spread; focal frontal = low-voltage fast onset evolving down in frequency).
 * Flattening any of these into a static rhythm would teach the wrong thing.
 *
 * Each pattern is a CONTINUOUS generator (always advancing, per `registry.ts`)
 * that runs an internal epoch state machine, ported verbatim in its numbers
 * from the legacy `ictalVoltage` (and, for gtc, the `gtc-ictal` branch of
 * `voltageGate`) in the former `utils/eegGenerator.ts` (since removed). That
 * legacy code kept its epoch clock in a module-level `T` map keyed by absolute
 * simulation time; here each
 * generator holds that clock in its own closure instead:
 *
 *  - `clock` accumulates `ctx.dt` while the source is enabled.
 *  - `start` is -1 until the first enabled sample, then it is set to
 *    `clock + <legacy pre-onset delay>` — the exact analogue of the legacy
 *    `if (getT(k) < 0) setT(k, t + delay)`.
 *  - `elapsed = clock - start`, `cycle = elapsed % period` reproduce the
 *    legacy phase math exactly.
 *
 * Disabling the toggle resets `clock`/`start` (and any per-epoch seeded
 * params), so re-enabling always starts a fresh seizure from its pre-onset
 * delay — the same "toggle means fresh event" behaviour `TransientSource`
 * uses for interictal transients, just hand-rolled here because a seizure's
 * state machine has more than one phase.
 *
 * Three settings-driven knobs, read from `ctx` every sample (`registry.ts`):
 *
 *  - `ictalIntensity` is a plain amplitude multiplier on a generator's whole
 *    output — severity changing how strong the discharge is, not the scripted
 *    timeline (frequency evolution, phase durations, post-ictal suppression
 *    depth) that carries the diagnosis.
 *  - `ictalFrequency` multiplies BOTH endpoints of a generator's scripted
 *    frequency sweep. Scaling both together is deliberate: the diagnosis lives
 *    in the proportional slowing across the event, not in the absolute rate, so
 *    the evolution has to survive the knob. It is applied only where a discharge
 *    rate is written down — not to post-ictal delta, which is not a discharge,
 *    and not to any phase duration.
 *  - `ictalHemisphere` selects which side a FOCAL seizure (temporal, frontal)
 *    originates on; absence and GTC are generalised and ignore it. Temporal
 *    and frontal each have a left- and a right-sided source descriptor, and
 *    at each sample the one matching `ictalHemisphere` plays the onset role
 *    while the other plays whatever its non-onset role is (contralateral
 *    spread for temporal, silent for frontal — see below).
 *
 * Every evolving-frequency phase integrates frequency into phase (`sweepPhase`
 * or the legacy inline `cycles = f0*tau - (f0-f1)*tau^2/(2T)` form) rather than
 * `sin(2*pi*f(t)*t)` with a time-varying f — see `sweepPhase`'s comment in
 * `morphology.ts` for why the latter is wrong. All former `Math.random()` calls
 * (epoch durations, muscle noise, post-ictal delta-burst timing) are now seeded
 * draws from a `Gaussian` held in the generator's closure.
 */

import { sourceUnder } from '../forward';
import { Gaussian } from '../rng';
import {
  gaussian,
  multiToneSignal,
  rhythmicSpikeWave,
  sweepPhase,
  THETA_TONES, THETA_TONE_NORM, THETA_TONE_CENTER,
  BETA_TONES, BETA_TONE_NORM, BETA_TONE_CENTER,
  DELTA_TONES, DELTA_TONE_NORM,
} from './morphology';
import type { PatternSourceDescriptor, PatternGenerator } from './registry';
import type { IctalHemisphere } from '../../utils/simTypes';

/** Per-event multiplicative jitter, matching the legacy `jitter(base, frac)`. */
const jit = (g: Gaussian, base: number, frac: number): number =>
  base * (1 + (g.uniform() - 0.5) * 2 * frac);

// ---------------------------------------------------------------------------
// Absence seizure (childhood/juvenile absence epilepsy) — a generalised 3 Hz
// spike-and-wave discharge. Two things are diagnostic and both must survive
// the port: onset and offset are SUDDEN (the "cycle < dur" check simply stops
// the discharge dead — there is no decrescendo), and the discharge is
// frontally predominant. The 3 Hz label is an idealisation: real discharges
// drift down slightly (~3.2 -> ~2.5 Hz) over their course, which is why phase
// is the time-integral of frequency (`cycles`) rather than `cycle % (1/freq)`
// with a moving freq — the latter would make the spike-wave interval visibly
// jump instead of smoothly lengthening. Offset drops straight back to baseline:
// real absence has NO post-ictal slowing, and that instant recovery is itself
// diagnostic — it separates absence from focal and generalised tonic-clonic
// seizures, which DO leave post-ictal attenuation/slowing (see gtc's suppression
// phase below). An earlier port added a ~2 s fading post-ictal delta burst after
// each discharge here; that was a clinical error and has been removed (IK-017).
// Duration (5-15s) is seeded once per epoch onset, as in the legacy code; the
// discharge then repeats every dur+15s while the toggle stays on.
// ---------------------------------------------------------------------------
const ABSENCE_GAP = 15; // seconds of normal background between discharges
const ABSENCE_DELAY = 4; // pre-onset delay after the toggle is enabled

const absenceIctal: PatternSourceDescriptor = {
  id: 'absence-ictal',
  toggles: ['absence-ictal'],
  spec: sourceUnder('absence-ictal', ['Fz'], { extent: 0.7 }),
  make(seed) {
    const g = new Gaussian(seed);
    let clock = 0;
    let start = -1;
    let dur = 10;

    return {
      next(ctx) {
        if (!ctx.enabled) { clock = 0; start = -1; return 0; }
        clock += ctx.dt;
        if (start < 0) {
          start = clock + ABSENCE_DELAY;
          dur = g.range(5, 15);
        }
        const elapsed = clock - start;
        if (elapsed < 0) return 0;

        const cycle = elapsed % (dur + ABSENCE_GAP);
        if (cycle < dur) {
          // Both sweep endpoints carry the same multiplier, so the discharge
          // still slows by the same PROPORTION over its course whatever rate the
          // slider picks. `cycles` is the time-integral of `freqNow`, so it takes
          // the multiplier too — scaling one without the other would desynchronise
          // phase from the spike-wave interval.
          const F = ctx.ictalFrequency;
          const freqNow = F * (3.2 - (cycle / dur) * 0.7); // slows 3.2 -> ~2.5 Hz
          const cycleLen = 1 / freqNow;
          const cycles = F * (3.2 * cycle - 0.7 * cycle * cycle / (2 * dur));
          const dt = (cycles % 1) * cycleLen;
          return ctx.ictalIntensity * rhythmicSpikeWave(dt, cycleLen, 220, 220 * 0.7);
        }
        // No post-ictal fade: absence returns instantly to baseline (IK-017).
        return 0;
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Generalised tonic-clonic (GTC) seizure — the full ~105s scripted evolution:
//
//  1. cycle < 4s   — recruiting crescendo: a fast (beta) rhythm building as the
//                    discharge generalises (electrographic correlate of tonic
//                    stiffening).
//  2. cycle < 18s  — clonic phase: rhythmic spike-wave SLOWING 3 Hz -> 1.5 Hz
//                    as the jerks slow and space out, amplitude rising. Phase
//                    is the integral of frequency over the phase (`cycles`),
//                    not frequency*time.
//  3. cycle < 35s  — decrescendo/attenuation as the seizure ends.
//  4. cycle < 50s  — POST-ICTAL SUPPRESSION: real post-ictal EEG is
//                    attenuated, not silent or instantly normal, so `gate()`
//                    scales the ongoing background down to 8% while sparse,
//                    low-amplitude delta bursts (seeded scheduler, mirroring
//                    the legacy `nextEventTime`) ride on top of that near-flat
//                    trace.
//  5. cycle < 70s  — gradual recovery: `gate()` ramps 0.08 -> 1.0 as delta
//                    grows back in.
//
// `next()` and `gate()` share the same `clock`/`start` closure variables, so
// the suppression window lines up exactly with the generator's own phases.
// This is safe because the engine calls `next(ctx)` then `gate(ctx)` for the
// same sample (see `engine.ts`), so `gate()` reads state `next()` already
// advanced this sample.
// ---------------------------------------------------------------------------
const GTC_PERIOD = 105;
const GTC_DELAY = 6;

const gtcIctal: PatternSourceDescriptor = {
  id: 'gtc-ictal',
  toggles: ['gtc-ictal'],
  spec: sourceUnder('gtc-ictal', ['Fz'], { extent: 0.7 }),
  make(seed) {
    const g = new Gaussian(seed);
    let clock = 0;
    let start = -1;
    // Post-ictal sparse delta-burst scheduler (mirrors legacy `nextEventTime`).
    let pidOnset = -1;
    let pidNext = -1;
    let pidAmp = 1;

    const reset = () => { clock = 0; start = -1; pidOnset = -1; pidNext = -1; };

    return {
      next(ctx) {
        if (!ctx.enabled) { reset(); return 0; }
        clock += ctx.dt;
        if (start < 0) start = clock + GTC_DELAY;
        const el2 = clock - start;
        if (el2 < 0) return 0;

        const cycle = el2 % GTC_PERIOD;

        const I = ctx.ictalIntensity;
        if (cycle < 4) {
          const env = Math.pow(cycle / 4, 2);
          return I * env * 30 * multiToneSignal(el2, BETA_TONES, BETA_TONE_NORM, 0, 1.2);
        }
        if (cycle < 18) {
          const tau = cycle - 4;
          const pos = tau / 14;
          const F = ctx.ictalFrequency;
          const freqNow = F * (3 - pos * 1.5); // slows 3 -> 1.5 Hz
          const cycles = F * (3 * tau - 1.5 * tau * tau / 28);
          const cycleLen = 1 / freqNow;
          const amp = 100 + pos * 100;
          let v = rhythmicSpikeWave((cycles % 1) * cycleLen, cycleLen, amp, amp * 0.6);
          v += amp * 0.3 * multiToneSignal(el2, DELTA_TONES, DELTA_TONE_NORM);
          return I * v;
        }
        if (cycle < 35) {
          const env = 1 - (cycle - 18) / 17;
          return I * env * 120 * multiToneSignal(el2, DELTA_TONES, DELTA_TONE_NORM, -0.5);
        }
        if (cycle < 50) {
          if (pidNext < 0 || clock >= pidNext) {
            pidOnset = clock;
            pidAmp = jit(g, 1, 0.3);
            pidNext = clock + 2 + g.exponential(1); // legacy nextEventTime(2,4)
          }
          const dtb = clock - pidOnset;
          if (dtb >= 0 && dtb < 1.2) {
            return I * 25 * pidAmp * gaussian(dtb, 0.5, 0.3) * multiToneSignal(dtb, DELTA_TONES, DELTA_TONE_NORM);
          }
          return 0;
        }
        if (cycle < 70) {
          const pos = (cycle - 50) / 20;
          return I * pos * 30 * multiToneSignal(el2, DELTA_TONES, DELTA_TONE_NORM);
        }
        return 0;
      },
      gate(ctx) {
        if (!ctx.enabled || start < 0) return 1;
        const el2 = clock - start;
        if (el2 < 0) return 1;
        const cycle = el2 % GTC_PERIOD;
        if (cycle >= 35 && cycle < 50) return 0.08;
        if (cycle >= 50 && cycle < 70) return 0.08 + 0.92 * ((cycle - 50) / 20);
        return 1;
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Focal (temporal lobe) seizure — onset side selectable via `ctx.ictalHemisphere`
// (§ header). The onset is deliberately SUBTLE: rhythmic theta barely above
// background that builds to full amplitude across the active window — exactly
// what makes a real temporal seizure onset easy to miss and worth teaching.
// Frequency evolves 6 Hz -> 3.5 Hz across the same window via `sweepPhase`
// (never `sin(2*pi*f(t)*t)` with a moving f). An onset seizure classically
// spreads to the contralateral temporal region only once it is established,
// not from the first second: modelled as a SECOND descriptor under the other
// side's electrode, same toggle, lower amplitude, whose gain stays at 0 for
// the first half of the active window and then ramps in. Both descriptors run
// the same fixed (non-random) timeline, so — with no RNG in either — they
// stay in lock-step as one seizure seen from two electrodes; only which one
// is playing the onset role swaps with `ictalHemisphere`.
// ---------------------------------------------------------------------------
const FTEMP_PERIOD = 90;
const FTEMP_ACTIVE = 30;
const FTEMP_DELAY = 5;
const FTEMP_AMP_ONSET = 120;
const FTEMP_AMP_SPREAD = 60;

function ftempGenerator(side: IctalHemisphere) {
  return (): PatternGenerator => {
    let clock = 0;
    let start = -1;
    return {
      next(ctx) {
        if (!ctx.enabled) { clock = 0; start = -1; return 0; }
        clock += ctx.dt;
        if (start < 0) start = clock + FTEMP_DELAY;
        const el2 = clock - start;
        if (el2 < 0) return 0;
        const cycle = el2 % FTEMP_PERIOD;
        if (cycle >= FTEMP_ACTIVE) return 0;

        const pos = cycle / FTEMP_ACTIVE;
        // Whichever side matches the selected onset hemisphere plays the onset
        // role (present from the start, scaled by the subtle amplitude build);
        // the other plays contralateral spread — silent until the halfway
        // point, then ramping in at lower amplitude.
        const isOnset = ctx.ictalHemisphere === side;
        const ampPeak = isOnset ? FTEMP_AMP_ONSET : FTEMP_AMP_SPREAD;
        const spreadFactor = isOnset ? 1.0 : Math.max(0, (pos - 0.5) * 2);
        const amp = ctx.ictalIntensity * ampPeak * (0.1 + 0.9 * pos) * spreadFactor;
        const F = ctx.ictalFrequency;
        const phase = sweepPhase(cycle, 6 * F, 3.5 * F, FTEMP_ACTIVE, THETA_TONE_CENTER);
        return amp * multiToneSignal(phase, THETA_TONES, THETA_TONE_NORM);
      },
    };
  };
}

const focalTemporalL: PatternSourceDescriptor = {
  id: 'focal-temporal-ictal-l',
  toggles: ['focal-temporal-ictal'],
  spec: sourceUnder('focal-temporal-ictal-l', ['T3'], { extent: 0.35 }),
  make: ftempGenerator('left'),
};

const focalTemporalR: PatternSourceDescriptor = {
  id: 'focal-temporal-ictal-r',
  toggles: ['focal-temporal-ictal'],
  spec: sourceUnder('focal-temporal-ictal-r', ['T4'], { extent: 0.35 }),
  make: ftempGenerator('right'),
};

// ---------------------------------------------------------------------------
// Focal (frontal lobe) seizure — onset side selectable via `ctx.ictalHemisphere`,
// same convention as the temporal pair above. LOW-VOLTAGE FAST onset is the
// diagnostic hallmark of frontal lobe epilepsy: a near-invisible ~18 Hz beta
// rhythm that builds in amplitude while its frequency evolves DOWN to ~3 Hz
// (again via `sweepPhase`, never `sin(2*pi*f(t)*t)` with a moving f). Short
// and explosive — ~15s active out of a 70s cycle — unlike the temporal
// seizure's slower build. Frontal seizures characteristically produce
// movement (hypermotor/tonic posturing), so a small muscle/movement
// contamination term grows in step with the seizure; the legacy code drew
// this from unseeded `Math.random()` every sample, ported here to a held
// `Gaussian` stream so the recording stays reproducible from its seed.
//
// Unlike the temporal pair, frontal seizures are NOT modelled with spread to
// the other side — the non-onset descriptor stays fully silent rather than
// ramping in at reduced amplitude, since this engine has no frontal-spread
// timeline to script. Two descriptors (F3, F4) exist only so a source is
// available under either hemisphere; only the one matching `ictalHemisphere`
// ever produces output.
// ---------------------------------------------------------------------------
const FFRONT_PERIOD = 70;
const FFRONT_ACTIVE = 15;
const FFRONT_DELAY = 5;

function ffrontGenerator(side: IctalHemisphere) {
  return (seed: number): PatternGenerator => {
    const g = new Gaussian(seed);
    let clock = 0;
    let start = -1;
    return {
      next(ctx) {
        if (!ctx.enabled || ctx.ictalHemisphere !== side) { clock = 0; start = -1; return 0; }
        clock += ctx.dt;
        if (start < 0) start = clock + FFRONT_DELAY;
        const el2 = clock - start;
        if (el2 < 0) return 0;
        const cycle = el2 % FFRONT_PERIOD;
        if (cycle >= FFRONT_ACTIVE) return 0;

        const pos = cycle / FFRONT_ACTIVE;
        const amp = 100 * (0.1 + 0.9 * pos);
        const F = ctx.ictalFrequency;
        const phase = sweepPhase(cycle, 18 * F, 3 * F, FFRONT_ACTIVE, BETA_TONE_CENTER);
        let v = amp * multiToneSignal(phase, BETA_TONES, BETA_TONE_NORM);
        v += 30 * pos * (g.uniform() - 0.5); // seeded muscle/movement contamination
        return ctx.ictalIntensity * v;
      },
    };
  };
}

const focalFrontalL: PatternSourceDescriptor = {
  id: 'focal-frontal-ictal-l',
  toggles: ['focal-frontal-ictal'],
  spec: sourceUnder('focal-frontal-ictal-l', ['F3'], { extent: 0.4 }),
  make: ffrontGenerator('left'),
};

const focalFrontalR: PatternSourceDescriptor = {
  id: 'focal-frontal-ictal-r',
  toggles: ['focal-frontal-ictal'],
  spec: sourceUnder('focal-frontal-ictal-r', ['F4'], { extent: 0.4 }),
  make: ffrontGenerator('right'),
};

export const ICTAL_SOURCES: PatternSourceDescriptor[] = [
  absenceIctal,
  gtcIctal,
  focalTemporalL,
  focalTemporalR,
  focalFrontalL,
  focalFrontalR,
];

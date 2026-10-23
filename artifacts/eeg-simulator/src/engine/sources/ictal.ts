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

import { sourceUnder, sourceBetween, synchronousPatches } from '../forward';
import { Gaussian } from '../rng';
import { markQueue } from './transient';
import { ARTIFACT_SOURCES, EmgGenerator } from '../artifacts';
import { GENERALIZED_FRONTAL, MID_TEMPORAL_REGIONAL, ANTERIOR_TEMPORAL_REGIONAL, mirrored } from './fields';
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
import type { IctalHemisphere, FocalPlacement } from '../../utils/simTypes';

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
const ABSENCE_DELAY = 4; // pre-onset delay after the toggle is enabled, unless ctx.ictalDelay sets one

const absenceIctal: PatternSourceDescriptor = {
  id: 'absence-ictal',
  toggles: ['absence-ictal'],
  // Generalized and frontally predominant: on every chain, largest across the
  // frontal row (fields.ts). One patch under Fz drew a frontal-midline focus.
  spec: synchronousPatches('absence-ictal', GENERALIZED_FRONTAL, { extent: 0.3 }),
  make(seed) {
    const g = new Gaussian(seed);
    let clock = 0;
    let start = -1;
    let dur = 10;
    let lastCycle = Infinity;
    const spans = markQueue();  // a seizure's phases, reported as each begins, with its length

    return {
      takeMarks: () => spans.take(),
      next(ctx) {
        if (!ctx.enabled) { clock = 0; start = -1; lastCycle = Infinity; spans.clear(); return 0; }
        clock += ctx.dt;
        if (start < 0) {
          start = clock + (ctx.ictalDelay ?? ABSENCE_DELAY);
          dur = g.range(5, 15);
        }
        const elapsed = clock - start;
        if (elapsed < 0) return 0;

        const cycle = elapsed % (dur + ABSENCE_GAP);
        if (cycle < lastCycle) spans.push({ label: 'Absence seizure', span: dur });
        lastCycle = cycle;
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
          // 360 uV at the source's own maximum: the legacy 220 scaled to hold Fz
          // where the single patch put it (~190 uV against infinity).
          return ctx.ictalIntensity * rhythmicSpikeWave(dt, cycleLen, 360, 360 * 0.7);
        }
        // No post-ictal fade: absence returns instantly to baseline (IK-017).
        return 0;
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Generalised tonic-clonic (GTC) seizure — a scripted evolution, at about the
// length of a real one. Durations in adults (video-EEG series, PMC3799796): tonic
// phase 10.5 +- 3.6 s, clonic 49 +- 27 s, post-ictal generalized suppression
// 39 +- 24 s, then a recovery of about two minutes, which alone is shortened here.
//
//  1. TONIC, 10 s     — a fast (beta) rhythm, there from the first sample and
//                       building as the discharge generalises: the electrographic
//                       correlate of tonic stiffening.
//  2. CLONIC, 45 s    — rhythmic spike-wave SLOWING 3 Hz -> 1.5 Hz as the jerks
//                       slow and space out, amplitude rising. Phase is the
//                       integral of frequency over the phase (`cycles`), not
//                       frequency*time. The last second fades, so the seizure
//                       stops on a wave rather than part-way up one.
//  3. SUPPRESSED, 35 s — POST-ICTAL SUPPRESSION: real post-ictal EEG is
//                       attenuated, not silent or instantly normal, so `gate()`
//                       scales the ongoing background down to 8% while sparse,
//                       low-amplitude delta bursts ride on that near-flat trace.
//  4. RECOVERY, 30 s  — `gate()` ramps 0.08 -> 1.0 as delta grows back in.
//
// Until 2026-10-13 this was 4 s of fast activity, 14 s of clonic and 17 s of a
// fading delta "decrescendo" that no source describes — a seizure under half the
// length of a real one, and over before a reader had watched it slow.
//
// `next()` and `gate()` share the same `clock`/`start` closure variables, so
// the suppression window lines up exactly with the generator's own phases.
// This is safe because the engine calls `next(ctx)` then `gate(ctx)` for the
// same sample (see `engine.ts`), so `gate()` reads state `next()` already
// advanced this sample.
// ---------------------------------------------------------------------------
const GTC_TONIC = 10;
const GTC_CLONIC = 45;
const GTC_SUPPRESSED = 35;
const GTC_RECOVERY = 30;
const GTC_CLONIC_END = GTC_TONIC + GTC_CLONIC;
const GTC_SUPPRESSED_END = GTC_CLONIC_END + GTC_SUPPRESSED;
const GTC_RECOVERY_END = GTC_SUPPRESSED_END + GTC_RECOVERY;
const GTC_PERIOD = GTC_RECOVERY_END + 40; // 40 s of ordinary record before the next
const GTC_DELAY = 6;

const gtcIctal: PatternSourceDescriptor = {
  id: 'gtc-ictal',
  toggles: ['gtc-ictal'],
  // A generalised tonic-clonic seizure is on every chain. This was one patch,
  // first under Fz and then across Fz and Cz (extent 0.95) to make its field reach
  // Cz as IK-019 asserts; either way it drew a midline focus — Cz-Pz carried it,
  // the parasagittal rows under half of that and the temporal chains 6-18%. The
  // generalized frontal field (fields.ts) puts it on every row and reaches Cz at
  // 0.58 of Fz without widening anything.
  spec: synchronousPatches('gtc-ictal', GENERALIZED_FRONTAL, { extent: 0.3 }),
  make(seed) {
    const g = new Gaussian(seed);
    let clock = 0;
    let start = -1;
    // Post-ictal sparse delta-burst scheduler (mirrors legacy `nextEventTime`).
    let pidOnset = -1;
    let pidNext = -1;
    let pidAmp = 1;

    let phase = -1;
    const spans = markQueue();  // a seizure's phases, reported as each begins, with its length
    const reset = () => { clock = 0; start = -1; pidOnset = -1; pidNext = -1; phase = -1; spans.clear(); };

    return {
      takeMarks: () => spans.take(),
      next(ctx) {
        if (!ctx.enabled) { reset(); return 0; }
        clock += ctx.dt;
        if (start < 0) start = clock + (ctx.ictalDelay ?? GTC_DELAY);
        const el2 = clock - start;
        if (el2 < 0) return 0;

        const cycle = el2 % GTC_PERIOD;
        const nowPhase = cycle < GTC_TONIC ? 0 : cycle < GTC_CLONIC_END ? 1 : cycle < GTC_SUPPRESSED_END ? 2 : 3;
        if (nowPhase !== phase) {
          if (nowPhase === 0) spans.push({ label: 'Tonic phase', span: GTC_TONIC });
          if (nowPhase === 1) spans.push({ label: 'Clonic phase', span: GTC_CLONIC });
          if (nowPhase === 2) spans.push({ label: 'Post-ictal suppression', span: GTC_SUPPRESSED });
          phase = nowPhase;
        }

        // The legacy amplitudes below were written for a patch whose strongest
        // electrode sat at ~0.75 of the source; the generalized field's sits at
        // 0.52, so 1.45 holds the midline where it was.
        const I = ctx.ictalIntensity * 1.45;
        if (cycle < GTC_TONIC) {
          // The fast rhythm is there from the first sample, at a little under half the
          // size it builds to: low-voltage fast activity that recruits. It used to grow
          // from nothing (the square of time alone) to 30 uV at the source, which put
          // 1 mm of it on no row of the double banana until 3.2 s into a 4 s phase —
          // the seizure had no onset a reader could point to, and seemed to begin with
          // the clonic phase (2026-10-13 timing audit). 45 uV and a floor of 0.45 put
          // 1 mm on the frontal rows at onset and about twice that by the end.
          const env = 0.45 + 0.55 * Math.pow(cycle / GTC_TONIC, 2);
          return I * env * 45 * multiToneSignal(el2, BETA_TONES, BETA_TONE_NORM, 0, 1.2);
        }
        if (cycle < GTC_CLONIC_END) {
          const tau = cycle - GTC_TONIC;
          const pos = tau / GTC_CLONIC;
          const F = ctx.ictalFrequency;
          const freqNow = F * (3 - pos * 1.5); // slows 3 -> 1.5 Hz
          const cycles = F * (3 * tau - 1.5 * tau * tau / (2 * GTC_CLONIC));
          const cycleLen = 1 / freqNow;
          const amp = (100 + pos * 100) * Math.min(1, GTC_CLONIC - tau);
          let v = rhythmicSpikeWave((cycles % 1) * cycleLen, cycleLen, amp, amp * 0.6);
          v += amp * 0.3 * multiToneSignal(el2, DELTA_TONES, DELTA_TONE_NORM);
          return I * v;
        }
        if (cycle < GTC_SUPPRESSED_END) {
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
        if (cycle < GTC_RECOVERY_END) {
          const pos = (cycle - GTC_SUPPRESSED_END) / GTC_RECOVERY;
          return I * pos * 30 * multiToneSignal(el2, DELTA_TONES, DELTA_TONE_NORM);
        }
        return 0;
      },
      gate(ctx) {
        if (!ctx.enabled || start < 0) return 1;
        const el2 = clock - start;
        if (el2 < 0) return 1;
        const cycle = el2 % GTC_PERIOD;
        if (cycle >= GTC_CLONIC_END && cycle < GTC_SUPPRESSED_END) return 0.08;
        if (cycle >= GTC_SUPPRESSED_END && cycle < GTC_RECOVERY_END) {
          return 0.08 + 0.92 * ((cycle - GTC_SUPPRESSED_END) / GTC_RECOVERY);
        }
        return 1;
      },
    };
  },
};

// ---------------------------------------------------------------------------
// The tonic-clonic seizure's muscle.
//
// learningeeg (Seizures): the tonic phase "clinically appears as stiffening and
// on EEG appears as significant and usually diffuse myogenic artifact"; then
// "the tracing evolves into intermittent bursts of spike / polyspike and slow
// waves, with each spike burst corresponding to the clonic jerks". So the muscle
// is continuous while the patient is stiff, comes as a burst with each jerk and
// lets go between them, and is gone once the seizure stops.
//
// Four sources — both temporalis, frontalis and the nuchal muscles, the artifact
// block's own (`ARTIFACT_SOURCES`) — each with its own motor-unit noise, all on
// the seizure's timeline. They share no clock with the seizure: each works the
// same phases out of the same constants, as the two sides of the temporal
// seizure do.
//
// Size: GTC_EMG_RMS_UV at each muscle, the figure a chew uses (artifactsPatterns,
// CHEW_EMG_RMS_UV, "a forceful contraction"). Neither number has a source. A
// tonic contraction is at least as forceful as a chew; it is there to be tested
// against a reference, not defended.
//
// It is an option (`PatternOptions.seizureMuscle`), because the muscle buries the
// very rhythm the seizure is defined by: with it off the page shows the discharge
// alone. The app has it on. A script that does not ask for it gets the discharge
// alone, which is what every check on the seizure's own field and rhythm reads.
// ---------------------------------------------------------------------------
const GTC_EMG_RMS_UV = 35;
// The part of each spike-wave cycle the jerk's burst of muscle fills: about the
// spike (0.42 of the way through, see rhythmicSpikeWave), a third of the cycle
// wide — 0.12 s at 3 Hz, 0.23 s at 1.5 Hz.
const GTC_JERK_FROM = 0.25;
const GTC_JERK_TO = 0.6;

function gtcMuscle(seed: number, dt: number): PatternGenerator {
  const emg = new EmgGenerator(seed, dt);
  let clock = 0;
  let start = -1;
  return {
    next(ctx) {
      const fuzz = emg.next(); // every sample: no stale noise when the muscle comes back
      if (!ctx.enabled) { clock = 0; start = -1; return 0; }
      clock += ctx.dt;
      if (start < 0) start = clock + (ctx.ictalDelay ?? GTC_DELAY);
      const el2 = clock - start;
      if (el2 < 0 || !ctx.seizureMuscle) return 0;
      const cycle = el2 % GTC_PERIOD;
      let env = 0;
      if (cycle < GTC_TONIC) {
        // Stiffening: there from the first sample and building, like the fast
        // rhythm under it.
        env = 0.4 + 0.6 * cycle / GTC_TONIC;
      } else if (cycle < GTC_CLONIC_END) {
        const tau = cycle - GTC_TONIC;
        const phase = (ctx.ictalFrequency * (3 * tau - 1.5 * tau * tau / (2 * GTC_CLONIC))) % 1;
        if (phase > GTC_JERK_FROM && phase < GTC_JERK_TO) {
          env = Math.sin(Math.PI * (phase - GTC_JERK_FROM) / (GTC_JERK_TO - GTC_JERK_FROM))
            * Math.min(1, GTC_CLONIC - tau);
        }
      }
      return env > 0 ? ctx.ictalIntensity * GTC_EMG_RMS_UV * env * fuzz : 0;
    },
  };
}

const gtcMuscles: PatternSourceDescriptor[] = (['temporalisL', 'temporalisR', 'frontalis', 'nuchal'] as const)
  .map((m): PatternSourceDescriptor => ({
    id: `gtc-emg-${m}`,
    toggles: ['gtc-ictal'],
    spec: { ...ARTIFACT_SOURCES[m], id: `gtc-emg-${m}` },
    make: (seed, dt) => gtcMuscle(seed, dt),
  }));

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
//
// Each side also has a second placement (`FocalPlacement`, the Focus option the
// focal spikes have too): midway between the temporal electrode and the one in
// front of it, F7 and T3 on the left. The seizure then holds the F7-T3 link flat
// — an isopotential — for its whole course, with Fp1-F7 and T3-T5 opposed, where
// the under-the-electrode seizure holds a phase reversal at T3 (IK-003, IK-004).
// Only the pair at the chosen placement runs.
//
// Both placements are regional fields fitted to learningeeg's left temporal
// seizure (fields.ts, MID_ and ANTERIOR_TEMPORAL_REGIONAL), mirrored for the
// right. Until 2026-10-13 each was a single patch: under T3 it left F7 and T5
// with a quarter and a sixth of T3's voltage, a seizure on two rows.
// ---------------------------------------------------------------------------
const FTEMP_PERIOD = 90;
const FTEMP_ACTIVE = 30;
const FTEMP_DELAY = 5;
const FTEMP_AMP_ONSET = 120;
const FTEMP_AMP_SPREAD = 60;

function ftempGenerator(side: IctalHemisphere, placement: FocalPlacement) {
  return (): PatternGenerator => {
    let clock = 0;
    let start = -1;
    let lastCycle = Infinity;
    const spans = markQueue();  // a seizure's phases, reported as each begins, with its length
    return {
      takeMarks: () => spans.take(),
      next(ctx) {
        if (!ctx.enabled || ctx.focalPlacement !== placement) {
          clock = 0; start = -1; lastCycle = Infinity; spans.clear(); return 0;
        }
        clock += ctx.dt;
        if (start < 0) start = clock + (ctx.ictalDelay ?? FTEMP_DELAY);
        const el2 = clock - start;
        if (el2 < 0) return 0;
        const cycle = el2 % FTEMP_PERIOD;
        // The onset side reports the seizure; the other side is its later spread.
        if (cycle < lastCycle && ctx.ictalHemisphere === side) spans.push({ label: 'Focal temporal seizure', span: FTEMP_ACTIVE });
        lastCycle = cycle;
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
  spec: synchronousPatches('focal-temporal-ictal-l', MID_TEMPORAL_REGIONAL, { extent: 0.3 }),
  make: ftempGenerator('left', 'under'),
};

const focalTemporalR: PatternSourceDescriptor = {
  id: 'focal-temporal-ictal-r',
  toggles: ['focal-temporal-ictal'],
  spec: synchronousPatches('focal-temporal-ictal-r', mirrored(MID_TEMPORAL_REGIONAL), { extent: 0.3 }),
  make: ftempGenerator('right', 'under'),
};

const focalTemporalBetweenL: PatternSourceDescriptor = {
  id: 'focal-temporal-ictal-l-between',
  toggles: ['focal-temporal-ictal'],
  spec: synchronousPatches('focal-temporal-ictal-l-between', ANTERIOR_TEMPORAL_REGIONAL, { extent: 0.3 }),
  make: ftempGenerator('left', 'between'),
};

const focalTemporalBetweenR: PatternSourceDescriptor = {
  id: 'focal-temporal-ictal-r-between',
  toggles: ['focal-temporal-ictal'],
  spec: synchronousPatches('focal-temporal-ictal-r-between', mirrored(ANTERIOR_TEMPORAL_REGIONAL), { extent: 0.3 }),
  make: ftempGenerator('right', 'between'),
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
// ever produces output. As with the temporal seizure, each side has a second
// placement midway between two electrodes — F3 and C3 on the left — which holds
// F3-C3 flat and Fp1-F3 and C3-P3 opposed.
// ---------------------------------------------------------------------------
const FFRONT_PERIOD = 70;
const FFRONT_ACTIVE = 15;
const FFRONT_DELAY = 5;

function ffrontGenerator(side: IctalHemisphere, placement: FocalPlacement) {
  return (seed: number): PatternGenerator => {
    const g = new Gaussian(seed);
    let clock = 0;
    let start = -1;
    let lastCycle = Infinity;
    const spans = markQueue();  // a seizure's phases, reported as each begins, with its length
    return {
      takeMarks: () => spans.take(),
      next(ctx) {
        if (!ctx.enabled || ctx.ictalHemisphere !== side || ctx.focalPlacement !== placement) {
          clock = 0; start = -1; lastCycle = Infinity; spans.clear(); return 0;
        }
        clock += ctx.dt;
        if (start < 0) start = clock + (ctx.ictalDelay ?? FFRONT_DELAY);
        const el2 = clock - start;
        if (el2 < 0) return 0;
        const cycle = el2 % FFRONT_PERIOD;
        if (cycle < lastCycle) spans.push({ label: 'Focal frontal seizure', span: FFRONT_ACTIVE });
        lastCycle = cycle;
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
  make: ffrontGenerator('left', 'under'),
};

const focalFrontalR: PatternSourceDescriptor = {
  id: 'focal-frontal-ictal-r',
  toggles: ['focal-frontal-ictal'],
  spec: sourceUnder('focal-frontal-ictal-r', ['F4'], { extent: 0.4 }),
  make: ffrontGenerator('right', 'under'),
};

const focalFrontalBetweenL: PatternSourceDescriptor = {
  id: 'focal-frontal-ictal-l-between',
  toggles: ['focal-frontal-ictal'],
  spec: sourceBetween('focal-frontal-ictal-l-between', 'C3', 'F3', 0.4),
  make: ffrontGenerator('left', 'between'),
};

const focalFrontalBetweenR: PatternSourceDescriptor = {
  id: 'focal-frontal-ictal-r-between',
  toggles: ['focal-frontal-ictal'],
  spec: sourceBetween('focal-frontal-ictal-r-between', 'C4', 'F4', 0.4),
  make: ffrontGenerator('right', 'between'),
};

export const ICTAL_SOURCES: PatternSourceDescriptor[] = [
  absenceIctal,
  gtcIctal,
  ...gtcMuscles,
  focalTemporalL,
  focalTemporalR,
  focalFrontalL,
  focalFrontalR,
  focalTemporalBetweenL,
  focalTemporalBetweenR,
  focalFrontalBetweenL,
  focalFrontalBetweenR,
];

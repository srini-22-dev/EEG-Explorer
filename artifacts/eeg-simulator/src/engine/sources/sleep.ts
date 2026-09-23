/**
 * Sleep architecture sources — POSTS, vertex (V) waves, K-complexes, spindles,
 * roving and rapid eye movements.
 *
 * These are the grapho-elements that *define* the stages of sleep, so each is
 * `stateIntrinsic`: it appears whenever the patient is in the relevant stage,
 * and its toggle is an additional way to force it (e.g. to show a spindle in
 * isolation). See `registry.ts` for that gating rule.
 *
 * The transients are `TransientSource`s: a seeded scheduler fires a morphology
 * waveform every so often and returns 0 between events. The scalar each returns
 * is the microvolt value at the source's strongest electrode; the leadfield
 * column spreads it across the scalp.
 *
 * Rebuilt 2026-09-11 against the sources below (see SLEEP-ARCHITECTURE-AUDIT.md
 * for the measurements behind each change). Every geometry is now a group of
 * co-active cortical patches (`synchronousPatches`) at one depth below the
 * scalp: these graphoelements are regional and bilateral, and a single patch in
 * this forward model cannot produce a regional field. Measured before the
 * change, with single patches: the vertex wave reached 48 uV on Fz-Cz but ~1 uV
 * on F3-C3 and C3-P3; the spindle 70 uV on Fz-Cz and <2 uV on every
 * parasagittal row; the K-complex 215 uV on Cz-Pz but 4.7 uV on Fz-Cz (it sat
 * midway between Fz and Cz, so the link spanning it cancelled); and POSTS put 67%
 * of their P3-O1 deflection onto C3-P3.
 *
 * Sources: learningeeg.com Normal Asleep (LE); AASM Scoring Manual v2.0
 * (AASM); StatPearls Normal EEG Waveforms, NBK539805 (SP); Neupsy Key, Positive
 * Occipital Sharp Transients of Sleep (NPK); Colrain 2005, Sleep 28:255 (COL);
 * healthy-adult spindle norms, PMC12172134 (SPN).
 */

import { synchronousPatches } from '../forward';
import { Gaussian } from '../rng';
import { TransientSource } from './transient';
import { gaussian } from './morphology';
import type { PatternSourceDescriptor, PatternGenerator } from './registry';

/** Per-event multiplicative jitter: base * (1 +- frac). */
const jit = (g: Gaussian, base: number, frac: number): number =>
  base * (1 + (g.uniform() - 0.5) * 2 * frac);

/** Uniform draw in [lo, hi). */
const between = (g: Gaussian, lo: number, hi: number): number => lo + (hi - lo) * g.uniform();

/** Wrap a `TransientSource` as a `PatternGenerator` (gate its output on `ctx.enabled`). */
const asGenerator = <E>(ts: TransientSource<E>): PatternGenerator => ({
  next: (ctx) => ts.next(ctx.enabled),
});

const TWO_PI = 2 * Math.PI;

/** Half-Gaussian on each side of `mu`, with separate widths: a rise and a fall. */
const skewGauss = (t: number, mu: number, sRise: number, sFall: number): number =>
  gaussian(t, mu, t < mu ? sRise : sFall);

// ---------------------------------------------------------------------------
// Sleep spindle — one burst.
//
// AASM: "a train of distinct waves" at 11-16 Hz lasting >= 0.5 s. A train of
// distinct waves is ONE frequency, so each burst is a single carrier under a
// waxing-waning (raised-cosine) envelope. The old generator summed three
// incoherent tones (12.3/13.5/14.8 Hz), which beat against each other: a 1 s
// "spindle" carried an internal amplitude dip every ~0.8 s and read as two short
// bursts rather than one spindle.
//
// `dur` is the whole envelope; its visible part (above ~10% of peak) is the
// middle 80%, so dur 0.8-1.6 s gives visible spindles of 0.6-1.3 s — SPN's
// 90% range for healthy adults is 0.8-1.1 s, AASM's floor 0.5 s.
// ---------------------------------------------------------------------------
function spindleBurst(t: number, dur: number, freq: number, phase: number): number {
  if (t < 0 || t >= dur) return 0;
  const env = Math.sin(Math.PI * t / dur) ** 2;
  return env * Math.sin(TWO_PI * freq * t + phase);
}

// ---------------------------------------------------------------------------
// Vertex (V) waves.
//
// SP: surface-negative sharp waves phase-reversing at or near the vertex, the
// negative wave typically ~100 ms; often triphasic on close inspection (a small
// positive wave before and after the large negative one). AASM: sharply
// contoured, < 0.5 s, maximal centrally. LE: bilateral, phase-reversing over the
// central regions, alone or in runs of varying amplitude and morphology; its
// figure caption puts the wave over the parasagittal AND central chains. Adult
// amplitude is usually 100-150 uV (Niedermeyer, as cited by SP-derived texts).
//
// Morphology: the negative wave is a skewed Gaussian, rise sigma 26 ms and fall
// 33 ms — a 10%-of-peak base of ~127 ms and a half-amplitude width of ~69 ms,
// i.e. the "~100 ms" negative wave — with a small positive wave 75 ms before
// (12%) and a larger slower one 130 ms after (28%). The whole element spans
// ~0.35 s, inside AASM's 0.5 s.
//
// Field: Cz with both central regions and, less, Fz/Pz — measured on the
// double banana it gives F3-C3/C3-P3 ~85% of Fz-Cz/Cz-Pz, reversing at C3 and
// C4 as well as Cz, and almost nothing on the temporal chains.
// ---------------------------------------------------------------------------
type VEvent = { onsets: number[]; amps: number[]; widths: number[] };

const VWAVE_PEAK_UV = 115;
const VWAVE_MAX_RUN = 3;

function vertexElement(t: number, amp: number, w: number): number {
  const tp = 0.12 * w;   // negative peak, seconds after the element starts
  const pre = 0.12 * gaussian(t, tp - 0.075 * w, 0.022 * w);
  const neg = -skewGauss(t, tp, 0.026 * w, 0.033 * w);
  const post = 0.28 * gaussian(t, tp + 0.13 * w, 0.05 * w);
  return amp * (pre + neg + post);
}

const vWave: PatternSourceDescriptor = {
  id: 'vwave',
  toggles: ['v-waves'],
  states: ['n1', 'n2'],
  stateIntrinsic: true,
  spec: synchronousPatches('vwave', { Cz: 1, C3: 0.6, C4: 0.6, Fz: 0.45, Pz: 0.45 }, { extent: 0.3 }),
  make(seed, dt) {
    const ts = new TransientSource<VEvent>(seed, dt, {
      schedule: { kind: 'periodic', period: 8, jitterFrac: 0.4 },
      // Long enough for a run of three at up to 1.1 s spacing.
      duration: 0.5 + (VWAVE_MAX_RUN - 1) * 1.1,
      onset: (g) => {
        // A quarter of events are short runs ("alone or in runs"), each wave with
        // its own amplitude and width ("of varying amplitude and morphology").
        const n = g.uniform() < 0.25 ? (g.uniform() < 0.6 ? 2 : 3) : 1;
        const onsets = [0], amps: number[] = [], widths: number[] = [];
        for (let k = 1; k < n; k++) onsets.push(onsets[k - 1] + between(g, 0.6, 1.1));
        for (let k = 0; k < n; k++) { amps.push(jit(g, VWAVE_PEAK_UV, 0.3)); widths.push(jit(g, 1, 0.2)); }
        return { onsets, amps, widths };
      },
      morphology: (t, e) => {
        let v = 0;
        for (let k = 0; k < e.onsets.length; k++) {
          const u = t - e.onsets[k];
          if (u >= 0 && u < 0.5) v += vertexElement(u, e.amps[k], e.widths[k]);
        }
        return v;
      },
    });
    return asGenerator(ts);
  },
};

// ---------------------------------------------------------------------------
// K-complexes.
//
// AASM: a well-delineated negative sharp wave immediately followed by a positive
// component, standing out from the background, total duration >= 0.5 s,
// usually maximal frontally. COL: frontal maximum; the averaged negative peak
// (N550) is the dominant component, the positive one slower. LE: higher
// amplitude and symmetric, initial negative then slow positive, often but not
// always followed by a spindle; its annotated figure shows the complex on every
// chain, diffuse, with an 11-16 Hz spindle following.
//
// Morphology: a negative wave peaking 0.35 s into the event (rise sigma 85 ms,
// fall 70 ms — the fall is the steep negative-to-positive stroke readers see)
// followed by a positive wave peaking 0.42 s later, sigma 170 ms, at 45-70% of
// the negative peak. Total span ~1 s. Negative peak 85-155 uV at the frontal
// maximum, so peak-to-peak runs ~120-260 uV: well above AASM's 75 uV and
// "standing out" from an N2 background.
//
// Field: frontal maximum (Fz, F3/F4), falling off through Fp, C, P, T to O —
// measured on the double banana it deflects every chain, anterior rows most.
//
// 60% are followed by a spindle starting on the positive wave's decline ("often
// but not always"), carried on the same frontally-weighted field — LE's figure
// has exactly that frontocentral, diffuse spindle.
// ---------------------------------------------------------------------------
type KEvent = {
  amp: number; posFrac: number;
  spindle: boolean; spDelay: number; spDur: number; spFreq: number; spAmp: number; spPhase: number;
};

const KC_NEG_PEAK_S = 0.35;

const kComplex: PatternSourceDescriptor = {
  id: 'kcomplex',
  toggles: ['k-complex'],
  states: ['n2'],
  stateIntrinsic: true,
  spec: synchronousPatches('kcomplex', {
    Fz: 1, F3: 0.85, F4: 0.85, Fp1: 0.7, Fp2: 0.7, Cz: 0.6, F7: 0.5, F8: 0.5, C3: 0.45, C4: 0.45,
    Pz: 0.3, T3: 0.3, T4: 0.3, P3: 0.25, P4: 0.25, T5: 0.15, T6: 0.15, O1: 0.1, O2: 0.1,
  }, { extent: 0.3 }),
  make(seed, dt) {
    const ts = new TransientSource<KEvent>(seed, dt, {
      // ~3 per minute (11-29 s apart): spontaneous K-complexes run at roughly
      // 1-3/min of N2 (COL).
      schedule: { kind: 'periodic', period: 20, jitterFrac: 0.45 },
      duration: 3.4,
      onset: (g) => ({
        amp: jit(g, 120, 0.3),
        posFrac: between(g, 0.45, 0.7),
        spindle: g.uniform() < 0.6,
        spDelay: between(g, 0.3, 0.45),
        spDur: jit(g, 1.3, 0.3),
        spFreq: between(g, 11.5, 14),
        spAmp: between(g, 0.1, 0.16),
        spPhase: TWO_PI * g.uniform(),
      }),
      morphology: (t, e) => {
        const neg = -skewGauss(t, KC_NEG_PEAK_S, 0.085, 0.07);
        const pos = e.posFrac * gaussian(t, KC_NEG_PEAK_S + 0.42, 0.17);
        let v = e.amp * (neg + pos);
        if (e.spindle) {
          v += e.amp * e.spAmp * spindleBurst(t - (KC_NEG_PEAK_S + e.spDelay), e.spDur, e.spFreq, e.spPhase);
        }
        return v;
      },
    });
    return asGenerator(ts);
  },
};

// ---------------------------------------------------------------------------
// Sleep spindles — two populations.
//
// LE: symmetric bursts of 11-16 Hz from the thalamic reticular nucleus. AASM:
// 11-16 Hz (most commonly 12-14), >= 0.5 s, usually maximal centrally. Spindles
// come in two kinds with different fields: slow (~11-13 Hz) spindles maximal
// frontally and fast (~13-15 Hz) spindles maximal centro-parietally. SPN, in 80
// healthy adults: central fast spindles 13.4-14.3 Hz, peak 5.2-15.2 uV at C3-A2,
// 1.0-5.8 per minute; frontal slow spindles 12.3-12.9 Hz, 4.1-13.2 uV.
//
// So two sources, each a bilateral group (symmetric by construction), each with
// its own schedule. Peak amplitude at the group's maximum is 10-20 uV, which puts
// C3 at 8-16 uV for the fast kind — SPN's range. Rates ~4/min fast and ~2/min
// slow: a spindle on most 10 s pages of N2, as a reader expects.
// ---------------------------------------------------------------------------
type SpindleEvent = { dur: number; freq: number; amp: number; phase: number };

function spindleSource(
  id: string, weights: Record<string, number>, freqLo: number, freqHi: number, period: number,
): PatternSourceDescriptor {
  return {
    id,
    toggles: ['spindles'],
    states: ['n2'],
    stateIntrinsic: true,
    spec: synchronousPatches(id, weights, { extent: 0.3 }),
    make(seed, dt) {
      const ts = new TransientSource<SpindleEvent>(seed, dt, {
        schedule: { kind: 'periodic', period, jitterFrac: 0.5 },
        duration: 1.7,
        onset: (g) => ({
          dur: jit(g, 1.2, 0.35),
          freq: between(g, freqLo, freqHi),
          amp: jit(g, 15, 0.35),
          phase: TWO_PI * g.uniform(),
        }),
        morphology: (t, e) => e.amp * spindleBurst(t, e.dur, e.freq, e.phase),
      });
      return asGenerator(ts);
    },
  };
}

const spindleFast = spindleSource('spindle',
  { Cz: 1, C3: 0.8, C4: 0.8, Pz: 0.7, P3: 0.5, P4: 0.5 }, 13.0, 14.5, 14);
const spindleSlow = spindleSource('spindle-slow',
  { Fz: 1, F3: 0.75, F4: 0.75, Cz: 0.45, Fp1: 0.35, Fp2: 0.35 }, 11.5, 13.0, 30);

// ---------------------------------------------------------------------------
// POSTS — positive occipital sharp transients of sleep.
//
// NPK: surface-positive sharp waves, phase reversal almost always at O1 or O2;
// triangular, mono- or diphasic (a prominent positive peak and, when diphasic, a
// smaller negative one after it); 20-75 uV (up to 120); 80-200 ms. They occur
// singly, recurring without periodicity more than 1 s apart, or just as often in
// trains of up to 4-6 per second lasting about a second (rarely > 2 s). The field
// spans both occiputs. From late N1, persisting into N2 and SWS; rare in REM.
// LE: "sail-like", singly or in runs, from stage I on; its figure shows them on
// the last link of each posterior chain (P3-O1, T5-O1, P4-O2, T6-O2).
//
// The old source fired one tall identical transient every ~2 s — never a train —
// from a single broad patch whose field put 67% of the P3-O1 deflection onto
// C3-P3. Now: a patch under each occiput, trains or singles, and a triangular
// element with a sharp apex (each leg a power 1.3 curve).
//
// Polarity is montage-dependent (CLAUDE.md §4): positive at O1/O2, so DOWN in a
// referential montage, but UP on the double banana, where O1/O2 is input 2.
// ---------------------------------------------------------------------------
type PostsEvent = { onsets: number[]; amps: number[]; durs: number[]; negs: number[] };

const POSTS_MAX_TRAIN = 6;
const POSTS_EVENT_S = 1.6;

function postsElement(t: number, amp: number, dur: number, neg: number): number {
  if (t < 0) return 0;
  const rise = 0.45 * dur;
  if (t < rise) return amp * Math.pow(t / rise, 1.3);
  if (t < dur) return amp * Math.pow((dur - t) / (dur - rise), 1.3);
  // Diphasic ones: a smaller negative wave after the positive peak.
  if (neg > 0 && t < 1.6 * dur) return -amp * neg * Math.sin(Math.PI * (t - dur) / (0.6 * dur));
  return 0;
}

const posts: PatternSourceDescriptor = {
  id: 'posts',
  toggles: ['posts'],
  states: ['n1', 'n2'],
  stateIntrinsic: true,
  spec: synchronousPatches('posts', { O1: 1, O2: 1 }, { extent: 0.3 }),
  make(seed, dt) {
    const ts = new TransientSource<PostsEvent>(seed, dt, {
      // The next event is scheduled this long after the previous one's 1.6 s
      // window closes, so singles are always > 1 s apart, as NPK requires.
      schedule: { kind: 'periodic', period: 1.8, jitterFrac: 0.5 },
      duration: POSTS_EVENT_S,
      onset: (g) => {
        // Singles and trains "just as often".
        const n = g.uniform() < 0.45 ? 1 : 2 + Math.floor(g.uniform() * (POSTS_MAX_TRAIN - 1));
        const rate = between(g, 4, 6);
        const base = between(g, 25, 55);
        const onsets: number[] = [], amps: number[] = [], durs: number[] = [], negs: number[] = [];
        for (let k = 0; k < n; k++) {
          onsets.push(k === 0 ? 0 : onsets[k - 1] + jit(g, 1 / rate, 0.1));
          amps.push(jit(g, base, 0.25));
          durs.push(between(g, 0.09, 0.16));
          negs.push(g.uniform() < 0.35 ? between(g, 0.15, 0.25) : 0);
        }
        return { onsets, amps, durs, negs };
      },
      morphology: (t, e) => {
        let v = 0;
        for (let k = 0; k < e.onsets.length; k++) v += postsElement(t - e.onsets[k], e.amps[k], e.durs[k], e.negs[k]);
        return v;
      },
    });
    return asGenerator(ts);
  },
};

// ---------------------------------------------------------------------------
// Slow-wave sleep (N3).
//
// N3 has no transient of its own: it IS its background — high-amplitude
// (>75 uV), synchronized 0.5-2 Hz delta (LE; AASM scores N3 when such waves fill
// >= 20% of an epoch), which engine.ts draws in state 'n3'. This toggle exists so
// N3 can be reached from the control panel, whose state buttons stop at Sleep
// (N2): switching it on moves Background State to N3 (App.tsx). Like `eyes-open`,
// the source itself emits nothing.
// ---------------------------------------------------------------------------
const slowWaves: PatternSourceDescriptor = {
  id: 'slow-waves',
  toggles: ['slow-waves'],
  spec: synchronousPatches('slow-waves', { Fz: 1 }, { extent: 0.3 }),
  make() {
    return { next: () => 0 };
  },
};

// ---------------------------------------------------------------------------
// Slow roving eye movements — the ocular signature of drowsiness and N1.
//
// The reference course names these in both the awake chapter ("decreased eye
// blinks and roving eye movements ... very slow opposing undulations of the
// bilateral frontal regions") and the sleep chapter ("drowsiness (emergence of
// theta, decreased eye blinks, slow roving eye movements)"). They are one of the
// features that tells a reader a record has left wakefulness, and the simulator
// had no source for them at all.
//
// Geometry: the same horizontal corneo-retinal dipole that produces lateral gaze
// artifact — a tangential dipole on the left-right axis, sitting at the orbits.
// Being tangential, it is positive at one lateral frontal electrode and negative
// at the other, which is exactly the "opposing" part of the description: F7 and
// F8 undulate against each other. The spec is written out rather than imported
// from `artifacts.ts` to keep this family free of that dependency; the numbers
// match ARTIFACT_SOURCES.gaze.
//
// Morphology is what separates these from a saccade and from REM. A saccade is
// a step; REM's rapid eye movements are "sharply contoured ... with a faster
// upslope than downslope". Roving movements are neither — they are smooth,
// slow, and irregular, drifting rather than jumping. So this is not built on
// TransientSource (there is no event to schedule): it is a continuous generator,
// two-pole low-pass filtered Gaussian noise with a ~0.3 Hz corner, which gives
// a smooth aperiodic wander in the 0.2-0.5 Hz range roving movements occupy.
// ---------------------------------------------------------------------------
const ROVING_CORNER_HZ = 0.3;
const ROVING_PEAK_UV = 42;

const rovingEyes: PatternSourceDescriptor = {
  id: 'roving-eyes',
  toggles: ['roving-eyes'],
  states: ['drowsy', 'n1'],
  stateIntrinsic: true,
  spec: {
    id: 'roving-eyes',
    pos: [0.0, -0.68, 0.61],
    orientation: { kind: 'tangential', dir: [-1, 0, 0] },
    extent: 0.55,
  },
  make(seed, dt) {
    const g = new Gaussian(seed);
    // Two cascaded one-pole low-passes: a single pole leaves audible high-
    // frequency roughness on the drift, which would read as noise on the
    // frontal rows rather than as a slow roll.
    const a = Math.exp(-2 * Math.PI * ROVING_CORNER_HZ * dt);
    let s1 = 0, s2 = 0;
    const step = () => { s1 = a * s1 + (1 - a) * g.next(); s2 = a * s2 + (1 - a) * s1; return s2; };
    // Unit-variance calibration, measured rather than derived: the closed form
    // for a two-pole cascade's output variance is fiddly enough to get wrong
    // silently, and this runs once at construction. The same draws also serve as
    // the filter's warm-up, so the first emitted sample is already mid-drift
    // instead of climbing out of zero.
    let sum = 0, sumSq = 0;
    const CAL = 20000;
    for (let i = 0; i < CAL; i++) { const v = step(); sum += v; sumSq += v * v; }
    const sd = Math.sqrt(sumSq / CAL - (sum / CAL) ** 2) || 1;
    return {
      next(ctx) {
        // Keep filtering even when disabled so the drift has no startup step
        // when the state changes mid-record.
        const v = step();
        if (!ctx.enabled) return 0;
        return ROVING_PEAK_UV * (v / sd);
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Rapid eye movements — the defining ocular feature of REM sleep.
//
// The REM background is "diffuse attenuation of amplitudes, with a range of
// frequencies", i.e. it looks like N1 and cannot identify the stage on its own.
// The eye movements can, and the course describes them precisely: "sharply
// contoured, opposing left and right frontal waveforms" with "a faster upslope
// than downslope".
//
// Every clause of that is modelled. Same horizontal corneo-retinal dipole as the
// roving movements above, so left and right lateral frontal electrodes again
// deflect against each other — that is the "opposing". What separates a REM from
// a roving movement is the shape: roving movements are smooth, slow drifts,
// while these are sharp, and deliberately ASYMMETRIC in time — a fast rise
// followed by a slower fall, which is what "faster upslope than downslope"
// means and what makes them look sharply contoured rather than sinusoidal.
// They also arrive in bursts, as real REMs do, rather than at a steady rate.
// ---------------------------------------------------------------------------
type RemEvent = { amp: number; dir: number };

// Rise and fall of one movement. The ratio is the claim; the absolute values put
// the whole deflection under ~0.35 s, which is the duration of a real REM.
const REM_RISE_SEC = 0.07;
const REM_FALL_SEC = 0.26;
const REM_PEAK_UV = 60;

const remEyes: PatternSourceDescriptor = {
  id: 'rem-eyes',
  toggles: ['rem-eyes'],
  states: ['rem'],
  stateIntrinsic: true,
  spec: {
    id: 'rem-eyes',
    pos: [0.0, -0.68, 0.61],
    orientation: { kind: 'tangential', dir: [-1, 0, 0] },
    extent: 0.55,
  },
  make(seed, dt) {
    const ts = new TransientSource<RemEvent>(seed, dt, {
      // Bursts: a short mean interval with heavy jitter clusters the movements
      // instead of spacing them evenly.
      schedule: { kind: 'periodic', period: 1.4, jitterFrac: 0.7 },
      duration: REM_RISE_SEC + REM_FALL_SEC,
      // Direction alternates at random: the eyes track back and forth, so
      // successive movements are not all the same way.
      onset: (g) => ({ amp: jit(g, 1, 0.3), dir: g.uniform() < 0.5 ? -1 : 1 }),
      morphology: (t, e) => {
        const peak = e.dir * e.amp * REM_PEAK_UV;
        if (t < REM_RISE_SEC) return peak * (t / REM_RISE_SEC);
        if (t < REM_RISE_SEC + REM_FALL_SEC) {
          return peak * (1 - (t - REM_RISE_SEC) / REM_FALL_SEC);
        }
        return 0;
      },
    });
    return asGenerator(ts);
  },
};

export const SLEEP_SOURCES: PatternSourceDescriptor[] = [
  vWave, kComplex, spindleFast, spindleSlow, posts, slowWaves, rovingEyes, remEyes,
];

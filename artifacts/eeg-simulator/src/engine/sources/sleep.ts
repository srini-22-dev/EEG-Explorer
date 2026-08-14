/**
 * Sleep architecture sources — POSTS, vertex (V) waves, K-complexes, spindles.
 *
 * These are the grapho-elements that *define* the lighter stages of NREM sleep,
 * so each is `stateIntrinsic`: it appears whenever the patient is in the relevant
 * stage (N1/N2), and its toggle is an additional way to force it (e.g. to show a
 * spindle in isolation). See `registry.ts` for that gating rule.
 *
 * Every one is a `TransientSource`: a seeded scheduler fires a morphology waveform
 * every so often and returns 0 between events. The scalar each morphology returns
 * is the microvolt value *at the source's peak electrode*; the leadfield column
 * built from its `sourceUnder(...)` geometry then spreads it across the scalp, so
 * the old hand-authored per-electrode amplitude tables (Cz vs. central vs. the
 * rest) are gone — the topography is pure geometry now.
 *
 * The numeric morphology (amplitudes, frequencies, durations, jitter) is ported
 * verbatim from the legacy `sleepStructureVoltage`; only the topography changed.
 */

import { sourceUnder } from '../forward';
import { Gaussian } from '../rng';
import { TransientSource } from './transient';
import { gaussian, multiToneSignal, SPINDLE_TONES, SPINDLE_TONE_NORM } from './morphology';
import type { PatternSourceDescriptor, PatternGenerator } from './registry';

/** Per-event multiplicative/additive jitter, matching the legacy `jitter(base, frac)`. */
const jit = (g: Gaussian, base: number, frac: number): number =>
  base * (1 + (g.uniform() - 0.5) * 2 * frac);

/** Wrap a `TransientSource` as a `PatternGenerator` (gate its output on `ctx.enabled`). */
const asGenerator = <E>(ts: TransientSource<E>): PatternGenerator => ({
  next: (ctx) => ts.next(ctx.enabled),
});

const TWO_PI = 2 * Math.PI;

// ---------------------------------------------------------------------------
// Vertex (V) sharp waves — sharp, surface-negative, maximal at the vertex (Cz),
// ~200 ms, in N1 and N2. A ~2 Hz negative half-cycle under a narrow envelope.
// ---------------------------------------------------------------------------
type VWaveEvent = { amp: number; dur: number };

const vWave: PatternSourceDescriptor = {
  id: 'vwave',
  toggles: ['v-waves'],
  states: ['n1', 'n2'],
  stateIntrinsic: true,
  spec: sourceUnder('vwave', ['Cz'], { extent: 0.26 }),
  make(seed, dt) {
    const ts = new TransientSource<VWaveEvent>(seed, dt, {
      schedule: { kind: 'periodic', period: 10, jitterFrac: 0.3 },
      duration: 0.9,
      onset: (g) => ({ amp: jit(g, 1, 0.25), dur: jit(g, 0.22, 0.2) }),
      morphology: (t, e) => -140 * e.amp * Math.sin(TWO_PI * 2 * t) * gaussian(t, e.dur, 0.1),
    });
    return asGenerator(ts);
  },
};

// ---------------------------------------------------------------------------
// K-complexes — a large biphasic transient (sharp surface-negative followed by a
// slower positive), frontocentral, maximal at the midline, in N2. Occasionally an
// evoked spindle rides its second half.
// ---------------------------------------------------------------------------
type KEvent = { aSharp: number; aSlow: number; sharpDur: number };

const kComplex: PatternSourceDescriptor = {
  id: 'kcomplex',
  toggles: ['k-complex'],
  states: ['n2'],
  stateIntrinsic: true,
  spec: sourceUnder('kcomplex', ['Cz', 'Fz'], { extent: 0.55 }),
  make(seed, dt) {
    const base = 240;
    const ts = new TransientSource<KEvent>(seed, dt, {
      schedule: { kind: 'periodic', period: 14, jitterFrac: 0.35 },
      duration: 2.2,
      onset: (g) => ({
        aSharp: jit(g, 1, 0.2),
        aSlow: jit(g, 1, 0.2),
        sharpDur: jit(g, 0.20, 0.1),
      }),
      morphology: (t, e) => {
        const sharp = -base * e.aSharp * Math.sin(TWO_PI * 3 * t) * gaussian(t, e.sharpDur, 0.08);
        const slow = base * 0.9 * e.aSlow * Math.sin(TWO_PI * 0.8 * t) * gaussian(t, 0.70, 0.24);
        let v = sharp + slow;
        if (t > 0.5 && t < 1.5 && e.aSharp > 1) {
          v += 20 * gaussian(t, 1.0, 0.2) * multiToneSignal(t, SPINDLE_TONES, SPINDLE_TONE_NORM);
        }
        return v;
      },
    });
    return asGenerator(ts);
  },
};

// ---------------------------------------------------------------------------
// Sleep spindles — 11-16 Hz waxing/waning bursts, maximal at the vertex, in N2.
// The tone set carries the frequency content; an asymmetric Gaussian gives the
// waxing (fast rise) / waning (slower fall) envelope.
// ---------------------------------------------------------------------------
type SpindleEvent = { amp: number; dur: number };

const spindle: PatternSourceDescriptor = {
  id: 'spindle',
  toggles: ['spindles'],
  states: ['n2'],
  stateIntrinsic: true,
  spec: sourceUnder('spindle', ['Cz'], { extent: 0.28 }),
  make(seed, dt) {
    const ts = new TransientSource<SpindleEvent>(seed, dt, {
      schedule: { kind: 'periodic', period: 7, jitterFrac: 0.4 },
      duration: 3.0,
      onset: (g) => ({ amp: jit(g, 1, 0.25), dur: jit(g, 1.0, 0.5) }),
      morphology: (t, e) => {
        const dur = e.dur;
        if (t >= dur * 2) return 0;
        const env = t < dur / 2 ? gaussian(t, dur / 2, dur / 4) : gaussian(t, dur / 2, dur / 3);
        return 48 * e.amp * env * multiToneSignal(t, SPINDLE_TONES, SPINDLE_TONE_NORM);
      },
    });
    return asGenerator(ts);
  },
};

// ---------------------------------------------------------------------------
// POSTS — positive occipital sharp transients of sleep: surface-positive,
// occipital, ~100 ms checkmark-shaped, in N1/N2, sometimes in short runs.
// ---------------------------------------------------------------------------
type PostsEvent = { amp: number; dur: number };

const posts: PatternSourceDescriptor = {
  id: 'posts',
  toggles: ['posts'],
  states: ['n1', 'n2'],
  stateIntrinsic: true,
  spec: sourceUnder('posts', ['O1', 'O2'], { extent: 0.45 }),
  make(seed, dt) {
    const ts = new TransientSource<PostsEvent>(seed, dt, {
      schedule: { kind: 'periodic', period: 2, jitterFrac: 0.5 },
      duration: 0.35,
      onset: (g) => ({ amp: jit(g, 1, 0.2), dur: jit(g, 0.1, 0.3) }),
      morphology: (t, e) => {
        const dur = e.dur;
        if (t < dur) return 75 * e.amp * Math.sin(Math.PI * t / dur);
        // Occasional second element of a short run, for larger events only.
        if (t < dur * 2.2 && e.amp > 1.1) return 50 * e.amp * Math.sin(Math.PI * (t - dur) / dur);
        return 0;
      },
    });
    return asGenerator(ts);
  },
};

export const SLEEP_SOURCES: PatternSourceDescriptor[] = [vWave, kComplex, spindle, posts];

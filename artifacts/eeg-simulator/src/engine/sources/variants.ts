/**
 * Normal-variant sources — mu rhythm, wicket spikes, rhythmic mid-temporal
 * theta of drowsiness (RMTD), lambda waves, posterior slow waves of youth
 * (PSWY), 6 Hz phantom spike-wave, 14 & 6 Hz positive bursts, and benign
 * epileptiform transients of sleep (BETS).
 *
 * These are all benign, non-epileptiform patterns that a learner must be able
 * to recognise AND must not mistake for pathology — several (wicket, BETS,
 * 14 & 6 positive bursts) are the classic "epileptiform mimics" that trip up
 * residents. Their defining negative features (no slow wave following wicket
 * or BETS; monomorphic RMTD vs. polymorphic background theta) are encoded in
 * which tone set / morphology helper is used, not left implicit in a comment.
 *
 * Amplitude, frequency, duration, and jitter are ported verbatim from the
 * legacy `variantVoltage`; only the topography changed, from hand-authored
 * per-electrode gain tables to `sourceUnder(...)` geometry. Several patterns
 * are genuinely bilateral in the legacy code but driven by a SINGLE shared
 * timer there (both hemispheres flash in lock-step) — for lambda, PSWY, and
 * the 14 & 6 Hz bursts that synchrony is physiologically defensible (a shared
 * visual or generalised trigger), so those stay one source anchored at the
 * mean position of the relevant electrodes. For wicket, RMTD, and BETS, real
 * bitemporal activity is NOT synchronous between hemispheres, so those are
 * split into independent left/right sources — each descriptor's `id` derives
 * its own seed (`engine.ts`: `deriveSeed(seed, d.id)`), so the two sides
 * decorrelate for free without any extra bookkeeping here.
 */

import { sourceUnder, tangentialAt } from '../forward';
import { Gaussian } from '../rng';
import { TransientSource } from './transient';
import {
  gaussian, arciformSignal, multiToneSignal,
  MU_TONES, MU_TONE_NORM,
  ALPHA_TONES, ALPHA_TONE_NORM,
  RMTD_TONES, RMTD_TONE_NORM,
  PSWY_TONES, PSWY_TONE_NORM,
  POS14_TONES, POS6_TONES, POS_BURST_TONE_NORM,
} from './morphology';
import type { PatternSourceDescriptor, PatternGenerator } from './registry';

/** Per-event multiplicative/additive jitter, matching the legacy `jitter(base, frac)`. */
const jit = (g: Gaussian, base: number, frac: number): number =>
  base * (1 + (g.uniform() - 0.5) * 2 * frac);

/** Wrap a `TransientSource` as a `PatternGenerator` (gate its output on `ctx.enabled`). */
const asGenerator = <E>(ts: TransientSource<E>): PatternGenerator => ({
  next: (ctx) => ts.next(ctx.enabled),
});

// One step of an Ornstein-Uhlenbeck process driven by uniform noise, matching
// the legacy `stepOU` exactly: mean-reverts toward 0 with relaxation time
// `tau`, driven by seeded uniform noise in place of legacy's `Math.random()`.
// Used only by the mu-rhythm envelope below.
function stepOU(g: Gaussian, prev: number, dt: number, tau: number): number {
  const decay = Math.exp(-dt / tau);
  return decay * prev + (1 - decay) * g.range(-1, 1);
}

// ---------------------------------------------------------------------------
// Mu rhythm — an arch-shaped ("arciform") 8-12 Hz idling rhythm of the
// sensorimotor cortex, bilateral over the central regions, attenuated by
// movement or tactile stimulation of the contralateral hand. It is generated
// by cortex lining the central sulcus (a sulcal wall, not a gyral crown), so
// — like engine.ts's own background mu sources — its scalp projection is
// genuinely TANGENTIAL: a bipolar field straddling C3/C4, not the radial
// monopolar blob most sources in this file use. This variant is the
// prominent, clearly-arciform mu a learner is asked to identify; the
// engine's smoother, lower-amplitude background mu keeps running underneath
// it, and the two summing is intentional — not a duplicate.
//
// The arch shape comes from `arciformSignal` (see morphology.ts): a sharp
// phase and a rounded phase per cycle, which is what "arch-shaped" means
// clinically. Amplitude (22) and tone set are ported verbatim from legacy.
//
// The envelope reproduces legacy's `getEnvelope('mu', t, 3.0, 1.0)`: two
// independent Ornstein-Uhlenbeck processes (relaxation times 3 s and 1 s)
// summed as `0.5 + 0.35*slow + 0.15*fast`, giving a gently wandering
// waxing/waning amplitude rather than a metronomic one — real mu rhythm is
// not a sustained pure tone. Each side draws its own OU pair from its own
// seed, so the two hemispheres wax and wane independently, as real mu does.
// ---------------------------------------------------------------------------
type MuEnvelope = { slow: number; fast: number };

function muSide(id: string, electrode: string): PatternSourceDescriptor {
  const geom = sourceUnder(id, [electrode], { extent: 0.22 });
  return {
    id,
    toggles: ['mu-rhythm'],
    spec: { ...geom, orientation: tangentialAt(geom.pos, [0, 0, 1]) },
    make(seed, dt) {
      const g = new Gaussian(seed);
      const env: MuEnvelope = { slow: 0, fast: 0 };
      return {
        // Advance the envelope every sample, even while disabled, so its
        // phase stays continuous (same convention as gen-slowing's Hopf
        // oscillators in nonEpileptiform.ts) — only the emitted value gates.
        next: (ctx) => {
          env.slow = stepOU(g, env.slow, dt, 3.0);
          env.fast = stepOU(g, env.fast, dt, 1.0);
          if (!ctx.enabled) return 0;
          const e = 0.5 + 0.35 * env.slow + 0.15 * env.fast;
          return 22 * e * arciformSignal(ctx.t, MU_TONES, MU_TONE_NORM);
        },
      };
    },
  };
}

const muL = muSide('mu-l', 'C3');
const muR = muSide('mu-r', 'C4');

// ---------------------------------------------------------------------------
// Wicket spikes — 6-11 Hz arciform bursts over the mid-temporal region during
// drowsiness, benign, and the classic epileptiform mimic: what separates a
// wicket burst from a true temporal spike-and-wave is that a wicket has NO
// following slow wave. That negative feature is encoded structurally — the
// morphology below only ever calls `arciformSignal`, nothing shaped like
// `spikeSlowWave`. Real wicket activity is not synchronous between the two
// temporal lobes, so this is split into independent T3/T4 sources rather
// than the single shared timer the legacy code used.
// ---------------------------------------------------------------------------
type WicketEvent = { amp: number; dur: number };

function wicketSide(id: string, electrode: string): PatternSourceDescriptor {
  return {
    id,
    toggles: ['wicket'],
    states: ['drowsy'],
    spec: sourceUnder(id, [electrode], { extent: 0.35 }),
    make(seed, dt) {
      const ts = new TransientSource<WicketEvent>(seed, dt, {
        schedule: { kind: 'periodic', period: 3.5, jitterFrac: 0.43 }, // legacy 2-5 s
        duration: 1.5,
        onset: (g) => ({ amp: jit(g, 1, 0.2), dur: jit(g, 0.9, 0.3) }),
        morphology: (t, e) => {
          const env = gaussian(t, e.dur / 2, e.dur / 4);
          return 50 * e.amp * env * arciformSignal(t, ALPHA_TONES, ALPHA_TONE_NORM);
        },
      });
      return asGenerator(ts);
    },
  };
}

const wicketL = wicketSide('wicket-l', 'T3');
const wicketR = wicketSide('wicket-r', 'T4');

// ---------------------------------------------------------------------------
// Rhythmic mid-temporal theta of drowsiness (RMTD / "psychomotor variant") —
// ~4 s runs of ~6 Hz theta over T3/T4 during drowsiness. The diagnostic
// feature is that it is MONOMORPHIC (a near-fixed frequency), unlike the
// polymorphic spread of ordinary background theta — that is why it draws
// from `RMTD_TONES`, a tight cluster around 6 Hz, rather than the broad
// `THETA_TONES`. Independent left/right sources for the same reason as
// wicket: real bitemporal activity does not fire both sides in lock-step.
// ---------------------------------------------------------------------------
type RmtdEvent = { amp: number };

function rmtdSide(id: string, electrode: string): PatternSourceDescriptor {
  return {
    id,
    toggles: ['rmtd'],
    states: ['drowsy'],
    spec: sourceUnder(id, [electrode], { extent: 0.35 }),
    make(seed, dt) {
      const ts = new TransientSource<RmtdEvent>(seed, dt, {
        schedule: { kind: 'periodic', period: 4.5, jitterFrac: 0.33 }, // legacy 3-6 s
        duration: 4.0,
        onset: (g) => ({ amp: jit(g, 1, 0.1) }),
        morphology: (t, e) => {
          const env = gaussian(t, 2, 1.2);
          return 65 * e.amp * env * multiToneSignal(t, RMTD_TONES, RMTD_TONE_NORM);
        },
      });
      return asGenerator(ts);
    },
  };
}

const rmtdL = rmtdSide('rmtd-l', 'T3');
const rmtdR = rmtdSide('rmtd-r', 'T4');

// ---------------------------------------------------------------------------
// Lambda waves — surface-positive occipito-parietal sharp transients evoked
// by visual scanning of a patterned field (e.g. reading), benign. The visual
// evoked response drives both hemispheres from the same stimulus at once, so
// (unlike wicket/RMTD/BETS above) a single source anchored at the mean of
// O1/O2 is the physiologically appropriate model, not an independent pair.
// ---------------------------------------------------------------------------
type LambdaEvent = { amp: number; dur: number };

const lambda: PatternSourceDescriptor = {
  id: 'lambda',
  toggles: ['lambda'],
  spec: sourceUnder('lambda', ['O1', 'O2'], { extent: 0.4 }),
  make(seed, dt) {
    const ts = new TransientSource<LambdaEvent>(seed, dt, {
      schedule: { kind: 'periodic', period: 0.9, jitterFrac: 0.33 }, // legacy 0.6-1.2 s
      duration: 0.25,
      onset: (g) => ({ amp: jit(g, 1, 0.25), dur: jit(g, 0.15, 0.2) }),
      morphology: (t, e) => (t < e.dur ? 60 * e.amp * Math.sin(Math.PI * t / e.dur) : 0),
    });
    return asGenerator(ts);
  },
};

// ---------------------------------------------------------------------------
// Posterior slow waves of youth (PSWY) — high-amplitude 2.5-4.5 Hz waves
// admixed with the posterior alpha rhythm, a benign finding most common in
// children and young adults, present only while genuinely awake (it rides on
// the alpha rhythm, which drowsiness/sleep abolish). `PSWY_TONES` sits above
// the delta band deliberately (see morphology.ts) so this doesn't read as
// pathological slowing. Legacy's `PSWY_FIELD` table peaked at O1/O2 (1.0) and
// fell off at P3/P4 (0.67); anchoring the source at the mean of all four
// electrodes and letting the leadfield's Gaussian falloff reproduce that
// occipital > parietal gradient is the geometric equivalent.
// ---------------------------------------------------------------------------
type PswyEvent = { dur: number };

const pswy: PatternSourceDescriptor = {
  id: 'pswy',
  toggles: ['pswy'],
  states: ['awake'],
  spec: sourceUnder('pswy', ['O1', 'O2', 'P3', 'P4'], { extent: 0.5 }),
  make(seed, dt) {
    const ts = new TransientSource<PswyEvent>(seed, dt, {
      schedule: { kind: 'periodic', period: 3.75, jitterFrac: 0.33 }, // legacy 2.5-5.0 s
      duration: 2.0,
      onset: (g) => ({ dur: jit(g, 1.0, 0.3) }),
      morphology: (t, e) => {
        if (t >= e.dur) return 0;
        const env = gaussian(t, e.dur / 2, e.dur / 3);
        return 95 * env * multiToneSignal(t, PSWY_TONES, PSWY_TONE_NORM);
      },
    });
    return asGenerator(ts);
  },
};

// ---------------------------------------------------------------------------
// 6 Hz phantom spike-wave — brief (<1 s), low-amplitude generalised spike-
// wave bursts near 6 Hz, benign, seen in drowsiness/light sleep. "Phantom"
// because the spike is tiny relative to the slow wave (50 uV vs 30 uV here,
// both far below a true 2-3 Hz epileptiform spike-wave discharge) and the
// whole burst is brief. It is genuinely generalised in the legacy code (no
// electrode restriction at all — every channel gets the same event), so this
// is modelled as one broad, diffuse source rather than a focal one.
// ---------------------------------------------------------------------------
type SixHzEvent = { amp: number };

const sixHzSw: PatternSourceDescriptor = {
  id: '6hz-sw',
  toggles: ['6hz-sw'],
  spec: sourceUnder('6hz-sw', ['Cz'], { extent: 0.7 }),
  make(seed, dt) {
    const ts = new TransientSource<SixHzEvent>(seed, dt, {
      schedule: { kind: 'periodic', period: 4.5, jitterFrac: 0.33 }, // legacy 3-6 s
      duration: 1.0,
      onset: (g) => ({ amp: jit(g, 1, 0.2) }),
      morphology: (t, e) => {
        const cyc = t % (1 / 6);
        const spike = 50 * e.amp * gaussian(cyc, 0.02, 0.008);
        const wave = -30 * e.amp * gaussian(cyc, 0.1, 0.035);
        return spike + wave;
      },
    });
    return asGenerator(ts);
  },
};

// ---------------------------------------------------------------------------
// 14 & 6 Hz positive bursts — arch-shaped positive bursts over the posterior
// temporal region during light sleep/drowsiness, benign, carrying two
// independent arciform components (a 14 Hz one and a 6 Hz one — either or
// both may dominate a given burst, which is why the per-event `ratio`
// varies). Legacy drove T3/T4/T5/T6 from one shared timer, so — like lambda
// and PSWY — this stays a single source, anchored at the mean of the
// posterior-temporal pair T5/T6.
// ---------------------------------------------------------------------------
type Pos1406Event = { ratio: number };

const pos1406: PatternSourceDescriptor = {
  id: '14-6-pos',
  toggles: ['14-6-pos'],
  // 14-&-6 Hz positive bursts ("ctenoids") are a benign phenomenon of drowsiness
  // and light sleep in older children/adolescents; they do not occur in relaxed
  // wakefulness. State-gate them like the other drowsy benign variants (wicket,
  // rmtd) rather than letting the toggle fire while awake.
  states: ['drowsy', 'n1', 'n2'],
  spec: sourceUnder('14-6-pos', ['T5', 'T6'], { extent: 0.4 }),
  make(seed, dt) {
    const ts = new TransientSource<Pos1406Event>(seed, dt, {
      schedule: { kind: 'periodic', period: 6, jitterFrac: 0.33 }, // legacy 4-8 s
      duration: 1.0,
      onset: (g) => ({ ratio: jit(g, 0.6, 0.4) }),
      morphology: (t, e) => {
        const env = gaussian(t, 0.5, 0.25);
        const c14 = 28 * env * e.ratio * arciformSignal(t, POS14_TONES, POS_BURST_TONE_NORM);
        const c6 = 18 * env * (1 - e.ratio) * arciformSignal(t, POS6_TONES, POS_BURST_TONE_NORM);
        return c14 + c6;
      },
    });
    return asGenerator(ts);
  },
};

// ---------------------------------------------------------------------------
// Benign epileptiform transients of sleep (BETS / "small sharp spikes") —
// very brief (<50 ms), low-amplitude (<50 uV) temporal spikes with NO
// following slow wave, benign, and the side alternates unpredictably between
// occurrences. Legacy modelled the alternation explicitly with a coin-flip
// `bets-side`; here two independent left/right sources (own schedules, own
// seeds) produce the same alternating, unsynchronised bitemporal pattern
// without needing that bookkeeping — whichever side's independent timer
// fires next IS the alternation.
// ---------------------------------------------------------------------------
type BetsEvent = { amp: number; decay: number };

function betsSide(id: string, electrode: string): PatternSourceDescriptor {
  return {
    id,
    toggles: ['bets'],
    spec: sourceUnder(id, [electrode], { extent: 0.3 }),
    make(seed, dt) {
      const ts = new TransientSource<BetsEvent>(seed, dt, {
        schedule: { kind: 'periodic', period: 6.5, jitterFrac: 0.38 }, // legacy 4-9 s
        duration: 0.05,
        onset: (g) => ({ amp: jit(g, 1, 0.3), decay: jit(g, 60, 0.2) }),
        morphology: (t, e) => 40 * e.amp * Math.exp(-t * e.decay),
      });
      return asGenerator(ts);
    },
  };
}

const betsL = betsSide('bets-l', 'T3');
const betsR = betsSide('bets-r', 'T4');

export const VARIANT_SOURCES: PatternSourceDescriptor[] = [
  muL, muR,
  wicketL, wicketR,
  rmtdL, rmtdR,
  lambda,
  pswy,
  sixHzSw,
  pos1406,
  betsL, betsR,
];

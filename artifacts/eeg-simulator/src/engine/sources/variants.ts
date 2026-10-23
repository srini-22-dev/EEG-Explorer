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

import { sourceUnder, synchronousPatches } from '../forward';
import { GENERALIZED_POSTERIOR, MU_FIELD, OCCIPITAL, POSTERIOR_TEMPORAL } from './fields';
import { Gaussian } from '../rng';
import { TransientSource } from './transient';
import {
  gaussian, arciformSignal, multiToneSignal,
  MU_TONES, MU_TONE_NORM,
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
  takeMarks: () => ts.takeMarks(),
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
// by cortex lining the central sulcus. That tempts a TANGENTIAL projection,
// and this source was built that way; it was wrong, for the same reason
// engine.ts:356 gives for the background mu. A tangential source is zero at
// its own anchor by construction, so the toggle rendered a rhythm maximal at
// F3/F4 with a phase reversal at C3/C4 — measured 1.00 at F3, 0.00 at C3.
// That is not mu. It contradicts this toggle's own annotation ("arciform
// 8-12 Hz at C3/C4"), IK-006, and every description a learner will read.
//
// The sulcal-wall argument is a real fact about the generator, but it is an
// idealisation: sensorimotor cortex contributes gyral-crown surface as well as
// sulcal wall, the central sulcus is oblique rather than a clean plane, and the
// recorded fact — the one this simulator has to reproduce — is a C3/C4 maximum.
// So this is RADIAL, like the background mu. Per CLAUDE.md §3, the observable
// wins over the tidier account of the generator.
//
// This variant is the prominent, clearly-arciform mu a learner is asked to
// identify; the engine's smoother, lower-amplitude background mu keeps running
// underneath it, and the two summing is intentional — not a duplicate.
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
//
// Field: `MU_FIELD` (fields.ts), the one the background mu uses — central
// maximum with a share at the parietal electrode behind it and at the vertex,
// learningeeg's "centroparietal regions along the parasagittal chains". It was a
// single patch under C3/C4 (extent 0.22) that gave P3/P4 1% of the central
// electrode: mu on the toggle sat on a narrower field than mu in the background.
// ---------------------------------------------------------------------------
type MuEnvelope = { slow: number; fast: number };

function muSide(id: string, weights: Record<string, number>): PatternSourceDescriptor {
  const geom = synchronousPatches(id, weights, { extent: 0.3 });
  return {
    id,
    toggles: ['mu-rhythm'],
    // A rhythm with no events, only a presence: a box on its side while it is on.
    openBox: {},
    spec: geom,
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

const muL = muSide('mu-l', MU_FIELD.left);
const muR = muSide('mu-r', MU_FIELD.right);

// ---------------------------------------------------------------------------
// Wicket spikes — 6-11 Hz arciform bursts over the mid-temporal region during
// drowsiness, benign, and the classic epileptiform mimic: what separates a
// wicket burst from a true temporal spike-and-wave is that a wicket has NO
// following slow wave. That negative feature is encoded structurally — the
// morphology below only ever calls `arciformSignal`, nothing shaped like
// `spikeSlowWave`. Real wicket activity is not synchronous between the two
// temporal lobes, so this is split into independent T3/T4 sources rather
// than the single shared timer the legacy code used.
//
// One burst is ONE frequency. learningeeg's atlas: "each wicket should be the
// same duration", in "very brief non-evolving runs". The band is where a burst's
// frequency is drawn from, not something one burst spans: 6-11 Hz ("theta- or
// alpha frequency range", Reiher & Lebel as quoted by StatPearls NBK555899;
// learningeeg says "usually 7-11 Hz"; IK-015 holds the wider range).
//
// Each burst used to be SEVEN tones from 6.2 to 11 Hz summed and divided by their
// combined amplitude. Seven tones of different frequency are almost never in
// phase, so the sum ran at a quarter of its nominal size — 12 uV at T3 for a
// nominal 50, measured — and no two arches in a burst were the same width.
//
// 70 uV nominal, so bursts peak at roughly 60-100 uV at T3: the foot of the
// 60-200 uV range given for wickets (AES atlas, NBK390343, as quoted by search).
// ---------------------------------------------------------------------------
type WicketEvent = { amp: number; dur: number; freq: number };

function wicketSide(id: string, electrode: string): PatternSourceDescriptor {
  return {
    id,
    toggles: ['wicket'],
    // eegpedia: "present in relaxed wakefulness, drowsiness, light sleep";
    // learningeeg: they "tend to be seen more in the drowsy state". Until
    // 2026-10-13 this was drowsiness alone, and IK-015 called them "absent in
    // relaxed wakefulness".
    states: ['awake', 'drowsy', 'n1', 'n2'],
    spec: sourceUnder(id, [electrode], { extent: 0.30 }),
    make(seed, dt) {
      const ts = new TransientSource<WicketEvent>(seed, dt, {
        schedule: { kind: 'periodic', period: 3.5, jitterFrac: 0.43 }, // legacy 2-5 s
        duration: 1.5,
        onset: (g) => ({ amp: jit(g, 1, 0.2), dur: jit(g, 0.9, 0.3), freq: g.range(6, 11) }),
        // The burst is the envelope's [0, dur]: 14% of its peak at either end.
        mark: (e) => ({ span: e.dur }),
        morphology: (t, e) => {
          const env = gaussian(t, e.dur / 2, e.dur / 4);
          // Arches pointed on the negative side (see arciformSignal).
          return 70 * e.amp * env * arciformSignal(t, [{ f: e.freq, a: 1 }], 1);
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
        // The whole event: its envelope is still 27% of the peak at either end, which
        // at 65 uV is visible, so a box over the middle alone left its edges out.
        mark: () => ({ span: 4 }),
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
// (unlike wicket/RMTD/BETS above) one source for both sides is the
// physiologically appropriate model, not an independent pair.
//
// Field: the bilateral occipital one POSTS use (fields.ts). learningeeg: lambda
// waves "look almost identical to POSTS" and, in a circumferential montage, are
// "very occipitally focused". The single patch this used to be sat on the old
// cortical shell, 4 cm under the occiput, and reached the parietal electrodes at
// 29-37% — so C3-P3 carried half of what P3-O1 did, against POSTS' 17%.
//
// Timing: a lambda wave follows a saccade, so they arrive irregularly. The gap
// is drawn from an exponential (mean 0.6 s after each 0.3 s event, the legacy
// rate of about one a second). It used to be 0.6-1.2 s uniform, which measured as
// an interval CV of 0.15 — as regular as the periodic discharges.
// ---------------------------------------------------------------------------
type LambdaEvent = { amp: number; dur: number };

const lambda: PatternSourceDescriptor = {
  id: 'lambda',
  toggles: ['lambda'],
  spec: synchronousPatches('lambda', OCCIPITAL, { extent: 0.3 }),
  make(seed, dt) {
    const ts = new TransientSource<LambdaEvent>(seed, dt, {
      schedule: { kind: 'renewal', meanInterval: 0.6 },
      // "Amplitude: 50 microV. Duration 200-300 msec" (eegpedia, Lambda waves). It
      // was 60 uV over 120-180 ms, briefer than the range given for it.
      duration: 0.3,
      onset: (g) => ({ amp: jit(g, 1, 0.25), dur: g.range(0.2, 0.3) }),
      mark: (e) => ({ dur: e.dur }),
      morphology: (t, e) => (t < e.dur ? 50 * e.amp * Math.sin(Math.PI * t / e.dur) : 0),
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
// fell off at P3/P4 (0.67): an occipital maximum with a parietal share, built
// here as patches under those four electrodes. The single patch at their mean
// position that this used to be sat on the midline between them, so Pz read as
// large as O1/O2 and the biggest row on the page was Cz-Pz.
// ---------------------------------------------------------------------------
type PswyEvent = { dur: number };

const pswy: PatternSourceDescriptor = {
  id: 'pswy',
  toggles: ['pswy'],
  states: ['awake'],
  spec: synchronousPatches('pswy', { O1: 1, O2: 1, P3: 0.5, P4: 0.5 }, { extent: 0.3 }),
  make(seed, dt) {
    const ts = new TransientSource<PswyEvent>(seed, dt, {
      schedule: { kind: 'periodic', period: 3.75, jitterFrac: 0.33 }, // legacy 2.5-5.0 s
      duration: 2.0,
      onset: (g) => ({ dur: jit(g, 1.0, 0.3) }),
      mark: (e) => ({ span: e.dur }),
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
// 6 Hz phantom spike-wave — brief runs of low-amplitude generalised spike-and-
// wave near 6 Hz, benign, seen in drowsiness. "Phantom" because the spike is
// fleeting: "very low amplitude spikes followed by an equally tiny slow wave"
// (learningeeg, Normal Variants); a low-amplitude, fast spike "followed by a 5 to
// 7 Hz wave of equal or greater amplitude", in bursts of 1-2 s (StatPearls,
// Normal EEG Variants, NBK555899, as quoted by search).
//
// Two forms are taught: FOLD (female, occipital, low amplitude, drowsy), the
// classic benign one, and WHAM (waking, high amplitude, anterior, male), whose
// link to epilepsy is not settled. This toggle is the benign variant, so it is
// FOLD: posterior maximum (fields.ts), drowsiness and N1 only.
//
// It used to be one patch under Cz, awake, with a 50 uV spike on a 30 uV wave —
// the spike LARGER than the wave, which is the opposite of phantom, on a field
// that put 40 uV on Fz-Cz and nothing on the temporal chains. Now a 25 uV spike
// on a 45 uV wave at the source, ~14 and ~25 uV at the occipital electrodes.
// ---------------------------------------------------------------------------
type SixHzEvent = { amp: number; dur: number };

const sixHzSw: PatternSourceDescriptor = {
  id: '6hz-sw',
  toggles: ['6hz-sw'],
  states: ['drowsy', 'n1'],
  spec: synchronousPatches('6hz-sw', GENERALIZED_POSTERIOR, { extent: 0.3 }),
  make(seed, dt) {
    const ts = new TransientSource<SixHzEvent>(seed, dt, {
      schedule: { kind: 'periodic', period: 4.5, jitterFrac: 0.33 }, // legacy 3-6 s
      duration: 2.0, // upper bound on the per-burst length drawn below
      // 1-2 s, as a whole number of 6 Hz cycles (6 to 12) so the run ends between
      // complexes rather than being cut off part-way through a wave.
      onset: (g) => ({ amp: jit(g, 1, 0.2), dur: Math.round(g.range(6, 12)) / 6 }),
      mark: (e) => ({ span: e.dur }),
      morphology: (t, e) => {
        if (t >= e.dur) return 0;
        const cyc = t % (1 / 6);
        // Surface-negative spike and a wave of the same polarity — the convention
        // of spikeSlowWave (see morphology.ts), of which this is the 6 Hz case.
        const spike = -25 * e.amp * gaussian(cyc, 0.02, 0.008);
        const wave = -45 * e.amp * gaussian(cyc, 0.1, 0.035);
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
// and PSWY — this stays a single source for both sides ("bilateral and
// synchronous", learningeeg), on the posterior temporal field (fields.ts).
//
// It used to be anchored "at the mean of T5 and T6" — which is a point on the
// midline between them, under the occiput. The bursts came out largest at O1/O2
// with T5/T6 at 36%: a posterior TEMPORAL variant drawn as an occipital one.
// Amplitudes are the legacy 28 and 18 uV scaled by 1.6, for bursts of ~35 uV at
// T5/T6: 20-60 uV is the usual range and they rarely exceed 75 (EEG Atlas and
// StatPearls NBK555899, as quoted by search).
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
  spec: synchronousPatches('14-6-pos', POSTERIOR_TEMPORAL, { extent: 0.3 }),
  make(seed, dt) {
    const ts = new TransientSource<Pos1406Event>(seed, dt, {
      schedule: { kind: 'periodic', period: 6, jitterFrac: 0.33 }, // legacy 4-8 s
      duration: 1.0,
      onset: (g) => ({ ratio: jit(g, 0.6, 0.4) }),
      // The whole event (its envelope is 14% of the peak at either end).
      mark: () => ({ span: 1 }),
      morphology: (t, e) => {
        const env = gaussian(t, 0.5, 0.25);
        // 14 & 6 Hz POSITIVE bursts are named for their polarity: each arch is
        // pointed on its surface-positive side, which the canvas draws DOWN. That
        // is the arch itself now (arciformSignal, sharp = +1). It used to be a
        // tilted wave with its positive half scaled up by 1.6 to force a polarity,
        // which also left every burst standing on an offset.
        const c14 = 45 * e.ratio * arciformSignal(t, POS14_TONES, POS_BURST_TONE_NORM, 0, 1);
        const c6 = 29 * (1 - e.ratio) * arciformSignal(t, POS6_TONES, POS_BURST_TONE_NORM, 0, 1);
        return env * (c14 + c6);
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
    // BETS ("small sharp spikes") are a phenomenon of drowsiness and light
    // sleep, not relaxed wakefulness — state-gate them like the other drowsy
    // benign variants (wicket, rmtd, 14-6-pos) rather than letting the toggle
    // fire while awake.
    states: ['drowsy', 'n1', 'n2'],
    spec: sourceUnder(id, [electrode], { extent: 0.3 }),
    make(seed, dt) {
      const ts = new TransientSource<BetsEvent>(seed, dt, {
        schedule: { kind: 'periodic', period: 6.5, jitterFrac: 0.38 }, // legacy 4-9 s
        duration: 0.05,
        onset: (g) => ({ amp: jit(g, 1, 0.3), decay: jit(g, 60, 0.2) }),
        // It is largest at its onset, so the arrow's window starts just before it.
        mark: () => ({ at: -0.02, dur: 0.08 }),
        // Surface-negative, like the other sharp transients — small sharp spikes
        // have a steep negative ascending limb. Was positive, which under the
        // corrected negative-up canvas would point them the wrong way.
        morphology: (t, e) => -40 * e.amp * Math.exp(-t * e.decay),
      });
      return asGenerator(ts);
    },
  };
}

const betsL = betsSide('bets-l', 'T3');
const betsR = betsSide('bets-r', 'T4');

// ---------------------------------------------------------------------------
// Eyes open — the posterior dominant rhythm (alpha) is a resting, eyes-closed
// idling rhythm; opening the eyes desynchronises the occipital generator (the
// Berger effect / "alpha blocking"). Mu is NOT gated here: it is a sensorimotor
// rhythm, indifferent to visual input, and blocks with movement or the intention
// to move instead. Its persistence through eye opening is precisely one of the
// features that separates it from posterior alpha (IK-006/IK-007), so gating mu
// alongside alpha would erase that discriminator — a learner would watch a
// central rhythm block for the wrong reason.
//
// The attenuation itself is applied by the ENGINE (engine.ts, EYES_OPEN_ALPHA_GAIN),
// not by a bandGate here, because the `eye-opening` maneuver must block the same
// rhythm over its open interval and the two must not disagree; the engine also gives
// the transition its latency instead of a one-sample step. This descriptor exists so
// the toggle has a source (CLAUDE.md §8) and draws nothing of its own.
// ---------------------------------------------------------------------------
const eyesOpen: PatternSourceDescriptor = {
  id: 'eyes-open',
  toggles: ['eyes-open'],
  // What it changes is the background (alpha blocked), not one region: a box over
  // the whole page while the eyes are open.
  openBox: { label: 'Eyes open', where: 'page' },
  spec: sourceUnder('eyes-open', ['Cz'], { extent: 0.5 }),
  make() {
    return { next: () => 0 };
  },
};

// ---------------------------------------------------------------------------
// Midline theta rhythm (Cigánek) — a 4-7 Hz arch-shaped or sinusoidal train over
// the vertex, a normal variant of wakefulness and drowsiness. "The midline theta
// rhythm is typically a 4- to 7-Hz arch-shaped or sinusoidal rhythm", "typically
// maximum over CZ", in a table as "Midline (CZ, FZ), parasagittal", "Brief or
// lasting many seconds", and "Midline theta is seen during wakefulness and
// drowsiness" (Patterns of Unclear Significance, neupsykey.com); "4-7 Hz midline
// (vertex)", "seen in awake or drowsy states", "normal variant" (EEG Atlas online,
// Ciganek rhythm).
//
// It was part of the awake and drowsy BACKGROUND until 2026-10-23: a burst under Fz
// every ~4.5 s with no toggle and no annotation. The owner: "everything should have
// an intention, so annotations should be easy, whatever is present in the signals
// should be by design" — so it is a toggle of its own, off unless chosen, each train
// boxed.
//
// Sourced: the band, the vertex maximum with Fz and the parasagittal sites, the
// states, and the size: eegpedia gives it as over 50 uV (recorded in the idea vault
// on 2026-10-14; the page would not load to re-read on 2026-10-23), and 60 uV at the
// source puts 62-72 uV at Cz against the ear, 40-49 at Fz (isolated peak, subjects
// 3/7/11). A DESIGN, not sourced: the field's weights (no figure was traced), trains
// of 2-7 s (inside "brief or lasting many seconds", short enough to see whole on a
// page) and a mean gap of 8 s between them.
// ---------------------------------------------------------------------------
type MidlineThetaEvent = { amp: number; dur: number; freq: number };

const midlineTheta: PatternSourceDescriptor = {
  id: 'midline-theta',
  toggles: ['midline-theta'],
  states: ['awake', 'drowsy'],
  spec: synchronousPatches('midline-theta', { Cz: 1, Fz: 0.7, Pz: 0.4, C3: 0.3, C4: 0.3 }, { extent: 0.3 }),
  make(seed, dt) {
    const ts = new TransientSource<MidlineThetaEvent>(seed, dt, {
      schedule: { kind: 'renewal', meanInterval: 8 },
      duration: 7,
      onset: (g) => ({ amp: jit(g, 1, 0.2), dur: g.range(2, 7), freq: g.range(5, 7) }),
      mark: (e) => ({ span: e.dur }),
      morphology: (t, e) => {
        if (t >= e.dur) return 0;
        // One frequency per train, with 0.4 s raised-cosine edges so it starts and
        // ends without a step.
        const ramp = Math.min(1, t / 0.4, (e.dur - t) / 0.4);
        const env = 0.5 - 0.5 * Math.cos(Math.PI * ramp);
        return 60 * e.amp * env * Math.sin(2 * Math.PI * e.freq * t);
      },
    });
    return asGenerator(ts);
  },
};

export const VARIANT_SOURCES: PatternSourceDescriptor[] = [
  muL, muR,
  wicketL, wicketR,
  rmtdL, rmtdR,
  lambda,
  pswy,
  sixHzSw,
  pos1406,
  betsL, betsR,
  eyesOpen,
  midlineTheta,
];

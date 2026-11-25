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

import { sourceUnder, synchronousPatches, tangentialAt } from '../forward';
import {
  GENERALIZED_POSTERIOR, MU_FIELD, OCCIPITAL, POSTERIOR_TEMPORAL, mirrored,
} from './fields';
import { Gaussian, deriveSeed } from '../rng';
import { TransientSource } from './transient';
import {
  gaussian, arciformSignal,
  MU_TONES, MU_TONE_NORM,
  POS_BURST_TONE_NORM,
} from './morphology';
import type { PatternSourceDescriptor, PatternGenerator } from './registry';
import type { PatientState, SixHzForm, Pos146Sides } from '../../utils/simTypes';

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
// Singles (2026-10-27). Wickets come "as single discharges or runs" (SCORE normal
// variants study, Clin Neurophysiol Pract 2022, PMC9294211); "short runs of 6-11Hz
// spikes, sometimes single spike" (eegpedia). No source gives the share; one in
// three is a design that puts a single on most pages that carry wickets.
//
// Rebuilt 2026-11-16 against the owner's references (a clinical bipolar record and
// a teaching figure) and Gelisse, Benbadis, Crespel & Tatum, J Neurol 2024
// 271:3869 (open access): wickets "appear most often in bursts with a typical
// morphology of diamond or lozenge-shaped", "occasionally singly", and a single's
// morphology "is identical to the morphology of the most sharply contoured
// waveforms in the runs". Until then each burst was 8-10 mathematically identical
// arches under a Gaussian (spindle) envelope, about 5x the background on T3-T5,
// and a single was a needle taller than any run. Now:
//  - a run was 4-7 arches (the references show short runs, a handful of waves;
//    lengthened the same day, below);
//  - its envelope is a diamond: a straight crescendo to a peak somewhere in the
//    middle third and a straight decrescendo, starting and ending at about a third
//    of the peak, not swelling out of nothing;
//  - each arch is a whole cycle, starting and ending at a zero crossing, with its
//    own height (+-12%) and width (+-4%) about the run's: one frequency and one
//    shape, as every source requires, but not copies of one another (owner: "they
//    should not all be identical"); runs differ in length, size (+-25%) and where
//    the peak falls;
//  - the arch is drawn, not summed from tones: a rounded half-sine over 57% of the
//    cycle (the broad, surface-positive side) and a straight-legged spike over the
//    other 43% (the sharp side, negative: IFCN, "spike-like monophasic surface
//    negative"), the spike sized so the cycle has zero mean — about 1.7x the
//    rounded lobe — so a run rides on no slow offset and leaves no slow wave. A
//    tone sum was tried first (fundamental + 0.45 2nd + 0.15 3rd harmonic): its
//    broad side came out a flat plateau and a run read as a square-wave comb;
//  - a single is the run's peak arch on its own, at a run's size.
// Amplitude: 52 uV at the apex under T3 for a mid-sized run's peak arch. The
// references put a run at about twice the background's height on its row; that
// ratio would put wickets near 40 uV here, under the AES atlas's 60-200 uV
// (NBK390343) — a conflict between the two, settled at the AES floor at T3.
//
// Longer, less regular, less mirrored (owner, 2026-11-16, against learningeeg's
// wicket figure and a clinical record). Measured on those pages: runs of 1-2 s on
// a 10 s/page record and about 4 s (~25 waves at ~7 Hz) on learningeeg's, waxing
// and waning more than once; and F7-T3, T3-T5 and T5-O1 each carrying the rhythm at
// their own size and shape, not as inverted copies of one another. So:
//  - a run's length is drawn log-uniformly from 0.4 to 4 s (median ~1.3 s); the
//    arch count is that times its frequency, at least 3. Runs of 8 arches or fewer
//    keep the diamond above (Gelisse 2024); longer ones wax and wane — one to three
//    swells under a taper of about three arches at each end, still starting and
//    ending at about a third of the peak;
//  - each arch has its own split between the rounded lobe and the spike (57% +-10%
//    of the cycle), so the spike's width varies with it, its own period (+-8%, was
//    4%) and its own height (+-20%, was 12%): one frequency still, but no two
//    arches the same shape;
//  - the field is two generators per side. The main one under T3 (T4) as before,
//    and a second under T5 (T6) carrying the same arches, each at its own 50-100%
//    of the main and 15-40% of a cycle behind it (14-67 ms). With one generator
//    F7-T3 and T3-T5 were exact
//    negatives (a phase reversal at T3 and nothing else); with two they still
//    reverse at T3, but their size and shape differ arch by arch, and T5-O1 carries
//    the run as well, as on the references. (A second generator midway between T3
//    and T5, tried first, raised both electrodes alike and left the mirror as it
//    was.) No source gives this split; it is a design that reproduces the references.
// The window is the longest run (4 s at 6 Hz, +6%) and the gap after it 1-2 s, so
// an event starts every ~5.8 s (was ~5 s) and a 4 s run still leaves room around it.
// ---------------------------------------------------------------------------
const WICKET_SINGLE_SHARE = 1 / 3;
const WICKET_APEX_UV = 52;
// A single at the size of a run's largest wave. At full nominal it measured 1.14x
// the median run peak (gate, 2026-11-16): a run's largest arch rarely sits at the
// diamond's exact apex and carries its own jitter, so runs peak a little under it.
// Re-measured when runs grew longer (2026-11-16): more arches put a run's largest a
// little higher, and at 0.88 a single read 0.79 of it; 1.1 puts it back near 1.
const WICKET_SINGLE_GAIN = 1.1;
const WICKET_RUN_S = [0.4, 4] as const;
const WICKET_DIAMOND_MAX = 8;
const WICKET_W1 = 0.57;
// One arch over a cycle u in [0, 1): the rounded lobe on [0, w1), the spike on
// [w1, 1) with its apex (-1) at the middle. Both lobes start and end at zero, so
// neighbouring arches of different height meet without a step. Zero mean: the
// spike's area (w2 / 2) equals the lobe's (lobe * w1 * 2 / pi).
function wicketShape(u: number, w1: number): number {
  const w2 = 1 - w1;
  if (u < w1) return ((w2 / 2) / (w1 * 2 / Math.PI)) * Math.sin(Math.PI * u / w1);
  return -(1 - Math.abs(2 * (u - w1) / w2 - 1));
}
type WicketEvent = {
  single: boolean; freq: number; amp: number;
  starts: number[]; periods: number[]; amps: number[]; w1s: number[];
  // The second generator: its gain per arch (one for a single) and its lag, as a
  // fraction of a cycle.
  g2: number[]; lag: number;
};

function wicketEvent(g: Gaussian): WicketEvent {
  const freq = g.range(6, 11), amp = jit(g, 1, 0.25);
  const single = g.uniform() < WICKET_SINGLE_SHARE;
  const lag = g.range(0.15, 0.4);
  if (single) {
    return { single, freq, amp, starts: [], periods: [], amps: [], w1s: [jit(g, WICKET_W1, 0.18)], g2: [g.range(0.5, 1)], lag };
  }
  const len = WICKET_RUN_S[0] * Math.pow(WICKET_RUN_S[1] / WICKET_RUN_S[0], g.uniform());
  const n = Math.max(3, Math.round(len * freq));
  const edge = g.range(0.25, 0.35);
  // Diamond for a short run; for a long one, 1-3 swells (more for longer runs)
  // under an end taper of about three arches.
  const peakAt = g.range(0.35, 0.65);
  const swells = 1 + Math.min(2, Math.floor(g.uniform() * n / 10));
  const phase = g.uniform() * 2 * Math.PI;
  const starts: number[] = [], periods: number[] = [], w1s: number[] = [], g2: number[] = [];
  for (let k = 0, t = 0; k < n; k++) {
    const p = jit(g, 1 / freq, 0.08);
    starts.push(t); periods.push(p); t += p;
    w1s.push(jit(g, WICKET_W1, 0.18));
    g2.push(g.range(0.5, 1));
  }
  const T = starts[n - 1] + periods[n - 1];
  const shape: number[] = [];
  for (let k = 0; k < n; k++) {
    const x = (starts[k] + periods[k] / 2) / T;          // the arch's centre, 0-1 of the run
    if (n <= WICKET_DIAMOND_MAX) {
      shape.push(x < peakAt ? x / peakAt : (1 - x) / (1 - peakAt));
    } else {
      const ta = 3 / n;
      const taper = Math.min(1, x / ta, (1 - x) / ta);
      shape.push(taper * (0.55 + 0.45 * Math.sin(2 * Math.PI * swells * x + phase)));
    }
  }
  const top = Math.max(...shape);
  const amps = shape.map(s => jit(g, edge + (1 - edge) * s / top, 0.2));
  return { single, freq, amp, starts, periods, amps, w1s, g2, lag };
}

/** One generator's share of a wicket event at `t`: the second lags and scales by g2. */
function wicketValue(t: number, e: WicketEvent, second: boolean): number {
  if (second) t -= e.lag / e.freq;
  if (t < 0) return 0;
  if (e.single) {
    // The apex at the middle of one period, the broad side tapered off by a
    // Hann window so it stands alone as a monophasic spike-like wave.
    const w1 = e.w1s[0], apexU = w1 + (1 - w1) / 2;
    const v = t * e.freq - 0.5;
    if (Math.abs(v) >= 0.5) return 0;
    const u = (apexU + v + 1) % 1;
    return (second ? e.g2[0] : 1) * WICKET_APEX_UV * WICKET_SINGLE_GAIN * e.amp
      * 0.5 * (1 + Math.cos(2 * Math.PI * v)) * wicketShape(u, w1);
  }
  for (let k = e.starts.length - 1; k >= 0; k--) {
    if (t < e.starts[k]) continue;
    const u = (t - e.starts[k]) / e.periods[k];
    if (u >= 1) return 0;
    return (second ? e.g2[k] : 1) * WICKET_APEX_UV * e.amp * e.amps[k] * wicketShape(u, e.w1s[k]);
  }
  return 0;
}

/**
 * One wicket generator. `stream` names the event stream: the main generator and
 * the second one on the same side share it (same seed), so they draw the same
 * events; only the main one marks them.
 */
function wicketSide(id: string, stream: string, spec: PatternSourceDescriptor['spec'], second: boolean): PatternSourceDescriptor {
  return {
    id,
    toggles: ['wicket'],
    // eegpedia: "present in relaxed wakefulness, drowsiness, light sleep";
    // learningeeg: they "tend to be seen more in the drowsy state". Until
    // 2026-10-13 this was drowsiness alone, and IK-015 called them "absent in
    // relaxed wakefulness".
    states: ['awake', 'drowsy', 'n1', 'n2'],
    spec,
    make(_seed, dt, subjectSeed) {
      const ts = new TransientSource<WicketEvent>(deriveSeed(subjectSeed, stream), dt, {
        schedule: { kind: 'periodic', period: 1.5, jitterFrac: 0.33 },
        duration: WICKET_RUN_S[1] * 1.06 + 0.1,
        onset: wicketEvent,
        // A run is a box over its arches; a single is an arrow over its one arch.
        mark: (e) => (second ? null : e.single
          ? { at: 0, dur: 1 / e.freq }
          : { span: e.starts[e.starts.length - 1] + e.periods[e.periods.length - 1] }),
        morphology: (t, e) => wicketValue(t, e, second),
      });
      return asGenerator(ts);
    },
  };
}

const wicketL = wicketSide('wicket-l', 'wicket-l', sourceUnder('wicket-l', ['T3'], { extent: 0.30 }), false);
const wicketR = wicketSide('wicket-r', 'wicket-r', sourceUnder('wicket-r', ['T4'], { extent: 0.30 }), false);
const wicketL2 = wicketSide('wicket-l2', 'wicket-l', sourceUnder('wicket-l2', ['T5'], { extent: 0.30 }), true);
const wicketR2 = wicketSide('wicket-r2', 'wicket-r', sourceUnder('wicket-r2', ['T6'], { extent: 0.30 }), true);

// ---------------------------------------------------------------------------
// Rhythmic mid-temporal theta of drowsiness (RMTD; "rhythmic temporal theta of
// drowsiness" in SCORE; formerly "psychomotor variant") — trains of theta at ONE
// frequency over the mid-temporal region. What tells it from a seizure is that it
// does not evolve: eegpedia, "does not change in frequency or form, in contrast to an
// epileptic discharge"; learningeeg, "the lack of evolution".
//
// Sources (2026-10-27): eegpedia — "Trains of rhythmic theta waves 5-7Hz", "Duration
// 5-10sec", "Located in midtemporal region", "Often unilateral", "May be
// bisynchronous, with shifting asymmetry", "Present in relaxed wakefulness and
// drowsiness". SCORE normal variants study (PMC9294211) — 5-7 Hz trains, "mostly seen
// during drowsiness and light sleep, even though it can be occasionally seen in awake
// patients", maximum "usually mid-temporal but may sometimes spread to the
// parasagittal or occipito-temporal regions", "arch-shaped and often notched".
// learningeeg — "sharply contoured", "usually a few seconds"; its figure's three
// boxed runs are about 2 s each at ~6 Hz on the left temporal chain (measured), and
// eegpedia's right temporal figure runs the whole 10 s page.
//
// So: each train draws one frequency in 5-7 Hz and a length of 2-10 s, on a flat-topped
// envelope; half the trains are notched (a small third harmonic, which dents the broad
// half of each wave — "frequently notched by faster waves", IFCN glossary); the field is
// T3 with shares at T5 and F7, the temporal chain learningeeg's figure has it on (F7-T3,
// T3-T5, and T5-O1 in its first run); the two sides are independent sources, so trains
// come one-sided or on both sides out of step. The mid-temporal regional field of the
// temporal seizure, tried first, carries C3 at 0.35 and put F3-C3 and C3-P3 at 0.43-0.56
// of the temporal rows: more than SCORE's "may sometimes spread to the parasagittal". A
// third harmonic of 0.3-0.4 split each broad half in two, which read as double the
// frequency; 0.12-0.2 dents it.
//
// Until 2026-10-27 every train summed three tones at 5.7, 6.0 and 6.3 Hz — which beat,
// so the "one frequency" drifted within a train — under a Gaussian 4 s window, with a
// smooth sinusoidal shape, in drowsiness only, on one patch under T3/T4.
// The amplitude (65 uV at the source) has no source; it is kept from before.
// ---------------------------------------------------------------------------
const RMTD_FREQ_HZ: [number, number] = [5, 7];
const RMTD_DUR_S: [number, number] = [2, 10];
const RMTD_EDGE_S = 0.4;
type RmtdEvent = { amp: number; dur: number; freq: number; notch: number };

// One arch per cycle, pointed on the negative side (as arciformSignal), with an
// optional small third harmonic that dents the broad half of the wave.
const RMTD_ZERO_PHASE = Math.acos((-1 + Math.sqrt(1.98)) / 1.4);
function rmtdWave(t: number, f: number, notch: number): number {
  const th = 2 * Math.PI * f * t + RMTD_ZERO_PHASE;
  return -(Math.cos(th) + 0.35 * Math.cos(2 * th) - notch * Math.cos(3 * th)) / 1.35;
}

function rmtdSide(id: string, field: Record<string, number>): PatternSourceDescriptor {
  return {
    id,
    toggles: ['rmtd'],
    states: ['awake', 'drowsy', 'n1', 'n2'],
    spec: synchronousPatches(id, field, { extent: 0.3 }),
    make(seed, dt) {
      const ts = new TransientSource<RmtdEvent>(seed, dt, {
        // The gap after each train; the event itself lasts its drawn length. RMTD comes
        // in trains (eegpedia "Trains of rhythmic theta"; learningeeg "usually lasting a
        // few seconds"), with the background between them. The gap was 3-6 s, so with
        // 2-10 s trains on two independent sides a train was running about 80% of the
        // time and the pattern read as continuous (owner's inbox, 2026-11-25: "RMTD is
        // currently continuous, but it should be intermittent"). 10-30 s now: about 40%
        // with a train on either side, and quiet stretches of tens of seconds. No source
        // gives the spacing; it is the owner's call.
        schedule: { kind: 'periodic', period: 20, jitterFrac: 0.5 },
        duration: RMTD_DUR_S[1],
        onset: (g) => ({
          amp: jit(g, 1, 0.1),
          dur: g.range(...RMTD_DUR_S),
          freq: g.range(...RMTD_FREQ_HZ),
          notch: g.uniform() < 0.5 ? g.range(0.12, 0.2) : 0,
        }),
        mark: (e) => ({ span: e.dur }),
        morphology: (t, e) => {
          if (t >= e.dur) return 0;
          const edge = Math.min(1, t / RMTD_EDGE_S, (e.dur - t) / RMTD_EDGE_S);
          const env = 0.5 - 0.5 * Math.cos(Math.PI * edge);
          return 65 * e.amp * env * rmtdWave(t, e.freq, e.notch);
        },
      });
      return asGenerator(ts);
    },
  };
}

const RMTD_FIELD: Record<string, number> = { T3: 1, T5: 0.4, F7: 0.3 };
const rmtdL = rmtdSide('rmtd-l', RMTD_FIELD);
const rmtdR = rmtdSide('rmtd-r', mirrored(RMTD_FIELD));

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
// Posterior slow waves of youth (PSWY), and the slow-fused transient built on them.
//
// PSWY. IFCN glossary (Kane et al. 2017): "Isolated slow waves intermixed with the
// posterior dominant rhythm in young people (typically 4–25 years of age). See
// slow-fused transients." learningeeg (Pediatric): "rather high amplitude, spike-like
// waveforms that exist within the PDR and similarly attenuate with eye opening; they
// are often but not always bilateral, and can predominate on one side or the other",
// and the slow wave "is surrounded by the PDR without really interrupting it". So each
// event is ONE slow wave, 2.5-4.5 Hz in its own length (a wave of 0.22-0.4 s), with
// the alpha rhythm carrying on round it (nothing here gates the PDR), on the
// occipital electrodes with a parietal share (the legacy PSWY_FIELD table: O1/O2 1,
// P3/P4 0.67, built as patches). Two sources, one per side, on ONE shared schedule:
// each wave is bilateral (six in ten, the second side 0.6-1 of the first) or on one
// side only; the shares are a design for "often but not always bilateral". Surface-
// negative, which no source states; it is the polarity the slow-fused transient
// needs to pass for a spike-and-slow-wave, which is what the glossary says it does.
// The size (80 uV at O1, about twice the PDR's peak there) is a design for "rather high
// amplitude". Until 2026-10-27 each event was a 2 s burst of four summed tones
// (2.7-4.3 Hz): a run of slow activity, not an isolated wave.
//
// Slow-fused transient (its own toggle, 2026-10-27). IFCN glossary: "A sharply
// contoured component of the normal posterior dominant rhythm precedes a posterior
// slow wave of youth, giving the false impression of a spike-and-slow-wave." SCORE
// normal variants study (PMC9294211): "by coincidence, a non-epileptiform sharp
// transient precedes a posterior slow-wave of youth", "Browsing the entire recording
// the two phenomena (sharp transients and slow-wave) are usually observed several
// times, dissociated from each other"; median age 16. So the toggle draws three
// kinds of event on the PSWY field: the fused pair (a sharply contoured wave of alpha
// length, ~90 ms, peaking 70 ms before the slow wave starts, at 0.6 of its size), the
// slow wave alone, and the sharp wave alone — four, three and three in ten, a design.
// The fused pair is boxed; a lone wave or sharp transient gets an arrow.
// ---------------------------------------------------------------------------
type YouthKind = 'fused' | 'wave' | 'sharp';
type YouthEvent = { kind: YouthKind; len: number; amp: number; left: number; right: number };
const PSWY_UV = 80;
const SFT_SHARP_SIGMA_S = 0.018;
const SFT_SHARP_LEAD_S = 0.07;
const SFT_SHARP_SHARE = 0.6;
const PSWY_LEFT = { O1: 1, P3: 0.67 };

function youthSide(
  id: string, toggle: string, side: 'left' | 'right', kinds: [YouthKind, number][],
): PatternSourceDescriptor {
  // The sharp wave sits SFT_SHARP_LEAD_S before the slow wave, so every event starts
  // with room for it and the slow wave starts at the same offset whatever the kind.
  const waveAt = SFT_SHARP_LEAD_S + 3 * SFT_SHARP_SIGMA_S;
  const label: Record<YouthKind, string> = { fused: 'Slow-fused transient', wave: 'PSWY', sharp: 'Sharp transient' };
  return {
    id,
    toggles: [toggle],
    states: ['awake'],
    spec: synchronousPatches(id, side === 'left' ? PSWY_LEFT : mirrored(PSWY_LEFT), { extent: 0.3 }),
    make(_seed, dt, subjectSeed) {
      const ts = new TransientSource<YouthEvent>(deriveSeed(subjectSeed ?? _seed, toggle), dt, {
        schedule: { kind: 'renewal', meanInterval: 2.5 },
        duration: 0.6,
        onset: (g) => {
          let u = g.uniform(), kind = kinds[kinds.length - 1][0];
          for (const [k, share] of kinds) { if (u < share) { kind = k; break; } u -= share; }
          const len = 1 / g.range(2.5, 4.5);
          const amp = jit(g, 1, 0.2);
          const w = g.uniform(), second = g.range(0.6, 1);
          const [left, right] = w < 0.3 ? [1, second] : w < 0.6 ? [second, 1] : w < 0.8 ? [1, 0] : [0, 1];
          return { kind, len, amp, left, right };
        },
        mark: (e) => {
          if ((side === 'left' ? e.left : e.right) === 0) return null;
          const from = e.kind === 'wave' ? waveAt : SFT_SHARP_LEAD_S;
          const to = e.kind === 'sharp' ? waveAt : waveAt + e.len;
          return e.kind === 'fused'
            ? { label: label.fused, at: from, span: to - from }
            : { label: label[e.kind], at: from, dur: to - from };
        },
        morphology: (t, e) => {
          const k = side === 'left' ? e.left : e.right;
          if (k === 0) return 0;
          let v = 0;
          if (e.kind !== 'sharp') {
            const u = (t - waveAt) / e.len;
            if (u > 0 && u < 1) v -= Math.sin(Math.PI * u) ** 2;
          }
          if (e.kind !== 'wave') v -= SFT_SHARP_SHARE * gaussian(t, SFT_SHARP_LEAD_S + SFT_SHARP_SIGMA_S, SFT_SHARP_SIGMA_S);
          return PSWY_UV * e.amp * k * v;
        },
      });
      return asGenerator(ts);
    },
  };
}

const pswyL = youthSide('pswy', 'pswy', 'left', [['wave', 1]]);
const pswyR = youthSide('pswy-r', 'pswy', 'right', [['wave', 1]]);
const sftL = youthSide('slow-fused', 'slow-fused', 'left', [['fused', 0.4], ['wave', 0.3], ['sharp', 0.3]]);
const sftR = youthSide('slow-fused-r', 'slow-fused', 'right', [['fused', 0.4], ['wave', 0.3], ['sharp', 0.3]]);

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
//
// WHAM (2026-10-27, the toggle's Form option; FOLD stays the default). eegpedia: "WHAM:
// Waking, High amplitude spike (>45uV), Anterior, Male", "Associated with epilepsy
// especially when high amplitude spikes, rate <5-6Hz and persists during deep sleep";
// "FOLD: Female, Occipital, Low amplitude spike, Drowsy", "Not associated with
// epilepsy". SCORE normal variants study (PMC9294211): "low-voltage-spikes (<25 µV) of
// brief duration (<30 ms)", WHAM's "amplitude is mostly higher over the fronto-central
// regions". eegpedia's WHAM figure (average reference): a brief run of two or three
// complexes, largest at F3, Fz and F4, smaller at the frontopolar, anterior temporal and
// central electrodes and least behind, the spike plain to see.
// So WHAM takes a fronto-central field read off that figure (its rows could not be
// traced reliably through the discharge, so the reading is the picture, not row
// figures, and the weights are a design): Fz and F3/F4 largest, the frontopolar,
// anterior temporal and central electrodes about half, a little at the parietal row,
// nothing over the occiput or the posterior temporal electrodes. The generalized
// frontal field the 3 Hz discharges use reaches O1/O2 at 0.35, which on the average
// reference turned into an O1 row 0.79 the size of Fz's. A 70 uV spike on a 50 uV
// wave, so the spike stands over 45 uV against the ear (the discharge peaks at ~72 uV on F3-A1,
// 13 on P3-A1, 0 on O1-A1, measured); awake as well as drowsy.
// Both forms draw a spike 6 ms in sigma (about 25 ms at the base), under SCORE's 30 ms;
// FOLD's was 8 ms. FOLD's spike is now 20 uV at the source, so with its +/-20% per-run
// size it stays under SCORE's 25 uV (it was 25, reaching 30). One source per form, both
// on the toggle; the one the option does not name stays silent.
// ---------------------------------------------------------------------------
type SixHzEvent = { amp: number; dur: number; f: number };

function sixHzForm(
  id: string, form: SixHzForm, field: Record<string, number>, spikeUv: number, waveUv: number,
  states: PatientState[],
): PatternSourceDescriptor {
  return {
    id,
    toggles: ['6hz-sw'],
    states,
    spec: synchronousPatches(id, field, { extent: 0.3 }),
    make(seed, dt) {
      const ts = new TransientSource<SixHzEvent>(seed, dt, {
        schedule: { kind: 'periodic', period: 4.5, jitterFrac: 0.33 }, // legacy 3-6 s
        duration: 2.0, // upper bound on the per-burst length drawn below
        // 1-2 s, as a whole number of cycles so the run ends between complexes rather
        // than being cut off part-way through a wave. Each run at its own frequency in
        // 5-7 Hz (eegpedia "6Hz (5-7Hz)"; learningeeg "5-7 Hz"); it was exactly 6 Hz
        // every time (owner's inbox, 2026-11-25: "a little wrong").
        onset: (g) => {
          const f = g.range(5, 7);
          return { amp: jit(g, 1, 0.2), f, dur: Math.round(g.range(f, 2 * f)) / f };
        },
        mark: (e) => ({ span: e.dur }),
        morphology: (t, e) => {
          if (t >= e.dur) return 0;
          // The complex keeps its place in the cycle at any frequency: the spike at 0.12
          // of the period, the wave at 0.6 (at 6 Hz: 20 ms and 100 ms, as before).
          const period = 1 / e.f;
          const cyc = t % period;
          // Surface-negative spike and a wave of the same polarity — the convention
          // of spikeSlowWave (see morphology.ts), of which this is the 6 Hz case.
          const spike = -spikeUv * e.amp * gaussian(cyc, 0.12 * period, 0.006);
          const wave = -waveUv * e.amp * gaussian(cyc, 0.6 * period, 0.21 * period);
          return spike + wave;
        },
      });
      return { next: (ctx) => ts.next(ctx.enabled && ctx.sixHzForm === form), takeMarks: () => ts.takeMarks() };
    },
  };
}

// FOLD's wave was 45 uV on a 20 uV spike, more than twice it; learningeeg has the spikes
// followed by "an equally tiny slow wave", and the wave must still be at least the spike
// (StatPearls, Step 13): 24 on 20 (2026-11-25).
const sixHzFold = sixHzForm('6hz-sw', 'fold', GENERALIZED_POSTERIOR, 20, 24, ['drowsy', 'n1']);
const WHAM_FIELD: Record<string, number> = {
  Fz: 1, F3: 0.85, F4: 0.85, Fp1: 0.55, Fp2: 0.55, F7: 0.5, F8: 0.5, Cz: 0.55, C3: 0.4, C4: 0.4,
  T3: 0.15, T4: 0.15, Pz: 0.2, P3: 0.15, P4: 0.15,
};
const sixHzWham = sixHzForm('6hz-sw-wham', 'wham', WHAM_FIELD, 70, 50, ['awake', 'drowsy', 'n1']);

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
//
// Sides and length (2026-10-27). eegpedia: "Unilateral (R>L) or bilateral asynchronous
// or synchronous", "Duration: 0.5-1 second". SCORE normal variants study
// (PMC9294211): "0.5–1 s bursts", "unilaterally or bilaterally, but mainly with
// shifting predominance in the same patient". learningeeg: "bilateral and
// synchronous", "1-2 second bursts". The sources disagree on the sides; the two that
// give a distribution both have one-sided bursts, so the bursts are now a mix: one
// source per side on ONE shared schedule (both built from the same seed, so they draw
// the same events), each burst bilateral (half), right-only (three in ten) or
// left-only (two in ten) — R>L as eegpedia has it, the shares a design. Length 0.5-1 s,
// eegpedia's and SCORE's range, under a flat-topped envelope. learningeeg's picture is
// the other choice under the toggle (Sides, `Pos146Sides`, owner 2026-10-27): every
// burst on both sides together, 1-2 s. The choice is read as each burst begins, and the
// same draws are taken in both, so the two sides stay on one schedule either way. Each component is ONE frequency per burst (13-17 Hz and 5-7 Hz,
// eegpedia's ranges): three summed tones beat within a burst, so no two teeth of the
// comb were the same width. Until then: one bilateral source, a Gaussian 1 s window.
// ---------------------------------------------------------------------------
type PosSide = 'both' | 'right' | 'left';
type Pos1406Event = { ratio: number; dur: number; f14: number; f6: number; side: PosSide };
const POS_DUR_S: Record<Pos146Sides, [number, number]> = { shifting: [0.5, 1], bilateral: [1, 2] };
const POS_EDGE_S = 0.12;

function pos1406Side(id: string, side: 'left' | 'right', field: Record<string, number>): PatternSourceDescriptor {
  const drawn = (e: Pos1406Event) => e.side === 'both' || e.side === side;
  return {
    id,
    toggles: ['14-6-pos'],
    // 14-&-6 Hz positive bursts ("ctenoids") are a benign phenomenon of drowsiness
    // and light sleep in older children/adolescents; they do not occur in relaxed
    // wakefulness. State-gate them like the other drowsy benign variants (wicket,
    // rmtd) rather than letting the toggle fire while awake.
    states: ['drowsy', 'n1', 'n2'],
    spec: synchronousPatches(id, field, { extent: 0.3 }),
    make(_seed, dt, subjectSeed) {
      let sides: Pos146Sides = 'shifting';
      const ts = new TransientSource<Pos1406Event>(deriveSeed(subjectSeed ?? _seed, '14-6-pos'), dt, {
        // The gap after each event; an event holds the longest burst either choice draws
        // (2 s), so a 3-7 s gap keeps onsets 5-9 s apart, as they were.
        schedule: { kind: 'periodic', period: 5, jitterFrac: 0.4 },
        duration: POS_DUR_S.bilateral[1],
        onset: (g) => {
          const u = g.uniform();
          return {
            // learningeeg: "either 14 Hz (13-17 Hz) or 6 Hz (5-7 Hz), or an admixture of
            // both". The share of 14 Hz was drawn from 0.2-1.0, so no burst was ever 6 Hz
            // alone (owner's inbox, 2026-11-25). A third of each (no source gives shares).
            // One generator, so whatever a burst is, it is that on every row at once.
            ratio: ((k) => (k < 1 / 3 ? 1 : k < 2 / 3 ? 0 : g.range(0.35, 0.65)))(g.uniform()),
            dur: g.range(...POS_DUR_S[sides]), f14: g.range(13, 17), f6: g.range(5, 7),
            side: sides === 'bilateral' || u < 0.5 ? 'both' : u < 0.8 ? 'right' : 'left',
          };
        },
        mark: (e) => (drawn(e) ? { span: e.dur } : null),
        morphology: (t, e) => {
          if (!drawn(e) || t >= e.dur) return 0;
          const edge = Math.min(1, t / POS_EDGE_S, (e.dur - t) / POS_EDGE_S);
          const env = 0.5 - 0.5 * Math.cos(Math.PI * edge);
          // 14 & 6 Hz POSITIVE bursts are named for their polarity: each arch is
          // pointed on its surface-positive side, which the canvas draws DOWN. That
          // is the arch itself now (arciformSignal, sharp = +1). It used to be a
          // tilted wave with its positive half scaled up by 1.6 to force a polarity,
          // which also left every burst standing on an offset.
          const c14 = 45 * e.ratio * arciformSignal(t, [{ f: e.f14, a: 1 }], POS_BURST_TONE_NORM, 0, 1);
          const c6 = 29 * (1 - e.ratio) * arciformSignal(t, [{ f: e.f6, a: 1 }], POS_BURST_TONE_NORM, 0, 1);
          return env * (c14 + c6);
        },
      });
      return {
        next: (ctx) => { sides = ctx.pos146Sides; return ts.next(ctx.enabled); },
        takeMarks: () => ts.takeMarks(),
      };
    },
  };
}

const POS_LEFT: Record<string, number> = Object.fromEntries(
  Object.entries(POSTERIOR_TEMPORAL).filter(([e]) => Number(e.slice(1)) % 2 === 1));
const pos1406L = pos1406Side('14-6-pos', 'left', POS_LEFT);
const pos1406R = pos1406Side('14-6-pos-r', 'right', mirrored(POS_LEFT));

// ---------------------------------------------------------------------------
// Benign epileptiform transients of sleep (BETS / "small sharp spikes") —
// very brief (<50 ms), low-amplitude (<50 uV) temporal spikes with NO
// following slow wave, benign, and the side alternates unpredictably between
// occurrences. Legacy modelled the alternation explicitly with a coin-flip
// `bets-side`; here two independent left/right sources (own schedules, own
// seeds) produce the same alternating, unsynchronised bitemporal pattern
// without needing that bookkeeping — whichever side's independent timer
// fires next IS the alternation.
//
// Shape (2026-10-27). SCORE normal variants study (PMC9294211): "a mono- or diphasic
// spike with a steep descending arm. If present, the following slow wave is not
// prominent and of low amplitude", "drowsiness/light sleep (N1, N2)". eegpedia:
// "Amplitude of <50 microV and duration of <50 ms", "Usually monophasic, occasionally
// diphasic", "Occasionally followed by a slow wave, however do not disturb the
// background". eegpedia's figure (average reference): a small pointed surface-negative
// spike at A2/T4 that rises quickly and falls more steeply still, a shallow dip after.
// It was an instant step and an exponential decay (-40 exp(-60 t)): the shape of an
// electrode pop, with no rising limb at all, and its base filled 48 ms of the 50.
// Now the spike rises over a 7 ms-sigma half-Gaussian and falls over a 4 ms one
// (about 30 ms at the base); a quarter are diphasic (an opposite phase a third of the
// spike's size, just after it); a third carry a slow wave of the spike's polarity at
// 0.08 of its size, peaking 0.12 s after it, as the other spike-wave complexes
// here do. The IFCN glossary has small sharp spikes "often followed by a small theta
// wave", eegpedia "occasionally", SCORE "if present"; the shares are a design between
// them, no source gives a figure.
// ---------------------------------------------------------------------------
const BETS_RISE_S = 0.007;
const BETS_FALL_S = 0.004;
const BETS_PEAK_S = 3 * BETS_RISE_S;
type BetsEvent = { amp: number; diphasic: boolean; slow: boolean };

function betsSide(id: string, electrode: string, rateShare = 1, tangential = false): PatternSourceDescriptor {
  const radial = sourceUnder(id, [electrode], { extent: 0.7 });
  return {
    id,
    toggles: ['bets'],
    // BETS ("small sharp spikes") are a phenomenon of drowsiness and light
    // sleep, not relaxed wakefulness — state-gate them like the other drowsy
    // benign variants (wicket, rmtd, 14-6-pos) rather than letting the toggle
    // fire while awake.
    states: ['drowsy', 'n1', 'n2'],
    // A broad field (owner's inbox, 2026-11-25: "BETS / Small Sharp Spikes should be
    // across all the leads"). Still largest at the temporal electrode, as every source
    // places them (IFCN "in the temporal regions"; eegpedia "Located temporal uni- or
    // bilateral"; learningeeg "most often in the temporal chains", "having a field"),
    // but reaching the rest of the head: at extent 0.7, two-thirds of the
    // average-referenced channels carry a fifth of the spike or more, the far side
    // included (IK-042). It was 0.3, which kept each spike to the rows of one electrode.
    spec: tangential ? { ...radial, orientation: tangentialAt(radial.pos, [0, 0, 1]) } : radial,
    make(seed, dt) {
      const ts = new TransientSource<BetsEvent>(seed, dt, {
        schedule: { kind: 'periodic', period: 6.5 * rateShare, jitterFrac: 0.38 }, // legacy 4-9 s, shared
        duration: 0.35,
        onset: (g) => ({ amp: jit(g, 1, 0.3), diphasic: g.uniform() < 0.25, slow: g.uniform() < 1 / 3 }),
        // The arrow's window is the spike and the phase after it.
        mark: () => ({ dur: BETS_PEAK_S + 0.04 }),
        // Surface-negative, like the other sharp transients (renders UP).
        morphology: (t, e) => {
          const sigma = t < BETS_PEAK_S ? BETS_RISE_S : BETS_FALL_S;
          let v = -gaussian(t, BETS_PEAK_S, sigma);
          if (e.diphasic) v += 0.33 * gaussian(t, BETS_PEAK_S + 0.016, 0.006);
          if (e.slow) v -= 0.08 * gaussian(t, BETS_PEAK_S + 0.12, 0.05);
          // A tangential spike's gradient falls whole on the two links beside it, so at
          // the same size it read 59 uV on T3-T5 against the radial one's 28 and the
          // sources' "<50 microV"; it is drawn at 0.55 of the size.
          return 40 * (tangential ? 0.55 : 1) * e.amp * v;
        },
      });
      return asGenerator(ts);
    },
  };
}

// Not every one reverses phase on the double banana (owner's inbox, 2026-11-25: "it is
// not necessarily a phase reversal each time"). Half are radial at T3/T4: the two links
// sharing it deflect against each other, a phase reversal there. Half are tangential,
// lying front to back at T3/T4: F7-T3 and T3-T5 then deflect the same way (the field
// changes most steeply across T3, it does not peak there), with the opposite sign out at
// Fp1-F7 and T5-O1. A source placed under the ear electrode was tried first; it sits
// below the chain, so the chain still peaks near T3/T5 and still reverses (F7-T3 -0.46
// against T3-T5 +0.22). Each side keeps the rate it had, shared between the two.
const betsL = betsSide('bets-l', 'T3', 2);
const betsR = betsSide('bets-r', 'T4', 2);
const betsLTan = betsSide('bets-l-tan', 'T3', 2, true);
const betsRTan = betsSide('bets-r-tan', 'T4', 2, true);

// ---------------------------------------------------------------------------
// Breach rhythm — not a generator but a change in how the brain's own activity
// reaches one electrode. The skull attenuates and smears the cortical field on its
// way to the scalp, fast and focal activity most. Over a skull defect (craniotomy,
// burr hole, fracture) that filter is gone, so the activity there is larger, faster
// and sharper than at the homologous electrode, and stops at the defect's margin.
//
// Sources (2026-10-27): eegpedia — "High voltage fast activity in the region of skull
// defect", "The skull is a high frequency and high voltage filter", "Mostly in beta
// range", "Spiky and sharp appearance", "Abruptly diminish beyond the margins of the
// defect", "Better identified with bipolar montage", "a sign of bone abnormality, not
// an EEG abnormality"; its figure is a right central defect (double banana) on which
// F4-C4 and C4-P4 run 1.8x and 2.9x their left twins peak to peak (measured) while
// Fp2-F4 and P4-O2 are unchanged: one electrode, C4. SCORE normal variants study
// (PMC9294211): "focal, asymmetric high amplitude beta activity", its figure at F8.
// EEG Atlas online: "increased amplitude of high and low frequencies". learningeeg: mu
// "can be high amplitude and sharp, especially with breach rhythm". A 2020s series of
// 117 EEGs over skull defects (AES abstract, "Characterization of breach rhythm on
// scalp EEG"), rated on amplitude "≥50% greater than the contralateral homologous
// site", "increased local faster frequencies (beta)" and "local sharp or spiky
// morphology": 89%, 60% and 72% of those with breach.
//
// The engine does the work (engine.ts, BREACH_*): at the electrode over the defect,
// the intracranial part of the potential is multiplied by 1.8 at the slow end, rising
// through a first-order high-pass at 6 Hz to 3 for alpha and beta (the IFCN glossary:
// "usually by a factor of less than 3"). Extracranial
// sources keep their size. The electrode is the Site option (`BreachSite`); the box is
// the engine's, on that electrode's rows, for as long as the toggle is on. This
// descriptor gives the toggle its place in the registry and draws nothing.
// ---------------------------------------------------------------------------
const breach: PatternSourceDescriptor = {
  id: 'breach',
  toggles: ['breach'],
  spec: sourceUnder('breach', ['C4'], { extent: 0.3 }),
  make() {
    return { next: () => 0 };
  },
};

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
  wicketL, wicketR, wicketL2, wicketR2,
  rmtdL, rmtdR,
  lambda,
  pswyL, pswyR,
  sftL, sftR,
  sixHzFold, sixHzWham,
  pos1406L, pos1406R,
  betsL, betsR, betsLTan, betsRTan,
  eyesOpen,
  midlineTheta,
  breach,
];

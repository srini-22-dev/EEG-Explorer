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
import { Gaussian, deriveSeed } from '../rng';
import { TransientSource, markQueue, type TransientOptions } from './transient';
import { ARTIFACT_SOURCES, LRS_LEAD_S, LRS_PEAK_UV, LRS_SPIKE_S, lrsSpike } from '../artifacts';
import { gaussian } from './morphology';
import { VERTEX_FIELD } from './fields';
import type { PatternSourceDescriptor, PatternGenerator } from './registry';

/** Per-event multiplicative jitter: base * (1 +- frac). */
const jit = (g: Gaussian, base: number, frac: number): number =>
  base * (1 + (g.uniform() - 0.5) * 2 * frac);

/** Uniform draw in [lo, hi). */
const between = (g: Gaussian, lo: number, hi: number): number => lo + (hi - lo) * g.uniform();

/** Wrap a `TransientSource` as a `PatternGenerator` (gate its output on `ctx.enabled`). */
const asGenerator = <E>(ts: TransientSource<E>): PatternGenerator => ({
  next: (ctx) => ts.next(ctx.enabled),
  takeMarks: () => ts.takeMarks(),
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
// figure caption puts the wave over the parasagittal AND central chains.
//
// Amplitude. Teaching references give 50-150 uV, rarely over 250 (the NVKNF
// grapho-element sheet and a benign-variants teaching set; search excerpts,
// 2026-10-12). It was 115 uV here, on "adults usually 100-150 uV", a figure
// attributed to Niedermeyer at second hand: ~100 uV at Cz-A1 and a full row
// (10 mm at 7 uV/mm) on Fz-Cz, every wave. The owner's reading (2026-10-12) is
// that they should be about half that — what 15 uV/mm showed is what 7 should.
// 65 uV puts the median at ~56 uV at Cz-A1 and ~4 mm on Fz-Cz: the floor of the
// published range rather than under it (a strict 7/15 would be 47 uV).
// For whoever revisits this: on learningeeg's "Vertex waves I" figure the largest
// wave stands 0.9 of a row pitch and 2.0-2.7x its row's background — about what
// the engine drew BEFORE this change. That figure states no sensitivity, so it is
// a row-pitch comparison, not a microvolt one.
//
// Morphology: the negative wave is a skewed Gaussian, rise sigma 26 ms and fall
// 33 ms — a 10%-of-peak base of ~127 ms and a half-amplitude width of ~69 ms,
// i.e. the "~100 ms" negative wave — with a small positive wave 75 ms before
// (12%) and a larger slower one 130 ms after (28%). The whole element spans
// ~0.35 s, inside AASM's 0.5 s.
//
// Field: maximal at the vertex and over both parasagittal chains (fields.ts,
// VERTEX_FIELD, 2026-10-22): reversing at Cz on the midline and at C3/C4 on the
// parasagittal chains, smaller on the Fp-F and P-O links beyond, small on the
// temporal chains.
//
// The wider field has gentler slopes, so the same source size drew a smaller wave
// on the bipolar rows. The owner judged the size on the double banana (about 4 mm
// on Fz-Cz), so that is what is held: 99 uV at the source keeps Fz-Cz and Cz-Pz
// where 65 uV had them, and puts the Cz-A1 median at ~87 uV (it was ~56), inside
// the 50-150 uV teaching range above.
// ---------------------------------------------------------------------------
type VEvent = { onsets: number[]; amps: number[]; widths: number[] };

const VWAVE_PEAK_UV = 99;
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
  spec: synchronousPatches('vwave', VERTEX_FIELD, { extent: 0.3 }),
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
      // A single wave is an arrow on it; a run is one box from its first wave to the
      // end of its last (an element spans ~0.35 s at width 1).
      mark: (e) => {
        const last = e.onsets.length - 1;
        return last === 0 ? { dur: 0.3 } : { span: e.onsets[last] + 0.35 * e.widths[last] };
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
// has exactly that frontocentral, diffuse spindle. How often is a choice under the
// toggle (`KcSpindle`, owner 2026-10-22): none, sometimes (the 60%), always.
//
// The early positive phase (2026-10-22). The definitions are biphasic — IFCN,
// AASM and NVKNF: a negative sharp wave followed by a positive component;
// learningeeg: "biphasic". The K-complex literature also has a smaller positive
// wave BEFORE the negative one: Laurino et al. (2014) name three peaks, "an early
// short positive P200, a large negative N550 and a late and longer lasting
// positive P900", and a 2019 review (Frontiers in Neuroscience 13:814, citing
// Cote 2000, Colrain 2005, Rodenbeck 2006) "a smaller preceding positivity that
// may not be visible by eye". So two events in three carry one, 10-30% of the
// negative peak, 0.3 s ahead of it (P200 to N550 is ~350 ms) and short (sigma
// 60 ms); the rest have none. The negative peak moved from 0.35 to 0.45 s into the
// event to make room for it. Those numbers are this file's reading of "smaller"
// and "may not be visible"; no source gives a ratio.
// ---------------------------------------------------------------------------
type KEvent = {
  amp: number; posFrac: number; prePos: number;
  spindle: boolean; spDelay: number; spDur: number; spFreq: number; spAmp: number; spPhase: number;
};

const KC_NEG_PEAK_S = 0.45;

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
    // The early phase draws from its own stream, so every other draw — and every
    // K-complex's time — is what it was before it existed.
    const early = new Gaussian(deriveSeed(seed, 'kc-early-phase'));
    let spindleMode: 'none' | 'sometimes' | 'always' = 'sometimes';
    const ts = new TransientSource<KEvent>(seed, dt, {
      // ~3 per minute (11-29 s apart): spontaneous K-complexes run at roughly
      // 1-3/min of N2 (COL).
      schedule: { kind: 'periodic', period: 20, jitterFrac: 0.45 },
      duration: 3.5,
      onset: (g) => ({
        amp: jit(g, 120, 0.3),
        posFrac: between(g, 0.45, 0.7),
        // The 60% draw is taken for every event whatever the option, so the option
        // moves no other draw.
        spindle: ((drawn: boolean) => spindleMode === 'always' || (spindleMode === 'sometimes' && drawn))(g.uniform() < 0.6),
        spDelay: between(g, 0.3, 0.45),
        spDur: jit(g, 1.3, 0.3),
        spFreq: between(g, 11.5, 14),
        spAmp: between(g, 0.1, 0.16),
        spPhase: TWO_PI * g.uniform(),
        prePos: early.uniform() < 1 / 3 ? 0 : between(early, 0.1, 0.3),
      }),
      // One box over the whole complex: from its early positive phase (2 sigma before
      // that peak) or, without one, from the negative wave's rise (2.5 rise sigmas
      // before its peak), to the end of the positive wave (2.5 sigmas after its peak)
      // or of the spindle that follows it.
      mark: (e) => {
        const start = e.prePos > 0 ? KC_NEG_PEAK_S - 0.3 - 2 * 0.06 : KC_NEG_PEAK_S - 2.5 * 0.085;
        const end = e.spindle ? KC_NEG_PEAK_S + e.spDelay + e.spDur : KC_NEG_PEAK_S + 0.42 + 2.5 * 0.17;
        return { at: start, span: end - start };
      },
      morphology: (t, e) => {
        const pre = e.prePos * gaussian(t, KC_NEG_PEAK_S - 0.3, 0.06);
        const neg = -skewGauss(t, KC_NEG_PEAK_S, 0.085, 0.07);
        const pos = e.posFrac * gaussian(t, KC_NEG_PEAK_S + 0.42, 0.17);
        let v = e.amp * (pre + neg + pos);
        if (e.spindle) {
          v += e.amp * e.spAmp * spindleBurst(t - (KC_NEG_PEAK_S + e.spDelay), e.spDur, e.spFreq, e.spPhase);
        }
        return v;
      },
    });
    return {
      next: (ctx) => { spindleMode = ctx.kcSpindle; return ts.next(ctx.enabled); },
      takeMarks: () => ts.takeMarks(),
    };
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
        // The visible spindle: its envelope is over 10% of the peak in the middle 80%.
        mark: (e) => ({ at: 0.1 * e.dur, span: 0.8 * e.dur }),
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
// The old source fired one tall identical transient every ~2 s from a single
// broad patch whose field put 67% of the P3-O1 deflection onto C3-P3. Now: a
// patch under each occiput and a triangular element with a sharp apex (each leg
// a power 1.3 curve), each one its own size and width.
//
// One at a time by default (owner's decision, 2026-10-12). NPK describes both forms
// and from 2026-09-11 the source drew both, half and half; a train of five
// 40-55 uV triangles read on the page as a run of spikes and was the most
// conspicuous thing on an N1 record. learningeeg's POSTS figure shows them one
// after another at irregular intervals, modest against their background. So:
// singles only, more than 1 s apart and at no fixed interval, 24-46 uV at the
// source (scaled by POSTS_SIZE since 2026-11-16; before that ~20-38 uV at O1-A1, the lower half of NPK's 20-75; it was 25-55 with a
// further +-25% on each). Trains are the other form, chosen with the POSTS option
// (`PostsForm`, 2026-10-13): the same elements, 2-6 of them at 4-6 per second, in
// place of the singles — one form or the other, so each can be looked at alone.
//
// Polarity is montage-dependent (CLAUDE.md §4): positive at O1/O2, so DOWN in a
// referential montage, but UP on the double banana, where O1/O2 is input 2.
// ---------------------------------------------------------------------------
// Rate and symmetry (owner, 2026-11-16). At one every ~2.7 s the singles put 3-4
// on every 10 s page at 30 mm/s; the owner asked for 1-2 a page. The schedule
// below leaves a 3.4-9.6 s gap after each (mean ~6.5 s): still "more than 1 s
// apart" and "without periodicity" (NPK), and now as sparse as asked. Trains take
// the same schedule.
//
// Sides (2026-11-16). POSTS are "bilateral, but not necessarily symmetric"
// (learningeeg atlas); Rey, Aybek, Maeder-Ingvar & Rossetti (Clin Neurophysiol 2009,
// 120:472) found "a consistent amplitude asymmetry" in 38% of recordings with POSTS,
// unrelated to any abnormality: "POSTS asymmetry ... should be considered as normal".
// In a person that asymmetry is consistent, one side all record long. Here it is
// random per POSTS instead, by the owner's choice: a teaching idealisation that puts
// both pictures on one page, set with two sliders under the toggle
// (`PatternOptions.postsSmallerPct` / `postsOneSidePct`, defaults 40% and 5%):
//  - a bilateral POSTS has one side, left or right at random, smaller ON THE PAGE by
//    the slider's figure (40% by default). It was a range, half the slider to all of
//    it, until the owner saw the low end on the page: a 20% drop on a 30 uV wave
//    hardly shows over the background, and a side labelled smaller has to look it;
//  - a share of POSTS is on one side only. No source gives a rate; an AI summary the
//    owner consulted put strictly unilateral POSTS under 0.5% of EEGs and tied them to
//    lesions on that side, which no source found here confirms. The 5% is a design.
// The field is two generators, one under each occiput, on ONE shared schedule (built
// from the same seed, so both draw the same events and fire together); each scales
// its own copy. Each occiput also sees 18.6% of the other side's field (leadfield:
// 0.1793 against 0.9646 at O-A), so a page drop is converted to a source drop below,
// and a one-sided POSTS still shows about a fifth of itself across the midline —
// volume conduction, which no arrow points at.
//
// Annotation: the side a POSTS is absent from places no mark (no arrows there); the
// smaller side of a bilateral one is labelled "POSTS (smaller)" (owner: denote the
// smaller one, without its percentage).
type PostsSide = 'left' | 'right';
type PostsSides = { low: PostsSide; asym: number; oneSide: boolean };
type PostsEvent = { amp: number; dur: number; neg: number } & PostsSides;
type PostsTrain = { onsets: number[]; amps: number[]; durs: number[]; negs: number[] } & PostsSides;

// The longest element: 0.16 s, and its negative afterwave when it has one (x1.6).
const POSTS_EVENT_S = 0.27;
// A train: 2-6 elements at 4-6 per second, "lasting about a second" (NPK). The
// window holds the longest: six at 4 per second and the last one's afterwave.
const POSTS_MAX_TRAIN = 6;
const POSTS_TRAIN_S = 1.7;
const POSTS_SCHEDULE = { kind: 'periodic', period: 6.2, jitterFrac: 0.5 } as const;
// Each side is its own leadfield column, normalised to 1 under its own electrode;
// the old single column was normalised over BOTH patches, so each occiput also
// carried the other's spill. Measured from the leadfield (2026-11-16): the old
// column is 0.8359 of the two new ones summed, the same at every electrode against
// any reference, so this gain makes a symmetric event exactly the old one.
const POSTS_SIDE_GAIN = 0.8359;
// Size (owner, 2026-11-16: "reduce the amplitude of POSTS by 20 to 30%"). A quarter
// off every draw, after it is drawn, so the random stream is unchanged. Measured
// before the cut (bipolar-ap, seed 20, 240 s, each event's largest row): POSTS 23.1 uV
// against vertex waves 29.1 uV. The owner's "about vertex-wave size" came from one
// page where a vertex wave sat next to a POSTS; asked, they chose the 25% cut over a
// match. At the source this is 18-34.5 uV, ~23 uV median at the larger occiput (O-A),
// at the low end of NPK's 20-75.
const POSTS_SIZE = 0.75;
// Trains a tenth smaller instead (owner, 2026-11-16): at the singles' 25% a train's
// elements measured 18.2 uV at the larger occiput, under NPK's floor of 20; a train
// is several elements at once, so the owner chose to keep it inside the range.
const POSTS_TRAIN_SIZE = 0.9;

function postsElement(t: number, amp: number, dur: number, neg: number): number {
  if (t < 0) return 0;
  const rise = 0.45 * dur;
  if (t < rise) return amp * Math.pow(t / rise, 1.3);
  if (t < dur) return amp * Math.pow((dur - t) / (dur - rise), 1.3);
  // Diphasic ones: a smaller negative wave after the positive peak.
  if (neg > 0 && t < 1.6 * dur) return -amp * neg * Math.sin(Math.PI * (t - dur) / (0.6 * dur));
  return 0;
}

// Gain of one occiput at the other (0.1793) and under itself (0.9646), O-A.
const POSTS_SPILL = 0.1793, POSTS_SELF = 0.9646;
/**
 * The source drop that makes the smaller side `d` smaller on the page (O-A). The low
 * occiput sees self*(1-a) + spill, the high one self + spill*(1-a); setting their
 * ratio to 1-d and solving for a.
 */
const sourceDrop = (d: number): number =>
  Math.min(1, ((POSTS_SELF + POSTS_SPILL) * d) / (POSTS_SELF - (1 - d) * POSTS_SPILL));

type PostsSliders = { smallerPct: number; oneSidePct: number };
/**
 * Which side is smaller, or which side a one-sided POSTS is on. Two uniforms always,
 * drawn last, so the slider values never shift the stream.
 */
function drawSides(g: Gaussian, o: PostsSliders): PostsSides {
  const uOne = g.uniform(), uSide = g.uniform();
  return {
    low: uSide < 0.5 ? 'left' : 'right',
    oneSide: uOne < o.oneSidePct / 100,
    asym: sourceDrop(o.smallerPct / 100),
  };
}

function postsSide(id: string, side: PostsSide, electrode: string): PatternSourceDescriptor {
  // A one-sided POSTS is on the side that is NOT `low`.
  const absent = (e: PostsSides) => e.oneSide && e.low === side;
  const gain = (e: PostsSides) => (absent(e) ? 0 : POSTS_SIDE_GAIN * (e.low === side ? 1 - e.asym : 1));
  // Each side marks its own event: a mark points at the rows of its own field. None
  // where the POSTS is absent; the smaller side of a bilateral one says so.
  const markOf = (e: PostsSides) => (absent(e) ? null
    : e.low === side && !e.oneSide && e.asym > 0 ? { label: 'POSTS (smaller)' } : {});
  const sliders: PostsSliders = { smallerPct: 0, oneSidePct: 0 };
  return {
    id,
    toggles: ['posts'],
    states: ['n1', 'n2'],
    stateIntrinsic: true,
    spec: synchronousPatches(id, { [electrode]: 1 }, { extent: 0.3 }),
    make(_seed, dt, subjectSeed) {
      const seed = deriveSeed(subjectSeed, 'posts');
      const singles = new TransientSource<PostsEvent>(seed, dt, {
        schedule: POSTS_SCHEDULE,
        duration: POSTS_EVENT_S,
        onset: (g) => ({
          amp: POSTS_SIZE * between(g, 24, 46),
          dur: between(g, 0.09, 0.16),
          neg: g.uniform() < 0.35 ? between(g, 0.15, 0.25) : 0,
          ...drawSides(g, sliders),
        }),
        mark: (e) => { const m = markOf(e); return m && { ...m, dur: 0.2 }; },
        morphology: (t, e) => gain(e) * postsElement(t, e.amp, e.dur, e.neg),
      });
      // The other form. Its own stream, so choosing it leaves the singles' untouched.
      const trains = new TransientSource<PostsTrain>(deriveSeed(seed, 'trains'), dt, {
        schedule: POSTS_SCHEDULE,
        duration: POSTS_TRAIN_S,
        onset: (g) => {
          const n = 2 + Math.floor(g.uniform() * (POSTS_MAX_TRAIN - 1));
          const rate = between(g, 4, 6);
          // One size for the train, each element a little off it.
          const base = POSTS_TRAIN_SIZE * between(g, 24, 46);
          const onsets: number[] = [], amps: number[] = [], durs: number[] = [], negs: number[] = [];
          for (let k = 0; k < n; k++) {
            onsets.push(k === 0 ? 0 : onsets[k - 1] + jit(g, 1 / rate, 0.1));
            amps.push(jit(g, base, 0.2));
            durs.push(between(g, 0.09, 0.16));
            negs.push(g.uniform() < 0.35 ? between(g, 0.15, 0.25) : 0);
          }
          return { onsets, amps, durs, negs, ...drawSides(g, sliders) };
        },
        // One box from the first element to the end of the last (its afterwave included).
        mark: (e) => {
          const m = markOf(e);
          if (!m) return null;
          const last = e.onsets.length - 1;
          return { ...m, span: e.onsets[last] + e.durs[last] * (e.negs[last] > 0 ? 1.6 : 1) };
        },
        morphology: (t, e) => {
          let v = 0;
          for (let k = 0; k < e.onsets.length; k++) v += postsElement(t - e.onsets[k], e.amps[k], e.durs[k], e.negs[k]);
          return gain(e) * v;
        },
      });
      return {
        next(ctx) {
          sliders.smallerPct = ctx.postsSmallerPct;
          sliders.oneSidePct = ctx.postsOneSidePct;
          const inTrains = ctx.postsForm === 'trains';
          return singles.next(ctx.enabled && !inTrains) + trains.next(ctx.enabled && inTrains);
        },
        takeMarks: () => [...singles.takeMarks(), ...trains.takeMarks()],
      };
    },
  };
}

const posts = postsSide('posts', 'left', 'O1');
const postsR = postsSide('posts-r', 'right', 'O2');

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
// slow, and irregular, drifting rather than jumping.
//
// So each movement is a SWING: a smooth glide (half a cosine) from where the eyes
// are to a point on the other side, 1.5-4 s long, to a distance drawn afresh each
// time — side to side, slow, smooth and irregular. A swing every 1.5-4 s puts the
// spectral peak near 0.2 Hz (IK-036 holds it to 0.12-0.6 Hz).
//
// Until 2026-10-23 this was two-pole low-pass filtered Gaussian noise (~0.3 Hz
// corner, 42 uV RMS at the source) with no movements in it as such, so its arrows
// had to be found in the trace — at each turn of the drift, through the display's
// filter. The owner: "everything should have an intention, so annotations should be
// easy, whatever is present in the signals should be by design." Now each swing is
// drawn on purpose and says so: an arrow over the swing, which lands on its turn.
// The distances (35-80 uV at the source) hold the old RMS, ~42 uV; the size and the
// rate are a design, as before (IK-036 asserts neither).
// ---------------------------------------------------------------------------
const ROVING_SWING_S: [number, number] = [1.5, 4];
const ROVING_SIDE_UV: [number, number] = [35, 80];

const rovingEyes: PatternSourceDescriptor = {
  id: 'roving-eyes',
  toggles: ['roving-eyes'],
  states: ['drowsy', 'n1'],
  stateIntrinsic: true,
  extracranial: true,
  spec: {
    id: 'roving-eyes',
    pos: [0.0, -0.68, 0.61],
    orientation: { kind: 'tangential', dir: [-1, 0, 0] },
    extent: 0.55,
  },
  make(seed, dt) {
    const g = new Gaussian(seed);
    const marks = markQueue();
    // The swing under way: from `from` to `to` (uV at the source) over `len` s, `t` in.
    let from = 0, to = 0, len = 1, t = 0, side = g.uniform() < 0.5 ? -1 : 1, on = false;
    const swing = () => {
      from = to; side = -side; t = 0;
      to = side * between(g, ...ROVING_SIDE_UV);
      len = between(g, ...ROVING_SWING_S);
      // The arrow's window is the whole swing: the display's low-frequency filter
      // draws the turn up to ~0.9 s before the source reaches it at these rates, and
      // the largest movement inside the swing, the way it went, is that turn.
      marks.push({ dur: len });
    };
    return {
      takeMarks: () => marks.take(),
      next(ctx) {
        // Switched on, the eyes start from the middle — no step, which is what
        // the filtered drift needed an ease-in for (71 uV on F8-T4, 2026-10-13).
        if (!ctx.enabled) { on = false; to = 0; marks.clear(); return 0; }
        if (!on) { on = true; to = 0; swing(); }
        t += dt;
        if (t >= len) swing();
        return from + (to - from) * (1 - Math.cos(Math.PI * t / len)) / 2;
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
//
// Each movement is led by the lateral rectus spike of the side the eyes turn to
// (artifacts.ts, LRS_*: "prominent during REM sleep"), drawn by two more sources on
// the lateral rectus positions that replay this generator's events from its own
// seed (2026-10-27). The movement starts LRS_LEAD_S after its event begins, so the
// spike comes first, as it does before a waking saccade.
// ---------------------------------------------------------------------------
type RemEvent = { amp: number; dir: number; sign: number };

// Rise and fall of one movement. The ratio is the claim; the absolute values put
// the whole deflection under ~0.35 s, which is the duration of a real REM.
const REM_RISE_SEC = 0.07;
const REM_FALL_SEC = 0.26;
const REM_PEAK_UV = 60;

// The REM schedule and per-movement draws, shared by the movement and its two
// lateral rectus sources so all three see the same events.
function remSource(
  seed: number, dt: number, mark: TransientOptions<RemEvent>['mark'], morphology: TransientOptions<RemEvent>['morphology'],
) {
  return new TransientSource<RemEvent>(seed, dt, {
    // Bursts: a short mean interval with heavy jitter clusters the movements
    // instead of spacing them evenly.
    schedule: { kind: 'periodic', period: 1.4, jitterFrac: 0.7 },
    duration: LRS_LEAD_S + REM_RISE_SEC + REM_FALL_SEC,
    // Direction alternates at random: the eyes track back and forth, so
    // successive movements are not all the same way. Positive is to the right.
    onset: (g) => ({ amp: jit(g, 1, 0.3), dir: g.uniform() < 0.5 ? -1 : 1, sign: g.uniform() < 0.5 ? -1 : 1 }),
    mark,
    morphology,
  });
}

const remEyes: PatternSourceDescriptor = {
  id: 'rem-eyes',
  toggles: ['rem-eyes'],
  states: ['rem'],
  stateIntrinsic: true,
  extracranial: true,
  spec: {
    id: 'rem-eyes',
    pos: [0.0, -0.68, 0.61],
    orientation: { kind: 'tangential', dir: [-1, 0, 0] },
    extent: 0.55,
  },
  make(seed, dt) {
    const ts = remSource(seed, dt, () => ({ at: LRS_LEAD_S, dur: REM_RISE_SEC + REM_FALL_SEC }), (t, e) => {
      const u = t - LRS_LEAD_S;
      const peak = e.dir * e.amp * REM_PEAK_UV;
      if (u < 0) return 0;
      if (u < REM_RISE_SEC) return peak * (u / REM_RISE_SEC);
      if (u < REM_RISE_SEC + REM_FALL_SEC) {
        return peak * (1 - (u - REM_RISE_SEC) / REM_FALL_SEC);
      }
      return 0;
    });
    return asGenerator(ts);
  },
};

function remLrs(id: string, side: -1 | 1): PatternSourceDescriptor {
  return {
    id,
    toggles: ['rem-eyes'],
    states: ['rem'],
    stateIntrinsic: true,
    extracranial: true,
    spec: { ...(side < 0 ? ARTIFACT_SOURCES.lateralRectusL : ARTIFACT_SOURCES.lateralRectusR), id },
    make(_seed, dt, subjectSeed) {
      const ts = remSource(deriveSeed(subjectSeed, 'rem-eyes'), dt,
        (e) => (e.dir === side ? { label: 'LRS', dur: LRS_SPIKE_S } : null),
        (t, e) => (e.dir === side ? e.sign * LRS_PEAK_UV * lrsSpike(t) : 0));
      return asGenerator(ts);
    },
  };
}

export const SLEEP_SOURCES: PatternSourceDescriptor[] = [
  vWave, kComplex, spindleFast, spindleSlow, posts, postsR, slowWaves, rovingEyes, remEyes,
  remLrs('rem-lrs-l', -1), remLrs('rem-lrs-r', 1),
];

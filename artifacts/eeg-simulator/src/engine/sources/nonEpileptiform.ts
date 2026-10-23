/**
 * Non-epileptiform abnormality sources — gen-slowing, focal delta (temporal),
 * FIRDA, triphasic waves, GPEDs, LPEDs.
 *
 * `gen-slowing` is implemented here (it is the one member with no legacy
 * `abnormalVoltage` counterpart, and the only pattern that reshapes the ongoing
 * background rather than adding to it). The remaining five are transient
 * (event) sources ported from their legacy `abnormalVoltage` specs (verbatim
 * amplitudes/frequencies/timings; only the topography representation changes
 * from hand-authored per-electrode gain tables to a leadfield source).
 */

import { sourceUnder, synchronousPatches } from '../forward';
import { BIFRONTAL, GENERALIZED_POSTERIOR, LEFT_TEMPORAL_REGIONAL, MID_TEMPORAL_REGIONAL } from './fields';
import { HopfOscillator } from '../oscillator';
import { BurstyOscillator } from '../bursts';
import { deriveSeed, Gaussian } from '../rng';
import { TransientSource } from './transient';
import {
  gaussian, multiToneSignal, triphasicWave, spikeSlowWave, DELTA_TONES, DELTA_TONE_NORM,
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

/**
 * Interval jitter of the PERIODIC discharges (GPEDs, LPEDs), as a fraction either
 * side of the mean. At 0.08 the longest interval is 17% over the shortest, inside
 * learningeeg's 25% limit for calling a pattern periodic rather than quasi-periodic.
 */
const PERIODIC_JITTER = 0.08;

// ---------------------------------------------------------------------------
// Generalised slowing (encephalopathy, sedating medications) — MODERATE grade.
//
// What a reader sees, per learningeeg's Non-Epileptiform chapter: the background
// loses its organisation. The PDR slows (mild: 6-7 Hz; moderate: only fragments,
// no faster than ~5 Hz), theta and then delta build up across the WHOLE head, the
// A-P gradient is lost, and the page stays synchronous and symmetric. Grades run
// mild (slow PDR, excess theta) -> moderate (mostly theta) -> severe (delta, with
// reduced reactivity and discontinuity). This toggle is the moderate grade.
//
// It used to be ONE radial patch under Cz. However wide its extent, one coherent
// patch projects hardest to the electrode above it, so the field was a vertex
// focus: isolated 1-8 Hz amplitude at Cz was 3.5x the median electrode and 2.1x
// along the midline, while the check that should have caught it divided every
// region by Cz and so could not see a peak AT Cz (IK-024, corrected 2026-09-11).
//
// Now: independent theta+delta patches under every 10-20 site, left, right and
// midline alike, so each region carries its own slow activity at comparable size
// and neighbouring electrodes share it through overlapping fields. Theta leads
// delta (moderate, "mostly theta"); both wander in frequency and amplitude, as
// polymorphic slowing does, rather than reading as a sine. The normal alpha PDR
// and mu are gated down and beta damped (`bandGate`, carried by one patch only so
// it applies once), and the posterior rhythm reappears as slowed ~5 Hz fragments
// (`slowPdr` below) — the "fragments of a PDR" a reader finds in moderate slowing.
// ---------------------------------------------------------------------------
const GS_SITES = ['Fp1', 'Fp2', 'F7', 'F8', 'F3', 'F4', 'T3', 'T4', 'C3', 'C4', 'T5', 'T6', 'P3', 'P4', 'O1', 'O2', 'Fz', 'Cz', 'Pz'];
export const GS_EXTENT = 0.35;
export const GS_THETA_RMS = 14;
export const GS_DELTA_RMS = 10;
export const GS_SLOW_PDR_RMS = 12;

function genSlowingPatch(site: string, carriesGate: boolean): PatternSourceDescriptor {
  const id = `gen-slowing-${site}`;
  return {
    id,
    toggles: ['gen-slowing'],
    // The whole background is slowed, so the whole page is boxed while it is on —
    // by the patch that also carries the band gate, so once.
    ...(carriesGate ? { openBox: { where: 'page' as const } } : {}),
    spec: sourceUnder(id, [site], { extent: GS_EXTENT }),
    make(seed, dt) {
      const theta = new HopfOscillator(deriveSeed(seed, 'theta'), dt, {
        freq: 5.0, rms: GS_THETA_RMS, freqWander: 0.8, damping: -2.2,
      });
      const delta = new HopfOscillator(deriveSeed(seed, 'delta'), dt, {
        freq: 1.8, rms: GS_DELTA_RMS, freqWander: 0.5, damping: -1.2,
      });
      return {
        // Advance every sample for phase continuity; emit only while enabled.
        next: (ctx) => {
          const v = theta.next() + delta.next();
          return ctx.enabled ? v : 0;
        },
        // Abolish the normal-frequency PDR and mu; damp beta. Band gates compose
        // multiplicatively across patterns, so exactly one patch carries it.
        ...(carriesGate ? { bandGate: () => ({ alpha: 0.15, mu: 0.15, beta: 0.5 }) } : {}),
      };
    },
  };
}

// The slowed posterior rhythm: ~5 Hz fragments over each occipital region, bursty
// rather than continuous, placed like the PDR it replaces (engine.ts pdrL/pdrR).
function slowPdr(side: 'L' | 'R', el: 'O1' | 'O2'): PatternSourceDescriptor {
  const id = `gen-slowing-pdr${side}`;
  return {
    id,
    toggles: ['gen-slowing'],
    spec: sourceUnder(id, [el], { extent: 0.3, offset: [0, -0.1, 0] }),
    make(seed, dt) {
      const b = new BurstyOscillator(deriveSeed(seed, 'frag'), dt, {
        freq: 5.0, freqSpread: 0.5, medianDuration: 1.5, meanInterval: 3.0, rms: GS_SLOW_PDR_RMS,
      });
      return {
        next: (ctx) => {
          const v = b.next();
          return ctx.enabled ? v : 0;
        },
      };
    },
  };
}

const GEN_SLOWING: PatternSourceDescriptor[] = [
  ...GS_SITES.map((site, i) => genSlowingPatch(site, i === 0)),
  slowPdr('L', 'O1'), slowPdr('R', 'O2'),
];

// ---------------------------------------------------------------------------
// FIRDA — Frontal Intermittent Rhythmic Delta Activity. Bursts of rhythmic,
// near-sinusoidal 2-3 Hz delta, frontally/midline maximal, classically seen in
// metabolic encephalopathy and raised ICP. "Rhythmic" and "intermittent" are
// both load-bearing: within a burst the waveform is a clean ~2.5 Hz tone (not
// the polymorphic mixed-frequency slowing of `gen-slowing` or focal delta),
// and bursts come and go rather than running continuously.
//
// Two tones close together (2.4, 2.6 Hz) give a near-monomorphic 2.5 Hz
// carrier with a slight beat rather than a single pure sine — legacy's exact
// numbers. A burst lasts ~3 s (seeded per-event) recurring every 4-8 s; a
// Gaussian envelope centred on the burst's own midpoint gives it a natural
// rise/fall rather than a rectangular on/off, which a slow rhythmic burst
// would not have in real recordings.
//
// Field: `BIFRONTAL` (fields.ts) — largest on the frontopolar rows, fading
// through the frontal and central rows to nothing behind them, as on
// learningeeg's figure ("does not travel back to the posterior regions"). It was
// one patch between Fz, Fp1 and Fp2, which put the rhythm on Fz-Cz and left
// Fp1-F3 at a quarter of it. 130 uV holds the frontal pole near where the single
// patch had Fz (legacy 100).
// ---------------------------------------------------------------------------
type FirdaEvent = { dur: number };

const firda: PatternSourceDescriptor = {
  id: 'firda',
  toggles: ['firda'],
  spec: synchronousPatches('firda', BIFRONTAL, { extent: 0.3 }),
  make(seed, dt) {
    const ts = new TransientSource<FirdaEvent>(seed, dt, {
      // legacy nextEventTime('firda-burst', t, 4, 8): period (4+8)/2, jitterFrac (8-4)/(4+8).
      schedule: { kind: 'periodic', period: 6, jitterFrac: 4 / 12 },
      duration: 3.95, // covers the jittered burst length (3 * [0.7, 1.3]) with margin
      onset: (g) => ({ dur: jit(g, 3, 0.3) }),
      // The whole burst: its envelope is 14% of the peak at either end, ~18 uV at 130.
      mark: (e) => ({ span: e.dur }),
      morphology: (t, e) => {
        if (t < 0 || t > e.dur) return 0;
        const env = gaussian(t, e.dur / 2, e.dur / 4); // burst envelope, peak mid-burst
        return 130 * env * multiToneSignal(t, [{ f: 2.4, a: 1 }, { f: 2.6, a: 0.8 }], 1.8);
      },
    });
    return asGenerator(ts);
  },
};

// ---------------------------------------------------------------------------
// Focal delta, left temporal — intermittent polymorphic (mixed-frequency,
// non-rhythmic) delta over one temporal region. Unlike FIRDA this is NOT a
// clean single-frequency rhythm: four tones spanning 1.2-2.5 Hz sum to an
// irregular, polymorphic waveform, which is the textbook distinction between
// focal polymorphic delta and rhythmic delta activity. Teaching point is the
// LATERALITY itself — focal slowing localises to a structural lesion until
// proven otherwise, so this must show up under the LEFT temporal electrode
// only, not bilaterally.
// ---------------------------------------------------------------------------
type FocalDeltaEvent = { dur: number };

const focalDeltaTemporal: PatternSourceDescriptor = {
  id: 'focal-delta-temporal',
  toggles: ['focal-delta-temporal'],
  // A left temporal region peaking at T3: MID_TEMPORAL_REGIONAL, which is fitted to
  // a temporal seizure. For slowing itself the one figure is learningeeg's
  // "Continuous left hemispheric polymorphic delta slowing, maximal temporally",
  // too coarse to fit a field to (27 px to a row). Traced, its four left temporal
  // rows carry 1-4 Hz activity of 0.63, 1, 0.65 and 0.85 of the largest, which read
  // as a maximum at T3 puts F7 at 0.40 and T5 at 0.54 of it — about what this
  // field has (0.42, 0.39). It was one patch under T3 (0.28 and 0.20).
  spec: synchronousPatches('focal-delta-temporal', MID_TEMPORAL_REGIONAL, { extent: 0.3 }),
  make(seed, dt) {
    const ts = new TransientSource<FocalDeltaEvent>(seed, dt, {
      // legacy nextEventTime('fdt-burst', t, 3, 6).
      schedule: { kind: 'periodic', period: 4.5, jitterFrac: 3 / 9 },
      duration: 3.5, // covers the jittered burst length (2.5 * [0.7, 1.3]) with margin
      onset: (g) => ({ dur: jit(g, 2.5, 0.3) }),
      mark: (e) => ({ span: e.dur }),
      morphology: (t, e) => {
        if (t < 0 || t > e.dur) return 0;
        return 80 * multiToneSignal(
          t, [{ f: 1.2, a: 1 }, { f: 1.8, a: 0.9 }, { f: 2.2, a: 0.8 }, { f: 2.5, a: 0.6 }], 2.5,
        );
      },
    });
    return asGenerator(ts);
  },
};

// ---------------------------------------------------------------------------
// Triphasic waves — periodic, generalised complexes with a small initial
// negativity, a dominant positive peak, and a broader final negativity
// (−/+/−), classic for hepatic/uraemic/other metabolic encephalopathy.
// Anteriorly predominant: amplitude is largest frontally and falls off
// posteriorly. Per LEARNINGEEG-STUDY.md §9: "generalised with subtle
// anterior→posterior lag" — the posterior repetition of the same complex
// trails the frontal one by tens of milliseconds; this is taught as a
// distinguishing feature from other generalised periodic patterns.
//
// A single leadfield column has one time course, so one source alone can only
// give an amplitude GRADIENT — every electrode it projects to peaks in
// lock-step, never a timing difference. Modelling the AP lag therefore needs
// TWO sources: an anterior one (unchanged) and a posterior one whose
// morphology is the same triphasicWave shape evaluated LAG_S seconds later.
//
// The two descriptors deliberately share the SAME `id` ('triphasic'), which
// makes `deriveSeed(seed, d.id)` in engine.ts hand them an IDENTICAL derived
// seed, so their independent TransientSource schedulers draw byte-identical
// onset times and amplitude jitter (both are gated by the same toggle, so
// they see the same enabled-sample sequence too) — the posterior complex is
// thus the SAME discharge as the anterior one, just time-shifted, which is
// the physiologically correct relationship (one generalised discharge
// propagating front-to-back), not two independent random processes that
// happen to look similar. `variants.ts` already relies on this same
// id-keyed-seed lever for the opposite purpose (decorrelating left/right
// wicket and BETS sources by giving them DIFFERENT ids); this is that lever
// run in reverse to deliberately correlate two sources.
// ---------------------------------------------------------------------------
type TriphasicEvent = { amp: number };

/**
 * Anterior-to-posterior lag between the two halves. learningeeg calls it "a subtle
 * delay in the onset of each as you move from the anterior to posterior regions"
 * and gives no figure; ACNS 2021 §C.4.c does: a lag is present when there is "a
 * consistent measurable delay of > 100 ms from the most anterior to the most
 * posterior derivation". 140 ms between the two halves reads as ~110-140 ms from
 * the first row of a chain to the last (the back rows see a little of the front
 * half too), which clears that; it is 4 mm of paper at 30 mm/s — a slant a reader
 * can see without it becoming two separate waves. It was 60 ms, which under
 * ACNS's own definition is not a lag at all.
 */
const TRIPHASIC_LAG_S = 0.14;

/**
 * Length of one event for BOTH halves: the wave's own 0.7 s support plus the lag.
 * The next event is scheduled when the current one ends, so the two halves stay
 * locked only if they end together. They used not to: the posterior half ran
 * 0.11 s longer than the anterior, so it fell that much further behind on EVERY
 * complex and was a whole cycle out within eight — the "lag" was a drift, and the
 * front-to-back correlation checks sat on their floors because of it (0.189
 * against 0.15, 0.129 against 0.08).
 */
const TRIPHASIC_SPAN = 0.7 + TRIPHASIC_LAG_S;

/**
 * Gap between one event and the next, giving a complex every ~0.87 s, or ~1.15
 * per second. learningeeg gives triphasic waves as 1-3 Hz (its example runs
 * ~1.5). The legacy gap was 0.5-1.2 s on top of the 0.7 s wave — a complex every
 * 1.2-1.9 s, 0.65 Hz, under that range.
 */
const TRIPHASIC_GAP = { kind: 'periodic', period: 0.03, jitterFrac: 0.3 } as const;

const triphasic: PatternSourceDescriptor = {
  id: 'triphasic',
  toggles: ['triphasic'],
  // Periodic: what a reader names is the run ("triphasic waves at ~1 Hz"), not each
  // complex, so one box while it is on — on the rows of both halves, front and back.
  openBox: { where: 'toggle' },
  // The anterior half: bilateral and frontally maximal, fading to nothing behind
  // the central row (the bifrontal field, fields.ts), so that the posterior half
  // below is what the back of the head sees — and sees LATE. It was one patch
  // under Fz (extent 0.45), which gave F3 and F4 a fifth of Fz and the frontal
  // pole a tenth: a wave on Fz-Cz and little else. The generalized frontal field
  // was tried first and rejected: it reaches the parietal and occipital rows at
  // half strength with no delay, which swamped the lag (36 ms measured against
  // the 110 ms then built in). 330 uV holds the frontal maximum near the patch's 180.
  spec: synchronousPatches('triphasic', BIFRONTAL, { extent: 0.3 }),
  make(seed, dt) {
    const ts = new TransientSource<TriphasicEvent>(seed, dt, {
      schedule: TRIPHASIC_GAP,
      duration: TRIPHASIC_SPAN,
      onset: (g) => ({ amp: jit(g, 1, 0.2) }),
      morphology: (t, e) => triphasicWave(t, 330 * e.amp),
    });
    return asGenerator(ts);
  },
};

// Posterior half of the triphasic pair (see comment above): the same complex on
// the posterior field (fields.ts), playing out TRIPHASIC_LAG_S later and smaller
// — 150 uV at its own maximum against the anterior source's 330, about a third
// of the frontal rows' size on the posterior ones — so the wave is on every
// chain and still largest in front. Both halves draw the same gaps and end
// together (TRIPHASIC_SPAN), which is what keeps the lag a lag.
const triphasicPosterior: PatternSourceDescriptor = {
  id: 'triphasic', // shared on purpose — see comment on `triphasic` above.
  toggles: ['triphasic'],
  spec: synchronousPatches('triphasic-posterior', GENERALIZED_POSTERIOR, { extent: 0.3 }),
  make(seed, dt) {
    const ts = new TransientSource<TriphasicEvent>(seed, dt, {
      schedule: TRIPHASIC_GAP,
      duration: TRIPHASIC_SPAN,
      onset: (g) => ({ amp: jit(g, 1, 0.2) }),
      morphology: (t, e) => triphasicWave(t - TRIPHASIC_LAG_S, 150 * e.amp),
    });
    return asGenerator(ts);
  },
};

// ---------------------------------------------------------------------------
// GPEDs — Generalised Periodic Epileptiform Discharges (GPDs in the current
// ACNS terminology): a generalised spike/sharp wave recurring every 1-2 s,
// classic for CJD, severe anoxic injury, or advanced encephalopathy.
// Morphology is a sharp initial spike (narrow Gaussian) immediately followed by
// a smaller, broader after-going component of the opposite polarity — legacy's
// two-Gaussian construction, scaled by a per-event "morph" jitter so the
// complex's width (not just its amplitude) varies slightly discharge to
// discharge, the way real periodic discharges do.
//
// FIELD. "Generalized" is defined, not left to taste: "any bilaterally
// synchronous and symmetric pattern" (ACNS 2021, Hirsch et al., J Clin
// Neurophysiol 38:1, §C.1.a), and learningeeg's Rhythmicity & Periodicity
// chapter calls GPDs "discrete and bilaterally synchronous discharges". On its
// two GPD figures the discharge is on EVERY row of the double banana at
// comparable size (smallest row 0.42 and 0.53 of the largest), every chain
// reversing mid-chain and Fz-Cz mirroring Cz-Pz — a broad dome, highest over the
// central region.
//
// So the generator is a group of co-active patches under all nineteen sites, one
// time course, mirrored left to right (`synchronousPatches`), highest at the
// vertex and falling off smoothly forwards, backwards and sideways. The weights
// are a least-squares fit of the patch fields to that dome (Cz 1; C3/C4 0.9;
// T3/T4 0.65; F and P rows about half their central neighbour; Fp and O near
// zero). Two things were fixed by the fit and are checked in the gate: every
// longitudinal row carries the discharge, and the midline is NOT 50% above the
// parasagittal sites, which ACNS would call "midline predominant" rather than
// plain generalized.
//
// It used to be ONE patch under Cz (extent 0.75), meant to be "comparable across
// the scalp". It was not: C3 and C4 saw 21% of Cz, the discharge measured 123 uV
// on Fz-Cz against 25 uV on the parasagittal rows and 1-2 uV on the temporal
// chains, and a pattern taught as generalized drew as a vertex spike (measured
// 2026-10-12; the same single-patch defect generalized slowing had, above).
// ---------------------------------------------------------------------------
type GpedEvent = { amp: number; morph: number };

const gpeds: PatternSourceDescriptor = {
  id: 'gpeds',
  toggles: ['gpeds'],
  // Periodic: the run is the finding (see triphasic), one box while it is on.
  openBox: {},
  spec: synchronousPatches('gpeds', {
    Cz: 1, C3: 0.9, C4: 0.9, T3: 0.8, T4: 0.8, Fz: 0.6, Pz: 0.6, P3: 0.55, P4: 0.55, T5: 0.5, T6: 0.5,
    F3: 0.45, F4: 0.45, F7: 0.45, F8: 0.45, Fp1: 0.35, Fp2: 0.35, O1: 0.3, O2: 0.3,
  }, { extent: 0.3 }),
  make(seed, dt) {
    const ts = new TransientSource<GpedEvent>(seed, dt, {
      // One discharge every ~1.5 s, each interval within 8% of that. The interval
      // is what makes a discharge PERIODIC: learningeeg (Physiology & Terminology)
      // calls a pattern periodic when the interval varies by under 25%,
      // quasi-periodic at 25-50%, and not periodic at all beyond that. The legacy
      // draw was uniform over 1.0-2.0 s (a third either side), which let one
      // interval be double the last — the page read as irregular sharp waves.
      schedule: { kind: 'periodic', period: 1.5, jitterFrac: PERIODIC_JITTER },
      duration: 0.2, // legacy renders only dt < 0.2 of the complex
      onset: (g) => ({ amp: jit(g, 1, 0.2), morph: jit(g, 1, 0.15) }),
      morphology: (t, e) => {
        // 300 uV at the source's own maximum. A field this broad carries a large
        // return term (`surfaceMean` in forward.ts), so that is ~160 uV at Cz
        // against infinity — what the single Cz patch gave at its legacy 200 —
        // and ~80 uV peak, ~110 uV peak to trough, on the largest longitudinal
        // row: "medium" on ACNS's bipolar scale (50-149 uV, §C.3.f).
        const amp = 300 * e.amp;
        // A diphasic sharp wave: the surface-negative sharp component and a
        // smaller positive phase straight after it. That second phase is part of
        // the sharp wave itself, not an after-going slow wave (which would share
        // the spike's polarity; see spikeSlowWave in morphology.ts).
        const spike = -amp * gaussian(t, 0.05 * e.morph, 0.02 * e.morph);
        const after = -amp * 0.5 * gaussian(t, 0.11 * e.morph, 0.04 * e.morph);
        return spike - after;
      },
    });
    return asGenerator(ts);
  },
};

// ---------------------------------------------------------------------------
// LPEDs — Lateralised Periodic Epileptiform Discharges (LPDs): a sharp wave and
// the slow wave that follows it, the same polarity, recurring about once a
// second over one hemisphere — herpes encephalitis and acute stroke are classic
// causes. learningeeg: "discrete periodic discharges recurring roughly once per
// second ... with a clear interval between each"; its example runs at 1-1.5 Hz.
//
// Each complex is a sharp wave (~95 ms at its base) and a slow wave ~360 ms
// long, stretched or compressed a little from one discharge to the next and
// played out in full. Until 2026-10-13 it was the shared `spikeSlowWave` cut off
// 0.25 s in — before that helper's slow wave, then centred at 0.45 s, was a third of
// the way up — so every discharge ended in a 60 uV step, and they came every
// 1.4 s, slower than the source's "roughly once per second".
//
// Additionally, legacy adds a small continuous regional delta-slowing term
// between discharges (the region isn't just periodic spikes on a flat
// background — LPEDs classically sit on a slowed background). Reused here at
// reduced, constant amplitude via the shared DELTA_TONES set; the original's
// slow OU-noise amplitude wander has no equivalent primitive in this file and
// is dropped as a cosmetic simplification (see report).
// ---------------------------------------------------------------------------
type LpedEvent = { amp: number; morph: number };

// At the source's own maximum. T3 sees 0.88 of it through the regional field and
// saw 0.87 through the single patch this replaced, so the figure did not move.
const LPED_UV = 220;

const lpeds: PatternSourceDescriptor = {
  id: 'lpeds',
  toggles: ['lpeds'],
  // Periodic: the run is the finding (see triphasic), one box while it is on.
  openBox: {},
  spec: synchronousPatches('lpeds', LEFT_TEMPORAL_REGIONAL, { extent: 0.3 }),
  make(seed, dt) {
    const ts = new TransientSource<LpedEvent>(seed, dt, {
      // 0.6 s of complex and ~0.45 s between: one discharge every ~1.05 s, nearly
      // regular (see PERIODIC_JITTER).
      schedule: { kind: 'periodic', period: 0.45, jitterFrac: PERIODIC_JITTER },
      duration: 0.6,
      onset: (g) => ({ amp: jit(g, 1, 0.2), morph: jit(g, 1, 0.15) }),
      morphology: (t, e) => {
        const a = LPED_UV * e.amp, u = t / e.morph;
        return -a * gaussian(u, 0.06, 0.022) - 0.6 * a * gaussian(u, 0.27, 0.085);
      },
    });
    return {
      next: (ctx) => {
        const spike = ts.next(ctx.enabled);
        if (!ctx.enabled) return spike;
        const bg = 40 * 0.5 * multiToneSignal(ctx.t, DELTA_TONES, DELTA_TONE_NORM);
        return spike + bg;
      },
    };
  },
};

export const NON_EPILEPTIFORM_SOURCES: PatternSourceDescriptor[] = [
  ...GEN_SLOWING, firda, focalDeltaTemporal, triphasic, triphasicPosterior, gpeds, lpeds,
];

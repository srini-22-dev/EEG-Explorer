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

import { sourceUnder } from '../forward';
import { HopfOscillator } from '../oscillator';
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
});

// ---------------------------------------------------------------------------
// Generalised slowing (encephalopathy, sedating medications). Two facts define
// it clinically and must both be modelled: (1) diffuse theta + delta appear
// everywhere, and (2) the normal posterior alpha rhythm (the PDR) is LOST — a
// record with preserved alpha is not "slowed". So this is not additive-only: the
// added slow rhythms REPLACE the alpha, which is what `bandGate` expresses.
//
// The slow activity is generated with the engine's own Hopf oscillators (the
// same primitive that produces the background rhythms) rather than fixed tones,
// so it wanders in frequency and amplitude the way real polymorphic slowing does
// instead of reading as a metronomic sine. One broad central source with a large
// extent gives the near-uniform, diffuse topography of generalised slowing.
// ---------------------------------------------------------------------------
const genSlowing: PatternSourceDescriptor = {
  id: 'gen-slowing',
  toggles: ['gen-slowing'],
  spec: sourceUnder('gen-slowing', ['Cz'], { extent: 0.85 }),
  make(seed, dt) {
    // Delta dominates over theta in moderate–marked slowing; both wander.
    const theta = new HopfOscillator(deriveSeed(seed, 'theta'), dt, {
      freq: 5.0, rms: 22, freqWander: 0.8, damping: -2.2,
    });
    const delta = new HopfOscillator(deriveSeed(seed, 'delta'), dt, {
      freq: 1.6, rms: 34, freqWander: 0.5, damping: -1.2,
    });
    return {
      // Advance the oscillators every sample for phase continuity, but only emit
      // (and only suppress the alpha PDR) while the pattern is enabled.
      next: (ctx) => {
        const v = theta.next() + delta.next();
        return ctx.enabled ? v : 0;
      },
      // Abolish the posterior alpha rhythm and its central mu counterpart; damp
      // beta. Consulted only while enabled (see engine `next()`).
      bandGate: () => ({ alpha: 0.15, mu: 0.15, beta: 0.5 }),
    };
  },
};

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
// ---------------------------------------------------------------------------
type FirdaEvent = { dur: number };

const firda: PatternSourceDescriptor = {
  id: 'firda',
  toggles: ['firda'],
  spec: sourceUnder('firda', ['Fz', 'Fp1', 'Fp2'], { extent: 0.5 }),
  make(seed, dt) {
    const ts = new TransientSource<FirdaEvent>(seed, dt, {
      // legacy nextEventTime('firda-burst', t, 4, 8): period (4+8)/2, jitterFrac (8-4)/(4+8).
      schedule: { kind: 'periodic', period: 6, jitterFrac: 4 / 12 },
      duration: 3.95, // covers the jittered burst length (3 * [0.7, 1.3]) with margin
      onset: (g) => ({ dur: jit(g, 3, 0.3) }),
      morphology: (t, e) => {
        if (t < 0 || t > e.dur) return 0;
        const env = gaussian(t, e.dur / 2, e.dur / 4); // burst envelope, peak mid-burst
        return 100 * env * multiToneSignal(t, [{ f: 2.4, a: 1 }, { f: 2.6, a: 0.8 }], 1.8);
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
  // T3 anchors the left temporal source; legacy also fires under F7 (adjacent
  // left anterotemporal), which the leadfield's spatial falloff from T3 covers.
  spec: sourceUnder('focal-delta-temporal', ['T3'], { extent: 0.4 }),
  make(seed, dt) {
    const ts = new TransientSource<FocalDeltaEvent>(seed, dt, {
      // legacy nextEventTime('fdt-burst', t, 3, 6).
      schedule: { kind: 'periodic', period: 4.5, jitterFrac: 3 / 9 },
      duration: 3.5, // covers the jittered burst length (2.5 * [0.7, 1.3]) with margin
      onset: (g) => ({ dur: jit(g, 2.5, 0.3) }),
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

/** Subtle AP lag per LEARNINGEEG-STUDY.md (no exact ms figure given there;
 *  60 ms is mid-range for the "tens of milliseconds, subtle" literature
 *  description and stays well inside the wave's own ~700 ms support). */
const TRIPHASIC_LAG_S = 0.06;

const triphasic: PatternSourceDescriptor = {
  id: 'triphasic',
  toggles: ['triphasic'],
  // Tightened from the pre-split 0.6 (when one source alone had to reach the
  // whole scalp): now that a dedicated posterior source exists, the anterior
  // source only needs to cover the frontal region convincingly, leaving room
  // for the posterior source's own (lagged) timing to actually show through
  // at Cz/Pz/O1/O2 rather than being swamped by the anterior source's reach.
  spec: sourceUnder('triphasic', ['Fz'], { extent: 0.45 }),
  make(seed, dt) {
    const ts = new TransientSource<TriphasicEvent>(seed, dt, {
      // legacy nextEventTime('triphasic', t, 0.5, 1.2): ~1.5 Hz periodic repetition.
      schedule: { kind: 'periodic', period: 0.85, jitterFrac: 0.7 / 1.7 },
      duration: 0.7, // triphasicWave's own support
      onset: (g) => ({ amp: jit(g, 1, 0.2) }),
      morphology: (t, e) => triphasicWave(t, 180 * e.amp),
    });
    return asGenerator(ts);
  },
};

// Posterior half of the triphasic pair (see comment above): same complex,
// anchored under Pz/O1/O2, playing out TRIPHASIC_LAG_S later and at reduced
// amplitude (65 µV at its own peak electrode vs the anterior source's 180 µV)
// so the frontal-predominant amplitude gradient the anterior source already
// establishes is preserved, not overridden.
const triphasicPosterior: PatternSourceDescriptor = {
  id: 'triphasic', // shared on purpose — see comment on `triphasic` above.
  toggles: ['triphasic'],
  spec: sourceUnder('triphasic-posterior', ['Pz', 'O1', 'O2'], { extent: 0.55 }),
  make(seed, dt) {
    const ts = new TransientSource<TriphasicEvent>(seed, dt, {
      schedule: { kind: 'periodic', period: 0.85, jitterFrac: 0.7 / 1.7 },
      duration: 0.7 + TRIPHASIC_LAG_S + 0.05, // covers the shifted wave's support with margin
      onset: (g) => ({ amp: jit(g, 1, 0.2) }),
      morphology: (t, e) => triphasicWave(t - TRIPHASIC_LAG_S, 65 * e.amp),
    });
    return asGenerator(ts);
  },
};

// ---------------------------------------------------------------------------
// GPEDs — Generalised Periodic Epileptiform Discharges: a generalised
// spike/sharp wave recurring every 1-2 s, classic for CJD, severe anoxic
// injury, or advanced encephalopathy. Morphology is a sharp initial spike
// (narrow Gaussian) immediately followed by a smaller, broader negative
// after-going component — legacy's two-Gaussian construction, scaled by a
// per-event "morph" jitter so the complex's width (not just its amplitude)
// varies slightly discharge to discharge, the way real periodic discharges do.
// Generalised → broad, midline-anchored source (Cz, extent 0.75) so amplitude
// is comparable across the scalp rather than confined to one region.
// ---------------------------------------------------------------------------
type GpedEvent = { amp: number; morph: number };

const gpeds: PatternSourceDescriptor = {
  id: 'gpeds',
  toggles: ['gpeds'],
  spec: sourceUnder('gpeds', ['Cz'], { extent: 0.75 }),
  make(seed, dt) {
    const ts = new TransientSource<GpedEvent>(seed, dt, {
      // legacy nextEventTime('gped', t, 1.0, 2.0).
      schedule: { kind: 'periodic', period: 1.5, jitterFrac: 1 / 3 },
      duration: 0.2, // legacy renders only dt < 0.2 of the complex
      onset: (g) => ({ amp: jit(g, 1, 0.2), morph: jit(g, 1, 0.15) }),
      morphology: (t, e) => {
        const amp = 200 * e.amp; // 200: legacy's frontal/midline coefficient (Cz is midline)
        // Surface-negative sharp component, positive after-going component —
        // the same polarity convention as spikeSlowWave (see morphology.ts).
        const spike = -amp * gaussian(t, 0.05 * e.morph, 0.02 * e.morph);
        const after = -amp * 0.5 * gaussian(t, 0.11 * e.morph, 0.04 * e.morph);
        return spike - after;
      },
    });
    return asGenerator(ts);
  },
};

// ---------------------------------------------------------------------------
// LPEDs — Lateralised Periodic Epileptiform Discharges: focal/regional sharp
// waves each followed by a slow after-wave, recurring every 0.8-1.5 s over one
// hemisphere — herpes encephalitis and acute stroke are classic causes. Built
// from the shared `spikeSlowWave` morphology (sharp component + slower
// negative after-wave), left temporal, with a per-event "morph" jitter that
// stretches/compresses the whole complex, matching legacy's `dt / morph` call.
//
// Legacy also renders each complex only for dt < 0.25 s of real time — short
// enough that, at typical morph (~0.8-1.2), the slow-wave trough (which
// spikeSlowWave places at dt=0.45 in its own time base) is never reached; only
// the sharp component and the very start of the slow wave's decline show.
// Preserved verbatim here (see report — flagged as a legacy timing question,
// not silently "fixed").
//
// Additionally, legacy adds a small continuous regional delta-slowing term
// between discharges (the region isn't just periodic spikes on a flat
// background — LPEDs classically sit on a slowed background). Reused here at
// reduced, constant amplitude via the shared DELTA_TONES set; the original's
// slow OU-noise amplitude wander has no equivalent primitive in this file and
// is dropped as a cosmetic simplification (see report).
// ---------------------------------------------------------------------------
type LpedEvent = { amp: number; morph: number };

const lpeds: PatternSourceDescriptor = {
  id: 'lpeds',
  toggles: ['lpeds'],
  spec: sourceUnder('lpeds', ['T3'], { extent: 0.4 }),
  make(seed, dt) {
    const ts = new TransientSource<LpedEvent>(seed, dt, {
      // legacy nextEventTime('lped', t, 0.8, 1.5).
      schedule: { kind: 'periodic', period: 1.15, jitterFrac: 0.7 / 2.3 },
      duration: 0.25, // legacy renders only dt < 0.25 of the complex
      onset: (g) => ({ amp: jit(g, 1, 0.2), morph: jit(g, 1, 0.2) }),
      morphology: (t, e) => spikeSlowWave(t / e.morph, 220 * e.amp, 220 * 0.6 * e.amp),
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
  genSlowing, firda, focalDeltaTemporal, triphasic, triphasicPosterior, gpeds, lpeds,
];

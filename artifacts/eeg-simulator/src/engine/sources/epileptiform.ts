/**
 * Interictal epileptiform sources — focal spikes (LT/RT/LF), 3 Hz generalised
 * spike-wave, polyspike-wave, burst-suppression, hypsarrhythmia.
 *
 * All morphology/timing here is ported verbatim from the legacy
 * `epileptiformVoltage` / `voltageGate` (burst-suppression branch); only the
 * topography changed. Per the briefing's translation rules: a legacy FIELD
 * table (`LT_FIELD`/`RT_FIELD`/`LF_FIELD`) told us the electrode where a focal
 * discharge is largest, and the leadfield now supplies the falloff away from
 * it, so the per-electrode attenuation numbers in those tables are gone — only
 * the peak-electrode amplitude survives, unattenuated.
 */

import { sourceUnder, sourceBetween, synchronousPatches, type SourceSpec } from '../forward';
import type { FocalPlacement } from '../../utils/simTypes';
import { GENERALIZED_FRONTAL } from './fields';
import { Gaussian } from '../rng';
import { TransientSource } from './transient';
import {
  gaussian, spikeSlowWave, epileptiformTransient, rhythmicSpikeWave, multiToneSignal, hashUnit,
  DELTA_TONES, DELTA_TONE_NORM,
} from './morphology';
import type { PatternSourceDescriptor, PatternGenerator } from './registry';

/** Per-event multiplicative jitter, matching the legacy `jitter(base, frac)`. */
const jit = (g: Gaussian, base: number, frac: number): number =>
  base * (1 + (g.uniform() - 0.5) * 2 * frac);

/** Wrap a `TransientSource` as a `PatternGenerator` (gate its output on `ctx.enabled`). */
const asGenerator = <E>(ts: TransientSource<E>): PatternGenerator => ({
  next: (ctx) => ts.next(ctx.enabled),
});

// ---------------------------------------------------------------------------
// Focal interictal spikes — a paroxysmal hypersynchronous discharge of a
// cortical patch: a sharp, surface-negative spike (<70 ms) immediately
// followed by an obligatory slow wave (the after-going slow wave reflects the
// hyperpolarisation that terminates the paroxysmal depolarising shift). Not a
// seizure — an interictal marker of an epileptogenic focus. `spikeSlowWave`
// supplies that fixed morphology (a 60 ms spike and, 0.12 s after it, a 0.24 s
// slow wave, both surface-negative).
//
// LT (left temporal, mesial/lateral temporal lobe epilepsy) peaks at T3, RT
// mirrors it at T4, LF (frontal lobe epilepsy) peaks at F3. The legacy FIELD
// tables' negative-going, phase-reversing spread through neighbouring
// electrodes (F7/T5 for LT, F8/T6 for RT, Fp1/Fz for LF) is now purely the
// leadfield's job — `sourceUnder`'s Gaussian falloff and the tangential/radial
// dipole model reproduce the phase reversal a real focal source shows at the
// scalp, so only the peak-electrode amplitude is carried over here.
// ---------------------------------------------------------------------------
type FocalSpikeEvent = { amp: number; dur: number };

// Each focus comes in two placements (`FocalPlacement`), which are two sources: one
// under the named electrode, which is what gives the phase reversal there, and
// one midway between that electrode and its neighbour up the chain, which gives
// the other localising picture — the link spanning the two goes flat (an
// isopotential) and the links either side deflect opposite ways (IK-003 case b).
// Only the chosen one fires.
function focalSpikeSources(
  id: string, toggle: string, electrode: string, neighbour: string, extent: number,
  intervalLo: number, intervalHi: number, ampSpike: number, ampSlow: number,
): PatternSourceDescriptor[] {
  const at = (srcId: string, spec: SourceSpec, focus: FocalPlacement): PatternSourceDescriptor => ({
    id: srcId,
    toggles: [toggle],
    spec,
    make(seed, dt) {
      const ts = new TransientSource<FocalSpikeEvent>(seed, dt, {
        // Legacy nextEventTime(key, t, a, b) -> periodic(period=(a+b)/2, jitterFrac=(b-a)/(a+b)).
        schedule: {
          kind: 'periodic',
          period: (intervalLo + intervalHi) / 2,
          jitterFrac: (intervalHi - intervalLo) / (intervalHi + intervalLo),
        },
        // spikeSlowWave's own cutoff (its argument > 0.9) ends the event; this just
        // has to be no smaller than the largest that cutoff can reach (dur up to 1.15).
        duration: 1.05,
        onset: (g) => ({ amp: jit(g, 1, 0.2), dur: jit(g, 1, 0.15) }),
        // `dur` here is not seconds — it is a per-event stretch factor (~0.85-1.15)
        // on spikeSlowWave's fixed-shape argument, giving each discharge a slightly
        // different spike/slow-wave width the way real interictal spikes vary.
        morphology: (t, e) => e.amp * spikeSlowWave(t / e.dur, ampSpike, ampSlow),
      });
      return { next: (ctx) => ts.next(ctx.enabled && ctx.focalPlacement === focus) };
    },
  });
  return [
    at(id, sourceUnder(id, [electrode], { extent }), 'under'),
    at(`${id}-between`, sourceBetween(`${id}-between`, neighbour, electrode, extent), 'between'),
  ];
}

// Between F7 and T3: F7-T3 goes flat, Fp1-F7 and T3-T5 oppose.
const focalSpikesLt = focalSpikeSources(
  'focal-spikes-lt', 'focal-spikes-lt', 'T3', 'F7', 0.25, 3, 7, 185, 130,
);

// ---------------------------------------------------------------------------
// Interictal discharge MORPHOLOGY set (IK-012). The four waveforms a reader
// must tell apart, placed at one left-temporal focus (T3) so they can be
// compared side by side:
//   - spike:               a pointed transient 20-70 ms at its base, no slow wave
//   - sharp wave:          a pointed transient 70-200 ms at its base, no slow wave
//   - spike-and-slow-wave: a spike followed by an obligatory after-going slow wave
//   - sharp-and-slow-wave: a sharp wave followed by that same slow wave
// DURATION separates a spike from a sharp wave; the AFTER-GOING SLOW WAVE is
// what makes either a "-and-slow-wave" complex. `epileptiformTransient` encodes
// both axes (sigma sets the base width, ampSlow adds the slow wave). This is
// distinct from the localised `focal-spikes-*` foci above, which teach phase
// reversal at a named electrode rather than the morphology distinction.
// ---------------------------------------------------------------------------
type MorphEvent = { amp: number };

// Base widths at 10% of peak: sigma 0.007 s -> ~30 ms (spike), 0.025 s -> ~107 ms
// (sharp wave). Peak spike ~160 uV, sharp ~150 uV, slow wave ~110 uV at T3.
const SPIKE_SIGMA = 0.007;
const SHARP_SIGMA = 0.025;

function morphologySource(
  id: string, sigmaSharp: number, ampSharp: number, ampSlow: number,
): PatternSourceDescriptor {
  return {
    id,
    toggles: [id],
    spec: sourceUnder(id, ['T3'], { extent: 0.25 }),
    make(seed, dt) {
      const ts = new TransientSource<MorphEvent>(seed, dt, {
        schedule: { kind: 'periodic', period: 5, jitterFrac: 0.4 }, // ~3-7 s, as the focal foci
        duration: 1.05,
        onset: (g) => ({ amp: jit(g, 1, 0.2) }),
        morphology: (t, e) => epileptiformTransient(t, ampSharp * e.amp, sigmaSharp, ampSlow * e.amp),
      });
      return asGenerator(ts);
    },
  };
}

const iedSpike     = morphologySource('ied-spike',      SPIKE_SIGMA, 160, 0);
const iedSpikeWave = morphologySource('ied-spike-wave', SPIKE_SIGMA, 160, 110);
const iedSharp     = morphologySource('ied-sharp',      SHARP_SIGMA, 150, 0);
const iedSharpWave = morphologySource('ied-sharp-wave', SHARP_SIGMA, 150, 110);
const focalSpikesRt = focalSpikeSources(
  'focal-spikes-rt', 'focal-spikes-rt', 'T4', 'F8', 0.25, 3, 7, 185, 130,
);
// Between F3 and C3: F3-C3 goes flat, Fp1-F3 and C3-P3 oppose.
const focalSpikesLf = focalSpikeSources(
  'focal-spikes-lf', 'focal-spikes-lf', 'F3', 'C3', 0.3, 4, 8, 165, 120,
);

// ---------------------------------------------------------------------------
// 3 Hz generalised spike-wave — the pathognomonic pattern of absence epilepsy:
// a generalised, frontally-maximal, ~3 Hz spike-and-slow-wave discharge.
// Continuous for seconds during a clinical absence; here modelled as the
// briefer interictal bursts also seen between events. `rhythmicSpikeWave`
// scales the spike-slow-wave shape to whatever the cycle length currently is,
// so it stays a genuine 3 Hz complex rather than a slowed-down 0.9 s one.
//
// Two things a real burst does that a fixed-amplitude rhythm would not:
// the discharge frequency itself wanders slightly cycle to cycle (2.8-3.2 Hz,
// not a metronome), and the burst does not stop abruptly — amplitude tapers
// over roughly its last second as the discharge terminates.
//
// Field: `GENERALIZED_FRONTAL` (fields.ts) — on every chain, largest across the
// frontal row. It was one patch under Fz, which drew a frontal-midline focus:
// Fz-Cz carried it, the frontopolar and parasagittal rows a third of that and
// the temporal chains a tenth. Amplitudes are the legacy 200 and 180 uV scaled
// by 1.65, which holds Fz where the single patch put it (~170 uV against
// infinity) now that the field's return term takes a larger share.
// ---------------------------------------------------------------------------
type GswBurstEvent = { dur: number; freq: number };

const gsw3hz: PatternSourceDescriptor = {
  id: '3hz-gsw',
  toggles: ['3hz-gsw'],
  spec: synchronousPatches('3hz-gsw', GENERALIZED_FRONTAL, { extent: 0.3 }),
  make(seed, dt) {
    const ts = new TransientSource<GswBurstEvent>(seed, dt, {
      schedule: { kind: 'periodic', period: 5, jitterFrac: 0.4 }, // legacy nextEventTime(3,7)
      duration: 3.7, // upper bound on the jittered per-burst duration below
      onset: (g) => ({ dur: jit(g, 3, 0.2), freq: jit(g, 3.0, 0.06) }), // 2.82-3.18 Hz
      morphology: (burstDt, e) => {
        if (burstDt >= e.dur) return 0; // TransientSource's fixed cap exceeds this event's actual length
        const cycleLen = 1 / e.freq;
        const dt = burstDt % cycleLen;
        // Linear amplitude taper over the final second as the burst terminates.
        const env = burstDt > e.dur - 1.0 ? 1.0 - (burstDt - (e.dur - 1.0)) : 1.0;
        const amp = 330 * env; // at the source's own maximum; see the field note above
        return rhythmicSpikeWave(dt, cycleLen, amp, amp * 0.65);
      },
    });
    return asGenerator(ts);
  },
};

// ---------------------------------------------------------------------------
// Polyspike-wave — 2-5 rapid spikes ("polyspikes") followed by a slow wave,
// generalised and frontally-maximal: the classic juvenile myoclonic epilepsy
// discharge (the polyspike burst correlates clinically with the myoclonic
// jerk, the following slow wave with its resolution). Unlike 3 Hz GSW, the
// inter-spike interval itself evolves *within* one burst — the complexes
// decelerate as the burst runs on — and the individual polyspikes are not
// identical in amplitude, which is what makes this pattern read as irregular
// rather than the metronomic 3 Hz rhythm above.
// ---------------------------------------------------------------------------
type PolyspikeBurstEvent = { count: number; amp: number };

const polyspikeWave: PatternSourceDescriptor = {
  id: 'polyspike-wave',
  toggles: ['polyspike-wave'],
  spec: synchronousPatches('polyspike-wave', GENERALIZED_FRONTAL, { extent: 0.3 }),
  make(seed, dt) {
    const ts = new TransientSource<PolyspikeBurstEvent>(seed, dt, {
      schedule: { kind: 'periodic', period: 6, jitterFrac: 1 / 3 }, // legacy nextEventTime(4,8)
      duration: 3, // legacy hard-codes the burst window itself at exactly 3s
      onset: (g) => ({
        count: Math.floor(2 + g.uniform() * 4), // 2-5 polyspikes
        amp: jit(g, 1, 0.25),
      }),
      morphology: (burstDt, e) => {
        // One complex is a positive trough with the polyspikes rising out of it,
        // then the negative slow wave: polyspikes and wave both up (see
        // rhythmicSpikeWave in morphology.ts, whose layout this is). Its length
        // grows with the number of polyspikes, 40 ms apiece, so the slow wave
        // always has room — at a fixed 0.35 s, four or five polyspikes left the
        // slow wave cut off at full height where the next complex began — and it
        // lengthens a little as the burst runs, the discharge decelerating rather
        // than holding a fixed rate.
        const cycle0 = 0.27 + e.count * 0.04;
        const cycleLen = cycle0 + burstDt * 0.05;
        const dt = burstDt % cycleLen;
        // The burst window is a fixed 3 s; fade over its last half second so it
        // does not stop part-way up a wave.
        // 405 uV at the source's own maximum (see the 3 Hz field note above). It
        // was 300 when the slow wave opposed the polyspikes; x1.35 holds the
        // complex's peak-to-peak where that put it.
        const amp = 405 * e.amp * Math.min(1, (3 - burstDt) / 0.5);
        // The last polyspike sits just before the trough turns into the dome.
        const first = 0.45 * cycle0 - (e.count - 1) * 0.04;
        let v = 0;
        for (let i = 0; i < e.count; i++) {
          // hashUnit, not per-sample jitter: each polyspike needs ONE amplitude that
          // differs from its neighbours', fixed for its own gaussian bump — a stream
          // re-rolled every sample would scribble noise across the burst instead.
          v -= amp * (0.65 + 0.35 * hashUnit(i + 1)) * gaussian(dt, first + i * 0.04, 0.015);
        }
        // Trough first, then the slow wave that follows the last polyspike.
        v += amp * 0.7 * Math.sin(2 * Math.PI * dt / cycleLen);
        return v;
      },
    });
    return asGenerator(ts);
  },
};

// ---------------------------------------------------------------------------
// Burst-suppression — alternating high-amplitude bursts and near-flat
// suppression, seen in deep anaesthesia or severe anoxic/hypoxic-ischaemic
// injury: the cortex intermittently and near-globally fails to sustain
// ongoing activity, punctuated by bursts of relatively preserved discharge.
// This is not a discharge to add on top of the background — it IS the
// background's own amplitude envelope, so it is modelled as a `gate`
// multiplier on the ongoing background + rhythm rather than an additive
// source (see `registry.ts`). `next()` therefore always returns 0, and the
// `spec` geometry exists only to satisfy the descriptor contract; it is never
// used since nothing is added at any electrode.
//
// The generator keeps its own seeded clock (there is no `TransientSource` to
// lean on here, since what varies sample to sample is a multiplier, not an
// additive waveform) that alternates: near-flat suppression (0.04x) between
// bursts, and a burst envelope — 1.5x amplitude at its peak, Gaussian-shaped
// around the burst's midpoint — for a randomly drawn 0.5-2 s, recurring every
// 3-6 s.
// ---------------------------------------------------------------------------
const burstSuppression: PatternSourceDescriptor = {
  id: 'burst-suppression',
  toggles: ['burst-suppression'],
  spec: sourceUnder('burst-suppression', ['Cz'], { extent: 0.7 }), // unused: next() never emits
  make(seed) {
    const g = new Gaussian(seed);
    // Legacy nextEventTime(key, t, 3, 6) -> periodic(period=4.5, jitterFrac=1/3).
    const drawInterval = () => jit(g, 4.5, 1 / 3);

    let clock = 0;
    /** Absolute time of the next scheduled burst onset; -1 until first scheduled. */
    let nextCycle = -1;
    /** Onset time of the burst currently playing out, or -1 while suppressed. */
    let cycleOnset = -1;
    let burstDur = 0;

    return {
      next: () => 0,
      // The engine only calls `gate()` while this descriptor is enabled (see
      // registry.ts), so the clock only ever advances while the toggle is on —
      // toggling off simply freezes the cycle rather than needing an explicit
      // reset; toggling back on resumes it exactly where it paused.
      gate: (ctx) => {
        clock += ctx.dt;
        if (nextCycle < 0) nextCycle = clock + drawInterval();
        if (cycleOnset < 0 && clock >= nextCycle) {
          cycleOnset = clock;
          burstDur = jit(g, 1.25, 0.6); // 0.5-2.0 s burst duration
        }
        if (cycleOnset >= 0) {
          const bt = clock - cycleOnset;
          if (bt >= burstDur) {
            cycleOnset = -1;
            nextCycle = clock + drawInterval();
            return 0.04;
          }
          return 1.0 + 1.5 * gaussian(bt, burstDur / 2, burstDur / 4);
        }
        return 0.04; // between bursts: near-flat suppression
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Hypsarrhythmia — the interictal hallmark of West syndrome (infantile
// spasms): chaotic, very-high-amplitude activity with NO organised background
// rhythm, built from randomly-shifting, multifocal spikes and sharp/slow
// waves riding disorganised, desynchronised diffuse delta. Two facts make
// this a multi-source pattern rather than one: (1) "no organised background"
// means there is no single shared rhythm to phase-lock — three regional delta
// generators run at independent frequency offsets so no two scalp regions are
// ever in phase, and (2) "multifocal" spikes means the discharge site itself
// wanders — several independent spike generators at scattered electrodes,
// each firing on its own schedule, so spikes appear chaotically at shifting
// locations rather than synchronised everywhere at once. Every descriptor
// below shares the one 'hypsarrhythmia' toggle so they turn on/off together.
//
// Amplitude. learningeeg (Pediatric): "extremely high amplitude", shown at 50 and
// 70 uV/mm because "on the usual reading sensitivity of 7 uV/mm, all the activity
// here would be so high amplitude as to be unreadable". The legacy amplitudes
// (delta 120-150 uV, spikes 150-300 uV) drew rows of 215-270 uV peak to peak — on
// the 200 uV floor of the definition (PMC7023485: ">200 microvolts") and still
// readable at 7 uV/mm. They are scaled by 1.6 here.
//
// Background. "No organised background" has to include the posterior alpha rhythm
// the awake state otherwise keeps drawing underneath, so the frontal delta source
// also gates alpha and mu down, as generalised slowing does.
// ---------------------------------------------------------------------------

// -- (a) Desynchronised diffuse delta, one broad generator per scalp region.
// Each is a pure function of absolute time (like the legacy `delta1/2/3`), so
// no RNG or per-sample state is needed — the three stay mutually out of phase
// purely because their tone sets are shifted/scaled differently, which is
// itself the "disorganised" signature.
type HypsDeltaRegion = { id: string; electrodes: string[]; amp: number; freqOffset: number; freqScale: number };

const HYPS_DELTA_REGIONS: HypsDeltaRegion[] = [
  { id: 'hyps-delta-frontal', electrodes: ['Fz', 'Fp1', 'Fp2'], amp: 240, freqOffset: 0, freqScale: 1 },
  { id: 'hyps-delta-posterior', electrodes: ['O1', 'O2', 'P3', 'P4'], amp: 240, freqOffset: 0.2, freqScale: 1.1 },
  { id: 'hyps-delta-central', electrodes: ['Cz', 'T3', 'T4'], amp: 190, freqOffset: -0.15, freqScale: 0.95 },
];

const hypsDeltaSources: PatternSourceDescriptor[] = HYPS_DELTA_REGIONS.map((r): PatternSourceDescriptor => ({
  id: r.id,
  toggles: ['hypsarrhythmia'],
  spec: sourceUnder(r.id, r.electrodes, { extent: 0.55 }),
  make() {
    return {
      next: (ctx) => ctx.enabled
        ? r.amp * multiToneSignal(ctx.t, DELTA_TONES, DELTA_TONE_NORM, r.freqOffset, r.freqScale)
        : 0,
      // Carried by one source only, so it applies once.
      ...(r.id === 'hyps-delta-frontal' ? { bandGate: () => ({ alpha: 0.15, mu: 0.15 }) } : {}),
    };
  },
}));

// -- (b) Multifocal spikes: independent generators at scattered electrodes,
// each an ordinary spike + slow wave firing on its own seeded schedule, with
// its own seeded amplitude drawn fresh each time (240-480 uV: the legacy 150-300
// scaled with the delta above) — independence across sites is what produces the
// shifting, chaotic, asynchronous appearance.
type HypsSpikeEvent = { amp: number };

const HYPS_SPIKE_ELECTRODES = ['F3', 'F4', 'T3', 'T4', 'O1', 'Cz'];

const hypsSpikeSources: PatternSourceDescriptor[] = HYPS_SPIKE_ELECTRODES.map((el): PatternSourceDescriptor => {
  const id = `hyps-spike-${el.toLowerCase()}`;
  return {
    id,
    toggles: ['hypsarrhythmia'],
    spec: sourceUnder(id, [el], { extent: 0.3 }),
    make(seed, dt) {
      const ts = new TransientSource<HypsSpikeEvent>(seed, dt, {
        schedule: { kind: 'periodic', period: 2.35, jitterFrac: 0.489 }, // legacy nextEventTime(1.2, 3.5)
        duration: 0.95,
        onset: (g) => ({ amp: g.range(240, 480) }),
        morphology: (t, e) => spikeSlowWave(t, e.amp, e.amp * 0.5),
      });
      return asGenerator(ts);
    },
  };
});

export const EPILEPTIFORM_SOURCES: PatternSourceDescriptor[] = [
  ...focalSpikesLt,
  ...focalSpikesRt,
  ...focalSpikesLf,
  iedSpike,
  iedSpikeWave,
  iedSharp,
  iedSharpWave,
  gsw3hz,
  polyspikeWave,
  burstSuppression,
  ...hypsDeltaSources,
  ...hypsSpikeSources,
];

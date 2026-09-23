/**
 * Artifact pattern sources that need their own generator rather than an existing
 * engine artifact generator — currently only chewing, which the engine's artifact
 * layer has no source for.
 *
 * Blink, lateral eye movement, muscle, electrode pop, sweat, and 50 Hz mains are
 * NOT here: they are produced by the engine's always-on artifact generators
 * (`artifacts.ts`) and gated via `EegEngine.setArtifactGates()` in the adapter.
 *
 * ─── Chewing artifact ───────────────────────────────────────────────────────
 *
 * What it is. Each chew is a jaw closure, and closing the jaw is a forceful
 * contraction of the jaw-closing muscles (temporalis, masseter). What reaches the
 * scalp is that muscle's EMG: learningeeg (Artifacts, "Chewing and glossokinetic
 * artifact") describes chewing as sudden, intermittent bursts of VERY FAST
 * activity, told from generalized paroxysmal fast activity by being faster and
 * larger. So on the page it is a burst of muscle fuzz, one per chew, repeating at
 * the chewing rate, and nothing between bursts.
 *
 * What it is not. It is not a large smooth slow wave. The slow, synchronous delta
 * seen alongside chewing is a separate artifact — tongue movement (glossokinetic),
 * which learningeeg lists on its own and which often, but not always, accompanies
 * chewing. It has no toggle here, so no slow component is drawn.
 * (Replaced 2026-09-22: the previous model, ported from the legacy
 * `artifactVoltage`, drew each chew as a 300 uV, ~100 ms Gaussian bump — a delta/
 * theta wave — with uniform white noise on top, and scheduled the two sides
 * independently. The bump dominated the picture, which taught the wrong thing.)
 *
 * How it is modelled:
 *  - Content: the same MUAP shot-noise EMG the Muscle toggle uses (`EmgGenerator`:
 *    spiky, heavy-tailed, ~20-100 Hz on this display), so chewing and tonic muscle
 *    look like the same kind of signal, which they are.
 *  - Geometry: the temporalis artifact sources (`ARTIFACT_SOURCES.temporalisL/R`),
 *    outside the skull under T3/T4 and reaching F7/F8 — the same field as the
 *    Muscle toggle's jaw region.
 *  - Timing: both sides share ONE chew schedule (both jaw closers contract on the
 *    same chew), each with its own motor-unit noise. Chews come at 1.5/s +/-20% in
 *    runs of 3-5, with 6-14 s pauses between runs (kept from the previous model).
 *    Each burst lasts 0.2-0.35 s under a raised-sine envelope; the jaw is open and
 *    the muscle quiet for the rest of the cycle.
 *  - The first run starts FIRST_RUN_LEAD_SEC after the toggle goes on, not after a
 *    whole 6-14 s pause, so the toggle is not dead for up to 14 s.
 */

import { ARTIFACT_SOURCES, EmgGenerator, OCULAR_FIRST_EVENT_LEAD_SEC } from '../artifacts';
import { Gaussian, deriveSeed } from '../rng';
import type { PatternSourceDescriptor, PatternGenerator } from './registry';

const EPISODE_PERIOD = 10;
const EPISODE_JITTER_FRAC = 0.4;     // pauses of 10 s x [0.6, 1.4] = 6-14 s
const CHEW_RATE_BASE = 1.5;           // chews per second
const CHEW_RATE_JITTER = 0.2;
const BURST_SEC: [number, number] = [0.2, 0.35];
const FIRST_RUN_LEAD_SEC = OCULAR_FIRST_EVENT_LEAD_SEC;

/**
 * EMG RMS inside a burst at the peak (temporal) electrode, microvolts. NOT from a
 * citable source: no calibrated chewing amplitude was found. It is set against the
 * Muscle toggle's own jaw EMG (9 uV RMS at default severity, engine.ts) so that a
 * chew — a forceful contraction — is several times tonic tension, which is how
 * learningeeg's figure shows it relative to the background ("larger" than GPFA).
 * Treat as a number to test against a reference, not a constraint.
 */
const CHEW_EMG_RMS_UV = 35;

/**
 * The shared chew schedule. Deterministic from the subject seed and the sample
 * count, so the left and right generators — separate objects — compute the same
 * envelope sample for sample without talking to each other.
 */
function makeChewEnvelope(subjectSeed: number, dt: number) {
  const g = new Gaussian(deriveSeed(subjectSeed, 'chew-schedule'));
  const jit = (base: number, frac: number) => base * (1 + (g.uniform() - 0.5) * 2 * frac);
  let clock = 0;
  let nextEpisode = -1;
  let episodeStart = -1;
  let chews: { at: number; len: number; amp: number }[] = [];
  let episodeEnd = 0;

  return (enabled: boolean): number => {
    clock += dt;
    if (!enabled) { episodeStart = -1; nextEpisode = -1; return 0; }
    if (nextEpisode < 0) nextEpisode = clock + FIRST_RUN_LEAD_SEC;
    if (episodeStart < 0 && clock >= nextEpisode) {
      episodeStart = clock;
      const count = 3 + Math.floor(g.uniform() * 3);
      const period = 1 / jit(CHEW_RATE_BASE, CHEW_RATE_JITTER);
      chews = [];
      for (let i = 0; i < count; i++) {
        chews.push({
          at: i * period,
          len: BURST_SEC[0] + g.uniform() * (BURST_SEC[1] - BURST_SEC[0]),
          amp: g.logNormal(1, 0.2),
        });
      }
      episodeEnd = count * period;
    }
    if (episodeStart < 0) return 0;
    const u = clock - episodeStart;
    if (u >= episodeEnd) {
      episodeStart = -1;
      nextEpisode = clock + jit(EPISODE_PERIOD, EPISODE_JITTER_FRAC);
      return 0;
    }
    for (const c of chews) {
      const x = (u - c.at) / c.len;
      if (x >= 0 && x < 1) return c.amp * Math.sin(Math.PI * x);
    }
    return 0;
  };
}

function makeChewSide(seed: number, dt: number, subjectSeed: number): PatternGenerator {
  const envelope = makeChewEnvelope(subjectSeed, dt);
  const emg = new EmgGenerator(seed, dt);   // this side's own motor units
  return {
    next(ctx) {
      const env = envelope(ctx.enabled);
      const fuzz = emg.next();               // advance every sample: no stale noise on resume
      return env > 0 ? CHEW_EMG_RMS_UV * env * fuzz : 0;
    },
  };
}

const chewLeft: PatternSourceDescriptor = {
  id: 'chewL',
  toggles: ['chewing'],
  spec: { ...ARTIFACT_SOURCES.temporalisL, id: 'chewL' },
  make: (seed, dt, subjectSeed) => makeChewSide(seed, dt, subjectSeed),
};

const chewRight: PatternSourceDescriptor = {
  id: 'chewR',
  toggles: ['chewing'],
  spec: { ...ARTIFACT_SOURCES.temporalisR, id: 'chewR' },
  make: (seed, dt, subjectSeed) => makeChewSide(seed, dt, subjectSeed),
};

export const ARTIFACT_PATTERN_SOURCES: PatternSourceDescriptor[] = [chewLeft, chewRight];

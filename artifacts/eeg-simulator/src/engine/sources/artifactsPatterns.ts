/**
 * Artifact pattern sources that need their own generator rather than an existing
 * engine artifact generator — currently only chewing (masseter EMG bursts), which
 * the engine's artifact layer has no source for.
 *
 * Blink, lateral eye movement, muscle, electrode pop, sweat, and 50 Hz mains are
 * NOT here: they are produced by the engine's always-on artifact generators
 * (`artifacts.ts`) and gated via `EegEngine.setArtifactGates()` in the adapter.
 *
 * ─── Chewing (masseter) artifact ────────────────────────────────────────────
 *
 * Mastication contracts the masseter/temporalis muscles, which sit directly
 * under the T3/T4 electrodes — chewing artifact is therefore a bilateral
 * temporal phenomenon, not a generalised one. Two things make it recognisable
 * on a real trace, and both are modelled here, ported verbatim (amplitudes,
 * timings) from the legacy `artifactVoltage`'s `chewing` block:
 *
 *  1. Episodic structure. Real chewing happens in bursts of mastication — a
 *     run of 3-5 chews at ~1.5 Hz — separated by pauses of several seconds
 *     (talking, swallowing, or just not chewing). It is never an endless
 *     metronome. Each episode draws its own chew count, chew rate, and a seed
 *     for per-chew amplitude variation.
 *  2. Per-chew shape. Each chew is a large, brief masseter contraction burst
 *     (a ~100 ms Gaussian bump peaking at 300 uV, scaled by the chew's own
 *     amplitude factor) with high-frequency EMG "fuzz" riding on top of it —
 *     the interference pattern of the contracting muscle fibres, which is
 *     what gives chewing artifact its characteristic ragged look rather than
 *     a clean smooth bump.
 *
 * The two sides (T3, T4) are independently scheduled and seeded: real chewing
 * is roughly bilateral but the two masseters are not phase-locked, so the left
 * and right bursts drift in and out of alignment exactly as they do clinically.
 *
 * Because the per-sample EMG fuzz needs fresh noise every sample (not just at
 * event onset), this is NOT built on `TransientSource` — that primitive's
 * `morphology` is a pure function of (dt, event) with no per-sample draw. A
 * small hand-rolled `PatternGenerator` reproduces the same episode/chew
 * scheduling directly and draws a seeded Gaussian sample for the EMG term.
 */

import { sourceUnder } from '../forward';
import { Gaussian } from '../rng';
import { gaussian, hashUnit } from './morphology';
import type { PatternSourceDescriptor, PatternGenerator } from './registry';

/** Per-event multiplicative jitter, matching the legacy `jitter(base, frac)`. */
const jit = (g: Gaussian, base: number, frac: number): number =>
  base * (1 + (g.uniform() - 0.5) * 2 * frac);

// Episode timing: legacy `nextEventTime('chew-episode', t, 6, 14)` — a pause of
// 6-14 s between episodes. A periodic schedule of period 10 with 40% jitter
// covers exactly that range ([10*(1-0.4), 10*(1+0.4)] = [6, 14]).
const EPISODE_PERIOD = 10;
const EPISODE_JITTER_FRAC = 0.4;

// Per-chew timing: legacy chews at ~1.5 Hz, jittered +/-20%, in runs of 3-5.
const CHEW_RATE_BASE = 1.5;
const CHEW_RATE_JITTER = 0.2;

/** One masseter side's episodic chewing generator (option (a): hand-rolled, not TransientSource). */
function makeChewSide(seed: number, dt: number): PatternGenerator {
  const gSched = new Gaussian(seed);
  // A second, independently-seeded stream for the per-sample EMG fuzz, so
  // drawing it every sample doesn't perturb the episode-scheduling stream's
  // sequence (and therefore doesn't perturb episode timing reproducibility).
  const gEmg = new Gaussian(seed ^ 0x9e3779b9);

  let clock = 0;
  let nextEpisode = -1;
  // Parameters of the episode currently playing, or -1 while idle.
  let episodeStart = -1;
  let count = 0;
  let rate = CHEW_RATE_BASE;
  let episodeSeed = 0;

  const drawEpisodeGap = () =>
    EPISODE_PERIOD * (1 + (gSched.uniform() - 0.5) * 2 * EPISODE_JITTER_FRAC);

  return {
    next(ctx) {
      if (!ctx.enabled) {
        // Clear scheduling so re-enabling starts a fresh episode soon, matching
        // the transient-source convention elsewhere in this family.
        episodeStart = -1;
        nextEpisode = -1;
        clock += dt;
        return 0;
      }

      clock += dt;

      if (nextEpisode < 0) {
        nextEpisode = clock + drawEpisodeGap();
      }

      if (episodeStart < 0 && clock >= nextEpisode) {
        episodeStart = clock;
        count = 3 + Math.floor(gSched.uniform() * 3); // 3-5 chews
        rate = jit(gSched, CHEW_RATE_BASE, CHEW_RATE_JITTER);
        episodeSeed = Math.floor(gSched.uniform() * 1000);
      }

      if (episodeStart < 0) return 0;

      const epDt = clock - episodeStart;
      const period = 1 / rate;
      if (epDt >= count * period) {
        episodeStart = -1;
        nextEpisode = clock + drawEpisodeGap();
        return 0;
      }

      const idx = Math.floor(epDt / period);
      const chewDt = epDt - idx * period;
      const amp = 0.8 + 0.5 * hashUnit(episodeSeed + idx);

      if (chewDt < 0.25) {
        const burst = 300 * amp * gaussian(chewDt, 0.1, 0.05);
        // Masseter EMG interference riding the burst — fresh seeded noise every
        // sample (the legacy `Math.random() - 0.5` term, now reproducible).
        const emg = 50 * amp * (gEmg.uniform() - 0.5);
        return burst + emg;
      }
      return 0;
    },
  };
}

const chewLeft: PatternSourceDescriptor = {
  id: 'chewL',
  toggles: ['chewing'],
  spec: sourceUnder('chewL', ['T3'], { extent: 0.35 }),
  make: (seed, dt) => makeChewSide(seed, dt),
};

const chewRight: PatternSourceDescriptor = {
  id: 'chewR',
  toggles: ['chewing'],
  spec: sourceUnder('chewR', ['T4'], { extent: 0.35 }),
  make: (seed, dt) => makeChewSide(seed, dt),
};

export const ARTIFACT_PATTERN_SOURCES: PatternSourceDescriptor[] = [chewLeft, chewRight];

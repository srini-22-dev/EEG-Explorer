/**
 * Morphology library: the pure waveform math and oscillatory tone sets shared by
 * every geometric pattern source.
 *
 * These functions are stateless by construction — a waveform value is a pure
 * function of time-since-event (or absolute time), with no hidden envelope state
 * and no `Math.random()`. All stochastic behaviour (event scheduling, per-event
 * amplitude variation) lives in the seeded generators that consume these shapes
 * (`transient.ts` and the family source files), so a given seed reproduces a
 * given recording exactly.
 *
 * Numeric values here are clinical ground truth carried over verbatim from the
 * legacy generator; do not "clean them up". The comments on each tone set explain
 * why a frequency or amplitude is what it is — that reasoning is the point.
 */

export type Tone = { f: number; a: number };

// ─── Tone Sets (Oscillatory Carriers) ────────────────────────────────────────

export const THETA_TONES: Tone[] = [
  { f: 4.3, a: 1.0 }, { f: 5.1, a: 0.8 }, { f: 5.9, a: 0.9 },
  { f: 6.5, a: 0.6 }, { f: 7.2, a: 0.7 },
];
export const DELTA_TONES: Tone[] = [
  { f: 0.8, a: 1.0 }, { f: 1.3, a: 0.9 }, { f: 1.7, a: 0.8 }, { f: 2.1, a: 0.7 },
];
export const BETA_TONES: Tone[] = [
  { f: 14.2, a: 1.0 }, { f: 16.8, a: 0.9 }, { f: 19.4, a: 0.8 }, { f: 23.1, a: 0.7 },
];
export const MU_TONES: Tone[] = [
  { f: 9.2, a: 0.9 }, { f: 10.1, a: 1.0 }, { f: 11.1, a: 0.8 },
];
// RMTD's defining diagnostic feature is that it is *monomorphic* — a near-constant
// frequency, unlike the polymorphic spread of ordinary background theta. Its tones
// are therefore deliberately clustered tightly around 6 Hz rather than spanning the
// whole theta band the way THETA_TONES does.
export const RMTD_TONES: Tone[] = [
  { f: 5.7, a: 1.0 }, { f: 6.0, a: 0.45 }, { f: 6.3, a: 0.3 },
];
// Posterior slow waves of youth are a 2.5-4.5 Hz phenomenon — above the delta band.
// Borrowing DELTA_TONES (0.8-2.1 Hz) rendered them at roughly half their true
// frequency, which would teach a learner to call genuine delta "normal for age".
export const PSWY_TONES: Tone[] = [
  { f: 2.7, a: 1.0 }, { f: 3.2, a: 0.9 }, { f: 3.8, a: 0.8 }, { f: 4.3, a: 0.6 },
];
// 14 & 6 positive bursts carry two independent arciform components.
export const POS14_TONES: Tone[] = [
  { f: 13.3, a: 0.8 }, { f: 14.1, a: 1.0 }, { f: 14.9, a: 0.7 },
];
export const POS6_TONES: Tone[] = [
  { f: 5.7, a: 0.8 }, { f: 6.2, a: 1.0 }, { f: 6.7, a: 0.7 },
];

// Per-tone-set normalisers so a unit-amplitude multiToneSignal peaks near ±1.
export const THETA_TONE_NORM = 2.2;
export const DELTA_TONE_NORM = 2.0;
export const BETA_TONE_NORM = 2.0;
export const MU_TONE_NORM = 1.7;
export const RMTD_TONE_NORM = 1.3;
export const POS_BURST_TONE_NORM = 1.6;
export const PSWY_TONE_NORM = 1.9;

// Amplitude-weighted centre frequencies of the tone sets used by frequency sweeps.
export const THETA_TONE_CENTER = 5.7;
export const BETA_TONE_CENTER = 17.9;

// ─── Oscillatory carriers ────────────────────────────────────────────────────

export function multiToneSignal(
  t: number, tones: Tone[], norm: number, freqOffset = 0, freqScale = 1,
): number {
  let s = 0;
  for (const { f, a } of tones) {
    s += a * Math.sin(2 * Math.PI * (f + freqOffset) * freqScale * t);
  }
  return s / norm;
}

// Mu, wicket spikes, and 14 & 6 positive bursts are all "arciform" (arch- or
// comb-shaped): one side of each cycle is sharp and pointed, the other rounded.
// The obvious way to draw that — Math.abs() of a sine — is wrong twice over.
// Rectifying a sine turns every half-cycle into its own hump, so a 10 Hz mu
// carrier renders as a 20 Hz train; and because the result never goes negative,
// the rhythm sits off-baseline on a DC offset instead of oscillating about it.
//
// A fundamental and its second harmonic IN COSINE PHASE give the arch: their
// peaks coincide on one side (1 + 0.35, pointed) and oppose on the other (-1 +
// 0.35, a broad rounded trough), at the stated frequency and with zero mean.
// Until 2026-10-13 the two were summed in sine phase, which is a different
// shape — a tilted wave, fast up and slow down, equally sharp top and bottom —
// so nothing built on this was an arch. The spectrum is the same either way;
// only the relative phase of the harmonic differs.
//
// `sharp` says which side is the pointed one: -1 surface-negative (mu and
// wickets: IFCN glossary, "arch-shaped waves", "spike-like monophasic surface
// negative ... waves"), +1 surface-positive (the 14 & 6 positive bursts, named
// for it). The phase offset starts every tone at a zero crossing, so a burst
// built on this begins without a step.
const ARCH_ZERO_PHASE = Math.acos((-1 + Math.sqrt(1.98)) / 1.4);
export function arciformSignal(
  t: number, tones: Tone[], norm: number, freqOffset = 0, sharp: 1 | -1 = -1,
): number {
  let s = 0;
  for (const { f, a } of tones) {
    const th = 2 * Math.PI * (f + freqOffset) * t + ARCH_ZERO_PHASE;
    s += a * (Math.cos(th) + 0.35 * Math.cos(2 * th));
  }
  return sharp * s / norm;
}

// Evolving frequency is the single most important feature of an ictal rhythm, and
// it has to be produced by integrating frequency into phase. Writing
// sin(2π·f(t)·t) with a time-varying f yields an instantaneous frequency of
// f + t·df/dt, so the error grows without bound as the seizure runs. This returns
// a phase, in "equivalent seconds" of a carrier whose nominal centre is fRef, so
// an existing tone set evaluated at this warped time has every tone scale together.
export function sweepPhase(tau: number, f0: number, f1: number, T: number, fRef: number): number {
  return (f0 * tau + (f1 - f0) * tau * tau / (2 * T)) / fRef;
}

// ─── Morphological helpers ───────────────────────────────────────────────────

export function gaussian(x: number, mu: number, sigma: number): number {
  return Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));
}

// Every generator in this app returns a TRUE SCALP POTENTIAL: positive means
// surface-positive, and the canvas renders it negative-up (see EEGCanvas). An
// epileptiform spike is surface-NEGATIVE — that is what makes it phase-reverse
// the way readers are taught to look for — and the slow wave that follows it has
// the SAME polarity: on a referential montage both point up.
//   IFCN glossary (Kane et al. 2017), "Sharp wave": the main component "is
//   generally negative relative to other areas, and may be followed by slow wave
//   of the same polarity".
//   learningeeg, Montages: "this upward going spike and wave at F3 is a negative
//   F3 maximal discharge".
// Until 2026-10-13 the slow wave here was surface-POSITIVE, and IK-012 asserted
// it: the complex drew as a spike up and a long sag down. The signs had been
// flipped once before, as a whole, when the canvas's inverted convention was
// fixed — which kept the two lobes opposed, the one thing wrong with them.
//
// Timing, from learningeeg's own example (Epileptiform, "The same spike with its
// after-going slow wave highlighted"). Its box around spike and wave together is
// 0.345 s wide against the figure's 1 s grid (110 px at 319 px/s), margins
// included. Inside it the slow wave follows the spike at once; where it peaks was
// read twice and the readings differ — 0.09 s after the spike by eye against the
// 0.2 s grid, 0.16 s by tracing the F8-T4 row pixel by pixel — so it is put at
// 0.12 s, with a 0.24 s base, and spike and wave together run 0.27 s. That is one
// figure of one discharge, not a rule: the IFCN glossary asks only that a slow
// wave be longer than 1/8 s. The slow wave here used to peak 0.40 s after the
// spike and last 0.7 s, with no source for either. The spike itself was 94 ms at
// its base, which IK-012 calls a sharp wave; it is now 60 ms. The slow:spike
// ratio the callers pass is unchanged (learningeeg: the slow wave "may be higher
// amplitude than the preceding sharp or spike").
const SLOW_WAVE_SIGMA = 0.055; // a 0.24 s base at 10% of its peak
const SLOW_WAVE_LAG = 0.12;    // its peak, after the spike's
export function spikeSlowWave(dt: number, ampSpike: number, ampSlow: number): number {
  if (dt < 0 || dt > 0.9) return 0;
  const spike = -ampSpike * gaussian(dt, 0.04, 0.014);
  const slow = -ampSlow * gaussian(dt, 0.04 + SLOW_WAVE_LAG, SLOW_WAVE_SIGMA);
  return spike + slow;
}

// A single pointed epileptiform transient of configurable base width, optionally
// carrying the obligatory after-going slow wave that turns it into a complex.
// The two axes a reader is taught to separate are encoded directly:
//   - DURATION distinguishes a spike from a sharp wave. Base width at 10% of the
//     peak for a Gaussian is 4.29*sigma, so sigmaSharp 0.007 s gives a ~30 ms
//     spike (clinical 20-70 ms) and 0.025 s a ~107 ms sharp wave (70-200 ms).
//   - The AFTER-GOING SLOW WAVE is what adds "-and-slow-wave": ampSlow > 0 adds
//     the slow wave, surface-negative like the transient it follows and 0.24 s
//     long, peaking 0.12 s after a spike and a little later (0.16 s) after a
//     sharp wave, whose own second half it would otherwise sit under (see
//     spikeSlowWave for the source); ampSlow = 0 leaves a bare spike or sharp
//     wave with no slow wave.
// Same polarity convention as spikeSlowWave above, for the same reason.
export function epileptiformTransient(
  dt: number, ampSharp: number, sigmaSharp: number, ampSlow: number,
): number {
  if (dt < 0 || dt > 0.9) return 0;
  const sharp = -ampSharp * gaussian(dt, 0.06, sigmaSharp);
  // 0.007 s is the spike the lag was read for; a broader transient pushes the wave
  // back by the half-width it adds.
  const slowAt = 0.06 + SLOW_WAVE_LAG + 2.15 * (sigmaSharp - 0.007);
  const slow = ampSlow > 0 ? -ampSlow * gaussian(dt, slowAt, SLOW_WAVE_SIGMA) : 0;
  return sharp + slow;
}

// spikeSlowWave() is one isolated discharge of a fixed length. A rhythmic run
// needs the complex to fill its cycle exactly, whatever the rate: one ~333 ms
// cycle at 3 Hz, twice that at 1.5 Hz. Scaling the morphology to the cycle
// length keeps the correct shape at whatever frequency the burst is currently
// running.
//
// One cycle is a positive trough, the spike rising out of it, and then the
// negative slow wave (the "dome") 110 ms after the spike — spike and wave both
// up, as in spikeSlowWave. The slow wave is one full sine per cycle rather than
// a one-sided bump, for two reasons. A run of one-sided complexes has a large
// mean (over half the spike's height once both lobes are negative), which the
// amplifier's low-frequency filter turns into a sag at onset and a slow swing
// back after offset — and an absence has to end with nothing after it (IK-017).
// And a recorded spike-wave run is AC-coupled: it swings about the baseline,
// troughs below it and domes above. The sine is zero at both ends of the cycle,
// so a run starts, ends and changes rate without a step.
//
// `ampSpike` and `ampSlow` keep the meaning the callers fitted them with: the
// complex's peak-to-peak is their sum, as it was when the two lobes opposed each
// other. Riding on the trough, the spike no longer adds its whole height to the
// swing, so the raw shape comes out 0.81 of that for the 0.6-0.7 slow:spike
// ratios in use, and SPIKE_WAVE_GAIN puts it back.
const SPIKE_WAVE_GAIN = 1.23;
export function rhythmicSpikeWave(dt: number, cycleLen: number, ampSpike: number, ampSlow: number): number {
  if (dt < 0 || dt > cycleLen) return 0;
  const k = cycleLen / 0.333;
  const spike = -ampSpike * gaussian(dt, 0.140 * k, 0.020 * k);
  const slow = ampSlow * Math.sin(2 * Math.PI * dt / cycleLen);
  return SPIKE_WAVE_GAIN * (spike + slow);
}

export function triphasicWave(dt: number, amp: number): number {
  if (dt < 0 || dt > 0.7) return 0;
  const p1 = -amp * 0.25 * gaussian(dt, 0.06, 0.025);
  const p2 = amp * 1.00 * gaussian(dt, 0.22, 0.06);
  const p3 = -amp * 0.50 * gaussian(dt, 0.48, 0.09);
  return p1 + p2 + p3;
}

// Deterministic pseudo-random in [0,1) keyed off an integer. Lets repeated events
// inside a single burst (individual polyspikes) differ from one another without
// re-rolling a noise stream on every sample — which would turn a smooth waveform
// into noise rather than varying the event's amplitude.
export function hashUnit(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

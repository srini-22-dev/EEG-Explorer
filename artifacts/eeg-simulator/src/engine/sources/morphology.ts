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
export const SPINDLE_TONES: Tone[] = [
  { f: 12.3, a: 0.8 }, { f: 13.5, a: 1.0 }, { f: 14.8, a: 0.7 },
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
export const ALPHA_TONES: Tone[] = [
  { f: 8.4, a: 0.5 }, { f: 9.1, a: 0.8 }, { f: 9.7, a: 1.0 },
  { f: 10.3, a: 0.9 }, { f: 10.9, a: 0.6 }, { f: 8.8, a: 0.35 },
  { f: 11.3, a: 0.3 },
];

// Per-tone-set normalisers so a unit-amplitude multiToneSignal peaks near ±1.
export const ALPHA_TONE_NORM = 2.4;
export const THETA_TONE_NORM = 2.2;
export const DELTA_TONE_NORM = 2.0;
export const BETA_TONE_NORM = 2.0;
export const SPINDLE_TONE_NORM = 1.6;
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
// comb-shaped): one phase of each cycle is sharp and pointed, the other rounded.
// The obvious way to draw that — Math.abs() of a sine — is wrong twice over.
// Rectifying a sine turns every half-cycle into its own hump, so a 10 Hz mu
// carrier renders as a 20 Hz train; and because the result never goes negative,
// the rhythm sits off-baseline on a DC offset instead of oscillating about it.
// Summing a second harmonic onto the fundamental gives the genuine asymmetry
// (sharp one way, rounded the other) while preserving both the stated frequency
// and a zero mean.
export function arciformSignal(t: number, tones: Tone[], norm: number, freqOffset = 0): number {
  const fundamental = multiToneSignal(t, tones, norm, freqOffset, 1);
  const harmonic = multiToneSignal(t, tones, norm, freqOffset, 2);
  return fundamental + 0.35 * harmonic;
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

export function spikeSlowWave(dt: number, ampSpike: number, ampSlow: number): number {
  if (dt < 0 || dt > 0.9) return 0;
  const spike = ampSpike * gaussian(dt, 0.05, 0.022);
  const slow = -ampSlow * gaussian(dt, 0.45, 0.16);
  return spike + slow;
}

// spikeSlowWave() places its slow-wave trough at 450 ms and runs for 900 ms, which
// is right for an isolated interictal discharge but far too slow for a rhythmic
// run: at 3 Hz the whole spike + slow-wave complex has to fit inside one ~333 ms
// cycle. Scaling the morphology to the cycle length keeps the correct shape at
// whatever frequency the burst is currently running.
export function rhythmicSpikeWave(dt: number, cycleLen: number, ampSpike: number, ampSlow: number): number {
  if (dt < 0 || dt > cycleLen) return 0;
  const k = cycleLen / 0.333;
  const spike = ampSpike * gaussian(dt, 0.055 * k, 0.020 * k);
  const slow = -ampSlow * gaussian(dt, 0.190 * k, 0.075 * k);
  return spike + slow;
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

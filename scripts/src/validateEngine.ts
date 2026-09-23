/**
 * Validation battery for the EEG engine (briefing §11).
 *
 * Run: pnpm --filter @workspace/scripts run validate
 *
 * Grows one section per §14 build step. The rule from §11 that shapes this file:
 * never validate using the statistic you fitted. The aperiodic exponent is set as
 * a target in the time domain (a weighted sum of OU relaxation times) and checked
 * in the frequency domain by an independent specparam-style spectral fit, so
 * agreement is evidence rather than tautology.
 */

import { AperiodicSource } from '../../artifacts/eeg-simulator/src/engine/aperiodic';
import { HopfOscillator, MU_WARP, NO_WARP } from '../../artifacts/eeg-simulator/src/engine/oscillator';
import {
  EegEngine, sampleSubject, BETA_BURST_OPTS, PDR_ENVELOPE_DEPTH,
  type EngineOptions, type ArtifactGates,
} from '../../artifacts/eeg-simulator/src/engine/engine';
import { BurstyOscillator } from '../../artifacts/eeg-simulator/src/engine/bursts';
import { AmplifierLowPass } from '../../artifacts/eeg-simulator/src/engine/chain';
import { traceY, ecgScale } from '../../artifacts/eeg-simulator/src/utils/displayGeometry';
import {
  electrodeDistanceCm, sourceUnder, buildLeadfield,
  HEAD_CENTRE, CORTICAL_SHELL, type SourceSpec, type Vec3,
} from '../../artifacts/eeg-simulator/src/engine/forward';
import { electrodePositions3D } from '../../artifacts/eeg-simulator/src/utils/electrodePositions3D';

/**
 * A cortical-shell source genuinely EQUIDISTANT from two electrodes — the
 * geometry IK-003 case b describes as "midway between two electrodes".
 *
 * `sourceUnder([a, b])` is not that. It averages the two electrode positions and
 * projects the mean radially onto the shell, which lands on the perpendicular
 * bisector only when the head is a sphere and the two electrodes sit at equal
 * radius. On the mesh-derived head they do not: F8 (z 0.53) rides higher than T4
 * (z 0), so the projected mean ends up 8.4% closer to T4 than to F8 and the
 * "isoelectric" link inherits that 8.4% as a spurious deflection. Before the
 * electrodes were corrected against the head mesh the same construction was off by
 * only 1.0%, which is why this went unnoticed.
 *
 * Walk the great circle between the two radial directions and bisect on the
 * distance difference; 40 halvings is far below floating-point resolution.
 */
function midwaySource(id: string, a: string, b: string, extent: number): SourceSpec {
  const pa = electrodePositions3D[a] as Vec3, pb = electrodePositions3D[b] as Vec3;
  const d = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const at = (t: number): Vec3 => {
    const m: Vec3 = [0, 1, 2].map(i =>
      (pa[i] - HEAD_CENTRE[i]) * (1 - t) + (pb[i] - HEAD_CENTRE[i]) * t) as Vec3;
    const n = Math.hypot(m[0], m[1], m[2]);
    return [0, 1, 2].map(i => HEAD_CENTRE[i] + (m[i] / n) * CORTICAL_SHELL) as Vec3;
  };
  // f(0) < 0 (sitting on a's ray, so nearer a); f(1) > 0. Bisect for f = 0.
  let lo = 0, hi = 1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2, p = at(mid);
    if (d(pa, p) - d(pb, p) < 0) lo = mid; else hi = mid;
  }
  return { id, pos: at((lo + hi) / 2), orientation: { kind: 'radial' }, extent };
}
import type { PatientState, ArtifactParams } from '../../artifacts/eeg-simulator/src/utils/simTypes';
import {
  welch, fitAperiodic, std, kurtosis, autocorr, hilbertEnvelope, dfa, spectralPeak, skewness,
} from './dsp';

// Display-space transform (CLAUDE.md §4): the same pipeline EEGCanvas/
// renderTrace.ts use to turn raw electrode voltages into the montage-derived
// channel actually drawn on screen. Everything above this reads raw electrodes
// (referential/spectral space); Step 19 below reads this instead, because a
// pattern can pass every spectral check and still be wrong once a montage and a
// common-average reference are applied to it.
import { SimulationSource } from '../../artifacts/eeg-simulator/src/engine/adapter';
import { MONTAGES, ALL_ELECTRODES } from '../../artifacts/eeg-simulator/src/utils/montages';
import { commonAverage, computeChannelVoltage } from '../../artifacts/eeg-simulator/src/utils/computeChannel';
import { defaultArtifactParams, defaultIctalParamsMap, SPEED_VALUES, type SimSettings } from '../../artifacts/eeg-simulator/src/utils/simTypes';
import type { ChannelDef } from '../../artifacts/eeg-simulator/src/utils/montages';

// A6 audit (Step 21): the pure morphology math for the interictal spike/slow-
// wave complex, reused to build a genuine spike source anchored MIDWAY between
// two electrodes (IK-003 case b) — every other spike source in the app is
// anchored ON an electrode, so no existing toggle demonstrates the midway
// signature and one has to be synthesized the same way Step 16's static
// leadfield-gain precedent already does, just driven as a real time series.
import { spikeSlowWave } from '../../artifacts/eeg-simulator/src/engine/sources/morphology';

// A8 audit (Step 23): renderTrace.ts drives the SAME geometry EEGCanvas.tsx
// does (CLAUDE.md §4) and exposes its actual pxPerSec/pxPerMm/pxPerUV, so the
// calibration checks below assert on real production numbers, not a
// reimplementation of the formulas.
import { renderTrace } from './renderTrace';

// Scratch dir for Step 23's incidental PNG evidence — not asserted on, just left
// on disk for a reviewer to open (audit brief, ACCEPTANCE BAR §3).
const SCRATCH = 'C:/Users/CMC/AppData/Local/Temp/claude/C--Users-CMC-Desktop-EEG-Explorer-dev-EEG-Explorer/430e9c84-cae5-4d2b-a812-86536870ba4c/scratchpad';

const FS = 250;
const DT = 1 / FS;

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let failures = 0;
/** Every check's label and outcome, for the knowledge-base status audit at the end. */
const results: { label: string; ok: boolean }[] = [];

/**
 * Passing checks whose value sits close to a bound. Printed at the end, never failed on. A value
 * parked at its bound is a finding in its own right: either the model is wrong and the bound is what
 * let it through, or the bound is wrong. `blink F7-T3 / Fp1-F7` passed at 0.948 against a 0.95
 * ceiling for weeks — no decay at all down the temporal chain, visible on every blink — because
 * nothing forced anyone to look at it.
 *
 * "Close" is NEAR_BOUND_FRACTION of the bound's own magnitude, capped at that fraction of the range
 * when both ends are real. A bound of 1e5 or more, an infinite one, or one at a physical limit (0, or
 * +-1 for a correlation) is not a bound here: a correlation of -1.000 against -1.0001, or zero EMG
 * against a floor of 0, is the intended value, not a near miss. The first version measured 5% of the
 * whole range, and against open ceilings like 1e6 it listed 120 checks — noise nobody would read.
 */
const NEAR_BOUND_FRACTION = 0.1;
const nearBound: string[] = [];

function check(label: string, actual: number, lo: number, hi: number, unit = '') {
  const ok = actual >= lo && actual <= hi;
  results.push({ label, ok });
  const real = (b: number) => Number.isFinite(b) && Math.abs(b) < 1e5;
  const usable = (b: number) => real(b) && Math.abs(b) > 1e-3 && Math.abs(Math.abs(b) - 1) > 1e-3;
  if (ok && lo !== hi) {
    const both = real(lo) && real(hi);
    const margin = (b: number) => NEAR_BOUND_FRACTION * (both ? Math.min(Math.abs(b), hi - lo) : Math.abs(b));
    const nearLo = usable(lo) && actual - lo <= margin(lo);
    const nearHi = usable(hi) && hi - actual <= margin(hi);
    if (nearLo || nearHi) nearBound.push(`${label}: ${actual.toFixed(3)}${unit} against ${nearLo ? 'floor' : 'ceiling'} ${nearLo ? lo : hi}`);
  }
  if (!ok) failures++;
  const status = ok ? 'ok  ' : 'FAIL';
  console.log(
    `  ${status} ${label.padEnd(38)} ${actual.toFixed(3).padStart(9)}${unit}   want ${lo}..${hi}`
  );
}

function generate(src: AperiodicSource, secs: number): Float64Array {
  const n = Math.floor(secs * FS);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = src.next();
  return out;
}

console.log('\n=== Step 1: aperiodic background ===\n');

// --- 1a. Does the synthesised spectrum actually have the exponent we asked for?
console.log('Spectral exponent recovery (target vs specparam-style fit, 1-45 Hz):');
for (const target of [1.0, 1.4, 1.8, 2.2, 2.6]) {
  const src = new AperiodicSource(12345, DT, { exponent: target, rms: 10 });
  const x = generate(src, 300);
  const psd = welch(x, FS, 4096);
  const fit = fitAperiodic(psd, 1, 45);
  check(`chi = ${target.toFixed(1)}`, fit.exponent, target - 0.2, target + 0.2);
  if (fit.rSquared < 0.97) {
    failures++;
    console.log(`       FAIL power-law fit quality r^2 = ${fit.rSquared.toFixed(4)} (want > 0.97)`);
  }
}

// --- 1b. Amplitude anchor (§2): awake background 10-70 uV p2p, 5-20 uV RMS in band.
console.log('\nAmplitude:');
{
  const src = new AperiodicSource(999, DT, { exponent: 1.4, rms: 9 });
  const x = generate(src, 120);
  check('output RMS matches requested 9 uV', std(x), 8.0, 10.0, ' uV');
  const sorted = Array.from(x).sort((a, b) => a - b);
  const p2p = sorted[Math.floor(0.99 * sorted.length)] - sorted[Math.floor(0.01 * sorted.length)];
  check('p2p (1st-99th pct)', p2p, 10, 70, ' uV');
}

// --- 1c. The background must be Gaussian-ish. Spiky, heavy-tailed background is
// an EMG signature (§8) and must not leak out of the neural aperiodic source.
console.log('\nDistribution:');
{
  const src = new AperiodicSource(31337, DT, { exponent: 1.4, rms: 10 });
  const x = generate(src, 300);
  check('excess kurtosis (Gaussian = 0)', kurtosis(x), -0.5, 0.5);
}

// --- 1d. No startup transient: the slow OU components must begin already
// charged, or every recording opens with a visible drift ramp. Averaged over
// several seeds and 20 s windows, because a single short window of a 1/f process
// legitimately varies a lot and would make this test read as noise.
console.log('\nStationarity at t=0 (burn-in check):');
{
  let ratio = 0;
  const seeds = [4242, 5, 91, 1200, 77771];
  for (const seed of seeds) {
    const x = generate(new AperiodicSource(seed, DT, { exponent: 1.6, rms: 10 }), 180);
    ratio += std(x.slice(0, 20 * FS)) / std(x.slice(100 * FS, 120 * FS));
  }
  check('mean RMS ratio first-20s : later-20s', ratio / seeds.length, 0.7, 1.4);
}

// --- 1e. Independent instances must be independent (they become separate
// cortical patches; the forward model, not shared state, creates channel
// correlation). Shared state here would collapse the spatial covariance.
console.log('\nIndependence of sources:');
{
  const a = generate(new AperiodicSource(1, DT, { exponent: 1.4, rms: 10 }), 120);
  const b = generate(new AperiodicSource(2, DT, { exponent: 1.4, rms: 10 }), 120);
  let ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
  ma /= a.length; mb /= b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  check('corr(source1, source2)', Math.abs(num / Math.sqrt(da * db)), 0, 0.08);
}

// --- 1f. Reproducibility: same seed must give an identical signal, or the
// ground-truth sidecar (§14) cannot be trusted.
console.log('\nReproducibility:');
{
  const a = generate(new AperiodicSource(777, DT, { exponent: 1.4, rms: 10 }), 20);
  const b = generate(new AperiodicSource(777, DT, { exponent: 1.4, rms: 10 }), 20);
  let maxDiff = 0;
  for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
  check('max |difference| for identical seed', maxDiff, 0, 0);
}

console.log('\n=== Step 2: oscillations (noise-driven Hopf) ===\n');

function genOsc(o: HopfOscillator, secs: number): Float64Array {
  const n = Math.floor(secs * FS);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = o.next();
  return out;
}

// --- 2a. THE periodicity test. A fixed sum of sinusoids returns to near-perfect
// self-similarity at its beat period; a stochastic rhythm does not. This is the
// check that the previous engine could never have passed, and it is the one that
// corresponds to what a reader sees as "fake".
console.log('Long-lag autocorrelation (periodicity tell):');
{
  const alpha = new HopfOscillator(2024, DT, { freq: 10, rms: 20 });
  const x = genOsc(alpha, 300);
  const ac = autocorr(x, Math.floor(8 * FS));
  let worst = 0;
  for (let lag = Math.floor(2 * FS); lag < ac.length; lag++) {
    worst = Math.max(worst, Math.abs(ac[lag]));
  }
  check('max |autocorr| at lags > 2 s', worst, 0, 0.2);
}

// --- 2a-bis. The envelope periodicity test — the one that actually corresponds
// to what a reader calls fake.
//
// Raw-signal autocorrelation turned out to be a weak discriminator: the previous
// engine scored 0.16 on it, inside tolerance, because its stochastic amplitude
// envelope decorrelated the carrier over long lags. But the visible artifact is
// not in the carrier, it is in the ENVELOPE. A fixed sum of tones has a
// deterministic beat envelope that repeats at the reciprocal of the tone spacing,
// and that repeating swell is what the eye reads as two sine waves multiplied
// together. Measured on the old engine this rebounds to 0.80 at a 1.65 s lag,
// matching the ~0.6 Hz spacing of its alpha tone set.
console.log('\nEnvelope periodicity (the "two sines multiplied" tell):');
{
  const alpha = new HopfOscillator(4321, DT, { freq: 10, rms: 20 });
  const x = genOsc(alpha, 240);
  const env = hilbertEnvelope(x);
  const ac = autocorr(env, Math.floor(6 * FS));
  let peak = 0;
  for (let lag = Math.floor(0.4 * FS); lag < ac.length; lag++) peak = Math.max(peak, ac[lag]);
  check('max envelope autocorr, lag 0.4-6 s', peak, 0, 0.35);
}

// --- 2b. Spectral peak: right frequency, and a realistic width. A too-narrow
// peak is the signature of a sustained sinusoid (§3.2).
console.log('\nAlpha spectral peak:');
{
  const bg = new AperiodicSource(11, DT, { exponent: 1.4, rms: 8 });
  const alpha = new HopfOscillator(12, DT, { freq: 10, rms: 20 });
  const n = 300 * FS;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = bg.next() + alpha.next();
  const psd = welch(x, FS, 4096);
  const pk = spectralPeak(psd, 7, 14);
  check('peak frequency', pk.freq, 9.3, 10.7, ' Hz');
  check('peak FWHM', pk.fwhm, 1.2, 4.5, ' Hz');
  check('peak rises above aperiodic floor', pk.power > 0 ? 1 : 0, 1, 1);
}

// --- 2c. Envelope statistics (§11.2 log-normal, §6 DFA 0.6-0.8).
console.log('\nEnvelope statistics:');
{
  const alpha = new HopfOscillator(77, DT, { freq: 10, rms: 20 });
  const x = genOsc(alpha, 600);
  const env = hilbertEnvelope(x);
  const logEnv = new Float64Array(env.length);
  for (let i = 0; i < env.length; i++) logEnv[i] = Math.log(Math.max(env[i], 1e-9));
  check('skewness of log-envelope (log-normal = 0)', skewness(logEnv), -1.0, 0.6);

  // decimate to 25 Hz so DFA scales cover seconds-to-minutes, where LRTC lives
  const dec = 10;
  const envD = new Float64Array(Math.floor(env.length / dec));
  for (let i = 0; i < envD.length; i++) envD[i] = env[i * dec];
  const scales: number[] = [];
  for (let s = 25; s <= 2000; s = Math.round(s * 1.5)) scales.push(s);
  check('envelope DFA exponent', dfa(envD, scales), 0.6, 0.95);
}

// --- 2d. a >= 0 must be rejected: a limit cycle is a metronome, and silently
// allowing one would reintroduce exactly the regularity this rewrite removes.
console.log('\nGuard rails:');
{
  let threw = false;
  try { new HopfOscillator(1, DT, { freq: 10, damping: 0.5 }); } catch { threw = true; }
  check('rejects non-negative damping', threw ? 1 : 0, 1, 1);
  let threw2 = false;
  try { new HopfOscillator(1, DT, { freq: 10, warp: { b1: 0.9, b2: 0.3 } }); } catch { threw2 = true; }
  check('rejects non-monotonic phase warp', threw2 ? 1 : 0, 1, 1);
}

console.log('\n=== Step 3: waveform shape ===\n');

// --- 3a. Phase warping must produce harmonics; an unwarped oscillator must not.
// §5: harmonics are what create spurious cross-frequency coupling, so being able
// to switch them on and off is a requirement, not a detail.
console.log('Harmonic structure from phase warping:');
{
  function harmonicRatio(warp: typeof NO_WARP): number {
    const o = new HopfOscillator(555, DT, { freq: 10, rms: 20, warp, freqWander: 0.25 });
    const x = genOsc(o, 300);
    const psd = welch(x, FS, 4096);
    const f0 = spectralPeak(psd, 7, 13);
    const h2 = spectralPeak(psd, 17, 23);
    return h2.power / Math.max(f0.power, 1e-12);
  }
  const plain = harmonicRatio(NO_WARP);
  const arch = harmonicRatio(MU_WARP);
  check('sinusoidal: 2f power / 1f power', plain, 0, 0.02);
  check('arciform (mu):  2f power / 1f power', arch, 0.02, 0.9);
  check('warping increases harmonic content', arch > plain * 3 ? 1 : 0, 1, 1);
}

// ---------------------------------------------------------------------------
console.log('\n=== Steps 4-9: full engine (sources -> leadfield -> chain) ===\n');

function runEngine(secs: number, opts: EngineOptions = {}) {
  const eng = new EegEngine(opts);
  const n = Math.floor(secs * FS);
  const nCh = eng.electrodes.length;
  const data: Float64Array[] = eng.electrodes.map(() => new Float64Array(n));
  const buf = new Float64Array(nCh);
  for (let i = 0; i < n; i++) {
    eng.next(buf);
    for (let c = 0; c < nCh; c++) data[c][i] = buf[c];
  }
  return { eng, data };
}

// Same as runEngine, but drives a patient state and a set of active pattern
// toggles first — needed to exercise the pattern sources (sleep, variants, …).
function runEngineState(
  secs: number, opts: EngineOptions, state: PatientState, patterns: string[],
  // Per-ictal-toggle severity/discharge-frequency/hemisphere. Default `{}` is a
  // no-op, so callers that don't care about seizure parameters read exactly as
  // they did before.
  ictalParams: Partial<Record<string, Partial<{ intensity: number; frequency: number; hemisphere: 'left' | 'right' }>>> = {},
) {
  const eng = new EegEngine(opts);
  eng.setPatientState(state);
  eng.setActivePatterns(new Set(patterns));
  eng.setIctalParams(ictalParams);
  const n = Math.floor(secs * FS);
  const nCh = eng.electrodes.length;
  const data: Float64Array[] = eng.electrodes.map(() => new Float64Array(n));
  const buf = new Float64Array(nCh);
  for (let i = 0; i < n; i++) {
    eng.next(buf);
    for (let c = 0; c < nCh; c++) data[c][i] = buf[c];
  }
  return { eng, data };
}

// Display-space runner for Step 19: drives SimulationSource -> commonAverage ->
// computeChannelVoltage exactly as renderTrace.ts / EEGCanvas do, on a montage's
// channels, rather than runEngineState's raw electrodes.
function runDisplay(
  montageId: string, state: PatientState, patterns: string[], secs: number, seed: number,
) {
  const montage = MONTAGES[montageId];
  const settings: SimSettings = {
    speed: 30, sensitivity: 7, patientState: state,
    activePatterns: new Set(patterns),
    ictalParams: defaultIctalParamsMap(),
    artifactParams: { ...defaultArtifactParams() },
  };
  const src = new SimulationSource(seed, FS);
  const n = Math.floor(secs * FS);
  const data: Float64Array[] = montage.channels.map(() => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    const allV = src.next(settings);
    const avg = commonAverage(allV);
    for (let c = 0; c < montage.channels.length; c++) {
      data[c][i] = computeChannelVoltage(montage.channels[c], src.t, allV, avg);
    }
  }
  return { montage, data };
}

// A toggle's own isolated contribution on ONE display-space channel: same-seed
// on-minus-off, mirroring the raw-electrode `contrib` helper (Step 11) but after
// the montage/CAR transform.
function displayContrib(
  montageId: string, state: PatientState, toggle: string, label: string, secs: number, seed: number,
): Float64Array {
  const off = runDisplay(montageId, state, [], secs, seed);
  const on = runDisplay(montageId, state, [toggle], secs, seed);
  const ci = on.montage.channels.findIndex((c) => c.label === label);
  if (ci < 0) throw new Error(`no channel '${label}' in montage ${montageId}`);
  const n = on.data[ci].length;
  const diff = new Float64Array(n);
  for (let k = 0; k < n; k++) diff[k] = on.data[ci][k] - off.data[ci][k];
  return diff;
}

/** Robust peak-to-peak: 99th minus 1st percentile, ignoring rare outliers. */
function pctP2p(x: Float64Array): number {
  const sorted = Array.from(x).sort((a, b) => a - b);
  return sorted[Math.floor(0.99 * sorted.length)] - sorted[Math.floor(0.01 * sorted.length)];
}

function corr(a: Float64Array, b: Float64Array): number {
  let ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
  ma /= a.length; mb /= b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

function bandPower(x: Float64Array, lo: number, hi: number): number {
  const psd = welch(x, FS, 2048);
  let s = 0;
  for (let k = 0; k < psd.freqs.length; k++) {
    if (psd.freqs[k] >= lo && psd.freqs[k] <= hi) s += psd.power[k];
  }
  return s;
}

// Band power on a SHORT slice: a 512-pt Welch segment (2.05 s) so that a few-second
// window still holds at least one segment. Coarser frequency resolution than
// bandPower's 2048, but ictal window checks only compare gross in-band energy.
function winPower(x: Float64Array, lo: number, hi: number): number {
  const psd = welch(x, FS, 512);
  let s = 0;
  for (let k = 0; k < psd.freqs.length; k++) {
    if (psd.freqs[k] >= lo && psd.freqs[k] <= hi) s += psd.power[k];
  }
  return s;
}

// --- 6a. Volume conduction: correlation must fall off with real inter-electrode
// distance. Independently generated channels give a flat, near-zero profile and
// make ICA and source localisation look impossibly good (§12).
console.log('Spatial structure (volume conduction):');
{
  const { eng, data } = runEngine(120, { seed: 4, artifacts: false, recordingChain: false });
  const near: number[] = [], far: number[] = [];
  for (let i = 0; i < eng.electrodes.length; i++) {
    for (let j = i + 1; j < eng.electrodes.length; j++) {
      const d = electrodeDistanceCm(eng.electrodes[i], eng.electrodes[j]);
      const c = corr(data[i], data[j]);
      if (d < 6) near.push(c);
      else if (d > 16) far.push(c);
    }
  }
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(a.length, 1);
  check('mean corr, neighbours (<6 cm)', mean(near), 0.45, 0.995);
  // Reported, not bounded. The bounds that stood here (-0.35..0.45) had no source. Since
  // forward.ts removes each source's monopole (2026-09-22) a far pair sees a source's weak
  // return field with the opposite sign, so negative far correlation is what the physics
  // predicts; it read +0.49 before that fix and -0.35 after. The claim is the FALLOFF, which
  // the neighbour floor and 'near exceeds far' assert.
  check('mean corr, distant (>16 cm)', mean(far), -1, 1);
  check('near exceeds far', mean(near) - mean(far) > 0.2 ? 1 : 0, 1, 1);
}

// --- 6b. Alpha must be posterior. §11.5 lists band-power topography as a
// required spatial check, and a posterior alpha maximum is the single most
// recognisable feature of an awake EEG.
console.log('\nAlpha topography:');
{
  // `muFraction`/`muLaterality` are pinned because the C3/F3 check below is
  // ABOUT mu: background mu is now a per-subject trait that most subjects do not
  // have (engine.ts `sampleSubject` — mu is a benign variant, not a fixture of
  // the normal awake background), so the subject under test must be one of the
  // minority who do, symmetric so the assertion is side-neutral. 0.45 is the
  // amplitude every subject used to carry, so these two checks measure exactly
  // what they measured before the trait existed.
  const { eng, data } = runEngine(120, { seed: 5, artifacts: false, recordingChain: false,
    subject: { iaf: 10, alphaRms: 16, vigilanceBias: 0.62, muFraction: 0.45, muLaterality: 0.5 } });
  const at = (n: string) => bandPower(data[eng.indexOf(n)], 8, 12);
  const post = (at('O1') + at('O2') + at('P3') + at('P4')) / 4;
  const ant = (at('Fp1') + at('Fp2') + at('F7') + at('F8')) / 4;
  // The FLOOR (2.0) is the clinical claim of IK-006 and the only half of this
  // check that asserts a fact. The CEILING is a regression guard.
  //
  // It was 600 while forward.ts used a Gaussian falloff, which has no algebraic
  // tail: at sigma ~4 cm the PDR's gain 19 cm away at Fp1 came out at
  // exp(-19^2/(2*4.1^2)) ~ 2e-5, so the posterior rhythm reached the front not
  // weakly but not at all, and this ratio read 520. Replacing that with an
  // algebraic profile took it to 68. 150 gives headroom over the current value
  // while being a real guard again rather than a placeholder parked above a
  // number known to be wrong. See INFORMING-KNOWLEDGE.md §11, 2026-08-28.
  check('posterior / anterior alpha power', post / ant, 2.0, 150);
  // The other half of that fix, asserted directly: the always-on background mu
  // must be maximal centrally. Tangential mu gave C3/F3 = 0.30 (peak frontal);
  // radial gives ~17.
  check('C3 / F3 alpha-band power (background mu is central, not frontal)',
    at('C3') / at('F3'), 3.0, 1e6);
  // L/R PDR symmetry limits (LEARNINGEEG-STUDY §14.1): normal is <1 Hz peak
  // frequency asymmetry and <50% amplitude asymmetry between hemispheres.
  // engine.ts builds this in structurally — 'pdrR' is offset +0.25 Hz and
  // 0.92x the RMS of 'pdrL' — so this asserts the built-in offset stays
  // inside the clinical bound rather than drifting there by accident.
  const psdO1 = welch(data[eng.indexOf('O1')], FS, 4096);
  const psdO2 = welch(data[eng.indexOf('O2')], FS, 4096);
  const peakO1 = spectralPeak(psdO1, 6, 14).freq;
  const peakO2 = spectralPeak(psdO2, 6, 14).freq;
  check('O1 / O2 alpha peak frequency asymmetry (<1 Hz)', Math.abs(peakO1 - peakO2), 0, 1, ' Hz');
  const ampO1 = Math.sqrt(at('O1')), ampO2 = Math.sqrt(at('O2'));
  check('O1 / O2 alpha amplitude asymmetry (<50%)',
    Math.abs(ampO1 - ampO2) / Math.max(ampO1, ampO2), 0, 0.5);
}

// --- 6c. Alpha on the bipolar chain, and its reactivity (IK-006, IK-007).
// A referential posterior maximum (6b) is necessary but not what a reader sees:
// the double-banana is bipolar, and a bipolar link's alpha tracks the field's
// spatial GRADIENT across it, not the field height. IK-006 says the PDR is read
// off the posterior links P4-O2 and T6-O2. The reported defect was the opposite
// — alpha sitting one link forward at C4-P4 — so this asserts P4-O2 is the
// dominant posterior-chain link and that eye opening (the Berger effect, IK-007)
// collapses it.
console.log('\nAlpha on the bipolar chain + reactivity:');
{
  // Mu pinned present and symmetric for the same reason as the block above: the
  // eyes-open check asserts mu does NOT block (IK-007), which is only measurable
  // in a subject who has mu.
  const OPTS: EngineOptions = { seed: 5, artifacts: false, recordingChain: false,
    subject: { iaf: 10, alphaRms: 16, vigilanceBias: 0.62, muFraction: 0.45, muLaterality: 0.5 } };
  const closed = runEngineState(120, OPTS, 'awake', []);
  const open = runEngineState(120, OPTS, 'awake', ['eyes-open']);
  const bipAlpha = (r: typeof closed, a: string, b: string) => {
    const x = r.data[r.eng.indexOf(a)], y = r.data[r.eng.indexOf(b)];
    const d = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) d[i] = x[i] - y[i];
    return bandPower(d, 8, 12);
  };
  // RETIRED: `P4-O2 / C4-P4 alpha power >= 1.2`, which asserted that the PDR is
  // "read off the posterior link, not central-parietal". Two things were wrong
  // with it. The reference course never makes that claim — it says only that the
  // PDR is the resting occipital rhythm and that the slower, higher-amplitude
  // frequencies are found in the back. And it is self-defeating arithmetic: a
  // bipolar link measures the field GRADIENT, so a realistic referential
  // topography (O 100%, P 75%, C 40%) gives C-P = 35 against P-O = 25 — the
  // parietal link legitimately carries MORE alpha. The only way to satisfy the
  // old bound was to hold P artificially low, which is exactly what the engine
  // did: a -0.4 inferior offset on the PDR source left P3 at 20% of O1 while
  // posterior-temporal T5 sat at 69%, so the parasagittal chain showed no PDR
  // until its very last link. See engine.ts's pdrL/pdrR comment.
  //
  // What replaces it is the claim that actually holds: BOTH posterior links of
  // the chain carry the rhythm, so neither is starved. This is what a reader
  // means by the antero-posterior gradient being smooth.
  const ratioPO = bipAlpha(closed, 'P4', 'O2') / bipAlpha(closed, 'C4', 'P4');
  check('C4-P4 and P4-O2 BOTH carry the PDR (neither link starved; ratio near 1)',
    ratioPO, 0.35, 3.0);
  // And the referential topography that makes it true, asserted directly — this
  // is the check that would have caught the defect above. Parietal must not be
  // starved relative to posterior temporal: P3 sits over parieto-occipital
  // cortex and belongs at or above T5, never at a third of it.
  const refA = (n: string) => bandPower(closed.data[closed.eng.indexOf(n)], 8, 12);
  check('P3 / T5 alpha power (parietal is not starved vs posterior temporal)',
    refA('P3') / refA('T5'), 0.5, 3.0);
  check('P4 / T6 alpha power (parietal is not starved vs posterior temporal)',
    refA('P4') / refA('T6'), 0.5, 3.0);
  // The posterior-temporal link carries the PDR too, unlike anterior-temporal F8-T4.
  check('T6-O2 / F8-T4 alpha power (PDR reaches posterior temporal, not anterior)',
    bipAlpha(closed, 'T6', 'O2') / bipAlpha(closed, 'F8', 'T4'), 4.0, 1e6);
  // Alpha reactivity: eye opening attenuates the posterior rhythm to a fraction.
  check('P4-O2 alpha, eyes-open / eyes-closed (Berger effect attenuation)',
    bipAlpha(open, 'P4', 'O2') / bipAlpha(closed, 'P4', 'O2'), 0, 0.45);
  // Mu does NOT react to eye opening (IK-007): while posterior alpha collapses,
  // the sensorimotor rhythm at C3/C4 persists — it is precisely this differential
  // reactivity that tells the two 8-13 Hz rhythms apart (IK-006).
  //
  // This asserts on MU'S OWN contribution, isolated, not on total 8-13 Hz power at
  // C3/C4. The difference matters and used to be wrong. Reading the composite band
  // cannot separate "mu blocked" from "posterior alpha that reaches C3/C4
  // collapsed", and once the forward model gained a realistic algebraic tail the
  // posterior rhythm genuinely does reach the central electrodes — so the composite
  // ratio fell to 0.764 and reported a violation of a claim the entry never made.
  // The old comment here conceded the confound ("a small residual dip is the
  // attenuated posterior-alpha field spilling into the central electrodes, not mu
  // reacting") and measured through it anyway.
  //
  // Isolation is exact rather than statistical: `muFraction` is supplied as a
  // subject override, so lowering it to 0 changes only the mu oscillators' RMS and
  // leaves every other source bit-identical at the same seed. Subtracting the two
  // time series therefore yields mu and nothing else. Referential C3/C4, because
  // reactivity is a spectral question (CLAUDE.md §4).
  const NO_MU: EngineOptions = { ...OPTS, subject: { ...OPTS.subject, muFraction: 0 } };
  const closedNoMu = runEngineState(120, NO_MU, 'awake', []);
  const openNoMu = runEngineState(120, NO_MU, 'awake', ['eyes-open']);
  const muOnly = (withMu: typeof closed, without: typeof closed, e: string) => {
    const a = withMu.data[withMu.eng.indexOf(e)], b = without.data[without.eng.indexOf(e)];
    const d = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) d[i] = a[i] - b[i];
    return bandPower(d, 8, 13);
  };
  const muOpen = muOnly(open, openNoMu, 'C3') + muOnly(open, openNoMu, 'C4');
  const muClosed = muOnly(closed, closedNoMu, 'C3') + muOnly(closed, closedNoMu, 'C4');
  check('C3+C4 isolated mu power, eyes-open / eyes-closed (mu does not block; IK-007)',
    muOpen / muClosed, 0.8, 1.25);
}

// --- 6d. Amplitude inversely related to frequency (LEARNINGEEG-STUDY §1, §3):
// the slower posterior alpha rhythm must be higher-amplitude than the faster
// beta rhythm, each measured at its own characteristic site (alpha posterior;
// beta at engine.ts's betaL/betaR/betaF anchors C3/C4/F3/F4/Fz) rather than
// diluted or contaminated by measuring both at the same electrodes — a fixed
// 13-30 Hz band read at O1/O2 picks up the posterior alpha line's own spectral
// skirt, not a real posterior beta rhythm, and would fail this the wrong way.
console.log('\nAmplitude vs frequency (alpha vs beta, each at its own site):');
{
  const { eng, data } = runEngine(120, { seed: 5, artifacts: false, recordingChain: false,
    subject: { iaf: 10, alphaRms: 16, betaRms: 4, vigilanceBias: 0.62 } });
  const alphaAmp = (n: string) => Math.sqrt(bandPower(data[eng.indexOf(n)], 8, 12));
  const betaAmp = (n: string) => Math.sqrt(bandPower(data[eng.indexOf(n)], 13, 30));
  const alphaPost = Math.max(alphaAmp('O1'), alphaAmp('O2'));
  const betaOwnSite = Math.max(betaAmp('C3'), betaAmp('C4'), betaAmp('F3'), betaAmp('F4'), betaAmp('Fz'));
  check('alpha amplitude (posterior) / beta amplitude (central-frontal, own site)',
    alphaPost / betaOwnSite, 1.5, 20);
}

// --- 6e. Sensorimotor beta is a low, even admixture, not spiky transients
// (LEARNINGEEG-STUDY §9). Beta is genuinely bursty, but the BurstyOscillator's
// log-normal amplitude tail (`ampSigma`, in BETA_BURST_OPTS) governs how far the
// tallest burst towers over the background. A heavy tail throws occasional bursts
// several times the median, which land on the page as sharp central packets a
// learner could mistake for muscle or an epileptiform transient. Total beta power
// is fixed (the oscillator recalibrates its RMS), so the salience defect lives
// entirely in the CREST FACTOR — peak envelope / RMS — of the production beta
// generator. Averaged over seeds for stability: ampSigma 0.4 holds it near 8; the
// old 0.6 default pushed it past 10. This imports BETA_BURST_OPTS so a revert of
// the tail is caught here.
console.log('\nSensorimotor beta salience (no standout spikes):');
{
  const crest = (seed: number) => {
    const src = new BurstyOscillator(seed, DT, { ...BETA_BURST_OPTS, rms: 4 });
    const n = 120 * FS;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = src.next();
    const env = hilbertEnvelope(x);
    let mx = 0, sumSq = 0;
    for (const v of env) { mx = Math.max(mx, v); sumSq += v * v; }
    return mx / Math.sqrt(sumSq / env.length);
  };
  const seeds = [1, 2, 3, 4, 5];
  const meanCrest = seeds.reduce((a, s) => a + crest(s), 0) / seeds.length;
  check('beta burst crest factor (peak/RMS; tamed amplitude tail)', meanCrest, 0, 9.0);
}

// --- 6f. Posterior dominant rhythm waxing tail (analogous to §6e beta). The
// HopfOscillator drives its waxing/waning with a log-normal envelope multiplier,
// exp(PDR_ENVELOPE_DEPTH * modulator); that depth governs how far the tallest
// alpha burst towers over the in-band RMS. At the old 0.55 default the crest ran
// ~5.6, and the tallest bursts read referentially (O1/O2-AVG) above the 100 uV
// PDR ceiling (LEARNINGEEG §1) and sharp enough that a learner could misread a
// waxing alpha burst as an epileptiform transient. 0.42 tames the tail; mean
// alpha power is unchanged because the oscillator recalibrates its RMS to `rms`.
// Imports PDR_ENVELOPE_DEPTH so a revert of the depth is caught here.
console.log('\nPDR alpha burst salience (waxing tail):');
{
  const crest = (seed: number) => {
    const src = new HopfOscillator(seed, DT, {
      freq: 10, rms: 16, freqWander: 0.55, damping: -2.6, envelopeDepth: PDR_ENVELOPE_DEPTH,
    });
    const n = 120 * FS;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = src.next();
    const env = hilbertEnvelope(x);
    let mx = 0, sumSq = 0;
    for (const v of env) { mx = Math.max(mx, v); sumSq += v * v; }
    return mx / Math.sqrt(sumSq / env.length);
  };
  const seeds = [1, 2, 3, 4, 5];
  const meanCrest = seeds.reduce((a, s) => a + crest(s), 0) / seeds.length;
  check('PDR alpha crest factor (peak/RMS; tamed waxing tail)', meanCrest, 0, 5.4);
}

// --- 6g. Background mu is a per-subject BENIGN VARIANT, and the central phase
// reversal follows it. The reference course places mu in "Normal Variants" —
// the epileptiform-mimic chapter — not in "Normal Awake", whose background is
// the PDR, the antero-posterior gradient, reactivity and activation, with no
// central rhythm at all.
//
// This is a display-space claim (CLAUDE.md §4), so it is asserted on rendered
// bipolar-ap rows, not on referential band power. Mu is focal at C3/C4, so when
// a subject HAS it the parasagittal chain SHOULD phase-reverse there — that is
// how a reader recognises mu, and suppressing it would be the error. The claim
// is the converse: a subject WITHOUT mu must show no central reversal, because
// nothing in a normal awake background is focal at C3/C4. Until mu became a
// per-subject trait every subject carried it symmetrically, so this reversal was
// a permanent fixture of the default record and trained the learner to ignore
// the one localising sign the double-banana exists to produce (IK-003).
//
// Seeds are chosen by asking `sampleSubject` what it actually drew, so this
// exercises the shipped sampling rather than an injected override.
console.log('\nBackground mu as a per-subject variant (display space, bipolar-ap awake):');
{
  // Prevalence guard: mu is a minority finding. Reported prevalence spans
  // roughly 20-50% of routine adult records, so this bounds the sampling to
  // that range rather than to the exact draw engine.ts happens to make.
  let present = 0;
  for (let sd = 1; sd <= 2000; sd++) if (sampleSubject(sd).muFraction > 0) present++;
  check('subjects with background mu (benign variant, minority finding)',
    present / 2000, 0.20, 0.50);

  // (i) The invariant the reported defect was about, measured on the SHIPPED
  // sampling: take the first six subjects `sampleSubject` gives no mu, and the
  // central links must not be inverted against each other. Before this work the
  // same measurement read -0.448 (left) / -0.549 (right) in every subject.
  const noMu: number[] = [];
  for (let sd = 1; sd <= 400 && noMu.length < 6; sd++) {
    if (sampleSubject(sd).muFraction === 0) noMu.push(sd);
  }
  const centralOf = (seed: number) => {
    const { montage, data } = runDisplay('bipolar-ap', 'awake', [], 120, seed);
    const idx = (l: string) => montage.channels.findIndex((c) => c.label === l);
    return [corr(data[idx('F3-C3')], data[idx('C3-P3')]),
            corr(data[idx('F4-C4')], data[idx('C4-P4')])];
  };
  const noMuCorrs = noMu.flatMap(centralOf);
  check('no-mu subjects: mean F3-C3 vs C3-P3 and F4-C4 vs C4-P4 correlation (no central reversal)',
    noMuCorrs.reduce((a, b) => a + b, 0) / noMuCorrs.length, -0.18, 0.35);

  // (ii) And the reversal must actually TRACK mu — otherwise the fix would have
  // been to delete a rhythm rather than to scope it. Paired on one subject: the
  // between-subject spread is large (sd ~0.19 on a 120 s record), so comparing
  // six-subject means is underpowered and measured a 0.009 difference against a
  // true ~0.13. Pairing removes subject variance and leaves mu as the only
  // difference. Still display space — the electrodes go through the real
  // commonAverage + computeChannelVoltage, exactly as EEGCanvas draws them.
  const LINKS = ['F3-C3', 'C3-P3', 'F4-C4', 'C4-P4'];
  const centralPaired = (muFraction: number) => {
    const r = runEngineState(120, {
      seed: 5, artifacts: false, recordingChain: false,
      subject: { iaf: 10, alphaRms: 16, vigilanceBias: 0.62, muFraction, muLaterality: 0.5 },
    }, 'awake', []);
    const chans = MONTAGES['bipolar-ap'].channels.filter((c) => LINKS.includes(c.label));
    const n = r.data[0].length;
    const rows = new Map(chans.map((c) => [c.label, new Float64Array(n)]));
    const allV: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      for (let e = 0; e < r.eng.electrodes.length; e++) allV[r.eng.electrodes[e]] = r.data[e][i];
      const avg = commonAverage(allV);
      for (const c of chans) rows.get(c.label)![i] = computeChannelVoltage(c, i / FS, allV, avg);
    }
    return (corr(rows.get('F3-C3')!, rows.get('C3-P3')!)
          + corr(rows.get('F4-C4')!, rows.get('C4-P4')!)) / 2;
  };
  check('same subject, mu present makes the central pair MORE inverted (reversal tracks mu)',
    centralPaired(0) - centralPaired(0.45), 0.05, 1.0);
}

// --- Montage localisation coverage. A bipolar montage exists so a focus can be
// localised by phase reversal, and that requires the electrode of interest to sit
// in TWO adjacent derivations: one large row with no neighbour to oppose it
// localises nothing. Electrodes that appear only ONCE in a montage are therefore
// blind spots, and their count is the montage's structural fitness for purpose.
//
// `bipolar-transverse` used to leave TEN electrodes single-appearance — every
// lateral one plus both occipitals (Fp1, Fp2, F7, F8, T3, T4, T5, T6, O1, O2) —
// because its chains stopped one derivation short at each end. A T3-maximal spike
// reversed cleanly on bipolar-ap and stood alone on the transverse montage, so the
// confirmation a reader switches montage FOR was unobtainable. Adopting ACNS
// Guideline 3 TB-18.1 in full (adding F7-Fp1, Fp2-F8, T5-O1, O2-T6) closes eight of
// the ten. T3 and T4 remain, and can only be closed by the A1-T3 / T4-A2 ear links
// of TB-18.2, which belongs as its own montage rather than bolted onto this one.
console.log('\nMontage localisation coverage (electrodes with only one derivation):');
{
  const singles = (montageId: string) => {
    const seen: Record<string, number> = {};
    for (const c of MONTAGES[montageId].channels) {
      if (c.label === 'ECG') continue;
      for (const e of [c.active, c.reference]) if (e) seen[e] = (seen[e] ?? 0) + 1;
    }
    return Object.values(seen).filter((n) => n === 1).length;
  };
  // bipolar-ap: Fz and Pz, which is correct — a three-electrode midline chain has
  // two ends and cannot do better.
  check('bipolar-ap electrodes appearing in only one derivation', singles('bipolar-ap'), 0, 2);
  // bipolar-transverse (ACNS TB-18.1): T3 and T4 only.
  check('bipolar-transverse electrodes appearing in only one derivation',
    singles('bipolar-transverse'), 0, 2);

  // The two transverse montages are COMPLEMENTARY, which is why the standard
  // defines both and why neither is asserted to cover everything on its own.
  // TB-18.1 runs its chains to the lateral and occipital ends but stops the
  // central chain at T3/T4; TB-18.2 runs that chain ear-to-ear (A1-T3 … T4-A2),
  // covering T3/T4 at the cost of the ends. Measured on a T3-maximal spike:
  // TB-18.1 gives T3-C3 -171.6 µV standing alone, TB-18.2 gives A1-T3 +187.0
  // against T3-C3 -171.6, a clean reversal.
  //
  // So the invariant worth asserting is at the level of the montage SET, not any
  // one montage: every scalp electrode must have two links in at least one
  // transverse montage, or there is a focus the reader simply cannot confirm.
  // A1/A2 are excluded — they are chain terminals by construction, as Fz and Pz
  // are on the midline chain of bipolar-ap.
  const twoLinkSomewhere = (montageIds: string[]) => {
    const best: Record<string, number> = {};
    for (const id of montageIds) {
      const seen: Record<string, number> = {};
      for (const c of MONTAGES[id].channels) {
        if (c.label === 'ECG') continue;
        for (const e of [c.active, c.reference]) if (e) seen[e] = (seen[e] ?? 0) + 1;
      }
      for (const [e, n] of Object.entries(seen)) best[e] = Math.max(best[e] ?? 0, n);
    }
    return Object.entries(best)
      .filter(([e, n]) => n < 2 && e !== 'A1' && e !== 'A2')
      .map(([e]) => e);
  };
  const uncovered = twoLinkSomewhere(['bipolar-transverse', 'bipolar-transverse-ears']);
  check('scalp electrodes with no two-link coverage in ANY transverse montage',
    uncovered.length, 0, 0);
}

// --- Beta must be an ADMIXTURE, not the dominant rhythm of the row it sits on.
// IK-014 says awake sensorimotor beta is "a low-amplitude, relatively even central
// admixture" riding within the background envelope. That entry's existing check
// measures the generator's crest factor in isolation, and a separate one compares
// posterior alpha to central beta each at its own site — neither asks the question
// a reader answers at a glance: how much of THIS ROW is beta?
//
// It went unasked and the answer was 70%. Measured across ten seeds on bipolar-ap,
// beta reached 17 uV on F3-C3 and F4-C4, was 67-70% of their 2-45 Hz power against
// 33-36% on rows with no beta source near them, and was LOUDER than alpha there
// (beta/alpha 1.7-1.8). On the page those rows read as serrated and noisy against
// clean temporal rows — a defect a user spotted immediately and the whole battery
// missed. Corrected by taking betaRms from 2.5-6.0 to 1.25-3.0 uV (roughly 7-18 uV
// peak-to-peak, the textbook awake range) and widening betaL/betaR to 1.6x.
//
// The floor is not zero and the bound respects that: the aperiodic background
// carries its own 13-30 Hz content worth ~33-36% of any row, so no setting of the
// beta oscillators takes the share below that. What is asserted is the EXCESS over
// rows that have no beta source of their own.
console.log('\nBeta as an admixture, not the dominant rhythm (display space, bipolar-ap awake):');
{
  const SEEDS = [3, 5, 42, 777, 1234];
  const share = (label: string) => {
    const vals = SEEDS.map((seed) => {
      const { montage, data } = runDisplay('bipolar-ap', 'awake', [], 60, seed);
      const x = data[montage.channels.findIndex((c) => c.label === label)];
      const psd = welch(x, FS, 4096);
      let b = 0, t = 0;
      for (let k = 0; k < psd.freqs.length; k++) {
        const f = psd.freqs[k];
        if (f >= 13 && f < 30) b += psd.power[k];
        if (f >= 2 && f < 45) t += psd.power[k];
      }
      return Math.sqrt(b) / Math.sqrt(t);
    });
    return vals.reduce((a, c) => a + c, 0) / vals.length;
  };
  // Rows carrying a beta source, against rows that carry none. The excess is what
  // beta actually adds; asserting the raw share alone would be asserting the
  // background's 13-30 Hz content too.
  const central = (share('F3-C3') + share('F4-C4')) / 2;
  const clean = (share('T3-T5') + share('P3-O1')) / 2;
  check('beta share of a central row (F3-C3, F4-C4) in display space', central, 0.30, 0.60);
  check('central beta share MINUS a row with no beta source (the excess beta adds)',
    central - clean, 0.0, 0.25);
}

// --- 7. Artifacts: statistics and topography.
console.log('\nArtifacts:');
{
  const { eng, data } = runEngine(180, { seed: 6,
    subject: { artifactBurden: 1.2, lineAmp: 4, alphaRms: 12 } });
  // EMG is shot noise, so it must be heavy-tailed. Filtered Gaussian noise with
  // the same bandwidth would sit near 0 here and fool nothing but a spectrum.
  const temporal = data[eng.indexOf('T3')];
  check('temporal channel excess kurtosis (EMG shot noise)', kurtosis(temporal), 0.25, 40);
  // Blinks are frontal-maximal and decay posteriorly.
  const lf = (n: string) => bandPower(data[eng.indexOf(n)], 0.5, 5);
  check('frontal / occipital low-frequency power (blink)', (lf('Fp1') + lf('Fp2')) / (lf('O1') + lf('O2')), 1.5, 400);
}

// --- 7b. Artifact gating: a UI checkbox left off must leave the corresponding
// engine generator's contribution at zero, or "no artifacts selected" would be
// a lie (this is the bug this gating mechanism exists to fix). Blink is the
// discriminating case: it is the only artifact large enough at Fp1/Fp2 to be
// visible against the aperiodic/alpha background there, ~180-220 uV p2p over
// 60 s when enabled (see the "ON" figures probed during development) vs.
// background-only. `setArtifactGates` must silence it while leaving the
// neural background (O1's own p2p) untouched, proving the gate acts on the
// artifact generator specifically and not on the engine as a whole.
console.log('\nArtifact gating (checkbox off => generator silent):');
{
  const eng = new EegEngine({ seed: 9, subject: { artifactBurden: 1.6, alphaRms: 12 } });
  eng.setArtifactGates({
    blink: false, eyeOpening: false, saccade: false, emg: false, pop: false,
    sweat: false, line: false, ecgScalp: false, movement: false,
  });
  const secs = 60;
  const n = Math.floor(secs * FS);
  const nCh = eng.electrodes.length;
  const buf = new Float64Array(nCh);
  const iFp1 = eng.indexOf('Fp1'), iFp2 = eng.indexOf('Fp2'), iO1 = eng.indexOf('O1');
  const fp1 = new Float64Array(n), fp2 = new Float64Array(n), o1 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    eng.next(buf);
    fp1[i] = buf[iFp1]; fp2[i] = buf[iFp2]; o1[i] = buf[iO1];
  }
  const p2p = (x: Float64Array) => {
    const sorted = Array.from(x).sort((a, b) => a - b);
    return sorted[Math.floor(0.99 * sorted.length)] - sorted[Math.floor(0.01 * sorted.length)];
  };
  const fp1P2p = p2p(fp1), fp2P2p = p2p(fp2), o1P2p = p2p(o1);
  // Bounded relative to this same run's own O1 (background+PDR) p2p rather than
  // a hand-picked microvolt constant, so the check tracks whatever background
  // amplitude this subject happened to sample rather than an arbitrary number.
  check('Fp1 p2p vs O1 p2p, artifacts off, 60s', fp1P2p / o1P2p, 0, 1.3);
  check('Fp2 p2p vs O1 p2p, artifacts off, 60s', fp2P2p / o1P2p, 0, 1.3);
  check('Fp1 p2p, artifacts off, 60s (sanity floor)', fp1P2p, 3, 110, ' uV');
  check('Fp2 p2p, artifacts off, 60s (sanity floor)', fp2P2p, 3, 110, ' uV');
}

// --- 7c. DISPLAY POLARITY. Clinical EEG is drawn negative-up: a channel whose
// active input is more positive than its reference deflects DOWNWARD. The canvas
// implements that as `y = centerY + v` (EEGCanvas), so the sign a generator
// returns decides which way a learner sees the pattern point. Getting it wrong
// does not show up in any power/correlation check — every other assertion in
// this file is invariant to a sign flip — which is exactly how the app came to
// render every trace inverted while passing the whole battery.
//
// Each pattern's contribution is isolated by subtracting a same-seed run with
// the pattern off. The engine is deterministic, so that difference is the
// generator's exact output with the background removed.
console.log('\nDisplay polarity (negative-up: v > 0 renders DOWN):');
{
  const POL_OPTS: EngineOptions = { seed: 20, artifacts: false, recordingChain: false, subject: { alphaRms: 12 } };
  const SECS = 60;

  /**
   * Sign of the diagnostic phase of `toggle`'s contribution at `el`.
   * `metric: 'lead'` takes the first phase of the event (isolated transients);
   * 'peak' takes the largest excursion, which is what names the spike in a
   * RHYTHMIC train — there every spike is preceded by the previous cycle's slow
   * wave, so a look-back would report that neighbour instead.
   */
  function polarity(state: PatientState, toggle: string, el: string, metric: 'lead' | 'peak'): number {
    const on = runEngineState(SECS, POL_OPTS, state, [toggle]);
    const off = runEngineState(SECS, POL_OPTS, state, []);
    const i = on.eng.indexOf(el);
    const n = on.data[0].length;
    let peak = 0, peakAt = 0;
    const d = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      d[k] = on.data[i][k] - off.data[i][k];
      if (Math.abs(d[k]) > Math.abs(peak)) { peak = d[k]; peakAt = k; }
    }
    if (Math.abs(peak) < 1) return 0; // toggle never reached the generator
    if (metric === 'peak') return Math.sign(peak);
    const thresh = 0.4 * Math.abs(peak);
    for (let k = Math.max(0, peakAt - Math.round(0.5 * FS)); k <= peakAt; k++) {
      if (Math.abs(d[k]) >= thresh) return Math.sign(d[k]);
    }
    return Math.sign(peak);
  }

  // Blink is an artifact GATE, not a pattern toggle, so it needs its own pair of
  // runs. It is also the case a reader notices first: Bell's phenomenon drives
  // Fp1 positive relative to F3, which must render DOWNWARD (IK-001).
  {
    const mk = (blink: boolean) => {
      // `artifacts: false` (POL_OPTS) switches the artifact subsystem off
      // wholesale, so the gate would have nothing to enable — this pair needs it
      // built, with every other artifact gated off so the diff is blink alone.
      const eng = new EegEngine({ ...POL_OPTS, artifacts: true });
      eng.setArtifactGates({
        blink, eyeOpening: false, saccade: false, emg: false, pop: false,
        sweat: false, line: false, ecgScalp: false, movement: false,
      });
      const n = Math.floor(SECS * FS);
      const buf = new Float64Array(eng.electrodes.length);
      const iA = eng.indexOf('Fp1'), iB = eng.indexOf('F3');
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) { eng.next(buf); out[i] = buf[iA] - buf[iB]; }
      return out;
    };
    const on = mk(true), off = mk(false);
    let peak = 0;
    for (let i = 0; i < on.length; i++) {
      const v = on[i] - off[i];
      if (Math.abs(v) > Math.abs(peak)) peak = v;
    }
    check('blink Fp1-F3 peak (IK-001: Fp1 positive)', peak, 5, 400, ' uV');
    check('blink Fp1-F3 renders DOWN (+1)', Math.sign(peak), 1, 1);
  }

  // The blink's FIELD (IK-032). The checks above assert direction on one row, which a
  // blink confined to Fp1 alone would also satisfy — and did: a geometry change once
  // collapsed F3-C3 to 0.7 mm on the page while every check here stayed green. A real
  // blink is bifrontal, so the second row of each chain must carry a visible downward
  // deflection too, smaller than the first, with nothing left by the occiput.
  {
    const EL = ['Fp1', 'F3', 'C3', 'P3', 'O1', 'F7', 'T3'] as const;
    const mk = (blink: boolean) => {
      const eng = new EegEngine({ ...POL_OPTS, artifacts: true });
      eng.setArtifactGates({
        blink, eyeOpening: false, saccade: false, emg: false, pop: false,
        sweat: false, line: false, ecgScalp: false, movement: false,
      });
      const n = Math.floor(SECS * FS);
      const buf = new Float64Array(eng.electrodes.length);
      const idx = EL.map(e => eng.indexOf(e));
      const out = EL.map(() => new Float64Array(n));
      for (let i = 0; i < n; i++) { eng.next(buf); idx.forEach((j, k) => { out[k][i] = buf[j]; }); }
      return out;
    };
    const on = mk(true), off = mk(false);
    // Isolate the blink by differencing the same-seed runs, then read every electrode
    // at the single instant the blink peaks — a field is a snapshot, not a power ratio.
    const d = EL.map((_, k) => {
      const a = new Float64Array(on[k].length);
      for (let i = 0; i < a.length; i++) a[i] = on[k][i] - off[k][i];
      return a;
    });
    const at = (e: typeof EL[number]) => d[EL.indexOf(e)];
    let ti = 0;
    for (let i = 0; i < at('Fp1').length; i++) {
      if (Math.abs(at('Fp1')[i]) > Math.abs(at('Fp1')[ti])) ti = i;
    }
    const row = (a: typeof EL[number], b: typeof EL[number]) => at(a)[ti] - at(b)[ti];
    const fp1f3 = row('Fp1', 'F3'), f3c3 = row('F3', 'C3');
    const fp1f7 = row('Fp1', 'F7'), f7t3 = row('F7', 'T3');
    check('blink F3-C3 renders DOWN (+1; IK-032, the row that went flat)', Math.sign(f3c3), 1, 1);
    check('blink F7-T3 renders DOWN (+1; IK-032)', Math.sign(f7t3), 1, 1);
    check('blink F3-C3 / Fp1-F3 (IK-032: present but decaying)', f3c3 / fp1f3, 0.15, 0.95);
    check('blink F7-T3 / Fp1-F7 (IK-032: present but decaying)', f7t3 / fp1f7, 0.15, 0.95);
    check('blink P3-O1 / Fp1-F3 (IK-032: no posterior field)',
      Math.abs(row('P3', 'O1')) / fp1f3, 0, 0.1);
  }

  // The blink's RECOVERY SWING (IK-001). A real blink does not drop and stop: the
  // downward deflection is followed by a smaller opposite-going excursion that
  // carries the trace back through baseline. That overshoot is not made by the
  // eyelid — `BlinkGenerator.next()` returns a strictly non-negative lid shape, so
  // the generator alone is monophasic — it is made by the recording chain's causal
  // low-frequency filter (chain.ts `CLINICAL_LFF_HZ`), which returns any transient
  // to baseline by driving it past baseline.
  //
  // Hence this pair runs WITH the recording chain, unlike every other check in 7c,
  // which switches it off to isolate a generator. The chain is deterministic and
  // linear, and both runs share a seed, so its noise, gains and filter states are
  // identical and cancel in the on-minus-off difference exactly as they do above.
  {
    const fp1f3 = (blink: boolean) => {
      // This check needs ONE isolated blink: it finds the largest blink and asserts
      // the row is back at baseline in the [1.5, 3] s window after its peak. Blinks
      // are now spaced regularly (BlinkGenerator's low-variance schedule), so at the
      // default 16/min rate (~3.75 s apart, min gap ~3.0 s) the NEXT blink's onset
      // lands on the far edge of that window and contaminates the "baseline". Halve
      // the blink rate here (artifactBurden 0.5 -> ~8/min, gaps >= 6 s) so the measured
      // blink is genuinely alone. Rate does not affect a single blink's amplitude or
      // morphology — the only things IK-001's recovery claim depends on.
      const eng = new EegEngine({
        ...POL_OPTS, artifacts: true, recordingChain: true,
        subject: { alphaRms: 12, artifactBurden: 0.5 },
      });
      eng.setArtifactGates({
        blink, eyeOpening: false, saccade: false, emg: false, pop: false,
        sweat: false, line: false, ecgScalp: false, movement: false,
      });
      const n = Math.floor(SECS * FS);
      const buf = new Float64Array(eng.electrodes.length);
      const iA = eng.indexOf('Fp1'), iB = eng.indexOf('F3');
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) { eng.next(buf); out[i] = buf[iA] - buf[iB]; }
      return out;
    };
    const on = fp1f3(true), off = fp1f3(false);
    const n = on.length;
    const d = new Float64Array(n);
    let peak = 0, peakAt = 0;
    for (let i = 0; i < n; i++) {
      d[i] = on[i] - off[i];
      if (Math.abs(d[i]) > Math.abs(peak)) { peak = d[i]; peakAt = i; }
    }
    // Largest excursion of the OPPOSITE sign in the 1.5 s following the peak, and
    // what is left of the row in the 1.5 s after that (the return to baseline).
    let swing = 0;
    for (let i = peakAt; i < Math.min(n, peakAt + Math.round(1.5 * FS)); i++) {
      if (-Math.sign(peak) * d[i] > -Math.sign(peak) * swing) { swing = d[i]; }
    }
    let residual = 0;
    for (let i = peakAt + Math.round(1.5 * FS); i < Math.min(n, peakAt + Math.round(3 * FS)); i++) {
      residual = Math.max(residual, Math.abs(d[i]));
    }
    check('blink Fp1-F3 recovery swing runs UP (-1; IK-001, opposite the main deflection)',
      Math.sign(swing), -1, -1);
    check('blink Fp1-F3 recovery swing / downward peak (IK-001: a smaller opposite swing)',
      Math.abs(swing) / Math.abs(peak), 0.10, 0.50);
    check('blink Fp1-F3 back at baseline 1.5-3 s after the peak (IK-001), as a fraction of peak',
      residual / Math.abs(peak), 0, 0.10);
  }

  // Eye opening rides the same ocular sources as a blink but must render the
  // OPPOSITE way — upward, i.e. Fp1-F3 negative — and at a smaller amplitude
  // (IK-011). Its own gate pairs, artifacts built, everything else silenced so
  // each diff isolates that one generator.
  {
    const fp1f3 = (gate: Partial<ArtifactGates>) => {
      const eng = new EegEngine({ ...POL_OPTS, artifacts: true });
      eng.setArtifactGates({
        blink: false, eyeOpening: false, saccade: false, emg: false, pop: false,
        sweat: false, line: false, ecgScalp: false, movement: false, ...gate,
      });
      const n = Math.floor(SECS * FS);
      const buf = new Float64Array(eng.electrodes.length);
      const iA = eng.indexOf('Fp1'), iB = eng.indexOf('F3');
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) { eng.next(buf); out[i] = buf[iA] - buf[iB]; }
      return out;
    };
    const off = fp1f3({});
    const signedPeak = (on: Float64Array) => {
      let peak = 0;
      for (let i = 0; i < on.length; i++) {
        const v = on[i] - off[i];
        if (Math.abs(v) > Math.abs(peak)) peak = v;
      }
      return peak;
    };
    const openPeak = signedPeak(fp1f3({ eyeOpening: true }));
    const blinkPeak = signedPeak(fp1f3({ blink: true }));
    check('eye-opening Fp1-F3 renders UP (-1; IK-011, opposite a blink)', Math.sign(openPeak), -1, -1);
    check('eye-opening Fp1-F3 peak (sanity floor)', Math.abs(openPeak), 3, 200, ' uV');
    check('eye-opening / blink Fp1-F3 peak magnitude (IK-011: smaller than a blink)',
      Math.abs(openPeak) / Math.abs(blinkPeak), 0, 0.85);
  }

  // IK-007 for the eye-opening MANEUVER. While the eyes are held open between the
  // opening and closing sweeps the PDR blocks, and after closure it comes back
  // within about a second (learningeeg: the PDR "emerges right after the patient
  // closes their eyes"). Until 2026-09-11 the maneuver drew its ocular sweeps with the
  // alpha running straight through the open interval — the one picture reactivity
  // says cannot happen — and no check looked, because the toggle-level check above
  // (`eyes-open`) never exercises the maneuver.
  //
  // Measured on the PDR's OWN contribution: the same seed at alphaRms 12 minus
  // alphaRms 0 leaves every other source bit-identical, so neither the ocular sweep
  // nor the background can pass for alpha, and its Hilbert envelope needs no
  // band-pass. Mu is pinned off so the difference is the PDR alone.
  {
    const run = (alphaRms: number, eyeOpening = true) => {
      const eng = new EegEngine({ ...POL_OPTS, artifacts: true, subject: { alphaRms, muFraction: 0 } });
      eng.setArtifactGates({
        blink: false, eyeOpening, saccade: false, emg: false, pop: false,
        sweat: false, line: false, ecgScalp: false, movement: false,
      });
      const n = Math.floor(SECS * FS);
      const buf = new Float64Array(eng.electrodes.length);
      const iP = eng.indexOf('P4'), iO = eng.indexOf('O2');
      const x = new Float64Array(n), lvl = new Float64Array(n);
      for (let i = 0; i < n; i++) { eng.next(buf); x[i] = buf[iP] - buf[iO]; lvl[i] = eng.groundTruth.eyesOpen; }
      return { x, lvl };
    };
    const a = run(12), z = run(0);
    const pdr = new Float64Array(a.x.length);
    for (let i = 0; i < pdr.length; i++) pdr[i] = a.x[i] - z.x[i];
    const env = hilbertEnvelope(pdr);
    let sOpen = 0, nOpen = 0, sClosed = 0, nClosed = 0, closures = 0;
    for (let i = 0; i < env.length; i++) {
      if (a.lvl[i] > 0.9) { sOpen += env[i]; nOpen++; } else if (a.lvl[i] < 0.02) { sClosed += env[i]; nClosed++; }
      if (i > 0 && a.lvl[i - 1] >= 0.5 && a.lvl[i] < 0.5) closures++;
    }
    const closed = sClosed / nClosed;
    check('eye-opening maneuvers in the window (enough to measure)', closures, 3, 1e6);
    check('PDR amplitude while eyes held open / eyes closed, P4-O2 (IK-007: attenuates by at least half)',
      sOpen / nOpen / closed, 0, 0.5);

    // After closure the PDR comes back PROMINENTLY: it overshoots its settled
    // amplitude for a second or two before easing down (engine.ts ALPHA_REBOUND_*,
    // measured on learningeeg's pdr-emerges-eye-closure figure: 2.19x settled at
    // +1.0-1.5 s). Asserted against the SAME subject at the SAME moments with no
    // maneuver — not against "eyes-closed on this run", whose baseline contains the
    // rebound itself. Only closures followed by >= 5 s of closed eyes count.
    const c = run(12, false), zc = run(0, false);
    const ctl = new Float64Array(c.x.length);
    for (let i = 0; i < ctl.length; i++) ctl[i] = c.x[i] - zc.x[i];
    const envCtl = hilbertEnvelope(ctl);
    const win = (e: Float64Array, a: number, b: number) => {
      let s = 0; for (let k = a; k < b; k++) s += e[k]; return s / (b - a);
    };
    // Settling is read at 4-5 s: both real records are still raised at 2.5-3.5 s.
    let reb = 0, settle = 0, nReb = 0;
    for (let i = 1; i < env.length; i++) {
      if (!(a.lvl[i - 1] >= 0.5 && a.lvl[i] < 0.5)) continue;
      const end = i + Math.round(5 * FS);
      if (end > env.length || a.lvl.subarray(i, end).some((v) => v >= 0.5)) continue;
      const w = (s0: number, s1: number) => [i + Math.round(s0 * FS), i + Math.round(s1 * FS)] as const;
      reb += win(env, ...w(0.75, 2.0)) / win(envCtl, ...w(0.75, 2.0));
      settle += win(env, ...w(4.0, 5.0)) / win(envCtl, ...w(4.0, 5.0));
      nReb++;
    }
    check('eye closures followed by >= 5 s of closed eyes (enough to measure the rebound)', nReb, 2, 1e6);
    check('PDR amplitude 0.75-2.0 s after eye closure / same moments without the maneuver (IK-007: rebounds above resting)',
      reb / nReb, 1.2, 3);
    check('PDR amplitude 4-5 s after eye closure / same moments without the maneuver (IK-007: settles back)',
      settle / nReb, 0.8, 1.3);
  }

  // IK-002 — lateral (saccadic) eye movement is OUT OF PHASE at F7 and F8. The
  // eyes are a standing dipole (cornea positive, retina negative); a horizontal
  // saccade swings it toward the direction of gaze, driving one frontotemporal
  // electrode positive and its mirror negative. On a bipolar-ap chain each of
  // F7 and F8 therefore shows a phase reversal, and the two reversals are mirror
  // images — the left and right upper links move in opposite directions. The
  // `saccade` generator is isolated by the same on-off diff used above, so each
  // link carries only the eye-movement contribution. Correlation (not a single
  // sample's sign) states the reversal: gaze alternates direction, and a global
  // sign-flip of every link leaves each pairwise correlation unchanged.
  {
    const link = (a: string, b: string, gate: Partial<ArtifactGates>) => {
      const eng = new EegEngine({ ...POL_OPTS, artifacts: true });
      eng.setArtifactGates({
        blink: false, eyeOpening: false, saccade: false, emg: false, pop: false,
        sweat: false, line: false, ecgScalp: false, movement: false, ...gate,
      });
      const n = Math.floor(SECS * FS);
      const buf = new Float64Array(eng.electrodes.length);
      const iA = eng.indexOf(a), iB = eng.indexOf(b);
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) { eng.next(buf); out[i] = buf[iA] - buf[iB]; }
      return out;
    };
    // Isolated eye-movement contribution on a bipolar-ap link = on − off on the
    // same seed, so the background rhythm cancels and only the saccade remains.
    const contrib = (a: string, b: string) => {
      const on = link(a, b, { saccade: true });
      const off = link(a, b, {});
      const d = new Float64Array(on.length);
      for (let i = 0; i < d.length; i++) d[i] = on[i] - off[i];
      return d;
    };
    const fp1f7 = contrib('Fp1', 'F7');
    const f7t3 = contrib('F7', 'T3');
    const fp2f8 = contrib('Fp2', 'F8');
    const f8t4 = contrib('F8', 'T4');
    // Phase reversal at F7: the two links sharing F7 are anti-correlated.
    check('eye-movement: Fp1-F7 vs F7-T3 correlation (IK-002: phase reversal at F7)',
      corr(fp1f7, f7t3), -1.0001, -0.4);
    // Phase reversal at F8: the two links sharing F8 are anti-correlated.
    check('eye-movement: Fp2-F8 vs F8-T4 correlation (IK-002: phase reversal at F8)',
      corr(fp2f8, f8t4), -1.0001, -0.4);
    // The two reversals are mirror images: the left and right upper links move in
    // opposite directions across the midline — the core out-of-phase claim.
    check('eye-movement: Fp1-F7 vs Fp2-F8 correlation (IK-002: out of phase across the midline)',
      corr(fp1f7, fp2f8), -1.0001, -0.4);
    // Sanity floor so the correlations cannot be satisfied by near-zero noise.
    // The on−off diff shares a seed, so the background cancels to machine
    // precision; a floor of 1 uV cleanly separates the real saccade deflection
    // (Fp1-F7 partially cancels, both electrodes seeing the ocular dipole, so it
    // is the smallest of the four links) from rounding noise.
    let p = 0;
    for (const v of fp1f7) if (Math.abs(v) > Math.abs(p)) p = v;
    check('eye-movement Fp1-F7 peak (sanity floor)', Math.abs(p), 1, 300, ' uV');
  }

  // IK-012 — the four interictal-discharge morphologies, all at the left-temporal
  // (T3) focus. A reader separates two independent axes, and each is asserted on
  // its own: DURATION (base width) tells a spike from a sharp wave, and an
  // AFTER-GOING SLOW WAVE is what turns either into a "-and-slow-wave" complex.
  // Each toggle's contribution at T3 is isolated by the same on-off diff used
  // above; the leadfield only scales amplitude, so the base width (ms) and the
  // slow/sharp lobe ratio survive projection unchanged.
  {
    const iedAtT3 = (toggle: string) => {
      const on = runEngineState(SECS, POL_OPTS, 'awake', [toggle]);
      const off = runEngineState(SECS, POL_OPTS, 'awake', []);
      const i = on.eng.indexOf('T3');
      const n = on.data[0].length;
      const d = new Float64Array(n);
      for (let k = 0; k < n; k++) d[k] = on.data[i][k] - off.data[i][k];
      return d;
    };
    // Base width (ms) of the surface-negative sharp lobe at 10% of its peak, plus
    // the largest positive excursion in the 0.6 s after it — the after-going slow
    // wave — expressed as a fraction of the sharp peak. Measured on the strongest
    // event; the sharp component is the most-negative sample by construction.
    const measure = (d: Float64Array) => {
      let peak = 0, peakAt = 0;
      for (let k = 0; k < d.length; k++) if (d[k] < peak) { peak = d[k]; peakAt = k; }
      const thresh = 0.1 * Math.abs(peak);
      let lo = peakAt; while (lo > 0 && Math.abs(d[lo]) >= thresh) lo--;
      let hi = peakAt; while (hi < d.length - 1 && Math.abs(d[hi]) >= thresh) hi++;
      const widthMs = ((hi - lo) / FS) * 1000;
      let slow = 0;
      const end = Math.min(d.length, peakAt + Math.round(0.6 * FS));
      for (let k = peakAt; k < end; k++) if (d[k] > slow) slow = d[k];
      return { widthMs, slowRatio: slow / Math.abs(peak), peak: Math.abs(peak) };
    };
    const spike = measure(iedAtT3('ied-spike'));
    const sharp = measure(iedAtT3('ied-sharp'));
    const spikeWave = measure(iedAtT3('ied-spike-wave'));
    const sharpWave = measure(iedAtT3('ied-sharp-wave'));
    check('ied-spike base width (IK-012: spike 20-70 ms)', spike.widthMs, 20, 70, ' ms');
    check('ied-sharp base width (IK-012: sharp wave 70-200 ms)', sharp.widthMs, 70, 200, ' ms');
    check('ied-sharp broader than ied-spike (IK-012: duration separates them)',
      sharp.widthMs - spike.widthMs, 20, 200, ' ms');
    check('ied-spike has no after-going slow wave (IK-012)', spike.slowRatio, 0, 0.15);
    check('ied-sharp has no after-going slow wave (IK-012)', sharp.slowRatio, 0, 0.15);
    check('ied-spike-wave carries an after-going slow wave (IK-012)', spikeWave.slowRatio, 0.3, 1.5);
    check('ied-sharp-wave carries an after-going slow wave (IK-012)', sharpWave.slowRatio, 0.3, 1.5);
  }

  // -1 = renders UP (surface-negative), +1 = renders DOWN (surface-positive).
  const POLARITIES: [string, PatientState, string, string, 'lead' | 'peak', number][] = [
    // Surface-NEGATIVE sharp transients — the epileptiform family and the
    // vertex/K-complex sharp components. All must point UP.
    ['V-wave Cz',                'awake', 'v-waves',         'Cz', 'lead', -1],
    ['K-complex Cz (sharp)',     'awake', 'k-complex',       'Cz', 'lead', -1],
    ['focal spike LT T3',        'awake', 'focal-spikes-lt', 'T3', 'lead', -1],
    ['3 Hz gen. spike-wave Fz',  'awake', '3hz-gsw',         'Fz', 'peak', -1],
    ['polyspike-wave Fz',        'awake', 'polyspike-wave',  'Fz', 'peak', -1],
    ['GPEDs Cz',                 'awake', 'gpeds',           'Cz', 'peak', -1],
    ['6 Hz phantom spike-wave Cz', 'awake', '6hz-sw',        'Cz', 'peak', -1],
    // BETS is state-gated to drowsy/n1/n2 (A4 fix — see variants.ts betsSide).
    ['BETS T3',                  'drowsy', 'bets',           'T3', 'lead', -1],
    // Surface-POSITIVE transients — named for their polarity, must point DOWN.
    ['POSTS O1',                 'awake', 'posts',           'O1', 'lead',  1],
    ['lambda O1',                'awake', 'lambda',          'O1', 'lead',  1],
    ['triphasic Fz (dominant)',  'awake', 'triphasic',       'Fz', 'lead',  1],
    // "14 & 6 Hz POSITIVE bursts" are named for their polarity: pos1406's
    // morphology now half-wave-emphasises its positive-going phase, so the sharp
    // comb-teeth are reliably surface-positive and render DOWN (A4 fix — see
    // variants.ts pos1406). State-gated to drowsiness/light sleep.
    ['14-6-pos T6',              'drowsy', '14-6-pos',        'T6', 'peak',  1],
  ];
  for (const [label, state, toggle, el, metric, want] of POLARITIES) {
    check(`${label} renders ${want < 0 ? 'UP  ' : 'DOWN'} (${want > 0 ? '+1' : '-1'})`,
      polarity(state, toggle, el, metric), want, want);
  }
}

// --- 7b. Toggle latency (SMALL-FIXES #13). A freshly-enabled event source must
// put its first graphoelement on the screen promptly rather than after a full
// inter-event interval — a spike focus whose steady interval is 3-7 s should not
// leave the toggle looking dead for several seconds. FIRST_EVENT_LEAD compresses
// only that first wait; here we assert the first isolated event at T3 lands well
// under a second while the steady rate (asserted elsewhere) is untouched.
console.log('\nToggle latency:');
{
  const OPTS: EngineOptions = { seed: 5, artifacts: false, recordingChain: false };
  const on = runEngineState(5, OPTS, 'awake', ['focal-spikes-lt']);
  const off = runEngineState(5, OPTS, 'awake', []);
  const i = on.eng.indexOf('T3');
  const n = on.data[0].length;
  let firstAt = -1;
  for (let k = 0; k < n; k++) {
    if (Math.abs(on.data[i][k] - off.data[i][k]) > 5) { firstAt = k; break; }
  }
  check('focal-spikes first event appears soon after enable (#13)',
    firstAt < 0 ? 99 : firstAt / FS, 0, 1.0, ' s');
}

// --- 8pre. The amplifier's low-pass must actually be a low-pass at its stated
// corner. This is a code-correctness assertion, not a clinical claim: it says only
// that a filter labelled `fc` is -3 dB at `fc`, which is what the label means.
//
// It exists because that was false for a long time. `AmplifierLowPass` used the
// impulse-invariant pole exp(-2*pi*fc*dt) with no feed-forward zero, which
// approximates an fc corner only while 2*pi*fc*dt << 1. At fs = 250 and the default
// fc = 100 that product is 2.51, and the resulting filter measured -0.4 dB at 40 Hz,
// -1.3 at 100 and just -1.4 dB at Nyquist — its true -3 dB point was off the top of
// the representable band, so a "100 Hz low-pass" removed essentially nothing. No
// IK- entry asserted anything about the high-frequency filter, which is exactly why
// it survived: nothing was guarding it. Driving the production class with sinusoids
// is deliberate — asserting on the coefficients would re-encode the bug's own
// assumption rather than test the behaviour.
console.log('\nAmplifier low-pass response (production class, driven with sinusoids):');
{
  const magDb = (fc: number, f: number) => {
    const lp = new AmplifierLowPass(1 / FS, fc);
    const n = Math.round(FS * 40);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const y = lp.next(Math.sin(2 * Math.PI * f * i / FS));
      if (i > n * 0.5) peak = Math.max(peak, Math.abs(y));
    }
    return 20 * Math.log10(peak);
  };
  for (const fc of [35, 70, 100]) {
    check(`low-pass @ ${fc} Hz is -3 dB at its own corner`, magDb(fc, fc), -3.6, -2.5, ' dB');
  }
  // Flat in the band a reader actually works in...
  check('low-pass @ 70 Hz is flat at 10 Hz (passband untouched)', magDb(70, 10), -0.5, 0.01, ' dB');
  // ...and genuinely rolling off by Nyquist, which the old form never did.
  check('low-pass @ 70 Hz attenuates hard near Nyquist', magDb(70, 124), -80, -12, ' dB');
}

// --- 8. Recording chain: the line-noise peak must be present but imperfect, and
// a channel-independent sensor floor must exist.
console.log('\nRecording chain:');
{
  const { eng, data } = runEngine(120, { seed: 7, subject: { lineAmp: 6, lineFreq: 50 } });
  const psd = welch(data[eng.indexOf('Cz')], FS, 4096);
  const at50 = spectralPeak(psd, 48, 52);
  check('mains peak present near 50 Hz', at50.freq, 49, 51, ' Hz');
  // Not a pure tone: §8 requires wandering frequency/amplitude and harmonics, so
  // the peak must have measurable width rather than sitting in a single bin.
  check('mains peak has non-zero width', at50.fwhm, 0.05, 6, ' Hz');
}

// --- 9. Inter-subject variability must actually vary (§12).
console.log('\nInter-subject variability:');
{
  const iafs: number[] = [], exps: number[] = [];
  for (let s = 1; s <= 40; s++) {
    const p = sampleSubject(s);
    iafs.push(p.iaf); exps.push(p.exponent);
  }
  check('IAF spread across subjects (SD)', std(iafs), 0.5, 2.0, ' Hz');
  // Every sampled subject's PDR must land inside the normal ADULT band the
  // reference course gives, 8.5-12 Hz. Spread alone did not guard this: the
  // range used to start at 8.2, so ~9% of subjects carried a PDR below the
  // normal floor — an abnormally slow posterior rhythm labelled normal, which is
  // a finding a learner is specifically meant to detect.
  check('slowest sampled IAF (normal adult PDR floor, 8.5 Hz)', Math.min(...iafs), 8.5, 12, ' Hz');
  check('fastest sampled IAF (normal adult PDR ceiling, 12 Hz)', Math.max(...iafs), 8.5, 12, ' Hz');
  check('exponent spread across subjects (SD)', std(exps), 0.1, 0.5);
}

// --- 10. Overall plausibility at the electrode (§2 amplitude anchor, §4 band
// ordering). Alpha should exceed gamma by orders of magnitude; getting that
// ratio wrong (gamma too strong) is the classic tell (§12).
console.log('\nWhole-signal plausibility:');
{
  const { eng, data } = runEngine(180, { seed: 8, subject: { alphaRms: 14, lineAmp: 0 } });
  const o1 = data[eng.indexOf('O1')];
  const sorted = Array.from(o1).sort((a, b) => a - b);
  const p2p = sorted[Math.floor(0.99 * sorted.length)] - sorted[Math.floor(0.01 * sorted.length)];
  check('O1 peak-to-peak (1st-99th pct)', p2p, 15, 130, ' uV');
  const alpha = bandPower(o1, 8, 12);
  const gamma = bandPower(o1, 35, 45);
  check('log10(alpha / gamma) power ratio', Math.log10(alpha / gamma), 1.0, 4.0);
  // Reproducibility of the whole engine, not just its parts.
  const a = runEngine(4, { seed: 99 }).data[0];
  const b = runEngine(4, { seed: 99 }).data[0];
  let md = 0;
  for (let i = 0; i < a.length; i++) md = Math.max(md, Math.abs(a[i] - b[i]));
  check('engine reproducible for identical seed', md, 0, 0);
}

// ---------------------------------------------------------------------------
console.log('\n=== Step 11: sleep grapho-elements (pattern sources) ===\n');

// The sleep sources are `stateIntrinsic`: a toggle forces them even while awake,
// which lets us isolate each element against an otherwise-identical awake
// background (same seed, patterns off) rather than confounding it with the
// state-dependent shift in background bands. Clean geometry: artifacts and the
// recording chain are off so we read the source morphology and topography
// directly. Cz is the vertex; O1 is occipital.
const SLEEP_OPTS: EngineOptions = { seed: 20, artifacts: false, recordingChain: false, subject: { alphaRms: 12 } };
const cz = (d: Float64Array[], e: EegEngine) => d[e.indexOf('Cz')];
const o1c = (d: Float64Array[], e: EegEngine) => d[e.indexOf('O1')];

// Baseline: awake, nothing toggled.
const base = runEngineState(180, SLEEP_OPTS, 'awake', []);
const baseCzSigma = bandPower(cz(base.data, base.eng), 12, 15);
const baseCzP2p = pctP2p(cz(base.data, base.eng));
const baseO1P2p = pctP2p(o1c(base.data, base.eng));

// A source's own contribution at an electrode = band power with the toggle on
// minus off, at the same seed (the neural background is byte-identical between
// the two runs because the pattern generators draw from separate RNG streams).
// This isolates the source's topography from the state's background — the awake
// posterior alpha that otherwise swamps a distant electrode's denominator.
const contrib = (
  on: { data: Float64Array[]; eng: EegEngine }, name: string, lo: number, hi: number,
) => bandPower(on.data[on.eng.indexOf(name)], lo, hi) - bandPower(base.data[base.eng.indexOf(name)], lo, hi);

// Frequency-resolved `contrib`: WHERE the source's own power peaks, rather than
// how much of it falls in a band chosen in advance. Same on-minus-off
// subtraction, so the background's own peaks (the posterior alpha rhythm above
// all) cancel and cannot win the argmax.
const contribPeak = (
  on: { data: Float64Array[]; eng: EegEngine }, name: string, fLo: number, fHi: number,
): number => {
  const a = welch(on.data[on.eng.indexOf(name)], FS, 2048);
  const b = welch(base.data[base.eng.indexOf(name)], FS, 2048);
  let bestF = 0, bestP = -Infinity;
  for (let k = 0; k < a.freqs.length; k++) {
    const f = a.freqs[k];
    if (f < fLo || f > fHi) continue;
    const d = a.power[k] - b.power[k];
    if (d > bestP) { bestP = d; bestF = f; }
  }
  return bestF;
};

console.log('Spindles (11-16 Hz, vertex-maximal, N2):');
{
  const s = runEngineState(180, SLEEP_OPTS, 'awake', ['spindles']);
  const czSigma = bandPower(cz(s.data, s.eng), 12, 15);
  // Toggle raises sigma-band power at the vertex well above the spindle-free
  // background, and the spindle's own sigma contribution is central, not occipital.
  check('Cz sigma power, spindles on / off', czSigma / baseCzSigma, 3, 1e6);
  check('sigma contribution O1 / Cz (vertex-focal)', contrib(s, 'O1', 12, 15) / contrib(s, 'Cz', 12, 15), -0.1, 0.3);
  // The ratio above is sigma-band power against sigma-band power, so it would
  // pass just as happily with the tones at 20 Hz — nothing here asserted the
  // FREQUENCY. A spindle is defined as 11-16 Hz, so search a band wide enough
  // that the answer is not assumed (6-25 Hz) and require the peak to land inside
  // the clinical definition. The tone set (12.3 / 13.5 / 14.8 Hz) sits in the
  // upper half of that on purpose: this source is anchored at Cz, and the
  // vertex/centroparietal spindle is the FAST subtype at 13-15 Hz. The slow
  // 11-13 Hz subtype is frontal and would need its own source.
  check('spindle peak frequency at Cz', contribPeak(s, 'Cz', 6, 25), 11, 16, ' Hz');
}

console.log('\nVertex sharp waves (central, sharp, N1/N2):');
{
  const v = runEngineState(180, SLEEP_OPTS, 'awake', ['v-waves']);
  // 'Cz p2p, v-waves on / off' (>= 1.4) was replaced 2026-09-11. It compared the 1st-99th
  // percentile p2p with the waves on and off, and a transient on the page a few percent of the
  // time moves those percentiles by how LONG it lasts as much as by how big it is: the old
  // 250 ms rounded half-sine read 1.82, the ~100 ms sharp wave StatPearls describes reads 1.34
  // at a similar peak. AASM asks for a wave "distinguishable from the background", so the
  // wave's own peak (same seed, on minus off) is compared with the background's p2p instead.
  const on = cz(v.data, v.eng), off = cz(base.data, base.eng);
  let peak = 0;
  for (let i = 0; i < on.length; i++) peak = Math.max(peak, Math.abs(on[i] - off[i]));
  check('Cz: v-wave isolated peak / background p2p (AASM: distinguishable from the background)', peak / baseCzP2p, 1, 50);
  // Its own low-band energy is central.
  check('low-freq contribution O1 / Cz (central-max)', contrib(v, 'O1', 1, 6) / contrib(v, 'Cz', 1, 6), -0.2, 0.5);
}

console.log('\nK-complexes (large biphasic, frontal maximum, N2):');
{
  const k = runEngineState(180, SLEEP_OPTS, 'awake', ['k-complex']);
  // Three checks were replaced 2026-09-11: 'Cz p2p, k-complex on / off' (>= 1.8), 'Cz p2p,
  // k-complex (sanity floor)' (90-700 uV) and 'Cz p2p / O1 p2p (frontocentral)' (>= 1.5), which
  // read 4.45, 248 uV and 2.52 on the old model. They were written for a complex anchored
  // between Fz and Cz and read at Cz, which AASM and Colrain do not make the maximum — the
  // frontal regions are — and the last compared the vertex with O1's AWAKE p2p, most of which
  // is the posterior alpha rhythm, not K-complex field. The complex is now frontally maximal
  // (Cz carries about two thirds of Fz), so it is read at Fz, isolated (same seed, on minus off).
  const iso = (name: string) => {
    const on = k.data[k.eng.indexOf(name)], off = base.data[base.eng.indexOf(name)];
    return on.map((x, i) => x - off[i]);
  };
  const fzI = iso('Fz'), o1I = iso('O1');
  let hi = -Infinity, lo = Infinity, o1Peak = 0;
  for (const x of fzI) { hi = Math.max(hi, x); lo = Math.min(lo, x); }
  for (const x of o1I) o1Peak = Math.max(o1Peak, Math.abs(x));
  check('Fz: K-complex isolated p2p / background p2p (AASM: stands out from the background)',
    (hi - lo) / pctP2p(base.data[base.eng.indexOf('Fz')]), 1.5, 50);
  check('K-complex isolated peak Fz / O1 (frontal, not occipital)', Math.max(hi, -lo) / o1Peak, 3, 100);
}

console.log('\nPOSTS (positive occipital sharp transients, N1/N2):');
{
  const p = runEngineState(180, SLEEP_OPTS, 'awake', ['posts']);
  // 'O1 p2p, posts on / off' (>= 1.2) and 'O1 p2p / Cz p2p (occipital-maximal)' (>= 1.2) were
  // replaced 2026-09-11 (1.245 and 2.147 on the old model). Both measured POSTS on top of the
  // AWAKE background, whose O1 p2p is mostly the PDR — a rhythm POSTS never share a page with.
  // The first could only pass with oversized POSTS: the old 75 uV ones, at the very top of
  // Neupsy Key's 20-75 uV range, read 1.245; POSTS inside that range (25-55 uV) read 1.055.
  // Isolated instead (same seed, on minus off); size, width and trains are asserted in Step 19b.
  let o1Peak = 0, czPeak = 0;
  const o1On = o1c(p.data, p.eng), o1Off = o1c(base.data, base.eng);
  const czOn = cz(p.data, p.eng), czOff = cz(base.data, base.eng);
  for (let i = 0; i < o1On.length; i++) {
    o1Peak = Math.max(o1Peak, Math.abs(o1On[i] - o1Off[i]));
    czPeak = Math.max(czPeak, Math.abs(czOn[i] - czOff[i]));
  }
  check('POSTS isolated peak O1 / Cz (occipital-maximal)', o1Peak / czPeak, 3, 1000);
}

console.log('\nState gating (N2 shows spindles with no toggle):');
{
  // stateIntrinsic: the N2 state alone must bring spindles up, without the user
  // toggling anything — N2 is not N2 without them.
  const n2 = runEngineState(180, SLEEP_OPTS, 'n2', []);
  const n2CzSigma = bandPower(cz(n2.data, n2.eng), 12, 15);
  check('Cz sigma power, N2 / awake (state-driven)', n2CzSigma / baseCzSigma, 2, 1e6);
}

console.log('\n=== Step 12: non-epileptiform abnormalities (pattern sources) ===\n');

console.log('Generalised slowing (diffuse theta/delta, no PDR):');
{
  const gs = runEngineState(180, SLEEP_OPTS, 'awake', ['gen-slowing']);
  // (1) The posterior alpha rhythm is abolished — a record with a preserved PDR
  // is not "slowed". Occipital alpha power collapses vs the same-seed awake
  // background (`bandGate` mutes the alpha/mu sources to 0.15).
  const o1AlphaOn = bandPower(o1c(gs.data, gs.eng), 8, 12);
  const o1AlphaOff = bandPower(o1c(base.data, base.eng), 8, 12);
  check('O1 alpha power, gen-slowing on / off (PDR lost)', o1AlphaOn / o1AlphaOff, 0, 0.2);
  // (2) Diffuse slow activity replaces it: low-band (1-7 Hz) power rises markedly
  // and near-uniformly (broad central source), here read at the vertex.
  const czSlowOn = bandPower(cz(gs.data, gs.eng), 1, 7);
  const czSlowOff = bandPower(cz(base.data, base.eng), 1, 7);
  check('Cz slow (1-7 Hz) power, gen-slowing on / off', czSlowOn / czSlowOff, 1.5, 1e6);
}

console.log('\nFIRDA (2-3 Hz rhythmic bursts, frontal/midline):');
{
  const f = runEngineState(180, SLEEP_OPTS, 'awake', ['firda']);
  const fzP2pOn = pctP2p(f.data[f.eng.indexOf('Fz')]);
  const fzP2pOff = pctP2p(base.data[base.eng.indexOf('Fz')]);
  check('Fz p2p, firda on / off', fzP2pOn / fzP2pOff, 1.3, 50);
  check('delta (2-3 Hz) contribution Fz / T3 (frontal-max)',
    contrib(f, 'Fz', 2, 3) / Math.max(contrib(f, 'T3', 2, 3), 1e-6), 1.5, 1e6);
}

console.log('\nFocal delta, left temporal (polymorphic, lateralised):');
{
  const fd = runEngineState(180, SLEEP_OPTS, 'awake', ['focal-delta-temporal']);
  const t3P2p = pctP2p(fd.data[fd.eng.indexOf('T3')]);
  const t4P2p = pctP2p(fd.data[fd.eng.indexOf('T4')]);
  check('T3 p2p / T4 p2p (left-lateralised)', t3P2p / t4P2p, 1.3, 50);
  const t3DeltaOn = bandPower(fd.data[fd.eng.indexOf('T3')], 1, 3);
  const t3DeltaOff = bandPower(base.data[base.eng.indexOf('T3')], 1, 3);
  check('T3 delta power, focal-delta-temporal on / off', t3DeltaOn / t3DeltaOff, 2, 1e6);
}

console.log('\nTriphasic waves (anterior-predominant, periodic):');
{
  const tp = runEngineState(180, SLEEP_OPTS, 'awake', ['triphasic']);
  const fzP2pOn = pctP2p(tp.data[tp.eng.indexOf('Fz')]);
  const fzP2pOff = pctP2p(base.data[base.eng.indexOf('Fz')]);
  const o1P2p = pctP2p(tp.data[tp.eng.indexOf('O1')]);
  check('Fz p2p, triphasic on / off', fzP2pOn / fzP2pOff, 1.5, 60);
  check('Fz p2p / O1 p2p (anterior-predominant)', fzP2pOn / o1P2p, 1.3, 50);
}

console.log('\nGPEDs (generalised periodic discharges, ~1-2 s):');
{
  const g = runEngineState(180, SLEEP_OPTS, 'awake', ['gpeds']);
  const czP2pOn = pctP2p(g.data[g.eng.indexOf('Cz')]);
  check('Cz p2p, gpeds on / off', czP2pOn / baseCzP2p, 1.8, 60);
  check('Cz p2p, gpeds (sanity floor)', czP2pOn, 80, 500, ' uV');
}

console.log('\nLPEDs (left temporal periodic sharp+slow):');
{
  const lp = runEngineState(180, SLEEP_OPTS, 'awake', ['lpeds']);
  const t3P2p = pctP2p(lp.data[lp.eng.indexOf('T3')]);
  const t4P2p = pctP2p(lp.data[lp.eng.indexOf('T4')]);
  check('T3 p2p / T4 p2p (left-lateralised)', t3P2p / t4P2p, 1.3, 50);
  const t3DeltaOn = bandPower(lp.data[lp.eng.indexOf('T3')], 1, 3);
  const t3DeltaOff = bandPower(base.data[base.eng.indexOf('T3')], 1, 3);
  check('T3 delta (background slowing) power, lpeds on / off', t3DeltaOn / t3DeltaOff, 1.3, 1e6);
}

console.log('\n=== Step 13: normal variants (pattern sources) ===\n');

console.log('Mu rhythm (8-12 Hz, arciform, central; radial -> peaks at C3/C4):');
{
  const m = runEngineState(180, SLEEP_OPTS, 'awake', ['mu-rhythm']);
  // Probe C3/C4 — the electrodes the toggle's own annotation names — and require
  // the rhythm to rise there while the posterior rhythm (O1) is left untouched: mu
  // is a central, not a posterior, rhythm.
  //
  // This used to probe Cz+T3+T4 instead, on the theory that a tangential mu nulls
  // over its own anchor and peaks at the flanks. Two things were wrong with that.
  // The source steers ANTERIOR (tangentialAt(pos, [0,0,1])), not toward the vertex
  // as the old comment claimed, so its lobes fell on F3 and P3, never on Cz/T3/T4 —
  // the check was riding a 0.13 Cz sidelobe that the electrode correction reduced to
  // 0.00, which is the whole of why it started failing. And a mu whose maximum is at
  // F3 is not mu (IK-006). variants.ts is now radial; this probes the maximum.
  const bp = (r: typeof base, n: string) => bandPower(r.data[r.eng.indexOf(n)], 8, 12);
  const centralOn = bp(m, 'C3') + bp(m, 'C4');
  const centralOff = bp(base, 'C3') + bp(base, 'C4');
  check('mu central 8-12 power, mu-rhythm on / off', centralOn / centralOff, 1.2, 50);
  // Where the old geometry actually put it, asserted so it cannot drift back.
  check('mu C3 / F3 8-12 power (central, not frontal; IK-006)',
    bp(m, 'C3') / bp(m, 'F3'), 3.0, 1e6);
  check('mu O1 8-12 power, mu-rhythm on / off (~1, not posterior)',
    bp(m, 'O1') / bp(base, 'O1'), 0.9, 1.15);
}

console.log('\nWicket spikes (6-11 Hz bursts, temporal, drowsy only):');
{
  const w = runEngineState(180, SLEEP_OPTS, 'drowsy', ['wicket']);
  const wBase = runEngineState(180, SLEEP_OPTS, 'drowsy', []);
  // Band power (6-11 Hz), not p2p: the arciform bursts are rhythmic, so their
  // in-band power lifts clearly even though a single burst barely moves the p2p
  // against the drowsy background's own transients.
  const t3On = bandPower(w.data[w.eng.indexOf('T3')], 7, 11);
  const t3Off = bandPower(wBase.data[wBase.eng.indexOf('T3')], 7, 11);
  check('T3 7-11 Hz power, wicket on / off (drowsy)', t3On / t3Off, 1.3, 1e6);
  // Wicket spans the full 6-11 Hz range the UI names. The old tone set started
  // at 8.4 Hz and left the lower half empty; assert the 6-7.5 Hz band now lifts
  // too, so the widened WICKET_TONES cannot silently regress to an alpha-only set.
  const t3LoOn = bandPower(w.data[w.eng.indexOf('T3')], 6, 7.5);
  const t3LoOff = bandPower(wBase.data[wBase.eng.indexOf('T3')], 6, 7.5);
  // Floor 1.2, not 1.3: the low band carries the two smaller tones so its lift is
  // naturally gentler than the 7-11 Hz band's, but 1.2x still decisively beats the
  // ~1.0 the old alpha-only tone set would give here.
  check('T3 6-7.5 Hz power, wicket on / off (drowsy; widened range)', t3LoOn / t3LoOff, 1.2, 1e6);
  const wAwake = runEngineState(180, SLEEP_OPTS, 'awake', ['wicket']);
  const t3AwakeP2p = pctP2p(wAwake.data[wAwake.eng.indexOf('T3')]);
  check('T3 p2p, wicket toggle while awake (state-gated off)', t3AwakeP2p / baseCzP2p, 0, 1.5);
}

console.log('\nRMTD (monomorphic ~6 Hz, temporal, drowsy only):');
{
  const r = runEngineState(180, SLEEP_OPTS, 'drowsy', ['rmtd']);
  const rBase = runEngineState(180, SLEEP_OPTS, 'drowsy', []);
  const t4Theta = bandPower(r.data[r.eng.indexOf('T4')], 5, 7);
  const t4ThetaBase = bandPower(rBase.data[rBase.eng.indexOf('T4')], 5, 7);
  check('T4 5-7 Hz power, rmtd on / off (drowsy)', t4Theta / t4ThetaBase, 2, 1e6);
}

console.log('\nLambda waves (occipito-parietal positive transients):');
{
  const l = runEngineState(180, SLEEP_OPTS, 'awake', ['lambda']);
  const o1P2p = pctP2p(o1c(l.data, l.eng));
  check('O1 p2p, lambda on / off', o1P2p / baseO1P2p, 1.2, 50);
  check('lambda contribution O1 / Cz (posterior-max)',
    contrib(l, 'O1', 4, 10) / contrib(l, 'Cz', 4, 10), 1.0, 1e6);
}

console.log('\nPSWY (2.5-4.5 Hz, posterior, awake only):');
{
  const p = runEngineState(180, SLEEP_OPTS, 'awake', ['pswy']);
  const o1Slow = bandPower(o1c(p.data, p.eng), 2.5, 4.5);
  const o1SlowBase = bandPower(o1c(base.data, base.eng), 2.5, 4.5);
  check('O1 2.5-4.5 Hz power, pswy on / off', o1Slow / o1SlowBase, 1.5, 1e6);
  const pDrowsy = runEngineState(180, SLEEP_OPTS, 'drowsy', ['pswy']);
  const o1SlowDrowsy = bandPower(o1c(pDrowsy.data, pDrowsy.eng), 2.5, 4.5);
  const drowsyBase = runEngineState(180, SLEEP_OPTS, 'drowsy', []);
  const o1SlowDrowsyBase = bandPower(o1c(drowsyBase.data, drowsyBase.eng), 2.5, 4.5);
  check('O1 2.5-4.5 Hz power, pswy while drowsy (state-gated off)',
    o1SlowDrowsy / o1SlowDrowsyBase, 0.7, 1.5);
}

console.log('\n6 Hz phantom spike-wave (brief, generalised, low-amplitude):');
{
  const s = runEngineState(180, SLEEP_OPTS, 'awake', ['6hz-sw']);
  const czP2p = pctP2p(cz(s.data, s.eng));
  check('Cz p2p, 6hz-sw on / off', czP2p / baseCzP2p, 1.05, 3);
  check('Cz p2p, 6hz-sw (sanity: phantom = low amplitude)', czP2p, 10, 90, ' uV');
}

console.log('\n14 & 6 Hz positive bursts (posterior temporal, arciform):');
{
  // POS bursts are a drowsy / light-sleep phenomenon (state-gated), so test in
  // drowsy — where the reduced background alpha also lets the 14 Hz component
  // stand out. Probe 13.5-15.5 Hz (on the 14 Hz tone, above the alpha shoulder)
  // at whichever posterior-temporal electrode the source projects to most
  // strongly; the bursts are brief and low-duty, so the ratio is modest.
  const b = runEngineState(180, SLEEP_OPTS, 'drowsy', ['14-6-pos']);
  const bBase = runEngineState(180, SLEEP_OPTS, 'drowsy', []);
  const rat = (n: string) =>
    bandPower(b.data[b.eng.indexOf(n)], 13.5, 15.5) / bandPower(bBase.data[bBase.eng.indexOf(n)], 13.5, 15.5);
  check('T5/T6 13.5-15.5 Hz power, 14-6-pos on / off (drowsy)', Math.max(rat('T5'), rat('T6')), 1.3, 1e6);
  // Toggling it awake does nothing: the state gate holds it off.
  const bAwake = runEngineState(180, SLEEP_OPTS, 'awake', ['14-6-pos']);
  const t6Awake = bandPower(bAwake.data[bAwake.eng.indexOf('T6')], 13.5, 15.5);
  const t6AwakeBase = bandPower(base.data[base.eng.indexOf('T6')], 13.5, 15.5);
  check('T6 13.5-15.5 Hz power, 14-6-pos while awake (state-gated off)', t6Awake / t6AwakeBase, 0.8, 1.2);
}

console.log('\nBETS (very brief <50ms, low-amplitude, temporal, alternating side, drowsy/N1/N2 only):');
{
  // A4 fix: BETS is now state-gated (variants.ts betsSide, states: ['drowsy',
  // 'n1', 'n2']) — it's a phenomenon of drowsiness/light sleep, not relaxed
  // wakefulness (site + patterns.ts both call it "sleep"), matching the
  // wicket/rmtd/14-6-pos precedent. Test on/off in drowsy, and add the
  // state-gated-off check at awake mirroring wicket's above.
  const bt = runEngineState(180, SLEEP_OPTS, 'drowsy', ['bets']);
  const t3P2p = pctP2p(bt.data[bt.eng.indexOf('T3')]);
  const t4P2p = pctP2p(bt.data[bt.eng.indexOf('T4')]);
  // Floor only. A ceiling of 3x the resting Cz amplitude sat here, with no source: it was a
  // ratio to the background, and when the aperiodic floor was halved (2026-09-22) the same BETS
  // read 3.2x. The pattern's own claim, "low-amplitude (<50 uV)", is asserted in absolute uV
  // by the BETS block in display space ('BETS T3-T5 peak amplitude'), which a background
  // change cannot move.
  check('T3 p2p, bets on / off (drowsy)', t3P2p / baseCzP2p, 0.3, Infinity);
  check('T4 p2p, bets on / off (drowsy)', t4P2p / baseCzP2p, 0.3, Infinity);
  const btAwake = runEngineState(180, SLEEP_OPTS, 'awake', ['bets']);
  const t3AwakeP2p = pctP2p(btAwake.data[btAwake.eng.indexOf('T3')]);
  check('T3 p2p, bets toggle while awake (state-gated off)', t3AwakeP2p / baseCzP2p, 0, 1.5);
}

console.log('\n=== Step 14: chewing artifact (pattern source) ===\n');
{
  const chew = runEngineState(150, SLEEP_OPTS, 'awake', ['chewing']);
  const hf = (r: typeof base, n: string) => bandPower(r.data[r.eng.indexOf(n)], 15, 60);
  // Chewing's burst + masseter EMG is broadband/high-frequency; look well above
  // the neural bands at both temporal electrodes, on vs. off.
  const temporalOn = (hf(chew, 'T3') + hf(chew, 'T4')) / 2;
  const temporalOff = (hf(base, 'T3') + hf(base, 'T4')) / 2;
  check('temporal (T3/T4) high-freq power, chewing on/off', temporalOn / temporalOff, 4, 500);
  // Temporal-predominant: bilateral masseter sources dwarf a midline electrode.
  check('temporal / midline (Cz) high-freq power, chewing on', temporalOn / hf(chew, 'Cz'), 2.5, 200);
}

console.log('\n=== Step 15: interictal epileptiform (pattern sources) ===\n');

console.log('Focal left temporal spikes (T3-maximal):');
{
  const s = runEngineState(180, SLEEP_OPTS, 'awake', ['focal-spikes-lt']);
  const t3P2p = pctP2p(s.data[s.eng.indexOf('T3')]);
  const baseT3P2p = pctP2p(base.data[base.eng.indexOf('T3')]);
  check('T3 p2p, focal-spikes-lt on / off', t3P2p / baseT3P2p, 1.5, 150);
  check('low-freq contrib Fp2 / T3 (focal, not diffuse)',
    contrib(s, 'Fp2', 1, 20) / contrib(s, 'T3', 1, 20), -0.3, 0.4);
}

console.log('\nFocal right temporal spikes (T4-maximal):');
{
  const s = runEngineState(180, SLEEP_OPTS, 'awake', ['focal-spikes-rt']);
  check('T4 p2p, focal-spikes-rt on / off',
    pctP2p(s.data[s.eng.indexOf('T4')]) / pctP2p(base.data[base.eng.indexOf('T4')]), 1.5, 150);
}

console.log('\nFocal left frontal spikes (F3-maximal):');
{
  const s = runEngineState(180, SLEEP_OPTS, 'awake', ['focal-spikes-lf']);
  check('F3 p2p, focal-spikes-lf on / off',
    pctP2p(s.data[s.eng.indexOf('F3')]) / pctP2p(base.data[base.eng.indexOf('F3')]), 1.5, 150);
  check('low-freq contrib O1 / F3 (focal, not diffuse)',
    contrib(s, 'O1', 1, 20) / contrib(s, 'F3', 1, 20), -0.3, 0.4);
}

console.log('\n3 Hz generalised spike-wave (frontally-max, ~3 Hz):');
{
  const s = runEngineState(180, SLEEP_OPTS, 'awake', ['3hz-gsw']);
  const peak = spectralPeak(welch(s.data[s.eng.indexOf('Fz')], FS, 4096), 2, 4);
  check('Fz spectral peak near 3 Hz', peak.freq, 2.6, 3.4, ' Hz');
  check('Fz p2p, 3hz-gsw on / off',
    pctP2p(s.data[s.eng.indexOf('Fz')]) / pctP2p(base.data[base.eng.indexOf('Fz')]), 1.5, 200);
}

console.log('\nPolyspike-wave (frontally-max, JME pattern):');
{
  const s = runEngineState(180, SLEEP_OPTS, 'awake', ['polyspike-wave']);
  check('Fz p2p, polyspike-wave on / off',
    pctP2p(s.data[s.eng.indexOf('Fz')]) / pctP2p(base.data[base.eng.indexOf('Fz')]), 1.5, 200);
}

console.log('\nBurst-suppression (gate: bimodal amplitude, not additive):');
{
  const s = runEngineState(180, SLEEP_OPTS, 'awake', ['burst-suppression']);
  const czBs = s.data[s.eng.indexOf('Cz')], czBase = base.data[base.eng.indexOf('Cz')];
  check('Cz p2p, burst-suppression on / off', pctP2p(czBs) / pctP2p(czBase), 1.3, 25);
  // Most of the record sits in the 0.04x suppressed floor, so the 25th percentile
  // of |amplitude| should collapse vs baseline — this is what distinguishes a
  // genuine suppression/burst gate from a simple amplitude boost.
  const p25abs = (x: Float64Array) =>
    Array.from(x, Math.abs).sort((a, b) => a - b)[Math.floor(0.25 * x.length)];
  check('Cz 25th-pct |amp|, burst-suppression on / off', p25abs(czBs) / p25abs(czBase), 0, 0.9);
}

console.log('\nHypsarrhythmia (diffuse desynchronised delta + multifocal spikes):');
{
  const s = runEngineState(180, SLEEP_OPTS, 'awake', ['hypsarrhythmia']);
  const lowOn = (n: string) => bandPower(s.data[s.eng.indexOf(n)], 1, 4);
  const lowOff = (n: string) => bandPower(base.data[base.eng.indexOf(n)], 1, 4);
  check('Fz low-freq power, hyps on / off', lowOn('Fz') / lowOff('Fz'), 3, 1e6);
  check('O1 low-freq power, hyps on / off', lowOn('O1') / lowOff('O1'), 3, 1e6);
  check('F3 p2p, hyps on / off (multifocal spikes)',
    pctP2p(s.data[s.eng.indexOf('F3')]) / pctP2p(base.data[base.eng.indexOf('F3')]), 1.8, 150);
}

console.log('\n=== Step 16: ictal / seizure sources (pattern sources) ===\n');

// Windowed accessor: a slice of one electrode's trace between t0 and t1 seconds.
// The ictal patterns are scripted evolutions, so their diagnostic features live
// in specific time windows (onset vs. spread, clonic vs. post-ictal) rather than
// in a whole-record statistic.
const win = (r: typeof base, name: string, t0: number, t1: number) =>
  r.data[r.eng.indexOf(name)].subarray(Math.floor(t0 * FS), Math.floor(t1 * FS));
/**
 * The same window as the common-average-referenced channel (`reference-car`: X-AVG), i.e.
 * what a reader sees on that montage. Raw engine data is potential against infinity, which
 * no montage shows: since each source's field has zero mean over the head (forward.ts,
 * `surfaceMean`), a raw ratio between electrodes measures the model's absolute offset rather
 * than the page. Use this for any claim that names a referential picture.
 */
const winCar = (r: typeof base, name: string, t0: number, t1: number) => {
  const i0 = Math.floor(t0 * FS), i1 = Math.floor(t1 * FS);
  const idx = ALL_ELECTRODES.map((e) => r.eng.indexOf(e)).filter((i) => i >= 0);
  const x = r.data[r.eng.indexOf(name)];
  const out = new Float64Array(i1 - i0);
  for (let i = i0; i < i1; i++) {
    let m = 0;
    for (const k of idx) m += r.data[k][i];
    out[i - i0] = x[i] - m / idx.length;
  }
  return out;
};

console.log('Absence (3 Hz generalised spike-wave, frontally-max):');
{
  const a = runEngineState(40, SLEEP_OPTS, 'awake', ['absence-ictal']);
  const aBase = runEngineState(40, SLEEP_OPTS, 'awake', []);
  const fzOn = bandPower(a.data[a.eng.indexOf('Fz')], 2.5, 3.5);
  const fzOff = bandPower(aBase.data[aBase.eng.indexOf('Fz')], 2.5, 3.5);
  check('Fz 2.5-3.5 Hz power, absence on / off', fzOn / fzOff, 2, 1e6);
  // Generalised but frontally predominant: the discharge is larger at Fz than O1.
  const o1On = bandPower(a.data[a.eng.indexOf('O1')], 2.5, 3.5);
  const o1Off = bandPower(aBase.data[aBase.eng.indexOf('O1')], 2.5, 3.5);
  check('absence 3 Hz contrib Fz / O1 (frontal-max)',
    (fzOn - fzOff) / Math.max(o1On - o1Off, 1e-6), 1.2, 1e6);
}

console.log('\nGTC (clonic discharge -> post-ictal suppression):');
{
  const gt = runEngineState(60, SLEEP_OPTS, 'awake', ['gtc-ictal']);
  // Clonic discharge (clock ~10-17 s) is high-amplitude; post-ictal suppression
  // (clock ~43-49 s, gate at 0.08) is near-flat. The contrast IS the seizure.
  const clonic = pctP2p(win(gt, 'Fz', 10, 17));
  const suppressed = pctP2p(win(gt, 'Fz', 43, 49));
  check('Fz clonic p2p, gtc (high-amplitude discharge)', clonic, 120, 900, ' uV');
  check('Fz post-ictal p2p / clonic p2p (suppression)', suppressed / clonic, 0, 0.4);
}

console.log('\nFocal temporal (left onset, late contralateral spread):');
{
  const ft = runEngineState(40, SLEEP_OPTS, 'awake', ['focal-temporal-ictal']);
  // Active window is clock ~5-35 s. Early (clock 8-12 s): onset side only. Late
  // (clock 28-33 s): contralateral spread has ramped in.
  const t3Early = winPower(win(ft, 'T3', 8, 12), 3.5, 6);
  const t4Early = winPower(win(ft, 'T4', 8, 12), 3.5, 6);
  const t4Late = winPower(win(ft, 'T4', 28, 33), 3.5, 6);
  check('T3 / T4 theta, focal-temporal early (onset lateralised)',
    t3Early / Math.max(t4Early, 1e-6), 2, 1e6);
  check('T4 theta late / early (contralateral spread appears)',
    t4Late / Math.max(t4Early, 1e-6), 2, 1e6);

  // Phase reversal: T3 is a single RADIAL (same-sign) source — no orientation
  // override in its sourceUnder() call — so its field doesn't stop at T3, it
  // ripples outward with smoothly falling amplitude into the AP-chain
  // neighbours F7 (anterior) and T5 (posterior), both carrying the SAME
  // seizure waveform, just attenuated. A bipolar chain crossing T3 (F7-T3,
  // T3-T5) subtracts the shared T3 electrode from each derivation, so the two
  // channels flanking T3 deflect in OPPOSITE directions at the same instant
  // even though the underlying pattern is identical — the textbook "similar
  // pattern on both sides of the reversal" a resident uses to localise a
  // focus on a bipolar montage, not two independent generators. This must
  // fall out of the shared radial leadfield automatically; nothing in the
  // source model encodes flanking channels directly.
  const mid = (name: string) => win(ft, name, 15, 25);
  const t3Mid = mid('T3'), f7Mid = mid('F7'), t5Mid = mid('T5');
  // IK-003's referential clause, read on the common average (reference-car) since
  // 2026-09-22. It was read on raw potentials, i.e. against infinity, where a spurious
  // same-sign far field (the monopole forward.ts now removes) lifted F7 and T5 to 0.10 and
  // 0.07 of T3's power. No montage ever showed that: on reference-car the page had F7 ~0.04
  // and T5 ~0.02 all along. IK-003 is marked violated for this clause.
  const carMid = (name: string) => winCar(ft, name, 15, 25);
  const t3Car = carMid('T3'), f7Car = carMid('F7'), t5Car = carMid('T5');
  check('referential corr T3-F7 (shared source, same polarity)', corr(t3Car, f7Car), 0.6, 1.0);
  check('referential corr T3-T5 (shared source, same polarity)', corr(t3Car, t5Car), 0.6, 1.0);
  check('F7 theta / T3 theta (ripples out, but attenuated)',
    bandPower(f7Car, 3.5, 6) / bandPower(t3Car, 3.5, 6), 0.05, 0.9);
  check('T5 theta / T3 theta (ripples out, but attenuated)',
    bandPower(t5Car, 3.5, 6) / bandPower(t3Car, 3.5, 6), 0.05, 0.9);
  const sub = (a: Float64Array, b: Float64Array) => a.map((v, i) => v - b[i]);
  const chAbove = sub(f7Mid, t3Mid); // bipolar F7-T3
  const chBelow = sub(t3Mid, t5Mid); // bipolar T3-T5
  check('bipolar F7-T3 vs T3-T5 correlation (phase reversal)', corr(chAbove, chBelow), -1.0, -0.4);

  // A reversal seen once localises nothing — normal variants and chance
  // cancellations produce them too. What a reader trusts is a reversal that
  // holds at ONE electrode for the whole discharge. Asserted two ways over
  // consecutive 2 s windows across the sustained event: the T3 reversal never
  // lapses, and it never migrates to the electrode above it (Fp1-F7 vs F7-T3
  // must stay in phase throughout, i.e. no second reversal at F7).
  let worstRev = -1, worstNonRev = 1;
  for (let t = 10; t + 2 <= 34; t += 2) {
    const f7w = win(ft, 'F7', t, t + 2), t3w = win(ft, 'T3', t, t + 2);
    const t5w = win(ft, 'T5', t, t + 2), fp1w = win(ft, 'Fp1', t, t + 2);
    worstRev = Math.max(worstRev, corr(sub(f7w, t3w), sub(t3w, t5w)));
    worstNonRev = Math.min(worstNonRev, corr(sub(fp1w, f7w), sub(f7w, t3w)));
  }
  check('worst 2 s window, F7-T3 vs T3-T5 (reversal never lapses)', worstRev, -1.0, -0.4);
  check('worst 2 s window, Fp1-F7 vs F7-T3 (reversal never migrates)', worstNonRev, 0.4, 1.0);
}

console.log('\nFocal temporal (RIGHT onset — same localisation signatures mirrored):');
{
  // Identical assertions to the left-onset block above, with the hemisphere
  // switch thrown. Localisation is a property of the leadfield, not of a
  // hand-written left-sided special case, so flipping the onset side must
  // reproduce every signature on the mirror-image chain (F8-T4-T6) — nothing
  // in the model is allowed to be left-specific.
  const ft = runEngineState(40, SLEEP_OPTS, 'awake', ['focal-temporal-ictal'],
    { 'focal-temporal-ictal': { hemisphere: 'right' } });
  const t4Early = winPower(win(ft, 'T4', 8, 12), 3.5, 6);
  const t3Early = winPower(win(ft, 'T3', 8, 12), 3.5, 6);
  const t3Late = winPower(win(ft, 'T3', 28, 33), 3.5, 6);
  check('T4 / T3 theta, focal-temporal early (onset lateralised right)',
    t4Early / Math.max(t3Early, 1e-6), 2, 1e6);
  check('T3 theta late / early (contralateral spread appears)',
    t3Late / Math.max(t3Early, 1e-6), 2, 1e6);

  const mid = (name: string) => win(ft, name, 15, 25);
  const t4Mid = mid('T4'), f8Mid = mid('F8'), t6Mid = mid('T6');
  // Common average, as in the left-onset block (IK-003, 2026-09-22).
  const carMid = (name: string) => winCar(ft, name, 15, 25);
  const t4Car = carMid('T4'), f8Car = carMid('F8'), t6Car = carMid('T6');
  check('referential corr T4-F8 (shared source, same polarity)', corr(t4Car, f8Car), 0.6, 1.0);
  check('referential corr T4-T6 (shared source, same polarity)', corr(t4Car, t6Car), 0.6, 1.0);
  check('F8 theta / T4 theta (ripples out, but attenuated)',
    bandPower(f8Car, 3.5, 6) / bandPower(t4Car, 3.5, 6), 0.05, 0.9);
  check('T6 theta / T4 theta (ripples out, but attenuated)',
    bandPower(t6Car, 3.5, 6) / bandPower(t4Car, 3.5, 6), 0.05, 0.9);
  const sub = (a: Float64Array, b: Float64Array) => a.map((v, i) => v - b[i]);
  check('bipolar F8-T4 vs T4-T6 correlation (phase reversal)',
    corr(sub(f8Mid, t4Mid), sub(t4Mid, t6Mid)), -1.0, -0.4);
}

console.log('\nIctal frequency knob (scales the sweep, preserves the evolution):');
{
  // focal-temporal sweeps 6 -> 3.5 Hz by default, so at 2x it sweeps 12 -> 7 Hz.
  // Asserted as a band SWAP rather than an absolute peak: the point of scaling
  // both endpoints is that the discharge moves band without losing its shape.
  const at1 = runEngineState(40, SLEEP_OPTS, 'awake', ['focal-temporal-ictal'],
    { 'focal-temporal-ictal': { frequency: 1 } });
  const at2 = runEngineState(40, SLEEP_OPTS, 'awake', ['focal-temporal-ictal'],
    { 'focal-temporal-ictal': { frequency: 2 } });
  const t3 = (r: typeof at1) => win(r, 'T3', 15, 25);
  const lo1 = bandPower(t3(at1), 3.5, 6), hi1 = bandPower(t3(at1), 7, 12);
  const lo2 = bandPower(t3(at2), 3.5, 6), hi2 = bandPower(t3(at2), 7, 12);
  check('T3 low/high band ratio at 1x (discharge sits in theta)', lo1 / hi1, 1.5, 1e6);
  check('T3 high/low band ratio at 2x (discharge moved to alpha)', hi2 / lo2, 1.5, 1e6);
  // The knob is frequency-only: it must not double as a volume control.
  const p1 = pctP2p(t3(at1)), p2 = pctP2p(t3(at2));
  check('T3 p2p at 2x / at 1x (frequency knob does not change amplitude)', p2 / p1, 0.6, 1.6);
}

console.log('\nLocalisation: source BETWEEN two electrodes (phase cancellation):');
{
  // The second localising signature. The blocks above cover a source whose peak
  // sits UNDER an electrode (T3/T4) — the flanking bipolar channels invert
  // against each other and the reversal names the peak electrode. The other case
  // a resident must read is a source sitting BETWEEN two electrodes: both see
  // nearly the same voltage, so the link spanning them subtracts to ~nothing
  // ("isoelectric"), and the localisation is instead read off the two flanking
  // links deflecting in OPPOSITE directions with the null between them.
  //
  // No toggle currently produces this geometry — every ictal source is anchored
  // under a single electrode — so this is asserted directly against the forward
  // model that all of them share, using a synthetic spec placed equidistant from
  // F8 and T4 (see midwaySource). It is a claim about the leadfield, not about any
  // one pattern.
  const spec = midwaySource('synthetic-fronto-temporal', 'F8', 'T4', 0.35);
  const names = ['Fp2', 'F8', 'T4', 'T6', 'O2'];
  const lf = buildLeadfield([spec], names);
  const g = (n: string) => lf.gainAt(names.indexOf(n), 0);
  // Bipolar chain derivations down the right temporal chain.
  const d1 = g('Fp2') - g('F8');
  const d2 = g('F8') - g('T4');
  const d3 = g('T4') - g('T6');
  const d4 = g('T6') - g('O2');
  check('F8-T4 near-null relative to flanking Fp2-F8/T4-T6',
    Math.abs(d2) / Math.max(Math.abs(d1), Math.abs(d3)), 0, 0.1);
  check('Fp2-F8 and T4-T6 deflect in opposite directions (isoelectric point between)',
    Math.sign(d1) * Math.sign(d3), -1, -1);
  check('T6-O2 continues in the T4-T6 direction', Math.sign(d3) * Math.sign(d4), 1, 1);
  check('T6-O2 magnitude smaller than T4-T6 (decaying ripple)',
    Math.abs(d4) / Math.abs(d3), 0, 0.5);
}

console.log('\nFocal frontal (left onset, low-voltage-fast evolving down):');
{
  const ff = runEngineState(30, SLEEP_OPTS, 'awake', ['focal-frontal-ictal']);
  // Active window is clock ~5-20 s. Onset is fast (beta) and evolves DOWN toward
  // delta, so early carries more beta than late; onset is left-frontal (F3>F4).
  const f3BetaEarly = winPower(win(ff, 'F3', 7, 11), 14, 20);
  const f3BetaLate = winPower(win(ff, 'F3', 16, 19), 14, 20);
  const f4BetaEarly = winPower(win(ff, 'F4', 7, 11), 14, 20);
  check('F3 / F4 beta, focal-frontal early (onset lateralised)',
    f3BetaEarly / Math.max(f4BetaEarly, 1e-6), 1.5, 1e6);
  check('F3 beta early / late (frequency evolves down)',
    f3BetaEarly / Math.max(f3BetaLate, 1e-6), 1.3, 1e6);
}

console.log('\n=== Step 17: activation procedures (pattern sources) ===\n');

// Both activation sources are scripted procedures whose clock starts when the
// toggle is switched on, so every window below is measured from t = 0 of a run
// that has the toggle on from the first sample. The photic series steps every
// 9 s (6 s train + 3 s rest) through 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 25,
// 30 Hz — so step i occupies [9i, 9i+6) of flashing followed by [9i+6, 9i+9) of
// rest. The windows are trimmed by ~1 s at each end to clear the train's ramp.
console.log('Photic driving (occipital, flash-locked, frequency-tuned):');
{
  const p = runEngineState(120, SLEEP_OPTS, 'awake', ['photic']);
  // Step 7 = 14 Hz, flashing 63-69 s. Sits above the alpha band, so a rise here
  // cannot be the posterior rhythm.
  const on14 = (name: string) => winPower(win(p, name, 64, 68.5), 13, 15);
  const off14 = (name: string) => winPower(win(base, name, 64, 68.5), 13, 15);
  check('O1 13-15 Hz during 14 Hz train, on / off', on14('O1') / off14('O1'), 3, 1e6);
  // Occipital: the driving response is a posterior finding, not a generalised one.
  check('O1 / Cz 13-15 Hz during 14 Hz train (occipital)', on14('O1') / on14('Cz'), 1.5, 1e6);
  // Symmetric: a persistently lateralised driving response is the abnormality,
  // so the two occipital electrodes must be within a factor of ~1.4 of each other.
  check('O1 / O2 driving power (symmetry)', on14('O1') / on14('O2'), 0.7, 1.4);
  // Flash-locked: at the 18 Hz step (81-87 s) the response moves with the lamp.
  const o1at18 = winPower(win(p, 'O1', 82, 86.5), 17, 19);
  const o1at18Low = winPower(win(p, 'O1', 82, 86.5), 13, 15);
  check('O1 17-19 / 13-15 Hz during 18 Hz train (tracks flash rate)',
    o1at18 / o1at18Low, 1.5, 1e6);
  // Intermittent: the rest gap after the 14 Hz train (69-72 s) is quiet again.
  check('O1 13-15 Hz in the rest gap, on / off',
    winPower(win(p, 'O1', 69.5, 71.8), 13, 15) / winPower(win(base, 'O1', 69.5, 71.8), 13, 15),
    0.5, 1.6);
  // Frequency-tuned: a normal subject shows little or no driving at 2 Hz
  // (step 1, 9-15 s), where the delta background dwarfs anything the lamp adds.
  check('O1 1.5-2.5 Hz during 2 Hz train, on / off',
    winPower(win(p, 'O1', 10, 14.5), 1.5, 2.5) / winPower(win(base, 'O1', 10, 14.5), 1.5, 2.5),
    0.5, 1.6);
}

console.log('\nHyperventilation build-up (generalised slowing, builds then resolves):');
{
  // 180 s of overbreathing, 60 s of recovery, 30 s of rest before it repeats.
  const h = runEngineState(270, SLEEP_OPTS, 'awake', ['hyperventilation']);
  // `base` is only 180 s long and the recovery windows run past that, so this
  // block needs its own same-seed, same-length control run.
  const hBase = runEngineState(270, SLEEP_OPTS, 'awake', []);
  const slow = (r: typeof base, name: string, t0: number, t1: number) =>
    bandPower(win(r, name, t0, t1), 2, 7);
  // (1) It BUILDS: the last minute of the procedure carries far more slowing
  // than the first, which is what distinguishes a build-up from a source that
  // simply switches on.
  const early = slow(h, 'Fz', 10, 60);
  const late = slow(h, 'Fz', 120, 180);
  check('Fz 2-7 Hz late / early in the procedure (build-up)', late / early, 2, 1e6);
  // (2) It RESOLVES: a minute after stopping, the background is back to baseline.
  check('Fz 2-7 Hz after recovery, on / off',
    slow(h, 'Fz', 245, 270) / slow(hBase, 'Fz', 245, 270), 0.6, 1.5);
  // (3) FRONTAL predominance in adults: larger at Fz than occipitally.
  check('Fz / O1 2-7 Hz at full build-up (frontal)',
    late / slow(h, 'O1', 120, 180), 1.2, 1e6);
  // (4) Theta FIRST, delta as it deepens: the delta-to-theta balance shifts
  // through the procedure rather than staying fixed. Measured on the source's
  // OWN contribution (on minus off, same seed) — the raw ratio is useless here
  // because a 1/f background already carries more 1.5-3.5 Hz power than
  // 4.5-6.5 Hz, which swamps the effect at the shallow end of the build-up.
  // Compared mid-procedure against full build-up rather than from the first
  // seconds, where the contribution is too small to divide by safely.
  const dtRatio = (t0: number, t1: number) => {
    const c = (lo: number, hi: number) =>
      bandPower(win(h, 'Fz', t0, t1), lo, hi) - bandPower(win(hBase, 'Fz', t0, t1), lo, hi);
    return c(1.5, 3.5) / c(4.5, 6.5);
  };
  check('Fz delta/theta contribution, full / mid build-up (theta first, then delta)',
    dtRatio(120, 180) / dtRatio(60, 120), 1.5, 1e6);
  // (5) The alpha rhythm is ATTENUATED, not abolished — a normal build-up does
  // not mean loss of the PDR (contrast `gen-slowing`, which takes alpha to 0.15).
  check('O1 alpha power at full build-up, on / off',
    bandPower(win(h, 'O1', 120, 180), 8, 12) / bandPower(win(hBase, 'O1', 120, 180), 8, 12),
    0.15, 0.85);
}

console.log('\n=== Step 18: contextual artifact controls (ArtifactParams) ===\n');

// Every check below isolates one artifact by DIFFERENCE against a same-seed run
// with that artifact's gate off. Generators advance whether or not they are
// gated (see `next()`), and the recording chain is linear, so the difference is
// exactly that generator's contribution — background, sensor noise and
// reference noise all cancel, with no filtering or thresholding needed to see it.
//
// `artifactBurden: 0.01` is not a realistic subject; it is a quiet one. It stops
// `sampleDefects` from handing this subject a random bad channel, which would be
// indistinguishable from a deliberately detached electrode, and it stops the
// renewal-scheduled artifacts (pop, movement) from firing on their own inside a
// window where every event seen is supposed to be one the user asked for.
{
  const ART_OPTS: EngineOptions = {
    seed: 31, subject: { artifactBurden: 0.01, lineAmp: 0, alphaRms: 12 },
  };
  const GATES_OFF: ArtifactGates = {
    blink: false, eyeOpening: false, saccade: false, emg: false, pop: false,
    sweat: false, line: false, ecgScalp: false, movement: false, defects: false,
  };

  function runArt(
    secs: number,
    gates: Partial<ArtifactGates>,
    params: Partial<ArtifactParams>,
    opts: EngineOptions = ART_OPTS,
    onSample?: (i: number, eng: EegEngine) => void,
  ) {
    const eng = new EegEngine(opts);
    eng.setArtifactGates({ ...GATES_OFF, ...gates });
    eng.setArtifactParams(params);
    const n = Math.floor(secs * FS);
    const nCh = eng.electrodes.length;
    const data: Float64Array[] = eng.electrodes.map(() => new Float64Array(n));
    const ecg = new Float64Array(n);
    const buf = new Float64Array(nCh);
    for (let i = 0; i < n; i++) {
      onSample?.(i, eng);
      eng.next(buf);
      for (let c = 0; c < nCh; c++) data[c][i] = buf[c];
      ecg[i] = eng.ecgChannelValue;
    }
    return { eng, data, ecg };
  }

  /** Per-electrode contribution of whatever `gates` enables, background removed. */
  function contribution(
    secs: number, gates: Partial<ArtifactGates>, params: Partial<ArtifactParams>,
    opts: EngineOptions = ART_OPTS,
  ) {
    const on = runArt(secs, gates, params, opts);
    const off = runArt(secs, {}, params, opts);
    const d = on.data.map((ch, c) => {
      const out = new Float64Array(ch.length);
      for (let i = 0; i < ch.length; i++) out[i] = ch[i] - off.data[c][i];
      return out;
    });
    return { eng: on.eng, d, at: (name: string) => d[on.eng.indexOf(name)] };
  }

  const slice = (x: Float64Array, t0: number, t1: number) =>
    x.subarray(Math.round(t0 * FS), Math.round(t1 * FS));

  // --- 18a. Detaching an electrode: a pop, then a dead channel until it is put
  // back on. The neighbour is the discriminating half — a detached electrode is
  // one electrode, so anything that also quietens T6 is modelling a montage row
  // rather than a lead coming off.
  console.log('Electrode detachment (pop, then flat until reattached):');
  {
    const T_OFF = 15, T_ON = 40;
    const r = runArt(60, { pop: true }, { popRatePerMin: 0.05 }, ART_OPTS, (i, eng) => {
      if (i === T_OFF * FS) eng.setArtifactParams({ detachedElectrodes: ['T4'] });
      if (i === T_ON * FS) eng.setArtifactParams({ detachedElectrodes: [] });
    });
    const t4 = r.data[r.eng.indexOf('T4')];
    const t6 = r.data[r.eng.indexOf('T6')];
    const base4 = std(slice(t4, 5, 15));
    // Absolute: a detached electrode carries only the amplifier's own noise. This was a ratio
    // to T4's raw signal before detaching (<= 0.15), and that denominator is a potential
    // against infinity: removing the forward model's spurious monopole (2026-09-22) cut it to
    // 2.65 uV RMS with the detached level unchanged at 0.56 uV. 1 uV is a guard at the
    // engine's own noise floor (chain.ts, 0.25x channel noise while flat), not a clinical figure.
    check('T4 RMS while detached (amplifier noise only)', std(slice(t4, 20, 38)), 0, 1, ' uV');
    check('T4 RMS after reattaching / before', std(slice(t4, 45, 58)) / base4, 0.6, 1.6);
    check('T6 RMS while T4 detached / before',
      std(slice(t6, 20, 38)) / std(slice(t6, 5, 15)), 0.6, 1.6);
    // The contact failing is itself an event: the pop IS the junction breaking,
    // and the channel only falls to the noise floor once it has decayed. A
    // detachment that went flat silently would teach the wrong thing to look for.
    const popWin = slice(t4, 15, 16);
    let popPeak = 0;
    for (let i = 0; i < popWin.length; i++) popPeak = Math.max(popPeak, Math.abs(popWin[i]));
    check('T4 peak in the 1 s after detaching', popPeak, 50, 3000, ' uV');
  }

  // --- 18b. A pop is one electrode, not a field. It bypasses the leadfield, so
  // the contribution at every other electrode must be identically zero — that
  // spatial discontinuity is how a reader tells a bad lead from a generator.
  console.log('\nPop targeting (one electrode, no field):');
  {
    // Burden 1 here, unlike everywhere else in this step: the pop generator draws
    // its FIRST interval in its constructor, from the subject's artifact burden,
    // so `popRatePerMin` only governs the pops after that one. At burden 0.01 the
    // first pop would be scheduled ~6000 s out and this window would be empty.
    const POP_OPTS: EngineOptions = { seed: 31, subject: { artifactBurden: 1, lineAmp: 0, alphaRms: 12 } };
    const { eng, d, at } = contribution(300, { pop: true },
      { popTarget: 'C3', popRatePerMin: 6 }, POP_OPTS);
    let worst = 0, worstName = '';
    for (let c = 0; c < d.length; c++) {
      if (eng.electrodes[c] === 'C3') continue;
      const s = std(d[c]);
      if (s > worst) { worst = s; worstName = eng.electrodes[c]; }
    }
    check('C3 pop contribution RMS (target)', std(at('C3')), 1, 500, ' uV');
    check(`largest contribution off target (${worstName})`, worst, 0, 1e-9, ' uV');
  }

  // --- 18c. Which muscle is contracting decides which channels are ruined. This
  // is the clinical content of the muscle-group selector: the same "EMG" toggle
  // has to be able to produce a temporal, a frontal or a posterior record.
  console.log('\nMuscle territories (which muscle decides which channels):');
  {
    const hb = (x: Float64Array) => bandPower(x, 20, 70);
    const nuchal = contribution(120, { emg: true }, { emgRegions: ['nuchal'] });
    // Posterior neck muscle sits over the occipital electrodes, where it buries
    // the posterior rhythm — the reason it is worth having as its own territory.
    // On the common average, as a referential page shows it (2026-09-22). On raw potentials
    // the nuchal source's diffuse return field, now modelled (forward.ts surfaceMean), sits
    // at Fz with the opposite sign and made the ratio meaningless against infinity.
    const carAt = (r: typeof nuchal, name: string) => {
      const idx = ALL_ELECTRODES.map((e) => r.eng.indexOf(e)).filter((i) => i >= 0);
      const x = r.at(name);
      return x.map((v, i) => v - idx.reduce((a, k) => a + r.d[k][i], 0) / idx.length);
    };
    check('nuchal EMG: O1 / Fz 20-70 Hz power', hb(carAt(nuchal, 'O1')) / hb(carAt(nuchal, 'Fz')), 2, 1e9);
    const frontalis = contribution(120, { emg: true }, { emgRegions: ['frontalis'] });
    check('frontalis EMG: Fp1 / O1 20-70 Hz power',
      hb(frontalis.at('Fp1')) / hb(frontalis.at('O1')), 2, 1e9);
    // Temporalis can be one-sided — clenching on the left must not fill T4.
    const left = contribution(120, { emg: true }, { emgRegions: ['temporalisL'] });
    check('left temporalis only: T3 / T4 RMS', std(left.at('T3')) / std(left.at('T4')), 2, 1e9);
    // Severity is a linear amplitude scale, so doubling it doubles the RMS.
    const sev2 = contribution(120, { emg: true }, { emgRegions: ['temporalisL'], emgSeverity: 2 });
    check('T3 EMG RMS, severity 2 / severity 1',
      std(sev2.at('T3')) / std(left.at('T3')), 1.9, 2.1);
    // Deselecting every region leaves the toggle on with nothing contracting.
    const none = contribution(60, { emg: true }, { emgRegions: [] });
    check('T3 EMG RMS, no muscle selected', std(none.at('T3')), 0, 1e-9, ' uV');
  }

  // --- 18d. Mains: 50 Hz or 60 Hz depending on where the record was made, and an
  // amplitude the user controls. The amplitude control is what makes the toggle
  // mean anything: this subject's own sampled `lineAmp` is 0, and `sampleSubject`
  // draws 0 for about half of all subjects, so without it the toggle is a no-op.
  console.log('\nMains interference (50/60 Hz, amplitude):');
  {
    for (const f of [50, 60] as const) {
      const r = runArt(60, { line: true }, { lineFreq: f, lineAmpUv: 6 });
      const psd = welch(r.data[r.eng.indexOf('Cz')], FS, 2048);
      check(`mains peak, set to ${f} Hz`, spectralPeak(psd, 35, 75).freq, f - 1, f + 1, ' Hz');
    }
    // Measured as PROMINENCE — 48-52 Hz against the neighbouring 38-42 Hz — not
    // as a before/after ratio of the 50 Hz band alone. A 4 Hz-wide band is much
    // wider than the mains line, so most of what it contains is background: the
    // raw before/after ratio comes out at only ~22 even though the line itself
    // rises 140-fold, which would make a threshold there read as far weaker
    // evidence than it is.
    const prominence = (amp: number) => {
      const r = runArt(60, { line: true }, { lineFreq: 50, lineAmpUv: amp });
      const cz = r.data[r.eng.indexOf('Cz')];
      return bandPower(cz, 48, 52) / bandPower(cz, 38, 42);
    };
    check('Cz 50 Hz prominence, mains amplitude 0 uV', prominence(0), 0.5, 1.5);
    check('Cz 50 Hz prominence, mains amplitude 6 uV', prominence(6), 8, 1e9);
  }

  // --- 18e. Cardiac: the rate control, and the property the pattern description
  // tells the learner to use — every scalp transient lines up with an R wave on
  // the ECG trace. That only holds because both now read one heart; two
  // independently seeded generators would score ~1 on the alignment check.
  console.log('\nCardiac (rate control, scalp artifact aligned with the ECG trace):');
  {
    const on = runArt(60, { ecgScalp: true }, { ecgBpm: 120 });
    const off = runArt(60, {}, { ecgBpm: 120 });
    const iT3 = on.eng.indexOf('T3');
    const n = on.ecg.length;
    const scalp = new Float64Array(n);
    for (let i = 0; i < n; i++) scalp[i] = on.data[iT3][i] - off.data[iT3][i];

    // R peaks on the display channel: local maxima above 60 % of the record
    // maximum, with a 250 ms refractory so one QRS is counted once.
    let mx = 0;
    for (let i = 0; i < n; i++) mx = Math.max(mx, on.ecg[i]);
    const rPeaks: number[] = [];
    const refractory = Math.round(0.25 * FS);
    for (let i = 1; i < n - 1; i++) {
      if (on.ecg[i] < 0.6 * mx) continue;
      if (on.ecg[i] < on.ecg[i - 1] || on.ecg[i] < on.ecg[i + 1]) continue;
      if (rPeaks.length > 0 && i - rPeaks[rPeaks.length - 1] < refractory) continue;
      rPeaks.push(i);
    }
    check('R-R interval, ecgBpm set to 120',
      (rPeaks[rPeaks.length - 1] - rPeaks[0]) / Math.max(rPeaks.length - 1, 1) / FS,
      0.47, 0.53, ' s');

    const guard = Math.round(0.04 * FS);
    let hit = 0;
    for (const k of rPeaks) {
      let local = 0;
      for (let j = Math.max(0, k - guard); j <= Math.min(n - 1, k + guard); j++) {
        local = Math.max(local, Math.abs(scalp[j]));
      }
      hit += local;
    }
    hit /= Math.max(rPeaks.length, 1);
    check('scalp T3 peak at the R wave / its own RMS', hit / std(scalp), 2.5, 1e6);
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== Step 19: sleep grapho-elements in DISPLAY space (A3 audit) ===\n');

// Step 11 above asserts these same claims on raw electrodes. Repeated here on
// the montage-derived, negative-up channel (CLAUDE.md §4) because that space can
// disagree with the raw one even when every spectral check passes — e.g. a
// channel that sits near the common-average reference's own mean gain nearly
// cancels in reference-car while still carrying real signal (see K-complex/Pz,
// IK-A3-b): a spectral check on the raw electrode cannot see that.

console.log('Spindles (11-16 Hz, central-maximal), reference-car:');
{
  const diff = displayContrib('reference-car', 'awake', 'spindles', 'Cz-AVG', 180, 20);
  const pk = spectralPeak(welch(diff, FS, 2048), 6, 25);
  check('spindle peak frequency, Cz-AVG', pk.freq, 11, 16, ' Hz');
  // 'spindle Cz-AVG p2p / O1-AVG p2p' (>= 3) moved to the ear reference 2026-09-11. With the
  // spindle now a regional field (Cz with both central and parietal regions, or frontal) rather
  // than a Cz point, the common average — the mean of 19 electrodes — contains a large share of
  // the spindle itself. Subtracting it shrinks Cz-AVG and hands O1-AVG the negated mean, so O1
  // appears to carry a spindle it does not have: 2.79, against 14.6 for the old point source.
  // The common average is the wrong reference for amplitude topography (read skill); A1 is not.
  const czA = pctP2p(displayContrib('reference-ipsi', 'awake', 'spindles', 'Cz-A1', 180, 20));
  const o1A = pctP2p(displayContrib('reference-ipsi', 'awake', 'spindles', 'O1-A1', 180, 20));
  check('spindle Cz-A1 p2p / O1-A1 p2p (central, not occipital)', czA / Math.max(o1A, 1e-6), 3, 1e6);
}

console.log('\nK-complex (sharp UP, then slower smaller DOWN), Cz-AVG reference-car:');
{
  const diff = displayContrib('reference-car', 'awake', 'k-complex', 'Cz-AVG', 120, 20);
  let peak = 0, peakAt = 0;
  for (let k = 0; k < diff.length; k++) if (Math.abs(diff[k]) > Math.abs(peak)) { peak = diff[k]; peakAt = k; }
  check('K-complex sharp component renders UP (surface-negative)', peak, -Infinity, 0, ' uV');
  let slow = 0;
  const end = Math.min(diff.length, peakAt + Math.round(1.0 * FS));
  for (let k = peakAt; k < end; k++) if (diff[k] > slow) slow = diff[k];
  check('K-complex after-going wave renders DOWN, smaller than the sharp peak',
    slow / Math.abs(peak), 0.2, 0.9);
}

console.log('\nV-wave: sharp, phase-reverses across Cz (IK-008), bipolar-ap:');
{
  const fzCz = displayContrib('bipolar-ap', 'awake', 'v-waves', 'Fz-Cz', 120, 20);
  const czPz = displayContrib('bipolar-ap', 'awake', 'v-waves', 'Cz-Pz', 120, 20);
  let fzCzPeak = 0, czPzPeak = 0;
  for (const v of fzCz) if (Math.abs(v) > Math.abs(fzCzPeak)) fzCzPeak = v;
  for (const v of czPz) if (Math.abs(v) > Math.abs(czPzPeak)) czPzPeak = v;
  check('V-wave: Fz-Cz and Cz-Pz peaks have opposite sign (phase reversal at Cz)',
    Math.sign(fzCzPeak) * Math.sign(czPzPeak), -1, -1);
}

console.log('\nPOSTS: surface-positive; polarity is montage-dependent (§4/IK-008):');
{
  const o1Car = displayContrib('reference-car', 'awake', 'posts', 'O1-AVG', 120, 20);
  let carPeak = 0;
  for (const v of o1Car) if (Math.abs(v) > Math.abs(carPeak)) carPeak = v;
  check('POSTS render DOWN at O1-AVG, reference-car (surface-positive)', carPeak, 0, Infinity, ' uV');

  const t5O1 = displayContrib('bipolar-ap', 'awake', 'posts', 'T5-O1', 120, 20);
  let bipPeak = 0;
  for (const v of t5O1) if (Math.abs(v) > Math.abs(bipPeak)) bipPeak = v;
  check('POSTS polarity inverts at T5-O1, bipolar-ap (O1 is input2)', bipPeak, -Infinity, 0, ' uV');
}

console.log('\nN3: high-amplitude (>75 uV) generalized delta (0.5-2 Hz), ear-referenced:');
{
  // Moved from the common average to the ear reference 2026-09-11. Slow-wave sleep is
  // "synchronized" delta (learningeeg): a large part of it is common to every electrode, and a
  // common average removes exactly that part. The old model passed here only through a vertex
  // focus whose leakage into the average lifted every site — Cz-AVG 450 uV beside C3-AVG 97
  // on the same page; with synchronized, diffuse slow waves Pz-AVG read 70. The ear-referenced
  // channel keeps the synchronized part, as a clinical referential montage does.
  const ear = runDisplay('reference-ipsi', 'n3', [], 180, 42);
  // A spread of frontal/central/temporal/occipital/midline channels stands in
  // for "generalized" without asserting all 19.
  // The >75 uV criterion is the AASM's, and the AASM measures it over the FRONTAL regions,
  // referenced to the contralateral ear or mastoid. Until 2026-09-22 it was applied at every
  // site, citing "IK-A3-e", which names no entry; the posterior sites sat on the bound and
  // failed (Pz 71 uV) when the aperiodic floor was halved. "Generalized" — learningeeg's
  // "diffuse, synchronized, high amplitude delta" — is asserted at the other sites as delta
  // dominance instead: 0.5-2 Hz carries at least half of the 0.5-30 Hz power. That is a claim
  // of kind, and it has no microvolt figure because the sources give none.
  const frontal = ['Fp1-A1', 'Fz-A1'];
  const reps = [...frontal, 'C3-A1', 'Cz-A1', 'T5-A1', 'O1-A1', 'Pz-A1'];
  for (const label of reps) {
    const ci = ear.montage.channels.findIndex((c) => c.label === label);
    if (!frontal.includes(label)) {
      const x = ear.data[ci];
      const share = bandPower(x, 0.5, 2) / bandPower(x, 0.5, 30);
      check(`N3 ${label} 0.5-2 Hz share of 0.5-30 Hz power (generalized delta, learningeeg)`, share, 0.5, 1);
      continue;
    }
    check(`N3 ${label} p2p (AASM: >75 uV, frontal, ear-referenced)`, pctP2p(ear.data[ci]), 75, 500, ' uV');
  }
  const { montage, data } = runDisplay('reference-car', 'n3', [], 180, 42);
  const czIdx = montage.channels.findIndex((c) => c.label === 'Cz-AVG');
  const pk = spectralPeak(welch(data[czIdx], FS, 2048), 0.3, 4);
  check('N3 Cz-AVG dominant frequency', pk.freq, 0.5, 2, ' Hz');
}

// --- The descent into sleep ATTENUATES before it builds. The reference course
// describes N1 as "gradual loss of the PDR with coinciding diffuse attenuation
// of the tracing" — drowsiness and N1 are quiet states, the record getting
// smaller as alpha drops out. Only N3 is a high-amplitude state, and it is
// delta that makes it so ("high amplitude (>75 uV), synchronized delta activity,
// usually 0.5-2 Hz").
//
// Measured on a transient-robust statistic (inter-quartile range) rather than
// RMS or peak-to-peak, because N1 and N2 carry discrete high-amplitude events —
// POSTS, vertex waves, K-complexes — that legitimately belong there and would
// mask the background they ride on. The claim is about the BACKGROUND; the
// transients are asserted separately above.
//
// STATE_GAINS previously ran background 1.00 -> 1.10 -> 1.20 -> 1.35 -> 1.60,
// making every step louder than the last and taking display-space row RMS from
// 8.3 uV awake to 15.7 in N1 — the tracing nearly doubling through the one
// transition the course calls an attenuation.
console.log('\nSleep-state amplitude envelope (display space, bipolar-ap):');
{
  const bgIqr = (state: PatientState) => {
    const { montage, data } = runDisplay('bipolar-ap', state, [], 120, 5);
    // Centro-posterior rows only, deliberately. The frontopolar rows carry the
    // slow roving eye movements that drowsiness and N1 bring with them (see the
    // block below), which are an ocular phenomenon riding ON the background, not
    // the background itself — averaging them in measured drowsy as 1.20x awake
    // when its cerebral background had in fact fallen to 0.91x. These rows are
    // also where the loss of the PDR is most legible.
    const rows = ['C3-P3', 'P3-O1', 'C4-P4', 'P4-O2'];
    const each = rows.map((label) => {
      const x = Array.from(data[montage.channels.findIndex((c) => c.label === label)]).sort((a, b) => a - b);
      return x[Math.floor(0.75 * x.length)] - x[Math.floor(0.25 * x.length)];
    });
    return each.reduce((a, b) => a + b, 0) / each.length;
  };
  const awake = bgIqr('awake'), drowsy = bgIqr('drowsy');
  const n1 = bgIqr('n1'), n2 = bgIqr('n2'), n3 = bgIqr('n3');
  check('drowsy background / awake (drowsiness attenuates, not amplifies)', drowsy / awake, 0.6, 1.0);
  check('N1 background / awake (diffuse attenuation of the tracing)', n1 / awake, 0.5, 1.0);
  check('N1 background / drowsy (N1 is the quietest state, not louder)', n1 / drowsy, 0.5, 1.05);
  check('N3 background / N2 (N3 clearly exceeds N2)', n3 / n2, 2.0, 8.0);
  // N3 is the one state that is genuinely high-amplitude, and by a wide margin — asserted
  // where AASM scores slow waves: frontal, referential (F4-M1 / F3-M2; the ear stands in for
  // the mastoid here). Until 2026-09-14 this was measured on the centro-posterior BIPOLAR
  // rows above. Slow waves are synchronized, so neighbouring electrodes carry much the same
  // delta and a bipolar link between them cancels most of it: once N3's delta stopped being
  // a vertex focus (SLEEP-ARCHITECTURE-AUDIT.md) that ratio read 2.35 on a record whose
  // frontal slow-wave activity meets AASM's N3 criterion with room to spare.
  const frontalIqr = (state: PatientState) => {
    const { montage, data } = runDisplay('reference-ipsi', state, [], 120, 5);
    const each = ['F3-A1', 'F4-A2'].map((label) => {
      const x = Array.from(data[montage.channels.findIndex((c) => c.label === label)]).sort((a, b) => a - b);
      return x[Math.floor(0.75 * x.length)] - x[Math.floor(0.25 * x.length)];
    });
    return (each[0] + each[1]) / 2;
  };
  check('N3 background / N1, frontal ear-referenced (AASM derivation)', frontalIqr('n3') / frontalIqr('n1'), 3.0, 12.0);
}

// --- Slow roving eye movements, the ocular marker of drowsiness and N1. The
// reference course names them in both the awake chapter ("decreased eye blinks
// and roving eye movements ... very slow opposing undulations of the bilateral
// frontal regions") and the sleep chapter ("slow roving eye movements"). The
// simulator had no source for them at all until 2026-08-28.
//
// Three things make them what they are, and each is asserted: they OPPOSE across
// the midline (a horizontal corneo-retinal dipole is positive at one lateral
// frontal electrode and negative at the other), they are VERY SLOW, and they
// belong to the state rather than to a toggle.
console.log('\nSlow roving eye movements (display space, bipolar-ap):');
{
  const L = displayContrib('bipolar-ap', 'awake', 'roving-eyes', 'Fp1-F7', 180, 11);
  const R = displayContrib('bipolar-ap', 'awake', 'roving-eyes', 'Fp2-F8', 180, 11);
  // Bound just past -1 for the same floating-point reason as the IK-003 pairs.
  check('roving-eyes: Fp1-F7 vs Fp2-F8 correlation (opposing across the midline)',
    corr(L, R), -1.0001, -0.5);
  // Slower than anything cerebral, and slower than a saccade or a REM movement.
  check('roving-eyes peak frequency (very slow roving, not a saccade)',
    spectralPeak(welch(L, FS, 8192), 0.05, 3).freq, 0.12, 0.6, ' Hz');
  // State-intrinsic: drowsiness produces them with no toggle set.
  const p2pOf = (state: PatientState) => {
    const { montage, data } = runDisplay('bipolar-ap', state, [], 180, 11);
    return pctP2p(data[montage.channels.findIndex((c) => c.label === 'Fp1-F7')]);
  };
  check('roving-eyes appear in drowsy with no toggle (state-intrinsic), vs awake',
    p2pOf('drowsy') / p2pOf('awake'), 1.8, 20);
}

// --- REM. The reference course gives it a background that deliberately does NOT
// identify it — "diffuse attenuation of amplitudes, with a range of frequencies
// amongst the background", i.e. a low-voltage mixed-frequency record that looks
// like N1 — and two features that do: rapid eye movements, "sharply contoured,
// opposing left and right frontal waveforms" with "a faster upslope than
// downslope", and muscle tone that "should be near-absent throughout this
// stage". All three are asserted.
console.log('\nREM sleep (display space, bipolar-ap):');
{
  const bgIqr = (state: PatientState) => {
    const { montage, data } = runDisplay('bipolar-ap', state, [], 180, 11);
    const each = ['C3-P3', 'P3-O1', 'C4-P4', 'P4-O2'].map((label) => {
      const x = Array.from(data[montage.channels.findIndex((c) => c.label === label)]).sort((a, b) => a - b);
      return x[Math.floor(0.75 * x.length)] - x[Math.floor(0.25 * x.length)];
    });
    return each.reduce((a, b) => a + b, 0) / each.length;
  };
  // Attenuated like N1, and clearly below wakefulness — the "paradoxical" part
  // is that this says nothing on its own, which is why the two checks after it
  // are the ones that actually identify the stage.
  check('REM background / awake (diffuse attenuation)', bgIqr('rem') / bgIqr('awake'), 0.4, 1.0);

  const L = displayContrib('bipolar-ap', 'awake', 'rem-eyes', 'Fp1-F7', 180, 11);
  const R = displayContrib('bipolar-ap', 'awake', 'rem-eyes', 'Fp2-F8', 180, 11);
  check('rem-eyes: Fp1-F7 vs Fp2-F8 correlation (opposing across the midline)',
    corr(L, R), -1.0001, -0.5);
  // "Faster upslope than downslope", measured on the largest excursion: time
  // from 10% of peak up to the peak, against peak back down to 10%.
  let pi = 0;
  for (let i = 0; i < L.length; i++) if (Math.abs(L[i]) > Math.abs(L[pi])) pi = i;
  const pk = L[pi], thr = 0.1 * Math.abs(pk);
  let a = pi; while (a > 0 && Math.abs(L[a]) > thr && Math.sign(L[a]) === Math.sign(pk)) a--;
  let b = pi; while (b < L.length - 1 && Math.abs(L[b]) > thr && Math.sign(L[b]) === Math.sign(pk)) b++;
  check('rem-eyes fall / rise duration (faster upslope than downslope)',
    (b - pi) / Math.max(pi - a, 1), 1.5, 8);

  // Atonia, measured as the MUSCLE-ATTRIBUTABLE 20-70 Hz power (same seed, emg
  // gated on minus off) rather than total high-frequency power: the aperiodic
  // background occupies that band too and would mask the effect — measured
  // against total power REM/N2 reads 0.81 while the muscle term itself is a
  // small fraction of N2's.
  const emgPower = (state: PatientState) => {
    const mk = (emg: boolean) => {
      const eng = new EegEngine({ seed: 9, subject: { artifactBurden: 1.2, alphaRms: 12, lineAmp: 0 } });
      eng.setArtifactGates({ blink: false, eyeOpening: false, saccade: false, emg,
        pop: false, sweat: false, line: false, ecgScalp: false, movement: false });
      eng.setPatientState(state);
      const n = Math.floor(120 * FS), buf = new Float64Array(eng.electrodes.length);
      const iT3 = eng.indexOf('T3'), out = new Float64Array(n);
      for (let i = 0; i < n; i++) { eng.next(buf); out[i] = buf[iT3]; }
      return out;
    };
    const on = mk(true), off = mk(false);
    const d = new Float64Array(on.length);
    for (let i = 0; i < on.length; i++) d[i] = on[i] - off[i];
    return bandPower(d, 20, 70);
  };
  check('REM muscle / N2 muscle at T3 (REM atonia: near-absent muscle)',
    emgPower('rem') / emgPower('n2'), 0, 0.25);
}

// ---------------------------------------------------------------------------
console.log('\n=== Step 19b: sleep architecture against its sources (2026-09-11 rebuild) ===\n');

// Each bound below comes from a source, not from the model (SLEEP-ARCHITECTURE-AUDIT.md):
// learningeeg Normal Asleep (LE), AASM Scoring Manual v2.0 (AASM), StatPearls NBK539805 (SP),
// Neupsy Key on POSTS (NPK), Colrain 2005 Sleep 28:255 (COL), healthy-adult spindle norms
// PMC12172134 (SPN). Everything is display space. An "isolated" trace is the same seed with the
// toggle on minus off, on the montage-derived channel: the background cancels exactly, so a
// transient's size, width and field are read without the background's help or interference.
// Before the rebuild, none of this was asserted, and every one of these would have failed:
// vertex waves and spindles were invisible off the midline, the K-complex cancelled on Fz-Cz,
// POSTS never came in trains and spread to C3-P3, and N3's delta was a vertex focus.
{
  const isolated = (montageId: string, toggle: string, secs: number, seed: number) => {
    const off = runDisplay(montageId, 'awake', [], secs, seed);
    const on = runDisplay(montageId, 'awake', [toggle], secs, seed);
    const out: Record<string, Float64Array> = {};
    on.montage.channels.forEach((c, k) => {
      const d = new Float64Array(on.data[k].length);
      for (let i = 0; i < d.length; i++) d[i] = on.data[k][i] - off.data[k][i];
      out[c.label] = d;
    });
    return out;
  };
  /** Index of the extreme (sign +1 max, -1 min, 0 |max|) of each excursion past `thr`; excursions closer than `gapS` merge. */
  const peaksPast = (x: Float64Array, thr: number, gapS: number, sign: number): number[] => {
    const val = (i: number) => (sign === 0 ? Math.abs(x[i]) : sign * x[i]);
    const gap = Math.round(gapS * FS);
    const out: number[] = [];
    let i = 0;
    while (i < x.length) {
      if (val(i) < thr) { i++; continue; }
      let best = i, last = i, j = i;
      while (j < x.length && j - last <= gap) {
        if (val(j) >= thr) { last = j; if (val(j) > val(best)) best = j; }
        j++;
      }
      out.push(best);
      i = j;
    }
    return out;
  };
  const median = (a: number[]) => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
  const peakAbs = (x: Float64Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const argAbsMax = (x: Float64Array) => { let b = 0; for (let i = 1; i < x.length; i++) if (Math.abs(x[i]) > Math.abs(x[b])) b = i; return b; };
  const power = (x: Float64Array) => x.reduce((a, v) => a + v * v, 0);
  /** Rolling max of |x| over +-40 ms: a burst envelope that spans a full 11-16 Hz cycle. */
  const envelope = (x: Float64Array) => {
    const w = Math.round(0.04 * FS), e = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) {
      let m = 0;
      for (let k = Math.max(0, i - w); k <= Math.min(x.length - 1, i + w); k++) m = Math.max(m, Math.abs(x[k]));
      e[i] = m;
    }
    return e;
  };
  const bandRms = (x: Float64Array, lo: number, hi: number) => {
    const p = welch(x, FS, 2048);
    let s = 0;
    for (let k = 0; k < p.freqs.length; k++) if (p.freqs[k] >= lo && p.freqs[k] < hi) s += p.power[k];
    return Math.sqrt(s);
  };

  console.log('POSTS (NPK: surface-positive, 20-75 uV, 80-200 ms, singly or in trains of 4-6/s; LE: on the occipital link):');
  {
    const ref = isolated('reference-ipsi', 'posts', 180, 20);
    const o1 = ref['O1-A1'];
    const pk = peaksPast(o1, 5, 0.03, +1);
    check('POSTS: transients in 180 s (singles and train elements)', pk.length, 40, 400);
    check('POSTS O1-A1 median peak (NPK: 20-75 uV)', median(pk.map(i => o1[i])), 20, 75, ' uV');
    check('POSTS O1-A1 largest peak (NPK: up to ~120 uV)', Math.max(...pk.map(i => o1[i])), 20, 120, ' uV');
    const dur = pk.map(i => {
      const t = 0.05 * o1[i]; let a = i, b = i;
      while (a > 0 && o1[a] > t) a--;
      while (b < o1.length - 1 && o1[b] > t) b++;
      return (b - a) / FS;
    });
    check('POSTS O1-A1 median duration (NPK: 80-200 ms)', median(dur), 0.08, 0.2, ' s');
    // Consecutive transients under 0.5 s apart belong to one train.
    const gaps = pk.slice(1).map((v, k) => (v - pk[k]) / FS);
    check('POSTS within-train rate (NPK: trains of 4-6 per second)', 1 / median(gaps.filter(g => g < 0.5)), 4, 6.5, ' Hz');
    let events = 1, singles = 0, size = 1;
    for (const g of gaps) {
      if (g < 0.5) { size++; continue; }
      if (size === 1) singles++;
      events++; size = 1;
    }
    if (size === 1) singles++;
    check('POSTS share of events that are single (NPK: singles as often as trains)', singles / events, 0.25, 0.75);
    const bip = isolated('bipolar-ap', 'posts', 120, 20);
    check('POSTS field C3-P3 / P3-O1 (LE: on the occipital link only)', peakAbs(bip['C3-P3']) / peakAbs(bip['P3-O1']), 0, 0.35);
    check('POSTS field T3-T5 / T5-O1 (LE: on the occipital link only)', peakAbs(bip['T3-T5']) / peakAbs(bip['T5-O1']), 0, 0.35);
    check('POSTS render UP on P3-O1, bipolar-ap (O1 positive is input 2)', Math.sign(bip['P3-O1'][argAbsMax(bip['P3-O1'])]), -1, -1);
  }

  console.log('\nVertex waves (SP: surface-negative, ~100 ms, reversing at the vertex; AASM: < 0.5 s; LE: parasagittal AND central chains):');
  {
    const ref = isolated('reference-ipsi', 'v-waves', 180, 20);
    const cz = ref['Cz-A1'], c3 = ref['C3-A1'];
    const pk = peaksPast(cz, 20, 0.2, -1);
    check('V-waves in 180 s', pk.length, 12, 60);
    check('V-wave Cz-A1 median negative peak (adults usually 100-150 uV)', -median(pk.map(i => cz[i])), 70, 200, ' uV');
    const base = pk.map(i => {
      const t = 0.1 * cz[i]; let a = i, b = i;
      while (a > 0 && cz[a] < t) a--;
      while (b < cz.length - 1 && cz[b] < t) b++;
      return (b - a) / FS;
    });
    check('V-wave negative wave base width, Cz-A1 (SP: ~100 ms)', median(base), 0.07, 0.2, ' s');
    const whole = pk.map(i => {
      const t = 0.05 * Math.abs(cz[i]), w = Math.round(0.4 * FS); let a = i, b = i;
      for (let k = Math.max(0, i - w); k <= Math.min(cz.length - 1, i + w); k++) {
        if (Math.abs(cz[k]) > t) { a = Math.min(a, k); b = Math.max(b, k); }
      }
      return (b - a) / FS;
    });
    check('V-wave whole duration incl. positive phases, Cz-A1 (AASM: < 0.5 s)', median(whole), 0.15, 0.5, ' s');
    check('V-wave C3-A1 / Cz-A1 (bilateral central field, not a point at Cz)', median(pk.map(i => c3[i] / cz[i])), 0.4, 0.9);
    const bip = isolated('bipolar-ap', 'v-waves', 120, 20);
    check('V-wave F3-C3 / Fz-Cz (LE: over the parasagittal chains too)', peakAbs(bip['F3-C3']) / peakAbs(bip['Fz-Cz']), 0.4, 2);
    check('V-wave T3-T5 / Fz-Cz (not a temporal field)', peakAbs(bip['T3-T5']) / peakAbs(bip['Fz-Cz']), 0, 0.2);
    const at = argAbsMax(bip['Fz-Cz']);
    check('V-wave reverses at C3 (sign of F3-C3 x C3-P3 at the peak)', Math.sign(bip['F3-C3'][at]) * Math.sign(bip['C3-P3'][at]), -1, -1);
  }

  console.log('\nK-complexes (AASM: negative sharp wave then positive component, >= 0.5 s, frontal max; COL; LE: diffuse, often followed by a spindle):');
  {
    const ref = isolated('reference-ipsi', 'k-complex', 240, 20);
    const fz = ref['Fz-A1'], cz = ref['Cz-A1'], pz = ref['Pz-A1'];
    const pk = peaksPast(fz, 30, 1.5, -1);
    check('K-complexes in 240 s (spontaneous ~1-3/min)', pk.length, 6, 20);
    check('KC frontal maximum: Fz-A1 / Cz-A1 negative peak (AASM, COL)', median(pk.map(i => fz[i] / cz[i])), 1.0, 3);
    check('KC Fz-A1 / Pz-A1 negative peak (frontal, not parietal)', median(pk.map(i => fz[i] / pz[i])), 1.5, 10);
    const posPk = pk.map(i => { let m = i; for (let k = i; k < Math.min(fz.length, i + FS); k++) if (fz[k] > fz[m]) m = k; return m; });
    check('KC Fz-A1 peak-to-peak (stands out from the background, >75 uV)', median(pk.map((i, n) => fz[posPk[n]] - fz[i])), 75, 400, ' uV');
    check('KC positive / negative component (negative dominant, COL)', median(pk.map((i, n) => fz[posPk[n]] / -fz[i])), 0.3, 0.9);
    const dur = pk.map((i, n) => {
      const tn = 0.1 * fz[i]; let a = i;
      while (a > 0 && fz[a] < tn) a--;
      const tp = 0.1 * fz[posPk[n]]; let b = posPk[n];
      while (b < fz.length - 1 && fz[b] > tp) b++;
      return (b - a) / FS;
    });
    check('KC total duration, Fz-A1 (AASM: >= 0.5 s)', median(dur), 0.5, 1.6, ' s');
    // A spindle after the complex survives a 100 ms moving-average subtraction; the
    // complex's own smooth positive wave leaves under ~1 uV of residual.
    const followed = pk.filter(i => {
      const a = i + Math.round(0.3 * FS), b = Math.min(fz.length, i + Math.round(2.2 * FS));
      let s = 0;
      for (let k = a; k < b; k++) {
        let m = 0;
        for (let j = -12; j <= 12; j++) m += fz[Math.min(fz.length - 1, Math.max(0, k + j))];
        s += (fz[k] - m / 25) ** 2;
      }
      return Math.sqrt(s / Math.max(1, b - a)) > 3;
    }).length;
    check('KCs followed by a spindle (LE: often but not always)', followed / pk.length, 0.3, 0.9);
    const bip = isolated('bipolar-ap', 'k-complex', 180, 20);
    const rows = MONTAGES['bipolar-ap'].channels.filter(c => c.label !== 'ECG').map(c => c.label);
    const big = Math.max(...rows.map(l => peakAbs(bip[l])));
    check('KC diffuse: F7-T3 / largest row (LE: on every chain)', peakAbs(bip['F7-T3']) / big, 0.2, 1);
    check('KC diffuse: P3-O1 / largest row', peakAbs(bip['P3-O1']) / big, 0.1, 1);
    check('KC not cancelled on the midline: Fz-Cz / largest row', peakAbs(bip['Fz-Cz']) / big, 0.35, 1);
  }

  console.log('\nSpindles (AASM: 11-16 Hz, >= 0.5 s, central max; LE: symmetric; SPN: fast central 13.4-14.3 Hz, slow frontal 12.3-12.9 Hz, 5-15 uV):');
  {
    const ref = isolated('reference-ipsi', 'spindles', 300, 20);
    const ec = envelope(ref['Cz-A1']), ef = envelope(ref['Fz-A1']);
    const comb = ec.map((v, i) => Math.max(v, ef[i]));
    const pk = peaksPast(comb, 3, 0.3, +1);
    check('spindles in 300 s (SPN: ~1-6/min per population)', pk.length, 10, 45);
    const dur = pk.map(i => {
      const t = 0.2 * comb[i]; let a = i, b = i;
      while (a > 0 && comb[a] > t) a--;
      while (b < comb.length - 1 && comb[b] > t) b++;
      return (b - a) / FS;
    });
    check('spindle median visible duration (AASM >= 0.5 s; SPN 0.8-1.1 s)', median(dur), 0.5, 2.0, ' s');
    check('spindle shortest visible duration (AASM floor 0.5 s)', Math.min(...dur), 0.4, 2.0, ' s');
    check('slow spindles: Fz-A1 peak frequency (SPN 12.3-12.9; slow ~11-13 Hz)', spectralPeak(welch(ref['Fz-A1'], FS, 2048), 9, 18).freq, 11, 13.2, ' Hz');
    check('fast spindles: Pz-A1 peak frequency (SPN 13.4-14.3; fast ~13-15 Hz)', spectralPeak(welch(ref['Pz-A1'], FS, 2048), 9, 18).freq, 13, 15, ' Hz');
    const c3e = envelope(ref['C3-A1']);
    check('spindle C3-A1 median peak (SPN: 5.2-15.2 uV)', median(peaksPast(c3e, 2, 0.3, +1).map(i => c3e[i])), 5, 16, ' uV');
    check('spindle symmetry C3-A1 / C4-A2 power (LE: symmetric)', power(ref['C3-A1']) / power(ref['C4-A2']), 0.8, 1.25);
    const bip = isolated('bipolar-ap', 'spindles', 180, 20);
    check('spindles on the parasagittal chain: F3-C3 / Fz-Cz RMS', Math.sqrt(power(bip['F3-C3']) / power(bip['Fz-Cz'])), 0.4, 3);
  }

  console.log('\nSleep background: N3 slow waves (AASM, LE) and quiet midline rows in drowsiness and N1:');
  {
    // AASM slow-wave activity: time inside full waves of 0.5-2 Hz with >75 uV peak-to-peak.
    // Waves are cut at upward zero crossings of a zero-phase 0.3-2 Hz band-limited copy.
    const lowpass = (x: Float64Array, fc: number) => {
      const a = Math.exp(-2 * Math.PI * fc / FS), y = new Float64Array(x.length);
      let s = x[0];
      for (let i = 0; i < x.length; i++) { s = a * s + (1 - a) * x[i]; y[i] = s; }
      return y;
    };
    const zeroPhase = (x: Float64Array, fc: number) => lowpass(lowpass(x, fc).reverse(), fc).reverse();
    const swaFraction = (x: Float64Array) => {
      const lo = zeroPhase(zeroPhase(x, 2), 2), slow = zeroPhase(lo, 0.3);
      const y = lo.map((v, i) => v - slow[i]);
      let prev = -1, qual = 0;
      for (let i = 1; i < y.length; i++) {
        if (!(y[i - 1] < 0 && y[i] >= 0)) continue;
        if (prev >= 0) {
          const d = (i - prev) / FS;
          if (d >= 0.5 && d <= 2) {
            let mx = -Infinity, mn = Infinity;
            for (let k = prev; k < i; k++) { mx = Math.max(mx, x[k]); mn = Math.min(mn, x[k]); }
            if (mx - mn > 75) qual += i - prev;
          }
        }
        prev = i;
      }
      return qual / y.length;
    };
    const epochs = (x: Float64Array) => [x.subarray(0, 30 * FS), x.subarray(30 * FS, 60 * FS)];
    const n3Min: number[] = [], n2Max: number[] = [];
    const post: number[] = [], mid: number[] = [], frontOcc: number[] = [], sync: number[] = [];
    for (const seed of [5, 42, 777]) {
      const c3 = runDisplay('reference-contra', 'n3', [], 60, seed);
      const c2 = runDisplay('reference-contra', 'n2', [], 60, seed);
      const ch = (r: typeof c3, l: string) => r.data[r.montage.channels.findIndex(c => c.label === l)];
      const f = (r: typeof c3) => [...epochs(ch(r, 'F4-A1')), ...epochs(ch(r, 'F3-A2'))].map(swaFraction);
      n3Min.push(Math.min(...f(c3)));
      n2Max.push(Math.max(...f(c2)));
      const b = runDisplay('bipolar-ap', 'n3', [], 60, seed);
      const bd = (l: string) => bandRms(ch(b, l), 0.5, 2);
      post.push(Math.min(bd('T5-O1') / bd('Fp1-F7'), bd('T6-O2') / bd('Fp2-F8')));
      mid.push(bd('Fz-Cz') / median(['Fp1-F3', 'F3-C3', 'C3-P3', 'P3-O1', 'Fp2-F4', 'F4-C4', 'C4-P4', 'P4-O2'].map(bd)));
      const r = runDisplay('reference-ipsi', 'n3', [], 60, seed);
      frontOcc.push(bandRms(ch(r, 'F3-A1'), 0.5, 2) / bandRms(ch(r, 'O1-A1'), 0.5, 2));
      sync.push(corr(zeroPhase(ch(r, 'F3-A1'), 2), zeroPhase(ch(r, 'F4-A2'), 2)));
    }
    check('N3: AASM slow-wave activity in the least slow 30 s epoch, F4-A1/F3-A2 (N3 needs >= 20%)', Math.min(...n3Min), 0.2, 1);
    check('N2: AASM slow-wave activity in the slowest 30 s epoch (N2 stays under 20%)', Math.max(...n2Max), 0, 0.2);
    check('N3 delta reaches the posterior chains: T5-O1/Fp1-F7 and T6-O2/Fp2-F8 (LE figure)', Math.min(...post), 0.5, 2);
    check('N3 midline not dominant: Fz-Cz / median parasagittal delta', Math.max(...mid), 0, 1.5);
    check('N3 frontally predominant: F3-A1 / O1-A1 delta (AASM: measured frontally)', Math.min(...frontOcc), 1.15, 5);
    check('N3 synchronized: F3-A1 vs F4-A2 slow-wave correlation (LE: synchronized)', Math.min(...sync), 0.5, 1);
    for (const st of ['drowsy', 'n1'] as PatientState[]) {
      const dom: number[] = [];
      for (const seed of [5, 42, 777]) {
        const b = runDisplay('bipolar-ap', st, [], 60, seed);
        const rms = (x: Float64Array) => Math.sqrt(power(x) / x.length);
        const others = b.montage.channels.filter(c => !['ECG', 'Fz-Cz', 'Cz-Pz'].includes(c.label)).map((c) => rms(b.data[b.montage.channels.indexOf(c)]));
        const midRms = Math.max(...['Fz-Cz', 'Cz-Pz'].map(l => rms(b.data[b.montage.channels.findIndex(c => c.label === l)])));
        dom.push(midRms / median(others));
      }
      check(`${st}: midline rows no louder than the rest (max midline RMS / median row)`, Math.max(...dom), 0, 1.4);
    }
  }
}

console.log('\n=== Step 20: normal variants in DISPLAY space (A4 audit) ===\n');

// Same rationale as Step 19: an absolute-microvolt or timing claim (BETS's
// "<50 ms, <50 uV") is a claim about what a reader sees on the montage-derived
// trace, not about the raw electrode. Step 13 above already checks these
// patterns' referential band power/p2p on-off; this repeats the morphology-
// specific claims on the real display-space channel.

console.log('Wicket (7-11 Hz arciform bursts, temporal, drowsy only): no after-going slow wave, bipolar-ap:');
{
  // Not a single pointed transient (it's an oscillatory arciform burst), so
  // "no slow wave" is checked spectrally rather than via a single base-width
  // measure: if a slow wave rode along after each burst, the isolated
  // contribution would carry real delta-band (0.5-4 Hz) power alongside its
  // arciform (7-11 Hz) power. wicketSide()'s morphology only ever calls
  // arciformSignal (never a spikeSlowWave-family helper) and TransientSource
  // returns exactly 0 outside each event's duration window, so that delta
  // contribution should be negligible.
  const diff = displayContrib('bipolar-ap', 'drowsy', 'wicket', 'T3-T5', 120, 20);
  const arciform = bandPower(diff, 7, 11);
  const delta = bandPower(diff, 0.5, 4);
  check('wicket T3-T5 has no after-going slow wave (delta/arciform power ratio)',
    delta / arciform, 0, 0.15);
}

console.log('\nBETS (<50 ms, <50 uV, temporal, drowsy/N1/N2 only, no slow wave), bipolar-ap:');
{
  // A4 fix: BETS is now state-gated (variants.ts betsSide) — drowsy is the
  // state it actually fires in, and the state a reader would see it in.
  const diff = displayContrib('bipolar-ap', 'drowsy', 'bets', 'T3-T5', 120, 20);
  let peak = 0, peakAt = 0;
  for (let k = 0; k < diff.length; k++) if (Math.abs(diff[k]) > Math.abs(peak)) { peak = diff[k]; peakAt = k; }
  const thresh = 0.1 * Math.abs(peak);
  let lo = peakAt; while (lo > 0 && Math.abs(diff[lo]) >= thresh) lo--;
  let hi = peakAt; while (hi < diff.length - 1 && Math.abs(diff[hi]) >= thresh) hi++;
  const widthMs = ((hi - lo) / FS) * 1000;
  let slow = 0;
  const end = Math.min(diff.length, peakAt + Math.round(0.6 * FS));
  for (let k = peakAt; k < end; k++) if (diff[k] > slow) slow = diff[k];
  check('BETS T3-T5 base width (site/patterns.ts: <50 ms)', widthMs, 5, 50, ' ms');
  check('BETS T3-T5 peak amplitude (patterns.ts: <50 uV)', Math.abs(peak), 3, 50, ' uV');
  check('BETS T3-T5 has no after-going slow wave', slow / Math.abs(peak), 0, 0.15);
}

console.log('\nLambda: surface-positive; polarity is montage-dependent (§4/IK-008), same family as POSTS:');
{
  const o1Car = displayContrib('reference-car', 'awake', 'lambda', 'O1-AVG', 120, 20);
  let carPeak = 0;
  for (const v of o1Car) if (Math.abs(v) > Math.abs(carPeak)) carPeak = v;
  check('lambda renders DOWN at O1-AVG, reference-car (surface-positive)', carPeak, 0, Infinity, ' uV');

  const p3O1 = displayContrib('bipolar-ap', 'awake', 'lambda', 'P3-O1', 120, 20);
  let bipPeak = 0;
  for (const v of p3O1) if (Math.abs(v) > Math.abs(bipPeak)) bipPeak = v;
  check('lambda polarity inverts at P3-O1, bipolar-ap (O1 is input2)', bipPeak, -Infinity, 0, ' uV');
}

console.log('\n14 & 6 positive bursts: surface-positive; polarity is montage-dependent (§4/IK-008):');
{
  // The classic montage for "14 & 6 positive spikes" is a referential ear
  // derivation — the burst is a broad, near-bilateral posterior-temporal field,
  // so common-average and ipsilateral references partly cancel it (T6-AVG lifts
  // only ~4 uV; the K-complex/Pz mechanism above). The contralateral-ear channel
  // shows the surface-positive comb-teeth cleanly, deflecting DOWN.
  const t6Contra = displayContrib('reference-contra', 'drowsy', '14-6-pos', 'T6-A1', 90, 20);
  let contraPeak = 0;
  for (const v of t6Contra) if (Math.abs(v) > Math.abs(contraPeak)) contraPeak = v;
  check('14-6-pos renders DOWN at T6-A1, reference-contra (surface-positive)', contraPeak, 0, Infinity, ' uV');

  // Montage dependence: on a bipolar link where T6 is input 2, the same
  // surface-positive burst inverts and deflects UP.
  const t4t6 = displayContrib('bipolar-ap', 'drowsy', '14-6-pos', 'T4-T6', 90, 20);
  let bipPeak = 0;
  for (const v of t4t6) if (Math.abs(v) > Math.abs(bipPeak)) bipPeak = v;
  check('14-6-pos polarity inverts at T4-T6, bipolar-ap (T6 is input2)', bipPeak, -Infinity, 0, ' uV');
}

console.log('\n=== Step 22: ictal in DISPLAY space (A7 audit) ===\n');

// Step 16 already checks the ictal sources referentially (raw electrode
// space). A seizure's diagnosis is its EVOLUTION, and CLAUDE.md §4 requires
// that be verified on the montage-derived, common-average-referenced channel
// a reader actually looks at, not just as a spectral scalar on the raw
// electrode. This section repeats the frequency-evolution and field claims in
// that display space.

console.log('Absence (display space, reference-car): peak frequency lands in the typical 3 Hz band (LEARNINGEEG §12: "3 Hz generalised spike-wave"), frontal-max but still generalised:');
{
  // absence-ictal has no gate(), so on-minus-off isolates its own contribution
  // cleanly. ABSENCE_DELAY is 4 s and the shortest possible epoch is 5 s
  // (ictal.ts: `dur = g.range(5, 15)`), so a 4.5-8 s window is inside the
  // discharge for every seed.
  const fz = displayContrib('reference-car', 'awake', 'absence-ictal', 'Fz-AVG', 12, 7);
  const fzWin = fz.subarray(Math.floor(4.5 * FS), Math.floor(8 * FS));
  const pk = spectralPeak(welch(fzWin, FS, 512), 2, 4);
  check('absence Fz-AVG discharge peak frequency (typical: 2.5-3.5 Hz, not atypical)', pk.freq, 2.5, 3.5, ' Hz');

  // Generalised-but-frontal: O1-AVG must still carry real 2.5-3.5 Hz power
  // (this is a generalised discharge, not an isolated frontal focus), and
  // less of it than Fz-AVG (frontal predominance survives the CAR transform).
  const o1 = displayContrib('reference-car', 'awake', 'absence-ictal', 'O1-AVG', 12, 7);
  const o1Win = o1.subarray(Math.floor(4.5 * FS), Math.floor(8 * FS));
  const fzPow = winPower(fzWin, 2.5, 3.5), o1Pow = winPower(o1Win, 2.5, 3.5);
  check('absence O1-AVG carries real 2.5-3.5 Hz power (generalised field reaches occiput)',
    o1Pow, 1, 1e6, ' uV^2');
  check('absence Fz-AVG / O1-AVG 2.5-3.5 Hz power (frontal-max survives CAR)', fzPow / o1Pow, 1.1, 20);

  // IK-017: absence returns INSTANTLY to baseline at offset — no post-ictal
  // slowing. A prior port added a ~2 s fading delta burst after each discharge;
  // that oscillatory 0.8-2.1 Hz tail is a clinical error (real absence has none)
  // and is removed. Verify no oscillatory delta survives into the post-offset
  // gap. NOTE: the amplifier high-pass (chain.ts) leaves a MONOTONIC baseline-
  // recovery tail after the discharge's net-DC offset — that is a legitimate,
  // universal display-chain artifact, not post-ictal slowing. welch subtracts
  // the per-segment mean, so it rejects that monotonic decay and measures only
  // the OSCILLATORY 1-2.5 Hz band, which is exactly what the removed fade was
  // and the recovery tail is not. Detect the first discharge's offset (last
  // 0.5 s bin whose RMS clears the discharge threshold), then read 2.6 s just
  // past it. With the fade the band held >=3.6 uV^2; without it, ~0.
  const isoAbs = displayContrib('reference-car', 'awake', 'absence-ictal', 'Fz-AVG', 24, 7);
  const binRms = (t0: number, t1: number) => {
    const s = isoAbs.subarray(Math.floor(t0 * FS), Math.floor(t1 * FS));
    let sum = 0;
    for (const v of s) sum += v * v;
    return Math.sqrt(sum / s.length);
  };
  let offset = 4;
  for (let t = 4; t < 20; t += 0.5) if (binRms(t, t + 0.5) > 30) offset = t + 0.5;
  const postOffset = isoAbs.subarray(Math.floor((offset + 0.3) * FS), Math.floor((offset + 2.9) * FS));
  check('absence has NO post-ictal oscillatory delta (instant recovery, IK-017)',
    winPower(postOffset, 1, 2.5), 0, 2, ' uV^2');
}

console.log('\nGTC (display space, reference-car): recruiting -> clonic slowing -> post-ictal suppression:');
{
  // gtc-ictal defines gate(), which scales the WHOLE background (engine.ts's
  // neuralGate), not just this generator's own output — an on-minus-off diff
  // would net out the very suppression being measured. Read the raw on-run
  // instead, exactly as Step 16's raw-space check does, through the montage/
  // CAR transform. GTC_DELAY = 6 s, so absolute time = 6 + cycle: recruiting
  // is t in [6,10), clonic [10,24), decrescendo [24,41), suppression [41,56).
  const gt = runDisplay('reference-car', 'awake', ['gtc-ictal'], 60, 11);
  const fzIdx = gt.montage.channels.findIndex((c) => c.label === 'Fz-AVG');
  const czIdx = gt.montage.channels.findIndex((c) => c.label === 'Cz-AVG');
  const slice = (ch: number, t0: number, t1: number) =>
    gt.data[ch].subarray(Math.floor(t0 * FS), Math.floor(t1 * FS));

  // gate()==1 throughout recruiting (cycle < 35), so on-minus-off cleanly
  // isolates the recruiting rhythm's own contribution here — unlike the
  // suppression checks below, nothing is confounded by scaling the background.
  // A ratio against the raw run's own delta band (as opposed to this isolated
  // diff) is unstable: awake background is 1/f-shaped, so ambient low-frequency
  // power alone can rival a still-building (env = (cycle/4)^2) beta rhythm —
  // the isolated diff sidesteps that floor entirely. The recruiting rhythm's
  // BETA_TONES carrier runs at freqScale 1.2 (a fixed multiplier, not a sweep),
  // so — unlike the focal-temporal/frontal chirps below — spectralPeak's single
  // dominant bin is a fair read here: the 14.2 Hz tone (amplitude 1.0, the
  // tallest in BETA_TONES) scales to ~17 Hz.
  const gtcContrib = displayContrib('reference-car', 'awake', 'gtc-ictal', 'Fz-AVG', 12, 11);
  const recruitWin = gtcContrib.subarray(Math.floor(7 * FS), Math.floor(9.5 * FS));
  const recruitPeak = spectralPeak(welch(recruitWin, FS, 512), 10, 32);
  check('GTC Fz-AVG recruiting contribution p2p (fast recruiting rhythm, isolated)',
    pctP2p(recruitWin), 10, 200, ' uV');
  check('GTC Fz-AVG recruiting contribution peak frequency (beta-range, ~17 Hz)',
    recruitPeak.freq, 14, 22, ' Hz');

  // Clonic slowing 3 -> 1.5 Hz, read as a spectral-peak drop between an early
  // and a late 3 s window inside the clonic phase.
  const early = spectralPeak(welch(slice(fzIdx, 10.5, 13.5), FS, 512), 1, 4);
  const late = spectralPeak(welch(slice(fzIdx, 20.5, 23.5), FS, 512), 1, 4);
  check('GTC Fz-AVG clonic peak frequency, early window', early.freq, 2.2, 3.2, ' Hz');
  check('GTC Fz-AVG clonic peak frequency, late window (slows toward 1.5 Hz)', late.freq, 1.2, 2.2, ' Hz');
  check('GTC Fz-AVG clonic peak frequency, early / late (organised slowing)', early.freq / late.freq, 1.15, 1e6);

  // Generalised: the clonic discharge must be scalp-visible beyond Fz, at Cz.
  const czClonic = pctP2p(slice(czIdx, 12, 22));
  const czBaseline = pctP2p(slice(czIdx, 0, 5));
  check('GTC Cz-AVG clonic / pre-ictal p2p (generalised field reaches Cz)', czClonic / czBaseline, 1.5, 1e6);

  // Post-ictal suppression: near-flat against the clonic discharge, on the
  // display-space channel — the display-space pin for the raw-space check
  // already covering IK's "post-ictal attenuation, not silence".
  const clonicP2p = pctP2p(slice(fzIdx, 11, 24));
  const suppP2p = pctP2p(slice(fzIdx, 45, 49));
  check('GTC Fz-AVG post-ictal / clonic p2p (display-space suppression)', suppP2p / clonicP2p, 0, 0.4);
}

console.log('\nFocal temporal (display space, reference-car T3-AVG): onset theta evolves 6 -> 3.5 Hz:');
{
  // No gate() on this source, so on-minus-off isolates cleanly. FTEMP_DELAY=5,
  // FTEMP_ACTIVE=30 -> active window is absolute t in [5,35). Early window
  // sits just after onset (small amplitude, near f0); late window sits just
  // before the discharge ends (large amplitude, near f1) — never `sin(2*pi*
  // f(t)*t)`, the sweep comes from `sweepPhase`'s phase integral (morphology.ts).
  //
  // NOT read via spectralPeak's single dominant bin: THETA_TONES weights its
  // components unevenly (4.3 Hz carries amplitude 1.0, 7.2 Hz only 0.7), so the
  // component the sweep scales up to a high frequency is never the tallest bin
  // in the spectrum, and the tallest-bin frequency undershoots the true sweep
  // endpoint at BOTH ends. Step 16's raw-space "ictal frequency knob" check hits
  // the identical multi-tone-sweep shape and reads it as a band-power SWAP
  // instead (validateEngine.ts, "T3 low/high band ratio") — mirrored here.
  const t3 = displayContrib('reference-car', 'awake', 'focal-temporal-ictal', 'T3-AVG', 40, 13);
  const earlyWin = t3.subarray(Math.floor(6 * FS), Math.floor(9 * FS));
  const lateWin = t3.subarray(Math.floor(31 * FS), Math.floor(34 * FS));
  const earlyRatio = winPower(earlyWin, 4.8, 8) / winPower(earlyWin, 2.5, 4);
  const lateRatio = winPower(lateWin, 4.8, 8) / winPower(lateWin, 2.5, 4);
  check('focal-temporal T3-AVG onset high/low(4.8-8/2.5-4 Hz) band ratio (power sits high, near 6 Hz)',
    earlyRatio, 2, 1e6);
  check('focal-temporal T3-AVG late high/low(4.8-8/2.5-4 Hz) band ratio (power shifts low, toward 3.5 Hz)',
    lateRatio, 0, 1);
  check('focal-temporal T3-AVG onset / late band-ratio (evolution, not a static rhythm)',
    earlyRatio / lateRatio, 3, 1e6);
}

console.log('\nFocal frontal (display space, reference-car F3-AVG): low-voltage-fast onset evolves 18 -> 3 Hz:');
{
  // FFRONT_DELAY=5, FFRONT_ACTIVE=15 -> active window is absolute t in [5,20).
  // Same evolution requirement as the temporal source above, scaled to the
  // frontal source's much shorter, more explosive timeline.
  const f3 = displayContrib('reference-car', 'awake', 'focal-frontal-ictal', 'F3-AVG', 25, 17);
  const early = spectralPeak(welch(f3.subarray(Math.floor(6 * FS), Math.floor(9 * FS)), FS, 512), 2, 25);
  const late = spectralPeak(welch(f3.subarray(Math.floor(15.5 * FS), Math.floor(18.5 * FS)), FS, 512), 2, 25);
  check('focal-frontal F3-AVG onset peak frequency (low-voltage FAST, near 18 Hz)', early.freq, 10, 22, ' Hz');
  check('focal-frontal F3-AVG late peak frequency (evolved down toward 3 Hz)', late.freq, 2, 9, ' Hz');
  check('focal-frontal F3-AVG onset / late peak frequency (evolves DOWN, the FLE hallmark)',
    early.freq / late.freq, 1.5, 1e6);
}

console.log('\n=== Step 23: calibration & amplitude invariants (A8 audit) ===\n');

// These are properties of the DISPLAY TRANSFORM (CLAUDE.md §4), not of any one
// generator: paper speed, sensitivity, and the negative-up sign convention are
// supposed to hold identically for every montage, pattern, and toggle. `renderTrace`
// drives the real engine through the exact geometry `EEGCanvas.tsx` uses and now
// returns the actual pxPerSec/pxPerMm/pxPerUV it rendered with (renderTrace.ts:
// RenderResult), so the checks below read those production numbers directly
// instead of re-deriving the formulas and risking testing the reimplementation
// rather than the code.
//
// Source-level cross-check (read, not executed — EEGCanvas.tsx is a React
// component and can't run headlessly here): EEGCanvas.tsx:199 computes
// `pxPerSec = currentSettings.speed * PX_PER_MM_X` and renderTrace.ts:232 computes
// the byte-identical `pxPerSec = speed * PX_PER_MM_X`. EEGCanvas.tsx:308 computes
// `pxPerUV = pxPerMm / currentSettings.sensitivity` and renderTrace.ts:234 computes
// the byte-identical `pxPerUV = pxPerMm / sensitivity`. EEGCanvas.tsx:395 draws
// `y = centerY + v` (scale folded into v beforehand) and renderTrace.ts:278 draws
// `y = centerY + v * scale` — both negative-up (+v renders downward). The two
// files hold their own copies of PX_PER_MM_X=4 / MM_PER_ROW=10 / GAP_UNITS=0.40
// (EEGCanvas.tsx:35-37, renderTrace.ts:39-41) rather than sharing one module; they
// agree today (checked by inspection), but nothing but this comment and manual
// review would catch them drifting apart — flagged in the audit report, not fixed
// here (no divergence found, so no surgical change is justified).

console.log('Paper speed: mm/s -> px/s at PX_PER_MM_X=4 (CLAUDE.md §4; 30 mm/s adult default):');
{
  // Driven from SPEED_VALUES itself rather than a copy of it. This literal used to
  // read [10, 20, 30]; when the ladder was corrected to ACNS Guideline 1 §3.7
  // (30 mm/s routine, 15 mm/s the named alternative, 20 mm/s named by no standard)
  // the copy went stale and only a type error caught it. Iterating the real export
  // means every offered speed is calibration-checked, and adding one cannot bypass
  // this check.
  for (const speed of SPEED_VALUES) {
    const res = renderTrace({ speed, seconds: 2, out: `${SCRATCH}/a8-speed-${speed}.png` });
    check(`pxPerSec @ ${speed} mm/s (speed * PX_PER_MM_X)`, res.pxPerSec, speed * 4, speed * 4);
  }
  // Empirical cross-check independent of the pxPerSec field: two renders at the
  // same speed but different durations must differ in width by exactly
  // (seconds2 - seconds1) * pxPerSec pixels, i.e. 1 s of paper is 120 px at
  // 30 mm/s regardless of how the width is assembled internally.
  const w1 = renderTrace({ speed: 30, seconds: 1, out: `${SCRATCH}/a8-w1.png` }).width;
  const w11 = renderTrace({ speed: 30, seconds: 11, out: `${SCRATCH}/a8-w11.png` }).width;
  check('width(11s) - width(1s) @ 30 mm/s (10 s * 120 px/s)', w11 - w1, 1200, 1200, ' px');
}

console.log('\nSensitivity: µV/mm calibration (CLAUDE.md §4; UI options 1|3|5|7|10|15|30 µV/mm):');
{
  for (const sensitivity of [1, 3, 5, 7, 10, 15, 30] as const) {
    const res = renderTrace({ sensitivity, seconds: 2, out: `${SCRATCH}/a8-sens-${sensitivity}.png` });
    // Defining relationship: pxPerUV = pxPerMm / sensitivity, i.e. mm = µV / sensitivity.
    check(`pxPerUV * sensitivity == pxPerMm (${sensitivity} µV/mm)`,
      (res.pxPerUV * sensitivity) / res.pxPerMm, 0.999, 1.001);
  }
  // The worked example from the audit brief: a 50 µV deflection at 7 µV/mm
  // sensitivity should measure ~7.14 mm on paper.
  const res7 = renderTrace({ sensitivity: 7, seconds: 2, out: `${SCRATCH}/a8-sens-7.png` });
  const mmFor50uV = (50 * res7.pxPerUV) / res7.pxPerMm;
  check('50 µV calibration deflection @ 7 µV/mm', mmFor50uV, 7.0, 7.3, ' mm');
}

console.log('\nNegative-up polarity (IK-008; CLAUDE.md §4): synthetic input, montage-only, no pattern:');
{
  // Isolates the sign convention from any one generator's morphology: feed a
  // synthetic constant voltage straight into the production computeChannelVoltage
  // (the same function EEGCanvas/renderTrace call every sample) on a real bipolar
  // channel definition, then apply renderTrace's own pxPerUV (production number,
  // not reimplemented) to get the pixel deflection EEGCanvas.tsx:395 /
  // renderTrace.ts:278 would draw.
  const bipolarAp = MONTAGES['bipolar-ap'];
  const fp1F3 = bipolarAp.channels.find((c) => c.label === 'Fp1-F3') as ChannelDef;
  const res = renderTrace({ sensitivity: 7, seconds: 1, out: `${SCRATCH}/a8-polarity.png` });

  const vSurfacePositive = computeChannelVoltage(fp1F3, 0, { Fp1: 50 }, 0); // input1 (Fp1) > input2 (F3)
  const vSurfaceNegative = computeChannelVoltage(fp1F3, 0, { Fp1: -50 }, 0);
  check('computeChannelVoltage(Fp1=+50,F3=0) is surface-positive (input1 - input2)', vSurfacePositive, 50, 50, ' uV');
  check('computeChannelVoltage(Fp1=-50,F3=0) is surface-negative', vSurfaceNegative, -50, -50, ' uV');

  // These call the PRODUCTION traceY() rather than recomputing `v * pxPerUV`.
  // That distinction is the whole point of the check. Until displayGeometry.ts
  // existed, this block multiplied a voltage by a positive number and asserted the
  // product was positive — an algebraic identity that could not fail, and which
  // never touched EEGCanvas at all. A global sign flip in the renderer, exactly the
  // regression IK-008's Mechanism paragraph says this exists to catch, would have
  // passed. Now both renderers draw through traceY(), so flipping it fails here.
  // centerY = 0, so the returned y IS the offset from baseline.
  const yOffsetPositive = traceY(0, vSurfacePositive, res.pxPerUV);
  const yOffsetNegative = traceY(0, vSurfaceNegative, res.pxPerUV);
  check('surface-positive (+50 µV) deflects DOWN (y - centerY > 0)', yOffsetPositive, 0.01, Infinity, ' px');
  check('surface-negative (-50 µV) deflects UP (y - centerY < 0)', yOffsetNegative, -Infinity, -0.01, ' px');

  // The ECG row is the one documented exception to negative-up: it is a limb lead,
  // not a scalp derivation, and every clinician has the QRS memorised with the R
  // wave UP. The app's own `ecg-artifact` description tells the learner to
  // shape-match scalp transients against it, so an inverted ECG costs precisely the
  // skill the channel is there to teach. It rendered inverted until 2026-09-01
  // because it was drawn through the EEG sign convention.
  const rWaveY = traceY(0, +1.0, ecgScale(res.pxPerMm));   // +1 mV R wave
  check('ECG R wave (+1 mV) renders UP (y - centerY < 0; limb lead, not negative-up)',
    rWaveY, -Infinity, -0.01, ' px');
}

console.log('\nNormal amplitude ranges by region (LEARNINGEEG-STUDY.md §1/§3): adult scalp 10-100 µV (mostly 10-50); AP gradient:');
{
  // Referential (reference-car), awake, no toggles: the general adult amplitude
  // envelope and the AP-gradient claim ("faster/lower-amplitude anteriorly,
  // slower/higher-amplitude posteriorly") restated in amplitude space, as a
  // corollary to IK-006's power-ratio version of the same gradient.
  const { montage, data } = runDisplay('reference-car', 'awake', [], 180, 42);
  const idx = (label: string) => montage.channels.findIndex((c) => c.label === label);
  const o1P2p = pctP2p(data[idx('O1-AVG')]);
  const fp1P2p = pctP2p(data[idx('Fp1-AVG')]);
  check('O1-AVG p2p amplitude, awake eyes-closed (LEARNINGEEG §1: adult scalp 10-100 µV)', o1P2p, 10, 100, ' uV');
  check('O1-AVG p2p > Fp1-AVG p2p (AP gradient in amplitude space, LEARNINGEEG §3)', o1P2p / fp1P2p, 1.1, 1e6);
}
// The A-P gradient in full. The check above compares only the two ENDS of the
// chain (O1 vs Fp1), so it passes while the middle of the chain is inverted --
// which is the state the engine shipped in: parietal was the QUIETEST region on
// the head (P4 8.8 uV RMS, below Fp1's 8.5 only by a hair) and the midline ran
// Fz > Cz > Pz, backwards. Here the gradient is asserted link by link, and in
// both of the things learningeeg's Normal Awake chapter says it is: "faster,
// lower amplitude frequencies ... towards the front" and "slower, higher
// amplitude frequencies ... in the back". Nothing tested the frequency half.
//
// `reference-ipsi`, not `reference-car`: with only 19 electrodes the common
// average is a poor stand-in for infinity. It subtracts a posteriorly-weighted
// mean from every channel, which lifts the frontal rows, and it nearly nulls Cz
// (Cz sits close to the array's electrical centroid) -- so it measures this
// gradient backwards. Same signal, same seeds: front-to-back reads 2.48 in CAR
// against 3.86 ear-referenced, and CAR puts Fp1 ABOVE F3. The ear reference is
// what a reader judges amplitude topography on, so the topographic claim is
// asserted there. The check above keeps CAR because IK-028 names it.
//
// Averaged over three seeds: normal hemispheric asymmetry runs to 50%
// (LEARNINGEEG §1) and must not be what decides an ordering.
//
// Parietal >= central IS asserted now (2026-09-11). It was left out when every
// subject carried an always-on, full-strength mu and (P3+P4)/(C3+C4) read 0.95.
// Mu is now a per-subject trait (engine.ts sampleSubject: 34% of subjects), and
// over 8 subjects the ratio reads 1.05-1.62 (mean 1.27): lowest, 1.05-1.10, in the
// three subjects with mu — a central rhythm raises the central rows, as it should —
// and 1.26-1.62 in the five without.
//
// The FREQUENCY half is asserted as beta/alpha, front vs back, on the bipolar rows a
// reader looks at — not as a 2-30 Hz spectral centroid, which is retired below.
{
  const SEEDS = [42, 7, 1234];
  const p2p: Record<string, number[]> = {};
  for (const seed of SEEDS) {
    const { montage, data } = runDisplay('reference-ipsi', 'awake', [], 60, seed);
    montage.channels.forEach((ch, i) => {
      if (ch.group === 'ecg') return;
      const el = ch.active as string;
      (p2p[el] ??= []).push(pctP2p(data[i]));
    });
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const A = (el: string) => mean(p2p[el]);
  // The 10-100 µV envelope is a claim about SCALP amplitude. In the ipsilateral-ear
  // montage F7/T3/T5 and F8/T4/T6 sit beside their own reference, so their rows read a
  // short-distance difference, not the scalp potential: F7-A1 is the quietest row on
  // the page (9.9 µV, 2026-09-11) for that reason alone. Those six are excluded from
  // the envelope, not from anything else. Until the warm-up fix of 2026-09-11 every
  // frontal row also carried a start-up transient (artifacts fired during warm-up and
  // stepped off on the first displayed sample), which put the quietest row at 13.8.
  const NEAR_REF = new Set(['F7', 'T3', 'T5', 'F8', 'T4', 'T6']);
  const all = Object.keys(p2p).filter((el) => !NEAR_REF.has(el)).map(A);

  check('quietest channel p2p, awake, no toggles (LEARNINGEEG §1: adult scalp 10-100 µV)', Math.min(...all), 10, 100, ' uV');
  check('loudest channel p2p, awake, no toggles (LEARNINGEEG §1: adult scalp 10-100 µV)', Math.max(...all), 10, 100, ' uV');

  // Amplitude half of the gradient, link by link up each chain.
  check('F3 / Fp1 p2p (AP gradient rises backwards, LEARNINGEEG §3)', A('F3') / A('Fp1'), 1.0, 1e6);
  check('C3 / F3 p2p (AP gradient, LEARNINGEEG §3)', A('C3') / A('F3'), 1.0, 1e6);
  check('O1 / P3 p2p (AP gradient, LEARNINGEEG §3)', A('O1') / A('P3'), 1.0, 1e6);
  check('O1 / C3 p2p (AP gradient, LEARNINGEEG §3)', A('O1') / A('C3'), 1.0, 1e6);
  check('F4 / Fp2 p2p (AP gradient, LEARNINGEEG §3)', A('F4') / A('Fp2'), 1.0, 1e6);
  check('C4 / F4 p2p (AP gradient, LEARNINGEEG §3)', A('C4') / A('F4'), 1.0, 1e6);
  check('O2 / P4 p2p (AP gradient, LEARNINGEEG §3)', A('O2') / A('P4'), 1.0, 1e6);
  check('O2 / C4 p2p (AP gradient, LEARNINGEEG §3)', A('O2') / A('C4'), 1.0, 1e6);
  check('Cz / Fz p2p (AP gradient on the midline, LEARNINGEEG §3)', A('Cz') / A('Fz'), 1.0, 1e6);
  check('Pz / Cz p2p (AP gradient on the midline, LEARNINGEEG §3)', A('Pz') / A('Cz'), 1.0, 1e6);
  // Parietal is no longer the floor of the head.
  check('(P3+P4) / (F3+F4) p2p (parietal above frontal, LEARNINGEEG §3)', (A('P3') + A('P4')) / (A('F3') + A('F4')), 1.15, 1e6);
  check('(P3+P4) / (Fp1+Fp2) p2p (parietal above frontopolar, LEARNINGEEG §3)', (A('P3') + A('P4')) / (A('Fp1') + A('Fp2')), 1.5, 1e6);
  // Gradient present in the referential montage: a floor only. The old 1.8-5 band
  // took its ceiling from an eyeball read of learningeeg's BIPOLAR ap-gradient figure
  // and applied it to an EAR-REFERENCED ratio — two montages, one number. The
  // magnitude is asserted below on the bipolar chain, where a real figure anchors it.
  check('(O1+O2) / (Fp1+Fp2) p2p (front-to-back magnitude, LEARNINGEEG §3)', (A('O1') + A('O2')) / (A('Fp1') + A('Fp2')), 1.8, 1e6);
  check('(P3+P4) / (C3+C4) p2p (parietal at or above central, LEARNINGEEG §3)', (A('P3') + A('P4')) / (A('C3') + A('C4')), 1.0, 1e6);

  // Frequency half of the gradient: "faster, lower amplitude frequencies ... towards
  // the front", which learningeeg's reference figure labels "low amplitude beta" over
  // "moderate amplitude alpha". Asserted as (beta/alpha) on the frontopolar bipolar
  // rows divided by the same on the occipital rows.
  //
  // RETIRED 2026-09-11: `frontopolar / occipital spectral centroid, 2-30 Hz >= 1.1`
  // (IK-030). Read with one image reader on real records, it gave 1.16 on
  // learningeeg's ap-gradient figure but 0.79 on its term-alpha figure — a normal
  // record with obvious frontal fast activity, whose frontal rows also carry blinks.
  // A centroid is pulled down by any low-frequency power, so it measured the ocular
  // and 1/f content, not "faster": the floor would have failed a real normal record.
  // Beta/alpha read 7.5 and 25.3 on those two figures and 7.8 ± 1.7 on 12 engine
  // pages, and it moves the right way when perturbed (3x beta: x1.5-2.5; 0.3x
  // posterior alpha: -30-40%). scripts/read-lab/JOURNAL.md, 2026-09-11.
  const ba: number[] = [];
  for (const seed of SEEDS) {
    const { montage, data } = runDisplay('bipolar-ap', 'awake', [], 60, seed);
    const row = (l: string) => data[montage.channels.findIndex((c) => c.label === l)];
    const r = (l: string) => bandPower(row(l), 13, 30) / bandPower(row(l), 8, 13);
    ba.push(((r('Fp1-F3') + r('Fp2-F4')) / 2) / ((r('P3-O1') + r('P4-O2')) / 2));
  }
  check('beta/alpha, Fp1-F3+Fp2-F4 vs P3-O1+P4-O2 (AP gradient in FREQUENCY: faster in front, LEARNINGEEG §3)',
    mean(ba), 2, 1e6);

  // Amplitude magnitude on the same bipolar rows. learningeeg's ap-gradient figure,
  // traced by scripts/read-lab (same estimator as the engine side), reads 3.75x back
  // over front; the engine reads ~3.1. One real figure is one draw, so the band is
  // wide: it catches a gradient that collapses or runs away, not a 20% difference.
  const bip: number[] = [];
  for (const seed of SEEDS) {
    const { montage, data } = runDisplay('bipolar-ap', 'awake', [], 60, seed);
    const pp = (l: string) => pctP2p(data[montage.channels.findIndex((c) => c.label === l)]);
    bip.push((pp('P3-O1') + pp('P4-O2')) / (pp('Fp1-F3') + pp('Fp2-F4')));
  }
  check('(P3-O1+P4-O2) / (Fp1-F3+Fp2-F4) p2p (front-to-back magnitude, bipolar; learningeeg figure 3.75)',
    mean(bip), 2, 6);
}

console.log('\n=== Step 21: epileptiform in DISPLAY space (A6 audit) ===\n');

// Step 15 already checks these sources referentially (raw electrode space).
// CLAUDE.md §4 requires the clinical claims specific to epileptiform
// discharges — spike-vs-sharp DURATION, phase-reversal LOCALISATION, the
// generalised/frontal-max shape of 3 Hz GSW, multiple spikes per polyspike
// complex, burst-suppression's alternation, hypsarrhythmia's chaotic
// multifocality — verified on the montage-derived, common-average/bipolar
// channel a reader actually reads, not just as a referential scalar.

console.log('IK-012 (spike/sharp duration, ±slow wave) survives the montage transform, bipolar-ap T3-T5:');
{
  // Same measure() as Step 20's BETS check: 10%-of-peak base width, and the
  // after-going slow wave measured as the largest positive excursion within
  // 0.6 s of the peak, divided by |peak|.
  const measure = (d: Float64Array) => {
    let peak = 0, peakAt = 0;
    for (let k = 0; k < d.length; k++) if (d[k] < peak) { peak = d[k]; peakAt = k; }
    const thresh = 0.1 * Math.abs(peak);
    let lo = peakAt; while (lo > 0 && Math.abs(d[lo]) >= thresh) lo--;
    let hi = peakAt; while (hi < d.length - 1 && Math.abs(d[hi]) >= thresh) hi++;
    const widthMs = ((hi - lo) / FS) * 1000;
    let slow = 0;
    const end = Math.min(d.length, peakAt + Math.round(0.6 * FS));
    for (let k = peakAt; k < end; k++) if (d[k] > slow) slow = d[k];
    return { widthMs, slowRatio: slow / Math.abs(peak), peak: Math.abs(peak) };
  };
  const spike = measure(displayContrib('bipolar-ap', 'awake', 'ied-spike', 'T3-T5', 180, 7));
  const sharp = measure(displayContrib('bipolar-ap', 'awake', 'ied-sharp', 'T3-T5', 180, 7));
  const spikeWave = measure(displayContrib('bipolar-ap', 'awake', 'ied-spike-wave', 'T3-T5', 180, 7));
  const sharpWave = measure(displayContrib('bipolar-ap', 'awake', 'ied-sharp-wave', 'T3-T5', 180, 7));
  check('ied-spike T3-T5 base width (IK-012: 20-70 ms)', spike.widthMs, 20, 70, ' ms');
  check('ied-sharp T3-T5 base width (IK-012: 70-200 ms)', sharp.widthMs, 70, 200, ' ms');
  check('ied-spike T3-T5 has no after-going slow wave', spike.slowRatio, 0, 0.15);
  check('ied-sharp T3-T5 has no after-going slow wave', sharp.slowRatio, 0, 0.15);
  check('ied-spike-wave T3-T5 base width stays spike-length (~20-70 ms)', spikeWave.widthMs, 20, 70, ' ms');
  check('ied-sharp-wave T3-T5 base width stays sharp-length (~70-200 ms)', sharpWave.widthMs, 70, 200, ' ms');
  check('ied-spike-wave T3-T5 HAS an after-going slow wave', spikeWave.slowRatio, 0.3, 1.5);
  check('ied-sharp-wave T3-T5 HAS an after-going slow wave', sharpWave.slowRatio, 0.3, 1.5);
}

console.log('\nIK-003 case (a): a focal SPIKE source produces a phase reversal AT the electrode it peaks under, bipolar-ap:');
{
  // Step 16's existing IK-003 checks use focal-temporal-ictal (a rhythmic
  // seizure source). The audit brief specifically asks for this signature
  // reproduced with a genuine SPIKE source — focal-spikes-lt/rt/lf, anchored
  // at T3/T4/F3 respectively — so the phase-reversal claim is verified for
  // the interictal spike morphology (spikeSlowWave), not only the ictal one.
  const check_pair = (toggle: string, link1: string, link2: string, atLabel: string) => {
    const d1 = displayContrib('bipolar-ap', 'awake', toggle, link1, 180, 3);
    const d2 = displayContrib('bipolar-ap', 'awake', toggle, link2, 180, 3);
    // Bound just past -1 (not exactly -1.0) to tolerate floating-point
    // correlation landing at e.g. -1.0000000000000002 for a near-perfectly
    // anti-correlated pair.
    check(`${toggle}: ${link1} vs ${link2} correlation (phase reversal at ${atLabel})`,
      corr(d1, d2), -1.0001, -0.4);
    let p1 = 0, p2 = 0;
    for (const v of d1) if (Math.abs(v) > Math.abs(p1)) p1 = v;
    for (const v of d2) if (Math.abs(v) > Math.abs(p2)) p2 = v;
    check(`${toggle}: ${link1} peak vs ${link2} peak deflect OPPOSITE ways (sign product)`,
      Math.sign(p1) * Math.sign(p2), -1, -1);
  };
  check_pair('focal-spikes-lt', 'F7-T3', 'T3-T5', 'T3');
  check_pair('focal-spikes-rt', 'F8-T4', 'T4-T6', 'T4');
  check_pair('focal-spikes-lf', 'Fp1-F3', 'F3-C3', 'F3');
}

console.log('\nIK-003 case (b): a focal SPIKE source anchored MIDWAY between two electrodes cancels on the link spanning them, bipolar-ap:');
{
  // No toggle in the app anchors a spike source between two electrodes — every
  // focal-spikes-* toggle peaks ON an electrode. Following Step 16's existing
  // synthetic-leadfield precedent (midwaySource('F8','T4') for the static-gain
  // check), this builds the same midpoint anchor but drives it as a genuine
  // TIME SERIES through spikeSlowWave and the real computeChannelVoltage, on
  // the actual Fp2-F8/F8-T4/T4-T6/T6-O2 bipolar-ap channel definitions — a
  // true display-space check, not a bare static leadfield-gain comparison.
  const spec = midwaySource('synthetic-spike-midway-f8-t4', 'F8', 'T4', 0.25);
  const names = ['Fp2', 'F8', 'T4', 'T6', 'O2'];
  const lf = buildLeadfield([spec], names);
  const gainAt = (n: string) => lf.gainAt(names.indexOf(n), 0);
  const n = Math.round(0.9 * FS); // spikeSlowWave is defined for dt in [0, 0.9]
  const allVArr: Record<string, number>[] = [];
  for (let k = 0; k < n; k++) {
    // Same spike/slow-wave amplitudes as the real focal-spikes-lt/rt toggles.
    const v = spikeSlowWave(k / FS, 185, 130);
    const allV: Record<string, number> = {};
    for (const name of names) allV[name] = gainAt(name) * v;
    allVArr.push(allV);
  }
  const montage = MONTAGES['bipolar-ap'];
  const chOf = (label: string) => montage.channels.find((c) => c.label === label) as ChannelDef;
  const chFp2F8 = chOf('Fp2-F8'), chF8T4 = chOf('F8-T4'), chT4T6 = chOf('T4-T6'), chT6O2 = chOf('T6-O2');
  const trace = (ch: ChannelDef) => allVArr.map((allV, k) => computeChannelVoltage(ch, k / FS, allV, 0));
  const peakOf = (arr: number[]) => arr.reduce((p, v) => (Math.abs(v) > Math.abs(p) ? v : p), 0);
  const pk1 = peakOf(trace(chFp2F8));
  const pk2 = peakOf(trace(chF8T4));
  const pk3 = peakOf(trace(chT4T6));
  const pk4 = peakOf(trace(chT6O2));
  check('F8-T4 (spans the midway source) is near-isoelectric vs its flanks',
    Math.abs(pk2) / Math.max(Math.abs(pk1), Math.abs(pk3)), 0, 0.1);
  check('Fp2-F8 and T4-T6 (the flanking links) deflect OPPOSITE ways', Math.sign(pk1) * Math.sign(pk3), -1, -1);
  check('T4-T6 and T6-O2 continue in the SAME direction past the source', Math.sign(pk3) * Math.sign(pk4), 1, 1);
  check('T6-O2 decays relative to T4-T6 (falloff with distance)', Math.abs(pk4) / Math.abs(pk3), 0, 0.5);
}

console.log('\n3 Hz GSW: ~3 Hz, frontally-dominant, generalised/bilateral, spike-then-slow, bipolar-ap:');
{
  const fzcz = displayContrib('bipolar-ap', 'awake', '3hz-gsw', 'Fz-Cz', 60, 11);
  const pk = spectralPeak(welch(fzcz, FS, 4096), 2, 4);
  check('3hz-gsw Fz-Cz discharge frequency (LEARNINGEEG §12: ~3 Hz)', pk.freq, 2.6, 3.4, ' Hz');

  const fp1f3 = displayContrib('bipolar-ap', 'awake', '3hz-gsw', 'Fp1-F3', 60, 11);
  const p3o1 = displayContrib('bipolar-ap', 'awake', '3hz-gsw', 'P3-O1', 60, 11);
  const fp2f4 = displayContrib('bipolar-ap', 'awake', '3hz-gsw', 'Fp2-F4', 60, 11);
  check('3hz-gsw frontal-max: Fp1-F3 p2p > P3-O1 p2p', pctP2p(fp1f3) / pctP2p(p3o1), 1.2, 8);
  check('3hz-gsw generalised/bilateral: Fp1-F3 p2p ~= Fp2-F4 p2p (symmetric, unlike a focal spike)',
    pctP2p(fp1f3) / pctP2p(fp2f4), 0.6, 1.6);

  // Spike-then-slow within one ~333 ms cycle: the sharp component leads, the
  // after-going slow wave follows within the same cycle, not the next one.
  let peak = 0, peakAt = 0;
  for (let k = 0; k < fzcz.length; k++) if (fzcz[k] < peak) { peak = fzcz[k]; peakAt = k; }
  let slowMax = 0, slowAt = 0;
  const winEnd = Math.min(fzcz.length, peakAt + Math.round(0.25 * FS));
  for (let k = peakAt; k < winEnd; k++) if (fzcz[k] > slowMax) { slowMax = fzcz[k]; slowAt = k; }
  check('3hz-gsw Fz-Cz: after-going slow wave follows the spike within the same ~333 ms cycle',
    (slowAt - peakAt) / FS * 1000, 20, 250, ' ms');
}

console.log('\nPolyspike-and-slow-wave: each complex carries MULTIPLE resolvable spikes before its slow wave, bipolar-ap Fz-Cz:');
{
  // Fz-Cz (touches the Fz anchor directly) carries far more amplitude than a
  // link two hops away (Fp1-F3), where the broad frontal source partly
  // cancels in the bipolar difference. Individual polyspikes within one
  // complex are 30-40 ms apart (epileptiform.ts: `0.03 + i*0.04`) — closer
  // than the isolated-spike base width, so they're counted as local minima
  // dipping back below a relative threshold, not as separate threshold-
  // crossing runs (which would merge adjacent polyspikes into one).
  const diff = displayContrib('bipolar-ap', 'awake', 'polyspike-wave', 'Fz-Cz', 60, 13);
  let gPeak = 0, gAt = 0;
  for (let k = 0; k < diff.length; k++) if (Math.abs(diff[k]) > Math.abs(gPeak)) { gPeak = diff[k]; gAt = k; }
  const lo = Math.max(0, gAt - Math.round(0.05 * FS));
  const hi = Math.min(diff.length, gAt + Math.round(0.22 * FS));
  const thresh = 0.2 * Math.abs(gPeak);
  let minimaCount = 0;
  for (let k = lo + 1; k < hi - 1; k++) {
    if (diff[k] < -thresh && diff[k] <= diff[k - 1] && diff[k] <= diff[k + 1]) minimaCount++;
  }
  check('polyspike-wave Fz-Cz: distinct spikes resolvable in one complex (epileptiform.ts: 2-5 polyspikes)',
    minimaCount, 2, 5);
}

console.log('\nBurst-suppression: alternating high-amplitude bursts and near-flat suppression (>=50% suppressed), bipolar-ap Cz-Pz:');
{
  // burst-suppression is gate-based (multiplicative on the whole neural
  // background, not an additive source — engine.ts's neuralGate), so
  // displayContrib's on-minus-off isolation does not apply; runDisplay's raw
  // on/off traces are compared directly instead, matching Step 15's
  // referential precedent for this same pattern.
  const on = runDisplay('bipolar-ap', 'awake', ['burst-suppression'], 60, 5);
  const off = runDisplay('bipolar-ap', 'awake', [], 60, 5);
  const ci = on.montage.channels.findIndex((c) => c.label === 'Cz-Pz');
  const onCz = on.data[ci], offCz = off.data[ci];
  check('burst-suppression Cz-Pz p2p amplitude rises during bursts vs baseline', pctP2p(onCz) / pctP2p(offCz), 1.1, 4);

  const p25abs = (x: Float64Array) => Array.from(x, Math.abs).sort((a, b) => a - b)[Math.floor(0.25 * x.length)];
  check('burst-suppression Cz-Pz: bulk of the trace collapses toward baseline (25th-pctile |amp| ratio)',
    p25abs(onCz) / p25abs(offCz), 0, 0.7);

  // Duty cycle: LEARNINGEEG §9 requires >=50% suppression to earn the name.
  // The envelope threshold (25% of its own max) separates burst from
  // suppression segments without needing to know event boundaries.
  const env = hilbertEnvelope(onCz);
  const maxEnv = Math.max(...Array.from(env));
  const suppressedFrac = Array.from(env).filter((v) => v < 0.25 * maxEnv).length / env.length;
  check('burst-suppression Cz-Pz: suppressed fraction of the trace (LEARNINGEEG §9: >=50%)', suppressedFrac, 0.5, 0.97);
}

console.log('\nHypsarrhythmia: high-amplitude, chaotic and multifocal (desynchronised across regions), bipolar-ap:');
{
  const on = runDisplay('bipolar-ap', 'awake', ['hypsarrhythmia'], 60, 9);
  const off = runDisplay('bipolar-ap', 'awake', [], 60, 9);
  const idxOn = (label: string) => on.montage.channels.findIndex((c) => c.label === label);
  const idxOff = (label: string) => off.montage.channels.findIndex((c) => c.label === label);
  const fp1f3On = on.data[idxOn('Fp1-F3')], t4t6On = on.data[idxOn('T4-T6')];
  // "Rises" keeps its floor; the old ceiling of 12x the resting row was a ratio to the
  // background with no source, and read 14x once the aperiodic floor was halved (2026-09-22)
  // with the pattern unchanged. The amplitude claim is now made in absolute uV, where the
  // literature puts it: hypsarrhythmia is "extremely high amplitude (>200 microvolts)", with
  // some authors requiring >300 and peaks of 500-700 reported (Infantile Spasms: An Update on
  // Pre-Clinical Models and EEG Mechanisms, PMC7023485). 1000 is a sanity ceiling, not a claim.
  check('hypsarrhythmia Fp1-F3 p2p rises vs baseline (high-amplitude)',
    pctP2p(fp1f3On) / pctP2p(off.data[idxOff('Fp1-F3')]), 1.5, Infinity);
  check('hypsarrhythmia T4-T6 p2p rises vs baseline (high-amplitude)',
    pctP2p(t4t6On) / pctP2p(off.data[idxOff('T4-T6')]), 1.5, Infinity);
  check('hypsarrhythmia Fp1-F3 p2p (PMC7023485: >200 uV)', pctP2p(fp1f3On), 200, 1000, ' uV');
  check('hypsarrhythmia T4-T6 p2p (PMC7023485: >200 uV)', pctP2p(t4t6On), 200, 1000, ' uV');

  // Chaotic/multifocal, contrasted directly against 3hz-gsw's generalised
  // synchrony: two distant chains should correlate weakly for hypsarrhythmia
  // and much more strongly for 3hz-gsw, using the same channel pair pattern
  // (Fp1-F3 vs a second chain) so the contrast is apples-to-apples.
  const hypsCorr = corr(fp1f3On, t4t6On);
  check('hypsarrhythmia Fp1-F3 vs T4-T6 correlation is weak (chaotic/multifocal, not organised)',
    hypsCorr, -0.4, 0.4);

  const gsw = runDisplay('bipolar-ap', 'awake', ['3hz-gsw'], 60, 9);
  const gswCorr = corr(gsw.data[gsw.montage.channels.findIndex((c) => c.label === 'Fp1-F3')],
    gsw.data[gsw.montage.channels.findIndex((c) => c.label === 'Fp2-F4')]);
  check('3hz-gsw bilateral correlation is stronger than hypsarrhythmia (generalised vs multifocal)',
    gswCorr - hypsCorr, 0.1, 2);
}

console.log('\n=== Step 24: non-epileptiform in DISPLAY space (A5 audit) ===\n');

// Step 12 already checks these sources referentially (raw electrode space).
// CLAUDE.md §4 requires the clinical claims specific to each pattern's
// montage-derived shape and topography — FIRDA's frontal-max rhythmicity,
// focal temporal slowing's lateralization, generalized slowing's true
// diffuseness, triphasic waves' AP time lag, and GPEDs/LPEDs periodicity —
// verified on the channel a reader actually reads, not just a spectral
// scalar averaged across all electrodes.

// No existing primitive detects discrete event onsets in a sparse, jittered
// pulse train (GPEDs/LPEDs); autocorr's peak-search is a poor fit for signals
// this sparse (confirmed empirically — it returns no usable secondary peak).
// Threshold-crossing with a refractory period is the standard, simple way to
// recover an inter-discharge-interval series from a periodic-source generator.
function eventIntervals(x: Float64Array, thresholdFrac: number, refractorySec: number): number[] {
  const absMax = Math.max(...Array.from(x, Math.abs));
  const thr = absMax * thresholdFrac;
  const onsets: number[] = [];
  let lastOnset = -Infinity;
  for (let i = 1; i < x.length; i++) {
    const t = i / FS;
    if (Math.abs(x[i]) >= thr && Math.abs(x[i - 1]) < thr && t - lastOnset > refractorySec) {
      onsets.push(t);
      lastOnset = t;
    }
  }
  const intervals: number[] = [];
  for (let i = 1; i < onsets.length; i++) intervals.push(onsets[i] - onsets[i - 1]);
  return intervals;
}

// No existing primitive scans a cross-correlation across a range of lags (the
// DSP module's autocorr is single-signal only); this is the standard way to
// find the timing offset between two related channels for the triphasic-wave
// AP-lag claim.
function bestLag(a: Float64Array, b: Float64Array, maxLagSamples: number): { lag: number; corr: number } {
  let best = -Infinity, bestLagV = 0;
  for (let lag = -maxLagSamples; lag <= maxLagSamples; lag++) {
    let sa = 0, sb = 0, cnt = 0;
    for (let i = 0; i < a.length; i++) {
      const j = i + lag;
      if (j < 0 || j >= b.length) continue;
      sa += a[i]; sb += b[j]; cnt++;
    }
    const ma = sa / cnt, mb = sb / cnt;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) {
      const j = i + lag;
      if (j < 0 || j >= b.length) continue;
      num += (a[i] - ma) * (b[j] - mb);
      da += (a[i] - ma) ** 2; db += (b[j] - mb) ** 2;
    }
    const c = num / Math.sqrt(da * db);
    if (c > best) { best = c; bestLagV = lag; }
  }
  return { lag: bestLagV, corr: best };
}

console.log('FIRDA: frontal-maximal, rhythmic ~1.5-3 Hz, reference-car:');
{
  const fz = displayContrib('reference-car', 'awake', 'firda', 'Fz-AVG', 60, 20);
  const o1 = displayContrib('reference-car', 'awake', 'firda', 'O1-AVG', 60, 20);
  const t3 = displayContrib('reference-car', 'awake', 'firda', 'T3-AVG', 60, 20);
  check('firda Fz-AVG p2p > O1-AVG p2p (frontal-maximal)', pctP2p(fz) / pctP2p(o1), 1.3, 5);
  check('firda Fz-AVG p2p > T3-AVG p2p (frontal-maximal)', pctP2p(fz) / pctP2p(t3), 1.5, 8);
  const pk = spectralPeak(welch(fz, FS, 2048), 1, 4);
  check('firda Fz-AVG discharge frequency (LEARNINGEEG: ~1.5-3 Hz)', pk.freq, 1.5, 3.0, ' Hz');
  check('firda Fz-AVG spectral peak is tight (rhythmic, not polymorphic)', pk.fwhm, 0, 1.2, ' Hz');
  const ac = autocorr(fz, Math.round(FS * 3));
  let bestLagIdx = -1, bestVal = -1;
  for (let i = Math.round(FS * 0.2); i < ac.length; i++) if (ac[i] > bestVal) { bestVal = ac[i]; bestLagIdx = i; }
  check('firda Fz-AVG autocorrelation has a strong secondary peak near its own cycle length (rhythmicity)',
    bestVal, 0.5, 1.0);
  check('firda Fz-AVG secondary-peak lag lands within one ~1.5-3 Hz cycle', bestLagIdx / FS, 0.25, 0.7, ' s');
  renderTrace({ state: 'awake', patterns: ['firda'], montage: 'reference-car', seconds: 6, seed: 20,
    out: `${SCRATCH}/a5-firda-refcar.png` });
}

console.log('\nFocal temporal slowing: lateralized delta/theta, bipolar-ap:');
{
  const t3t5 = displayContrib('bipolar-ap', 'awake', 'focal-delta-temporal', 'T3-T5', 60, 20);
  const t4t6 = displayContrib('bipolar-ap', 'awake', 'focal-delta-temporal', 'T4-T6', 60, 20);
  check('focal-delta-temporal T3-T5 p2p >> T4-T6 p2p (lateralized, LEARNINGEEG: unilateral)',
    pctP2p(t3t5) / pctP2p(t4t6), 20, 1e7);
  const pk = spectralPeak(welch(t3t5, FS, 2048), 0.5, 4);
  check('focal-delta-temporal T3-T5 discharge frequency is delta/theta range', pk.freq, 0.5, 4, ' Hz');
  renderTrace({ state: 'awake', patterns: ['focal-delta-temporal'], montage: 'bipolar-ap', seconds: 6, seed: 20,
    out: `${SCRATCH}/a5-focal-delta-temporal-bipap.png` });
}

console.log('\nGeneralized slowing (moderate): diffuse, symmetric, A-P gradient lost, PDR slowed to theta — reference-ipsi, 3 seeds:');
{
  // What a reader calls moderate generalized slowing (learningeeg, Non-Epileptiform):
  // theta with admixed delta across the WHOLE head, synchronous and symmetric, the
  // A-P gradient lost, and the PDR slowed to theta-range fragments. Asserted in the
  // ear-referenced montage because a common average SUBTRACTS what every electrode
  // shares, and a diffuse field is exactly that.
  //
  // RETIRED 2026-09-11: four reference-car checks that divided Fp1, O1 and T3 by Cz
  // (bounds 0.05-0.4) and asked only that the three ratios resemble each other. They
  // passed at 0.10-0.13 — Cz carrying ~8x the others' power — because a check that
  // divides by Cz cannot see a peak AT Cz. The generator was one patch under Cz; its
  // isolated 1-8 Hz amplitude at Cz was 3.5x the median electrode (IK-024).
  const SEEDS = [42, 7, 1234];
  const amp: Record<string, number[]> = {};
  const p2pOf: Record<string, number[]> = {};
  const postPeak: number[] = [];
  for (const seed of SEEDS) {
    const on = runDisplay('reference-ipsi', 'awake', ['gen-slowing'], 60, seed);
    on.montage.channels.forEach((ch, i) => {
      if (ch.group === 'ecg') return;
      const el = ch.active as string;
      (amp[el] ??= []).push(Math.sqrt(bandPower(on.data[i], 1, 8)));
      (p2pOf[el] ??= []).push(pctP2p(on.data[i]));
      if (el === 'O1' || el === 'O2') postPeak.push(spectralPeak(welch(on.data[i], FS, 1024), 3, 14).freq);
    });
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const A = (el: string) => mean(amp[el]);
  const all = Object.keys(amp).map(A).sort((a, b) => a - b);
  const median = all[Math.floor(all.length / 2)];
  check('gen-slowing quietest region / median, 1-8 Hz amplitude (diffuse: no region spared)', all[0] / median, 0.6, 1);
  check('gen-slowing loudest region / median, 1-8 Hz amplitude (diffuse: no focal maximum)', all[all.length - 1] / median, 1, 1.6);
  for (const [l, r] of [['Fp1', 'Fp2'], ['F7', 'F8'], ['F3', 'F4'], ['T3', 'T4'], ['C3', 'C4'], ['T5', 'T6'], ['P3', 'P4'], ['O1', 'O2']]) {
    check(`gen-slowing ${l}/${r} 1-8 Hz amplitude (symmetric: within 50%)`, A(l) / A(r), 0.67, 1.5);
  }
  const P = (el: string) => mean(p2pOf[el]);
  check('gen-slowing (O1+O2)/(Fp1+Fp2) p2p (A-P gradient lost; ~5 without slowing)',
    (P('O1') + P('O2')) / (P('Fp1') + P('Fp2')), 0, 2);
  check('gen-slowing O1/O2 spectral peak, 3-14 Hz (PDR slowed to theta fragments)',
    mean(postPeak), 3, 7, ' Hz');
  renderTrace({ state: 'awake', patterns: ['gen-slowing'], montage: 'reference-ipsi', seconds: 10, seed: 42,
    out: `${SCRATCH}/a5-gen-slowing-refipsi.png` });
}

console.log('\nGPEDs: periodic, roughly regular interval, generalized, reference-car Cz-AVG:');
{
  const cz = displayContrib('reference-car', 'awake', 'gpeds', 'Cz-AVG', 120, 20);
  const iv = eventIntervals(cz, 0.3, 0.5);
  const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
  const sd = Math.sqrt(iv.reduce((a, b) => a + (b - mean) ** 2, 0) / iv.length);
  check('gpeds Cz-AVG mean inter-discharge interval (LEARNINGEEG: periodic, roughly 1-2.5 s)', mean, 1.0, 2.5, ' s');
  check('gpeds Cz-AVG interval coefficient of variation stays low (periodic, not random)', sd / mean, 0, 0.35);
  const o1 = displayContrib('reference-car', 'awake', 'gpeds', 'O1-AVG', 120, 20);
  check('gpeds present at O1-AVG too (generalized, not focal)', pctP2p(o1), 15, 1e6, ' uV');
  check('gpeds Cz-AVG / O1-AVG p2p ratio stays within a generalized (not sharply focal) range', pctP2p(cz) / pctP2p(o1), 1, 6);
  renderTrace({ state: 'awake', patterns: ['gpeds'], montage: 'reference-car', seconds: 8, seed: 20,
    out: `${SCRATCH}/a5-gpeds-refcar.png` });
}

console.log('\nLPEDs: periodic, roughly regular interval, lateralized, bipolar-ap:');
{
  const t3t5 = displayContrib('bipolar-ap', 'awake', 'lpeds', 'T3-T5', 120, 20);
  const iv = eventIntervals(t3t5, 0.3, 0.4);
  const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
  const sd = Math.sqrt(iv.reduce((a, b) => a + (b - mean) ** 2, 0) / iv.length);
  check('lpeds T3-T5 mean inter-discharge interval (LEARNINGEEG: periodic, roughly 0.8-2 s)', mean, 0.8, 2.0, ' s');
  check('lpeds T3-T5 interval coefficient of variation stays low (periodic, not random)', sd / mean, 0, 0.35);
  const t4t6 = displayContrib('bipolar-ap', 'awake', 'lpeds', 'T4-T6', 120, 20);
  check('lpeds T3-T5 p2p >> T4-T6 p2p (lateralized, unlike GPEDs)', pctP2p(t3t5) / pctP2p(t4t6), 20, 1e7);
  renderTrace({ state: 'awake', patterns: ['lpeds'], montage: 'bipolar-ap', seconds: 8, seed: 20,
    out: `${SCRATCH}/a5-lpeds-bipap.png` });
}

console.log('\nTriphasic waves: classic 3-phase morphology with anterior->posterior time lag, reference-ipsi (A1 mastoid ref avoids CAR self-subtraction):');
{
  // reference-car is unsuitable here: the anterior source's broad reach
  // drags the common average toward its own unlagged waveform, injecting an
  // artifactual unlagged copy back into every AVG-referenced channel and
  // masking the lag (confirmed empirically). reference-ipsi (a single-
  // electrode A1/A2 mastoid reference, not an average) doesn't have this
  // self-subtraction property — same rationale as the existing "14 & 6
  // positive bursts" check's use of reference-contra over reference-car.
  const fz = displayContrib('reference-ipsi', 'awake', 'triphasic', 'Fz-A1', 60, 20);
  const pz = displayContrib('reference-ipsi', 'awake', 'triphasic', 'Pz-A1', 60, 20);
  const o1 = displayContrib('reference-ipsi', 'awake', 'triphasic', 'O1-A1', 60, 20);
  const lagPz = bestLag(fz, pz, Math.round(FS * 0.6));
  const lagO1 = bestLag(fz, o1, Math.round(FS * 0.6));
  check('triphasic Fz-A1 leads Pz-A1 (positive lag = posterior follows anterior)', lagPz.lag / FS, 0.008, 0.2, ' s');
  check('triphasic Fz-A1 vs Pz-A1 lagged correlation is a real, positive relationship', lagPz.corr, 0.15, 1.0);
  check('triphasic Fz-A1 leads O1-A1 (positive lag = posterior follows anterior)', lagO1.lag / FS, 0.008, 0.2, ' s');
  check('triphasic Fz-A1 vs O1-A1 lagged correlation is a real, positive relationship', lagO1.corr, 0.08, 1.0);
  check('triphasic Fz-A1 p2p > O1-A1 p2p (anterior-predominant amplitude gradient preserved)',
    pctP2p(fz) / pctP2p(o1), 1.3, 20);
  renderTrace({ state: 'awake', patterns: ['triphasic'], montage: 'bipolar-ap', seconds: 6, seed: 20,
    out: `${SCRATCH}/a5-triphasic-bipap.png` });
  renderTrace({ state: 'awake', patterns: ['triphasic'], montage: 'reference-car', seconds: 6, seed: 20,
    out: `${SCRATCH}/a5-triphasic-refcar.png` });
}

console.log('\n' + '='.repeat(60));
// ---------------------------------------------------------------------------
// Knowledge-base status audit — make INFORMING-KNOWLEDGE.md's status field
// load-bearing instead of decorative.
//
// Every entry in that file names the check(s) that enforce it and carries a
// status. Until 2026-09-01 nothing connected the two, and the result was exactly
// what you would predict: all 36 entries read `enforced (automated)`, four of
// their checks were red, and one of those entries also quoted a passing figure it
// had long since stopped producing. The file defines `violated` and had never
// used it, so a red check could sit indefinitely behind a green-looking entry.
//
// This closes the loop in both directions:
//   - an entry claiming `enforced` whose named check is FAILING is a lie, and
//   - an entry marked `violated` whose named checks all PASS is a stale defect
//     report that should be promoted back.
// Either fails the gate, so the status has to be maintained to stay green.
//
// Matching note: the markdown wraps long labels across lines and abbreviates the
// tail with an ellipsis, so a citation is normalised (whitespace collapsed, cut
// at the ellipsis) and matched as a PREFIX of the real labels. Citations matching
// nothing are reported but do not fail — some are deliberate (a retired check an
// entry documents as retired) and some are placeholders standing for a family of
// generated labels. They are listed so an entry that guards nothing stays visible.
console.log('Knowledge-base status audit (INFORMING-KNOWLEDGE.md):');
{
  const ikPath = fileURLToPath(new URL('../../INFORMING-KNOWLEDGE.md', import.meta.url));
  const ik = readFileSync(ikPath, 'utf8');

  const parts = ik.split(/^### (IK-\d+)[^\n]*$/m);
  const entries: { id: string; status: string; cited: string[] }[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    // An entry's body ends at the next entry OR the next section heading. Without
    // the second boundary the trailing section 11 "Conflicts and open questions"
    // prose -- which names retired and violated checks -- was folded into whichever
    // entry came last, and would have blamed it for a failure it does not claim.
    const id = parts[i];
    const body = (parts[i + 1] ?? '').split(/^## /m)[0];
    const status = (body.match(/\*\*Status\.\*\*\s*([a-z ()]+)/) ?? [, '?'])[1].trim();
    const cited = [...body.matchAll(/check\('([^']+)'/g)]
      .map((m) => m[1].split('…')[0].replace(/\s+/g, ' ').trim())
      .filter((l) => l.length >= 12);
    entries.push({ id, status, cited });
  }

  // Compare on alphanumerics only. The markdown hard-wraps inside a quoted label,
  // and a wrap landing mid-word survives whitespace collapsing as "beta- range",
  // which no real label contains -- so a purely textual prefix match reports a live
  // check as unguarded. Stripping punctuation and case makes the comparison
  // indifferent to where the line happened to break.
  const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

  const unmatched: string[] = [];
  let bad = 0;
  for (const e of entries) {
    const matched = e.cited.flatMap((c) => {
      const hits = results.filter((r) => key(r.label).startsWith(key(c)));
      if (hits.length === 0) unmatched.push(`${e.id}: ${c}`);
      return hits;
    });
    const red = matched.filter((r) => !r.ok);
    if (e.status.startsWith('enforced') && red.length > 0) {
      bad++; failures++;
      console.log(`  FAIL ${e.id} says "${e.status}" but ${red.length} of its check(s) are RED:`);
      for (const r of red) console.log(`         - ${r.label}`);
    }
    // An entry claiming automated enforcement whose citations resolve to NO real
    // check is guarded by nothing, however green the gate looks. Nothing trips this
    // today; it exists so a typo in a Check field, or a check renamed out from under
    // an entry, is caught at the moment it happens rather than years later by an
    // audit. Entries with no Check at all carry a status other than `enforced`.
    if (e.status.startsWith('enforced') && e.cited.length > 0 && matched.length === 0) {
      bad++; failures++;
      console.log(`  FAIL ${e.id} says "${e.status}" but none of its ${e.cited.length} cited check(s) exist`);
    }
    if (e.status === 'violated' && matched.length > 0 && red.length === 0) {
      bad++; failures++;
      console.log(`  FAIL ${e.id} says "violated" but all ${matched.length} of its checks now PASS`);
      console.log('         - promote it back to enforced (automated), or narrow the claim');
    }
  }
  console.log(`  ${entries.length} entries audited; ${bad} status mismatch(es).`);
  if (unmatched.length) {
    console.log(`  note: ${unmatched.length} cited label(s) matched no check (retired, or a`);
    console.log('        placeholder for generated labels) - not a failure:');
    for (const u of unmatched) console.log(`         - ${u}`);
  }
}

console.log(`
Near-bound review: ${nearBound.length} passing check(s) within ${NEAR_BOUND_FRACTION * 100}% of a bound.`);
console.log('  Each needs a stated reason in the report: is the MODEL wrong (the bound let it through), or');
console.log('  the BOUND (then say where its number comes from)? "It passes" is not a reason. CLAUDE.md §7.');
for (const n of nearBound) console.log(`  - ${n}`);
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

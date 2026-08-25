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
import {
  electrodeDistanceCm, sourceUnder, buildLeadfield,
} from '../../artifacts/eeg-simulator/src/engine/forward';
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
import { MONTAGES } from '../../artifacts/eeg-simulator/src/utils/montages';
import { commonAverage, computeChannelVoltage } from '../../artifacts/eeg-simulator/src/utils/computeChannel';
import { defaultArtifactParams, defaultIctalParamsMap, type SimSettings } from '../../artifacts/eeg-simulator/src/utils/simTypes';
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

let failures = 0;
function check(label: string, actual: number, lo: number, hi: number, unit = '') {
  const ok = actual >= lo && actual <= hi;
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
  check('mean corr, distant (>16 cm)', mean(far), -0.35, 0.45);
  check('near exceeds far', mean(near) - mean(far) > 0.2 ? 1 : 0, 1, 1);
}

// --- 6b. Alpha must be posterior. §11.5 lists band-power topography as a
// required spatial check, and a posterior alpha maximum is the single most
// recognisable feature of an awake EEG.
console.log('\nAlpha topography:');
{
  const { eng, data } = runEngine(120, { seed: 5, artifacts: false, recordingChain: false,
    subject: { iaf: 10, alphaRms: 16, vigilanceBias: 0.62 } });
  const at = (n: string) => bandPower(data[eng.indexOf(n)], 8, 12);
  const post = (at('O1') + at('O2') + at('P3') + at('P4')) / 4;
  const ant = (at('Fp1') + at('Fp2') + at('F7') + at('F8')) / 4;
  // Upper bound is a sanity guard against alpha vanishing anteriorly altogether,
  // not a measured clinical figure — this is a POWER ratio, so 200 is only ~14x
  // in amplitude, still inside what a normal awake record shows. It used to be
  // 100, which the always-on background mu passed only because that mu was
  // misplaced: built tangential, it was zero at its own C3/C4 anchor and dumped
  // its peak into F3/F4 instead, inflating the anterior denominator with what a
  // reader would call frontal alpha. Fixing mu to radial (engine.ts) moved that
  // power back to C3/C4 and took the ratio 64 -> 112. The rise is the bug
  // leaving, not alpha becoming unphysiologically posterior.
  check('posterior / anterior alpha power', post / ant, 2.0, 200);
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
  const OPTS: EngineOptions = { seed: 5, artifacts: false, recordingChain: false,
    subject: { iaf: 10, alphaRms: 16, vigilanceBias: 0.62 } };
  const closed = runEngineState(120, OPTS, 'awake', []);
  const open = runEngineState(120, OPTS, 'awake', ['eyes-open']);
  const bipAlpha = (r: typeof closed, a: string, b: string) => {
    const x = r.data[r.eng.indexOf(a)], y = r.data[r.eng.indexOf(b)];
    const d = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) d[i] = x[i] - y[i];
    return bandPower(d, 8, 12);
  };
  // Posterior link dominates the one in front of it: alpha is read off P4-O2, not C4-P4.
  check('P4-O2 / C4-P4 alpha power (PDR on the posterior link, not central-parietal)',
    bipAlpha(closed, 'P4', 'O2') / bipAlpha(closed, 'C4', 'P4'), 1.2, 1e6);
  // The posterior-temporal link carries the PDR too, unlike anterior-temporal F8-T4.
  check('T6-O2 / F8-T4 alpha power (PDR reaches posterior temporal, not anterior)',
    bipAlpha(closed, 'T6', 'O2') / bipAlpha(closed, 'F8', 'T4'), 4.0, 1e6);
  // Alpha reactivity: eye opening attenuates the posterior rhythm to a fraction.
  check('P4-O2 alpha, eyes-open / eyes-closed (Berger effect attenuation)',
    bipAlpha(open, 'P4', 'O2') / bipAlpha(closed, 'P4', 'O2'), 0, 0.45);
  // Mu does NOT react to eye opening (IK-007): while posterior alpha collapses,
  // the sensorimotor rhythm at C3/C4 persists — it is precisely this differential
  // reactivity that tells the two 8-13 Hz rhythms apart (IK-006). The eyes-open
  // bandGate formerly gated `mu` to 0.35 alongside `alpha`, erasing the
  // discriminator; with that removed, the mu-dominated 8-13 Hz power at C3+C4 is
  // largely preserved across the transition (a small residual dip is the
  // attenuated posterior-alpha field spilling into the central electrodes, not mu
  // reacting). Referential C3/C4 read here because reactivity is a spectral
  // question (CLAUDE.md §4).
  const muBand = (r: typeof closed, e: string) => bandPower(r.data[r.eng.indexOf(e)], 8, 13);
  check('C3+C4 mu-band, eyes-open / eyes-closed (mu does not block; IK-007)',
    (muBand(open, 'C3') + muBand(open, 'C4')) / (muBand(closed, 'C3') + muBand(closed, 'C4')),
    0.8, 1.25);
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
      const eng = new EegEngine({ ...POL_OPTS, artifacts: true, recordingChain: true });
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
  const czP2p = pctP2p(cz(v.data, v.eng));
  check('Cz p2p, v-waves on / off', czP2p / baseCzP2p, 1.4, 50);
  // The v-wave is a ~2 Hz sharp transient; its own low-band contribution is central.
  check('low-freq contribution O1 / Cz (central-max)', contrib(v, 'O1', 1, 6) / contrib(v, 'Cz', 1, 6), -0.2, 0.5);
}

console.log('\nK-complexes (large biphasic, frontocentral, N2):');
{
  const k = runEngineState(180, SLEEP_OPTS, 'awake', ['k-complex']);
  const czP2p = pctP2p(cz(k.data, k.eng));
  const o1P2p = pctP2p(o1c(k.data, k.eng));
  // The largest sleep transient: it must dominate the vertex.
  check('Cz p2p, k-complex on / off', czP2p / baseCzP2p, 1.8, 50);
  check('Cz p2p, k-complex (sanity floor)', czP2p, 90, 700, ' uV');
  check('Cz p2p / O1 p2p (frontocentral)', czP2p / o1P2p, 1.5, 50);
}

console.log('\nPOSTS (positive occipital sharp transients, N1/N2):');
{
  const p = runEngineState(180, SLEEP_OPTS, 'awake', ['posts']);
  const o1P2p = pctP2p(o1c(p.data, p.eng));
  const czP2p = pctP2p(cz(p.data, p.eng));
  // POSTS add a fixed ~25-30 uV occipital transient. The on/off ratio is measured
  // against `baseO1P2p`, the awake occipital background — which the IK-006
  // topography fix (engine.ts: PDR anchored at the occipital pole) legitimately
  // raised, moving the alpha maximum from parietal back to O1/O2 where it belongs.
  // Posts are therefore relatively less prominent against a correctly stronger
  // background (1.39 -> 1.25), but must still clearly raise O1; the occipital-
  // maximum check below is the stronger assertion and is unaffected.
  check('O1 p2p, posts on / off', o1P2p / baseO1P2p, 1.2, 50);
  check('O1 p2p / Cz p2p (occipital-maximal)', o1P2p / czP2p, 1.2, 50);
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

console.log('Mu rhythm (8-12 Hz, arciform, central; tangential -> nulls at C3):');
{
  const m = runEngineState(180, SLEEP_OPTS, 'awake', ['mu-rhythm']);
  // The mu source is tangential (sulcal), like the engine's own background mu, so
  // its derivative-of-Gaussian field NULLS directly over C3 and peaks at the
  // flanking electrodes. Probe the central neighbourhood, not C3 itself, and
  // require it to rise while the posterior rhythm (O1) is left untouched — mu is
  // a central, not a posterior, rhythm.
  const bp = (r: typeof base, n: string) => bandPower(r.data[r.eng.indexOf(n)], 8, 12);
  // Peak flanks of the two tangential sources: both muL (under C3) and muR (under
  // C4) steer toward the vertex, so Cz catches both superior lobes; T3/T4 catch
  // the inferior lobes. F3/P3 sit off-axis and only add background-alpha dilution.
  const centralOn = bp(m, 'Cz') + bp(m, 'T3') + bp(m, 'T4');
  const centralOff = bp(base, 'Cz') + bp(base, 'T3') + bp(base, 'T4');
  check('mu central-flank 8-12 power, mu-rhythm on / off', centralOn / centralOff, 1.2, 50);
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
  check('T3 p2p, bets on / off (drowsy)', t3P2p / baseCzP2p, 0.3, 3);
  check('T4 p2p, bets on / off (drowsy)', t4P2p / baseCzP2p, 0.3, 3);
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
  check('referential corr T3-F7 (shared source, same polarity)', corr(t3Mid, f7Mid), 0.6, 1.0);
  check('referential corr T3-T5 (shared source, same polarity)', corr(t3Mid, t5Mid), 0.6, 1.0);
  check('F7 theta / T3 theta (ripples out, but attenuated)',
    bandPower(f7Mid, 3.5, 6) / bandPower(t3Mid, 3.5, 6), 0.05, 0.9);
  check('T5 theta / T3 theta (ripples out, but attenuated)',
    bandPower(t5Mid, 3.5, 6) / bandPower(t3Mid, 3.5, 6), 0.05, 0.9);
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
  check('referential corr T4-F8 (shared source, same polarity)', corr(t4Mid, f8Mid), 0.6, 1.0);
  check('referential corr T4-T6 (shared source, same polarity)', corr(t4Mid, t6Mid), 0.6, 1.0);
  check('F8 theta / T4 theta (ripples out, but attenuated)',
    bandPower(f8Mid, 3.5, 6) / bandPower(t4Mid, 3.5, 6), 0.05, 0.9);
  check('T6 theta / T4 theta (ripples out, but attenuated)',
    bandPower(t6Mid, 3.5, 6) / bandPower(t4Mid, 3.5, 6), 0.05, 0.9);
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
  // model that all of them share, using a synthetic spec anchored at the F8/T4
  // midpoint. It is a claim about the leadfield, not about any one pattern.
  const spec = sourceUnder('synthetic-fronto-temporal', ['F8', 'T4'], { extent: 0.35 });
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
    sweat: false, line: false, ecgScalp: false, movement: false,
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
    check('T4 RMS while detached / before', std(slice(t4, 20, 38)) / base4, 0, 0.15);
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
    check('nuchal EMG: O1 / Fz 20-70 Hz power', hb(nuchal.at('O1')) / hb(nuchal.at('Fz')), 2, 1e9);
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
  const czP2p = pctP2p(diff);
  const o1P2p = pctP2p(displayContrib('reference-car', 'awake', 'spindles', 'O1-AVG', 180, 20));
  check('spindle Cz-AVG p2p / O1-AVG p2p (central, not occipital)', czP2p / Math.max(o1P2p, 1e-6), 3, 1e6);
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

console.log('\nN3: high-amplitude (>75 uV) generalized delta (0.5-2 Hz), reference-car:');
{
  const { montage, data } = runDisplay('reference-car', 'n3', [], 180, 42);
  // A spread of frontal/central/temporal/occipital/midline channels stands in
  // for "generalized" without asserting all 19.
  const reps = ['Fp1-AVG', 'Fz-AVG', 'C3-AVG', 'Cz-AVG', 'T5-AVG', 'O1-AVG', 'Pz-AVG'];
  for (const label of reps) {
    const ci = montage.channels.findIndex((c) => c.label === label);
    check(`N3 ${label} p2p (>75 uV, IK-A3-e)`, pctP2p(data[ci]), 75, 500, ' uV');
  }
  const czIdx = montage.channels.findIndex((c) => c.label === 'Cz-AVG');
  const pk = spectralPeak(welch(data[czIdx], FS, 2048), 0.3, 4);
  check('N3 Cz-AVG dominant frequency', pk.freq, 0.5, 2, ' Hz');
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
  // LEARNINGEEG-STUDY.md §2: adult default 30 mm/s. The UI's own speed options
  // (simTypes.ts SPEED_VALUES) are 10 | 20 | 30.
  for (const speed of [10, 20, 30] as const) {
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

  const yOffsetPositive = vSurfacePositive * res.pxPerUV; // y - centerY, canvas y grows down
  const yOffsetNegative = vSurfaceNegative * res.pxPerUV;
  check('surface-positive (+50 µV) deflects DOWN (y - centerY > 0)', yOffsetPositive, 0.01, Infinity, ' px');
  check('surface-negative (-50 µV) deflects UP (y - centerY < 0)', yOffsetNegative, -Infinity, -0.01, ' px');
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
// NOT asserted: parietal > central. Measured (P3+P4)/(C3+C4) = 0.95. Central
// still outranks parietal because every subject gets an always-on,
// full-strength mu rhythm (STATE_GAINS.awake.mu = 1.00), worth ~5.5 uV RMS at
// C3; zeroing it takes the ratio to 1.08 with the whole ordering correct. Real
// mu is present in a minority of adults and is not a universal background
// component, but changing that gain is out of scope here, so the shortfall is
// recorded rather than asserted.
{
  const SEEDS = [42, 7, 1234];
  const p2p: Record<string, number[]> = {};
  const cent: Record<string, number[]> = {};
  for (const seed of SEEDS) {
    const { montage, data } = runDisplay('reference-ipsi', 'awake', [], 60, seed);
    montage.channels.forEach((ch, i) => {
      if (ch.group === 'ecg') return;
      const el = ch.active as string;
      (p2p[el] ??= []).push(pctP2p(data[i]));
      // Spectral centroid over 2-30 Hz: one number for "faster" vs "slower"
      // without committing to a band. Below 2 Hz is the amplifier corner,
      // above 30 Hz is muscle and mains.
      const psd = welch(data[i], FS, 2048);
      let num = 0, den = 0;
      for (let k = 0; k < psd.freqs.length; k++) {
        const f = psd.freqs[k];
        if (f < 2 || f > 30) continue;
        num += f * psd.power[k];
        den += psd.power[k];
      }
      (cent[el] ??= []).push(num / den);
    });
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const A = (el: string) => mean(p2p[el]);
  const C = (el: string) => mean(cent[el]);
  const all = Object.keys(p2p).map(A);

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
  // Magnitude of the whole gradient. learningeeg's ap-gradient reference image
  // reads ~3-4x; the band admits normal variation without letting the gradient
  // collapse back to the 2.2x it had, or run away past a plausible ceiling.
  check('(O1+O2) / (Fp1+Fp2) p2p (front-to-back magnitude, LEARNINGEEG §3)', (A('O1') + A('O2')) / (A('Fp1') + A('Fp2')), 1.8, 5);
  // Frequency half of the gradient: "faster towards the front".
  check('frontopolar / occipital spectral centroid, 2-30 Hz (AP gradient in FREQUENCY, LEARNINGEEG §3)', (C('Fp1') + C('Fp2')) / (C('O1') + C('O2')), 1.1, 3);
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
  // synthetic-leadfield precedent (sourceUnder(['F8','T4']) for the static-gain
  // check), this builds the same midpoint anchor but drives it as a genuine
  // TIME SERIES through spikeSlowWave and the real computeChannelVoltage, on
  // the actual Fp2-F8/F8-T4/T4-T6/T6-O2 bipolar-ap channel definitions — a
  // true display-space check, not a bare static leadfield-gain comparison.
  const spec = sourceUnder('synthetic-spike-midway-f8-t4', ['F8', 'T4'], { extent: 0.25 });
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
  check('hypsarrhythmia Fp1-F3 p2p rises vs baseline (high-amplitude)',
    pctP2p(fp1f3On) / pctP2p(off.data[idxOff('Fp1-F3')]), 1.5, 12);
  check('hypsarrhythmia T4-T6 p2p rises vs baseline (high-amplitude)',
    pctP2p(t4t6On) / pctP2p(off.data[idxOff('T4-T6')]), 1.5, 12);

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
  check('firda Fz-AVG discharge frequency (LEARNINGEEG: ~1.5-3 Hz)', pk.freq, 1.5, 3.5, ' Hz');
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

console.log('\nGeneralized slowing: truly diffuse (not focal), reference-car, ON-state delta+theta power ratio to Cz:');
{
  // Direct ON-state bandPower, not the on-off DIFF: gen-slowing carries a
  // bandGate that suppresses the posterior alpha PDR, which leaks power
  // below 8 Hz into the on-off diff specifically at posterior electrodes
  // (where baseline alpha is largest) and falsely looks non-diffuse. The
  // raw ON-state ratio to Cz isolates the added slow-wave topography itself.
  const on = runDisplay('reference-car', 'awake', ['gen-slowing'], 60, 20);
  const chOf = (label: string) => on.montage.channels.findIndex((c) => c.label === label);
  const dCz = bandPower(on.data[chOf('Cz-AVG')], 1, 8);
  const dFp1 = bandPower(on.data[chOf('Fp1-AVG')], 1, 8);
  const dO1 = bandPower(on.data[chOf('O1-AVG')], 1, 8);
  const dT3 = bandPower(on.data[chOf('T3-AVG')], 1, 8);
  check('gen-slowing Fp1-AVG delta+theta power / Cz-AVG (diffuse: comparable across regions)', dFp1 / dCz, 0.05, 0.4);
  check('gen-slowing O1-AVG delta+theta power / Cz-AVG (diffuse: comparable across regions)', dO1 / dCz, 0.05, 0.4);
  check('gen-slowing T3-AVG delta+theta power / Cz-AVG (diffuse: comparable across regions)', dT3 / dCz, 0.05, 0.4);
  check('gen-slowing diffuseness spread: max/min of the three regional ratios stays tight (no focal outlier)',
    Math.max(dFp1, dO1, dT3) / Math.min(dFp1, dO1, dT3), 1, 2.5);
  renderTrace({ state: 'awake', patterns: ['gen-slowing'], montage: 'reference-car', seconds: 6, seed: 20,
    out: `${SCRATCH}/a5-gen-slowing-refcar.png` });
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
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

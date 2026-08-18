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
  EegEngine, sampleSubject, type EngineOptions, type ArtifactGates,
} from '../../artifacts/eeg-simulator/src/engine/engine';
import {
  electrodeDistanceCm, sourceUnder, buildLeadfield,
} from '../../artifacts/eeg-simulator/src/engine/forward';
import type { PatientState, ArtifactParams } from '../../artifacts/eeg-simulator/src/utils/simTypes';
import {
  welch, fitAperiodic, std, kurtosis, autocorr, hilbertEnvelope, dfa, spectralPeak, skewness,
} from './dsp';

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
      return { widthMs, slowRatio: slow / Math.abs(peak) };
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
    ['BETS T3',                  'awake', 'bets',            'T3', 'lead', -1],
    // Surface-POSITIVE transients — named for their polarity, must point DOWN.
    ['POSTS O1',                 'awake', 'posts',           'O1', 'lead',  1],
    ['lambda O1',                'awake', 'lambda',          'O1', 'lead',  1],
    ['triphasic Fz (dominant)',  'awake', 'triphasic',       'Fz', 'lead',  1],
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

console.log('\nBETS (very brief <50ms, low-amplitude, temporal, alternating side):');
{
  const bt = runEngineState(180, SLEEP_OPTS, 'awake', ['bets']);
  const t3P2p = pctP2p(bt.data[bt.eng.indexOf('T3')]);
  const t4P2p = pctP2p(bt.data[bt.eng.indexOf('T4')]);
  check('T3 p2p, bets on / off', t3P2p / baseCzP2p, 0.3, 3);
  check('T4 p2p, bets on / off', t4P2p / baseCzP2p, 0.3, 3);
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

console.log('\n' + '='.repeat(60));
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

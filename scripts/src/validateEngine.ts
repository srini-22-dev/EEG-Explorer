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
import { EegEngine, sampleSubject, type EngineOptions } from '../../artifacts/eeg-simulator/src/engine/engine';
import { electrodeDistanceCm } from '../../artifacts/eeg-simulator/src/engine/forward';
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
  check('posterior / anterior alpha power', post / ant, 2.0, 100);
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
    blink: false, saccade: false, emg: false, pop: false,
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

console.log('\n' + '='.repeat(60));
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

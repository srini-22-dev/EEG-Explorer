import { welch, spectralPeak } from '../dsp';
import { FS, SLEEP_OPTS, bandPower, base, check, contrib, pctP2p, runEngineState, section, step } from './harness';

step('\n=== Step 15: interictal epileptiform (pattern sources) ===\n');

section('Focal left temporal spikes (T3-maximal):', () => {
  const s = runEngineState(180, SLEEP_OPTS, 'awake', ['focal-spikes-lt']);
  const t3P2p = pctP2p(s.data[s.eng.indexOf('T3')]);
  const baseT3P2p = pctP2p(base.data[base.eng.indexOf('T3')]);
  check('T3 p2p, focal-spikes-lt on / off', t3P2p / baseT3P2p, 1.5, 150);
  check('low-freq contrib Fp2 / T3 (focal, not diffuse)',
    contrib(s, 'Fp2', 1, 20) / contrib(s, 'T3', 1, 20), -0.3, 0.4);
});

section('\nFocal right temporal spikes (T4-maximal):', () => {
  const s = runEngineState(180, SLEEP_OPTS, 'awake', ['focal-spikes-rt']);
  check('T4 p2p, focal-spikes-rt on / off',
    pctP2p(s.data[s.eng.indexOf('T4')]) / pctP2p(base.data[base.eng.indexOf('T4')]), 1.5, 150);
});

section('\nFocal left frontal spikes (F3-maximal):', () => {
  const s = runEngineState(180, SLEEP_OPTS, 'awake', ['focal-spikes-lf']);
  check('F3 p2p, focal-spikes-lf on / off',
    pctP2p(s.data[s.eng.indexOf('F3')]) / pctP2p(base.data[base.eng.indexOf('F3')]), 1.5, 150);
  check('low-freq contrib O1 / F3 (focal, not diffuse)',
    contrib(s, 'O1', 1, 20) / contrib(s, 'F3', 1, 20), -0.3, 0.4);
});

section('\n3 Hz generalised spike-wave (frontally-max, ~3 Hz):', () => {
  const s = runEngineState(180, SLEEP_OPTS, 'awake', ['3hz-gsw']);
  const peak = spectralPeak(welch(s.data[s.eng.indexOf('Fz')], FS, 4096), 2, 4);
  check('Fz spectral peak near 3 Hz', peak.freq, 2.6, 3.4, ' Hz');
  check('Fz p2p, 3hz-gsw on / off',
    pctP2p(s.data[s.eng.indexOf('Fz')]) / pctP2p(base.data[base.eng.indexOf('Fz')]), 1.5, 200);
});

section('\nPolyspike-wave (frontally-max, JME pattern):', () => {
  const s = runEngineState(180, SLEEP_OPTS, 'awake', ['polyspike-wave']);
  check('Fz p2p, polyspike-wave on / off',
    pctP2p(s.data[s.eng.indexOf('Fz')]) / pctP2p(base.data[base.eng.indexOf('Fz')]), 1.5, 200);
});

section('\nBurst-suppression (gate: bimodal amplitude, not additive):', () => {
  const s = runEngineState(180, SLEEP_OPTS, 'awake', ['burst-suppression']);
  const czBs = s.data[s.eng.indexOf('Cz')], czBase = base.data[base.eng.indexOf('Cz')];
  check('Cz p2p, burst-suppression on / off', pctP2p(czBs) / pctP2p(czBase), 1.3, 25);
  // Most of the record sits in the 0.04x suppressed floor, so the 25th percentile
  // of |amplitude| should collapse vs baseline — this is what distinguishes a
  // genuine suppression/burst gate from a simple amplitude boost.
  const p25abs = (x: Float64Array) =>
    Array.from(x, Math.abs).sort((a, b) => a - b)[Math.floor(0.25 * x.length)];
  check('Cz 25th-pct |amp|, burst-suppression on / off', p25abs(czBs) / p25abs(czBase), 0, 0.9);
});

section('\nHypsarrhythmia (diffuse desynchronised delta + multifocal spikes):', () => {
  const s = runEngineState(180, SLEEP_OPTS, 'awake', ['hypsarrhythmia']);
  const lowOn = (n: string) => bandPower(s.data[s.eng.indexOf(n)], 1, 4);
  const lowOff = (n: string) => bandPower(base.data[base.eng.indexOf(n)], 1, 4);
  check('Fz low-freq power, hyps on / off', lowOn('Fz') / lowOff('Fz'), 3, 1e6);
  check('O1 low-freq power, hyps on / off', lowOn('O1') / lowOff('O1'), 3, 1e6);
  check('F3 p2p, hyps on / off (multifocal spikes)',
    pctP2p(s.data[s.eng.indexOf('F3')]) / pctP2p(base.data[base.eng.indexOf('F3')]), 1.8, 150);
});

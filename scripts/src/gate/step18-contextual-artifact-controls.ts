import { EegEngine } from '../../../artifacts/eeg-simulator/src/engine/engine';
import type { EngineOptions, ArtifactGates } from '../../../artifacts/eeg-simulator/src/engine/engine';
import type { ArtifactParams } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
import { welch, std, spectralPeak } from '../dsp';
import { ALL_ELECTRODES } from '../../../artifacts/eeg-simulator/src/utils/montages';
import { FS, bandPower, check, section, step } from './harness';

step('\n=== Step 18: contextual artifact controls (ArtifactParams) ===\n');
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

const ART_OPTS: EngineOptions = {
  seed: 31, subject: { artifactBurden: 0.01, lineAmp: 0, alphaRms: 12 },
};
const GATES_OFF: ArtifactGates = {
  blink: false, eyeOpening: false, saccade: false, flutter: false, emg: false, pop: false,
  sweat: false, line: false, ecgScalp: false, movement: false, defects: false, respiration: false, ventilator: false, pulse: false, ivDrip: false,
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

section('Electrode detachment (pop, then flat until reattached):', () => {
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
});

// --- 18b. A pop is one electrode, not a field. It bypasses the leadfield, so
// the contribution at every other electrode must be identically zero — that
// spatial discontinuity is how a reader tells a bad lead from a generator.

section('\nPop targeting (one electrode, no field):', () => {
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
});

// --- 18c. Which muscle is contracting decides which channels are ruined. This
// is the clinical content of the muscle-group selector: the same "EMG" toggle
// has to be able to produce a temporal, a frontal or a posterior record.

section('\nMuscle territories (which muscle decides which channels):', () => {
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
});

// --- 18d. Mains: 50 Hz or 60 Hz depending on where the record was made, and an
// amplitude the user controls. The amplitude control is what makes the toggle
// mean anything: this subject's own sampled `lineAmp` is 0, and `sampleSubject`
// draws 0 for about half of all subjects, so without it the toggle is a no-op.

section('\nMains interference (50/60 Hz, amplitude):', () => {
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
});

// --- 18e. Cardiac: the rate control, and the property the pattern description
// tells the learner to use — every scalp transient lines up with an R wave on
// the ECG trace. That only holds because both now read one heart; two
// independently seeded generators would score ~1 on the alignment check.

section('\nCardiac (rate control, scalp artifact aligned with the ECG trace):', () => {
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
});

import { defaultArtifactParams, defaultIctalParamsMap } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
import type { PatientState, SimSettings } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
import { SimulationSource } from '../../../artifacts/eeg-simulator/src/engine/adapter';
import { MONTAGES } from '../../../artifacts/eeg-simulator/src/utils/montages';
import { commonAverage, computeChannelVoltage } from '../../../artifacts/eeg-simulator/src/utils/computeChannel';
import { PATTERN_CATEGORIES } from '../../../artifacts/eeg-simulator/src/utils/patterns';
import { PATTERN_INFO } from '../../../artifacts/eeg-simulator/src/utils/patternInfo';
import { PATTERN_GALLERY } from '../../../artifacts/eeg-simulator/src/utils/patternGallery';
import type { ArtifactMark } from '../../../artifacts/eeg-simulator/src/engine/engine';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FS, absPeak, bandPower, check, corr, section, step } from './harness';

step('\n=== Step 28: normal variants and artifacts against SCORE, eegpedia, learningeeg and the IFCN glossary (2026-10-27) ===\n');
// The owner's list (idea-vault inbox, 2026-10-27): wickets, RMTD, small sharp spikes,
// breach, 6 Hz phantom, 14 & 6, slow-fused transients; ECG, blinks / eye flutter,
// muscle, lateral rectus spikes, electrode pop, mains. Sources: the SCORE normal
// variants study (Clin Neurophysiol Pract 2022, PMC9294211), eegpedia, learningeeg,
// the IFCN glossary (Kane et al. 2017), EEG Atlas online, Thickbroom & Mastaglia 1985.
// Every toggle is run as the app runs it (useAppMode), with its marks.

type Po = SimSettings['patternOptions'];
const runApp = (montageId: string, state: PatientState, patterns: string[], secs: number, seed: number, po?: Po) => {
  const montage = MONTAGES[montageId];
  const settings: SimSettings = {
    speed: 30, sensitivity: 7, patientState: state, activePatterns: new Set(patterns),
    ictalParams: defaultIctalParamsMap(), artifactParams: { ...defaultArtifactParams() }, patternOptions: po,
  };
  const src = new SimulationSource(seed, FS);
  src.useAppMode();
  const n = Math.floor(secs * FS);
  const data: Record<string, Float64Array> = {};
  montage.channels.forEach((c) => { data[c.label] = new Float64Array(n); });
  const marks: { i: number; m: ArtifactMark }[] = [];
  for (let i = 0; i < n; i++) {
    const v = src.next(settings);
    const avg = commonAverage(v);
    for (const c of montage.channels) data[c.label][i] = computeChannelVoltage(c, src.t, v, avg);
    for (const m of src.groundTruth.marks) marks.push({ i, m: { ...m } });
  }
  return { data, marks };
};
const isoApp = (montageId: string, state: PatientState, patterns: string[], secs: number, seed: number, po?: Po) => {
  const on = runApp(montageId, state, patterns, secs, seed, po);
  const off = runApp(montageId, state, [], secs, seed, po);
  const d: Record<string, Float64Array> = {};
  for (const k in on.data) d[k] = on.data[k].map((v, i) => v - off.data[k][i]);
  return { d, marks: on.marks, on: on.data, off: off.data };
};
const pctP2pOf = (x: Float64Array) => {
  const s = Array.from(x).sort((a, b) => a - b);
  return s[Math.floor(0.99 * (s.length - 1))] - s[Math.floor(0.01 * (s.length - 1))];
};
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
// One entry per event: a mark per drawn side lands on the same sample.
const events = (marks: { i: number; m: ArtifactMark }[], id: string) => {
  const by = new Map<number, ArtifactMark[]>();
  for (const { i, m } of marks) if (m.id === id && m.span !== 0) by.set(i, [...(by.get(i) ?? []), m]);
  return [...by.entries()].map(([i, ms]) => ({ i, ms }));
};
// Upward zero crossings of x in [a, b): the cycle lengths of one rhythm.
const cycles = (x: Float64Array, a: number, b: number) => {
  const ups: number[] = [];
  for (let k = Math.max(1, a); k < Math.min(x.length, b); k++) if (x[k - 1] < 0 && x[k] >= 0) ups.push(k - x[k] / (x[k] - x[k - 1]));
  return ups.slice(1).map((u, j) => (u - ups[j]) / FS);
};
const cv = (a: number[]) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) / m; };

// ── Lateral rectus spike ──

section('Lateral rectus spike: on the side the eyes turn to, before the movement (EEG Atlas online; Thickbroom & Mastaglia 1985):', () => {
  const { d, marks } = isoApp('bipolar-ap', 'awake', ['eye-movement'], 90, 7);
  const lrs = marks.filter(({ m }) => m.id === 'eye-movement' && m.label === 'LRS');
  const ratios: number[] = [], lags: number[] = [];
  let wrongSide = 0, steps = 0;
  for (const { i } of lrs) {
    // Which side: the spike is on the F7 rows for a leftward movement, F8 for rightward.
    const peak = (row: string) => { let p = 0; for (let k = i; k <= i + 3 && k < d[row].length; k++) p = Math.max(p, Math.abs(d[row][k] - d[row][i])); return p; };
    const aL = peak('F7-T3'), aR = peak('F8-T4');
    const ipsiRow = aL > aR ? 'F8-T4' : 'F7-T3';  // the row on the other side carries the step only
    ratios.push(Math.max(aL, aR) / Math.max(1e-6, Math.min(aL, aR)));
    // The gaze step that follows: positive gaze is rightward, F8 positive, so F8-T4
    // goes positive (down) for a rightward turn.
    if (i + 60 < d['F8-T4'].length) {
      const step = d['F8-T4'][i + 60] - d['F8-T4'][i];
      if (Math.abs(step) > 5) { steps++; if (Math.sign(step) !== (aR > aL ? 1 : -1)) wrongSide++; }
      // Lag from the spike's peak to the step's 10% point, on the row without the spike.
      const r = d[ipsiRow], full = r[i + 60] - r[i];
      if (Math.abs(full) > 5) {
        let k = i + 1;
        while (k < i + 60 && Math.abs(r[k] - r[i]) < 0.1 * Math.abs(full)) k++;
        lags.push((k - i) * 1000 / FS);
      }
    }
  }
  check('LRS: spikes marked in 90 s of lateral eye movements', lrs.length, 15, 1e6);
  check('LRS: median spike on its side / the other side (F7-T3 vs F8-T4)', median(ratios), 3, 1e6);
  check('LRS: movements whose gaze step goes the other way from the spike side', wrongSide, 0, 0);
  check('LRS: movements checked for side', steps, 10, 1e6);
  check('LRS: median lead of the spike start over the slow deflection (Thickbroom & Mastaglia: 15-30 ms)', median(lags), 12, 34, ' ms');
  const reversal = d['Fp1-F7'].map((v, k) => v * d['F7-T3'][k]);
  let most = 0, at = 0;
  for (const { i } of lrs) for (let k = i; k <= i + 3; k++) if (Math.abs(d['F7-T3'][k]) > most) { most = Math.abs(d['F7-T3'][k]); at = k; }
  check('LRS: Fp1-F7 and F7-T3 opposite at the largest left spike (reversal at F7)', reversal[at], -Infinity, 0);
  const rem = runApp('bipolar-ap', 'rem', ['rem-eyes'], 60, 7).marks.filter(({ m }) => m.id === 'rem-eyes');
  const moves = rem.filter(({ m }) => !m.label).length, spikes = rem.filter(({ m }) => m.label === 'LRS').length;
  check('LRS: REM eye movements each led by a lateral rectus spike (spikes / movements)', spikes / Math.max(1, moves), 1, 1);
});

// ── Breach rhythm ──

section('\nBreach rhythm: larger, faster, at one electrode only (IFCN "usually by a factor of less than 3"; AES ">=50%"):', () => {
  const carRatios: number[] = [], defectRows: number[] = [], neighbours: number[] = [];
  const band = { delta: [] as number[], alpha: [] as number[], beta: [] as number[] };
  for (const seed of [3, 11, 21]) {
    const car = runApp('reference-car', 'awake', ['breach'], 60, seed).data;
    carRatios.push(pctP2pOf(car['C4-AVG']) / pctP2pOf(car['C3-AVG']));
    // Per band against the ear: the average reference carries the whole head's alpha,
    // which the defect does not touch, and dilutes the gain at C4-AVG.
    const ear = runApp('reference-ipsi', 'awake', ['breach'], 60, seed).data, ear0 = runApp('reference-ipsi', 'awake', [], 60, seed).data;
    for (const [k, lo, hi] of [['delta', 1, 4], ['alpha', 8, 13], ['beta', 13, 30]] as const) {
      band[k].push(Math.sqrt(bandPower(ear['C4-A2'], lo, hi) / bandPower(ear0['C4-A2'], lo, hi)));
    }
    const bip = runApp('bipolar-ap', 'awake', ['breach'], 60, seed).data, bip0 = runApp('bipolar-ap', 'awake', [], 60, seed).data;
    for (const r of ['F4-C4', 'C4-P4']) defectRows.push(pctP2pOf(bip[r]) / pctP2pOf(bip0[r]));
    for (const r of ['Fp2-F4', 'P4-O2', 'F8-T4', 'T4-T6', 'F3-C3', 'C3-P3']) {
      let diff = 0; for (let k = 0; k < bip[r].length; k++) diff = Math.max(diff, Math.abs(bip[r][k] - bip0[r][k]));
      neighbours.push(diff);
    }
  }
  check('breach C4-AVG / C3-AVG peak to peak, median of 3 subjects (AES >=1.5; IFCN <3)', median(carRatios), 1.5, 3);
  check('breach F4-C4 and C4-P4 against the same subject without it, smallest', Math.min(...defectRows), 1.3, 3);
  check('breach: largest change on any row not sharing C4 (abrupt margin)', Math.max(...neighbours), 0, 1e-9, ' uV');
  check('breach C4-A2 beta gain (13-30 Hz), median (IFCN: "less than 3")', median(band.beta), 2.6, 3.05);
  // Faster raised more than slower. Beta against alpha is not asserted: at the electrode
  // the two gains are 2.92 and 2.73, closer than a referenced row can tell apart (on
  // C4-A2 the ear's own alpha lifts the alpha ratio and the amplifier's noise floor,
  // which the defect does not touch, lowers beta's: 0.92 on 2026-10-27).
  check('breach C4-A2 beta gain / delta gain, median', median(band.beta) / median(band.delta), 1.2, 2.5);
  check('breach C4-A2 alpha gain / delta gain, median', median(band.alpha) / median(band.delta), 1.05, 2);
  // Muscle does not cross the skull: its share of a row is the same with the defect.
  const mb = runApp('bipolar-ap', 'awake', ['muscle', 'breach'], 20, 5, { breachSite: 'F8' }).data['F8-T4'];
  const b = runApp('bipolar-ap', 'awake', ['breach'], 20, 5, { breachSite: 'F8' }).data['F8-T4'];
  const m = runApp('bipolar-ap', 'awake', ['muscle'], 20, 5).data['F8-T4'];
  const n0 = runApp('bipolar-ap', 'awake', [], 20, 5).data['F8-T4'];
  let err = 0; for (let k = 0; k < m.length; k++) err = Math.max(err, Math.abs((mb[k] - b[k]) - (m[k] - n0[k])));
  check('breach at F8: muscle on F8-T4 changed by the defect', err, 0, 1e-9, ' uV');
  const f8 = runApp('bipolar-ap', 'awake', ['breach'], 60, 3, { breachSite: 'F8' }), f80 = runApp('bipolar-ap', 'awake', [], 60, 3);
  // A bipolar row is the difference of two electrodes that share much of their
  // activity, so raising one of them can raise the row by more than the electrode's
  // own factor (Fp2-F8 up to 3.5x here): IFCN's "less than 3" is the electrode against
  // its homologue, asserted referentially below; the row only has to rise.
  check('breach at F8: F8-T4 against the same subject without it', pctP2pOf(f8.data['F8-T4']) / pctP2pOf(f80.data['F8-T4']), 1.3, 4.5);
  const f8car = runApp('reference-car', 'awake', ['breach'], 60, 3, { breachSite: 'F8' }).data;
  check('breach at F8: F8-AVG / F7-AVG peak to peak (AES >=1.5; IFCN <3)', pctP2pOf(f8car['F8-AVG']) / pctP2pOf(f8car['F7-AVG']), 1.5, 3);
  check('breach at F8: Fp2-F4 unchanged', pctP2pOf(f8.data['Fp2-F4']) / pctP2pOf(f80.data['Fp2-F4']), 0.999, 1.001);
  const boxes = f8.marks.filter(({ m }) => m.id === 'breach');
  check('breach: one box while on', boxes.filter(({ m }) => m.span === Infinity).length, 1, 1);
  // Two defects at once (owner's inbox, 2026-11-25: "in case the defect is in multiple
  // places"): each changes the two rows of its own electrode, and nothing else moves.
  const two = runApp('bipolar-ap', 'awake', ['breach'], 60, 3, { breachSites: ['C4', 'F7'] });
  const rise = (row: string) => pctP2pOf(two.data[row]) / pctP2pOf(f80.data[row]);
  const theirs = ['F4-C4', 'C4-P4', 'Fp1-F7', 'F7-T3'];
  check('breach at C4 and F7: their four rows against the same subject without it, smallest', Math.min(...theirs.map(rise)), 1.3, 4.5);
  const others = Object.keys(two.data).filter((r) => r !== 'ECG' && !theirs.includes(r));
  check('breach at C4 and F7: largest change on any other row', Math.max(...others.map((r) => Math.abs(rise(r) - 1))), 0, 0.001);
});

// ── Eye flutter ──

section('\nEye flutter: blink-like, frontal only, about three a second (learningeeg; its figure measured 3.5 Hz):', () => {
  const { d, marks } = isoApp('bipolar-ap', 'awake', ['eye-flutter'], 60, 4);
  let down = 0, up = 0;
  for (const v of d['Fp1-F3']) { down = Math.max(down, v); up = Math.min(up, v); }
  check('eye flutter Fp1-F3 renders DOWN (largest down / largest up)', down / -up, 1.2, 1e6);
  check('eye flutter F3-C3 / Fp1-F3 (learningeeg figure ~0.4; blink field)', absPeak(d['F3-C3']) / absPeak(d['Fp1-F3']), 0.15, 0.5);
  check('eye flutter P3-O1 / Fp1-F3 ("do not extend posteriorly beyond the frontal leads")', absPeak(d['P3-O1']) / absPeak(d['Fp1-F3']), 0, 0.1);
  const runs = marks.filter(({ m }) => m.id === 'eye-flutter');
  check('eye flutter: runs boxed in 60 s', runs.length, 2, 30);
  const freqs = runs.filter(({ i, m }) => i + (m.span ?? 0) * FS < d['Fp1-F3'].length).map(({ i, m }) => {
    const c = cycles(d['Fp1-F3'], i + Math.round(0.5 * FS), i + Math.round(((m.span ?? 0) - 0.3) * FS));
    return c.length ? 1 / median(c) : 0;
  });
  check('eye flutter: lid cycles per second within a run, median over runs', median(freqs), 3, 4, ' Hz');
});

// ── RMTD ──

section('\nRMTD: 5-7 Hz trains at one frequency, 2-10 s, mid-temporal (eegpedia; SCORE; IFCN):', () => {
  const { d, marks } = isoApp('bipolar-ap', 'drowsy', ['rmtd'], 240, 9);
  const trains = marks.filter(({ m }) => m.id === 'rmtd' && m.span != null && m.span > 0);
  const freqs: number[] = [], cvs: number[] = [];
  for (const { i, m } of trains) {
    const n = Math.round((m.span ?? 0) * FS);
    if (i + n >= d['T3-T5'].length) continue;
    // The side the train is on, from the field its box is drawn on (both sides can run at
    // once, so the larger row is not always this train's).
    const row = (m.fields[0]?.T3 ?? 0) > (m.fields[0]?.T4 ?? 0) ? 'T3-T5' : 'T4-T6';
    const c = cycles(d[row], i + Math.round(0.5 * FS), i + n - Math.round(0.5 * FS));
    if (c.length < 4) continue;
    freqs.push(1 / median(c)); cvs.push(cv(c));
  }
  check('RMTD trains measured', freqs.length, 8, 1e6);
  check('RMTD lowest train frequency (eegpedia, SCORE: 5-7 Hz)', Math.min(...freqs), 4.9, 7.1, ' Hz');
  check('RMTD highest train frequency', Math.max(...freqs), 4.9, 7.1, ' Hz');
  check('RMTD largest cycle-length CV within a train (one frequency: "does not change in frequency or form")', Math.max(...cvs), 0, 0.06);
  const spans = trains.map(({ m }) => m.span ?? 0);
  check('RMTD shortest train (learningeeg: "a few seconds")', Math.min(...spans), 1.9, 10, ' s');
  check('RMTD longest train (eegpedia: 5-10 s)', Math.max(...spans), 1.9, 10.1, ' s');
  const temporal = Math.max(...['F7-T3', 'T3-T5', 'F8-T4', 'T4-T6'].map((r) => absPeak(d[r])));
  const para = Math.max(...['F3-C3', 'C3-P3', 'F4-C4', 'C4-P4'].map((r) => absPeak(d[r])));
  // A ceiling only: SCORE has the maximum "usually mid-temporal" with spread to the
  // parasagittal "sometimes", which is not drawn (the field is T3 with T5 and F7).
  check('RMTD largest parasagittal row / largest temporal row (temporal maximum)', para / temporal, 0, 0.5);
  for (const st of ['awake', 'n1', 'n2'] as const) {
    check(`RMTD trains in ${st} (SCORE: drowsiness and light sleep, occasionally awake)`,
      runApp('bipolar-ap', st, ['rmtd'], 40, 9).marks.filter(({ m }) => m.id === 'rmtd').length, 1, 1e6);
  }
});

// ── Wickets ──

section('\nWickets: single or in runs (SCORE; eegpedia; IFCN "single waves or trains"):', () => {
  const ev = runApp('bipolar-ap', 'drowsy', ['wicket'], 300, 13).marks.filter(({ m }) => m.id === 'wicket');
  check('wicket share of events that are a single wave', ev.filter(({ m }) => m.span == null).length / ev.length, 0.15, 0.5);
});
// Runs are short and diamond-shaped, and a single is a run's sharpest wave on its own
// (Gelisse et al., J Neurol 2024: "diamond or lozenge-shaped"; a single's morphology
// "is identical to the morphology of the most sharply contoured waveforms in the
// runs"). Measured on the wicket's own contribution, on the row of the side it is on.

section('\nWickets: short diamond runs; a single is the peak wave of a run (Gelisse 2024):', () => {
  const { d, marks } = isoApp('bipolar-ap', 'drowsy', ['wicket'], 300, 13);
  const peakAt: number[] = [], runPk: number[] = [], singlePk: number[] = [], lens: number[] = [], shapeCv: number[] = [];
  for (const { i, m } of marks.filter(({ m }) => m.id === 'wicket')) {
    const x = d[(m.fields[0]?.T3 ?? 0) > (m.fields[0]?.T4 ?? 0) ? 'T3-T5' : 'T4-T6'];
    const n = Math.round((m.span ?? m.dur ?? 0) * FS);
    if (i + n >= x.length) continue;
    let pk = 0, at = 0;
    const downs: number[] = [];
    for (let k = i; k < i + n; k++) {
      if (Math.abs(x[k]) > pk) { pk = Math.abs(x[k]); at = k - i; }
      // The sharp side is negative at T3/T4, input 1: one entry below zero per wave.
      if (k > i && x[k - 1] >= 0 && x[k] < 0) downs.push(k);
    }
    if (m.span == null) { singlePk.push(pk); continue; }
    runPk.push(pk); lens.push(m.span);
    if (downs.length <= 8) peakAt.push(at / n);
    // Each wave's share of its cycle spent below zero: its spike against its lobe.
    if (downs.length >= 5) {
      const fr: number[] = [];
      for (let j = 0; j + 1 < downs.length; j++) {
        let neg = 0;
        for (let k = downs[j]; k < downs[j + 1]; k++) if (x[k] < 0) neg++;
        fr.push(neg / (downs[j + 1] - downs[j]));
      }
      const mu = fr.reduce((a, b) => a + b, 0) / fr.length;
      shapeCv.push(Math.sqrt(fr.reduce((a, b) => a + (b - mu) ** 2, 0) / fr.length) / mu);
    }
  }
  // Run length (owner, 2026-11-16, against learningeeg's figure, ~4 s, and a clinical
  // record, 1-2 s): single waves up to runs of seconds. It was 4-7 waves.
  check('wicket run length, median (owner 2026-11-16: single waves to runs of seconds)', median(lens), 0.8, 2, ' s');
  check('wicket longest run in 300 s (learningeeg figure: about 4 s)', Math.max(...lens), 2.5, 4.5, ' s');
  check('wicket shortest run in 300 s (short runs remain)', Math.min(...lens), 0, 0.7, ' s');
  check('wicket position of the largest wave in a short run (8 waves or fewer), median (diamond: mid-run)', median(peakAt), 0.3, 0.7);
  check('wicket wave-to-wave shape variation in a run, median CV of the share below zero (owner: not identical)', median(shapeCv), 0.05, 0.4);
  check('wicket median single / median run peak (Gelisse 2024: a single is the sharpest wave of a run)', median(singlePk) / median(runPk), 0.8, 1.2);
});

// Not mirror images (owner, 2026-11-16: wickets "slightly less mirror like to the
// adjacent lead"). One generator under T3 made F7-T3 and T3-T5 exact negatives; a
// second under T5, its arches at their own size and lag (variants.ts), keeps the
// reversal at T3 and breaks the copy. Correlation over the samples the wickets reach.
section(null, () => {
  const { d } = isoApp('bipolar-ap', 'drowsy', ['wicket'], 300, 20);
  const corr = (a: Float64Array, b: Float64Array) => {
    let top = 0;
    for (const v of a) top = Math.max(top, Math.abs(v));
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i]) > 0.1 * top || Math.abs(b[i]) > 0.1 * top) { sab += a[i] * b[i]; saa += a[i] ** 2; sbb += b[i] ** 2; }
    }
    return sab / Math.sqrt(saa * sbb);
  };
  check('wicket F7-T3 against T3-T5 correlation, both sides (owner 2026-11-16: reversing at T3, not mirror images)',
    (corr(d['F7-T3'], d['T3-T5']) + corr(d['F8-T4'], d['T4-T6'])) / 2, -0.85, -0.4);
}, '\nWickets: short diamond runs; a single is the peak wave of a run (Gelisse 2024):');

// ── Blinks: width and the orbicularis EMG (owner, 2026-11-16) ──
// A clinical record shows narrow blinks (~0.2 s) beside broad ones (~0.4-0.5 s), and
// a little fast muscle activity on the frontopolar rows with each: the orbicularis
// oculi contraction that closes the lid. More subtle than the muscle artifact.

section('\nBlinks: varied width, a little orbicularis EMG (owner 2026-11-16):', () => {
  // Fast activity: a 61-tap windowed-sinc high-pass at 40 Hz. A moving-average
  // difference was tried first and let the blink's own slope through (a ratio of
  // ~1100 that measured the deflection, not the muscle); a blink has next to
  // nothing above 40 Hz, the EMG most of its power.
  const HP_TAPS = (() => {
    const N = 61, fc = 40 / FS, h = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const m = k - (N - 1) / 2, w = 0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (N - 1));
      h[k] = -(m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m)) * w;
    }
    h[(N - 1) / 2] += 1;
    return h;
  })();
  const hf = (x: Float64Array) => {
    const y = new Float64Array(x.length), H = (HP_TAPS.length - 1) / 2;
    for (let i = H; i < x.length - H; i++) {
      let s = 0;
      for (let k = 0; k < HP_TAPS.length; k++) s += HP_TAPS[k] * x[i - H + k];
      y[i] = s;
    }
    return y;
  };
  const on = runApp('bipolar-ap', 'awake', ['blink', 'eyes-open'], 240, 20);
  const off = runApp('bipolar-ap', 'awake', ['eyes-open'], 240, 20);
  const diff = (lab: string) => on.data[lab].map((v, i) => v - off.data[lab][i]);
  const fp = diff('Fp1-F3');
  let top = 0;
  for (const v of fp) top = Math.max(top, Math.abs(v));
  // Each blink: the half-height width of its downward deflection, and its span.
  const widths: number[] = [];
  const inBlink = new Uint8Array(fp.length);
  for (let i = 1; i < fp.length; i++) {
    if (fp[i - 1] < 0.25 * top && fp[i] >= 0.25 * top) {
      let pk = i;
      for (let k = i; k < Math.min(fp.length, i + Math.round(0.6 * FS)); k++) if (fp[k] > fp[pk]) pk = k;
      let a = pk, b = pk;
      while (a > 0 && fp[a] > fp[pk] / 2) a--;
      while (b < fp.length - 1 && fp[b] > fp[pk] / 2) b++;
      widths.push((b - a) / FS);
      for (let k = Math.max(0, pk - Math.round(0.3 * FS)); k < Math.min(fp.length, pk + Math.round(0.5 * FS)); k++) inBlink[k] = 1;
    }
  }
  const ws = [...widths].sort((p, q) => p - q);
  check('blink half-height width, 90th / 10th percentile (owner: narrow and broad blinks; was ~1.6)',
    ws[Math.floor(0.9 * (ws.length - 1))] / ws[Math.floor(0.1 * (ws.length - 1))], 1.8, 4);
  const pw = (y: Float64Array, want: number) => {
    let s = 0, c = 0;
    for (let i = 0; i < y.length; i++) if (inBlink[i] === want) { s += y[i] ** 2; c++; }
    return s / c;
  };
  const hfp = hf(fp), hfo = hf(diff('P3-O1'));
  check('blink Fp1-F3 fast activity above 40 Hz, during blinks / between (orbicularis EMG present)', pw(hfp, 1) / pw(hfp, 0), 2, Infinity);
  const mus = isoApp('bipolar-ap', 'awake', ['muscle'], 120, 20).d['Fp1-F3'];
  const hm = hf(mus);
  check('blink EMG / muscle EMG, Fp1-F3 power above 40 Hz (owner: more subtle than the muscle artifact)',
    pw(hfp, 1) / (hm.reduce((s, v) => s + v * v, 0) / hm.length), 0.1, 0.4);
  check('blink EMG P3-O1 / Fp1-F3 fast power during blinks (frontal only)', pw(hfo, 1) / pw(hfp, 1), 0, 0.2);
});

// ── The reader's filters (top bar, 2026-11-16) ──
// Instrument behaviour, not a clinical claim: the notch removes the mains, the high
// cut removes fast activity, the low cut shortens a blink's recovery swing.

section('\nFilters: notch, high cut, low cut (top bar):', () => {
  const runF = (patterns: string[], filters: SimSettings['filters'], lab: string, secs: number) => {
    const montage = MONTAGES['bipolar-ap'];
    const ch = montage.channels.find(c => c.label === lab)!;
    const settings: SimSettings = {
      speed: 30, sensitivity: 7, patientState: 'awake', activePatterns: new Set(patterns),
      ictalParams: defaultIctalParamsMap(), artifactParams: { ...defaultArtifactParams() }, filters,
    };
    const src = new SimulationSource(20, FS);
    src.useAppMode();
    const n = Math.floor(secs * FS), out = new Float64Array(n);
    for (let i = 0; i < n; i++) { const v = src.next(settings); out[i] = computeChannelVoltage(ch, src.t, v, commonAverage(v)); }
    return out.slice(Math.round(2 * FS)); // past the settling of a newly set filter
  };
  const at50 = (x: Float64Array) => {
    let re = 0, im = 0;
    for (let i = 0; i < x.length; i++) { re += x[i] * Math.cos(2 * Math.PI * 50 * i / FS); im += x[i] * Math.sin(2 * Math.PI * 50 * i / FS); }
    return (re * re + im * im) / x.length;
  };
  const base = { lowCutHz: 1, highCutHz: 70, notchHz: null };
  check('notch 50 Hz: mains power at 50 Hz with the notch / without (F7-T3)',
    at50(runF(['50hz'], { ...base, notchHz: 50 }, 'F7-T3', 20)) / at50(runF(['50hz'], base, 'F7-T3', 20)), 0, 0.05);
  const fast = (x: Float64Array) => {
    let s = 0;
    for (let i = 2; i < x.length - 2; i++) s += (x[i] - (x[i - 2] + x[i - 1] + x[i] + x[i + 1] + x[i + 2]) / 5) ** 2;
    return s;
  };
  check('high cut 15 Hz: fast power of muscle / at 70 Hz (F7-T3)',
    fast(runF(['muscle'], { ...base, highCutHz: 15 }, 'F7-T3', 30)) / fast(runF(['muscle'], base, 'F7-T3', 30)), 0, 0.2);
  // A blink's recovery swing: the mean opposite-going excursion 1-2.5 s after each
  // blink peak, at 1 Hz against the engine's own 0.25 Hz.
  const swing = (lowCutHz: number) => {
    const x = runF(['blink', 'eyes-open'], { ...base, lowCutHz }, 'Fp1-F3', 120);
    let top = 0;
    for (const v of x) top = Math.max(top, v);
    let s = 0, c = 0;
    for (let i = 1; i < x.length; i++) {
      if (x[i - 1] < 0.5 * top && x[i] >= 0.5 * top) {
        for (let k = i + Math.round(1.0 * FS); k < Math.min(x.length, i + Math.round(2.5 * FS)); k++) { s += Math.min(0, x[k]); c++; }
      }
    }
    return -s / c;
  };
  check('low cut 1 Hz: blink recovery swing 1-2.5 s after the blink / at 0.25 Hz (shorter)', swing(1) / swing(0.25), 0, 0.6);
});

// ── The information panel (2026-11-16): every toggle has its text and its picture ──

section('\nInformation panel: text and example image for every toggle:', () => {
  const ids = PATTERN_CATEGORIES.flatMap(c => c.patterns.map(p => p.id));
  check('toggles without information-panel text', ids.filter(id => !PATTERN_INFO[id]).length, 0, 0);
  const pub = fileURLToPath(new URL('../../../artifacts/eeg-simulator/public/', import.meta.url));
  check('toggles without an example image (run renderPatternGallery.ts)',
    ids.filter(id => !PATTERN_GALLERY[id] || !existsSync(join(pub, PATTERN_GALLERY[id].file))).length, 0, 0);
});

// ── 14 & 6 ──

section('\n14 & 6 Hz positive bursts: sides shifting, R>L, 0.5-1 s (eegpedia; SCORE):', () => {
  const { marks } = runApp('reference-car', 'drowsy', ['14-6-pos'], 400, 6);
  const ev = events(marks, '14-6-pos');
  const both = ev.filter((e) => e.ms.length === 2).length;
  check('14-6-pos share of bursts on both sides', both / ev.length, 0.3, 0.7);
  // One-sided bursts: which side, from the field the box is on.
  const one = ev.filter((e) => e.ms.length === 1);
  const t6 = (m: ArtifactMark) => (m.fields[0]?.T6 ?? 0) > (m.fields[0]?.T5 ?? 0);
  check('14-6-pos one-sided bursts on the right / on the left (eegpedia: R>L)',
    one.filter((e) => t6(e.ms[0])).length / Math.max(1, one.filter((e) => !t6(e.ms[0])).length), 1.1, 1e6);
  const spans = ev.flatMap((e) => e.ms.map((m) => m.span ?? 0));
  check('14-6-pos shortest burst (eegpedia, SCORE: 0.5-1 s)', Math.min(...spans), 0.49, 1.01, ' s');
  check('14-6-pos longest burst', Math.max(...spans), 0.49, 1.01, ' s');
  // The other choice under the toggle (Sides: bilateral), learningeeg's picture.
  const bi = events(runApp('reference-car', 'drowsy', ['14-6-pos'], 300, 6, { pos146Sides: 'bilateral' }).marks, '14-6-pos');
  check('14-6-pos, Sides bilateral: share of bursts on both sides (learningeeg: "bilateral and synchronous")',
    bi.filter((e) => e.ms.length === 2).length / bi.length, 1, 1);
  const biSpans = bi.flatMap((e) => e.ms.map((m) => m.span ?? 0));
  check('14-6-pos, Sides bilateral: shortest burst (learningeeg: 1-2 s)', Math.min(...biSpans), 0.99, 2.01, ' s');
  check('14-6-pos, Sides bilateral: longest burst', Math.max(...biSpans), 0.99, 2.01, ' s');
});

// ── Small sharp spikes ──

section('\nSmall sharp spikes: mono- or diphasic, steep fall, sometimes a small slow wave (SCORE; eegpedia; IFCN):', () => {
  const { d, marks } = isoApp('bipolar-ap', 'drowsy', ['bets'], 400, 8);
  let di = 0, sl = 0, n = 0, steep = 0, slowMax = 0;
  const spikeAt = marks.filter(({ m }) => m.id === 'bets').map(({ i }) => i);
  for (const i of spikeAt) {
    // One spike at a time, on its own side. Both rows used to be read for every spike,
    // which held only while a spike stayed on one side and spikes never overlapped:
    // with the broad field and four sources (2026-11-25) the far side's echo passed the
    // 3 uV floor and a second spike inside the slow-wave window read as a "slow wave"
    // 12.7 times its spike. Now the larger row only, and none with another spike within
    // 0.3 s.
    if (spikeAt.some((j) => j !== i && Math.abs(j - i) < 0.3 * FS)) continue;
    const peakIn = (x: Float64Array) => { let pk = 0, pi = i; for (let k = i; k < Math.min(x.length, i + 20); k++) if (Math.abs(x[k]) > Math.abs(pk)) { pk = x[k]; pi = k; } return { pk, pi }; };
    const own = Math.abs(peakIn(d['T3-T5']).pk) >= Math.abs(peakIn(d['T4-T6']).pk) ? 'T3-T5' : 'T4-T6';
    for (const row of [own]) {
      const x = d[row];
      const { pk, pi } = peakIn(x);
      if (Math.abs(pk) < 3) continue;
      n++;
      let lo = pi; while (lo > 0 && Math.abs(x[lo]) >= 0.1 * Math.abs(pk)) lo--;
      let hi = pi; while (hi < x.length - 1 && Math.abs(x[hi]) >= 0.1 * Math.abs(pk) && Math.sign(x[hi]) === Math.sign(pk)) hi++;
      if (hi - pi < pi - lo) steep++;
      let opp = 0; for (let k = pi; k < pi + 10 && k < x.length; k++) opp = Math.max(opp, -Math.sign(pk) * x[k]);
      let slow = 0; for (let k = pi + 15; k < pi + 60 && k < x.length; k++) slow = Math.max(slow, Math.sign(pk) * x[k]);
      if (opp > 0.15 * Math.abs(pk)) di++;
      if (slow > 0.05 * Math.abs(pk)) { sl++; slowMax = Math.max(slowMax, slow / Math.abs(pk)); }
    }
  }
  check('BETS spikes measured', n, 20, 1e6);
  check('BETS share falling faster than they rise ("a steep descending arm")', steep / n, 0.8, 1);
  check('BETS share diphasic (eegpedia: "occasionally diphasic")', di / n, 0.1, 0.45);
  check('BETS share followed by a slow wave (IFCN "often", eegpedia "occasionally")', sl / n, 0.15, 0.6);
  check('BETS largest slow wave / its spike ("not prominent and of low amplitude")', slowMax, 0, 0.2);
});

// ── 6 Hz: FOLD and WHAM ──

section('\n6 Hz spike-and-wave, both forms (eegpedia; SCORE):', () => {
  const fold = isoApp('reference-ipsi', 'drowsy', ['6hz-sw'], 120, 10, { sixHzForm: 'fold' }).d;
  const wham = isoApp('reference-ipsi', 'drowsy', ['6hz-sw'], 120, 10, { sixHzForm: 'wham' }).d;
  check('6 Hz WHAM F3-A1 / O1-A1 ("anterior")', absPeak(wham['F3-A1']) / Math.max(0.1, absPeak(wham['O1-A1'])), 5, 1e6);
  check('6 Hz FOLD O1-A1 / F3-A1 ("occipital")', absPeak(fold['O1-A1']) / absPeak(fold['F3-A1']), 2, 1e6);
  check('6 Hz WHAM largest deflection on F3-A1 (spike ">45uV")', absPeak(wham['F3-A1']), 45, 150, ' uV');
  const whamAwake = isoApp('reference-ipsi', 'awake', ['6hz-sw'], 60, 10, { sixHzForm: 'wham' }).d;
  check('6 Hz WHAM drawn awake ("Waking")', absPeak(whamAwake['F3-A1']), 20, 1e6, ' uV');
  const foldAwake = isoApp('reference-ipsi', 'awake', ['6hz-sw'], 60, 10, { sixHzForm: 'fold' }).d;
  check('6 Hz FOLD not drawn awake ("Drowsy")', absPeak(foldAwake['O1-A1']), 0, 0.5, ' uV');
});

// ── PSWY and slow-fused transients ──

section('\nPosterior slow waves of youth and slow-fused transients (IFCN; learningeeg; SCORE):', () => {
  const p = isoApp('reference-car', 'awake', ['pswy'], 180, 12);
  check('PSWY O1-AVG largest wave / the alpha background peak to peak ("rather high amplitude")', absPeak(p.d['O1-AVG']) / pctP2pOf(p.off['O1-AVG']), 0.7, 2);
  const pe = events(p.marks, 'pswy');
  check('PSWY events that are one isolated wave (arrow, no box)', pe.filter((e) => e.ms.every((m) => m.span == null && m.label === 'PSWY')).length / pe.length, 1, 1);
  const s = isoApp('reference-car', 'awake', ['slow-fused'], 300, 12);
  const se = events(s.marks, 'slow-fused');
  const kind = (lab: string) => se.filter((e) => e.ms[0].label === lab).length / se.length;
  check('slow-fused: share of events that are a fused pair', kind('Slow-fused transient'), 0.25, 0.55);
  check('slow-fused: share that are a slow wave alone (SCORE: "dissociated from each other")', kind('PSWY'), 0.15, 0.5);
  check('slow-fused: share that are a sharp transient alone', kind('Sharp transient'), 0.15, 0.5);
  // In a fused pair the sharp wave comes first and both are surface-negative (UP on O1-AVG).
  let ok = 0, n = 0;
  for (const e of se.filter((e) => e.ms[0].label === 'Slow-fused transient')) {
    const m = e.ms[0], x = (m.fields[0]?.O1 ?? 0) >= (m.fields[0]?.O2 ?? 0) ? s.d['O1-AVG'] : s.d['O2-AVG'];
    const a = e.i + Math.round(-(m.ago ?? 0) * FS);
    const w = Math.round((m.span ?? 0) * FS);
    if (a + w + 10 >= x.length) continue;
    let sk = a, wk = a + Math.round(0.11 * FS);
    for (let k = a; k < a + Math.round(0.11 * FS); k++) if (x[k] < x[sk]) sk = k;
    for (let k = a + Math.round(0.11 * FS); k < a + w; k++) if (x[k] < x[wk]) wk = k;
    n++;
    if (x[sk] < 0 && x[wk] < 0 && sk < wk) ok++;
  }
  check('slow-fused: fused pairs measured', n, 5, 1e6);
  check('slow-fused: fused pairs with the sharp wave first and both UP', ok / n, 0.9, 1);
});

// ── Owner's inbox, 2026-11-25 ──

/** Power at f Hz in a segment (one Fourier coefficient). */
const powerAt = (x: ArrayLike<number>, f: number) => {
  let re = 0, im = 0;
  for (let n = 0; n < x.length; n++) { re += x[n] * Math.cos(2 * Math.PI * f * n / FS); im -= x[n] * Math.sin(2 * Math.PI * f * n / FS); }
  return (re * re + im * im) / x.length;
};
const bandOf = (x: ArrayLike<number>, lo: number, hi: number) => { let p = 0; for (let f = lo; f <= hi; f += 0.5) p += powerAt(x, f); return p; };

section('\n14 & 6 Hz positive bursts: each burst 14 Hz, 6 Hz or both, and the same on every row (learningeeg; owner):', () => {
  const r = isoApp('bipolar-ap', 'drowsy', ['14-6-pos'], 300, 20);
  const bursts = events(r.marks, '14-6-pos');
  let only14 = 0, only6 = 0, mixed = 0, spread = 0;
  for (const { i, ms } of bursts) {
    const span = ms[0].span ?? 0;
    const a = i, z = Math.min(i + Math.round(span * FS), r.d['T5-O1'].length);
    const balances: number[] = [];
    for (const [row, x] of Object.entries(r.d)) {
      if (row === 'ECG') continue;
      const seg = x.slice(a, z);
      if (absPeak(seg) < 3) continue;
      const p14 = bandOf(seg, 13, 17), p6 = bandOf(seg, 5, 7);
      balances.push(p14 / (p14 + p6));
    }
    if (!balances.length) continue;
    spread = Math.max(spread, Math.max(...balances) - Math.min(...balances));
    const b = median(balances);
    if (b > 0.9) only14++; else if (b < 0.1) only6++; else mixed++;
  }
  const n = only14 + only6 + mixed;
  check('14-6-pos: bursts measured', n, 20, 1e6);
  check('14-6-pos: share of bursts at 14 Hz alone (learningeeg: "either 14 Hz ... or 6 Hz ... or an admixture")', only14 / n, 0.15, 0.55);
  check('14-6-pos: share of bursts at 6 Hz alone', only6 / n, 0.15, 0.55);
  check('14-6-pos: share of bursts mixing both', mixed / n, 0.15, 0.55);
  check('14-6-pos: largest spread of one burst\'s 14:6 balance across the rows it is on (one frequency on every row at once)', spread, 0, 0.05);
});

section('\nRMTD: intermittent trains with the background between them (eegpedia "trains"; learningeeg "a few seconds"; owner):', () => {
  const SECS = 600;
  const r = runApp('bipolar-ap', 'drowsy', ['rmtd'], SECS, 20);
  const on = new Uint8Array(SECS * FS);
  for (const { i, m } of r.marks) {
    if (m.id !== 'rmtd' || m.span == null || !isFinite(m.span)) continue;
    for (let k = i; k < Math.min(on.length, i + Math.round(m.span * FS)); k++) on[k] = 1;
  }
  let busy = 0, gap = 0, longestGap = 0;
  for (let k = 0; k < on.length; k++) {
    busy += on[k];
    gap = on[k] ? 0 : gap + 1;
    longestGap = Math.max(longestGap, gap);
  }
  check('RMTD share of the record with a train on either side (intermittent)', busy / on.length, 0.1, 0.55);
  check('RMTD longest stretch with no train (background between trains)', longestGap / FS, 8, Infinity, ' s');
});

section('\n6 Hz phantom spike-and-wave: runs at 5-7 Hz, FOLD\'s wave as tiny as its spike (eegpedia "6Hz (5-7Hz)"; learningeeg):', () => {
  const r = isoApp('reference-ipsi', 'drowsy', ['6hz-sw'], 300, 20);
  const runs = events(r.marks, '6hz-sw');
  const freqs: number[] = [];
  for (const { i, ms } of runs) {
    const span = ms[0].span ?? 0;
    const seg = r.d['O1-A1'].slice(i, Math.min(i + Math.round(span * FS), r.d['O1-A1'].length));
    if (seg.length < FS / 2) continue;
    let best = 0, bestF = 0;
    for (let f = 4.5; f <= 7.5; f += 0.05) { const p = powerAt(seg, f); if (p > best) { best = p; bestF = f; } }
    freqs.push(bestF);
  }
  check('6hz-sw runs measured', freqs.length, 10, 1e6);
  check('6hz-sw lowest run frequency (eegpedia: 5-7 Hz)', Math.min(...freqs), 4.8, 5.6, ' Hz');
  check('6hz-sw highest run frequency', Math.max(...freqs), 6.4, 7.2, ' Hz');
});

section('\nSmall sharp spikes: not every one reverses phase on the double banana (owner; eegpedia figure: largest at A2/T4):', () => {
  const r = isoApp('bipolar-ap', 'drowsy', ['bets'], 600, 20);
  const spikes = r.marks.filter(({ m }) => m.id === 'bets').map(({ i }) => i);
  let reversed = 0, counted = 0;
  for (const i of spikes) {
    // The side it is on: the larger of the two temporal chains around the spike.
    const win = (row: string) => r.d[row].slice(Math.max(0, i - 5), i + 25);
    const peak = (row: string) => { const w = win(row); return w.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0); };
    const left = Math.abs(peak('F7-T3')) + Math.abs(peak('T3-T5'));
    const right = Math.abs(peak('F8-T4')) + Math.abs(peak('T4-T6'));
    const [a, b] = left >= right ? ['F7-T3', 'T3-T5'] : ['F8-T4', 'T4-T6'];
    if (Math.max(Math.abs(peak(a)), Math.abs(peak(b))) < 3) continue;
    counted++;
    // A phase reversal: the two links sharing the temporal electrode deflect against each other,
    // each by at least a third of the larger.
    const pa = peak(a), pb = peak(b), big = Math.max(Math.abs(pa), Math.abs(pb));
    if (Math.sign(pa) !== Math.sign(pb) && Math.min(Math.abs(pa), Math.abs(pb)) >= big / 3) reversed++;
  }
  check('small sharp spikes measured', counted, 20, 1e6);
  check('small sharp spikes with a phase reversal at T3/T4 on the double banana, share (owner: "not necessarily ... each time")', reversed / counted, 0.2, 0.8);
});

// ── Movement (IK-059), 2026-11-27 ──
// learningeeg (Artifacts): "chaotic looking, high amplitude activity that doesn't mimic any
// actual cerebral patterns"; it "varies widely depending on the type and location of
// movement"; head movement "is usually more prominent posteriorly if the patient is resting
// their head on a pillow". It was one burst through the eye sources: a smooth frontal field,
// the same waveform on every row in proportion (median |r| 1.0 between rows).

section('\nMovement: chaotic, on many rows, each its own waveform, often at the back of the head (learningeeg):', () => {
  const BACK = /O1|O2|P3|P4|T5|T6|Pz/;
  const rowsPast: number[] = [], medR: number[] = [], largest: number[] = [];
  let back = 0, n = 0;
  for (const seed of [20, 3, 7]) {
    const run = (patterns: string[]) => {
      const montage = MONTAGES['bipolar-ap'];
      const settings: SimSettings = {
        speed: 30, sensitivity: 7, patientState: 'awake', activePatterns: new Set(patterns),
        ictalParams: defaultIctalParamsMap(), artifactParams: { ...defaultArtifactParams(), movementRatePerMin: 6 },
      };
      const src = new SimulationSource(seed, FS);
      src.useAppMode();
      const len = 120 * FS;
      const data: Record<string, Float64Array> = {};
      const chans = montage.channels.filter((c) => c.group !== 'ecg');
      chans.forEach((c) => { data[c.label] = new Float64Array(len); });
      const marks: { i: number; m: ArtifactMark }[] = [];
      for (let i = 0; i < len; i++) {
        const v = src.next(settings);
        const avg = commonAverage(v);
        for (const c of chans) data[c.label][i] = computeChannelVoltage(c, src.t, v, avg);
        for (const m of src.groundTruth.marks) marks.push({ i, m: { ...m } });
      }
      return { data, marks };
    };
    const on = run(['movement']), off = run([]);
    for (const { i, m } of on.marks) {
      if (m.id !== 'movement') continue;
      const z = Math.min(i + Math.round(m.dur * FS), on.data['Fp1-F3'].length);
      const seg = (r: string) => on.data[r].slice(i, z).map((v, k) => v - off.data[r][i + k]);
      const peaks = Object.keys(on.data).map((r) => [r, absPeak(seg(r))] as const).sort((a, b) => b[1] - a[1]);
      const past = peaks.filter(([, p]) => p >= 14).map(([r]) => r);   // 2 mm at 7 uV/mm
      n++;
      rowsPast.push(past.length);
      largest.push(peaks[0][1]);
      if (BACK.test(peaks[0][0])) back++;
      const rs: number[] = [];
      for (let a = 0; a < past.length; a++) for (let b = a + 1; b < past.length; b++) rs.push(Math.abs(corr(seg(past[a]), seg(past[b]))));
      if (rs.length) medR.push(median(rs));
    }
  }
  check('movement: movements measured (3 subjects, 6 a minute for 2 minutes)', n, 15, 1e6);
  check('movement: rows past 2 mm per movement, median (learningeeg: high amplitude, on many channels)', median(rowsPast), 4, Infinity);
  check('movement: largest row per movement, median (high amplitude; a design floor of 7 mm at 7 uV/mm)', median(largest), 50, Infinity, ' uV');
  check('movement: |r| between the rows it is on, median over movements (chaotic, no generator; one source gave 1.0)', median(medR), 0, 0.5);
  check('movement: share of movements largest at the back of the head (learningeeg: posteriorly on a pillow)', back / n, 0.45, 0.95);
});

// ── Electrode pop (IK-056), 2026-11-27 ──
// learningeeg (Artifacts): "a single electrode showing a very sudden, steep upslope with a
// slower downslope and absolutely no field". On the double banana only the rows sharing
// the electrode can change.

section('\nElectrode pop: a steep rise, a slower fall, and no field (learningeeg):', () => {
  const r = isoApp('bipolar-ap', 'awake', ['electrode-pop'], 300, 20);
  let n = 0, steeper = 0, worstOther = 0;
  for (const { i } of r.marks.filter(({ m }) => m.id === 'electrode-pop')) {
    const z = Math.min(i + Math.round(1.5 * FS), r.d['Fp1-F3'].length);
    const peaks = Object.entries(r.d).filter(([l]) => l !== 'ECG')
      .map(([l, x]) => [l, absPeak(x.slice(i, z))] as const).sort((a, b) => b[1] - a[1]);
    const [top, topAmp] = peaks[0];
    if (topAmp < 14) continue;   // under 2 mm at 7 uV/mm: nothing to read
    n++;
    // Rows that do not share the popped electrode: the electrode is the one the two
    // largest rows have in common.
    const [a1, a2] = top.split('-'), [b1, b2] = peaks[1][0].split('-');
    const el = [a1, a2].find((e) => e === b1 || e === b2) ?? a1;
    const others = peaks.filter(([l]) => !l.split('-').includes(el));
    worstOther = Math.max(worstOther, ...others.map(([, p]) => p / topAmp));
    // Rise: from the start to the peak; fall: from the peak to a third of it.
    const x = r.d[top].slice(i, z);
    let k = 0; for (let j = 0; j < x.length; j++) if (Math.abs(x[j]) > Math.abs(x[k])) k = j;
    let f = k; while (f < x.length - 1 && Math.abs(x[f]) > Math.abs(x[k]) / 3) f++;
    if (k < f - k) steeper++;
  }
  check('electrode pop: pops measured', n, 3, 1e6);
  check('electrode pop: share rising faster than they fall (learningeeg: "steep upslope with a slower downslope")', steeper / n, 1, 1);
  check('electrode pop: largest row not sharing the electrode / the pop, worst (learningeeg: "absolutely no field")', worstOther, 0, 0.01);
});

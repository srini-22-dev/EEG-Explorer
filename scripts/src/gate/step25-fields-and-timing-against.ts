import type { PatientState, SimSettings } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
import { defaultArtifactParams, defaultIctalParamsMap, DEFAULT_FILTERS } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
import { SimulationSource } from '../../../artifacts/eeg-simulator/src/engine/adapter';
import { MONTAGES } from '../../../artifacts/eeg-simulator/src/utils/montages';
import { commonAverage, computeChannelVoltage } from '../../../artifacts/eeg-simulator/src/utils/computeChannel';
import { welch, spectralPeak } from '../dsp';
import { quizPage, effective } from '../../../artifacts/eeg-simulator/src/utils/toggleRules';
import { ANTERIOR_SITES, FS, IPSI_EAR, POSTERIOR_SITES, SLEEP_OPTS, absPeak, check, displayContribAll, eventIntervals, largestSideDifference, largestStep, meanPeakAt, rmsOf, runEngineState, section, step, runDisplay } from './harness';

// ===========================================================================
// Step 25 — fields and timing against learningeeg.com (audit of 2026-10-12)
// ===========================================================================
// Every toggle was measured in isolation (same-seed on minus off) on every row of
// the double banana and compared with what learningeeg's chapters and figures say
// that pattern looks like. Three classes of defect came out, none of which any
// earlier check could see, because each earlier check read one or two electrodes:
//
//   A. Patterns taught as GENERALIZED were one midline patch, and drew as a
//      midline focus (sources/fields.ts has the table).
//   B. Three artifact toggles drew nothing at all: sweat (0.4 uV), mains (0.0 uV on
//      every bipolar row) and, on bipolar montages, ECG.
//   C. Several variants sat in the wrong place or ran at the wrong size or rhythm.
//
// The checks below assert the corrected behaviour ROW BY ROW, in display space.
step('\n=== Step 25: fields and timing against learningeeg (2026-10-12 audit) ===\n');

// Sources: learningeeg, Epileptiform Discharges — generalized discharges often have
// "an anterior predominance", but the morphology "remains throughout all the
// leads". Its two generalized spike-wave figures (rowtable.py; both above 0.5
// row-heights occupancy, so only the aggregate is used): smallest row 0.35 and
// 0.27 of the largest. ACNS 2021 §C.1.a: "frontally predominant" is anterior
// voltage at least 50% above posterior on an ear reference; "midline predominant"
// is midline at least 50% above parasagittal on a common average.

section('Generalized spike-and-wave: on every row, frontally predominant, not a midline focus:', () => {
  for (const toggle of ['3hz-gsw', 'polyspike-wave', 'absence-ictal', 'gtc-ictal'] as const) {
    // 60 s, which for the tonic-clonic seizure stops just short of the end of its
    // clonic phase (61 s): after that the on-minus-off difference is the suppressed
    // BACKGROUND, not the seizure.
    const secs = 60;
    const bip = displayContribAll('bipolar-ap', 'awake', toggle, secs, 20);
    const rows = Object.values(bip).map(absPeak);
    check(`${toggle} smallest / largest row of the double banana (LEARNINGEEG figures: 0.27, 0.35)`,
      Math.min(...rows) / Math.max(...rows), 0.25, 1);
    check(`${toggle} largest left/right difference between homologous rows (LEARNINGEEG: over 50% is abnormal)`,
      largestSideDifference(bip), 0, 0.5);
    const ipsi = displayContribAll('reference-ipsi', 'awake', toggle, secs, 20);
    check(`${toggle} anterior / posterior voltage, reference-ipsi (ACNS: frontally predominant from 1.5)`,
      meanPeakAt(ipsi, ANTERIOR_SITES, IPSI_EAR) / meanPeakAt(ipsi, POSTERIOR_SITES, IPSI_EAR), 1.5, Infinity);
    const car = displayContribAll('reference-car', 'awake', toggle, secs, 20);
    check(`${toggle} midline / parasagittal voltage, reference-car (ACNS: "midline predominant" from 1.5)`,
      meanPeakAt(car, ['Fz', 'Cz', 'Pz'], () => 'AVG') / meanPeakAt(car, ['F3', 'F4', 'C3', 'C4', 'P3', 'P4'], () => 'AVG'),
      0, 1.5);
  }
});

// Source: learningeeg, Rhythmicity & Periodicity — "the bifrontal delta activity
// does not travel back to the posterior regions"; on its figure the frontopolar
// rows carry the most.

section('\nFIRDA: largest on the frontopolar rows, gone by the posterior ones:', () => {
  const bip = displayContribAll('bipolar-ap', 'awake', 'firda', 60, 20);
  const r = (...labels: string[]) => labels.reduce((a, l) => a + rmsOf(bip[l]), 0) / labels.length;
  const frontopolar = r('Fp1-F3', 'Fp2-F4', 'Fp1-F7', 'Fp2-F8');
  check('firda frontopolar rows / Fz-Cz (LEARNINGEEG figure: largest at the frontal pole)',
    frontopolar / r('Fz-Cz'), 1, 3);
  check('firda posterior rows / frontopolar rows (LEARNINGEEG: "does not travel back")',
    r('P3-O1', 'P4-O2', 'T5-O1', 'T6-O2') / frontopolar, 0, 0.2);
});

// Source: learningeeg, Non-Epileptiform — triphasic waves are "most often
// generalized", "maximal frontally".

section('\nTriphasic waves: generalized, not a midline focus:', () => {
  const bip = displayContribAll('bipolar-ap', 'awake', 'triphasic', 60, 20);
  const rows = Object.values(bip).map(absPeak).sort((a, b) => a - b);
  // No figure was measured for this one, so this is a guard, not a target: as a
  // patch under Fz the median row was 0.17 of the largest (Fz-Cz).
  check('triphasic median / largest row of the double banana (LEARNINGEEG: "most often generalized"; 0.17 as a midline focus)',
    rows[rows.length >> 1] / rows[rows.length - 1], 0.3, 1);
  const car = displayContribAll('reference-car', 'awake', 'triphasic', 60, 20);
  check('triphasic midline / parasagittal voltage, reference-car (ACNS: "midline predominant" from 1.5)',
    meanPeakAt(car, ['Fz', 'Cz', 'Pz'], () => 'AVG') / meanPeakAt(car, ['F3', 'F4', 'C3', 'C4', 'P3', 'P4'], () => 'AVG'),
    0, 1.5);
});

// Source: learningeeg, Artifacts — sweat is "very slow (typically less than
// 0.5 Hz), relatively low amplitude". The floor is one millimetre of pen at
// 7 uV/mm (7 uV peak to peak, ~2.5 uV RMS for a slow wander): below that the
// toggle is not on the page. The ceiling keeps it under the adult background's
// own 10-50 uV, which is what "relatively low" is relative to.

section('\nSweat: a rolling baseline that reaches the page:', () => {
  const x = displayContribAll('bipolar-ap', 'awake', 'sweat', 120, 20)['Fp1-F3'];
  check('sweat Fp1-F3 drift, toggle on minus off (RMS; measured 0.1 uV before the fix)', rmsOf(x), 2.5, 20, ' uV');
  check('sweat Fp1-F3 dominant frequency (LEARNINGEEG: typically < 0.5 Hz)',
    spectralPeak(welch(x, FS, 8192), 0.03, 5).freq, 0, 0.5, ' Hz');
});

// Interference identical on every electrode is rejected by every difference a
// montage takes. The floor is the amplifier's own noise (0.9 uV RMS per electrode):
// under it the line is thinner than the trace it is meant to thicken.

section('\nMains: reaches a bipolar page:', () => {
  const bip = displayContribAll('bipolar-ap', 'awake', '50hz', 30, 20);
  const amps = Object.values(bip).map(rmsOf).sort((a, b) => a - b);
  check('mains median double-banana row at the default 5 uV, toggle on minus off (RMS; measured 0.0 uV before the fix)',
    amps[Math.floor(amps.length / 2)], 0.9, 5, ' uV');
});

// Source: learningeeg, Artifacts — its one mains figure, "60 Hz electrode artifact":
// "the Fp1 electrode is likely not well connected, leading to a lot of electrical
// interference", and "this would likely be much reduced with the notch filter". Read
// against its own background (read skill): a solid band on the two rows that hold Fp1,
// 37 px peak to peak, against 42 px for the median background row of that slow-wave-
// sleep page (0.88), and none on the other sixteen rows (2026-11-23). Measured as the
// app shows it: app mode, its 1 Hz / 70 Hz filters, the default 5 uV of mains.

section('\nMains: a band on the rows of one poorly connected electrode, much reduced by the notch:', () => {
  const run = (state: PatientState, patterns: Iterable<string>, notch: boolean, seed: number) => {
    const montage = MONTAGES['bipolar-ap'];
    const settings: SimSettings = {
      speed: 30, sensitivity: 7, patientState: state, activePatterns: new Set(patterns),
      ictalParams: defaultIctalParamsMap(), artifactParams: { ...defaultArtifactParams() },
      filters: { ...DEFAULT_FILTERS, notchHz: notch ? 50 : null },
    };
    const src = new SimulationSource(seed, FS);
    src.useAppMode();
    const rows: Record<string, number[]> = {};
    const chans = montage.channels.filter((c) => c.group !== 'ecg');
    for (const c of chans) rows[c.label] = [];
    for (let i = 0; i < 15 * FS; i++) {
      const v = src.next(settings);
      const avg = commonAverage(v);
      if (i >= 5 * FS) for (const c of chans) rows[c.label].push(computeChannelVoltage(c, src.t, v, avg));
    }
    return rows;
  };
  const p2p = (x: number[]) => {
    const s = [...x].sort((a, b) => a - b);
    return s[Math.floor(0.99 * (s.length - 1))] - s[Math.floor(0.01 * (s.length - 1))];
  };
  const mainsRows = (notch: boolean, seed: number) => {
    const on = run('awake', ['50hz'], notch, seed), off = run('awake', [], notch, seed);
    return Object.keys(on).map((k) => ({ k, p: p2p(on[k].map((v, i) => v - off[k][i])) })).sort((a, b) => b.p - a.p);
  };
  const median = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
  let shared = 0, worstOther = 0, worstNotch = 0;
  const ratios: number[] = [];
  const SEEDS = [20, 7, 3];
  for (const seed of SEEDS) {
    const r = mainsRows(false, seed);
    const [a, b] = [r[0].k.split('-'), r[1].k.split('-')];
    const contact = a.find((e) => b.includes(e));
    if (contact) shared++;
    const band = Math.min(r[0].p, r[1].p);
    worstOther = Math.max(worstOther, r[2].p / band);
    const n3 = run('n3', effective(quizPage(['slow-waves'])), false, seed);
    ratios.push(band / median(Object.values(n3).map(p2p)));
    const notched = mainsRows(true, seed);
    const byRow = (k: string) => notched.find((x) => x.k === k)!.p;
    worstNotch = Math.max(worstNotch, byRow(r[0].k) / r[0].p, byRow(r[1].k) / r[1].p);
  }
  check('mains: subjects whose two largest rows share one electrode (the poor contact)', shared, SEEDS.length, SEEDS.length);
  check('mains: band on the poor contact\'s rows / the N3 page\'s median row, peak to peak, median of 3 (learningeeg figure: 0.88)',
    median(ratios), 0.6, 1.2);
  check('mains: largest other row / the band, worst of 3 (learningeeg figure: nothing on the other rows)', worstOther, 0, 0.2);
  check('notch 50 Hz: the band with the notch on / off, worst row of 3 subjects (learningeeg: "much reduced")', worstNotch, 0, 0.25);
  // A box marks what is drawn: none while the notch has taken the mains off the page.
  const boxesOpen = (notch: boolean, lineFreq: 50 | 60) => {
    const settings: SimSettings = {
      speed: 30, sensitivity: 7, patientState: 'awake', activePatterns: new Set(['50hz']),
      ictalParams: defaultIctalParamsMap(), artifactParams: { ...defaultArtifactParams(), lineFreq },
      filters: { ...DEFAULT_FILTERS, notchHz: notch ? 50 : null },
    };
    const src = new SimulationSource(20, FS);
    src.useAppMode();
    const open = new Set<string>();
    for (let i = 0; i < 3 * FS; i++) {
      src.next(settings);
      for (const m of src.groundTruth.marks) {
        if (m.id !== '50hz' || m.key == null) continue;
        if (m.span === Infinity) open.add(m.key); else open.delete(m.key);
      }
    }
    return open.size;
  };
  check('mains boxes open, 50 Hz mains, notch off', boxesOpen(false, 50), 1, 1);
  check('mains boxes open, 50 Hz mains under a 50 Hz notch (nothing left to box)', boxesOpen(true, 50), 0, 0);
  check('mains boxes open, 60 Hz mains under a 50 Hz notch (the notch misses it)', boxesOpen(true, 60), 1, 1);
});

// Source: the owner's reference (Zeto, "Impact of Digital EEG Filter on EEG Signal
// Morphology"), one referential page unfiltered and filtered, read against its filtered
// page's median row (chain.ts MAINS_MANY_WEIGHT has the measurements): frontopolar 0.2
// (its one-pixel floor), frontal 0.3, central 0.8, parietal 1.2, occipital 2.2 or more.
// Read on an ear reference, whose good contacts leave each electrode's own excess.

section('\nMains, many poor contacts: worst over the back of the head, much reduced by the notch:', () => {
  const run = (patterns: string[], notch: boolean, seed: number) => {
    const montage = MONTAGES['reference-ipsi'];
    const settings: SimSettings = {
      speed: 30, sensitivity: 7, patientState: 'awake', activePatterns: new Set(patterns),
      ictalParams: defaultIctalParamsMap(), artifactParams: { ...defaultArtifactParams(), mainsContacts: 'many' },
      filters: { ...DEFAULT_FILTERS, notchHz: notch ? 50 : null },
    };
    const src = new SimulationSource(seed, FS);
    src.useAppMode();
    const chans = montage.channels.filter((c) => c.group !== 'ecg');
    const rows: Record<string, number[]> = {};
    for (const c of chans) rows[c.label] = [];
    for (let i = 0; i < 15 * FS; i++) {
      const v = src.next(settings);
      const avg = commonAverage(v);
      if (i >= 5 * FS) for (const c of chans) rows[c.label].push(computeChannelVoltage(c, src.t, v, avg));
    }
    return rows;
  };
  const p2p = (x: number[]) => {
    const s = [...x].sort((a, b) => a - b);
    return s[Math.floor(0.99 * (s.length - 1))] - s[Math.floor(0.01 * (s.length - 1))];
  };
  const median = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
  const region = (label: string) => {
    const e = label.split('-')[0];
    return e.startsWith('Fp') ? 'Fp' : e.startsWith('O') ? 'O' : e[0] === 'F' ? 'F' : 'other';
  };
  const occ: number[] = [], fp: number[] = [], gradient: number[] = [];
  let worstNotch = 0;
  for (const seed of [20, 7, 3]) {
    const on = run(['50hz'], false, seed), off = run([], false, seed);
    const onN = run(['50hz'], true, seed), offN = run([], true, seed);
    const bg = median(Object.values(off).map(p2p));
    const by: Record<string, number[]> = { Fp: [], F: [], O: [], other: [] };
    for (const k of Object.keys(on)) {
      const band = p2p(on[k].map((v, i) => v - off[k][i]));
      by[region(k)].push(band / bg);
      if (band / bg > 1) worstNotch = Math.max(worstNotch, p2p(onN[k].map((v, i) => v - offN[k][i])) / band);
    }
    occ.push(median(by.O));
    fp.push(median(by.Fp));
    gradient.push(median(by.O) / median([...by.Fp, ...by.F]));
  }
  check('mains, many contacts: occipital channels / the page\'s median row, peak to peak, median of 3 (reference: 2.2 or more)',
    median(occ), 1.5, 3.5);
  check('mains, many contacts: frontopolar channels / the page\'s median row, worst of 3 (reference: 0.2)', Math.max(...fp), 0, 0.5);
  check('mains, many contacts: occipital / frontopolar and frontal, smallest of 3 (reference: about 9)', Math.min(...gradient), 3, Infinity);
  check('notch 50 Hz, many contacts: channel with the notch on / off, worst of 3 subjects', worstNotch, 0, 0.25);
});

// Sources: eegpedia (ECG artifact) — "most prominent in referential montages using
// earlobe electrodes"; learningeeg (Artifacts) — "usually relatively low
// amplitude", "more prominent or solely seen on the left side", and its figure, boxed
// on the left posterior chains only (IK-053). The floor is one millimetre of pen at
// 7 uV/mm. The left/right ceiling was 3, with no source; "solely seen on the left"
// allows any ratio over 1 (2026-11-25). The largest double-banana row was held to
// 1-10 uV, a ceiling with no source either; it is now read against the row's own
// background, as the figure gives it.

section('\nECG artifact: visible against the ear, low on the double banana, larger on the left:', () => {
  const ear = displayContribAll('reference-ipsi', 'awake', 'ecg-artifact', 30, 20);
  check('ecg-artifact R wave at Cz-A1, reference-ipsi (measured 4 uV before the fix)', absPeak(ear['Cz-A1']), 7, 40, ' uV');
  const side = (els: string[], ref: string) => els.reduce((a, e) => a + absPeak(ear[`${e}-${ref}`]), 0);
  check('ecg-artifact left / right, reference-ipsi (LEARNINGEEG: more prominent on the left)',
    side(['F3', 'C3', 'P3'], 'A1') / side(['F4', 'C4', 'P4'], 'A2'), 1, Infinity);
});

section('\nECG artifact on the double banana (IK-053): the left posterior chains, about half their background:', () => {
  const LEFT_POSTERIOR = ['C3-P3', 'P3-O1', 'T3-T5', 'T5-O1'];
  const FRONTAL = ['Fp1-F3', 'Fp2-F4', 'Fp1-F7', 'Fp2-F8', 'F3-C3', 'F4-C4', 'Fz-Cz'];
  const p2p = (x: Float64Array) => {
    const s = Array.from(x).sort((a, b) => a - b);
    return s[Math.floor(0.99 * (s.length - 1))] - s[Math.floor(0.01 * (s.length - 1))];
  };
  const median = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
  let leftPosterior = 0;
  const lr: number[] = [], frontal: number[] = [], size: number[] = [], earOverBip: number[] = [];
  for (const seed of [3, 7, 20]) {
    const bip = displayContribAll('bipolar-ap', 'awake', 'ecg-artifact', 20, seed);
    const ear = displayContribAll('reference-ipsi', 'awake', 'ecg-artifact', 20, seed);
    const bg = runDisplay('bipolar-ap', 'awake', [], 20, seed);
    const amp: Record<string, number> = Object.fromEntries(Object.entries(bip).map(([l, x]) => [l, p2p(x)]));
    const ranked = Object.entries(amp).sort((a, b) => b[1] - a[1]);
    if (ranked.slice(0, 3).every(([l]) => LEFT_POSTERIOR.includes(l))) leftPosterior++;
    lr.push(Math.min(amp['P3-O1'] / amp['P4-O2'], amp['T5-O1'] / amp['T6-O2'], amp['T3-T5'] / amp['T4-T6']));
    const [topLabel, topAmp] = ranked[0];
    frontal.push(Math.max(...FRONTAL.map((l) => amp[l])) / topAmp);
    const row = bg.montage.channels.findIndex((c) => c.label === topLabel);
    size.push(topAmp / p2p(bg.data[row]));
    earOverBip.push(Math.max(...Object.values(ear).map(p2p)) / topAmp);
  }
  check('ecg-artifact: subjects whose three largest double-banana rows are left posterior (C3-P3, P3-O1, T3-T5, T5-O1)', leftPosterior, 3, 3);
  check('ecg-artifact: left / right double-banana rows (P3-O1, T5-O1, T3-T5 over the right), smallest of 3', Math.min(...lr), 1.5, Infinity);
  check('ecg-artifact: frontal double-banana rows / the largest row, worst of 3', Math.max(...frontal), 0, 0.35);
  check('ecg-artifact: largest double-banana row / its own background, peak to peak, median of 3 (learningeeg figure: about 0.5)', median(size), 0.25, 1);
  check('ecg-artifact: largest ear-referenced channel / largest double-banana row, smallest of 3 (eegpedia: most prominent with earlobe references)', Math.min(...earOverBip), 1.5, Infinity);
});

// Source: learningeeg (Artifacts) — myogenic artifact is "most commonly found in the
// frontal or lateral temporal regions", with "only minimal myogenic artifact near
// the vertex"; chewing is "bursts of generalized very fast activity".

section('\nMuscle: temporal and frontal, least over the centre; chewing reaches every chain:', () => {
  const rowRms = (toggle: string) => {
    const bip = displayContribAll('bipolar-ap', 'awake', toggle, 60, 20);
    return (...labels: string[]) => labels.reduce((a, l) => a + rmsOf(bip[l]), 0) / labels.length;
  };
  const m = rowRms('muscle');
  const temporal = m('T3-T5', 'T4-T6');
  check('muscle central rows / mid-temporal rows (LEARNINGEEG: temporal; measured 0.87 before the fix)',
    m('C3-P3', 'C4-P4') / temporal, 0, 0.3);
  check('muscle midline rows / mid-temporal rows (LEARNINGEEG: "minimal ... near the vertex")',
    m('Fz-Cz', 'Cz-Pz') / temporal, 0, 0.3);
  check('muscle frontopolar rows / mid-temporal rows (LEARNINGEEG: frontal as well as temporal)',
    m('Fp1-F3', 'Fp2-F4', 'Fp1-F7', 'Fp2-F8') / temporal, 0.3, 2);
  const c = rowRms('chewing');
  check('chewing parasagittal rows / temporal rows (LEARNINGEEG: "generalized", temporal maximum)',
    c('Fp1-F3', 'F3-C3', 'C3-P3', 'P3-O1', 'Fp2-F4', 'F4-C4', 'C4-P4', 'P4-O2')
      / c('Fp1-F7', 'F7-T3', 'T3-T5', 'T5-O1', 'Fp2-F8', 'F8-T4', 'T4-T6', 'T6-O2'), 0.1, 1);
});

// Sources: learningeeg atlas — "each wicket should be the same duration"; the AES
// atlas (NBK390343) gives wickets as 6-11 Hz and 60-200 uV.

section('\nWicket: one frequency per burst, large enough to read:', () => {
  const x = displayContribAll('bipolar-ap', 'drowsy', 'wicket', 120, 20)['T3-T5'];
  check('wicket T3-T5 largest burst (AES atlas: 60-200 uV at the electrode; measured 12 uV before the fix)',
    absPeak(x), 40, 200, ' uV');
  // Cycle lengths inside the largest RUN: upward zero crossings within 0.35 s of its
  // peak. One carrier gives equal cycles; a sum of tones does not. Since 2026-10-27 a
  // third of the events are a single wicket, which has one cycle, so the largest peak
  // with at least four cycles round it is taken.
  const order = Array.from(x.keys()).sort((a, b) => Math.abs(x[b]) - Math.abs(x[a]));
  let cyc: number[] = [];
  for (const at of order) {
    if (Math.abs(x[at]) < 0.3 * Math.abs(x[order[0]])) break;
    const ups: number[] = [];
    for (let k = Math.max(1, at - Math.round(0.35 * FS)); k < Math.min(x.length, at + Math.round(0.35 * FS)); k++) {
      if (x[k - 1] < 0 && x[k] >= 0) ups.push(k - x[k] / (x[k] - x[k - 1]));
    }
    if (ups.length >= 5) { cyc = ups.slice(1).map((u, i) => u - ups[i]); break; }
  }
  const m = cyc.reduce((a, b) => a + b, 0) / cyc.length;
  check('wicket cycle-length CV within the largest burst (LEARNINGEEG: "each wicket should be the same duration")',
    Math.sqrt(cyc.reduce((a, b) => a + (b - m) ** 2, 0) / cyc.length) / m, 0, 0.1);
  check('wicket frequency of the largest burst (IK-015: 6-11 Hz)', FS / m, 6, 11, ' Hz');
});

// Source: learningeeg — lambda waves look "almost identical to POSTS" and are
// "very occipitally focused"; they follow visual scanning, i.e. saccades. The
// field bound is the one POSTS are held to above.

section('\nLambda: occipital like POSTS, and not periodic:', () => {
  const bip = displayContribAll('bipolar-ap', 'awake', 'lambda', 120, 20);
  check('lambda field C3-P3 / P3-O1 (LEARNINGEEG: "very occipitally focused"; measured 0.51 before the fix)',
    absPeak(bip['C3-P3']) / absPeak(bip['P3-O1']), 0, 0.35);
  check('lambda largest change between consecutive intervals (LEARNINGEEG: not periodic beyond 50%)',
    largestStep(eventIntervals(bip['P3-O1'], 0.4, 0.2)), 0.5, Infinity);
});

// Sources: learningeeg — "posterior quadrants"; StatPearls NBK555899 — the
// posterior temporal head regions. Raw electrodes, so no reference takes a share.

section('\n14 & 6 Hz positive bursts and mu: in the right place:', () => {
  const raw = (state: PatientState, toggle: string, el: string) => {
    const on = runEngineState(120, SLEEP_OPTS, state, [toggle]);
    const off = runEngineState(120, SLEEP_OPTS, state, []);
    const i = on.eng.indexOf(el);
    return on.data[i].map((v, k) => v - off.data[i][k]);
  };
  check('14-6-pos T5 / O1 (posterior TEMPORAL maximum; measured 0.36 before the fix)',
    absPeak(raw('drowsy', '14-6-pos', 'T5')) / absPeak(raw('drowsy', '14-6-pos', 'O1')), 1.2, 10);
  // learningeeg: mu runs "over the centroparietal (central) regions".
  check('mu-rhythm toggle P3 / C3 (LEARNINGEEG: centroparietal; measured 0.01 before the fix)',
    rmsOf(raw('awake', 'mu-rhythm', 'P3')) / rmsOf(raw('awake', 'mu-rhythm', 'C3')), 0.15, 0.6);
});

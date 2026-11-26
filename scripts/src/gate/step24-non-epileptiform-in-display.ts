import { welch, autocorr, spectralPeak } from '../dsp';
import { renderTrace } from '../renderTrace';
import { ANTERIOR_SITES, FS, IPSI_EAR, POSTERIOR_SITES, SCRATCH, absPeak, bandPower, bestLag, check, corr, displayContrib, displayContribAll, eventIntervals, largestSideDifference, largestStep, meanPeakAt, pctP2p, runDisplay, section, step } from './harness';

step('\n=== Step 24: non-epileptiform in DISPLAY space (A5 audit) ===\n');

section('FIRDA: frontal-maximal, rhythmic ~1.5-3 Hz, reference-car:', () => {
  const fz = displayContrib('reference-car', 'awake', 'firda', 'Fz-AVG', 60, 20);
  // Frontal maximum, read on the ear (ACNS 2021 §C.1.a: frontally predominant is
  // anterior voltage at least 50% above posterior on, among others, an ipsilateral
  // ear reference). These were `Fz-AVG p2p > O1-AVG / T3-AVG`: on the common
  // average a bilateral frontal field leaves the back of the head with an inverted
  // copy of the average, so the ratio tends to 1 however frontal the rhythm is
  // (measured 1.04 and 1.41). The frontal pole is the maximum, so it is read there.
  {
    const ear = displayContribAll('reference-ipsi', 'awake', 'firda', 60, 20);
    check('firda Fp1-A1 p2p / O1-A1 p2p, reference-ipsi (ACNS: frontally predominant from 1.5)',
      pctP2p(ear['Fp1-A1']) / pctP2p(ear['O1-A1']), 1.5, Infinity);
    check('firda Fp1-A1 p2p / T3-A1 p2p, reference-ipsi (frontal, not temporal)',
      pctP2p(ear['Fp1-A1']) / pctP2p(ear['T3-A1']), 1.5, Infinity);
  }
  const pk = spectralPeak(welch(fz, FS, 2048), 1, 4);
  // learningeeg gives no band beyond "delta" and shows one example at 1.5 Hz; the
  // 1.5-3 Hz here is the conventional figure for FIRDA, and this label used to
  // credit learningeeg with it.
  check('firda Fz-AVG discharge frequency (delta; conventionally 1.5-3 Hz, learningeeg example 1.5 Hz)', pk.freq, 1.5, 3.0, ' Hz');
  check('firda Fz-AVG spectral peak is tight (rhythmic, not polymorphic)', pk.fwhm, 0, 1.2, ' Hz');
  const ac = autocorr(fz, Math.round(FS * 3));
  let bestLagIdx = -1, bestVal = -1;
  for (let i = Math.round(FS * 0.2); i < ac.length; i++) if (ac[i] > bestVal) { bestVal = ac[i]; bestLagIdx = i; }
  check('firda Fz-AVG autocorrelation has a strong secondary peak near its own cycle length (rhythmicity)',
    bestVal, 0.5, 1.0);
  check('firda Fz-AVG secondary-peak lag lands within one ~1.5-3 Hz cycle', bestLagIdx / FS, 0.25, 0.7, ' s');
  renderTrace({ state: 'awake', patterns: ['firda'], montage: 'reference-car', seconds: 6, seed: 20,
    out: `${SCRATCH}/a5-firda-refcar.png` });
});

section('\nFocal temporal slowing: lateralized delta/theta, bipolar-ap:', () => {
  const t3t5 = displayContrib('bipolar-ap', 'awake', 'focal-delta-temporal', 'T3-T5', 60, 20);
  const t4t6 = displayContrib('bipolar-ap', 'awake', 'focal-delta-temporal', 'T4-T6', 60, 20);
  check('focal-delta-temporal T3-T5 p2p >> T4-T6 p2p (lateralized, LEARNINGEEG: unilateral)',
    pctP2p(t3t5) / pctP2p(t4t6), 20, 1e7);
  const pk = spectralPeak(welch(t3t5, FS, 2048), 0.5, 4);
  check('focal-delta-temporal T3-T5 discharge frequency is delta/theta range', pk.freq, 0.5, 4, ' Hz');
  renderTrace({ state: 'awake', patterns: ['focal-delta-temporal'], montage: 'bipolar-ap', seconds: 6, seed: 20,
    out: `${SCRATCH}/a5-focal-delta-temporal-bipap.png` });
});

section('\nGeneralized slowing (moderate): diffuse, symmetric, A-P gradient lost, PDR slowed to theta — reference-ipsi, 3 seeds:', () => {
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
});

section('\nGPEDs: periodic, roughly regular interval, generalized, reference-car Cz-AVG:', () => {
  const cz = displayContrib('reference-car', 'awake', 'gpeds', 'Cz-AVG', 120, 20);
  const iv = eventIntervals(cz, 0.3, 0.5);
  const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
  const sd = Math.sqrt(iv.reduce((a, b) => a + (b - mean) ** 2, 0) / iv.length);
  // The old label credited learningeeg with "roughly 1-2.5 s". Its "1-2.5" is in
  // HERTZ, and is where GPDs enter the ictal-interictal continuum; the same bounds
  // read as an interval say the opposite — slower than 1 Hz, below that range.
  check('gpeds Cz-AVG mean inter-discharge interval (no faster than 1 Hz: below the ictal-interictal continuum)', mean, 1.0, 2.5, ' s');
  check('gpeds Cz-AVG interval coefficient of variation stays low (periodic, not random)', sd / mean, 0, 0.35);
  const o1 = displayContrib('reference-car', 'awake', 'gpeds', 'O1-AVG', 120, 20);
  check('gpeds present at O1-AVG too (generalized, not focal)', pctP2p(o1), 15, 1e6, ' uV');
  check('gpeds Cz-AVG / O1-AVG p2p ratio stays within a generalized (not sharply focal) range', pctP2p(cz) / pctP2p(o1), 1, 6);
  // ACNS 2021 §C.2.a: "nearly regular" is a cycle length varying by < 50% from one
  // cycle to the next in most (> 50%) cycle pairs. The CV above is this file's own
  // yardstick; this is the definition's.
  let regularPairs = 0;
  for (let i = 1; i < iv.length; i++) if (Math.abs(iv[i] - iv[i - 1]) / iv[i - 1] < 0.5) regularPairs++;
  check('gpeds cycle pairs varying < 50% (ACNS: periodic = most, > 0.5)', regularPairs / (iv.length - 1), 0.5, 1);
  check('gpeds largest change between consecutive intervals (LEARNINGEEG: periodic < 25%)', largestStep(iv), 0, 0.25);
  renderTrace({ state: 'awake', patterns: ['gpeds'], montage: 'reference-car', seconds: 8, seed: 20,
    out: `${SCRATCH}/a5-gpeds-refcar.png` });
});

// A generalized discharge has to be generalized ON THE PAGE. The four checks above
// read Cz and O1 on the common average, and passed (6.0 against a ceiling of 6)
// while the discharge was a vertex spike: 123 uV on Fz-Cz, 25 uV on the
// parasagittal rows and 1-2 uV on the temporal chains, because two electrodes on
// one reference say nothing about the other seventeen. These read every row.
//
// Sources. ACNS 2021 (Hirsch et al., J Clin Neurophysiol 38:1) §C.1.a: generalized
// is "any bilaterally synchronous and symmetric pattern"; a generalized pattern is
// "midline predominant" when midline voltage is >= 50% above parasagittal on a
// common average, and frontally or occipitally predominant on the same 50% rule,
// read on (among others) an ipsilateral ear reference. learningeeg's two GPD
// figures (Rhythmicity & Periodicity), read with read-lab's rowtable.py: the
// smallest of the eighteen double-banana rows is 0.42 and 0.53 of the largest. Both
// pages sit above 1 row-height occupancy, where a single row's reading is not
// admissible (read skill), so only that aggregate is used and the floor is set
// under it, at a third.

section('\nGPEDs: generalized on the page — every row, both sides, no predominance (ACNS 2021; LEARNINGEEG figures):', () => {
  const bip = displayContribAll('bipolar-ap', 'awake', 'gpeds', 60, 20);
  const rows = Object.values(bip).map(absPeak);
  check('gpeds smallest / largest row of the double banana (LEARNINGEEG figures: 0.42, 0.53)',
    Math.min(...rows) / Math.max(...rows), 1 / 3, 1);
  check('gpeds largest left/right difference between homologous rows (LEARNINGEEG: over 50% is abnormal)',
    largestSideDifference(bip), 0, 0.5);
  check('gpeds F3-C3 vs F4-C4 correlation (ACNS: bilaterally synchronous)',
    corr(bip['F3-C3'], bip['F4-C4']), 0.9, 1.0001);
  const car = displayContribAll('reference-car', 'awake', 'gpeds', 60, 20);
  check('gpeds midline / parasagittal voltage, reference-car (ACNS: "midline predominant" from 1.5)',
    meanPeakAt(car, ['Fz', 'Cz', 'Pz'], () => 'AVG') / meanPeakAt(car, ['F3', 'F4', 'C3', 'C4', 'P3', 'P4'], () => 'AVG'),
    1 / 1.5, 1.5);
  const ipsi = displayContribAll('reference-ipsi', 'awake', 'gpeds', 60, 20);
  check('gpeds anterior / posterior voltage, reference-ipsi (ACNS: frontal or occipital predominance from 1.5)',
    meanPeakAt(ipsi, ANTERIOR_SITES, IPSI_EAR) / meanPeakAt(ipsi, POSTERIOR_SITES, IPSI_EAR),
    1 / 1.5, 1.5);
});

section('\nLPEDs: periodic, roughly regular interval, lateralized, bipolar-ap:', () => {
  const t3t5 = displayContrib('bipolar-ap', 'awake', 'lpeds', 'T3-T5', 120, 20);
  // One discharge is now a sharp wave AND its slow wave, 0.6 s in all, so the
  // detector's refractory period has to cover the whole complex: at 0.4 s the
  // tail of a large, stretched slow wave was still near threshold and counted
  // as a second discharge.
  const iv = eventIntervals(t3t5, 0.3, 0.6);
  const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
  const sd = Math.sqrt(iv.reduce((a, b) => a + (b - mean) ** 2, 0) / iv.length);
  // learningeeg: "recurring roughly once per second"; its example is 1-1.5 Hz.
  // The old bounds, 0.8-2 s, were not its figure.
  check('lpeds T3-T5 mean inter-discharge interval (LEARNINGEEG: "roughly once per second")', mean, 0.67, 1.5, ' s');
  check('lpeds T3-T5 interval coefficient of variation stays low (periodic, not random)', sd / mean, 0, 0.35);
  check('lpeds largest change between consecutive intervals (LEARNINGEEG: periodic < 25%)', largestStep(iv), 0, 0.25);
  const t4t6 = displayContrib('bipolar-ap', 'awake', 'lpeds', 'T4-T6', 120, 20);
  check('lpeds T3-T5 p2p >> T4-T6 p2p (lateralized, unlike GPEDs)', pctP2p(t3t5) / pctP2p(t4t6), 20, 1e7);

  // Regional, not under one electrode: the left parasagittal chain carries it too.
  // learningeeg's "Left temporal LPDs at 1 Hz", read row by row — the median
  // peak-to-peak per 1 s window of the page as drawn, each left row less its
  // right-side twin (the background's share), as a fraction of T3-T5's — gives
  // F7-T3 0.84, F3-C3 0.68, C3-P3 0.27. Same estimator here, on the page with its
  // background. The bounds are those figures +-0.3, which is how far the estimate
  // moved on the figure between the median window and the 80th-percentile one
  // (0.29, 0.23, 0.07). One patch under T3 gave F3-C3 0.09 of T3-T5 by its leadfield.
  {
    const page = runDisplay('bipolar-ap', 'awake', ['lpeds'], 60, 20);
    const windowP2p = (label: string) => {
      const x = page.data[page.montage.channels.findIndex((c) => c.label === label)];
      const w: number[] = [];
      for (let s = 0; s + FS <= x.length; s += FS) {
        let lo = Infinity, hi = -Infinity;
        for (let k = s; k < s + FS; k++) { if (x[k] < lo) lo = x[k]; if (x[k] > hi) hi = x[k]; }
        w.push(hi - lo);
      }
      return w.sort((a, b) => a - b)[Math.floor(w.length / 2)];
    };
    const share = (left: string, right: string) =>
      (windowP2p(left) - windowP2p(right)) / (windowP2p('T3-T5') - windowP2p('T4-T6'));
    check('lpeds F7-T3 less F8-T4, as a share of T3-T5 less T4-T6 (LEARNINGEEG figure: 0.84)', share('F7-T3', 'F8-T4'), 0.54, 1.14);
    check('lpeds F3-C3 less F4-C4, as a share of T3-T5 less T4-T6 (LEARNINGEEG figure: 0.68)', share('F3-C3', 'F4-C4'), 0.38, 0.98);
    check('lpeds C3-P3 less C4-P4, as a share of T3-T5 less T4-T6 (LEARNINGEEG figure: 0.27)', share('C3-P3', 'C4-P4'), 0, 0.57);
  }
  renderTrace({ state: 'awake', patterns: ['lpeds'], montage: 'bipolar-ap', seconds: 8, seed: 20,
    out: `${SCRATCH}/a5-lpeds-bipap.png` });
});

section('\nTriphasic waves: classic 3-phase morphology with anterior->posterior time lag, reference-ipsi (A1 mastoid ref avoids CAR self-subtraction):', () => {
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
  // The two correlation floors were 0.15 and 0.08, and the engine sat on them at
  // 0.189 and 0.129: the posterior half drifted 0.11 s further behind on every
  // complex (nonEpileptiform.ts, TRIPHASIC_SPAN), so front and back were hardly
  // related at all. One discharge seen twice is strongly correlated at its lag.
  check('triphasic Fz-A1 vs Pz-A1 lagged correlation is a real, positive relationship', lagPz.corr, 0.5, 1.0);
  check('triphasic Fz-A1 leads O1-A1 (positive lag = posterior follows anterior)', lagO1.lag / FS, 0.008, 0.2, ' s');
  check('triphasic Fz-A1 vs O1-A1 lagged correlation is a real, positive relationship', lagO1.corr, 0.5, 1.0);
  // ACNS 2021 §C.4.c: an anterior-posterior lag is "a consistent measurable delay
  // of > 100 ms from the most anterior to the most posterior derivation" — so it
  // is read between the first and last rows of a longitudinal chain, not against
  // an ear that itself carries the anterior field. P3-O1 is negated: the wave is
  // largest at the far end of that row and at the near end of Fp1-F3.
  {
    const bip = displayContribAll('bipolar-ap', 'awake', 'triphasic', 60, 20);
    const lag = bestLag(bip['Fp1-F3'], bip['P3-O1'].map((v) => -v), Math.round(FS * 0.6));
    check('triphasic Fp1-F3 leads P3-O1, bipolar-ap (ACNS: an A-P lag is > 100 ms)', lag.lag / FS, 0.1, 0.2, ' s');
  }
  // learningeeg (Non-Epileptiform, key points): triphasic waves run at 1-3 Hz.
  {
    const iv = eventIntervals(fz, 0.5, 0.4);
    check('triphasic repetition rate (LEARNINGEEG: 1-3 Hz)', iv.length / iv.reduce((a, b) => a + b, 0), 1, 3, ' Hz');
  }
  // Read at the frontal pole, where the field is largest, against the ear (ACNS
  // 2021 §C.1.a: frontally predominant is a 50% excess). This was `Fz-A1 p2p >
  // O1-A1 p2p`, from when the whole wave was one patch under Fz.
  check('triphasic Fp1-A1 p2p / O1-A1 p2p, reference-ipsi (ACNS: frontally predominant from 1.5)',
    pctP2p(displayContrib('reference-ipsi', 'awake', 'triphasic', 'Fp1-A1', 60, 20)) / pctP2p(o1), 1.5, 20);
  renderTrace({ state: 'awake', patterns: ['triphasic'], montage: 'bipolar-ap', seconds: 6, seed: 20,
    out: `${SCRATCH}/a5-triphasic-bipap.png` });
  renderTrace({ state: 'awake', patterns: ['triphasic'], montage: 'reference-car', seconds: 6, seed: 20,
    out: `${SCRATCH}/a5-triphasic-refcar.png` });
});

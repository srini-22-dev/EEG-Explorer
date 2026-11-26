import { buildLeadfield } from '../../../artifacts/eeg-simulator/src/engine/forward';
import { welch, hilbertEnvelope, spectralPeak } from '../dsp';
import { MONTAGES } from '../../../artifacts/eeg-simulator/src/utils/montages';
import type { ChannelDef } from '../../../artifacts/eeg-simulator/src/utils/montages';
import { computeChannelVoltage } from '../../../artifacts/eeg-simulator/src/utils/computeChannel';
// A6 audit (Step 21): the pure morphology math for the interictal spike/slow-
// wave complex, reused to build a genuine spike source anchored MIDWAY between
// two electrodes (IK-003 case b) — every other spike source in the app is
// anchored ON an electrode, so no existing toggle demonstrates the midway
// signature and one has to be synthesized the same way Step 16's static
// leadfield-gain precedent already does, just driven as a real time series.
import { spikeSlowWave } from '../../../artifacts/eeg-simulator/src/engine/sources/morphology';
import { FS, check, corr, displayContrib, midwaySource, pctP2p, runDisplay, section, step } from './harness';

step('\n=== Step 21: epileptiform in DISPLAY space (A6 audit) ===\n');

// Step 15 already checks these sources referentially (raw electrode space).
// CLAUDE.md §4 requires the clinical claims specific to epileptiform
// discharges — spike-vs-sharp DURATION, phase-reversal LOCALISATION, the
// generalised/frontal-max shape of 3 Hz GSW, multiple spikes per polyspike
// complex, burst-suppression's alternation, hypsarrhythmia's chaotic
// multifocality — verified on the montage-derived, common-average/bipolar
// channel a reader actually reads, not just as a referential scalar.

section('IK-012 (spike/sharp duration, ±slow wave) survives the montage transform, bipolar-ap T3-T5:', () => {
  // The base width at 10% of the peak, and the after-going slow wave: the largest
  // excursion 0.08-0.4 s after the peak, with its sign, as a fraction of the peak.
  //
  // `level` is where the width is read. A bare spike or sharp wave is read at 10%
  // of its peak. One with a slow wave cannot be — the slow wave has the same
  // polarity and starts at once, so the trace does not come back to 10% between
  // them — and is read at half height instead, then scaled to the 10% base of the
  // same Gaussian (4.292 / 2.355).
  const measure = (d: Float64Array, level = 0.1) => {
    let peak = 0, peakAt = 0;
    for (let k = 0; k < d.length; k++) if (d[k] < peak) { peak = d[k]; peakAt = k; }
    const thresh = level * Math.abs(peak);
    let lo = peakAt; while (lo > 0 && Math.abs(d[lo]) >= thresh) lo--;
    let hi = peakAt; while (hi < d.length - 1 && Math.abs(d[hi]) >= thresh) hi++;
    const widthMs = ((hi - lo) / FS) * 1000 * (level === 0.1 ? 1 : 4.292 / 2.355);
    let slow = 0;
    const from = Math.min(d.length, peakAt + Math.round(0.08 * FS));
    const end = Math.min(d.length, peakAt + Math.round(0.4 * FS));
    for (let k = from; k < end; k++) if (Math.abs(d[k]) > Math.abs(slow)) slow = d[k];
    return { widthMs, slowRatio: Math.abs(slow) / Math.abs(peak), slowSign: Math.sign(slow), peak: Math.abs(peak) };
  };
  const spike = measure(displayContrib('bipolar-ap', 'awake', 'ied-spike', 'T3-T5', 180, 7));
  const sharp = measure(displayContrib('bipolar-ap', 'awake', 'ied-sharp', 'T3-T5', 180, 7));
  const spikeWave = measure(displayContrib('bipolar-ap', 'awake', 'ied-spike-wave', 'T3-T5', 180, 7), 0.5);
  const sharpWave = measure(displayContrib('bipolar-ap', 'awake', 'ied-sharp-wave', 'T3-T5', 180, 7), 0.5);
  check('ied-spike T3-T5 base width (IK-012: 20-70 ms)', spike.widthMs, 20, 70, ' ms');
  check('ied-sharp T3-T5 base width (IK-012: 70-200 ms)', sharp.widthMs, 70, 200, ' ms');
  check('ied-spike T3-T5 has no after-going slow wave', spike.slowRatio, 0, 0.15);
  check('ied-sharp T3-T5 has no after-going slow wave', sharp.slowRatio, 0, 0.15);
  check('ied-spike-wave T3-T5 base width stays spike-length (~20-70 ms)', spikeWave.widthMs, 20, 70, ' ms');
  check('ied-sharp-wave T3-T5 base width stays sharp-length (~70-200 ms)', sharpWave.widthMs, 70, 200, ' ms');
  check('ied-spike-wave T3-T5 HAS an after-going slow wave', spikeWave.slowRatio, 0.3, 1.5);
  check('ied-sharp-wave T3-T5 HAS an after-going slow wave', sharpWave.slowRatio, 0.3, 1.5);
  // T3 is input 1 of T3-T5, so the spike points up there, and so does its slow wave.
  check('ied-spike-wave T3-T5: the slow wave deflects the same way as its spike (-1; IK-012)', spikeWave.slowSign, -1, -1);
  check('ied-sharp-wave T3-T5: the slow wave deflects the same way as its sharp wave (-1; IK-012)', sharpWave.slowSign, -1, -1);
});

section('\nIK-003 case (a): a focal SPIKE source produces a phase reversal AT the electrode it peaks under, bipolar-ap:', () => {
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
});

section('\nIK-003 case (b): a focal SPIKE source anchored MIDWAY between two electrodes cancels on the link spanning them, bipolar-ap:', () => {
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
});

// The same signature from a toggle a learner can switch on: the focal-spike
// toggles' Focus option puts the source midway between the focus electrode and
// its neighbour up the chain (2026-10-13). Read through the whole display path,
// recording chain included — so the flat link is flat to within the amplifiers'
// gain mismatch, not to zero.

section('\nIsopotential from a toggle: focal spikes with the focus BETWEEN two electrodes (IK-003 case b):', () => {
  for (const [toggle, flat, above, below, beyond] of [
    ['focal-spikes-lt', 'F7-T3', 'Fp1-F7', 'T3-T5', 'T5-O1'],
    ['focal-spikes-rt', 'F8-T4', 'Fp2-F8', 'T4-T6', 'T6-O2'],
    ['focal-spikes-lf', 'F3-C3', 'Fp1-F3', 'C3-P3', 'P3-O1'],
  ] as const) {
    const on = runDisplay('bipolar-ap', 'awake', [toggle], 60, 9, { focalPlacement: 'between' });
    const off = runDisplay('bipolar-ap', 'awake', [], 60, 9, { focalPlacement: 'between' });
    const peakOn = (label: string) => {
      const k = on.montage.channels.findIndex(c => c.label === label);
      let p = 0;
      for (let i = 0; i < on.data[k].length; i++) {
        const v = on.data[k][i] - off.data[k][i];
        if (Math.abs(v) > Math.abs(p)) p = v;
      }
      return p;
    };
    const pFlat = peakOn(flat), pAbove = peakOn(above), pBelow = peakOn(below), pBeyond = peakOn(beyond);
    check(`${toggle}, focus between: ${flat} is near-isoelectric against its flanks`,
      Math.abs(pFlat) / Math.max(Math.abs(pAbove), Math.abs(pBelow)), 0, 0.25);
    check(`${toggle}, focus between: ${above} and ${below} deflect OPPOSITE ways`, Math.sign(pAbove) * Math.sign(pBelow), -1, -1);
    check(`${toggle}, focus between: ${beyond} continues the way of ${below}, smaller`,
      Math.sign(pBelow) * Math.sign(pBeyond) * (Math.abs(pBeyond) < Math.abs(pBelow) ? 1 : 0), 1, 1);
    check(`${toggle}, focus between: the discharge is on the page (${below} peak)`, Math.abs(pBelow), 15, 400, ' uV');
  }
});

// The focal SEIZURES have the same option. A seizure is a rhythm, not a transient,
// so the peaks' signs mean nothing; the links are compared over the whole
// discharge — by size for the flat one, by correlation for the ones either side.
section(null, () => {
  for (const [toggle, flat, above, below, beyond] of [
    ['focal-temporal-ictal', 'F7-T3', 'Fp1-F7', 'T3-T5', 'T5-O1'],
    ['focal-frontal-ictal', 'F3-C3', 'Fp1-F3', 'C3-P3', 'P3-O1'],
  ] as const) {
    const on = runDisplay('bipolar-ap', 'awake', [toggle], 40, 9, { focalPlacement: 'between' });
    const off = runDisplay('bipolar-ap', 'awake', [], 40, 9, { focalPlacement: 'between' });
    const row = (label: string) => {
      const k = on.montage.channels.findIndex(c => c.label === label);
      return on.data[k].map((v, i) => v - off.data[k][i]);
    };
    const rms = (x: Float64Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
    const rFlat = row(flat), rAbove = row(above), rBelow = row(below), rBeyond = row(beyond);
    check(`${toggle}, focus between: ${flat} stays near-isoelectric against its flanks (RMS over the seizure)`,
      rms(rFlat) / Math.max(rms(rAbove), rms(rBelow)), 0, 0.25);
    check(`${toggle}, focus between: ${above} vs ${below} correlation (the flanks oppose)`, corr(rAbove, rBelow), -1.0001, -0.4);
    check(`${toggle}, focus between: ${below} vs ${beyond} correlation (continues the same way past the focus)`, corr(rBelow, rBeyond), 0.4, 1.0001);
    // Smaller than the row before it, and by no fixed factor: on learningeeg's left
    // temporal seizure the row past the focus (T5-O1) is 0.75 of the one before it
    // (0.69 against 0.92 of Fp1-F7). The ceiling was 0.6, with no source.
    check(`${toggle}, focus between: ${beyond} / ${below} RMS (falls off with distance)`, rms(rBeyond) / rms(rBelow), 0, 0.9);
    check(`${toggle}, focus between: the seizure is on the page (${below} RMS)`, rms(rBelow), 5, 300, ' uV');
  }
});

// The temporal seizure against the figure its field is fitted to: learningeeg,
// Seizures, the left temporal focal seizure (page 2), every row traced and read at
// the seizure's own frequency for the share that is in step with a reference row,
// signed. One source gives every row the same waveform, so here that share is the
// row's on-minus-off contribution projected on the reference row's. +-0.3 is the
// tolerance used for the other figure read with this tracer (the LPEDs); nothing
// better is known about this one.

section('\nFocal temporal seizure: a region, as on the learningeeg figure:', () => {
  for (const [placement, ref, rows] of [
    // Early in the figure's seizure (2.7 Hz) the maximum is a plateau across F7 and T3.
    ['between', 'Fp1-F7', [['T3-T5', -0.92], ['T5-O1', -0.69], ['F3-C3', -0.30], ['C3-P3', -0.23], ['Fp1-F3', 0.18]]],
    // Late (2.35 Hz) it is at T3. Only the link above the focus is held to the figure:
    // the outer rows are kept smaller than the figure's on purpose (fields.ts, MID).
    ['under', 'T3-T5', [['F7-T3', -0.74]]],
  ] as const) {
    const on = runDisplay('bipolar-ap', 'awake', ['focal-temporal-ictal'], 40, 9, { focalPlacement: placement });
    const off = runDisplay('bipolar-ap', 'awake', [], 40, 9, { focalPlacement: placement });
    const row = (label: string) => {
      const k = on.montage.channels.findIndex(c => c.label === label);
      return on.data[k].map((v, i) => v - off.data[k][i]);
    };
    const r = row(ref);
    for (const [label, figure] of rows) {
      const x = row(label);
      let a = 0, b = 0;
      for (let i = 0; i < x.length; i++) { a += x[i] * r[i]; b += r[i] * r[i]; }
      check(`focal-temporal-ictal, focus ${placement}: ${label} in step with ${ref} (LEARNINGEEG figure: ${figure})`,
        a / b, Math.round((figure - 0.3) * 100) / 100, Math.round((figure + 0.3) * 100) / 100);
    }
  }
});

section('\n3 Hz GSW: ~3 Hz, frontally-dominant, generalised/bilateral, spike-then-slow, bipolar-ap:', () => {
  const fzcz = displayContrib('bipolar-ap', 'awake', '3hz-gsw', 'Fz-Cz', 60, 11);
  const pk = spectralPeak(welch(fzcz, FS, 4096), 2, 4);
  check('3hz-gsw Fz-Cz discharge frequency (LEARNINGEEG §12: ~3 Hz)', pk.freq, 2.6, 3.4, ' Hz');

  const fp1f3 = displayContrib('bipolar-ap', 'awake', '3hz-gsw', 'Fp1-F3', 60, 11);
  const p3o1 = displayContrib('bipolar-ap', 'awake', '3hz-gsw', 'P3-O1', 60, 11);
  const fp2f4 = displayContrib('bipolar-ap', 'awake', '3hz-gsw', 'Fp2-F4', 60, 11);
  check('3hz-gsw frontal-max: Fp1-F3 p2p > P3-O1 p2p', pctP2p(fp1f3) / pctP2p(p3o1), 1.2, 8);
  check('3hz-gsw generalised/bilateral: Fp1-F3 p2p ~= Fp2-F4 p2p (symmetric, unlike a focal spike)',
    pctP2p(fp1f3) / pctP2p(fp2f4), 0.6, 1.6);

  // Spike-then-slow within one ~333 ms cycle: the sharp component leads and its
  // slow wave follows within the same cycle, on the same side of the baseline
  // (IK-012). The spike is found as the sharpest point of the run, since spike
  // and dome are about the same height; the slow wave is the highest point of
  // the trace 50-200 ms after it. On Fz-Cz the discharge is larger at Fz, input
  // 1, so both are negative and point up.
  const lead = Math.round(0.2 * FS);
  let sharpest = 0, spikeAt = 2;
  for (let k = 2; k < fzcz.length - 2 - lead; k++) {
    const c = Math.abs(fzcz[k] - (fzcz[k - 2] + fzcz[k + 2]) / 2);
    if (c > sharpest) { sharpest = c; spikeAt = k; }
  }
  let slowAt = spikeAt + Math.round(0.05 * FS);
  for (let k = slowAt; k <= spikeAt + lead; k++) if (fzcz[k] < fzcz[slowAt]) slowAt = k;
  check('3hz-gsw Fz-Cz: the slow wave peaks after its spike, within the same ~333 ms cycle',
    (slowAt - spikeAt) / FS * 1000, 60, 180, ' ms');
  check('3hz-gsw Fz-Cz: spike and slow wave deflect the same way, both up (sum of the two signs, -2)',
    Math.sign(fzcz[spikeAt]) + Math.sign(fzcz[slowAt]), -2, -2);
});

section('\nPolyspike-and-slow-wave: each complex carries MULTIPLE resolvable spikes before its slow wave, bipolar-ap Fz-Cz:', () => {
  // Fz-Cz (touches the Fz anchor directly) carries far more amplitude than a
  // link two hops away (Fp1-F3), where the broad frontal source partly
  // cancels in the bipolar difference. Individual polyspikes within one
  // complex are 30-40 ms apart (epileptiform.ts: `0.03 + i*0.04`) — closer
  // than the isolated-spike base width, so they're counted as local minima
  // dipping back below a relative threshold, not as separate threshold-
  // crossing runs (which would merge adjacent polyspikes into one).
  //
  // Since 2026-10-13 the polyspikes rise out of a trough and are followed by a
  // slow wave of their own polarity, so the complex's largest excursion is no
  // longer one of them and a fixed level no longer separates them from the
  // rest. They are found by what makes them spikes: each is a local minimum
  // standing clear of the trace 16 ms either side of it, by at least a
  // twentieth of the complex's swing — which the rounded slow wave never does.
  // Counted in the one complex that holds the sharpest point of the run; its
  // polyspikes span at most 0.16 s, and the next complex's begin 0.31 s on.
  const diff = displayContrib('bipolar-ap', 'awake', 'polyspike-wave', 'Fz-Cz', 60, 13);
  // Clear of BOTH sides: the corner where a burst begins stands clear of one.
  const stands = (k: number) => Math.min(diff[k - 4], diff[k + 4]) - diff[k];
  let sharpAt = 4;
  for (let k = 4; k < diff.length - 4; k++) if (stands(k) > stands(sharpAt)) sharpAt = k;
  const lo = Math.max(4, sharpAt - Math.round(0.17 * FS));
  const hi = Math.min(diff.length - 4, sharpAt + Math.round(0.17 * FS));
  let top = -Infinity, bottom = Infinity;
  for (let k = lo; k < hi; k++) { top = Math.max(top, diff[k]); bottom = Math.min(bottom, diff[k]); }
  let minimaCount = 0;
  for (let k = lo + 1; k < hi - 1; k++) {
    if (diff[k] < diff[k - 1] && diff[k] <= diff[k + 1] && stands(k) >= 0.05 * (top - bottom)) minimaCount++;
  }
  check('polyspike-wave Fz-Cz: distinct spikes resolvable in one complex (epileptiform.ts: 2-5 polyspikes)',
    minimaCount, 2, 5);
});

section('\nBurst-suppression: alternating high-amplitude bursts and near-flat suppression (>=50% suppressed), bipolar-ap Cz-Pz:', () => {
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
});

section('\nHypsarrhythmia: high-amplitude, chaotic and multifocal (desynchronised across regions), bipolar-ap:', () => {
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
});

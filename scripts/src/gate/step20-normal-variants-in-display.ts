import { spikeSlowWave } from '../../../artifacts/eeg-simulator/src/engine/sources/morphology';
import { FS, bandPower, base, check, displayContrib, section, step, displayContribAll } from './harness';

step('\n=== Step 20: normal variants in DISPLAY space (A4 audit) ===\n');

// Same rationale as Step 19: an absolute-microvolt or timing claim (BETS's
// "<50 ms, <50 uV") is a claim about what a reader sees on the montage-derived
// trace, not about the raw electrode. Step 13 above already checks these
// patterns' referential band power/p2p on-off; this repeats the morphology-
// specific claims on the real display-space channel.

section('Wicket (7-11 Hz arciform bursts, temporal, drowsy only): no after-going slow wave, bipolar-ap:', () => {
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
});

section('\nBETS (<50 ms, <50 uV, temporal, drowsy/N1/N2 only, no slow wave), bipolar-ap:', () => {
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
  // A broad field, largest temporally (owner's inbox, 2026-11-25: "across all the
  // leads"; IFCN, eegpedia, learningeeg: temporal, with a field), on the average
  // reference, where a broad field shows as a broad field (IK-042).
  const car = displayContribAll('reference-car', 'drowsy', 'bets', 120, 20);
  const sizes = Object.entries(car).map(([l, x]) => [l, Math.max(...Array.from(x).map(Math.abs))] as const);
  const top = Math.max(...sizes.map(([, v]) => v));
  check('BETS field: average-referenced channels carrying a fifth of the largest or more (owner: across all the leads)',
    sizes.filter(([, v]) => v >= 0.2 * top).length / sizes.length, 0.6, 1);
  // Temporal: the temporal chain's electrodes. A tangential spike (variants.ts) peaks at
  // F7 or T5 rather than T3, still in the temporal region the sources name.
  check('BETS field: largest average-referenced channel is temporal (F7, T3, T5 or their right homologues)',
    ['F7-AVG', 'T3-AVG', 'T5-AVG', 'F8-AVG', 'T4-AVG', 'T6-AVG'].includes(sizes.reduce((a, b) => (b[1] > a[1] ? b : a))[0]) ? 1 : 0, 1, 1);
  // Until 2026-10-27 this also held the largest positive excursion after the largest
  // spike under 0.15 of it ("no after-going slow wave"). The sources allow a diphasic
  // spike and a small slow wave (SCORE, eegpedia, IFCN), so each spike is now read on
  // its own in Step 28, with the slow wave bounded there; this keeps the opposite
  // phase within the diphasic spike's size.
  check('BETS T3-T5 largest opposite phase after the largest spike', slow / Math.abs(peak), 0, 0.45);
});

section('\nLambda: surface-positive; polarity is montage-dependent (§4/IK-008), same family as POSTS:', () => {
  const o1Car = displayContrib('reference-car', 'awake', 'lambda', 'O1-AVG', 120, 20);
  let carPeak = 0;
  for (const v of o1Car) if (Math.abs(v) > Math.abs(carPeak)) carPeak = v;
  check('lambda renders DOWN at O1-AVG, reference-car (surface-positive)', carPeak, 0, Infinity, ' uV');

  const p3O1 = displayContrib('bipolar-ap', 'awake', 'lambda', 'P3-O1', 120, 20);
  let bipPeak = 0;
  for (const v of p3O1) if (Math.abs(v) > Math.abs(bipPeak)) bipPeak = v;
  check('lambda polarity inverts at P3-O1, bipolar-ap (O1 is input2)', bipPeak, -Infinity, 0, ' uV');
});

section('\n14 & 6 positive bursts: surface-positive; polarity is montage-dependent (§4/IK-008):', () => {
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
});

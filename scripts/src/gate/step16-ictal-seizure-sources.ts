import { buildLeadfield } from '../../../artifacts/eeg-simulator/src/engine/forward';
import { SLEEP_OPTS, bandPower, check, corr, midwaySource, pctP2p, runEngineState, section, step, win, winCar, winPower } from './harness';

step('\n=== Step 16: ictal / seizure sources (pattern sources) ===\n');

section('Absence (3 Hz generalised spike-wave, frontally-max):', () => {
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
});

section('\nGTC (clonic discharge -> post-ictal suppression):', () => {
  const gt = runEngineState(92, SLEEP_OPTS, 'awake', ['gtc-ictal']);
  // The seizure starts 6 s in: tonic to 16 s, clonic to 61 s, suppressed to 96 s.
  // Clonic discharge (clock 20-55 s) is high-amplitude; post-ictal suppression
  // (clock 70-90 s, gate at 0.08) is near-flat. The contrast IS the seizure.
  const clonic = pctP2p(win(gt, 'Fz', 20, 55));
  const suppressed = pctP2p(win(gt, 'Fz', 70, 90));
  check('Fz clonic p2p, gtc (high-amplitude discharge)', clonic, 120, 900, ' uV');
  check('Fz post-ictal p2p / clonic p2p (suppression)', suppressed / clonic, 0, 0.4);
});

section('\nFocal temporal (left onset, late contralateral spread):', () => {
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

  // Phase reversal: T3 is the maximum of one same-sign field (fields.ts,
  // MID_TEMPORAL_REGIONAL), so the seizure doesn't stop at T3, it falls away
  // smoothly into the AP-chain neighbours F7 (anterior) and T5 (posterior),
  // both carrying the SAME seizure waveform, just attenuated. A bipolar chain crossing T3 (F7-T3,
  // T3-T5) subtracts the shared T3 electrode from each derivation, so the two
  // channels flanking T3 deflect in OPPOSITE directions at the same instant
  // even though the underlying pattern is identical — the textbook "similar
  // pattern on both sides of the reversal" a resident uses to localise a
  // focus on a bipolar montage, not two independent generators. This must
  // fall out of the shared radial leadfield automatically; nothing in the
  // source model encodes flanking channels directly.
  const mid = (name: string) => win(ft, name, 15, 25);
  const t3Mid = mid('T3'), f7Mid = mid('F7'), t5Mid = mid('T5');
  // IK-003's referential clause, read on the common average (reference-car) since
  // 2026-09-22. It was read on raw potentials, i.e. against infinity, where a spurious
  // same-sign far field (the monopole forward.ts now removes) lifted F7 and T5 to 0.10 and
  // 0.07 of T3's power. No montage ever showed that: on reference-car the page had F7 ~0.04
  // and T5 ~0.02 all along, and IK-003 stood violated for this clause until
  // 2026-10-13, when the single patch became a regional field fitted to learningeeg's
  // temporal seizure (beside the maximum: 0.4-0.7 of its voltage, 16-49% of its power).
  const carMid = (name: string) => winCar(ft, name, 15, 25);
  const t3Car = carMid('T3'), f7Car = carMid('F7'), t5Car = carMid('T5');
  check('referential corr T3-F7 (shared source, same polarity)', corr(t3Car, f7Car), 0.6, 1.0);
  check('referential corr T3-T5 (shared source, same polarity)', corr(t3Car, t5Car), 0.6, 1.0);
  check('F7 theta / T3 theta (ripples out, but attenuated)',
    bandPower(f7Car, 3.5, 6) / bandPower(t3Car, 3.5, 6), 0.05, 0.9);
  check('T5 theta / T3 theta (ripples out, but attenuated)',
    bandPower(t5Car, 3.5, 6) / bandPower(t3Car, 3.5, 6), 0.05, 0.9);
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
});

section('\nFocal temporal (RIGHT onset — same localisation signatures mirrored):', () => {
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
  // Common average, as in the left-onset block (IK-003, 2026-09-22).
  const carMid = (name: string) => winCar(ft, name, 15, 25);
  const t4Car = carMid('T4'), f8Car = carMid('F8'), t6Car = carMid('T6');
  check('referential corr T4-F8 (shared source, same polarity)', corr(t4Car, f8Car), 0.6, 1.0);
  check('referential corr T4-T6 (shared source, same polarity)', corr(t4Car, t6Car), 0.6, 1.0);
  check('F8 theta / T4 theta (ripples out, but attenuated)',
    bandPower(f8Car, 3.5, 6) / bandPower(t4Car, 3.5, 6), 0.05, 0.9);
  check('T6 theta / T4 theta (ripples out, but attenuated)',
    bandPower(t6Car, 3.5, 6) / bandPower(t4Car, 3.5, 6), 0.05, 0.9);
  const sub = (a: Float64Array, b: Float64Array) => a.map((v, i) => v - b[i]);
  check('bipolar F8-T4 vs T4-T6 correlation (phase reversal)',
    corr(sub(f8Mid, t4Mid), sub(t4Mid, t6Mid)), -1.0, -0.4);
});

section('\nIctal frequency knob (scales the sweep, preserves the evolution):', () => {
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
});

section('\nLocalisation: source BETWEEN two electrodes (phase cancellation):', () => {
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
  // model that all of them share, using a synthetic spec placed equidistant from
  // F8 and T4 (see midwaySource). It is a claim about the leadfield, not about any
  // one pattern.
  const spec = midwaySource('synthetic-fronto-temporal', 'F8', 'T4', 0.35);
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
});

section('\nFocal frontal (left onset, low-voltage-fast evolving down):', () => {
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
});

import { traceY, ecgScale } from '../../../artifacts/eeg-simulator/src/utils/displayGeometry';
import { MONTAGES } from '../../../artifacts/eeg-simulator/src/utils/montages';
import type { ChannelDef } from '../../../artifacts/eeg-simulator/src/utils/montages';
import { computeChannelVoltage } from '../../../artifacts/eeg-simulator/src/utils/computeChannel';
import { SPEED_VALUES } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
// A8 audit (Step 23): renderTrace.ts drives the SAME geometry EEGCanvas.tsx
// does (CLAUDE.md §4) and exposes its actual pxPerSec/pxPerMm/pxPerUV, so the
// calibration checks below assert on real production numbers, not a
// reimplementation of the formulas.
import { renderTrace } from '../renderTrace';
import { SCRATCH, bandPower, check, pctP2p, runDisplay, section, step } from './harness';

step('\n=== Step 23: calibration & amplitude invariants (A8 audit) ===\n');

// These are properties of the DISPLAY TRANSFORM (CLAUDE.md §4), not of any one
// generator: paper speed, sensitivity, and the negative-up sign convention are
// supposed to hold identically for every montage, pattern, and toggle. `renderTrace`
// drives the real engine through the exact geometry `EEGCanvas.tsx` uses and now
// returns the actual pxPerSec/pxPerMm/pxPerUV it rendered with (renderTrace.ts:
// RenderResult), so the checks below read those production numbers directly
// instead of re-deriving the formulas and risking testing the reimplementation
// rather than the code.
//
// Source-level cross-check (read, not executed — EEGCanvas.tsx is a React
// component and can't run headlessly here): EEGCanvas.tsx:199 computes
// `pxPerSec = currentSettings.speed * PX_PER_MM_X` and renderTrace.ts:232 computes
// the byte-identical `pxPerSec = speed * PX_PER_MM_X`. EEGCanvas.tsx:308 computes
// `pxPerUV = pxPerMm / currentSettings.sensitivity` and renderTrace.ts:234 computes
// the byte-identical `pxPerUV = pxPerMm / sensitivity`. EEGCanvas.tsx:395 draws
// `y = centerY + v` (scale folded into v beforehand) and renderTrace.ts:278 draws
// `y = centerY + v * scale` — both negative-up (+v renders downward). The two
// files hold their own copies of PX_PER_MM_X=4 / MM_PER_ROW=10 / GAP_UNITS=0.40
// (EEGCanvas.tsx:35-37, renderTrace.ts:39-41) rather than sharing one module; they
// agree today (checked by inspection), but nothing but this comment and manual
// review would catch them drifting apart — flagged in the audit report, not fixed
// here (no divergence found, so no surgical change is justified).

section('Paper speed: mm/s -> px/s at PX_PER_MM_X=4 (CLAUDE.md §4; 30 mm/s adult default):', () => {
  // Driven from SPEED_VALUES itself rather than a copy of it. This literal used to
  // read [10, 20, 30]; when the ladder was corrected to ACNS Guideline 1 §3.7
  // (30 mm/s routine, 15 mm/s the named alternative, 20 mm/s named by no standard)
  // the copy went stale and only a type error caught it. Iterating the real export
  // means every offered speed is calibration-checked, and adding one cannot bypass
  // this check.
  for (const speed of SPEED_VALUES) {
    const res = renderTrace({ speed, seconds: 2, out: `${SCRATCH}/a8-speed-${speed}.png` });
    check(`pxPerSec @ ${speed} mm/s (speed * PX_PER_MM_X)`, res.pxPerSec, speed * 4, speed * 4);
  }
  // Empirical cross-check independent of the pxPerSec field: two renders at the
  // same speed but different durations must differ in width by exactly
  // (seconds2 - seconds1) * pxPerSec pixels, i.e. 1 s of paper is 120 px at
  // 30 mm/s regardless of how the width is assembled internally.
  const w1 = renderTrace({ speed: 30, seconds: 1, out: `${SCRATCH}/a8-w1.png` }).width;
  const w11 = renderTrace({ speed: 30, seconds: 11, out: `${SCRATCH}/a8-w11.png` }).width;
  check('width(11s) - width(1s) @ 30 mm/s (10 s * 120 px/s)', w11 - w1, 1200, 1200, ' px');
});

section('\nSensitivity: µV/mm calibration (CLAUDE.md §4; UI options 1|3|5|7|10|15|30 µV/mm):', () => {
  for (const sensitivity of [1, 3, 5, 7, 10, 15, 30] as const) {
    const res = renderTrace({ sensitivity, seconds: 2, out: `${SCRATCH}/a8-sens-${sensitivity}.png` });
    // Defining relationship: pxPerUV = pxPerMm / sensitivity, i.e. mm = µV / sensitivity.
    check(`pxPerUV * sensitivity == pxPerMm (${sensitivity} µV/mm)`,
      (res.pxPerUV * sensitivity) / res.pxPerMm, 0.999, 1.001);
  }
  // The worked example from the audit brief: a 50 µV deflection at 7 µV/mm
  // sensitivity should measure ~7.14 mm on paper.
  const res7 = renderTrace({ sensitivity: 7, seconds: 2, out: `${SCRATCH}/a8-sens-7.png` });
  const mmFor50uV = (50 * res7.pxPerUV) / res7.pxPerMm;
  check('50 µV calibration deflection @ 7 µV/mm', mmFor50uV, 7.0, 7.3, ' mm');
});

section('\nNegative-up polarity (IK-008; CLAUDE.md §4): synthetic input, montage-only, no pattern:', () => {
  // Isolates the sign convention from any one generator's morphology: feed a
  // synthetic constant voltage straight into the production computeChannelVoltage
  // (the same function EEGCanvas/renderTrace call every sample) on a real bipolar
  // channel definition, then apply renderTrace's own pxPerUV (production number,
  // not reimplemented) to get the pixel deflection EEGCanvas.tsx:395 /
  // renderTrace.ts:278 would draw.
  const bipolarAp = MONTAGES['bipolar-ap'];
  const fp1F3 = bipolarAp.channels.find((c) => c.label === 'Fp1-F3') as ChannelDef;
  const res = renderTrace({ sensitivity: 7, seconds: 1, out: `${SCRATCH}/a8-polarity.png` });

  const vSurfacePositive = computeChannelVoltage(fp1F3, 0, { Fp1: 50 }, 0); // input1 (Fp1) > input2 (F3)
  const vSurfaceNegative = computeChannelVoltage(fp1F3, 0, { Fp1: -50 }, 0);
  check('computeChannelVoltage(Fp1=+50,F3=0) is surface-positive (input1 - input2)', vSurfacePositive, 50, 50, ' uV');
  check('computeChannelVoltage(Fp1=-50,F3=0) is surface-negative', vSurfaceNegative, -50, -50, ' uV');

  // These call the PRODUCTION traceY() rather than recomputing `v * pxPerUV`.
  // That distinction is the whole point of the check. Until displayGeometry.ts
  // existed, this block multiplied a voltage by a positive number and asserted the
  // product was positive — an algebraic identity that could not fail, and which
  // never touched EEGCanvas at all. A global sign flip in the renderer, exactly the
  // regression IK-008's Mechanism paragraph says this exists to catch, would have
  // passed. Now both renderers draw through traceY(), so flipping it fails here.
  // centerY = 0, so the returned y IS the offset from baseline.
  const yOffsetPositive = traceY(0, vSurfacePositive, res.pxPerUV);
  const yOffsetNegative = traceY(0, vSurfaceNegative, res.pxPerUV);
  check('surface-positive (+50 µV) deflects DOWN (y - centerY > 0)', yOffsetPositive, 0.01, Infinity, ' px');
  check('surface-negative (-50 µV) deflects UP (y - centerY < 0)', yOffsetNegative, -Infinity, -0.01, ' px');

  // The ECG row is the one documented exception to negative-up: it is a limb lead,
  // not a scalp derivation, and every clinician has the QRS memorised with the R
  // wave UP. The app's own `ecg-artifact` description tells the learner to
  // shape-match scalp transients against it, so an inverted ECG costs precisely the
  // skill the channel is there to teach. It rendered inverted until 2026-09-01
  // because it was drawn through the EEG sign convention.
  const rWaveY = traceY(0, +1.0, ecgScale(res.pxPerMm));   // +1 mV R wave
  check('ECG R wave (+1 mV) renders UP (y - centerY < 0; limb lead, not negative-up)',
    rWaveY, -Infinity, -0.01, ' px');
});

section('\nNormal amplitude ranges by region (LEARNINGEEG-STUDY.md §1/§3): adult scalp 10-100 µV (mostly 10-50); AP gradient:', () => {
  // Referential (reference-car), awake, no toggles: the general adult amplitude
  // envelope and the AP-gradient claim ("faster/lower-amplitude anteriorly,
  // slower/higher-amplitude posteriorly") restated in amplitude space, as a
  // corollary to IK-006's power-ratio version of the same gradient.
  const { montage, data } = runDisplay('reference-car', 'awake', [], 180, 42);
  const idx = (label: string) => montage.channels.findIndex((c) => c.label === label);
  const o1P2p = pctP2p(data[idx('O1-AVG')]);
  const fp1P2p = pctP2p(data[idx('Fp1-AVG')]);
  check('O1-AVG p2p amplitude, awake eyes-closed (LEARNINGEEG §1: adult scalp 10-100 µV)', o1P2p, 10, 100, ' uV');
  check('O1-AVG p2p > Fp1-AVG p2p (AP gradient in amplitude space, LEARNINGEEG §3)', o1P2p / fp1P2p, 1.1, 1e6);
});
// The A-P gradient in full. The check above compares only the two ENDS of the
// chain (O1 vs Fp1), so it passes while the middle of the chain is inverted --
// which is the state the engine shipped in: parietal was the QUIETEST region on
// the head (P4 8.8 uV RMS, below Fp1's 8.5 only by a hair) and the midline ran
// Fz > Cz > Pz, backwards. Here the gradient is asserted link by link, and in
// both of the things learningeeg's Normal Awake chapter says it is: "faster,
// lower amplitude frequencies ... towards the front" and "slower, higher
// amplitude frequencies ... in the back". Nothing tested the frequency half.
//
// `reference-ipsi`, not `reference-car`: with only 19 electrodes the common
// average is a poor stand-in for infinity. It subtracts a posteriorly-weighted
// mean from every channel, which lifts the frontal rows, and it nearly nulls Cz
// (Cz sits close to the array's electrical centroid) -- so it measures this
// gradient backwards. Same signal, same seeds: front-to-back reads 2.48 in CAR
// against 3.86 ear-referenced, and CAR puts Fp1 ABOVE F3. The ear reference is
// what a reader judges amplitude topography on, so the topographic claim is
// asserted there. The check above keeps CAR because IK-028 names it.
//
// Averaged over three seeds: normal hemispheric asymmetry runs to 50%
// (LEARNINGEEG §1) and must not be what decides an ordering.
//
// Parietal >= central IS asserted now (2026-09-11). It was left out when every
// subject carried an always-on, full-strength mu and (P3+P4)/(C3+C4) read 0.95.
// Mu is now a per-subject trait (engine.ts sampleSubject: 34% of subjects then, 16% since 2026-10-13), and
// over 8 subjects the ratio reads 1.05-1.62 (mean 1.27): lowest, 1.05-1.10, in the
// three subjects with mu — a central rhythm raises the central rows, as it should —
// and 1.26-1.62 in the five without.
//
// The FREQUENCY half is asserted as beta/alpha, front vs back, on the bipolar rows a
// reader looks at — not as a 2-30 Hz spectral centroid, which is retired below.
section(null, () => {
  const SEEDS = [42, 7, 1234];
  const p2p: Record<string, number[]> = {};
  for (const seed of SEEDS) {
    const { montage, data } = runDisplay('reference-ipsi', 'awake', [], 60, seed);
    montage.channels.forEach((ch, i) => {
      if (ch.group === 'ecg') return;
      const el = ch.active as string;
      (p2p[el] ??= []).push(pctP2p(data[i]));
    });
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const A = (el: string) => mean(p2p[el]);
  // The 10-100 µV envelope is a claim about SCALP amplitude. In the ipsilateral-ear
  // montage F7/T3/T5 and F8/T4/T6 sit beside their own reference, so their rows read a
  // short-distance difference, not the scalp potential: F7-A1 is the quietest row on
  // the page (9.9 µV, 2026-09-11) for that reason alone. Those six are excluded from
  // the envelope, not from anything else. Until the warm-up fix of 2026-09-11 every
  // frontal row also carried a start-up transient (artifacts fired during warm-up and
  // stepped off on the first displayed sample), which put the quietest row at 13.8.
  const NEAR_REF = new Set(['F7', 'T3', 'T5', 'F8', 'T4', 'T6']);
  const all = Object.keys(p2p).filter((el) => !NEAR_REF.has(el)).map(A);

  check('quietest channel p2p, awake, no toggles (LEARNINGEEG §1: adult scalp 10-100 µV)', Math.min(...all), 10, 100, ' uV');
  check('loudest channel p2p, awake, no toggles (LEARNINGEEG §1: adult scalp 10-100 µV)', Math.max(...all), 10, 100, ' uV');

  // Amplitude half of the gradient, link by link up each chain.
  check('F3 / Fp1 p2p (AP gradient rises backwards, LEARNINGEEG §3)', A('F3') / A('Fp1'), 1.0, 1e6);
  check('C3 / F3 p2p (AP gradient, LEARNINGEEG §3)', A('C3') / A('F3'), 1.0, 1e6);
  check('O1 / P3 p2p (AP gradient, LEARNINGEEG §3)', A('O1') / A('P3'), 1.0, 1e6);
  check('O1 / C3 p2p (AP gradient, LEARNINGEEG §3)', A('O1') / A('C3'), 1.0, 1e6);
  check('F4 / Fp2 p2p (AP gradient, LEARNINGEEG §3)', A('F4') / A('Fp2'), 1.0, 1e6);
  check('C4 / F4 p2p (AP gradient, LEARNINGEEG §3)', A('C4') / A('F4'), 1.0, 1e6);
  check('O2 / P4 p2p (AP gradient, LEARNINGEEG §3)', A('O2') / A('P4'), 1.0, 1e6);
  check('O2 / C4 p2p (AP gradient, LEARNINGEEG §3)', A('O2') / A('C4'), 1.0, 1e6);
  check('Cz / Fz p2p (AP gradient on the midline, LEARNINGEEG §3)', A('Cz') / A('Fz'), 1.0, 1e6);
  check('Pz / Cz p2p (AP gradient on the midline, LEARNINGEEG §3)', A('Pz') / A('Cz'), 1.0, 1e6);
  // Parietal is no longer the floor of the head.
  check('(P3+P4) / (F3+F4) p2p (parietal above frontal, LEARNINGEEG §3)', (A('P3') + A('P4')) / (A('F3') + A('F4')), 1.15, 1e6);
  check('(P3+P4) / (Fp1+Fp2) p2p (parietal above frontopolar, LEARNINGEEG §3)', (A('P3') + A('P4')) / (A('Fp1') + A('Fp2')), 1.5, 1e6);
  // Gradient present in the referential montage: a floor only. The old 1.8-5 band
  // took its ceiling from an eyeball read of learningeeg's BIPOLAR ap-gradient figure
  // and applied it to an EAR-REFERENCED ratio — two montages, one number. The
  // magnitude is asserted below on the bipolar chain, where a real figure anchors it.
  check('(O1+O2) / (Fp1+Fp2) p2p (front-to-back magnitude, LEARNINGEEG §3)', (A('O1') + A('O2')) / (A('Fp1') + A('Fp2')), 1.8, 1e6);
  check('(P3+P4) / (C3+C4) p2p (parietal at or above central, LEARNINGEEG §3)', (A('P3') + A('P4')) / (A('C3') + A('C4')), 1.0, 1e6);

  // Frequency half of the gradient: "faster, lower amplitude frequencies ... towards
  // the front", which learningeeg's reference figure labels "low amplitude beta" over
  // "moderate amplitude alpha". Asserted as (beta/alpha) on the frontopolar bipolar
  // rows divided by the same on the occipital rows.
  //
  // RETIRED 2026-09-11: `frontopolar / occipital spectral centroid, 2-30 Hz >= 1.1`
  // (IK-030). Read with one image reader on real records, it gave 1.16 on
  // learningeeg's ap-gradient figure but 0.79 on its term-alpha figure — a normal
  // record with obvious frontal fast activity, whose frontal rows also carry blinks.
  // A centroid is pulled down by any low-frequency power, so it measured the ocular
  // and 1/f content, not "faster": the floor would have failed a real normal record.
  // Beta/alpha read 7.5 and 25.3 on those two figures and 7.8 ± 1.7 on 12 engine
  // pages, and it moves the right way when perturbed (3x beta: x1.5-2.5; 0.3x
  // posterior alpha: -30-40%). scripts/read-lab/JOURNAL.md, 2026-09-11.
  const ba: number[] = [];
  for (const seed of SEEDS) {
    const { montage, data } = runDisplay('bipolar-ap', 'awake', [], 60, seed);
    const row = (l: string) => data[montage.channels.findIndex((c) => c.label === l)];
    const r = (l: string) => bandPower(row(l), 13, 30) / bandPower(row(l), 8, 13);
    ba.push(((r('Fp1-F3') + r('Fp2-F4')) / 2) / ((r('P3-O1') + r('P4-O2')) / 2));
  }
  check('beta/alpha, Fp1-F3+Fp2-F4 vs P3-O1+P4-O2 (AP gradient in FREQUENCY: faster in front, LEARNINGEEG §3)',
    mean(ba), 2, 1e6);

  // Amplitude magnitude on the same bipolar rows. learningeeg's ap-gradient figure,
  // traced by scripts/read-lab (same estimator as the engine side), reads 3.75x back
  // over front; the engine reads ~3.1. One real figure is one draw, so the band is
  // wide: it catches a gradient that collapses or runs away, not a 20% difference.
  const bip: number[] = [];
  for (const seed of SEEDS) {
    const { montage, data } = runDisplay('bipolar-ap', 'awake', [], 60, seed);
    const pp = (l: string) => pctP2p(data[montage.channels.findIndex((c) => c.label === l)]);
    bip.push((pp('P3-O1') + pp('P4-O2')) / (pp('Fp1-F3') + pp('Fp2-F4')));
  }
  check('(P3-O1+P4-O2) / (Fp1-F3+Fp2-F4) p2p (front-to-back magnitude, bipolar; learningeeg figure 3.75)',
    mean(bip), 2, 6);
});

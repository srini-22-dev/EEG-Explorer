import { HopfOscillator } from '../../../artifacts/eeg-simulator/src/engine/oscillator';
import { EegEngine, sampleSubject, BETA_BURST_OPTS, PDR_ENVELOPE_DEPTH } from '../../../artifacts/eeg-simulator/src/engine/engine';
import type { EngineOptions, ArtifactGates } from '../../../artifacts/eeg-simulator/src/engine/engine';
import { BurstyOscillator } from '../../../artifacts/eeg-simulator/src/engine/bursts';
import { AmplifierLowPass } from '../../../artifacts/eeg-simulator/src/engine/chain';
import { electrodeDistanceCm } from '../../../artifacts/eeg-simulator/src/engine/forward';
import type { PatientState } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
import { welch, std, kurtosis, hilbertEnvelope, spectralPeak } from '../dsp';
import { MONTAGES } from '../../../artifacts/eeg-simulator/src/utils/montages';
import { commonAverage, computeChannelVoltage } from '../../../artifacts/eeg-simulator/src/utils/computeChannel';
import { DT, FS, bandPower, check, corr, runDisplay, runEngine, runEngineState, section, step } from './harness';

// ---------------------------------------------------------------------------
step('\n=== Steps 4-9: full engine (sources -> leadfield -> chain) ===\n');

// --- 6a. Volume conduction: correlation must fall off with real inter-electrode
// distance. Independently generated channels give a flat, near-zero profile and
// make ICA and source localisation look impossibly good (§12).

section('Spatial structure (volume conduction):', () => {
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
  // Reported, not bounded. The bounds that stood here (-0.35..0.45) had no source. Since
  // forward.ts removes each source's monopole (2026-09-22) a far pair sees a source's weak
  // return field with the opposite sign, so negative far correlation is what the physics
  // predicts; it read +0.49 before that fix and -0.35 after. The claim is the FALLOFF, which
  // the neighbour floor and 'near exceeds far' assert.
  check('mean corr, distant (>16 cm)', mean(far), -1, 1);
  check('near exceeds far', mean(near) - mean(far) > 0.2 ? 1 : 0, 1, 1);
});

// --- 6b. Alpha must be posterior. §11.5 lists band-power topography as a
// required spatial check, and a posterior alpha maximum is the single most
// recognisable feature of an awake EEG.

section('\nAlpha topography:', () => {
  // `muFraction`/`muLaterality` are pinned because the C3/F3 check below is
  // ABOUT mu: background mu is now a per-subject trait that most subjects do not
  // have (engine.ts `sampleSubject` — mu is a benign variant, not a fixture of
  // the normal awake background), so the subject under test must be one of the
  // minority who do, symmetric so the assertion is side-neutral. 0.45 is the
  // amplitude every subject used to carry, so these two checks measure exactly
  // what they measured before the trait existed.
  const { eng, data } = runEngine(120, { seed: 5, artifacts: false, recordingChain: false,
    subject: { iaf: 10, alphaRms: 16, vigilanceBias: 0.62, muFraction: 0.45, muLaterality: 0.5 } });
  const at = (n: string) => bandPower(data[eng.indexOf(n)], 8, 12);
  const post = (at('O1') + at('O2') + at('P3') + at('P4')) / 4;
  const ant = (at('Fp1') + at('Fp2') + at('F7') + at('F8')) / 4;
  // The FLOOR (2.0) is the clinical claim of IK-006 and the only half of this
  // check that asserts a fact. The CEILING is a regression guard.
  //
  // It was 600 while forward.ts used a Gaussian falloff, which has no algebraic
  // tail: at sigma ~4 cm the PDR's gain 19 cm away at Fp1 came out at
  // exp(-19^2/(2*4.1^2)) ~ 2e-5, so the posterior rhythm reached the front not
  // weakly but not at all, and this ratio read 520. Replacing that with an
  // algebraic profile took it to 68. 150 gives headroom over the current value
  // while being a real guard again rather than a placeholder parked above a
  // number known to be wrong. See INFORMING-KNOWLEDGE.md §11, 2026-08-28.
  check('posterior / anterior alpha power', post / ant, 2.0, 150);
  // The other half of that fix, asserted directly: the always-on background mu
  // must be maximal centrally. Tangential mu gave C3/F3 = 0.30 (peak frontal);
  // radial gives ~17.
  check('C3 / F3 alpha-band power (background mu is central, not frontal)',
    at('C3') / at('F3'), 3.0, 1e6);
  // L/R PDR symmetry limits (LEARNINGEEG-STUDY §14.1): normal is <1 Hz peak
  // frequency asymmetry and <50% amplitude asymmetry between hemispheres.
  // engine.ts builds this in structurally — 'pdrR' is offset +0.25 Hz and
  // 0.92x the RMS of 'pdrL' — so this asserts the built-in offset stays
  // inside the clinical bound rather than drifting there by accident.
  const psdO1 = welch(data[eng.indexOf('O1')], FS, 4096);
  const psdO2 = welch(data[eng.indexOf('O2')], FS, 4096);
  const peakO1 = spectralPeak(psdO1, 6, 14).freq;
  const peakO2 = spectralPeak(psdO2, 6, 14).freq;
  check('O1 / O2 alpha peak frequency asymmetry (<1 Hz)', Math.abs(peakO1 - peakO2), 0, 1, ' Hz');
  const ampO1 = Math.sqrt(at('O1')), ampO2 = Math.sqrt(at('O2'));
  check('O1 / O2 alpha amplitude asymmetry (<50%)',
    Math.abs(ampO1 - ampO2) / Math.max(ampO1, ampO2), 0, 0.5);
});

// --- 6c. Alpha on the bipolar chain, and its reactivity (IK-006, IK-007).
// A referential posterior maximum (6b) is necessary but not what a reader sees:
// the double-banana is bipolar, and a bipolar link's alpha tracks the field's
// spatial GRADIENT across it, not the field height. IK-006 says the PDR is read
// off the posterior links P4-O2 and T6-O2. The reported defect was the opposite
// — alpha sitting one link forward at C4-P4 — so this asserts P4-O2 is the
// dominant posterior-chain link and that eye opening (the Berger effect, IK-007)
// collapses it.

section('\nAlpha on the bipolar chain + reactivity:', () => {
  // Mu pinned present and symmetric for the same reason as the block above: the
  // eyes-open check asserts mu does NOT block (IK-007), which is only measurable
  // in a subject who has mu.
  const OPTS: EngineOptions = { seed: 5, artifacts: false, recordingChain: false,
    subject: { iaf: 10, alphaRms: 16, vigilanceBias: 0.62, muFraction: 0.45, muLaterality: 0.5 } };
  const closed = runEngineState(120, OPTS, 'awake', []);
  const open = runEngineState(120, OPTS, 'awake', ['eyes-open']);
  const bipAlpha = (r: typeof closed, a: string, b: string) => {
    const x = r.data[r.eng.indexOf(a)], y = r.data[r.eng.indexOf(b)];
    const d = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) d[i] = x[i] - y[i];
    return bandPower(d, 8, 12);
  };
  // RETIRED: `P4-O2 / C4-P4 alpha power >= 1.2`, which asserted that the PDR is
  // "read off the posterior link, not central-parietal". Two things were wrong
  // with it. The reference course never makes that claim — it says only that the
  // PDR is the resting occipital rhythm and that the slower, higher-amplitude
  // frequencies are found in the back. And it is self-defeating arithmetic: a
  // bipolar link measures the field GRADIENT, so a realistic referential
  // topography (O 100%, P 75%, C 40%) gives C-P = 35 against P-O = 25 — the
  // parietal link legitimately carries MORE alpha. The only way to satisfy the
  // old bound was to hold P artificially low, which is exactly what the engine
  // did: a -0.4 inferior offset on the PDR source left P3 at 20% of O1 while
  // posterior-temporal T5 sat at 69%, so the parasagittal chain showed no PDR
  // until its very last link. See engine.ts's pdrL/pdrR comment.
  //
  // What replaces it is the claim that actually holds: BOTH posterior links of
  // the chain carry the rhythm, so neither is starved. This is what a reader
  // means by the antero-posterior gradient being smooth.
  const ratioPO = bipAlpha(closed, 'P4', 'O2') / bipAlpha(closed, 'C4', 'P4');
  check('C4-P4 and P4-O2 BOTH carry the PDR (neither link starved; ratio near 1)',
    ratioPO, 0.35, 3.0);
  // And the referential topography that makes it true, asserted directly — this
  // is the check that would have caught the defect above. Parietal must not be
  // starved relative to posterior temporal: P3 sits over parieto-occipital
  // cortex and belongs at or above T5, never at a third of it.
  const refA = (n: string) => bandPower(closed.data[closed.eng.indexOf(n)], 8, 12);
  check('P3 / T5 alpha power (parietal is not starved vs posterior temporal)',
    refA('P3') / refA('T5'), 0.5, 3.0);
  check('P4 / T6 alpha power (parietal is not starved vs posterior temporal)',
    refA('P4') / refA('T6'), 0.5, 3.0);
  // The posterior-temporal link carries the PDR too, unlike anterior-temporal F8-T4.
  check('T6-O2 / F8-T4 alpha power (PDR reaches posterior temporal, not anterior)',
    bipAlpha(closed, 'T6', 'O2') / bipAlpha(closed, 'F8', 'T4'), 4.0, 1e6);
  // Alpha reactivity: eye opening attenuates the posterior rhythm to a fraction.
  check('P4-O2 alpha, eyes-open / eyes-closed (Berger effect attenuation)',
    bipAlpha(open, 'P4', 'O2') / bipAlpha(closed, 'P4', 'O2'), 0, 0.45);
  // Mu does NOT react to eye opening (IK-007): while posterior alpha collapses,
  // the sensorimotor rhythm at C3/C4 persists — it is precisely this differential
  // reactivity that tells the two 8-13 Hz rhythms apart (IK-006).
  //
  // This asserts on MU'S OWN contribution, isolated, not on total 8-13 Hz power at
  // C3/C4. The difference matters and used to be wrong. Reading the composite band
  // cannot separate "mu blocked" from "posterior alpha that reaches C3/C4
  // collapsed", and once the forward model gained a realistic algebraic tail the
  // posterior rhythm genuinely does reach the central electrodes — so the composite
  // ratio fell to 0.764 and reported a violation of a claim the entry never made.
  // The old comment here conceded the confound ("a small residual dip is the
  // attenuated posterior-alpha field spilling into the central electrodes, not mu
  // reacting") and measured through it anyway.
  //
  // Isolation is exact rather than statistical: `muFraction` is supplied as a
  // subject override, so lowering it to 0 changes only the mu oscillators' RMS and
  // leaves every other source bit-identical at the same seed. Subtracting the two
  // time series therefore yields mu and nothing else. Referential C3/C4, because
  // reactivity is a spectral question (CLAUDE.md §4).
  const NO_MU: EngineOptions = { ...OPTS, subject: { ...OPTS.subject, muFraction: 0 } };
  const closedNoMu = runEngineState(120, NO_MU, 'awake', []);
  const openNoMu = runEngineState(120, NO_MU, 'awake', ['eyes-open']);
  const muOnly = (withMu: typeof closed, without: typeof closed, e: string) => {
    const a = withMu.data[withMu.eng.indexOf(e)], b = without.data[without.eng.indexOf(e)];
    const d = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) d[i] = a[i] - b[i];
    return bandPower(d, 8, 13);
  };
  const muOpen = muOnly(open, openNoMu, 'C3') + muOnly(open, openNoMu, 'C4');
  const muClosed = muOnly(closed, closedNoMu, 'C3') + muOnly(closed, closedNoMu, 'C4');
  check('C3+C4 isolated mu power, eyes-open / eyes-closed (mu does not block; IK-007)',
    muOpen / muClosed, 0.8, 1.25);
});

// --- 6d. Amplitude inversely related to frequency (LEARNINGEEG-STUDY §1, §3):
// the slower posterior alpha rhythm must be higher-amplitude than the faster
// beta rhythm, each measured at its own characteristic site (alpha posterior;
// beta at engine.ts's betaL/betaR/betaF anchors C3/C4/F3/F4/Fz) rather than
// diluted or contaminated by measuring both at the same electrodes — a fixed
// 13-30 Hz band read at O1/O2 picks up the posterior alpha line's own spectral
// skirt, not a real posterior beta rhythm, and would fail this the wrong way.

section('\nAmplitude vs frequency (alpha vs beta, each at its own site):', () => {
  const { eng, data } = runEngine(120, { seed: 5, artifacts: false, recordingChain: false,
    subject: { iaf: 10, alphaRms: 16, betaRms: 4, vigilanceBias: 0.62 } });
  const alphaAmp = (n: string) => Math.sqrt(bandPower(data[eng.indexOf(n)], 8, 12));
  const betaAmp = (n: string) => Math.sqrt(bandPower(data[eng.indexOf(n)], 13, 30));
  const alphaPost = Math.max(alphaAmp('O1'), alphaAmp('O2'));
  const betaOwnSite = Math.max(betaAmp('C3'), betaAmp('C4'), betaAmp('F3'), betaAmp('F4'), betaAmp('Fz'));
  check('alpha amplitude (posterior) / beta amplitude (central-frontal, own site)',
    alphaPost / betaOwnSite, 1.5, 20);
});

// --- 6e. Sensorimotor beta is a low, even admixture, not spiky transients
// (LEARNINGEEG-STUDY §9). Beta is genuinely bursty, but the BurstyOscillator's
// log-normal amplitude tail (`ampSigma`, in BETA_BURST_OPTS) governs how far the
// tallest burst towers over the background. A heavy tail throws occasional bursts
// several times the median, which land on the page as sharp central packets a
// learner could mistake for muscle or an epileptiform transient. Total beta power
// is fixed (the oscillator recalibrates its RMS), so the salience defect lives
// entirely in the CREST FACTOR — peak envelope / RMS — of the production beta
// generator. Averaged over seeds for stability: ampSigma 0.4 holds it near 8; the
// old 0.6 default pushed it past 10. This imports BETA_BURST_OPTS so a revert of
// the tail is caught here.

section('\nSensorimotor beta salience (no standout spikes):', () => {
  const crest = (seed: number) => {
    const src = new BurstyOscillator(seed, DT, { ...BETA_BURST_OPTS, rms: 4 });
    const n = 120 * FS;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = src.next();
    const env = hilbertEnvelope(x);
    let mx = 0, sumSq = 0;
    for (const v of env) { mx = Math.max(mx, v); sumSq += v * v; }
    return mx / Math.sqrt(sumSq / env.length);
  };
  const seeds = [1, 2, 3, 4, 5];
  const meanCrest = seeds.reduce((a, s) => a + crest(s), 0) / seeds.length;
  check('beta burst crest factor (peak/RMS; tamed amplitude tail)', meanCrest, 0, 9.0);
});

// --- 6f. Posterior dominant rhythm waxing tail (analogous to §6e beta). The
// HopfOscillator drives its waxing/waning with a log-normal envelope multiplier,
// exp(PDR_ENVELOPE_DEPTH * modulator); that depth governs how far the tallest
// alpha burst towers over the in-band RMS. At the old 0.55 default the crest ran
// ~5.6, and the tallest bursts read referentially (O1/O2-AVG) above the 100 uV
// PDR ceiling (LEARNINGEEG §1) and sharp enough that a learner could misread a
// waxing alpha burst as an epileptiform transient. 0.42 tames the tail; mean
// alpha power is unchanged because the oscillator recalibrates its RMS to `rms`.
// Imports PDR_ENVELOPE_DEPTH so a revert of the depth is caught here.

section('\nPDR alpha burst salience (waxing tail):', () => {
  const crest = (seed: number) => {
    const src = new HopfOscillator(seed, DT, {
      freq: 10, rms: 16, freqWander: 0.55, damping: -2.6, envelopeDepth: PDR_ENVELOPE_DEPTH,
    });
    const n = 120 * FS;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = src.next();
    const env = hilbertEnvelope(x);
    let mx = 0, sumSq = 0;
    for (const v of env) { mx = Math.max(mx, v); sumSq += v * v; }
    return mx / Math.sqrt(sumSq / env.length);
  };
  const seeds = [1, 2, 3, 4, 5];
  const meanCrest = seeds.reduce((a, s) => a + crest(s), 0) / seeds.length;
  check('PDR alpha crest factor (peak/RMS; tamed waxing tail)', meanCrest, 0, 5.4);
});

// --- 6g. Background mu is a per-subject BENIGN VARIANT, and the central phase
// reversal follows it. The reference course places mu in "Normal Variants" —
// the epileptiform-mimic chapter — not in "Normal Awake", whose background is
// the PDR, the antero-posterior gradient, reactivity and activation, with no
// central rhythm at all.
//
// This is a display-space claim (CLAUDE.md §4), so it is asserted on rendered
// bipolar-ap rows, not on referential band power. Mu is focal at C3/C4, so when
// a subject HAS it the parasagittal chain SHOULD phase-reverse there — that is
// how a reader recognises mu, and suppressing it would be the error. The claim
// is the converse: a subject WITHOUT mu must show no central reversal, because
// nothing in a normal awake background is focal at C3/C4. Until mu became a
// per-subject trait every subject carried it symmetrically, so this reversal was
// a permanent fixture of the default record and trained the learner to ignore
// the one localising sign the double-banana exists to produce (IK-003).
//
// Seeds are chosen by asking `sampleSubject` what it actually drew, so this
// exercises the shipped sampling rather than an injected override.

section('\nBackground mu as a per-subject variant (display space, bipolar-ap awake):', () => {
  // Prevalence guard: mu is a minority finding. Published figures for a routine
  // record run from 4% (visual review of 100 normal adults) to 22% (a sleep-EEG
  // cohort), and the bounds are those two. They were 20-50%, a range with no
  // source, and the draw sat at 34% inside it.
  let present = 0;
  for (let sd = 1; sd <= 2000; sd++) if (sampleSubject(sd).muFraction > 0) present++;
  check('subjects with background mu (benign variant, minority finding)',
    present / 2000, 0.04, 0.22);

  // (i) The invariant the reported defect was about, measured on the SHIPPED
  // sampling: take the first six subjects `sampleSubject` gives no mu, and the
  // central links must not be inverted against each other. Before this work the
  // same measurement read -0.448 (left) / -0.549 (right) in every subject.
  const noMu: number[] = [];
  for (let sd = 1; sd <= 400 && noMu.length < 6; sd++) {
    if (sampleSubject(sd).muFraction === 0) noMu.push(sd);
  }
  const centralOf = (seed: number) => {
    const { montage, data } = runDisplay('bipolar-ap', 'awake', [], 120, seed);
    const idx = (l: string) => montage.channels.findIndex((c) => c.label === l);
    return [corr(data[idx('F3-C3')], data[idx('C3-P3')]),
            corr(data[idx('F4-C4')], data[idx('C4-P4')])];
  };
  const noMuCorrs = noMu.flatMap(centralOf);
  check('no-mu subjects: mean F3-C3 vs C3-P3 and F4-C4 vs C4-P4 correlation (no central reversal)',
    noMuCorrs.reduce((a, b) => a + b, 0) / noMuCorrs.length, -0.18, 0.35);

  // (ii) And the reversal must actually TRACK mu — otherwise the fix would have
  // been to delete a rhythm rather than to scope it. Paired on one subject: the
  // between-subject spread is large (sd ~0.19 on a 120 s record), so comparing
  // six-subject means is underpowered and measured a 0.009 difference against a
  // true ~0.13. Pairing removes subject variance and leaves mu as the only
  // difference. Still display space — the electrodes go through the real
  // commonAverage + computeChannelVoltage, exactly as EEGCanvas draws them.
  const LINKS = ['F3-C3', 'C3-P3', 'F4-C4', 'C4-P4'];
  const centralPaired = (muFraction: number) => {
    const r = runEngineState(120, {
      seed: 5, artifacts: false, recordingChain: false,
      subject: { iaf: 10, alphaRms: 16, vigilanceBias: 0.62, muFraction, muLaterality: 0.5 },
    }, 'awake', []);
    const chans = MONTAGES['bipolar-ap'].channels.filter((c) => LINKS.includes(c.label));
    const n = r.data[0].length;
    const rows = new Map(chans.map((c) => [c.label, new Float64Array(n)]));
    const allV: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      for (let e = 0; e < r.eng.electrodes.length; e++) allV[r.eng.electrodes[e]] = r.data[e][i];
      const avg = commonAverage(allV);
      for (const c of chans) rows.get(c.label)![i] = computeChannelVoltage(c, i / FS, allV, avg);
    }
    return (corr(rows.get('F3-C3')!, rows.get('C3-P3')!)
          + corr(rows.get('F4-C4')!, rows.get('C4-P4')!)) / 2;
  };
  check('same subject, mu present makes the central pair MORE inverted (reversal tracks mu)',
    centralPaired(0) - centralPaired(0.45), 0.05, 1.0);
});

// --- Montage localisation coverage. A bipolar montage exists so a focus can be
// localised by phase reversal, and that requires the electrode of interest to sit
// in TWO adjacent derivations: one large row with no neighbour to oppose it
// localises nothing. Electrodes that appear only ONCE in a montage are therefore
// blind spots, and their count is the montage's structural fitness for purpose.
//
// `bipolar-transverse` used to leave TEN electrodes single-appearance — every
// lateral one plus both occipitals (Fp1, Fp2, F7, F8, T3, T4, T5, T6, O1, O2) —
// because its chains stopped one derivation short at each end. A T3-maximal spike
// reversed cleanly on bipolar-ap and stood alone on the transverse montage, so the
// confirmation a reader switches montage FOR was unobtainable. Adopting ACNS
// Guideline 3 TB-18.1 in full (adding F7-Fp1, Fp2-F8, T5-O1, O2-T6) closes eight of
// the ten. T3 and T4 remain, and can only be closed by the A1-T3 / T4-A2 ear links
// of TB-18.2, which belongs as its own montage rather than bolted onto this one.

section('\nMontage localisation coverage (electrodes with only one derivation):', () => {
  const singles = (montageId: string) => {
    const seen: Record<string, number> = {};
    for (const c of MONTAGES[montageId].channels) {
      if (c.label === 'ECG') continue;
      for (const e of [c.active, c.reference]) if (e) seen[e] = (seen[e] ?? 0) + 1;
    }
    return Object.values(seen).filter((n) => n === 1).length;
  };
  // bipolar-ap: Fz and Pz, which is correct — a three-electrode midline chain has
  // two ends and cannot do better.
  check('bipolar-ap electrodes appearing in only one derivation', singles('bipolar-ap'), 0, 2);
  // bipolar-transverse (ACNS TB-18.1): T3 and T4 only.
  check('bipolar-transverse electrodes appearing in only one derivation',
    singles('bipolar-transverse'), 0, 2);

  // The two transverse montages are COMPLEMENTARY, which is why the standard
  // defines both and why neither is asserted to cover everything on its own.
  // TB-18.1 runs its chains to the lateral and occipital ends but stops the
  // central chain at T3/T4; TB-18.2 runs that chain ear-to-ear (A1-T3 … T4-A2),
  // covering T3/T4 at the cost of the ends. Measured on a T3-maximal spike:
  // TB-18.1 gives T3-C3 -171.6 µV standing alone, TB-18.2 gives A1-T3 +187.0
  // against T3-C3 -171.6, a clean reversal.
  //
  // So the invariant worth asserting is at the level of the montage SET, not any
  // one montage: every scalp electrode must have two links in at least one
  // transverse montage, or there is a focus the reader simply cannot confirm.
  // A1/A2 are excluded — they are chain terminals by construction, as Fz and Pz
  // are on the midline chain of bipolar-ap.
  const twoLinkSomewhere = (montageIds: string[]) => {
    const best: Record<string, number> = {};
    for (const id of montageIds) {
      const seen: Record<string, number> = {};
      for (const c of MONTAGES[id].channels) {
        if (c.label === 'ECG') continue;
        for (const e of [c.active, c.reference]) if (e) seen[e] = (seen[e] ?? 0) + 1;
      }
      for (const [e, n] of Object.entries(seen)) best[e] = Math.max(best[e] ?? 0, n);
    }
    return Object.entries(best)
      .filter(([e, n]) => n < 2 && e !== 'A1' && e !== 'A2')
      .map(([e]) => e);
  };
  const uncovered = twoLinkSomewhere(['bipolar-transverse', 'bipolar-transverse-ears']);
  check('scalp electrodes with no two-link coverage in ANY transverse montage',
    uncovered.length, 0, 0);
});

// --- Beta must be an ADMIXTURE, not the dominant rhythm of the row it sits on.
// IK-014 says awake sensorimotor beta is "a low-amplitude, relatively even central
// admixture" riding within the background envelope. That entry's existing check
// measures the generator's crest factor in isolation, and a separate one compares
// posterior alpha to central beta each at its own site — neither asks the question
// a reader answers at a glance: how much of THIS ROW is beta?
//
// It went unasked and the answer was 70%. Measured across ten seeds on bipolar-ap,
// beta reached 17 uV on F3-C3 and F4-C4, was 67-70% of their 2-45 Hz power against
// 33-36% on rows with no beta source near them, and was LOUDER than alpha there
// (beta/alpha 1.7-1.8). On the page those rows read as serrated and noisy against
// clean temporal rows — a defect a user spotted immediately and the whole battery
// missed. Corrected by taking betaRms from 2.5-6.0 to 1.25-3.0 uV (roughly 7-18 uV
// peak-to-peak, the textbook awake range) and widening betaL/betaR to 1.6x.
//
// The floor is not zero and the bound respects that: the aperiodic background
// carries its own 13-30 Hz content worth ~33-36% of any row, so no setting of the
// beta oscillators takes the share below that. What is asserted is the EXCESS over
// rows that have no beta source of their own.

section('\nBeta as an admixture, not the dominant rhythm (display space, bipolar-ap awake):', () => {
  const SEEDS = [3, 5, 42, 777, 1234];
  const share = (label: string) => {
    const vals = SEEDS.map((seed) => {
      const { montage, data } = runDisplay('bipolar-ap', 'awake', [], 60, seed);
      const x = data[montage.channels.findIndex((c) => c.label === label)];
      const psd = welch(x, FS, 4096);
      let b = 0, t = 0;
      for (let k = 0; k < psd.freqs.length; k++) {
        const f = psd.freqs[k];
        if (f >= 13 && f < 30) b += psd.power[k];
        if (f >= 2 && f < 45) t += psd.power[k];
      }
      return Math.sqrt(b) / Math.sqrt(t);
    });
    return vals.reduce((a, c) => a + c, 0) / vals.length;
  };
  // Rows carrying a beta source, against rows that carry none. The excess is what
  // beta actually adds; asserting the raw share alone would be asserting the
  // background's 13-30 Hz content too.
  const central = (share('F3-C3') + share('F4-C4')) / 2;
  const clean = (share('T3-T5') + share('P3-O1')) / 2;
  check('beta share of a central row (F3-C3, F4-C4) in display space', central, 0.30, 0.60);
  check('central beta share MINUS a row with no beta source (the excess beta adds)',
    central - clean, 0.0, 0.25);
});

// --- 7. Artifacts: statistics and topography.

section('\nArtifacts:', () => {
  const { eng, data } = runEngine(180, { seed: 6,
    subject: { artifactBurden: 1.2, lineAmp: 4, alphaRms: 12 } });
  // EMG is shot noise, so it must be heavy-tailed. Filtered Gaussian noise with
  // the same bandwidth would sit near 0 here and fool nothing but a spectrum.
  const temporal = data[eng.indexOf('T3')];
  check('temporal channel excess kurtosis (EMG shot noise)', kurtosis(temporal), 0.25, 40);
  // Blinks are frontal-maximal and decay posteriorly.
  const lf = (n: string) => bandPower(data[eng.indexOf(n)], 0.5, 5);
  check('frontal / occipital low-frequency power (blink)', (lf('Fp1') + lf('Fp2')) / (lf('O1') + lf('O2')), 1.5, 400);
});

// --- 7b. Artifact gating: a UI checkbox left off must leave the corresponding
// engine generator's contribution at zero, or "no artifacts selected" would be
// a lie (this is the bug this gating mechanism exists to fix). Blink is the
// discriminating case: it is the only artifact large enough at Fp1/Fp2 to be
// visible against the aperiodic/alpha background there, ~180-220 uV p2p over
// 60 s when enabled (see the "ON" figures probed during development) vs.
// background-only. `setArtifactGates` must silence it while leaving the
// neural background (O1's own p2p) untouched, proving the gate acts on the
// artifact generator specifically and not on the engine as a whole.

section('\nArtifact gating (checkbox off => generator silent):', () => {
  const eng = new EegEngine({ seed: 9, subject: { artifactBurden: 1.6, alphaRms: 12 } });
  eng.setArtifactGates({
    blink: false, eyeOpening: false, saccade: false, emg: false, pop: false,
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
});

// --- 7c. DISPLAY POLARITY. Clinical EEG is drawn negative-up: a channel whose
// active input is more positive than its reference deflects DOWNWARD. The canvas
// implements that as `y = centerY + v` (EEGCanvas), so the sign a generator
// returns decides which way a learner sees the pattern point. Getting it wrong
// does not show up in any power/correlation check — every other assertion in
// this file is invariant to a sign flip — which is exactly how the app came to
// render every trace inverted while passing the whole battery.
//
// Each pattern's contribution is isolated by subtracting a same-seed run with
// the pattern off. The engine is deterministic, so that difference is the
// generator's exact output with the background removed.

section('\nDisplay polarity (negative-up: v > 0 renders DOWN):', () => {
  const POL_OPTS: EngineOptions = { seed: 20, artifacts: false, recordingChain: false, subject: { alphaRms: 12 } };
  const SECS = 60;

  /**
   * Sign of the diagnostic phase of `toggle`'s contribution at `el`.
   * `metric: 'lead'` takes the first phase of the event (isolated transients);
   * 'peak' takes the largest excursion, which is what names the spike in a
   * RHYTHMIC train — there every spike is preceded by the previous cycle's slow
   * wave, so a look-back would report that neighbour instead.
   */
  function polarity(state: PatientState, toggle: string, el: string, metric: 'lead' | 'peak' | 'sharp'): number {
    const on = runEngineState(SECS, POL_OPTS, state, [toggle]);
    const off = runEngineState(SECS, POL_OPTS, state, []);
    const i = on.eng.indexOf(el);
    const n = on.data[0].length;
    let peak = 0, peakAt = 0;
    const d = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      d[k] = on.data[i][k] - off.data[i][k];
      if (Math.abs(d[k]) > Math.abs(peak)) { peak = d[k]; peakAt = k; }
    }
    if (Math.abs(peak) < 1) return 0; // toggle never reached the generator
    if (metric === 'peak') return Math.sign(peak);
    if (metric === 'sharp') {
      // The sharpest point of the trace: where a sample stands furthest from the
      // mean of its neighbours two samples (8 ms) either side. For a complex whose
      // slow wave is the larger lobe — the 6 Hz phantom spike-wave, by definition —
      // this names the spike, which 'peak' would not.
      let best = 0, at = 2;
      for (let k = 2; k < n - 2; k++) {
        const c = Math.abs(d[k] - (d[k - 2] + d[k + 2]) / 2);
        if (c > best) { best = c; at = k; }
      }
      return Math.sign(d[at] - (d[at - 2] + d[at + 2]) / 2);
    }
    const thresh = 0.4 * Math.abs(peak);
    for (let k = Math.max(0, peakAt - Math.round(0.5 * FS)); k <= peakAt; k++) {
      if (Math.abs(d[k]) >= thresh) return Math.sign(d[k]);
    }
    return Math.sign(peak);
  }

  // Blink is an artifact GATE, not a pattern toggle, so it needs its own pair of
  // runs. It is also the case a reader notices first: Bell's phenomenon drives
  // Fp1 positive relative to F3, which must render DOWNWARD (IK-001).
  {
    const mk = (blink: boolean) => {
      // `artifacts: false` (POL_OPTS) switches the artifact subsystem off
      // wholesale, so the gate would have nothing to enable — this pair needs it
      // built, with every other artifact gated off so the diff is blink alone.
      const eng = new EegEngine({ ...POL_OPTS, artifacts: true });
      eng.setArtifactGates({
        blink, eyeOpening: false, saccade: false, emg: false, pop: false,
        sweat: false, line: false, ecgScalp: false, movement: false,
      });
      const n = Math.floor(SECS * FS);
      const buf = new Float64Array(eng.electrodes.length);
      const iA = eng.indexOf('Fp1'), iB = eng.indexOf('F3');
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) { eng.next(buf); out[i] = buf[iA] - buf[iB]; }
      return out;
    };
    const on = mk(true), off = mk(false);
    let peak = 0;
    for (let i = 0; i < on.length; i++) {
      const v = on[i] - off[i];
      if (Math.abs(v) > Math.abs(peak)) peak = v;
    }
    check('blink Fp1-F3 peak (IK-001: Fp1 positive)', peak, 5, 400, ' uV');
    check('blink Fp1-F3 renders DOWN (+1)', Math.sign(peak), 1, 1);
  }

  // The blink's FIELD (IK-032). The checks above assert direction on one row, which a
  // blink confined to Fp1 alone would also satisfy — and did: a geometry change once
  // collapsed F3-C3 to 0.7 mm on the page while every check here stayed green. A real
  // blink is bifrontal, so the second row of each chain must carry a visible downward
  // deflection too, smaller than the first, with nothing left by the occiput.
  {
    const EL = ['Fp1', 'F3', 'C3', 'P3', 'O1', 'F7', 'T3'] as const;
    const mk = (blink: boolean) => {
      const eng = new EegEngine({ ...POL_OPTS, artifacts: true });
      eng.setArtifactGates({
        blink, eyeOpening: false, saccade: false, emg: false, pop: false,
        sweat: false, line: false, ecgScalp: false, movement: false,
      });
      const n = Math.floor(SECS * FS);
      const buf = new Float64Array(eng.electrodes.length);
      const idx = EL.map(e => eng.indexOf(e));
      const out = EL.map(() => new Float64Array(n));
      for (let i = 0; i < n; i++) { eng.next(buf); idx.forEach((j, k) => { out[k][i] = buf[j]; }); }
      return out;
    };
    const on = mk(true), off = mk(false);
    // Isolate the blink by differencing the same-seed runs, then read every electrode
    // at the single instant the blink peaks — a field is a snapshot, not a power ratio.
    const d = EL.map((_, k) => {
      const a = new Float64Array(on[k].length);
      for (let i = 0; i < a.length; i++) a[i] = on[k][i] - off[k][i];
      return a;
    });
    const at = (e: typeof EL[number]) => d[EL.indexOf(e)];
    let ti = 0;
    for (let i = 0; i < at('Fp1').length; i++) {
      if (Math.abs(at('Fp1')[i]) > Math.abs(at('Fp1')[ti])) ti = i;
    }
    const row = (a: typeof EL[number], b: typeof EL[number]) => at(a)[ti] - at(b)[ti];
    const fp1f3 = row('Fp1', 'F3'), f3c3 = row('F3', 'C3');
    const fp1f7 = row('Fp1', 'F7'), f7t3 = row('F7', 'T3');
    check('blink F3-C3 renders DOWN (+1; IK-032, the row that went flat)', Math.sign(f3c3), 1, 1);
    check('blink F7-T3 renders DOWN (+1; IK-032)', Math.sign(f7t3), 1, 1);
    check('blink F3-C3 / Fp1-F3 (IK-032: present but decaying)', f3c3 / fp1f3, 0.15, 0.95);
    check('blink F7-T3 / Fp1-F7 (IK-032: present but decaying)', f7t3 / fp1f7, 0.15, 0.95);
    check('blink P3-O1 / Fp1-F3 (IK-032: no posterior field)',
      Math.abs(row('P3', 'O1')) / fp1f3, 0, 0.1);
  }

  // The blink's RECOVERY SWING (IK-001). A real blink does not drop and stop: the
  // downward deflection is followed by a smaller opposite-going excursion that
  // carries the trace back through baseline. That overshoot is not made by the
  // eyelid — `BlinkGenerator.next()` returns a strictly non-negative lid shape, so
  // the generator alone is monophasic — it is made by the recording chain's causal
  // low-frequency filter (chain.ts `CLINICAL_LFF_HZ`), which returns any transient
  // to baseline by driving it past baseline.
  //
  // Hence this pair runs WITH the recording chain, unlike every other check in 7c,
  // which switches it off to isolate a generator. The chain is deterministic and
  // linear, and both runs share a seed, so its noise, gains and filter states are
  // identical and cancel in the on-minus-off difference exactly as they do above.
  {
    const fp1f3 = (blink: boolean) => {
      // This check needs ONE isolated blink: it finds the largest blink and asserts
      // the row is back at baseline in the [1.5, 3] s window after its peak. Blinks
      // are now spaced regularly (BlinkGenerator's low-variance schedule), so at the
      // default 16/min rate (~3.75 s apart, min gap ~3.0 s) the NEXT blink's onset
      // lands on the far edge of that window and contaminates the "baseline". Halve
      // the blink rate here (artifactBurden 0.5 -> ~8/min, gaps >= 6 s) so the measured
      // blink is genuinely alone. Rate does not affect a single blink's amplitude or
      // morphology — the only things IK-001's recovery claim depends on.
      const eng = new EegEngine({
        ...POL_OPTS, artifacts: true, recordingChain: true,
        subject: { alphaRms: 12, artifactBurden: 0.5 },
      });
      eng.setArtifactGates({
        blink, eyeOpening: false, saccade: false, emg: false, pop: false,
        sweat: false, line: false, ecgScalp: false, movement: false,
      });
      const n = Math.floor(SECS * FS);
      const buf = new Float64Array(eng.electrodes.length);
      const iA = eng.indexOf('Fp1'), iB = eng.indexOf('F3');
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) { eng.next(buf); out[i] = buf[iA] - buf[iB]; }
      return out;
    };
    const on = fp1f3(true), off = fp1f3(false);
    const n = on.length;
    const d = new Float64Array(n);
    let peak = 0, peakAt = 0;
    for (let i = 0; i < n; i++) {
      d[i] = on[i] - off[i];
      if (Math.abs(d[i]) > Math.abs(peak)) { peak = d[i]; peakAt = i; }
    }
    // Largest excursion of the OPPOSITE sign in the 1.5 s following the peak, and
    // what is left of the row in the 1.5 s after that (the return to baseline).
    let swing = 0;
    for (let i = peakAt; i < Math.min(n, peakAt + Math.round(1.5 * FS)); i++) {
      if (-Math.sign(peak) * d[i] > -Math.sign(peak) * swing) { swing = d[i]; }
    }
    let residual = 0;
    for (let i = peakAt + Math.round(1.5 * FS); i < Math.min(n, peakAt + Math.round(3 * FS)); i++) {
      residual = Math.max(residual, Math.abs(d[i]));
    }
    check('blink Fp1-F3 recovery swing runs UP (-1; IK-001, opposite the main deflection)',
      Math.sign(swing), -1, -1);
    check('blink Fp1-F3 recovery swing / downward peak (IK-001: a smaller opposite swing)',
      Math.abs(swing) / Math.abs(peak), 0.10, 0.50);
    check('blink Fp1-F3 back at baseline 1.5-3 s after the peak (IK-001), as a fraction of peak',
      residual / Math.abs(peak), 0, 0.10);
  }

  // Eye opening rides the same ocular sources as a blink but must render the
  // OPPOSITE way — upward, i.e. Fp1-F3 negative — and at a smaller amplitude
  // (IK-011). Its own gate pairs, artifacts built, everything else silenced so
  // each diff isolates that one generator.
  {
    const fp1f3 = (gate: Partial<ArtifactGates>) => {
      const eng = new EegEngine({ ...POL_OPTS, artifacts: true });
      eng.setArtifactGates({
        blink: false, eyeOpening: false, saccade: false, emg: false, pop: false,
        sweat: false, line: false, ecgScalp: false, movement: false, ...gate,
      });
      const n = Math.floor(SECS * FS);
      const buf = new Float64Array(eng.electrodes.length);
      const iA = eng.indexOf('Fp1'), iB = eng.indexOf('F3');
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) { eng.next(buf); out[i] = buf[iA] - buf[iB]; }
      return out;
    };
    const off = fp1f3({});
    const signedPeak = (on: Float64Array) => {
      let peak = 0;
      for (let i = 0; i < on.length; i++) {
        const v = on[i] - off[i];
        if (Math.abs(v) > Math.abs(peak)) peak = v;
      }
      return peak;
    };
    const openPeak = signedPeak(fp1f3({ eyeOpening: true }));
    const blinkPeak = signedPeak(fp1f3({ blink: true }));
    check('eye-opening Fp1-F3 renders UP (-1; IK-011, opposite a blink)', Math.sign(openPeak), -1, -1);
    check('eye-opening Fp1-F3 peak (sanity floor)', Math.abs(openPeak), 3, 200, ' uV');
    check('eye-opening / blink Fp1-F3 peak magnitude (IK-011: smaller than a blink)',
      Math.abs(openPeak) / Math.abs(blinkPeak), 0, 0.85);
  }

  // IK-007 for the eye-opening MANEUVER. While the eyes are held open between the
  // opening and closing sweeps the PDR blocks, and after closure it comes back
  // within about a second (learningeeg: the PDR "emerges right after the patient
  // closes their eyes"). Until 2026-09-11 the maneuver drew its ocular sweeps with the
  // alpha running straight through the open interval — the one picture reactivity
  // says cannot happen — and no check looked, because the toggle-level check above
  // (`eyes-open`) never exercises the maneuver.
  //
  // Measured on the PDR's OWN contribution: the same seed at alphaRms 12 minus
  // alphaRms 0 leaves every other source bit-identical, so neither the ocular sweep
  // nor the background can pass for alpha, and its Hilbert envelope needs no
  // band-pass. Mu is pinned off so the difference is the PDR alone.
  {
    const run = (alphaRms: number, eyeOpening = true) => {
      const eng = new EegEngine({ ...POL_OPTS, artifacts: true, subject: { alphaRms, muFraction: 0 } });
      eng.setArtifactGates({
        blink: false, eyeOpening, saccade: false, emg: false, pop: false,
        sweat: false, line: false, ecgScalp: false, movement: false,
      });
      const n = Math.floor(SECS * FS);
      const buf = new Float64Array(eng.electrodes.length);
      const iP = eng.indexOf('P4'), iO = eng.indexOf('O2');
      const x = new Float64Array(n), lvl = new Float64Array(n);
      for (let i = 0; i < n; i++) { eng.next(buf); x[i] = buf[iP] - buf[iO]; lvl[i] = eng.groundTruth.eyesOpen; }
      return { x, lvl };
    };
    const a = run(12), z = run(0);
    const pdr = new Float64Array(a.x.length);
    for (let i = 0; i < pdr.length; i++) pdr[i] = a.x[i] - z.x[i];
    const env = hilbertEnvelope(pdr);
    let sOpen = 0, nOpen = 0, sClosed = 0, nClosed = 0, closures = 0;
    for (let i = 0; i < env.length; i++) {
      if (a.lvl[i] > 0.9) { sOpen += env[i]; nOpen++; } else if (a.lvl[i] < 0.02) { sClosed += env[i]; nClosed++; }
      if (i > 0 && a.lvl[i - 1] >= 0.5 && a.lvl[i] < 0.5) closures++;
    }
    const closed = sClosed / nClosed;
    check('eye-opening maneuvers in the window (enough to measure)', closures, 3, 1e6);
    check('PDR amplitude while eyes held open / eyes closed, P4-O2 (IK-007: attenuates by at least half)',
      sOpen / nOpen / closed, 0, 0.5);

    // After closure the PDR comes back PROMINENTLY: it overshoots its settled
    // amplitude for a second or two before easing down (engine.ts ALPHA_REBOUND_*,
    // measured on learningeeg's pdr-emerges-eye-closure figure: 2.19x settled at
    // +1.0-1.5 s). Asserted against the SAME subject at the SAME moments with no
    // maneuver — not against "eyes-closed on this run", whose baseline contains the
    // rebound itself. Only closures followed by >= 5 s of closed eyes count.
    const c = run(12, false), zc = run(0, false);
    const ctl = new Float64Array(c.x.length);
    for (let i = 0; i < ctl.length; i++) ctl[i] = c.x[i] - zc.x[i];
    const envCtl = hilbertEnvelope(ctl);
    const win = (e: Float64Array, a: number, b: number) => {
      let s = 0; for (let k = a; k < b; k++) s += e[k]; return s / (b - a);
    };
    // Settling is read at 4-5 s: both real records are still raised at 2.5-3.5 s.
    let reb = 0, settle = 0, nReb = 0;
    for (let i = 1; i < env.length; i++) {
      if (!(a.lvl[i - 1] >= 0.5 && a.lvl[i] < 0.5)) continue;
      const end = i + Math.round(5 * FS);
      if (end > env.length || a.lvl.subarray(i, end).some((v) => v >= 0.5)) continue;
      const w = (s0: number, s1: number) => [i + Math.round(s0 * FS), i + Math.round(s1 * FS)] as const;
      reb += win(env, ...w(0.75, 2.0)) / win(envCtl, ...w(0.75, 2.0));
      settle += win(env, ...w(4.0, 5.0)) / win(envCtl, ...w(4.0, 5.0));
      nReb++;
    }
    check('eye closures followed by >= 5 s of closed eyes (enough to measure the rebound)', nReb, 2, 1e6);
    check('PDR amplitude 0.75-2.0 s after eye closure / same moments without the maneuver (IK-007: rebounds above resting)',
      reb / nReb, 1.2, 3);
    check('PDR amplitude 4-5 s after eye closure / same moments without the maneuver (IK-007: settles back)',
      settle / nReb, 0.8, 1.3);
  }

  // IK-002 — lateral (saccadic) eye movement is OUT OF PHASE at F7 and F8. The
  // eyes are a standing dipole (cornea positive, retina negative); a horizontal
  // saccade swings it toward the direction of gaze, driving one frontotemporal
  // electrode positive and its mirror negative. On a bipolar-ap chain each of
  // F7 and F8 therefore shows a phase reversal, and the two reversals are mirror
  // images — the left and right upper links move in opposite directions. The
  // `saccade` generator is isolated by the same on-off diff used above, so each
  // link carries only the eye-movement contribution. Correlation (not a single
  // sample's sign) states the reversal: gaze alternates direction, and a global
  // sign-flip of every link leaves each pairwise correlation unchanged.
  {
    const link = (a: string, b: string, gate: Partial<ArtifactGates>) => {
      const eng = new EegEngine({ ...POL_OPTS, artifacts: true });
      eng.setArtifactGates({
        blink: false, eyeOpening: false, saccade: false, emg: false, pop: false,
        sweat: false, line: false, ecgScalp: false, movement: false, ...gate,
      });
      const n = Math.floor(SECS * FS);
      const buf = new Float64Array(eng.electrodes.length);
      const iA = eng.indexOf(a), iB = eng.indexOf(b);
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) { eng.next(buf); out[i] = buf[iA] - buf[iB]; }
      return out;
    };
    // Isolated eye-movement contribution on a bipolar-ap link = on − off on the
    // same seed, so the background rhythm cancels and only the saccade remains.
    const contrib = (a: string, b: string) => {
      const on = link(a, b, { saccade: true });
      const off = link(a, b, {});
      const d = new Float64Array(on.length);
      for (let i = 0; i < d.length; i++) d[i] = on[i] - off[i];
      return d;
    };
    const fp1f7 = contrib('Fp1', 'F7');
    const f7t3 = contrib('F7', 'T3');
    const fp2f8 = contrib('Fp2', 'F8');
    const f8t4 = contrib('F8', 'T4');
    // Phase reversal at F7: the two links sharing F7 are anti-correlated.
    check('eye-movement: Fp1-F7 vs F7-T3 correlation (IK-002: phase reversal at F7)',
      corr(fp1f7, f7t3), -1.0001, -0.4);
    // Phase reversal at F8: the two links sharing F8 are anti-correlated.
    check('eye-movement: Fp2-F8 vs F8-T4 correlation (IK-002: phase reversal at F8)',
      corr(fp2f8, f8t4), -1.0001, -0.4);
    // The two reversals are mirror images: the left and right upper links move in
    // opposite directions across the midline — the core out-of-phase claim.
    check('eye-movement: Fp1-F7 vs Fp2-F8 correlation (IK-002: out of phase across the midline)',
      corr(fp1f7, fp2f8), -1.0001, -0.4);
    // Sanity floor so the correlations cannot be satisfied by near-zero noise.
    // The on−off diff shares a seed, so the background cancels to machine
    // precision; a floor of 1 uV cleanly separates the real saccade deflection
    // (Fp1-F7 partially cancels, both electrodes seeing the ocular dipole, so it
    // is the smallest of the four links) from rounding noise.
    let p = 0;
    for (const v of fp1f7) if (Math.abs(v) > Math.abs(p)) p = v;
    check('eye-movement Fp1-F7 peak (sanity floor)', Math.abs(p), 1, 300, ' uV');
  }

  // IK-012 — the four interictal-discharge morphologies, all at the left-temporal
  // (T3) focus. A reader separates two independent axes, and each is asserted on
  // its own: DURATION (base width) tells a spike from a sharp wave, and an
  // AFTER-GOING SLOW WAVE is what turns either into a "-and-slow-wave" complex.
  // Each toggle's contribution at T3 is isolated by the same on-off diff used
  // above; the leadfield only scales amplitude, so the base width (ms) and the
  // slow/sharp lobe ratio survive projection unchanged.
  {
    const iedAtT3 = (toggle: string) => {
      const on = runEngineState(SECS, POL_OPTS, 'awake', [toggle]);
      const off = runEngineState(SECS, POL_OPTS, 'awake', []);
      const i = on.eng.indexOf('T3');
      const n = on.data[0].length;
      const d = new Float64Array(n);
      for (let k = 0; k < n; k++) d[k] = on.data[i][k] - off.data[i][k];
      return d;
    };
    // Base width (ms) of the surface-negative sharp lobe at 10% of its peak, plus
    // the largest positive excursion in the 0.6 s after it — the after-going slow
    // wave — expressed as a fraction of the sharp peak. Measured on the strongest
    // event; the sharp component is the most-negative sample by construction.
    const measure = (d: Float64Array) => {
      let peak = 0, peakAt = 0;
      for (let k = 0; k < d.length; k++) if (d[k] < peak) { peak = d[k]; peakAt = k; }
      const thresh = 0.1 * Math.abs(peak);
      let lo = peakAt; while (lo > 0 && Math.abs(d[lo]) >= thresh) lo--;
      let hi = peakAt; while (hi < d.length - 1 && Math.abs(d[hi]) >= thresh) hi++;
      const widthMs = ((hi - lo) / FS) * 1000;
      // The slow wave is the largest excursion 0.08-0.4 s after the sharp peak (it
      // peaks 0.12-0.16 s after it, and a bare sharp wave is under 1% of its own
      // peak by 0.08 s), kept with its sign: the same polarity as the spike is
      // what it should have, and until 2026-10-13 it had the other.
      let slow = 0;
      const from = Math.min(d.length, peakAt + Math.round(0.08 * FS));
      const end = Math.min(d.length, peakAt + Math.round(0.4 * FS));
      for (let k = from; k < end; k++) if (Math.abs(d[k]) > Math.abs(slow)) slow = d[k];
      return { widthMs, slowRatio: Math.abs(slow) / Math.abs(peak), slowSign: Math.sign(slow), peak: Math.abs(peak) };
    };
    const spike = measure(iedAtT3('ied-spike'));
    const sharp = measure(iedAtT3('ied-sharp'));
    const spikeWave = measure(iedAtT3('ied-spike-wave'));
    const sharpWave = measure(iedAtT3('ied-sharp-wave'));
    check('ied-spike base width (IK-012: spike 20-70 ms)', spike.widthMs, 20, 70, ' ms');
    check('ied-sharp base width (IK-012: sharp wave 70-200 ms)', sharp.widthMs, 70, 200, ' ms');
    check('ied-sharp broader than ied-spike (IK-012: duration separates them)',
      sharp.widthMs - spike.widthMs, 20, 200, ' ms');
    check('ied-spike has no after-going slow wave (IK-012)', spike.slowRatio, 0, 0.15);
    check('ied-sharp has no after-going slow wave (IK-012)', sharp.slowRatio, 0, 0.15);
    check('ied-spike-wave carries an after-going slow wave (IK-012)', spikeWave.slowRatio, 0.3, 1.5);
    check('ied-sharp-wave carries an after-going slow wave (IK-012)', sharpWave.slowRatio, 0.3, 1.5);
    // IFCN glossary (Kane 2017): a sharp wave "may be followed by slow wave of the
    // same polarity"; learningeeg: an "upward going spike and wave ... is a negative
    // ... discharge". The spike is negative here by construction, so: -1.
    check('ied-spike-wave: the after-going slow wave has the polarity of its spike (-1; IK-012)', spikeWave.slowSign, -1, -1);
    check('ied-sharp-wave: the after-going slow wave has the polarity of its sharp wave (-1; IK-012)', sharpWave.slowSign, -1, -1);
  }

  // -1 = renders UP (surface-negative), +1 = renders DOWN (surface-positive).
  const POLARITIES: [string, PatientState, string, string, 'lead' | 'peak' | 'sharp', number][] = [
    // Surface-NEGATIVE sharp transients — the epileptiform family and the
    // vertex/K-complex sharp components. All must point UP.
    ['V-wave Cz',                'awake', 'v-waves',         'Cz', 'lead', -1],
    ['K-complex Cz (sharp)',     'awake', 'k-complex',       'Cz', 'lead', -1],
    ['focal spike LT T3',        'awake', 'focal-spikes-lt', 'T3', 'lead', -1],
    // A spike-wave run swings about the baseline — troughs down, spikes and
    // domes up — so its largest excursion says little. The spike is the
    // sharpest thing in it.
    ['3 Hz gen. spike-wave Fz',  'awake', '3hz-gsw',         'Fz', 'sharp', -1],
    ['polyspike-wave Fz',        'awake', 'polyspike-wave',  'Fz', 'sharp', -1],
    ['GPEDs Cz',                 'awake', 'gpeds',           'Cz', 'peak', -1],
    // Posterior (FOLD) and drowsy-only since 2026-10-12, and the spike is the
    // SMALLER lobe, so it is found by sharpness rather than by size.
    ['6 Hz phantom spike O1',    'drowsy', '6hz-sw',         'O1', 'sharp', -1],
    // BETS is state-gated to drowsy/n1/n2 (A4 fix — see variants.ts betsSide).
    ['BETS T3',                  'drowsy', 'bets',           'T3', 'lead', -1],
    // IFCN glossary: wickets are "spike-like monophasic surface negative" waves —
    // the sharp side of each arch is the negative one.
    ['wicket T3 (sharp side)',   'drowsy', 'wicket',         'T3', 'sharp', -1],
    // Surface-POSITIVE transients — named for their polarity, must point DOWN.
    ['POSTS O1',                 'awake', 'posts',           'O1', 'lead',  1],
    ['lambda O1',                'awake', 'lambda',          'O1', 'lead',  1],
    ['triphasic Fz (dominant)',  'awake', 'triphasic',       'Fz', 'lead',  1],
    // "14 & 6 Hz POSITIVE bursts" are named for their polarity: pos1406's
    // morphology now half-wave-emphasises its positive-going phase, so the sharp
    // comb-teeth are reliably surface-positive and render DOWN (A4 fix — see
    // variants.ts pos1406). State-gated to drowsiness/light sleep.
    ['14-6-pos T6',              'drowsy', '14-6-pos',        'T6', 'peak',  1],
  ];
  for (const [label, state, toggle, el, metric, want] of POLARITIES) {
    check(`${label} renders ${want < 0 ? 'UP  ' : 'DOWN'} (${want > 0 ? '+1' : '-1'})`,
      polarity(state, toggle, el, metric), want, want);
  }

  // The WAVE of a spike-and-wave run has its spike's polarity too (morphology.ts):
  // 110 ms after the sharpest point of a 3 Hz run — the top of the slow wave —
  // the trace is on the same side of the baseline as the spike.
  {
    const on = runEngineState(SECS, POL_OPTS, 'awake', ['3hz-gsw']);
    const off = runEngineState(SECS, POL_OPTS, 'awake', []);
    const i = on.eng.indexOf('Fz');
    const d = on.data[i].map((v, k) => v - off.data[i][k]);
    const lag = Math.round(0.11 * FS);
    let best = 0, at = 2;
    for (let k = 2; k < d.length - 2 - lag; k++) {
      const c = Math.abs(d[k] - (d[k - 2] + d[k + 2]) / 2);
      if (c > best) { best = c; at = k; }
    }
    check('3 Hz gen. spike-wave Fz: the wave after the spike renders UP too (-1; IK-012)', Math.sign(d[at + lag]), -1, -1);
  }
});

// --- 7b. Toggle latency. A freshly-enabled event source must
// put its first graphoelement on the screen promptly rather than after a full
// inter-event interval — a spike focus whose steady interval is 3-7 s should not
// leave the toggle looking dead for several seconds. FIRST_EVENT_LEAD compresses
// only that first wait; here we assert the first isolated event at T3 lands well
// under a second while the steady rate (asserted elsewhere) is untouched.

section('\nToggle latency:', () => {
  const OPTS: EngineOptions = { seed: 5, artifacts: false, recordingChain: false };
  const on = runEngineState(5, OPTS, 'awake', ['focal-spikes-lt']);
  const off = runEngineState(5, OPTS, 'awake', []);
  const i = on.eng.indexOf('T3');
  const n = on.data[0].length;
  let firstAt = -1;
  for (let k = 0; k < n; k++) {
    if (Math.abs(on.data[i][k] - off.data[i][k]) > 5) { firstAt = k; break; }
  }
  check('focal-spikes first event appears soon after enable (#13)',
    firstAt < 0 ? 99 : firstAt / FS, 0, 1.0, ' s');
});

// --- 8pre. The amplifier's low-pass must actually be a low-pass at its stated
// corner. This is a code-correctness assertion, not a clinical claim: it says only
// that a filter labelled `fc` is -3 dB at `fc`, which is what the label means.
//
// It exists because that was false for a long time. `AmplifierLowPass` used the
// impulse-invariant pole exp(-2*pi*fc*dt) with no feed-forward zero, which
// approximates an fc corner only while 2*pi*fc*dt << 1. At fs = 250 and the default
// fc = 100 that product is 2.51, and the resulting filter measured -0.4 dB at 40 Hz,
// -1.3 at 100 and just -1.4 dB at Nyquist — its true -3 dB point was off the top of
// the representable band, so a "100 Hz low-pass" removed essentially nothing. No
// IK- entry asserted anything about the high-frequency filter, which is exactly why
// it survived: nothing was guarding it. Driving the production class with sinusoids
// is deliberate — asserting on the coefficients would re-encode the bug's own
// assumption rather than test the behaviour.

section('\nAmplifier low-pass response (production class, driven with sinusoids):', () => {
  const magDb = (fc: number, f: number) => {
    const lp = new AmplifierLowPass(1 / FS, fc);
    const n = Math.round(FS * 40);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const y = lp.next(Math.sin(2 * Math.PI * f * i / FS));
      if (i > n * 0.5) peak = Math.max(peak, Math.abs(y));
    }
    return 20 * Math.log10(peak);
  };
  for (const fc of [35, 70, 100]) {
    check(`low-pass @ ${fc} Hz is -3 dB at its own corner`, magDb(fc, fc), -3.6, -2.5, ' dB');
  }
  // Flat in the band a reader actually works in...
  check('low-pass @ 70 Hz is flat at 10 Hz (passband untouched)', magDb(70, 10), -0.5, 0.01, ' dB');
  // ...and genuinely rolling off by Nyquist, which the old form never did.
  check('low-pass @ 70 Hz attenuates hard near Nyquist', magDb(70, 124), -80, -12, ' dB');
});

// --- 8. Recording chain: the line-noise peak must be present but imperfect, and
// a channel-independent sensor floor must exist.

section('\nRecording chain:', () => {
  const { eng, data } = runEngine(120, { seed: 7, subject: { lineAmp: 6, lineFreq: 50 } });
  const psd = welch(data[eng.indexOf('Cz')], FS, 4096);
  const at50 = spectralPeak(psd, 48, 52);
  check('mains peak present near 50 Hz', at50.freq, 49, 51, ' Hz');
  // Not a pure tone: §8 requires wandering frequency/amplitude and harmonics, so
  // the peak must have measurable width rather than sitting in a single bin.
  check('mains peak has non-zero width', at50.fwhm, 0.05, 6, ' Hz');
});

// --- 9. Inter-subject variability must actually vary (§12).

section('\nInter-subject variability:', () => {
  const iafs: number[] = [], exps: number[] = [];
  for (let s = 1; s <= 40; s++) {
    const p = sampleSubject(s);
    iafs.push(p.iaf); exps.push(p.exponent);
  }
  check('IAF spread across subjects (SD)', std(iafs), 0.5, 2.0, ' Hz');
  // Every sampled subject's PDR must land inside the normal ADULT band the
  // reference course gives, 8.5-12 Hz. Spread alone did not guard this: the
  // range used to start at 8.2, so ~9% of subjects carried a PDR below the
  // normal floor — an abnormally slow posterior rhythm labelled normal, which is
  // a finding a learner is specifically meant to detect.
  check('slowest sampled IAF (normal adult PDR floor, 8.5 Hz)', Math.min(...iafs), 8.5, 12, ' Hz');
  check('fastest sampled IAF (normal adult PDR ceiling, 12 Hz)', Math.max(...iafs), 8.5, 12, ' Hz');
  check('exponent spread across subjects (SD)', std(exps), 0.1, 0.5);
});

// --- 10. Overall plausibility at the electrode (§2 amplitude anchor, §4 band
// ordering). Alpha should exceed gamma by orders of magnitude; getting that
// ratio wrong (gamma too strong) is the classic tell (§12).

section('\nWhole-signal plausibility:', () => {
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
});

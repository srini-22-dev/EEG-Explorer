import { EegEngine } from '../../../artifacts/eeg-simulator/src/engine/engine';
import type { PatientState } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
import { welch, spectralPeak } from '../dsp';
import { toggle } from '../../../artifacts/eeg-simulator/src/utils/toggleRules';
import { FS, bandPower, check, corr, displayContrib, displayContribAll, pctP2p, runDisplay, section, step } from './harness';

// ---------------------------------------------------------------------------
step('\n=== Step 19: sleep grapho-elements in DISPLAY space (A3 audit) ===\n');

// Step 11 above asserts these same claims on raw electrodes. Repeated here on
// the montage-derived, negative-up channel (CLAUDE.md §4) because that space can
// disagree with the raw one even when every spectral check passes — e.g. a
// channel that sits near the common-average reference's own mean gain nearly
// cancels in reference-car while still carrying real signal (see K-complex/Pz,
// IK-A3-b): a spectral check on the raw electrode cannot see that.

section('Spindles (11-16 Hz, central-maximal), reference-car:', () => {
  const diff = displayContrib('reference-car', 'awake', 'spindles', 'Cz-AVG', 180, 20);
  const pk = spectralPeak(welch(diff, FS, 2048), 6, 25);
  check('spindle peak frequency, Cz-AVG', pk.freq, 11, 16, ' Hz');
  // 'spindle Cz-AVG p2p / O1-AVG p2p' (>= 3) moved to the ear reference 2026-09-11. With the
  // spindle now a regional field (Cz with both central and parietal regions, or frontal) rather
  // than a Cz point, the common average — the mean of 19 electrodes — contains a large share of
  // the spindle itself. Subtracting it shrinks Cz-AVG and hands O1-AVG the negated mean, so O1
  // appears to carry a spindle it does not have: 2.79, against 14.6 for the old point source.
  // The common average is the wrong reference for amplitude topography (read skill); A1 is not.
  const czA = pctP2p(displayContrib('reference-ipsi', 'awake', 'spindles', 'Cz-A1', 180, 20));
  const o1A = pctP2p(displayContrib('reference-ipsi', 'awake', 'spindles', 'O1-A1', 180, 20));
  check('spindle Cz-A1 p2p / O1-A1 p2p (central, not occipital)', czA / Math.max(o1A, 1e-6), 3, 1e6);
});

section('\nK-complex (sharp UP, then slower smaller DOWN), Cz-AVG reference-car:', () => {
  const diff = displayContrib('reference-car', 'awake', 'k-complex', 'Cz-AVG', 120, 20);
  let peak = 0, peakAt = 0;
  for (let k = 0; k < diff.length; k++) if (Math.abs(diff[k]) > Math.abs(peak)) { peak = diff[k]; peakAt = k; }
  check('K-complex sharp component renders UP (surface-negative)', peak, -Infinity, 0, ' uV');
  let slow = 0;
  const end = Math.min(diff.length, peakAt + Math.round(1.0 * FS));
  for (let k = peakAt; k < end; k++) if (diff[k] > slow) slow = diff[k];
  check('K-complex after-going wave renders DOWN, smaller than the sharp peak',
    slow / Math.abs(peak), 0.2, 0.9);
});

section('\nV-wave field on the double banana: down the parasagittal chains, little on the temporal ones:', () => {
  // learningeeg's vertex-wave figure: "symmetric discharge maximal over the parasagittal
  // and central chains", the wave on all four rows of each parasagittal chain; the owner
  // (2026-10-22): F4-C4 down, C4-P4 up, and a smaller wave the same way on Fp2-F4 and
  // P4-O2, and a smaller one again on the temporal chains. Read at the instant of the
  // largest Cz-Pz swing, each row's share of it, signed. The figure could not be read
  // row by row (fields.ts, VERTEX_FIELD), so these bounds are orderings, not figures:
  // the outer link carries the wave the same way as its neighbour and is smaller but
  // visible (0.3-0.95 of it), and the temporal chains carry under 0.6 of the parasagittal.
  const bip = displayContribAll('bipolar-ap', 'awake', 'v-waves', 120, 20);
  const ref = bip['Cz-Pz'];
  let t = 0;
  for (let i = 0; i < ref.length; i++) if (Math.abs(ref[i]) > Math.abs(ref[t])) t = i;
  const at = (row: string) => bip[row][t];
  for (const [outer, inner] of [['Fp2-F4', 'F4-C4'], ['P4-O2', 'C4-P4'], ['Fp1-F3', 'F3-C3'], ['P3-O1', 'C3-P3']] as const) {
    check(`v-waves ${outer} / ${inner} at the wave's peak (same way, smaller, visible)`, at(outer) / at(inner), 0.3, 0.95);
  }
  check('v-waves F4-C4 and C4-P4 deflect opposite ways (reversal at C4)', Math.sign(at('F4-C4')) * Math.sign(at('C4-P4')), -1, -1);
  check('v-waves F3-C3 and C3-P3 deflect opposite ways (reversal at C3)', Math.sign(at('F3-C3')) * Math.sign(at('C3-P3')), -1, -1);
  const big = (rows: string[]) => Math.max(...rows.map((r) => Math.abs(at(r))));
  check('v-waves largest temporal row / largest parasagittal row (smaller on the temporal chains)',
    big(['Fp1-F7', 'F7-T3', 'T3-T5', 'T5-O1', 'Fp2-F8', 'F8-T4', 'T4-T6', 'T6-O2'])
      / big(['Fp1-F3', 'F3-C3', 'C3-P3', 'P3-O1', 'Fp2-F4', 'F4-C4', 'C4-P4', 'P4-O2']), 0.1, 0.6);
});

section('\nV-wave: sharp, phase-reverses across Cz (IK-008), bipolar-ap:', () => {
  const fzCz = displayContrib('bipolar-ap', 'awake', 'v-waves', 'Fz-Cz', 120, 20);
  const czPz = displayContrib('bipolar-ap', 'awake', 'v-waves', 'Cz-Pz', 120, 20);
  let fzCzPeak = 0, czPzPeak = 0;
  for (const v of fzCz) if (Math.abs(v) > Math.abs(fzCzPeak)) fzCzPeak = v;
  for (const v of czPz) if (Math.abs(v) > Math.abs(czPzPeak)) czPzPeak = v;
  check('V-wave: Fz-Cz and Cz-Pz peaks have opposite sign (phase reversal at Cz)',
    Math.sign(fzCzPeak) * Math.sign(czPzPeak), -1, -1);
});

section('\nPOSTS: surface-positive; polarity is montage-dependent (§4/IK-008):', () => {
  const o1Car = displayContrib('reference-car', 'awake', 'posts', 'O1-AVG', 120, 20);
  let carPeak = 0;
  for (const v of o1Car) if (Math.abs(v) > Math.abs(carPeak)) carPeak = v;
  check('POSTS render DOWN at O1-AVG, reference-car (surface-positive)', carPeak, 0, Infinity, ' uV');

  const t5O1 = displayContrib('bipolar-ap', 'awake', 'posts', 'T5-O1', 120, 20);
  let bipPeak = 0;
  for (const v of t5O1) if (Math.abs(v) > Math.abs(bipPeak)) bipPeak = v;
  check('POSTS polarity inverts at T5-O1, bipolar-ap (O1 is input2)', bipPeak, -Infinity, 0, ' uV');
});

section('\nN3: high-amplitude (>75 uV) generalized delta (0.5-2 Hz), ear-referenced:', () => {
  // Moved from the common average to the ear reference 2026-09-11. Slow-wave sleep is
  // "synchronized" delta (learningeeg): a large part of it is common to every electrode, and a
  // common average removes exactly that part. The old model passed here only through a vertex
  // focus whose leakage into the average lifted every site — Cz-AVG 450 uV beside C3-AVG 97
  // on the same page; with synchronized, diffuse slow waves Pz-AVG read 70. The ear-referenced
  // channel keeps the synchronized part, as a clinical referential montage does.
  const ear = runDisplay('reference-ipsi', 'n3', [], 180, 42);
  // A spread of frontal/central/temporal/occipital/midline channels stands in
  // for "generalized" without asserting all 19.
  // The >75 uV criterion is the AASM's, and the AASM measures it over the FRONTAL regions,
  // referenced to the contralateral ear or mastoid. Until 2026-09-22 it was applied at every
  // site, citing "IK-A3-e", which names no entry; the posterior sites sat on the bound and
  // failed (Pz 71 uV) when the aperiodic floor was halved. "Generalized" — learningeeg's
  // "diffuse, synchronized, high amplitude delta" — is asserted at the other sites as delta
  // dominance instead: 0.5-2 Hz carries at least half of the 0.5-30 Hz power. That is a claim
  // of kind, and it has no microvolt figure because the sources give none.
  const frontal = ['Fp1-A1', 'Fz-A1'];
  const reps = [...frontal, 'C3-A1', 'Cz-A1', 'T5-A1', 'O1-A1', 'Pz-A1'];
  for (const label of reps) {
    const ci = ear.montage.channels.findIndex((c) => c.label === label);
    if (!frontal.includes(label)) {
      const x = ear.data[ci];
      const share = bandPower(x, 0.5, 2) / bandPower(x, 0.5, 30);
      check(`N3 ${label} 0.5-2 Hz share of 0.5-30 Hz power (generalized delta, learningeeg)`, share, 0.5, 1);
      continue;
    }
    check(`N3 ${label} p2p (AASM: >75 uV, frontal, ear-referenced)`, pctP2p(ear.data[ci]), 75, 500, ' uV');
  }
  const { montage, data } = runDisplay('reference-car', 'n3', [], 180, 42);
  const czIdx = montage.channels.findIndex((c) => c.label === 'Cz-AVG');
  const pk = spectralPeak(welch(data[czIdx], FS, 2048), 0.3, 4);
  check('N3 Cz-AVG dominant frequency', pk.freq, 0.5, 2, ' Hz');
});

// --- The descent into sleep ATTENUATES before it builds. The reference course
// describes N1 as "gradual loss of the PDR with coinciding diffuse attenuation
// of the tracing" — drowsiness and N1 are quiet states, the record getting
// smaller as alpha drops out. Only N3 is a high-amplitude state, and it is
// delta that makes it so ("high amplitude (>75 uV), synchronized delta activity,
// usually 0.5-2 Hz").
//
// Measured on a transient-robust statistic (inter-quartile range) rather than
// RMS or peak-to-peak, because N1 and N2 carry discrete high-amplitude events —
// POSTS, vertex waves, K-complexes — that legitimately belong there and would
// mask the background they ride on. The claim is about the BACKGROUND; the
// transients are asserted separately above.
//
// STATE_GAINS previously ran background 1.00 -> 1.10 -> 1.20 -> 1.35 -> 1.60,
// making every step louder than the last and taking display-space row RMS from
// 8.3 uV awake to 15.7 in N1 — the tracing nearly doubling through the one
// transition the course calls an attenuation.

section('\nSleep-state amplitude envelope (display space, bipolar-ap):', () => {
  const bgIqr = (state: PatientState) => {
    const { montage, data } = runDisplay('bipolar-ap', state, [], 120, 5);
    // Centro-posterior rows only, deliberately. The frontopolar rows carry the
    // slow roving eye movements that drowsiness and N1 bring with them (see the
    // block below), which are an ocular phenomenon riding ON the background, not
    // the background itself — averaging them in measured drowsy as 1.20x awake
    // when its cerebral background had in fact fallen to 0.91x. These rows are
    // also where the loss of the PDR is most legible.
    const rows = ['C3-P3', 'P3-O1', 'C4-P4', 'P4-O2'];
    const each = rows.map((label) => {
      const x = Array.from(data[montage.channels.findIndex((c) => c.label === label)]).sort((a, b) => a - b);
      return x[Math.floor(0.75 * x.length)] - x[Math.floor(0.25 * x.length)];
    });
    return each.reduce((a, b) => a + b, 0) / each.length;
  };
  const awake = bgIqr('awake'), drowsy = bgIqr('drowsy');
  const n1 = bgIqr('n1'), n2 = bgIqr('n2'), n3 = bgIqr('n3');
  check('drowsy background / awake (drowsiness attenuates, not amplifies)', drowsy / awake, 0.6, 1.0);
  check('N1 background / awake (diffuse attenuation of the tracing)', n1 / awake, 0.5, 1.0);
  check('N1 background / drowsy (N1 is the quietest state, not louder)', n1 / drowsy, 0.5, 1.05);
  check('N3 background / N2 (N3 clearly exceeds N2)', n3 / n2, 2.0, 8.0);
  // N3 is the one state that is genuinely high-amplitude, and by a wide margin — asserted
  // where AASM scores slow waves: frontal, referential (F4-M1 / F3-M2; the ear stands in for
  // the mastoid here). Until 2026-09-14 this was measured on the centro-posterior BIPOLAR
  // rows above. Slow waves are synchronized, so neighbouring electrodes carry much the same
  // delta and a bipolar link between them cancels most of it: once N3's delta stopped being
  // a vertex focus (SLEEP-ARCHITECTURE-AUDIT.md) that ratio read 2.35 on a record whose
  // frontal slow-wave activity meets AASM's N3 criterion with room to spare.
  const frontalIqr = (state: PatientState) => {
    const { montage, data } = runDisplay('reference-ipsi', state, [], 120, 5);
    const each = ['F3-A1', 'F4-A2'].map((label) => {
      const x = Array.from(data[montage.channels.findIndex((c) => c.label === label)]).sort((a, b) => a - b);
      return x[Math.floor(0.75 * x.length)] - x[Math.floor(0.25 * x.length)];
    });
    return (each[0] + each[1]) / 2;
  };
  check('N3 background / N1, frontal ear-referenced (AASM derivation)', frontalIqr('n3') / frontalIqr('n1'), 3.0, 12.0);
});

// --- Slow roving eye movements, the ocular marker of drowsiness and N1. The
// reference course names them in both the awake chapter ("decreased eye blinks
// and roving eye movements ... very slow opposing undulations of the bilateral
// frontal regions") and the sleep chapter ("slow roving eye movements"). The
// simulator had no source for them at all until 2026-08-28.
//
// Three things make them what they are, and each is asserted: they OPPOSE across
// the midline (a horizontal corneo-retinal dipole is positive at one lateral
// frontal electrode and negative at the other), they are VERY SLOW, and they
// belong to the state rather than to a toggle.

section('\nSlow roving eye movements (display space, bipolar-ap):', () => {
  const L = displayContrib('bipolar-ap', 'awake', 'roving-eyes', 'Fp1-F7', 180, 11);
  const R = displayContrib('bipolar-ap', 'awake', 'roving-eyes', 'Fp2-F8', 180, 11);
  // Bound just past -1 for the same floating-point reason as the IK-003 pairs.
  check('roving-eyes: Fp1-F7 vs Fp2-F8 correlation (opposing across the midline)',
    corr(L, R), -1.0001, -0.5);
  // Slower than anything cerebral, and slower than a saccade or a REM movement.
  check('roving-eyes peak frequency (very slow roving, not a saccade)',
    spectralPeak(welch(L, FS, 8192), 0.05, 3).freq, 0.12, 0.6, ' Hz');
  // State-intrinsic: drowsiness produces them with no toggle set.
  const p2pOf = (state: PatientState) => {
    const { montage, data } = runDisplay('bipolar-ap', state, [], 180, 11);
    return pctP2p(data[montage.channels.findIndex((c) => c.label === 'Fp1-F7')]);
  };
  check('roving-eyes appear in drowsy with no toggle (state-intrinsic), vs awake',
    p2pOf('drowsy') / p2pOf('awake'), 1.8, 20);
});

// --- REM. The reference course gives it a background that deliberately does NOT
// identify it — "diffuse attenuation of amplitudes, with a range of frequencies
// amongst the background", i.e. a low-voltage mixed-frequency record that looks
// like N1 — and two features that do: rapid eye movements, "sharply contoured,
// opposing left and right frontal waveforms" with "a faster upslope than
// downslope", and muscle tone that "should be near-absent throughout this
// stage". All three are asserted.

section('\nREM sleep (display space, bipolar-ap):', () => {
  const bgIqr = (state: PatientState) => {
    const { montage, data } = runDisplay('bipolar-ap', state, [], 180, 11);
    const each = ['C3-P3', 'P3-O1', 'C4-P4', 'P4-O2'].map((label) => {
      const x = Array.from(data[montage.channels.findIndex((c) => c.label === label)]).sort((a, b) => a - b);
      return x[Math.floor(0.75 * x.length)] - x[Math.floor(0.25 * x.length)];
    });
    return each.reduce((a, b) => a + b, 0) / each.length;
  };
  // Attenuated like N1, and clearly below wakefulness — the "paradoxical" part
  // is that this says nothing on its own, which is why the two checks after it
  // are the ones that actually identify the stage.
  check('REM background / awake (diffuse attenuation)', bgIqr('rem') / bgIqr('awake'), 0.4, 1.0);

  const L = displayContrib('bipolar-ap', 'awake', 'rem-eyes', 'Fp1-F7', 180, 11);
  const R = displayContrib('bipolar-ap', 'awake', 'rem-eyes', 'Fp2-F8', 180, 11);
  check('rem-eyes: Fp1-F7 vs Fp2-F8 correlation (opposing across the midline)',
    corr(L, R), -1.0001, -0.5);
  // "Faster upslope than downslope", measured on the largest excursion: time
  // from 10% of peak up to the peak, against peak back down to 10%.
  let pi = 0;
  for (let i = 0; i < L.length; i++) if (Math.abs(L[i]) > Math.abs(L[pi])) pi = i;
  const pk = L[pi], thr = 0.1 * Math.abs(pk);
  let a = pi; while (a > 0 && Math.abs(L[a]) > thr && Math.sign(L[a]) === Math.sign(pk)) a--;
  let b = pi; while (b < L.length - 1 && Math.abs(L[b]) > thr && Math.sign(L[b]) === Math.sign(pk)) b++;
  check('rem-eyes fall / rise duration (faster upslope than downslope)',
    (b - pi) / Math.max(pi - a, 1), 1.5, 8);

  // Atonia, measured as the MUSCLE-ATTRIBUTABLE 20-70 Hz power (same seed, emg
  // gated on minus off) rather than total high-frequency power: the aperiodic
  // background occupies that band too and would mask the effect — measured
  // against total power REM/N2 reads 0.81 while the muscle term itself is a
  // small fraction of N2's.
  const emgPower = (state: PatientState) => {
    const mk = (emg: boolean) => {
      const eng = new EegEngine({ seed: 9, subject: { artifactBurden: 1.2, alphaRms: 12, lineAmp: 0 } });
      eng.setArtifactGates({ blink: false, eyeOpening: false, saccade: false, emg,
        pop: false, sweat: false, line: false, ecgScalp: false, movement: false });
      eng.setPatientState(state);
      const n = Math.floor(120 * FS), buf = new Float64Array(eng.electrodes.length);
      const iT3 = eng.indexOf('T3'), out = new Float64Array(n);
      for (let i = 0; i < n; i++) { eng.next(buf); out[i] = buf[iT3]; }
      return out;
    };
    const on = mk(true), off = mk(false);
    const d = new Float64Array(on.length);
    for (let i = 0; i < on.length; i++) d[i] = on[i] - off[i];
    return bandPower(d, 20, 70);
  };
  check('REM muscle / N2 muscle at T3 (REM atonia: near-absent muscle)',
    emgPower('rem') / emgPower('n2'), 0, 0.25);
});

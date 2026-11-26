import { welch, spectralPeak } from '../dsp';
import { FS, check, displayContrib, pctP2p, runDisplay, section, step, winPower } from './harness';

step('\n=== Step 22: ictal in DISPLAY space (A7 audit) ===\n');

// Step 16 already checks the ictal sources referentially (raw electrode
// space). A seizure's diagnosis is its EVOLUTION, and CLAUDE.md §4 requires
// that be verified on the montage-derived, common-average-referenced channel
// a reader actually looks at, not just as a spectral scalar on the raw
// electrode. This section repeats the frequency-evolution and field claims in
// that display space.

section('Absence (display space, reference-car): peak frequency lands in the typical 3 Hz band (LEARNINGEEG §12: "3 Hz generalised spike-wave"), frontal-max but still generalised:', () => {
  // absence-ictal has no gate(), so on-minus-off isolates its own contribution
  // cleanly. ABSENCE_DELAY is 4 s and the shortest possible epoch is 5 s
  // (ictal.ts: `dur = g.range(5, 15)`), so a 4.5-8 s window is inside the
  // discharge for every seed.
  const fz = displayContrib('reference-car', 'awake', 'absence-ictal', 'Fz-AVG', 12, 7);
  const fzWin = fz.subarray(Math.floor(4.5 * FS), Math.floor(8 * FS));
  const pk = spectralPeak(welch(fzWin, FS, 512), 2, 4);
  check('absence Fz-AVG discharge peak frequency (typical: 2.5-3.5 Hz, not atypical)', pk.freq, 2.5, 3.5, ' Hz');

  // Generalised-but-frontal: O1-AVG must still carry real 2.5-3.5 Hz power
  // (this is a generalised discharge, not an isolated frontal focus), and
  // less of it than Fz-AVG (frontal predominance survives the CAR transform).
  const o1 = displayContrib('reference-car', 'awake', 'absence-ictal', 'O1-AVG', 12, 7);
  const o1Win = o1.subarray(Math.floor(4.5 * FS), Math.floor(8 * FS));
  const o1Pow = winPower(o1Win, 2.5, 3.5);
  check('absence O1-AVG carries real 2.5-3.5 Hz power (generalised field reaches occiput)',
    o1Pow, 1, 1e6, ' uV^2');
  // Frontal predominance is read on an EAR reference, not the common average.
  // This used to be `Fz-AVG / O1-AVG ... (frontal-max survives CAR)`, and it does
  // not survive: the average of a generalized discharge IS the discharge, so
  // subtracting it hands the occiput an inverted copy about as large as what is
  // left at Fz (measured 0.96 once the field was generalized, 2026-10-12). The old
  // check passed only while the "generalized" discharge was a frontal-midline
  // focus too small to move the average. ACNS 2021 §C.1.a names the ipsilateral
  // ear for this judgement, and "frontally predominant" is a 50% voltage excess —
  // 2.25 in power.
  {
    const win = (label: string) => displayContrib('reference-ipsi', 'awake', 'absence-ictal', label, 12, 7)
      .subarray(Math.floor(4.5 * FS), Math.floor(8 * FS));
    check('absence Fz-A1 / O1-A1 2.5-3.5 Hz power, reference-ipsi (ACNS: frontally predominant from 2.25)',
      winPower(win('Fz-A1'), 2.5, 3.5) / winPower(win('O1-A1'), 2.5, 3.5), 2.25, Infinity);
  }

  // IK-017: absence returns INSTANTLY to baseline at offset — no post-ictal
  // slowing. A prior port added a ~2 s fading delta burst after each discharge;
  // that oscillatory 0.8-2.1 Hz tail is a clinical error (real absence has none)
  // and is removed. Verify no oscillatory delta survives into the post-offset
  // gap. NOTE: the amplifier high-pass (chain.ts) leaves a MONOTONIC baseline-
  // recovery tail after the discharge's net-DC offset — that is a legitimate,
  // universal display-chain artifact, not post-ictal slowing. welch subtracts
  // the per-segment mean, so it rejects that monotonic decay and measures only
  // the OSCILLATORY 1-2.5 Hz band, which is exactly what the removed fade was
  // and the recovery tail is not. Detect the first discharge's offset (last
  // 0.5 s bin whose RMS clears the discharge threshold), then read 2.6 s just
  // past it. With the fade the band held >=3.6 uV^2; without it, ~0.
  const isoAbs = displayContrib('reference-car', 'awake', 'absence-ictal', 'Fz-AVG', 24, 7);
  const binRms = (t0: number, t1: number) => {
    const s = isoAbs.subarray(Math.floor(t0 * FS), Math.floor(t1 * FS));
    let sum = 0;
    for (const v of s) sum += v * v;
    return Math.sqrt(sum / s.length);
  };
  let offset = 4;
  for (let t = 4; t < 20; t += 0.5) if (binRms(t, t + 0.5) > 30) offset = t + 0.5;
  const postOffset = isoAbs.subarray(Math.floor((offset + 0.3) * FS), Math.floor((offset + 2.9) * FS));
  check('absence has NO post-ictal oscillatory delta (instant recovery, IK-017)',
    winPower(postOffset, 1, 2.5), 0, 2, ' uV^2');
});

section('\nGTC (display space, reference-car): recruiting -> clonic slowing -> post-ictal suppression:', () => {
  // gtc-ictal defines gate(), which scales the WHOLE background (engine.ts's
  // neuralGate), not just this generator's own output — an on-minus-off diff
  // would net out the very suppression being measured. Read the raw on-run
  // instead, exactly as Step 16's raw-space check does, through the montage/
  // CAR transform. GTC_DELAY = 6 s, so absolute time = 6 + cycle: the tonic
  // phase is t in [6,16), clonic [16,61), suppression [61,96).
  const gt = runDisplay('reference-car', 'awake', ['gtc-ictal'], 92, 11);
  const fzIdx = gt.montage.channels.findIndex((c) => c.label === 'Fz-AVG');
  const slice = (ch: number, t0: number, t1: number) =>
    gt.data[ch].subarray(Math.floor(t0 * FS), Math.floor(t1 * FS));

  // gate()==1 until the clonic phase ends, so on-minus-off cleanly
  // isolates the recruiting rhythm's own contribution here — unlike the
  // suppression checks below, nothing is confounded by scaling the background.
  // A ratio against the raw run's own delta band (as opposed to this isolated
  // diff) is unstable: awake background is 1/f-shaped, so ambient low-frequency
  // power alone can rival a still-building (env 0.45 -> 1) beta rhythm —
  // the isolated diff sidesteps that floor entirely. The recruiting rhythm's
  // BETA_TONES carrier runs at freqScale 1.2 (a fixed multiplier, not a sweep),
  // so — unlike the focal-temporal/frontal chirps below — spectralPeak's single
  // dominant bin is a fair read here: the 14.2 Hz tone (amplitude 1.0, the
  // tallest in BETA_TONES) scales to ~17 Hz.
  const gtcContrib = displayContrib('reference-car', 'awake', 'gtc-ictal', 'Fz-AVG', 17, 11);
  const recruitWin = gtcContrib.subarray(Math.floor(8 * FS), Math.floor(15.5 * FS));
  const recruitPeak = spectralPeak(welch(recruitWin, FS, 512), 10, 32);
  check('GTC Fz-AVG recruiting contribution p2p (fast recruiting rhythm, isolated)',
    pctP2p(recruitWin), 10, 200, ' uV');
  check('GTC Fz-AVG recruiting contribution peak frequency (beta-range, ~17 Hz)',
    recruitPeak.freq, 14, 22, ' Hz');

  // Clonic slowing 3 -> 1.5 Hz, read as a spectral-peak drop between an early
  // and a late 3 s window inside the clonic phase.
  const early = spectralPeak(welch(slice(fzIdx, 17, 20), FS, 512), 1, 4);
  const late = spectralPeak(welch(slice(fzIdx, 56.5, 59.5), FS, 512), 1, 4);
  check('GTC Fz-AVG clonic peak frequency, early window', early.freq, 2.2, 3.2, ' Hz');
  check('GTC Fz-AVG clonic peak frequency, late window (slows toward 1.5 Hz)', late.freq, 1.2, 2.2, ' Hz');
  check('GTC Fz-AVG clonic peak frequency, early / late (organised slowing)', early.freq / late.freq, 1.15, 1e6);

  // Generalised: the clonic discharge must be scalp-visible beyond Fz, at Cz —
  // read against the ear. On the common average Cz sits almost exactly on the mean
  // of a generalized field and is nearly nulled (read skill: "not reference-car for
  // amplitude topography"); the same seizure measured 1.55 there against a floor of
  // 1.5 while Cz-A1 carried several times its background.
  {
    const ear = runDisplay('reference-ipsi', 'awake', ['gtc-ictal'], 32, 11);
    const cz = ear.data[ear.montage.channels.findIndex((c) => c.label === 'Cz-A1')];
    const p2p = (t0: number, t1: number) => pctP2p(cz.subarray(Math.floor(t0 * FS), Math.floor(t1 * FS)));
    check('GTC Cz-A1 clonic / pre-ictal p2p, reference-ipsi (generalised field reaches Cz)', p2p(20, 30) / p2p(0, 5), 1.5, 1e6);
  }

  // Post-ictal suppression: near-flat against the clonic discharge, on the
  // display-space channel — the display-space pin for the raw-space check
  // already covering IK's "post-ictal attenuation, not silence".
  const clonicP2p = pctP2p(slice(fzIdx, 17, 60));
  const suppP2p = pctP2p(slice(fzIdx, 70, 90));
  check('GTC Fz-AVG post-ictal / clonic p2p (display-space suppression)', suppP2p / clonicP2p, 0, 0.4);
});

section('\nGTC muscle artifact (the option on): throughout the tonic phase, a burst with each jerk, none after:', () => {
  // learningeeg, Seizures: the tonic phase "on EEG appears as significant and usually
  // diffuse myogenic artifact", then "intermittent bursts of spike / polyspike and
  // slow waves, with each spike burst corresponding to the clonic jerks". Its
  // Artifacts chapter has muscle "minimal at vertex". Read as the difference between
  // the same seizure with its muscle and without, so that only the muscle is
  // measured. Script time: tonic 6-16 s, clonic 16-61 s, suppressed after.
  const withMuscle = runDisplay('bipolar-ap', 'awake', ['gtc-ictal'], 80, 11, { seizureMuscle: true });
  const alone = runDisplay('bipolar-ap', 'awake', ['gtc-ictal'], 80, 11);
  const off = runDisplay('bipolar-ap', 'awake', [], 80, 11);
  const labels = alone.montage.channels.filter((c) => c.group !== 'ecg').map((c) => c.label);
  const at = (label: string) => alone.montage.channels.findIndex((c) => c.label === label);
  const muscle = (label: string) => withMuscle.data[at(label)].map((v, i) => v - alone.data[at(label)][i]);
  const seizure = (label: string) => alone.data[at(label)].map((v, i) => v - off.data[at(label)][i]);
  const rmsIn = (x: Float64Array, t0: number, t1: number) => {
    const w = x.subarray(Math.floor(t0 * FS), Math.floor(t1 * FS));
    return Math.sqrt(w.reduce((a, v) => a + v * v, 0) / w.length);
  };
  check('GTC muscle / seizure rhythm RMS on T3-T5, tonic phase (LEARNINGEEG: "significant ... myogenic artifact")',
    rmsIn(muscle('T3-T5'), 8, 15) / rmsIn(seizure('T3-T5'), 8, 15), 1, 50);
  const tonic = labels.map((l) => rmsIn(muscle(l), 8, 15));
  check('GTC muscle: rows carrying at least a quarter of the largest row, tonic phase, of 18 (LEARNINGEEG: "usually diffuse")',
    tonic.filter((v) => v >= 0.25 * Math.max(...tonic)).length, 10, 18);
  check('GTC muscle on Cz-Pz / on T3-T5, tonic phase (LEARNINGEEG: muscle is "minimal at vertex")',
    rmsIn(muscle('Cz-Pz'), 8, 15) / rmsIn(muscle('T3-T5'), 8, 15), 0, 0.35);

  // Clonic: the muscle's envelope (rectified, smoothed over 40 ms) on T3-T5.
  const m = muscle('T3-T5');
  const env = new Float64Array(m.length);
  const half = Math.round(0.02 * FS);
  for (let i = 0; i < m.length; i++) {
    let a = 0, k = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(m.length - 1, i + half); j++) { a += Math.abs(m[j]); k++; }
    env[i] = a / k;
  }
  const clonic = Array.from(env.subarray(20 * FS, 50 * FS)).sort((a, b) => a - b);
  const high = clonic[Math.floor(clonic.length * 0.95)];
  check('GTC muscle: share of the clonic phase with the muscle let go (under 15% of its bursts)',
    clonic.filter((v) => v < 0.15 * high).length / clonic.length, 0.35, 0.85);
  // One burst to a jerk: counted where the envelope rises through 30% of its bursts'
  // height, and held to the bounds the discharge's own rate is held to above.
  const burstsPerSec = (t0: number, t1: number) => {
    let n = 0, up = false, last = -Infinity;
    for (let i = Math.floor(t0 * FS); i < Math.floor(t1 * FS); i++) {
      const hit = env[i] > 0.3 * high;
      if (hit && !up && i - last > 0.15 * FS) { n++; last = i; }
      up = hit;
    }
    return n / (t1 - t0);
  };
  check('GTC muscle bursts per second, early clonic (one to a jerk: ~3)', burstsPerSec(17, 23), 2.2, 3.2, ' /s');
  check('GTC muscle bursts per second, late clonic (slowing with the jerks: ~1.5)', burstsPerSec(53.5, 59.5), 1.2, 2.2, ' /s');
  check('GTC muscle RMS on T3-T5 after the seizure (flaccid: none)', rmsIn(m, 62, 80), 0, 0.01, ' uV');
});

section('\nFocal temporal (display space, reference-car T3-AVG): onset theta evolves 6 -> 3.5 Hz:', () => {
  // No gate() on this source, so on-minus-off isolates cleanly. FTEMP_DELAY=5,
  // FTEMP_ACTIVE=30 -> active window is absolute t in [5,35). Early window
  // sits just after onset (small amplitude, near f0); late window sits just
  // before the discharge ends (large amplitude, near f1) — never `sin(2*pi*
  // f(t)*t)`, the sweep comes from `sweepPhase`'s phase integral (morphology.ts).
  //
  // NOT read via spectralPeak's single dominant bin: THETA_TONES weights its
  // components unevenly (4.3 Hz carries amplitude 1.0, 7.2 Hz only 0.7), so the
  // component the sweep scales up to a high frequency is never the tallest bin
  // in the spectrum, and the tallest-bin frequency undershoots the true sweep
  // endpoint at BOTH ends. Step 16's raw-space "ictal frequency knob" check hits
  // the identical multi-tone-sweep shape and reads it as a band-power SWAP
  // instead (validateEngine.ts, "T3 low/high band ratio") — mirrored here.
  const t3 = displayContrib('reference-car', 'awake', 'focal-temporal-ictal', 'T3-AVG', 40, 13);
  const earlyWin = t3.subarray(Math.floor(6 * FS), Math.floor(9 * FS));
  const lateWin = t3.subarray(Math.floor(31 * FS), Math.floor(34 * FS));
  const earlyRatio = winPower(earlyWin, 4.8, 8) / winPower(earlyWin, 2.5, 4);
  const lateRatio = winPower(lateWin, 4.8, 8) / winPower(lateWin, 2.5, 4);
  check('focal-temporal T3-AVG onset high/low(4.8-8/2.5-4 Hz) band ratio (power sits high, near 6 Hz)',
    earlyRatio, 2, 1e6);
  check('focal-temporal T3-AVG late high/low(4.8-8/2.5-4 Hz) band ratio (power shifts low, toward 3.5 Hz)',
    lateRatio, 0, 1);
  check('focal-temporal T3-AVG onset / late band-ratio (evolution, not a static rhythm)',
    earlyRatio / lateRatio, 3, 1e6);
});

section('\nFocal frontal (display space, reference-car F3-AVG): low-voltage-fast onset evolves 18 -> 3 Hz:', () => {
  // FFRONT_DELAY=5, FFRONT_ACTIVE=15 -> active window is absolute t in [5,20).
  // Same evolution requirement as the temporal source above, scaled to the
  // frontal source's much shorter, more explosive timeline.
  const f3 = displayContrib('reference-car', 'awake', 'focal-frontal-ictal', 'F3-AVG', 25, 17);
  const early = spectralPeak(welch(f3.subarray(Math.floor(6 * FS), Math.floor(9 * FS)), FS, 512), 2, 25);
  const late = spectralPeak(welch(f3.subarray(Math.floor(15.5 * FS), Math.floor(18.5 * FS)), FS, 512), 2, 25);
  check('focal-frontal F3-AVG onset peak frequency (low-voltage FAST, near 18 Hz)', early.freq, 10, 22, ' Hz');
  check('focal-frontal F3-AVG late peak frequency (evolved down toward 3 Hz)', late.freq, 2, 9, ' Hz');
  check('focal-frontal F3-AVG onset / late peak frequency (evolves DOWN, the FLE hallmark)',
    early.freq / late.freq, 1.5, 1e6);
});

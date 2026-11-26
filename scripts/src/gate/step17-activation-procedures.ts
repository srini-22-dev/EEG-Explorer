import { SLEEP_OPTS, bandPower, base, check, runEngineState, section, step, win, winPower } from './harness';

step('\n=== Step 17: activation procedures (pattern sources) ===\n');

// Both activation sources are scripted procedures whose clock starts when the
// toggle is switched on, so every window below is measured from t = 0 of a run
// that has the toggle on from the first sample. The photic series steps every
// 9 s (6 s train + 3 s rest) through 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 25,
// 30 Hz — so step i occupies [9i, 9i+6) of flashing followed by [9i+6, 9i+9) of
// rest. The windows are trimmed by ~1 s at each end to clear the train's ramp.

section('Photic driving (occipital, flash-locked, frequency-tuned):', () => {
  const p = runEngineState(120, SLEEP_OPTS, 'awake', ['photic']);
  // Step 7 = 14 Hz, flashing 63-69 s. Sits above the alpha band, so a rise here
  // cannot be the posterior rhythm.
  const on14 = (name: string) => winPower(win(p, name, 64, 68.5), 13, 15);
  const off14 = (name: string) => winPower(win(base, name, 64, 68.5), 13, 15);
  check('O1 13-15 Hz during 14 Hz train, on / off', on14('O1') / off14('O1'), 3, 1e6);
  // Occipital: the driving response is a posterior finding, not a generalised one.
  check('O1 / Cz 13-15 Hz during 14 Hz train (occipital)', on14('O1') / on14('Cz'), 1.5, 1e6);
  // Symmetric: a persistently lateralised driving response is the abnormality,
  // so the two occipital electrodes must be within a factor of ~1.4 of each other.
  check('O1 / O2 driving power (symmetry)', on14('O1') / on14('O2'), 0.7, 1.4);
  // Flash-locked: at the 18 Hz step (81-87 s) the response moves with the lamp.
  const o1at18 = winPower(win(p, 'O1', 82, 86.5), 17, 19);
  const o1at18Low = winPower(win(p, 'O1', 82, 86.5), 13, 15);
  check('O1 17-19 / 13-15 Hz during 18 Hz train (tracks flash rate)',
    o1at18 / o1at18Low, 1.5, 1e6);
  // Intermittent: the rest gap after the 14 Hz train (69-72 s) is quiet again.
  check('O1 13-15 Hz in the rest gap, on / off',
    winPower(win(p, 'O1', 69.5, 71.8), 13, 15) / winPower(win(base, 'O1', 69.5, 71.8), 13, 15),
    0.5, 1.6);
  // Frequency-tuned: a normal subject shows little or no driving at 2 Hz
  // (step 1, 9-15 s), where the delta background dwarfs anything the lamp adds.
  check('O1 1.5-2.5 Hz during 2 Hz train, on / off',
    winPower(win(p, 'O1', 10, 14.5), 1.5, 2.5) / winPower(win(base, 'O1', 10, 14.5), 1.5, 2.5),
    0.5, 1.6);
});

section('\nHyperventilation build-up (generalised slowing, builds then resolves):', () => {
  // 180 s of overbreathing, 60 s of recovery, 30 s of rest before it repeats.
  const h = runEngineState(270, SLEEP_OPTS, 'awake', ['hyperventilation']);
  // `base` is only 180 s long and the recovery windows run past that, so this
  // block needs its own same-seed, same-length control run.
  const hBase = runEngineState(270, SLEEP_OPTS, 'awake', []);
  const slow = (r: typeof base, name: string, t0: number, t1: number) =>
    bandPower(win(r, name, t0, t1), 2, 7);
  // (1) It BUILDS: the last minute of the procedure carries far more slowing
  // than the first, which is what distinguishes a build-up from a source that
  // simply switches on.
  const early = slow(h, 'Fz', 10, 60);
  const late = slow(h, 'Fz', 120, 180);
  check('Fz 2-7 Hz late / early in the procedure (build-up)', late / early, 2, 1e6);
  // (2) It RESOLVES: a minute after stopping, the background is back to baseline.
  check('Fz 2-7 Hz after recovery, on / off',
    slow(h, 'Fz', 245, 270) / slow(hBase, 'Fz', 245, 270), 0.6, 1.5);
  // (3) FRONTAL predominance in adults: larger at Fz than occipitally.
  check('Fz / O1 2-7 Hz at full build-up (frontal)',
    late / slow(h, 'O1', 120, 180), 1.2, 1e6);
  // (4) Theta FIRST, delta as it deepens: the delta-to-theta balance shifts
  // through the procedure rather than staying fixed. Measured on the source's
  // OWN contribution (on minus off, same seed) — the raw ratio is useless here
  // because a 1/f background already carries more 1.5-3.5 Hz power than
  // 4.5-6.5 Hz, which swamps the effect at the shallow end of the build-up.
  // Compared mid-procedure against full build-up rather than from the first
  // seconds, where the contribution is too small to divide by safely.
  const dtRatio = (t0: number, t1: number) => {
    const c = (lo: number, hi: number) =>
      bandPower(win(h, 'Fz', t0, t1), lo, hi) - bandPower(win(hBase, 'Fz', t0, t1), lo, hi);
    return c(1.5, 3.5) / c(4.5, 6.5);
  };
  check('Fz delta/theta contribution, full / mid build-up (theta first, then delta)',
    dtRatio(120, 180) / dtRatio(60, 120), 1.5, 1e6);
  // (5) The alpha rhythm is ATTENUATED, not abolished — a normal build-up does
  // not mean loss of the PDR (contrast `gen-slowing`, which takes alpha to 0.15).
  check('O1 alpha power at full build-up, on / off',
    bandPower(win(h, 'O1', 120, 180), 8, 12) / bandPower(win(hBase, 'O1', 120, 180), 8, 12),
    0.15, 0.85);
});

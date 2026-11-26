import { EegEngine } from '../../../artifacts/eeg-simulator/src/engine/engine';
import { FS, SLEEP_OPTS, bandPower, base, baseCzP2p, baseCzSigma, check, contrib, contribPeak, cz, o1c, pctP2p, runEngineState, section, step } from './harness';

// ---------------------------------------------------------------------------
step('\n=== Step 11: sleep grapho-elements (pattern sources) ===\n');

section('Spindles (11-16 Hz, vertex-maximal, N2):', () => {
  const s = runEngineState(180, SLEEP_OPTS, 'awake', ['spindles']);
  const czSigma = bandPower(cz(s.data, s.eng), 12, 15);
  // Toggle raises sigma-band power at the vertex well above the spindle-free
  // background, and the spindle's own sigma contribution is central, not occipital.
  check('Cz sigma power, spindles on / off', czSigma / baseCzSigma(), 3, 1e6);
  check('sigma contribution O1 / Cz (vertex-focal)', contrib(s, 'O1', 12, 15) / contrib(s, 'Cz', 12, 15), -0.1, 0.3);
  // The ratio above is sigma-band power against sigma-band power, so it would
  // pass just as happily with the tones at 20 Hz — nothing here asserted the
  // FREQUENCY. A spindle is defined as 11-16 Hz, so search a band wide enough
  // that the answer is not assumed (6-25 Hz) and require the peak to land inside
  // the clinical definition. The tone set (12.3 / 13.5 / 14.8 Hz) sits in the
  // upper half of that on purpose: this source is anchored at Cz, and the
  // vertex/centroparietal spindle is the FAST subtype at 13-15 Hz. The slow
  // 11-13 Hz subtype is frontal and would need its own source.
  check('spindle peak frequency at Cz', contribPeak(s, 'Cz', 6, 25), 11, 16, ' Hz');
});

section('\nVertex sharp waves (central, sharp, N1/N2):', () => {
  const v = runEngineState(180, SLEEP_OPTS, 'awake', ['v-waves']);
  // 'Cz p2p, v-waves on / off' (>= 1.4) was replaced 2026-09-11. It compared the 1st-99th
  // percentile p2p with the waves on and off, and a transient on the page a few percent of the
  // time moves those percentiles by how LONG it lasts as much as by how big it is: the old
  // 250 ms rounded half-sine read 1.82, the ~100 ms sharp wave StatPearls describes reads 1.34
  // at a similar peak. AASM asks for a wave "distinguishable from the background", so the
  // wave's own peak (same seed, on minus off) is compared with the background's p2p instead.
  const on = cz(v.data, v.eng), off = cz(base.data, base.eng);
  let peak = 0;
  for (let i = 0; i < on.length; i++) peak = Math.max(peak, Math.abs(on[i] - off[i]));
  check('Cz: v-wave isolated peak / background p2p (AASM: distinguishable from the background)', peak / baseCzP2p(), 1, 50);
  // Its own low-band energy is central.
  check('low-freq contribution O1 / Cz (central-max)', contrib(v, 'O1', 1, 6) / contrib(v, 'Cz', 1, 6), -0.2, 0.5);
});

section('\nK-complexes (large biphasic, frontal maximum, N2):', () => {
  const k = runEngineState(180, SLEEP_OPTS, 'awake', ['k-complex']);
  // Three checks were replaced 2026-09-11: 'Cz p2p, k-complex on / off' (>= 1.8), 'Cz p2p,
  // k-complex (sanity floor)' (90-700 uV) and 'Cz p2p / O1 p2p (frontocentral)' (>= 1.5), which
  // read 4.45, 248 uV and 2.52 on the old model. They were written for a complex anchored
  // between Fz and Cz and read at Cz, which AASM and Colrain do not make the maximum — the
  // frontal regions are — and the last compared the vertex with O1's AWAKE p2p, most of which
  // is the posterior alpha rhythm, not K-complex field. The complex is now frontally maximal
  // (Cz carries about two thirds of Fz), so it is read at Fz, isolated (same seed, on minus off).
  const iso = (name: string) => {
    const on = k.data[k.eng.indexOf(name)], off = base.data[base.eng.indexOf(name)];
    return on.map((x, i) => x - off[i]);
  };
  const fzI = iso('Fz'), o1I = iso('O1');
  let hi = -Infinity, lo = Infinity, o1Peak = 0;
  for (const x of fzI) { hi = Math.max(hi, x); lo = Math.min(lo, x); }
  for (const x of o1I) o1Peak = Math.max(o1Peak, Math.abs(x));
  check('Fz: K-complex isolated p2p / background p2p (AASM: stands out from the background)',
    (hi - lo) / pctP2p(base.data[base.eng.indexOf('Fz')]), 1.5, 50);
  check('K-complex isolated peak Fz / O1 (frontal, not occipital)', Math.max(hi, -lo) / o1Peak, 3, 100);

  // The early positive phase and the spindle after, per event, at Fz (2026-10-22).
  // Sources (sources/sleep.ts): the definitions are biphasic; the literature adds "a
  // smaller preceding positivity that may not be visible by eye" (the P200). So it is
  // there in some events and not others, and always smaller than the negative peak.
  // The spindle after is a choice under the toggle: none, sometimes (the default,
  // learningeeg "often but not always"), always.
  const kcAtFz = (mode: 'none' | 'sometimes' | 'always') => {
    const run = (pat: string[]) => {
      const e = new EegEngine(SLEEP_OPTS);
      e.setPatientState('awake');
      e.setActivePatterns(new Set(pat));
      e.setPatternOptions({ kcSpindle: mode });
      const fz = e.electrodes.indexOf('Fz'), buf = new Float64Array(e.electrodes.length), x = new Float64Array(240 * FS);
      for (let i = 0; i < x.length; i++) { e.next(buf); x[i] = buf[fz]; }
      return x;
    };
    const a = run(['k-complex']), b = run([]);
    const x = a.map((v, i) => v - b[i]);
    let mn = 0;
    for (const v of x) mn = Math.min(mn, v);
    const peaks: number[] = [];
    for (let i = 1; i < x.length - 1; i++) {
      if (x[i] < 0.5 * mn && x[i] <= x[i - 1] && x[i] <= x[i + 1] && (!peaks.length || i - peaks[peaks.length - 1] > 3 * FS)) peaks.push(i);
    }
    // Early phase: the largest positive value 0.15-0.45 s before the negative peak, as a share of it.
    const early = peaks.map((pk) => {
      let m = 0;
      for (let k = pk - Math.round(0.45 * FS); k < pk - Math.round(0.15 * FS); k++) m = Math.max(m, x[k]);
      return m / -x[pk];
    });
    // Spindle after: 11-16 Hz-ish energy (a second difference) 0.5-2.2 s after the peak.
    const spindle = peaks.map((pk) => {
      let e2 = 0, n = 0;
      for (let k = pk + Math.round(0.5 * FS); k < Math.min(x.length - 2, pk + Math.round(2.2 * FS)); k++) {
        const hp = x[k] - (x[k - 2] + x[k + 2]) / 2;
        e2 += hp * hp; n++;
      }
      return Math.sqrt(e2 / n);
    });
    return { early, withSpindle: spindle.filter((v) => v > 0.2).length / Math.max(1, peaks.length), n: peaks.length };
  };
  const kcSome = kcAtFz('sometimes');
  check('K-complex events in 240 s at Fz (the tests have something to test)', kcSome.n, 6, 30);
  check('K-complex share with an early positive phase over 5% of the negative peak (literature: "may not always be present")',
    kcSome.early.filter((v) => v > 0.05).length / kcSome.n, 0.4, 0.95);
  check('K-complex largest early positive phase / negative peak (literature: "a smaller preceding positivity")',
    Math.max(...kcSome.early), 0.05, 0.4);
  check('K-complex share followed by a spindle, option Sometimes (learningeeg: "often but not always")', kcSome.withSpindle, 0.3, 0.9);
  check('K-complex share followed by a spindle, option None', kcAtFz('none').withSpindle, 0, 0);
  check('K-complex share followed by a spindle, option Always', kcAtFz('always').withSpindle, 1, 1);
});

section('\nPOSTS (positive occipital sharp transients, N1/N2):', () => {
  const p = runEngineState(180, SLEEP_OPTS, 'awake', ['posts']);
  // 'O1 p2p, posts on / off' (>= 1.2) and 'O1 p2p / Cz p2p (occipital-maximal)' (>= 1.2) were
  // replaced 2026-09-11 (1.245 and 2.147 on the old model). Both measured POSTS on top of the
  // AWAKE background, whose O1 p2p is mostly the PDR — a rhythm POSTS never share a page with.
  // The first could only pass with oversized POSTS: the old 75 uV ones, at the very top of
  // Neupsy Key's 20-75 uV range, read 1.245; POSTS inside that range (25-55 uV) read 1.055.
  // Isolated instead (same seed, on minus off); size, width and trains are asserted in Step 19b.
  let o1Peak = 0, czPeak = 0;
  const o1On = o1c(p.data, p.eng), o1Off = o1c(base.data, base.eng);
  const czOn = cz(p.data, p.eng), czOff = cz(base.data, base.eng);
  for (let i = 0; i < o1On.length; i++) {
    o1Peak = Math.max(o1Peak, Math.abs(o1On[i] - o1Off[i]));
    czPeak = Math.max(czPeak, Math.abs(czOn[i] - czOff[i]));
  }
  check('POSTS isolated peak O1 / Cz (occipital-maximal)', o1Peak / czPeak, 3, 1000);
});

section('\nState gating (N2 shows spindles with no toggle):', () => {
  // stateIntrinsic: the N2 state alone must bring spindles up, without the user
  // toggling anything — N2 is not N2 without them.
  const n2 = runEngineState(180, SLEEP_OPTS, 'n2', []);
  const n2CzSigma = bandPower(cz(n2.data, n2.eng), 12, 15);
  check('Cz sigma power, N2 / awake (state-driven)', n2CzSigma / baseCzSigma(), 2, 1e6);
});

import type { PatientState } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
import { SLEEP_OPTS, absPeak, bandPower, base, baseCzP2p, baseO1P2p, check, contrib, o1c, pctP2p, runEngineState, section, step } from './harness';

step('\n=== Step 13: normal variants (pattern sources) ===\n');

section('Mu rhythm (8-12 Hz, arciform, central; radial -> peaks at C3/C4):', () => {
  const m = runEngineState(180, SLEEP_OPTS, 'awake', ['mu-rhythm']);
  // Probe C3/C4 — the electrodes the toggle's own annotation names — and require
  // the rhythm to rise there while the posterior rhythm (O1) is left untouched: mu
  // is a central, not a posterior, rhythm.
  //
  // This used to probe Cz+T3+T4 instead, on the theory that a tangential mu nulls
  // over its own anchor and peaks at the flanks. Two things were wrong with that.
  // The source steers ANTERIOR (tangentialAt(pos, [0,0,1])), not toward the vertex
  // as the old comment claimed, so its lobes fell on F3 and P3, never on Cz/T3/T4 —
  // the check was riding a 0.13 Cz sidelobe that the electrode correction reduced to
  // 0.00, which is the whole of why it started failing. And a mu whose maximum is at
  // F3 is not mu (IK-006). variants.ts is now radial; this probes the maximum.
  const bp = (r: typeof base, n: string) => bandPower(r.data[r.eng.indexOf(n)], 8, 12);
  const centralOn = bp(m, 'C3') + bp(m, 'C4');
  const centralOff = bp(base, 'C3') + bp(base, 'C4');
  check('mu central 8-12 power, mu-rhythm on / off', centralOn / centralOff, 1.2, 50);
  // Where the old geometry actually put it, asserted so it cannot drift back.
  check('mu C3 / F3 8-12 power (central, not frontal; IK-006)',
    bp(m, 'C3') / bp(m, 'F3'), 3.0, 1e6);
  check('mu O1 8-12 power, mu-rhythm on / off (~1, not posterior)',
    bp(m, 'O1') / bp(base, 'O1'), 0.9, 1.15);
});

section('\nWicket spikes (6-11 Hz bursts, temporal, drowsy only):', () => {
  const w = runEngineState(180, SLEEP_OPTS, 'drowsy', ['wicket']);
  const wBase = runEngineState(180, SLEEP_OPTS, 'drowsy', []);
  // Band power (6-11 Hz), not p2p: the arciform bursts are rhythmic, so their
  // in-band power lifts clearly even though a single burst barely moves the p2p
  // against the drowsy background's own transients.
  const t3On = bandPower(w.data[w.eng.indexOf('T3')], 7, 11);
  const t3Off = bandPower(wBase.data[wBase.eng.indexOf('T3')], 7, 11);
  check('T3 7-11 Hz power, wicket on / off (drowsy)', t3On / t3Off, 1.3, 1e6);
  // Wicket spans the full 6-11 Hz range the UI names. The old tone set started
  // at 8.4 Hz and left the lower half empty; assert the 6-7.5 Hz band now lifts
  // too, so the widened WICKET_TONES cannot silently regress to an alpha-only set.
  const t3LoOn = bandPower(w.data[w.eng.indexOf('T3')], 6, 7.5);
  const t3LoOff = bandPower(wBase.data[wBase.eng.indexOf('T3')], 6, 7.5);
  // Floor 1.2, not 1.3: the low band carries the two smaller tones so its lift is
  // naturally gentler than the 7-11 Hz band's, but 1.2x still decisively beats the
  // ~1.0 the old alpha-only tone set would give here.
  check('T3 6-7.5 Hz power, wicket on / off (drowsy; widened range)', t3LoOn / t3LoOff, 1.2, 1e6);
  // eegpedia: wickets are "present in relaxed wakefulness, drowsiness, light sleep".
  // Until 2026-10-13 the source was gated to drowsiness alone and this line
  // asserted that the toggle did nothing awake (`T3 p2p, wicket toggle while
  // awake (state-gated off)`).
  const wAwake = runEngineState(180, SLEEP_OPTS, 'awake', ['wicket']);
  const wAwakeOff = runEngineState(180, SLEEP_OPTS, 'awake', []);
  const iT3 = wAwake.eng.indexOf('T3');
  let wAwakePeak = 0;
  for (let k = 0; k < wAwake.data[iT3].length; k++) {
    wAwakePeak = Math.max(wAwakePeak, Math.abs(wAwake.data[iT3][k] - wAwakeOff.data[iT3][k]));
  }
  check('T3 wicket burst peak while awake (EEGPEDIA: present in relaxed wakefulness too)', wAwakePeak, 30, 250, ' uV');
});

section('\nRMTD (monomorphic ~6 Hz, temporal, drowsy only):', () => {
  const r = runEngineState(180, SLEEP_OPTS, 'drowsy', ['rmtd']);
  const rBase = runEngineState(180, SLEEP_OPTS, 'drowsy', []);
  const t4Theta = bandPower(r.data[r.eng.indexOf('T4')], 5, 7);
  const t4ThetaBase = bandPower(rBase.data[rBase.eng.indexOf('T4')], 5, 7);
  check('T4 5-7 Hz power, rmtd on / off (drowsy)', t4Theta / t4ThetaBase, 2, 1e6);
});

section('\nLambda waves (occipito-parietal positive transients):', () => {
  const l = runEngineState(180, SLEEP_OPTS, 'awake', ['lambda']);
  const o1P2p = pctP2p(o1c(l.data, l.eng));
  check('O1 p2p, lambda on / off', o1P2p / baseO1P2p(), 1.2, 50);
  check('lambda contribution O1 / Cz (posterior-max)',
    contrib(l, 'O1', 4, 10) / contrib(l, 'Cz', 4, 10), 1.0, 1e6);
});

section('\nPSWY (2.5-4.5 Hz, posterior, awake only):', () => {
  const p = runEngineState(180, SLEEP_OPTS, 'awake', ['pswy']);
  const o1Slow = bandPower(o1c(p.data, p.eng), 2.5, 4.5);
  const o1SlowBase = bandPower(o1c(base.data, base.eng), 2.5, 4.5);
  check('O1 2.5-4.5 Hz power, pswy on / off', o1Slow / o1SlowBase, 1.5, 1e6);
  const pDrowsy = runEngineState(180, SLEEP_OPTS, 'drowsy', ['pswy']);
  const o1SlowDrowsy = bandPower(o1c(pDrowsy.data, pDrowsy.eng), 2.5, 4.5);
  const drowsyBase = runEngineState(180, SLEEP_OPTS, 'drowsy', []);
  const o1SlowDrowsyBase = bandPower(o1c(drowsyBase.data, drowsyBase.eng), 2.5, 4.5);
  check('O1 2.5-4.5 Hz power, pswy while drowsy (state-gated off)',
    o1SlowDrowsy / o1SlowDrowsyBase, 0.7, 1.5);
});

// The classic FOLD form: posterior maximum, low amplitude, drowsiness (learningeeg,
// Normal Variants; StatPearls NBK555899). It used to be asserted at Cz, awake,
// where a 50 uV spike nearly tripled the trace (2.85 against a ceiling of 3).

section('\n6 Hz phantom spike-wave (FOLD: brief, posterior, low-amplitude, drowsy):', () => {
  const iso = (state: PatientState, el: string) => {
    const on = runEngineState(180, SLEEP_OPTS, state, ['6hz-sw']);
    const off = runEngineState(180, SLEEP_OPTS, state, []);
    const i = on.eng.indexOf(el);
    return on.data[i].map((v, k) => v - off.data[i][k]);
  };
  const o1 = iso('drowsy', 'O1');
  // Spike and wave are both negative (morphology.ts) and the wave is the larger,
  // so the wave is the deepest point of the trace and the spike its sharpest.
  let wave = 0, spike = 0, sharpest = 0;
  for (let k = 0; k < o1.length; k++) wave = Math.min(wave, o1[k]);
  for (let k = 2; k < o1.length - 2; k++) {
    const c = Math.abs(o1[k] - (o1[k - 2] + o1[k + 2]) / 2);
    if (c > sharpest) { sharpest = c; spike = o1[k]; }
  }
  check('6hz-sw O1 slow wave (phantom: low amplitude)', -wave, 10, 50, ' uV');
  check('6hz-sw O1 spike / slow wave (StatPearls: wave of equal or greater amplitude)', spike / wave, 0.2, 1);
  check('6hz-sw O1: spike and wave are both surface-negative (sum of the two signs, -2)', Math.sign(spike) + Math.sign(wave), -2, -2);
  check('6hz-sw O1 / Fz (FOLD: posterior maximum)', absPeak(o1) / absPeak(iso('drowsy', 'Fz')), 2, 1e6);
  check('6hz-sw O1, toggle while awake (state-gated off)', absPeak(iso('awake', 'O1')), 0, 1, ' uV');
});

section('\n14 & 6 Hz positive bursts (posterior temporal, arciform):', () => {
  // POS bursts are a drowsy / light-sleep phenomenon (state-gated), so test in
  // drowsy — where the reduced background alpha also lets the 14 Hz component
  // stand out. Probe 13.5-15.5 Hz (on the 14 Hz tone, above the alpha shoulder)
  // at whichever posterior-temporal electrode the source projects to most
  // strongly; the bursts are brief and low-duty, so the ratio is modest.
  const b = runEngineState(180, SLEEP_OPTS, 'drowsy', ['14-6-pos']);
  const bBase = runEngineState(180, SLEEP_OPTS, 'drowsy', []);
  const rat = (n: string) =>
    bandPower(b.data[b.eng.indexOf(n)], 13.5, 15.5) / bandPower(bBase.data[bBase.eng.indexOf(n)], 13.5, 15.5);
  check('T5/T6 13.5-15.5 Hz power, 14-6-pos on / off (drowsy)', Math.max(rat('T5'), rat('T6')), 1.3, 1e6);
  // Toggling it awake does nothing: the state gate holds it off.
  const bAwake = runEngineState(180, SLEEP_OPTS, 'awake', ['14-6-pos']);
  const t6Awake = bandPower(bAwake.data[bAwake.eng.indexOf('T6')], 13.5, 15.5);
  const t6AwakeBase = bandPower(base.data[base.eng.indexOf('T6')], 13.5, 15.5);
  check('T6 13.5-15.5 Hz power, 14-6-pos while awake (state-gated off)', t6Awake / t6AwakeBase, 0.8, 1.2);
});

section('\nBETS (very brief <50ms, low-amplitude, temporal, alternating side, drowsy/N1/N2 only):', () => {
  // A4 fix: BETS is now state-gated (variants.ts betsSide, states: ['drowsy',
  // 'n1', 'n2']) — it's a phenomenon of drowsiness/light sleep, not relaxed
  // wakefulness (site + patterns.ts both call it "sleep"), matching the
  // wicket/rmtd/14-6-pos precedent. Test on/off in drowsy, and add the
  // state-gated-off check at awake mirroring wicket's above.
  const bt = runEngineState(180, SLEEP_OPTS, 'drowsy', ['bets']);
  const t3P2p = pctP2p(bt.data[bt.eng.indexOf('T3')]);
  const t4P2p = pctP2p(bt.data[bt.eng.indexOf('T4')]);
  // Floor only. A ceiling of 3x the resting Cz amplitude sat here, with no source: it was a
  // ratio to the background, and when the aperiodic floor was halved (2026-09-22) the same BETS
  // read 3.2x. The pattern's own claim, "low-amplitude (<50 uV)", is asserted in absolute uV
  // by the BETS block in display space ('BETS T3-T5 peak amplitude'), which a background
  // change cannot move.
  check('T3 p2p, bets on / off (drowsy)', t3P2p / baseCzP2p(), 0.3, Infinity);
  check('T4 p2p, bets on / off (drowsy)', t4P2p / baseCzP2p(), 0.3, Infinity);
  const btAwake = runEngineState(180, SLEEP_OPTS, 'awake', ['bets']);
  const t3AwakeP2p = pctP2p(btAwake.data[btAwake.eng.indexOf('T3')]);
  check('T3 p2p, bets toggle while awake (state-gated off)', t3AwakeP2p / baseCzP2p(), 0, 1.5);
});

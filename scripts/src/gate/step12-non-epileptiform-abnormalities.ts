import { SLEEP_OPTS, bandPower, base, baseCzP2p, check, contrib, cz, o1c, pctP2p, runEngineState, section, step } from './harness';

step('\n=== Step 12: non-epileptiform abnormalities (pattern sources) ===\n');

section('Generalised slowing (diffuse theta/delta, no PDR):', () => {
  const gs = runEngineState(180, SLEEP_OPTS, 'awake', ['gen-slowing']);
  // (1) The posterior alpha rhythm is abolished — a record with a preserved PDR
  // is not "slowed". Occipital alpha power collapses vs the same-seed awake
  // background (`bandGate` mutes the alpha/mu sources to 0.15).
  const o1AlphaOn = bandPower(o1c(gs.data, gs.eng), 8, 12);
  const o1AlphaOff = bandPower(o1c(base.data, base.eng), 8, 12);
  check('O1 alpha power, gen-slowing on / off (PDR lost)', o1AlphaOn / o1AlphaOff, 0, 0.2);
  // (2) Diffuse slow activity replaces it: low-band (1-7 Hz) power rises markedly
  // and near-uniformly (broad central source), here read at the vertex.
  const czSlowOn = bandPower(cz(gs.data, gs.eng), 1, 7);
  const czSlowOff = bandPower(cz(base.data, base.eng), 1, 7);
  check('Cz slow (1-7 Hz) power, gen-slowing on / off', czSlowOn / czSlowOff, 1.5, 1e6);
});

section('\nFIRDA (2-3 Hz rhythmic bursts, frontal/midline):', () => {
  const f = runEngineState(180, SLEEP_OPTS, 'awake', ['firda']);
  const fzP2pOn = pctP2p(f.data[f.eng.indexOf('Fz')]);
  const fzP2pOff = pctP2p(base.data[base.eng.indexOf('Fz')]);
  check('Fz p2p, firda on / off', fzP2pOn / fzP2pOff, 1.3, 50);
  check('delta (2-3 Hz) contribution Fz / T3 (frontal-max)',
    contrib(f, 'Fz', 2, 3) / Math.max(contrib(f, 'T3', 2, 3), 1e-6), 1.5, 1e6);
});

section('\nFocal delta, left temporal (polymorphic, lateralised):', () => {
  const fd = runEngineState(180, SLEEP_OPTS, 'awake', ['focal-delta-temporal']);
  const t3P2p = pctP2p(fd.data[fd.eng.indexOf('T3')]);
  const t4P2p = pctP2p(fd.data[fd.eng.indexOf('T4')]);
  check('T3 p2p / T4 p2p (left-lateralised)', t3P2p / t4P2p, 1.3, 50);
  const t3DeltaOn = bandPower(fd.data[fd.eng.indexOf('T3')], 1, 3);
  const t3DeltaOff = bandPower(base.data[base.eng.indexOf('T3')], 1, 3);
  check('T3 delta power, focal-delta-temporal on / off', t3DeltaOn / t3DeltaOff, 2, 1e6);
});

section('\nTriphasic waves (anterior-predominant, periodic):', () => {
  const tp = runEngineState(180, SLEEP_OPTS, 'awake', ['triphasic']);
  const fzP2pOn = pctP2p(tp.data[tp.eng.indexOf('Fz')]);
  const fzP2pOff = pctP2p(base.data[base.eng.indexOf('Fz')]);
  const o1P2p = pctP2p(tp.data[tp.eng.indexOf('O1')]);
  check('Fz p2p, triphasic on / off', fzP2pOn / fzP2pOff, 1.5, 60);
  // Read at the frontal pole: since 2026-10-12 the wave's anterior half is a
  // bifrontal field whose maximum is Fp1/Fp2, not the single patch under Fz this
  // used to compare with O1.
  check('Fp1 p2p / O1 p2p (anterior-predominant)', pctP2p(tp.data[tp.eng.indexOf('Fp1')]) / o1P2p, 1.3, 50);
});

section('\nGPEDs (generalised periodic discharges, ~1-2 s):', () => {
  const g = runEngineState(180, SLEEP_OPTS, 'awake', ['gpeds']);
  const czP2pOn = pctP2p(g.data[g.eng.indexOf('Cz')]);
  check('Cz p2p, gpeds on / off', czP2pOn / baseCzP2p(), 1.8, 60);
  check('Cz p2p, gpeds (sanity floor)', czP2pOn, 80, 500, ' uV');
});

section('\nLPEDs (left temporal periodic sharp+slow):', () => {
  const lp = runEngineState(180, SLEEP_OPTS, 'awake', ['lpeds']);
  const t3P2p = pctP2p(lp.data[lp.eng.indexOf('T3')]);
  const t4P2p = pctP2p(lp.data[lp.eng.indexOf('T4')]);
  check('T3 p2p / T4 p2p (left-lateralised)', t3P2p / t4P2p, 1.3, 50);
  const t3DeltaOn = bandPower(lp.data[lp.eng.indexOf('T3')], 1, 3);
  const t3DeltaOff = bandPower(base.data[base.eng.indexOf('T3')], 1, 3);
  check('T3 delta (background slowing) power, lpeds on / off', t3DeltaOn / t3DeltaOff, 1.3, 1e6);
});

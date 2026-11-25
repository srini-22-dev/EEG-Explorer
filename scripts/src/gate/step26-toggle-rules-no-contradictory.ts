import type { PatientState } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
import { PATTERN_CATEGORIES } from '../../../artifacts/eeg-simulator/src/utils/patterns';
import { EDUCATIONAL_ANNOTATIONS } from '../../../artifacts/eeg-simulator/src/utils/annotations';
import { PATTERN_SOURCES } from '../../../artifacts/eeg-simulator/src/engine/sources/registry';
import { TOGGLE_RULES, STATE_DEFAULTS, initialToggles, effective, violations, toggle, enterState, clearToggles, setPage, quizPage } from '../../../artifacts/eeg-simulator/src/utils/toggleRules';
import { join } from 'node:path';
import { check, section, step } from './harness';

// ---------------------------------------------------------------------------
// Step 26 — toggle rules: no contradictory page can be reached (2026-10-13)
//
// Not a signal check: this one is about which signals the app will let a learner
// put on one page. Eye Blink could be switched on in REM and sat there beside
// Rapid Eye Movements, because no artifact had a state rule and the only rule
// between two toggles was blink -> eyes open. The rules are now a table
// (utils/toggleRules.ts) applied by pure functions, and the app makes every change
// through them — so walking random actions through those same functions and
// finding no violation is a statement about the app, not about a copy of it.
// ---------------------------------------------------------------------------
step('\n=== Step 26: toggle rules — no contradictory combination is reachable ===\n');

section(null, () => {
  const ids = PATTERN_CATEGORIES.flatMap(c => c.patterns.map(p => p.id));
  const stages: PatientState[] = ['awake', 'drowsy', 'n1', 'n2', 'n3', 'rem'];
  const ruleIds = Object.keys(TOGGLE_RULES);

  // The table itself: a rule that contradicts another could not be satisfied.
  check('toggle rules: rules naming something that is not a toggle',
    ruleIds.filter(id => ![id, ...(TOGGLE_RULES[id].requires ?? []), ...(TOGGLE_RULES[id].excludes ?? [])]
      .every(x => ids.includes(x))).length, 0, 0);
  // The registries a toggle passes through agree with one another (2026-10-23 audit:
  // three toggles had no on-page cue though annotations.ts promises one for every
  // pattern, and three moved the record to Awake without their description saying
  // so, as every other state-moving description does).
  const pats = PATTERN_CATEGORIES.flatMap(c => c.patterns);
  check('registries: toggles with no on-page cue (annotations.ts)', pats.filter(p => !EDUCATIONAL_ANNOTATIONS[p.id]).length, 0, 0);
  const STATE_WORD: Record<string, PatientState> = { Awake: 'awake', Drowsy: 'drowsy', N1: 'n1', N2: 'n2', N3: 'n3', REM: 'rem' };
  check('registries: descriptions whose "switches Background State to X" disagrees with the rule, or a rule that moves the state unsaid',
    pats.filter(p => {
      const said = /(?:switches|moves) Background State to (\w+)/.exec(p.desc)?.[1];
      return (said ? STATE_WORD[said] : undefined) !== TOGGLE_RULES[p.id]?.target;
    }).length, 0, 0);
  const ENGINE_ARTIFACT_IDS = ['blink', 'eye-opening', 'eye-movement', 'eye-flutter', 'muscle', 'electrode-pop', 'bad-electrodes', 'sweat', '50hz', 'ecg-artifact', 'movement', 'respiration', 'ventilator', 'pulse', 'iv-drip'];
  check('registries: toggles allowed in a state where none of their sources draws (dead there)',
    pats.filter(p => {
      const ds = PATTERN_SOURCES.filter(d => d.toggles.includes(p.id));
      if (!ds.length) return !ENGINE_ARTIFACT_IDS.includes(p.id);
      return (TOGGLE_RULES[p.id]?.states ?? stages).some(st => !ds.some(d => d.stateIntrinsic || !d.states || d.states.includes(st)))
        && p.id !== 'slow-waves';  // sets the stage and draws nothing of its own, by design
    }).length, 0, 0);
  // A quiz asks "identify the active pattern": its page shows that one and what it
  // requires (Eyes Open under Lambda), nothing else. It used to bring the stage's
  // other defaults, so a spindle question also drew K-complexes, vertex waves and
  // POSTS, any of which could be offered as a "wrong" answer (2026-10-23 audit).
  check('toggle rules: quiz pages showing a pattern besides the one asked and what it requires',
    pats.filter(p => [...effective(quizPage([p.id]))].some(x => x !== p.id && !(TOGGLE_RULES[p.id]?.requires ?? []).includes(x))).length, 0, 0);
  check('toggle rules: rules whose target state is not one of their own states',
    ruleIds.filter(id => {
      const r = TOGGLE_RULES[id];
      return !!r.states && (!r.target || !r.states.includes(r.target));
    }).length, 0, 0);
  check('toggle rules: toggles requiring something they cannot be on with (another state, or excluded)',
    ruleIds.filter(id => (TOGGLE_RULES[id].requires ?? []).some(need => {
      const a = TOGGLE_RULES[id], b = TOGGLE_RULES[need];
      const stateClash = !!b?.states && (a.states ?? stages).some(st => !b.states!.includes(st));
      return stateClash || !!a.excludes?.includes(need) || !!b?.excludes?.includes(id);
    })).length, 0, 0);
  check('toggle rules: state defaults that are not allowed in their own state',
    stages.flatMap(st => STATE_DEFAULTS[st].filter(id => {
      const r = TOGGLE_RULES[id];
      return !!r?.states && !r.states.includes(st);
    })).length, 0, 0);

  // Every kind of change the app can make, at random, 20 000 times.
  let seed = 20261013;
  const rnd = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
  let st = initialToggles('awake');
  let broken = 0, firstBroken = '';
  const seenStates = new Set<string>(), seenOn = new Set<string>();
  for (let i = 0; i < 20000; i++) {
    const u = rnd();
    if (u < 0.70) st = toggle(st, pick(ids));
    else if (u < 0.90) st = enterState(st, pick(stages));
    else if (u < 0.93) st = clearToggles(st);
    else if (u < 0.97) st = setPage(st.patientState, [pick(ids), pick(ids), pick(ids)]);
    else st = quizPage([pick(ids)]);
    const now = effective(st);
    seenStates.add(st.patientState);
    for (const id of now) seenOn.add(id);
    const v = violations(st.patientState, now);
    if (v.length) { broken++; firstBroken ||= `${v[0]} (action ${i})`; }
  }
  if (firstBroken) console.log(`  first violation: ${firstBroken}`);
  check('toggle rules: contradictory pages reached in 20000 random actions (clicks, state buttons, Clear All, tutorial and quiz pages)',
    broken, 0, 0);
  // The walk is only evidence if it actually went everywhere.
  check('toggle rules: states the random walk visited', seenStates.size, 6, 6);
  check('toggle rules: toggles the random walk never managed to switch on', ids.filter(id => !seenOn.has(id)).length, 0, 0);

  const yes = (b: boolean) => (b ? 1 : 0);
  const has = (s: ReturnType<typeof initialToggles>, ...xs: string[]) => xs.every(x => effective(s).has(x));
  const lacks = (s: ReturnType<typeof initialToggles>, ...xs: string[]) => xs.every(x => !effective(s).has(x));

  // The case that started this.
  let c = toggle(enterState(initialToggles(), 'rem'), 'blink');
  check('toggle rules: Eye Blink switched on in REM moves to Awake and Rapid Eye Movements goes off',
    yes(c.patientState === 'awake' && has(c, 'blink', 'eyes-open') && lacks(c, 'rem-eyes')), 1, 1);
  for (const stage of ['drowsy', 'n1', 'n2', 'n3', 'rem'] as PatientState[]) {
    c = enterState(toggle(initialToggles(), 'blink'), stage);
    check(`toggle rules: entering ${stage} switches Eye Blink and Eyes Open off (LEARNINGEEG: blinks are a mark of the awake record)`,
      yes(lacks(c, 'blink', 'eyes-open')), 1, 1);
  }
  c = toggle(initialToggles(), 'lambda');
  check('toggle rules: Lambda switches Eyes Open on (LEARNINGEEG: awake, visually scanning)', yes(has(c, 'lambda', 'eyes-open')), 1, 1);
  c = toggle(c, 'eyes-open');
  check('toggle rules: closing the eyes switches Lambda off', yes(lacks(c, 'lambda', 'eyes-open')), 1, 1);
  c = toggle(toggle(initialToggles(), 'blink'), 'eye-opening');
  check('toggle rules: Eye Opening / Closing switches Eyes Open and Eye Blink off (it starts from closed eyes)',
    yes(has(c, 'eye-opening') && lacks(c, 'eyes-open', 'blink')), 1, 1);
  c = toggle(toggle(initialToggles(), 'pswy'), 'eyes-open');
  check('toggle rules: Eyes Open switches Posterior Slow Waves of Youth off (LEARNINGEEG: they sit within the PDR)',
    yes(has(c, 'eyes-open') && lacks(c, 'pswy')), 1, 1);
  c = toggle(enterState(initialToggles(), 'rem'), 'muscle');
  check('toggle rules: Muscle switched on in REM moves to Awake (LEARNINGEEG: muscle near-absent in REM)',
    yes(c.patientState === 'awake' && has(c, 'muscle')), 1, 1);
  c = enterState(toggle(initialToggles(), 'muscle'), 'rem');
  check('toggle rules: entering REM switches Muscle off', yes(lacks(c, 'muscle') && has(c, 'rem-eyes')), 1, 1);
  c = toggle(toggle(initialToggles(), 'chewing'), 'gtc-ictal');
  check('toggle rules: a tonic-clonic seizure switches Chewing off', yes(has(c, 'gtc-ictal') && lacks(c, 'chewing')), 1, 1);
  c = toggle(toggle(initialToggles(), 'absence-ictal'), 'hyperventilation');
  check('toggle rules: Hyperventilation and an absence seizure can be on together (it provokes one)',
    yes(has(c, 'absence-ictal', 'hyperventilation')), 1, 1);

  // Slow-Wave Sleep off leaves N3 (owner's inbox, 2026-11-25: "when i turned it off,
  // the signals were still from the slow-wave (n3)"): it lightens to N2.
  c = toggle(toggle(initialToggles(), 'slow-waves'), 'slow-waves');
  check('toggle rules: Slow-Wave Sleep switched on and off again leaves N3 for N2',
    yes(c.patientState === 'n2' && !effective(c).has('slow-waves')), 1, 1);

  // What already worked must still work.
  c = toggle(initialToggles(), 'posts');
  check('toggle rules: POSTS switched on from Awake arrives in N1 alone', yes(c.patientState === 'n1' && [...effective(c)].join() === 'posts'), 1, 1);
  c = enterState(initialToggles(), 'n2');
  check('toggle rules: the N2 state brings POSTS, vertex waves, K-complexes and spindles',
    yes(has(c, 'posts', 'v-waves', 'k-complex', 'spindles')), 1, 1);
  c = toggle(toggle(c, 'spindles'), 'spindles');
  check('toggle rules: a stage default switched off and on again stays in its stage', yes(c.patientState === 'n2' && has(c, 'spindles')), 1, 1);
  check('toggle rules: Clear All leaves nothing on', effective(clearToggles(c)).size, 0, 0);
  check('toggle rules: Awake starts with nothing on', effective(initialToggles()).size, 0, 0);
  c = setPage('awake', ['blink']);
  check('toggle rules: a tutorial page listing Eye Blink gets Eyes Open with it', yes(has(c, 'blink', 'eyes-open')), 1, 1);
});

/**
 * Which toggles can be on, in which background state, and with which others.
 *
 * A teaching record must not show a combination a patient cannot produce: a blink
 * in REM sleep, lambda waves with the eyes closed, chewing during a convulsion.
 * Until 2026-10-13 only the sleep graphoelements and some benign variants had a
 * state rule (`STATE_LOCKED_PATTERNS` in App.tsx), no artifact did, and the only
 * rule between two toggles was "Eye Blink switches Eyes Open on" — so all of the
 * above could be reached, and Eye Blink sat beside Rapid Eye Movements.
 *
 * This module is the one place those rules live: a table (`TOGGLE_RULES`) and the
 * pure transitions the app makes every change through. When a change conflicts
 * with what is already on, the toggle just switched on wins — the state moves to
 * where it can occur, or the conflicting toggle goes off. The gate (Step 26) walks
 * thousands of random actions through these same functions and asserts that
 * `violations()` stays empty.
 *
 * The rules bind the APP. A script can still ask the engine for a page the app
 * cannot reach (`renderTrace --state rem --patterns blink`); that is deliberate,
 * the engine draws what it is told.
 *
 * Sources: learningeeg.com (LE) unless noted.
 */

import { PATTERN_SOURCES } from '../engine/sources/registry';
import type { PatientState } from './simTypes';

export type ToggleRule = {
  /** States the toggle can be on in. Omitted: any state. */
  states?: PatientState[];
  /** The state that switching it on moves to, from a state it cannot occur in. Set whenever `states` is. */
  target?: PatientState;
  /** Toggles it cannot be on without: switched on with it, and switching one of them off switches this off. */
  requires?: string[];
  /** Toggles it cannot share a page with. Symmetric — whichever is switched on last stays. */
  excludes?: string[];
};

const AWAKE: PatientState[] = ['awake'];

// Patterns during which nobody follows a command or does anything on purpose: a
// convulsion, and the coma or deep anaesthesia burst suppression is recorded in.
const UNRESPONSIVE = ['gtc-ictal', 'burst-suppression'];
// An absence adds itself for the acts that need awareness (the patient stops and
// stares) but not for overbreathing, which is how one is provoked.
const UNAWARE = [...UNRESPONSIVE, 'absence-ictal'];

export const TOGGLE_RULES: Record<string, ToggleRule> = {
  // ── Sleep graphoelements: they belong to a stage, not to the patient ──
  // All four persist into slow-wave sleep, less organised (LE; AASM notes spindles
  // may persist in N3, and a K-complex that is slow and big enough IS a slow wave),
  // so N3 keeps them. Vertex waves and POSTS first appear in N1.
  'posts':      { target: 'n1', states: ['drowsy', 'n1', 'n2', 'n3'] },
  'v-waves':    { target: 'n1', states: ['n1', 'n2', 'n3'] },
  'k-complex':  { target: 'n2', states: ['n2', 'n3'] },
  'spindles':   { target: 'n2', states: ['n2', 'n3'] },
  'slow-waves': { target: 'n3', states: ['n3'] },
  // The stage's own eye movements.
  'roving-eyes': { target: 'drowsy', states: ['drowsy', 'n1'] },
  'rem-eyes':    { target: 'rem', states: ['rem'] },

  // ── Benign variants ──
  // Mostly a finding of drowsiness, but not only (eegpedia: "relaxed wakefulness,
  // drowsiness, light sleep"; learningeeg: "tend to be seen more in the drowsy
  // state").
  'wicket':    { target: 'drowsy', states: ['awake', 'drowsy', 'n1', 'n2'] },
  'rmtd':      { target: 'drowsy', states: ['drowsy'] },
  '14-6-pos':  { target: 'drowsy', states: ['drowsy', 'n1', 'n2'] },
  '6hz-sw':    { target: 'drowsy', states: ['drowsy', 'n1'] },
  'bets':      { target: 'drowsy', states: ['drowsy', 'n1', 'n2'] },
  // Mu is a waking rhythm: selecting it brings the record back to awake.
  'mu-rhythm': { target: 'awake', states: ['awake', 'drowsy'] },
  // LE: lambda waves "emerge in the awake state when one is visually scanning
  // something" — eyes open, looking, and aware.
  'lambda':    { target: 'awake', states: AWAKE, requires: ['eyes-open'], excludes: UNAWARE },
  // LE: posterior slow waves of youth sit "within the PDR" — so they go where the
  // PDR goes, which is nowhere once the eyes open. The engine already draws them
  // only when awake; without a rule here the toggle stayed lit over nothing.
  'pswy':      { target: 'awake', states: AWAKE, excludes: ['eyes-open'] },

  // ── The eyes ──
  // Sleep is eyes-closed, and so is this simulator's Drowsy (roving movements under
  // closing lids).
  'eyes-open':    { target: 'awake', states: AWAKE },
  // LE: blinks are "a key component of a normal awake EEG" and "can help to confirm"
  // wakefulness. A judgment call at the edge: LE says blinks are DECREASED in
  // drowsiness, not absent. Drowsy is locked out because the Drowsy drawn here is
  // the eyes-closed picture, and a blink needs open eyes.
  'blink':        { target: 'awake', states: AWAKE, requires: ['eyes-open'] },
  // Opening and closing on command: a cooperative patient, starting with the eyes
  // closed. With Eyes Open held on there is nothing to open — and so no blinks or
  // lambda either, since both need the eyes open throughout.
  'eye-opening':  { target: 'awake', states: AWAKE, excludes: ['eyes-open', ...UNAWARE] },
  // The quick gaze shifts of someone awake. In drowsiness and N1 lateral movements
  // are the slow roving kind, in REM the rapid kind — each has its own toggle — and
  // in N2 and N3 the eyes are still.
  'eye-movement': { target: 'awake', states: AWAKE },

  // ── Muscle ──
  // LE (REM): "muscle activity should be near-absent throughout this stage". The
  // engine already scales EMG to 6% in REM; the toggle stayed lit over nothing.
  'muscle':  { target: 'awake', states: ['awake', 'drowsy', 'n1', 'n2', 'n3'] },
  // LE lists chewing among the "artifact types typical for the awake state". Sleep
  // bruxism exists, but it is a different entity from what this toggle teaches.
  'chewing': { target: 'awake', states: AWAKE, excludes: UNRESPONSIVE },

  // ── Activation procedures ──
  // They need an awake, cooperative patient: you cannot ask a sleeping one to
  // overbreathe, and a driving response is judged on an awake background.
  // Drowsiness is tolerated because patients do drift during a three-minute
  // procedure. A flash can be shown to anyone; overbreathing takes effort.
  'photic':           { target: 'awake', states: ['awake', 'drowsy'] },
  'hyperventilation': { target: 'awake', states: ['awake', 'drowsy'], excludes: UNRESPONSIVE },

  // Deliberately unrestricted: movement, sweat, ECG, mains, electrode pop and bad
  // electrodes belong to no stage (a sleeper shifts and twitches, sweats, and has a
  // heart); spontaneous blinks, open eyes and muscle do occur with seizures; and a
  // focal seizure may leave awareness intact — its chewing automatisms are typical.
};

const STATES: PatientState[] = ['awake', 'drowsy', 'n1', 'n2', 'n3', 'rem'];

/**
 * What each stage brings with it — its defining graphoelements and eye movements —
 * read off the engine's own registry so the two cannot drift apart. The app shows
 * these as toggles that are ON, and lets them be switched off, instead of drawing
 * them unasked: what the toggles say and what is on the page are the same thing.
 * Awake brings nothing: it starts eyes closed, on the alpha rhythm, with no blinks.
 */
export const STATE_DEFAULTS = Object.fromEntries(
  STATES.map(s => [s, [
    ...new Set(PATTERN_SOURCES.filter(d => d.stateIntrinsic && d.states?.includes(s)).map(d => d.toggles[0])),
  ]]),
) as Record<PatientState, string[]>;

export type ToggleState = {
  patientState: PatientState;
  /** What was switched on by hand, or by the quiz or the tutorial. */
  active: Set<string>;
  /** Defaults of the current state that have been switched off. */
  suppressed: Set<string>;
};

export const initialToggles = (patientState: PatientState = 'awake'): ToggleState =>
  ({ patientState, active: new Set(), suppressed: new Set() });

/** What is actually on: the hand-set toggles, plus the state's defaults that have not been switched off. */
export function effective(s: ToggleState): Set<string> {
  const on = new Set(s.active);
  for (const id of STATE_DEFAULTS[s.patientState]) if (!s.suppressed.has(id)) on.add(id);
  return on;
}

/** Every rule the page breaks, in words. Empty for any page the app can reach — that is the invariant. */
export function violations(patientState: PatientState, on: Set<string>): string[] {
  const out: string[] = [];
  for (const id of on) {
    const r = TOGGLE_RULES[id];
    if (!r) continue;
    if (r.states && !r.states.includes(patientState)) out.push(`${id} in ${patientState}`);
    for (const need of r.requires ?? []) if (!on.has(need)) out.push(`${id} without ${need}`);
    for (const x of r.excludes ?? []) if (on.has(x)) out.push(`${id} with ${x}`);
  }
  return out;
}

// The transitions below build on three steps that edit a private copy.

const copy = (s: ToggleState): ToggleState =>
  ({ patientState: s.patientState, active: new Set(s.active), suppressed: new Set(s.suppressed) });

const allowedIn = (id: string, state: PatientState): boolean => {
  const r = TOGGLE_RULES[id];
  return !r?.states || r.states.includes(state);
};

const exclusive = (a: string, b: string): boolean =>
  !!TOGGLE_RULES[a]?.excludes?.includes(b) || !!TOGGLE_RULES[b]?.excludes?.includes(a);

/** Switch one toggle off, and with it whatever cannot be on without it. */
function off(d: ToggleState, id: string) {
  d.active.delete(id);
  if (STATE_DEFAULTS[d.patientState].includes(id)) d.suppressed.add(id);
  for (const other of effective(d)) if (TOGGLE_RULES[other]?.requires?.includes(id)) off(d, other);
}

/** Switch one toggle on: what it excludes goes off, what it requires comes on. */
function on(d: ToggleState, id: string) {
  d.active.add(id);
  d.suppressed.delete(id);
  for (const other of effective(d)) if (other !== id && exclusive(id, other)) off(d, other);
  for (const need of TOGGLE_RULES[id]?.requires ?? []) if (!effective(d).has(need)) on(d, need);
}

/** Move to a state: its defaults come on, and what cannot occur there goes off. */
function enter(d: ToggleState, state: PatientState) {
  d.patientState = state;
  d.suppressed = new Set();
  for (const id of [...d.active]) if (!allowedIn(id, state)) d.active.delete(id);
}

/** Drop anything left in a state it cannot occur in, or without something it requires. */
function settle(d: ToggleState): ToggleState {
  for (;;) {
    const now = effective(d);
    const bad = [...now].find(id =>
      !allowedIn(id, d.patientState) || TOGGLE_RULES[id]?.requires?.some(need => !now.has(need)));
    if (bad === undefined) return d;
    off(d, bad);
  }
}

/** A state button. */
export function enterState(s: ToggleState, state: PatientState): ToggleState {
  if (state === s.patientState) return s;
  const d = copy(s);
  enter(d, state);
  return settle(d);
}

/**
 * A toggle switched on. From a state it cannot occur in, the record moves to the
 * toggle's own state and arrives with only that toggle added — POSTS chosen from
 * Awake is POSTS on a sleep background, not everything N1 brings (the state
 * buttons bring the lot). From a state it can occur in, nothing else moves, so a
 * stage's default can be switched off and on again without leaving the stage.
 */
export function switchOn(s: ToggleState, id: string): ToggleState {
  const d = copy(s);
  const rule = TOGGLE_RULES[id];
  if (rule?.states && !rule.states.includes(d.patientState)) {
    enter(d, rule.target ?? rule.states[0]);
    for (const def of STATE_DEFAULTS[d.patientState]) d.suppressed.add(def);
  }
  on(d, id);
  return settle(d);
}

export function switchOff(s: ToggleState, id: string): ToggleState {
  const d = copy(s);
  off(d, id);
  return settle(d);
}

/** A click on a toggle. */
export const toggle = (s: ToggleState, id: string): ToggleState =>
  effective(s).has(id) ? switchOff(s, id) : switchOn(s, id);

/** Clear All: everything off means a clean record, so the state's defaults go too. */
export const clearToggles = (s: ToggleState): ToggleState =>
  ({ patientState: s.patientState, active: new Set(), suppressed: new Set(STATE_DEFAULTS[s.patientState]) });

/**
 * A page composed directly rather than clicked together (the tutorial): these
 * toggles, in this state, with the state's defaults. It goes through the same
 * rules — a step that lists Eye Blink gets Eyes Open with it.
 */
export function setPage(patientState: PatientState, patterns: Iterable<string>): ToggleState {
  const d = initialToggles(patientState);
  for (const id of patterns) if (allowedIn(id, patientState)) on(d, id);
  return settle(d);
}

/**
 * A quiz page: a pattern bound to a stage is shown in that stage — otherwise the
 * state-gated sources render nothing — and anything else on an awake background
 * rather than whatever the last question left.
 */
export function quizPage(patterns: Iterable<string>): ToggleState {
  const list = [...patterns];
  let state: PatientState = 'awake';
  for (const id of list) state = TOGGLE_RULES[id]?.target ?? state;
  return setPage(state, list);
}

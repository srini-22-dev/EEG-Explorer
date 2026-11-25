/**
 * Recording conditions (top bar): which artifacts a record made in a given setting
 * carries, and at what settings. Choosing a level sets the artifact toggles and their
 * options from its recipe; engine/conditions.ts then decides WHEN each one happens,
 * from what a patient in that setting does (muscle in episodes, blinking that
 * settles, handling that comes and goes).
 *
 * Every number below is an owner-directed teaching choice (2026-11-25: decide them
 * "by considering a real patient and what they would do"), not a measured figure;
 * the patient each level stands for is written beside it. The reasoning stays here —
 * the app shows each level's scope (`scope`), not its schedule.
 *
 * A level never moves the patient: it does not wake a sleeper to make them blink, or
 * open closed eyes. A toggle the current state cannot have (blinks in N2), or one
 * that needs another the page does not have (blinks without Eyes Open), is left off.
 */

import { TOGGLE_RULES, effective, switchOff, switchOn, type ToggleState } from './toggleRules';
import { defaultArtifactParams, type ArtifactParams, type ConditionLevel } from './simTypes';

/** The toggles a level decides. Eye flutter and eye opening are left to the reader: a finding and a command manoeuvre, not the setting. */
export const CONDITION_TOGGLES = [
  'blink', 'eye-movement', 'muscle', 'chewing', 'ecg-artifact', 'electrode-pop', 'bad-electrodes',
  'sweat', 'movement', '50hz', 'respiration', 'ventilator', 'pulse', 'iv-drip',
] as const;

export type ConditionScope = {
  /** The setting it stands for. */
  setting: string;
  /** What can appear, and roughly how often. */
  appears: string;
  /** What it is good for learning. */
  learn: string;
};

type Recipe = {
  name: string;
  toggles: (typeof CONDITION_TOGGLES)[number][];
  params: Partial<ArtifactParams>;
  scope: ConditionScope;
  /** Show the Resp row (IK-049) when the level is chosen; omitted leaves it as it is. */
  showResp?: boolean;
};

export const CONDITION_LEVELS: ConditionLevel[] = ['none', 'ideal', 'controlled', 'routine', 'ambulatory', 'icu', 'worst'];

export const RECIPES: Record<ConditionLevel, Recipe> = {
  none: {
    name: 'Custom',
    toggles: [],
    params: {},
    scope: {
      setting: 'Your own choice of artifacts, from the toggles on the left.',
      appears: 'Exactly what you switch on, held steady for as long as it is on.',
      learn: 'Studying one artifact at a time.',
    },
  },
  // A textbook page.
  ideal: {
    name: 'Ideal',
    toggles: [],
    params: {},
    scope: {
      setting: 'A textbook page: perfect electrode contact and a patient who never moves.',
      appears: 'No artifacts at all.',
      learn: 'The background on its own, and the patterns you switch on, with nothing in the way.',
    },
  },
  // A cooperative volunteer, carefully prepared, in a shielded room: a steady low
  // blink rate (8/min, half the resting average), the odd swallow, a calm heart.
  controlled: {
    name: 'Controlled',
    toggles: ['blink', 'eye-movement', 'muscle', 'ecg-artifact'],
    params: {
      blinkRatePerMin: 8, saccadeRatePerMin: 10, emgSeverity: 0.6, emgRegions: ['temporalisL', 'temporalisR'], ecgBpm: 64,
    },
    scope: {
      setting: 'A research recording: a relaxed volunteer, careful preparation, a shielded room.',
      appears: 'Occasional blinks and eye movements when the eyes are open, a little ECG, and now and then a brief burst of jaw muscle from a swallow. No mains, no bad contacts.',
      learn: 'How little artifact a well-made record still has.',
    },
  },
  // An adult outpatient in the EEG lab: anxious at first, settling. A little mains
  // through one hurried contact; an occasional pop; a slightly fast heart.
  routine: {
    name: 'Routine',
    toggles: ['blink', 'eye-movement', 'muscle', 'ecg-artifact', 'electrode-pop', '50hz', 'sweat', 'movement'],
    params: {
      blinkRatePerMin: 16, saccadeRatePerMin: 20, emgSeverity: 1, emgRegions: ['temporalisL', 'temporalisR', 'frontalis'],
      ecgBpm: 76, popRatePerMin: 0.3, lineAmpUv: 3, mainsContacts: 'one', sweatSeverity: 0.5, movementRatePerMin: 0.3,
    },
    scope: {
      setting: 'A routine outpatient EEG in the lab: a patient who is anxious at first and settles.',
      appears: 'Frequent blinks and bursts of jaw or brow muscle early on, fewer as the patient relaxes. A little mains on the rows of one electrode, an occasional electrode pop, slight sweat, a rare movement.',
      learn: 'Reading through the artifacts of an everyday record, and seeing them fade as the patient settles.',
    },
  },
  // Up and about at home on an ambulatory recorder: talking, eating, turning, walking.
  ambulatory: {
    name: 'Ambulatory / home',
    toggles: ['blink', 'eye-movement', 'muscle', 'chewing', 'ecg-artifact', 'electrode-pop', '50hz', 'sweat', 'movement'],
    params: {
      blinkRatePerMin: 18, saccadeRatePerMin: 30, emgSeverity: 1.3, emgRegions: ['temporalisL', 'temporalisR', 'frontalis', 'nuchal'],
      ecgBpm: 80, popRatePerMin: 1, lineAmpUv: 5, mainsContacts: 'one', sweatSeverity: 1.5, movementRatePerMin: 1,
    },
    scope: {
      setting: 'An ambulatory recording at home: a patient going about the day, unsupervised.',
      appears: 'Chewing, jaw and neck muscle that come and go, blinking that varies, stretches of movement, electrode pops, sweat, and mains from household wiring.',
      learn: 'Telling artifact from abnormality with no technologist to note what the patient was doing.',
    },
  },
  // Sedated and ventilated on long-term monitoring: gel drying out over many contacts,
  // so mains is large and widespread; a fast heart; fever; nursing care. Mains is at
  // the slider's top, 15 uV: at 12 it was only about twice the occipital rows'
  // background on the double banana, where neighbouring poor contacts partly cancel,
  // and the point of this level is a background the notch has to rescue (Step 29).
  icu: {
    name: 'ICU bedside',
    toggles: ['muscle', 'ecg-artifact', 'electrode-pop', 'bad-electrodes', '50hz', 'sweat', 'movement', 'respiration', 'ventilator', 'iv-drip'],
    showResp: true,
    params: {
      respirationForm: 'electrode', respirationElectrode: 'P4', ventRatePerMin: 16, ventSide: 'left',
      emgSeverity: 1.3, emgRegions: ['temporalisL', 'temporalisR', 'frontalis', 'nuchal'],
      ecgBpm: 96, popRatePerMin: 1.5, lineAmpUv: 15, mainsContacts: 'many', sweatSeverity: 1.5, movementRatePerMin: 0.6,
    },
    scope: {
      setting: 'Continuous monitoring at the ICU bedside: a sedated, ventilated patient, surrounded by equipment, with electrodes on for days.',
      appears: 'Mains over many contacts, worst at the back of the head, large enough to bury the background (try the 50 Hz notch). The ventilator: breathing locked to its rate on the Resp row, a slow wave per breath at one contact, and bursts from water in the tubing (try suctioning it). An IV drip: a brief spike on a few electrodes at every drop. A prominent ECG, bad and popping electrodes, sweat, and stretches of movement during nursing care. Muscle only in brief bouts of agitation; no blinks.',
      learn: 'Why the notch filter exists, and how much of an ICU record is the room rather than the brain.',
    },
  },
  // A restless patient and a hurried application: everything, at high severity.
  worst: {
    name: 'Worst case',
    toggles: ['blink', 'eye-movement', 'muscle', 'chewing', 'ecg-artifact', 'electrode-pop', 'bad-electrodes', '50hz', 'sweat', 'movement', 'respiration', 'pulse', 'iv-drip'],
    params: {
      blinkRatePerMin: 24, saccadeRatePerMin: 40, emgSeverity: 2, emgRegions: ['temporalisL', 'temporalisR', 'frontalis', 'nuchal'],
      ecgBpm: 100, popRatePerMin: 3, lineAmpUv: 15, mainsContacts: 'many', sweatSeverity: 2.5, movementRatePerMin: 1.5,
    },
    scope: {
      setting: 'The record a technologist would stop and redo: a restless patient and a hurried, poorly gelled application.',
      appears: 'Every artifact at once and at high severity, overlapping: muscle that rarely stops, frequent movement and pops, widespread mains, bad electrodes, sweat.',
      learn: 'Recognising an unreadable record, and which fixes (re-gelling, the notch, a calmer patient) would rescue it.',
    },
  },
};

/** What a level was applied as, so a later edit can be noticed. */
export type AppliedLevel = { level: ConditionLevel; on: string[]; params: Partial<ArtifactParams> };

/** Can this toggle come on without moving the patient or switching anything else on? */
function fits(s: ToggleState, id: string): boolean {
  const r = TOGGLE_RULES[id];
  if (r?.states && !r.states.includes(s.patientState)) return false;
  const now = effective(s);
  return (r?.requires ?? []).every(need => now.has(need));
}

/**
 * Apply a level: its toggles on (those the patient's state allows), the other
 * condition toggles off, and its artifact settings over the defaults. The reader's own
 * deliberate actions — electrodes detached, the manual-pop counter — are kept.
 */
export function applyLevel(level: ConditionLevel, s: ToggleState, params: ArtifactParams):
  { toggles: ToggleState; params: ArtifactParams; applied: AppliedLevel; showResp?: boolean } {
  const recipe = RECIPES[level];
  let t = s;
  if (level !== 'none') {
    for (const id of CONDITION_TOGGLES) if (effective(t).has(id)) t = switchOff(t, id);
    for (const id of recipe.toggles) if (fits(t, id)) t = switchOn(t, id);
  }
  const next: ArtifactParams = level === 'none' ? params : {
    ...defaultArtifactParams(), ...recipe.params,
    manualPopNonce: params.manualPopNonce, suctionNonce: params.suctionNonce, detachedElectrodes: params.detachedElectrodes,
  };
  return { toggles: t, params: next, applied: { level, on: onConditionToggles(t), params: recipe.params }, showResp: recipe.showResp };
}

const onConditionToggles = (s: ToggleState) => CONDITION_TOGGLES.filter(id => effective(s).has(id));

/** Whether the page has been changed since the level was applied. */
export function isEdited(a: AppliedLevel, s: ToggleState, params: ArtifactParams): boolean {
  if (a.level === 'none') return false;
  const on = onConditionToggles(s);
  if (on.length !== a.on.length || on.some((id, i) => id !== a.on[i])) return true;
  return Object.entries(a.params).some(([k, v]) =>
    JSON.stringify(params[k as keyof ArtifactParams]) !== JSON.stringify(v));
}

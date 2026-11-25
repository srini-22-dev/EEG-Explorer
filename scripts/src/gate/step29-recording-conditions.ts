import { defaultArtifactParams, defaultIctalParamsMap, DEFAULT_FILTERS } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
import type { ArtifactParams, ConditionLevel, SimSettings } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
import { SimulationSource } from '../../../artifacts/eeg-simulator/src/engine/adapter';
import { MONTAGES } from '../../../artifacts/eeg-simulator/src/utils/montages';
import { commonAverage, computeChannelVoltage } from '../../../artifacts/eeg-simulator/src/utils/computeChannel';
import { markRowSizes, markRows } from '../../../artifacts/eeg-simulator/src/utils/markRows';
import { initialToggles, effective, switchOff, switchOn, type ToggleState } from '../../../artifacts/eeg-simulator/src/utils/toggleRules';
import { applyLevel, CONDITION_LEVELS, CONDITION_TOGGLES, RECIPES } from '../../../artifacts/eeg-simulator/src/utils/recordingConditions';
import { FS, check, section, step } from './harness';

// ===========================================================================
// Step 29: recording conditions (top bar, 2026-11-25).
//
// A level sets the artifact toggles from its recipe (utils/recordingConditions.ts) and
// the engine's ConditionsDirector decides when they happen (engine/conditions.ts). The
// bounds below are the owner's brief for the levels, not measurements of a record:
//   - "muscle ... kind of constant, so the meta toggle would control the artifact by
//     turning it on and off (off mostly)": boxed less than 30% of the time, and more
//     than 5% so it is seen at all;
//   - blinks "can be left on, but the rate could change": an anxious routine patient
//     blinks more in the first minute than once settled;
//   - the notch "needs to be useful": at ICU bedside, mains buries the occipital rows
//     (at least twice their background) and the notch gives them back (at most a
//     quarter of the background left).
// Everything is read as the app runs it: SimulationSource in app mode, the level
// applied through applyLevel, the montage through computeChannelVoltage.
// ===========================================================================
step('\n=== Step 29: recording conditions — what each setting brings, and when ===\n');

type Mark = { id: string; t: number; dur: number; span?: number; key?: string; rows: string[] };

/** An awake patient with the eyes open, at a level: the page the app shows after choosing it. */
function levelPage(level: ConditionLevel): { toggles: ToggleState; params: ArtifactParams } {
  const start = switchOn(initialToggles('awake'), 'eyes-open');
  const r = applyLevel(level, start, defaultArtifactParams());
  return { toggles: r.toggles, params: r.params };
}

function run(level: ConditionLevel, on: Set<string>, params: ArtifactParams, secs: number, seed: number,
  montageId = 'bipolar-ap', notch = false) {
  const montage = MONTAGES[montageId];
  const settings: SimSettings = {
    speed: 30, sensitivity: 7, patientState: 'awake', activePatterns: on,
    ictalParams: defaultIctalParamsMap(), artifactParams: params,
    filters: { ...DEFAULT_FILTERS, notchHz: notch ? 50 : null }, conditions: level,
  };
  const src = new SimulationSource(seed, FS);
  src.useAppMode();
  const chans = montage.channels.map((c, i) => ({ c, i })).filter(({ c }) => c.active !== 'ECG');
  const n = secs * FS;
  const data = chans.map(() => new Float64Array(n));
  const marks: Mark[] = [];
  for (let i = 0; i < n; i++) {
    const v = src.next(settings);
    const avg = commonAverage(v);
    chans.forEach(({ c }, k) => { data[k][i] = computeChannelVoltage(c, src.t, v, avg); });
    for (const m of src.groundTruth.marks) {
      const t = i / FS - (m.ago ?? 0);
      const open = m.key != null ? marks.find((o) => o.key === m.key && o.span === Infinity) : undefined;
      if (open) { open.span = t - open.t; continue; }
      const rows = m.page ? chans.map(({ i: c }) => c)
        : markRows(markRowSizes(m.fields, montage), m.inUv ? settings.sensitivity : undefined, m.span != null ? Infinity : undefined);
      marks.push({ id: m.id, t, dur: m.dur, span: m.span, key: m.key, rows: rows.map((c) => montage.channels[c].label) });
    }
  }
  for (const m of marks) if (m.span === Infinity) m.span = secs - m.t;
  return { chans: chans.map(({ c }) => c.label), data, marks };
}

const SEEDS = [3, 7, 20];
const median = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
const p2p = (x: ArrayLike<number>) => {
  const s = Array.from(x).sort((a, b) => a - b);
  return s[Math.floor(0.99 * (s.length - 1))] - s[Math.floor(0.01 * (s.length - 1))];
};

section('\nWhat each level turns on (an awake patient, eyes open):', () => {
  for (const level of CONDITION_LEVELS) {
    const { toggles } = levelPage(level);
    const on = CONDITION_TOGGLES.filter((id) => effective(toggles).has(id));
    console.log(`  ${RECIPES[level].name.padEnd(18)} ${on.join(', ') || '(none)'}`);
  }
  // Every recipe toggle the awake, eyes-open page can have comes on; Custom leaves the page alone.
  const missing = CONDITION_LEVELS.filter((l) => l !== 'none')
    .flatMap((l) => RECIPES[l].toggles.filter((id) => !effective(levelPage(l).toggles).has(id)));
  check('levels: recipe toggles left off on an awake, eyes-open page', missing.length, 0, 0);
  // A level does not move the patient: chosen in N2 it brings no blinks and leaves the stage.
  const n2 = applyLevel('worst', initialToggles('n2'), defaultArtifactParams()).toggles;
  check('levels: Worst case chosen in N2 keeps N2 (a level never wakes the patient)', n2.patientState === 'n2' ? 1 : 0, 1, 1);
  check('levels: Worst case chosen in N2 brings no blinks', effective(n2).has('blink') ? 1 : 0, 0, 0);
  const scopes = CONDITION_LEVELS.filter((l) => RECIPES[l].scope.setting && RECIPES[l].scope.appears && RECIPES[l].scope.learn);
  check('levels: with a scope for the information panel', scopes.length, CONDITION_LEVELS.length, CONDITION_LEVELS.length);
});

section('\nIdeal: nothing on the page, whatever was on before:', () => {
  const before = ['muscle', '50hz', 'blink', 'electrode-pop', 'bad-electrodes'].reduce((s, id) => switchOn(s, id), initialToggles('awake'));
  const r = applyLevel('ideal', before, defaultArtifactParams());
  const out = run('ideal', effective(r.toggles), r.params, 120, 3);
  const artifactIds = new Set<string>([...CONDITION_TOGGLES, 'eye-closing', 'eye-opening']);
  check('ideal: artifact marks in 120 s', out.marks.filter((m) => artifactIds.has(m.id)).length, 0, 0);
});

section('\nRoutine: muscle in episodes, mostly off, settling; blinks that settle:', () => {
  const SECS = 300;
  const { toggles, params } = levelPage('routine');
  const shares: number[] = [], episodes: number[] = [], inside: number[] = [];
  let early = 0, late = 0, blinkEarly = 0, blinkLate = 0;
  for (const seed of SEEDS) {
    const on = run('routine', effective(toggles), params, SECS, seed);
    const off = run('routine', effective(switchOff(toggles, 'muscle')), params, SECS, seed);
    const boxes = on.marks.filter((m) => m.id === 'muscle' && m.span != null);
    const boxed = (t: number) => boxes.some((m) => t >= m.t && t <= m.t + m.span!);
    const n = SECS * FS;
    let nBoxed = 0;
    for (let i = 0; i < n; i++) if (boxed(i / FS)) nBoxed++;
    shares.push(nBoxed / n);
    episodes.push(boxes.length);
    // Display space: where the muscle is on the page, by its own on-minus-off contribution on the temporal rows.
    let all = 0, inBox = 0;
    for (const k of on.chans.map((l, k) => (/^F7-T3|^F8-T4/.test(l) ? k : -1)).filter((k) => k >= 0)) {
      for (let i = 0; i < n; i++) {
        const d = (on.data[k][i] - off.data[k][i]) ** 2;
        all += d; if (boxed(i / FS)) inBox += d;
      }
    }
    inside.push(inBox / all);
    const boxedIn = (a: number, b: number) => boxes.reduce((s, m) => s + Math.max(0, Math.min(b, m.t + m.span!) - Math.max(a, m.t)), 0);
    early += boxedIn(0, 60) / 60; late += boxedIn(180, 300) / 120;
    const blinks = on.marks.filter((m) => m.id === 'blink');
    blinkEarly += blinks.filter((m) => m.t < 60).length; blinkLate += blinks.filter((m) => m.t >= 180).length / 2;
  }
  check('routine: share of the record with muscle boxed, median of 3 (owner: "off mostly")', median(shares), 0.05, 0.3);
  check('routine: muscle episodes in 300 s, fewest of 3', Math.min(...episodes), 2, Infinity);
  check('routine: share of the temporal rows\' muscle energy inside its boxes, worst of 3', Math.min(...inside), 0.95, 1);
  check('routine: muscle in the first minute / in minutes 3-5, 3 subjects pooled (the patient settles)', early / Math.max(late, 1e-9), 1.5, Infinity);
  check('routine: blinks per minute in the first minute / in minutes 3-5, 3 subjects pooled', blinkEarly / Math.max(blinkLate, 1e-9), 1.2, Infinity);
});

section('\nICU bedside: mains buries the back of the head, and the notch gives it back:', () => {
  const SECS = 20;
  const { toggles, params } = levelPage('icu');
  const occipital = (l: string) => /O[12]$/.test(l);
  const buried: number[] = [], left: number[] = [];
  for (const seed of SEEDS) {
    const without = effective(switchOff(toggles, '50hz'));
    const on = run('icu', effective(toggles), params, SECS, seed), off = run('icu', without, params, SECS, seed);
    const onN = run('icu', effective(toggles), params, SECS, seed, 'bipolar-ap', true);
    const offN = run('icu', without, params, SECS, seed, 'bipolar-ap', true);
    const skip = 3 * FS; // the filters settled
    const rowsB: number[] = [], rowsL: number[] = [];
    on.chans.forEach((l, k) => {
      if (!occipital(l)) return;
      const bg = p2p(off.data[k].slice(skip));
      rowsB.push(p2p(on.data[k].slice(skip).map((v, i) => v - off.data[k][i + skip])) / bg);
      rowsL.push(p2p(onN.data[k].slice(skip).map((v, i) => v - offN.data[k][i + skip])) / bg);
    });
    buried.push(median(rowsB));
    left.push(median(rowsL));
  }
  check('icu: mains on the occipital rows / their own background, peak to peak, median row, smallest of 3 (it buries them)',
    Math.min(...buried), 2, Infinity);
  // The median row: a bad contact's own rows keep some (the 100 Hz harmonic), as they
  // should — the notch does not rescue a bad electrode, re-gelling does.
  check('icu: with the notch on, mains left / the background, median occipital row, worst of 3 subjects (readable again)',
    Math.max(...left), 0, 0.25);
});

section('\nEvery level annotates what it draws (each artifact\'s events under an arrow or a box):', () => {
  const SECS = 40;
  for (const level of CONDITION_LEVELS.filter((l) => l !== 'none' && l !== 'ideal')) {
    const { toggles, params } = levelPage(level);
    const page = effective(toggles);
    let unmarked = 0, events = 0;
    for (const id of CONDITION_TOGGLES.filter((x) => page.has(x)) as string[]) {
      const on = run(level, page, params, SECS, 3), off = run(level, effective(switchOff(toggles, id)), params, SECS, 3);
      const ids = new Set([id]);
      const marks = on.marks.filter((m) => ids.has(m.id));
      const n = SECS * FS;
      // Stretches where this artifact moves any row by 2 mm (14 uV at 7 uV/mm), joined across 0.4 s gaps.
      const out: [number, number][] = [];
      let start = -1, last = -1;
      for (let i = 0; i < n; i++) {
        let hit = false;
        for (let k = 0; k < on.data.length; k++) if (Math.abs(on.data[k][i] - off.data[k][i]) >= 14) { hit = true; break; }
        if (hit) { if (start < 0) start = i; last = i; } else if (start >= 0 && i - last > 0.4 * FS) { out.push([start / FS, last / FS]); start = -1; }
      }
      if (start >= 0) out.push([start / FS, last / FS]);
      events += out.length;
      unmarked += out.filter(([a, b]) => !marks.some((m) => (m.span != null
        ? m.t <= b + 0.15 && m.t + m.span >= a - 0.15
        : m.t + m.dur >= a - 0.15 && m.t <= b + 0.15))).length;
    }
    console.log(`  ${RECIPES[level].name}: ${events} events`);
    check(`by design, ${RECIPES[level].name}: artifact events with no arrow or box`, unmarked, 0, 0);
  }
});

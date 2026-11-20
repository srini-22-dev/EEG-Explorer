/**
 * Renders the example image for every toggle's information panel (InfoPanel.tsx)
 * through the real engine and the real display transform (renderTrace.ts), and
 * writes the layout the panel needs to label the rows.
 *
 *   pnpm --filter @workspace/scripts exec tsx ./src/renderPatternGallery.ts [id ...]
 *
 * Each toggle is shown the way the quiz shows it — alone, in the state its toggle
 * rules choose (`quizPage`), with the app's default pattern options and filters —
 * on a 6 s window starting shortly before the first event it annotates. Toggles with no discrete event, or whose interesting moment is
 * not their first event, carry an override below. Output:
 *   artifacts/eeg-simulator/public/pattern-info/<id>.png
 *   artifacts/eeg-simulator/src/utils/patternGallery.json  (read through patternGallery.ts)
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderTrace } from './renderTrace';
import { SimulationSource } from '../../artifacts/eeg-simulator/src/engine/adapter';
import { PATTERN_CATEGORIES } from '../../artifacts/eeg-simulator/src/utils/patterns';
import { quizPage, effective } from '../../artifacts/eeg-simulator/src/utils/toggleRules';
import type { GalleryEntry } from '../../artifacts/eeg-simulator/src/utils/patternGallery';
import {
  defaultArtifactParams, defaultIctalParamsMap, DEFAULT_FILTERS,
  POSTS_SMALLER_DEFAULT, POSTS_ONE_SIDE_DEFAULT,
  type SimSettings, type PatternOptions, type Sensitivity,
} from '../../artifacts/eeg-simulator/src/utils/simTypes';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '../../artifacts/eeg-simulator');
const OUT_DIR = join(APP, 'public/pattern-info');
const MANIFEST = join(APP, 'src/utils/patternGallery.json');
const FS = 250;
const SEED = 20;
const SECONDS = 6;

// The app's initial pattern options (App.tsx).
const APP_OPTIONS: PatternOptions = {
  postsForm: 'singles', focalPlacement: 'under', seizureMuscle: true, kcSpindle: 'sometimes',
  sixHzForm: 'fold', breachSite: 'C4', pos146Sides: 'shifting',
  postsSmallerPct: POSTS_SMALLER_DEFAULT, postsOneSidePct: POSTS_ONE_SIDE_DEFAULT,
};

type Shot = {
  /** Start the window at this many seconds instead of before the first event. */
  at?: number;
  /** Start this long after the first event rather than 1.5 s before it. */
  afterEvent?: number;
  montage?: string;
  sensitivity?: Sensitivity;
  seconds?: number;
  /** Show a run of at least this many seconds rather than the first event of any kind. */
  minSpan?: number;
  /** Low cut for this picture, where the app's 1 Hz would hide what it shows. */
  lowCutHz?: number;
};
// Patterns that are a background rather than an event, and those whose first
// event is not the moment worth showing.
const SHOTS: Record<string, Shot> = {
  'slow-waves': { at: 20 },
  'gen-slowing': { at: 20 },
  'muscle': { at: 8 },
  'bad-electrodes': { at: 8 },
  '50hz': { at: 8 },
  // Sweat is slower than the app's 1 Hz low cut passes; a reader lowers it to see sweat.
  'sweat': { at: 20, seconds: 10, lowCutHz: 0.25 },
  'wicket': { minSpan: 2 },
  'absence-ictal': { afterEvent: -1, sensitivity: 15 },
  '3hz-gsw': { sensitivity: 15 },
  'polyspike-wave': { sensitivity: 15 },
  'ecg-artifact': { at: 8, montage: 'reference-ipsi' },
  'roving-eyes': { seconds: 10 },
  'eyes-open': { at: 8 },
  '14-6-pos': { montage: 'reference-ipsi' },
  'gtc-ictal': { afterEvent: 14, sensitivity: 15 },
  'focal-temporal-ictal': { afterEvent: 12 },
  'focal-frontal-ictal': { afterEvent: 8 },
  'burst-suppression': { at: 20, seconds: 10 },
  'hypsarrhythmia': { at: 20, sensitivity: 30 },
  'photic': { at: 40 },
  'hyperventilation': { at: 150 },
  'gpeds': { at: 20 },
  'lpeds': { at: 20 },
  'triphasic': { at: 20 },
};

function settingsFor(id: string): SimSettings {
  const page = quizPage([id]);
  const lowCutHz = SHOTS[id]?.lowCutHz;
  return {
    speed: 30, sensitivity: SHOTS[id]?.sensitivity ?? 7, patientState: page.patientState,
    activePatterns: effective(page), ictalParams: defaultIctalParamsMap(),
    artifactParams: { ...defaultArtifactParams() }, patternOptions: APP_OPTIONS,
    filters: lowCutHz == null ? DEFAULT_FILTERS : { ...DEFAULT_FILTERS, lowCutHz },
  };
}

/** Seconds into the record of the first mark of `id` after `from` s, or null. */
function firstEvent(id: string, settings: SimSettings, from: number, limit: number, minSpan = 0): number | null {
  const src = new SimulationSource(SEED, FS);
  src.useAppMode();
  for (let i = 0; i < limit * FS; i++) {
    src.next(settings);
    for (const m of src.groundTruth.marks) {
      const t = src.t - (m.ago ?? 0);
      if (t >= from && (m.id === id || m.id.startsWith(id)) && (minSpan === 0 || (m.span ?? 0) >= minSpan)) return t;
    }
  }
  return null;
}

type Entry = GalleryEntry;

const want = process.argv.slice(2);
const ids = PATTERN_CATEGORIES.flatMap(c => c.patterns.map(p => p.id)).filter(id => !want.length || want.includes(id));
mkdirSync(OUT_DIR, { recursive: true });

// Keep entries for ids not re-rendered this run.
const manifest: Record<string, Entry> = {};
if (existsSync(MANIFEST)) {
  Object.assign(manifest, JSON.parse(readFileSync(MANIFEST, 'utf8')));
}

for (const id of ids) {
  const shot = SHOTS[id] ?? {};
  const settings = settingsFor(id);
  const seconds = shot.seconds ?? SECONDS;
  let start = shot.at;
  if (start == null) {
    // An event once the page has settled; failing that, the one a toggle fires as it
    // is switched on.
    const ev = firstEvent(id, settings, 3, 90, shot.minSpan) ?? firstEvent(id, settings, 0, 90, shot.minSpan);
    start = ev == null ? 10 : Math.max(0, ev + (shot.afterEvent ?? -1.5));
    if (ev == null) console.warn(`  ${id}: no event found in 90 s; showing 10 s in`);
  }
  const file = `pattern-info/${id}.png`;
  const res = renderTrace({
    montage: shot.montage ?? 'bipolar-ap', state: settings.patientState, patterns: [...settings.activePatterns],
    patternOptions: APP_OPTIONS, filters: settings.filters, seed: SEED, skipSeconds: start, seconds,
    sensitivity: settings.sensitivity, appMode: true, out: join(APP, 'public', file),
  });
  manifest[id] = {
    file, montage: shot.montage ?? 'bipolar-ap', state: settings.patientState,
    sensitivity: settings.sensitivity, seconds,
    lowCutHz: settings.filters!.lowCutHz, highCutHz: settings.filters!.highCutHz,
    rows: res.channels.map(c => ({ label: c.label, y: +(res.baselineY[c.index] / res.height).toFixed(4) })),
  };
  console.log(`${id.padEnd(22)} ${settings.patientState.padEnd(7)} from ${start.toFixed(1)} s  -> ${file}`);
}

// One toggle per line, so a regenerated image shows as a one-line diff.
writeFileSync(MANIFEST, '{\n' + Object.entries(manifest)
  .map(([id, entry]) => `  ${JSON.stringify(id)}: ${JSON.stringify(entry)}`).join(',\n') + '\n}\n');
console.log(`\n${ids.length} images; manifest ${MANIFEST}`);

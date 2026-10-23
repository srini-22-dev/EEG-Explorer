/**
 * Render an engine corpus WITH ITS ANSWERS, for scoring image-reading methods.
 *
 * WHY
 * ---
 * The reading lab (scripts/read-lab) gets better only as fast as it can be scored,
 * and a reference figure from the web carries at most a caption's worth of truth.
 * An engine page can carry all of it: every row's baseline, the exact samples
 * drawn, the subject's alpha frequency. So every page written here has a truth
 * file beside it, and any method run on the PNG can be scored against the
 * page it was run on — not against a re-derivation of it.
 *
 * Truth is read from what the renderer returns (`baselineY`, `labelStripPx`,
 * `data`), i.e. the numbers it actually drew with, never from a parallel
 * re-simulation that could drift from it.
 *
 * Both renderers are used. `renderTrace` is the app's page (the one the learner
 * sees); `renderClinicalPage` is white paper with square millimetres (the one to
 * lay beside a published figure). A method that works on only one of them has
 * learned the paper, not the EEG.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx ./src/readCorpus.ts --out ../scripts/read-lab/corpus/engine
 *   pnpm --filter @workspace/scripts exec tsx ./src/readCorpus.ts --blind 10 --blind-seed 7 \
 *     --out ../scripts/read-lab/corpus/blind --truth ../scripts/read-lab/corpus/blind-truth
 *
 * In --blind mode the pages get random ids and their truth goes to a separate
 * directory, and NOTHING about any page's conditions is printed — the point is a
 * reader who has not seen the answers. Do not open the truth directory until
 * the answers are written.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { renderTrace } from './renderTrace';
import { renderClinicalPage } from './renderClinicalPage';
import { welch, spectralPeak } from './dsp';
import { MONTAGES, type ChannelDef } from '../../artifacts/eeg-simulator/src/utils/montages';
import { sampleSubject } from '../../artifacts/eeg-simulator/src/engine/engine';
import { MM_PER_ROW } from '../../artifacts/eeg-simulator/src/utils/displayGeometry';
import type { PatientState, Sensitivity, Speed } from '../../artifacts/eeg-simulator/src/utils/simTypes';
import { Gaussian } from '../../artifacts/eeg-simulator/src/engine/rng';
import { SimulationSource } from '../../artifacts/eeg-simulator/src/engine/adapter';
import { defaultArtifactParams, defaultIctalParamsMap, type SimSettings } from '../../artifacts/eeg-simulator/src/utils/simTypes';

type Renderer = 'app' | 'clinical';
interface Spec {
  renderer: Renderer; montage: string; state: PatientState; patterns: string[];
  seed: number; skip: number; sensitivity: Sensitivity; speed: Speed; seconds: number;
}

// Bands as the app defines them (utils/fftBands.ts).
const BANDS: Array<[string, number, number]> = [
  ['delta', 0.5, 4], ['theta', 4, 8], ['alpha', 8, 13], ['beta', 13, 30], ['gamma', 30, 50],
];

function rowTruth(x: Float64Array, fs: number) {
  const sorted = Array.from(x).sort((a, b) => a - b);
  const n = sorted.length;
  const p2p = sorted[Math.floor(0.99 * n)] - sorted[Math.floor(0.01 * n)];
  let ss = 0; for (const v of x) ss += v * v;
  const psd = welch(x, fs, 1024);
  const pow: Record<string, number> = {};
  let tot = 0;
  for (const [name, lo, hi] of BANDS) {
    let s = 0;
    for (let k = 0; k < psd.freqs.length; k++) if (psd.freqs[k] >= lo && psd.freqs[k] < hi) s += psd.power[k];
    pow[name] = s; tot += s;
  }
  const share: Record<string, number> = {};
  for (const k of Object.keys(pow)) share[k] = pow[k] / tot;
  return { p2pUv: p2p, rmsUv: Math.sqrt(ss / n), bandShare: share, alphaPeakHz: spectralPeak(psd, 6, 14).freq };
}

function renderOne(spec: Spec, file: string, keepSamples: string[] = []) {
  const montage = MONTAGES[spec.montage];
  const common = {
    state: spec.state, patterns: spec.patterns, seed: spec.seed, skipSeconds: spec.skip,
    seconds: spec.seconds, out: file,
  };
  const r = spec.renderer === 'app'
    ? renderTrace({ ...common, montage: spec.montage, sensitivity: spec.sensitivity, speed: spec.speed })
    : renderClinicalPage({ ...common, channels: montage.channels as ChannelDef[],
        sensitivity: spec.sensitivity, speed: spec.speed });
  const chans = montage.channels;
  const scalp = chans.map((c, i) => i).filter(i => chans[i].active !== 'ECG');
  // Pitch = the baseline spacing between adjacent rows of the SAME group, i.e. one
  // row-height on this page — the unit the reference file's methods work in.
  const gaps: number[] = [];
  for (let i = 1; i < chans.length; i++) {
    if (chans[i].group === chans[i - 1].group) gaps.push(r.baselineY[i] - r.baselineY[i - 1]);
  }
  gaps.sort((a, b) => a - b);
  const pitchPx = gaps[Math.floor(gaps.length / 2)];
  const S = sampleSubject(spec.seed);
  return {
    ...spec,
    file: file.split(/[\\/]/).pop(),
    width: r.width, height: r.height,
    pxPerSec: r.pxPerSec, pxPerMm: r.pxPerMm, pxPerUV: r.pxPerUV,
    labelStripPx: r.labelStripPx, pitchPx,
    // One clinical row is MM_PER_ROW mm of paper; on the app page the pitch can differ
    // from that (EEGCanvas stretches rows to the canvas), so both are recorded.
    mmPerRow: MM_PER_ROW,
    subject: { iaf: S.iaf, alphaRms: S.alphaRms, muFraction: S.muFraction, exponent: S.exponent },
    fs: r.fs,
    // The drawn samples of selected rows, when a scorer needs to compute a truth
    // quantity with the SAME estimator it runs on the traced pixels.
    samples: Object.fromEntries(keepSamples.map(l => {
      const i = chans.findIndex(c => c.label === l);
      return [l, Array.from(r.data[i], v => Math.round(v * 100) / 100)];
    })),
    rows: scalp.map(i => {
      const t = rowTruth(r.data[i], r.fs);
      return {
        index: i, label: chans[i].label, group: chans[i].group, baselineY: r.baselineY[i],
        ...t,
        p2pPx: t.p2pUv * r.pxPerUV,
        p2pRowHeights: (t.p2pUv * r.pxPerUV) / pitchPx,
      };
    }),
  };
}

function grid(): Spec[] {
  const out: Spec[] = [];
  for (const renderer of ['app', 'clinical'] as Renderer[])
    for (const montage of ['bipolar-ap', 'reference-ipsi'])
      for (const state of ['awake', 'drowsy', 'n2'] as PatientState[])
        for (const seed of [3, 42, 1234])
          for (const skip of [0, 45])
            for (const sensitivity of [7, 15] as Sensitivity[])
              out.push({ renderer, montage, state, patterns: [], seed, skip, sensitivity, speed: 30, seconds: 10 });
  return out;
}

// Blind pool: wider than the grid, so a reader cannot lean on having seen the grid.
const BLIND_STATES: PatientState[] = ['awake', 'drowsy', 'n1', 'n2', 'n3', 'rem'];
const BLIND_PATTERNS: string[][] = [
  [], [], [], ['blink'], ['muscle'], ['eye-movement'], ['mu-rhythm'], ['focal-spikes-lt'],
  ['focal-delta-temporal'], ['gen-slowing'], ['3hz-gsw'], ['firda'],
];
function blindSpecs(n: number, seed: number): Spec[] {
  const g = new Gaussian(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(g.uniform() * xs.length)];
  const out: Spec[] = [];
  for (let k = 0; k < n; k++) {
    out.push({
      renderer: pick(['app', 'clinical'] as Renderer[]),
      montage: pick(['bipolar-ap', 'reference-ipsi', 'bipolar-transverse']),
      state: pick(BLIND_STATES), patterns: pick(BLIND_PATTERNS),
      seed: 1 + Math.floor(g.uniform() * 1e6), skip: Math.floor(g.uniform() * 90),
      sensitivity: pick([5, 7, 10, 15] as Sensitivity[]), speed: 30, seconds: 10,
    });
  }
  return out;
}

// When were the eyes open on this page? Neither renderer reports it, so a parallel
// SimulationSource is driven exactly as they drive theirs (same seed, settings and
// skip); the engine is deterministic, so its groundTruth.eyesOpen is the page's.
function openIntervals(spec: Spec): Array<[number, number]> {
  const FS = 250;
  const settings: SimSettings = {
    speed: spec.speed, sensitivity: spec.sensitivity, patientState: spec.state,
    activePatterns: new Set(spec.patterns), ictalParams: defaultIctalParamsMap(),
    artifactParams: { ...defaultArtifactParams() },
  };
  const src = new SimulationSource(spec.seed, FS);
  for (let i = 0; i < Math.floor(spec.skip * FS); i++) src.next(settings);
  const out: Array<[number, number]> = [];
  let start = -1;
  const n = Math.floor(spec.seconds * FS);
  for (let i = 0; i < n; i++) {
    src.next(settings);
    const open = src.groundTruth.eyesOpen > 0.5;
    if (open && start < 0) start = i / FS;
    if (!open && start >= 0) { out.push([start, i / FS]); start = -1; }
  }
  if (start >= 0) out.push([start, n / FS]);
  return out;
}

// Reactivity pages: the eye-opening maneuver on, and the same subjects with it off
// as the control a reactivity reader must not find openings in.
function reactivitySpecs(): Spec[] {
  const out: Spec[] = [];
  for (const renderer of ['clinical', 'app'] as Renderer[])
    for (const seed of [3, 42, 1234, 777, 2024, 11])
      for (const patterns of [['eye-opening'], []])
        out.push({ renderer, montage: 'bipolar-ap', state: 'awake', patterns, seed, skip: 0,
          sensitivity: 7, speed: 30, seconds: 30 });
  return out;
}

function main() {
  const a = process.argv.slice(2);
  const arg = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const outDir = arg('--out') ?? 'corpus-engine';
  const blindN = arg('--blind') ? Number(arg('--blind')) : 0;
  mkdirSync(outDir, { recursive: true });

  if (a.includes('--reactivity')) {
    for (const s of reactivitySpecs()) {
      const id = [s.renderer, s.state, `s${s.seed}`, s.patterns.length ? 'eyeopen' : 'control'].join('_');
      const t = renderOne(s, join(outDir, `${id}.png`), ['P3-O1', 'P4-O2', 'T5-O1', 'T6-O2']);
      writeFileSync(join(outDir, `${id}.json`), JSON.stringify({ id, ...t, openIntervals: openIntervals(s) }));
    }
    console.log(`wrote ${reactivitySpecs().length} reactivity pages + truth to ${outDir}`);
    return;
  }

  if (blindN > 0) {
    const truthDir = arg('--truth');
    if (!truthDir) throw new Error('--blind needs --truth <dir>, kept apart from --out');
    mkdirSync(truthDir, { recursive: true });
    const specs = blindSpecs(blindN, Number(arg('--blind-seed') ?? Date.now() % 1e9));
    for (const s of specs) {
      const id = randomBytes(4).toString('hex');
      const t = renderOne(s, join(outDir, `${id}.png`));
      writeFileSync(join(truthDir, `${id}.json`), JSON.stringify({ id, ...t }, null, 1));
      console.log(id);   // the id only — never the conditions
    }
    return;
  }

  const specs = grid();
  const index: object[] = [];
  for (const s of specs) {
    const id = [s.renderer, s.montage, s.state, `s${s.seed}`, `t${s.skip}`, `${s.sensitivity}uV`].join('_');
    const t = renderOne(s, join(outDir, `${id}.png`));
    writeFileSync(join(outDir, `${id}.json`), JSON.stringify({ id, ...t }, null, 1));
    index.push({ id, renderer: s.renderer, montage: s.montage, state: s.state, seed: s.seed,
      skip: s.skip, sensitivity: s.sensitivity, iaf: t.subject.iaf, pitchPx: t.pitchPx });
  }
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1));
  console.log(`wrote ${specs.length} pages + truth to ${outDir}`);
}

main();

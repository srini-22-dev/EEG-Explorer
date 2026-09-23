/**
 * Headless "clinician's-eye" renderer for the EEG engine.
 *
 * WHY THIS EXISTS
 * ---------------
 * `validateEngine.ts` reads the engine's *referential* output and reduces it to
 * scalars (band power, correlations, envelopes). That is not what a reader looks
 * at. The trace on the page is the **montage-derived** channel
 * (`computeChannelVoltage` + `commonAverage`) painted **negative-up**
 * (`traceY`: `y = centerY + v * scale`, from `displayGeometry.ts` — the ECG row
 * is the one exception, via `ecgScale`'s negated scale), calibrated in µV/mm and
 * mm/s. Morphology, polarity and the spatial gradient — the things the eye
 * judges — live entirely in that display transform, which the validator never
 * exercises.
 *
 * This module closes that gap. It drives the *real* engine through the *real*
 * display transform — importing `PX_PER_MM_X`, `MM_PER_ROW`, `pxPerMmFromHeight`,
 * `pxPerUV`, `ecgScale` and `traceY` from `../../artifacts/eeg-simulator/src/
 * utils/displayGeometry.ts` rather than re-deriving them, so this renderer and
 * `EEGCanvas.tsx` are guaranteed to agree, not merely believed to — and
 * rasterises the result to a PNG you can open. It adds no dependency — the PNG
 * is encoded with Node's built-in `zlib` — so any agent can run it and any
 * reviewer can look at the same picture the app draws.
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx ./src/renderTrace.ts \
 *     --state awake --patterns blink --seconds 6 --out blink.png
 *
 * or import `renderTrace(opts)` and read the returned per-channel summary.
 */

import { writeFileSync } from 'node:fs';

import { Raster, encodePNG, hexToRgb, type RGB } from './raster';

import { SimulationSource } from '../../artifacts/eeg-simulator/src/engine/adapter';
import { MONTAGES, GROUP_COLORS, type Montage } from '../../artifacts/eeg-simulator/src/utils/montages';
import { commonAverage, computeChannelVoltage } from '../../artifacts/eeg-simulator/src/utils/computeChannel';
import {
  defaultArtifactParams, defaultIctalParamsMap,
  type SimSettings, type PatientState, type ArtifactParams, type IctalParamsMap,
} from '../../artifacts/eeg-simulator/src/utils/simTypes';
import {
  PX_PER_MM_X,
  MM_PER_ROW,
  MINOR_GRID_PX,
  pxPerMmFromHeight,
  pxPerUV as calcPxPerUV,
  ecgScale,
  traceY,
} from '../../artifacts/eeg-simulator/src/utils/displayGeometry';

// ── Geometry: PX_PER_MM_X / MM_PER_ROW / pxPerMmFromHeight / pxPerUV /
// ecgScale / traceY all come from displayGeometry.ts — the single definition
// shared with EEGCanvas.tsx, not a copy. That sharing is the point: it is
// what lets validateEngine.ts assert on production geometry through this
// renderer instead of through a hand-synced constant. ─────────────────────
const GAP_UNITS = 0.40; // fractional row-height gap between chain groups
const FS = 250;

// ── Montage row layout, copied verbatim from EEGCanvas.buildLayout ───────────
type RowLayout = { channelIndex: number; centerFrac: number; rowFrac: number };
function buildLayout(montage: Montage): RowLayout[] {
  const rows: Array<{ channelIndex: number }> = [];
  let lastGroup: string | null = null;
  for (let i = 0; i < montage.channels.length; i++) {
    const g = montage.channels[i].group;
    if (lastGroup !== null && g !== lastGroup && g !== 'ecg') rows.push({ channelIndex: -1 });
    rows.push({ channelIndex: i });
    lastGroup = g;
  }
  const total = rows.reduce((s, r) => s + (r.channelIndex < 0 ? GAP_UNITS : 1), 0);
  let cum = 0;
  return rows.map(r => {
    const frac = r.channelIndex < 0 ? GAP_UNITS / total : 1 / total;
    const layout: RowLayout = { channelIndex: r.channelIndex, centerFrac: cum + frac / 2, rowFrac: frac };
    cum += frac;
    return layout;
  });
}

// A tiny 3×5 digit font, just enough to number the rows so a reviewer can map a
// row in the image to a channel label in the printed legend without counting.
const DIGITS: Record<string, number[]> = {
  '0': [0b111, 0b101, 0b101, 0b101, 0b111],
  '1': [0b010, 0b110, 0b010, 0b010, 0b111],
  '2': [0b111, 0b001, 0b111, 0b100, 0b111],
  '3': [0b111, 0b001, 0b111, 0b001, 0b111],
  '4': [0b101, 0b101, 0b111, 0b001, 0b001],
  '5': [0b111, 0b100, 0b111, 0b001, 0b111],
  '6': [0b111, 0b100, 0b111, 0b101, 0b111],
  '7': [0b111, 0b001, 0b010, 0b010, 0b010],
  '8': [0b111, 0b101, 0b111, 0b101, 0b111],
  '9': [0b111, 0b101, 0b111, 0b001, 0b111],
};
function drawNum(r: Raster, x: number, y: number, n: number, c: RGB) {
  const s = String(n);
  for (let k = 0; k < s.length; k++) {
    const glyph = DIGITS[s[k]]; if (!glyph) continue;
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 3; col++)
        if (glyph[row] & (1 << (2 - col))) r.px(x + k * 4 + col, y + row, c);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────
export interface RenderOpts {
  montage?: string;                    // MONTAGES key, default 'bipolar-ap'
  state?: PatientState;                // default 'awake'
  patterns?: string[];                 // active toggle ids
  seconds?: number;                    // default 6
  seed?: number;                       // default 42 (deterministic)
  // Seconds to advance the engine through and DISCARD before capturing. The
  // record varies enormously moment to moment — a burst, a waxing alpha run or a
  // quiet stretch can each dominate an eight-second window — so judging a change
  // from one window of one seed is judging one draw from a wide distribution.
  // This makes "same subject, different moment" samplable, which together with
  // varying `seed` ("different subject") is what an honest visual check needs.
  skipSeconds?: number;                // default 0
  sensitivity?: SimSettings['sensitivity']; // µV/mm, default 7
  speed?: SimSettings['speed'];        // mm/s, default 30
  pxPerMm?: number;                    // vertical px per mm, default 4
  artifactParams?: Partial<ArtifactParams>;
  ictalParams?: IctalParamsMap;
  out?: string;                        // PNG path
}

export interface ChannelSummary {
  index: number; label: string; group: string;
  rms: number;        // µV
  peakSigned: number; // µV, largest-|value| sample WITH sign (display space: +down)
  peakAtSec: number;
}

export interface RenderResult {
  file: string; width: number; height: number;
  channels: ChannelSummary[];
  // Geometry factors actually used to place this render's pixels — exposed (not
  // just re-derivable by a caller) so a validator can assert the calibration
  // relationships (CLAUDE.md §4: 30 mm/s -> 120 px/s at PX_PER_MM_X=4; mm = µV /
  // sensitivity) against the real production numbers rather than a reimplementation.
  pxPerSec: number;  // horizontal: speed(mm/s) * PX_PER_MM_X
  pxPerMm: number;   // vertical: px per mm of paper (screen/raster density)
  pxPerUV: number;   // vertical: pxPerMm / sensitivity(µV/mm) — the µV-to-px scale
  // What a reader of the IMAGE has to estimate, given exactly — so an image-reading
  // method (scripts/read-lab) can be scored against the page it was run on rather
  // than against a re-derivation of it. Indexed like `channels`.
  labelStripPx: number;     // x at which the trace field starts
  baselineY: number[];      // px, each row's zero line
  fs: number;               // sample rate of `data`
  data: Float64Array[];     // the display-space µV actually drawn, one array per channel
}

export function renderTrace(opts: RenderOpts = {}): RenderResult {
  const montageId = opts.montage ?? 'bipolar-ap';
  const montage = MONTAGES[montageId];
  if (!montage) throw new Error(`unknown montage '${montageId}' (have: ${Object.keys(MONTAGES).join(', ')})`);

  const state: PatientState = opts.state ?? 'awake';
  const seconds = opts.seconds ?? 6;
  const seed = opts.seed ?? 42;
  const sensitivity = opts.sensitivity ?? 7;
  const speed = opts.speed ?? 30;
  const targetPxPerMm = opts.pxPerMm ?? 4;
  const out = opts.out ?? `trace-${montageId}-${state}.png`;

  const settings: SimSettings = {
    speed, sensitivity, patientState: state,
    activePatterns: new Set(opts.patterns ?? []),
    ictalParams: opts.ictalParams ?? defaultIctalParamsMap(),
    artifactParams: { ...defaultArtifactParams(), ...(opts.artifactParams ?? {}) },
  };

  // ── Drive the real engine through the real display transform ──
  const src = new SimulationSource(seed, FS);
  const skip = Math.max(0, Math.floor((opts.skipSeconds ?? 0) * FS));
  let t0 = 0;
  for (let i = 0; i < skip; i++) src.next(settings);
  const nCh = montage.channels.length;
  const n = Math.floor(seconds * FS);
  const data: Float64Array[] = montage.channels.map(() => new Float64Array(n));
  const times = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const allV = src.next(settings);
    const avg = commonAverage(allV);
    for (let c = 0; c < nCh; c++) data[c][i] = computeChannelVoltage(montage.channels[c], src.t, allV, avg);
    // Relative to the first CAPTURED sample, not to engine time zero. `skipSeconds`
    // advances the engine before capture, and x is drawn as `times[j] * pxPerSec`,
    // so storing absolute time would place the whole trace off the right edge —
    // which it did, rendering an empty grid, until this was fixed.
    if (i === 0) t0 = src.t;
    times[i] = src.t - t0;
  }

  // ── Geometry (shared with EEGCanvas via displayGeometry.ts) ──
  const layout = buildLayout(montage);
  const totalRowUnits = layout.reduce((s, r) => s + (r.channelIndex < 0 ? GAP_UNITS : 1), 0);
  const lblW = 70;
  // Pick a raster height from the requested px/mm, exactly as EEGCanvas's
  // live canvas height implies a px/mm. Then — instead of trusting
  // targetPxPerMm to be what actually gets drawn — read the px/mm back OUT
  // of that height through the same pxPerMmFromHeight() EEGCanvas calls
  // every frame. Math.round(H) can make the two differ by a fraction of a
  // pixel; using the read-back value (not targetPxPerMm) for every
  // downstream calculation is what makes this renderer's numbers the actual
  // production formula rather than a value merely close to it.
  const H = Math.round(totalRowUnits * MM_PER_ROW * targetPxPerMm);
  const pxPerSec = speed * PX_PER_MM_X;
  const W = lblW + Math.round(seconds * pxPerSec);
  const pxPerMm = pxPerMmFromHeight(H, totalRowUnits);
  const pxPerUV = calcPxPerUV(pxPerMm, sensitivity);

  const r = new Raster(W, H);
  const GRID_MINOR: RGB = [232, 230, 220];
  const GRID_MAJOR: RGB = [210, 206, 190];
  const BASELINE: RGB = [220, 218, 208];
  const STRIP_BG: RGB = [240, 238, 230];

  // Horizontal amplitude grid (1 mm minor / 5 mm major)
  for (let mm = 0; mm * pxPerMm < H; mm++) {
    const y = Math.round(mm * pxPerMm);
    r.hline(lblW, W - 1, y, mm % 5 === 0 ? GRID_MAJOR : GRID_MINOR);
  }
  // Vertical grid: minor every 5 mm (MINOR_GRID_PX), major every 1 s — the same
  // rule EEGCanvas draws. This used to step in 0.2 s, which made the grid square
  // a different physical size here than on the page (24 px vs 20 px at 30 mm/s,
  // 8 px vs 20 px at 10 mm/s) and inverted the sign of the error between speeds.
  for (let px = 0; px <= W - lblW; px += MINOR_GRID_PX) {
    r.vline(Math.round(lblW + px), 0, H - 1, GRID_MINOR);
  }
  for (let s = 0; s <= seconds; s++) {
    r.vline(Math.round(lblW + s * pxPerSec), 0, H - 1, GRID_MAJOR);
  }

  // Label strip
  for (let y = 0; y < H; y++) r.hline(0, lblW - 1, y, STRIP_BG);
  r.vline(lblW, 0, H - 1, GRID_MAJOR);

  // Traces + per-channel summary
  const channels: ChannelSummary[] = [];
  const baselineY: number[] = new Array(nCh).fill(NaN);
  for (const row of layout) {
    if (row.channelIndex < 0) continue;
    const i = row.channelIndex;
    const ch = montage.channels[i];
    const isECG = ch.active === 'ECG';
    const centerY = row.centerFrac * H;
    baselineY[i] = centerY;
    // ECG is a limb lead, not a scalp derivation — negative-up does not
    // apply to it, so ecgScale() returns the negated scale (see its doc
    // comment: this is what puts the R wave up). ECG source is in mV.
    const scale = isECG ? ecgScale(pxPerMm) : pxPerUV;
    const color = hexToRgb(GROUP_COLORS[ch.group]);

    r.hline(lblW, W - 1, Math.round(centerY), BASELINE);
    drawNum(r, 4, Math.round(centerY) - 2, i, [90, 90, 90]);

    let px = -1, py = -1;
    let sumSq = 0, peak = 0, peakAt = 0;
    for (let j = 0; j < n; j++) {
      const v = data[i][j];
      if (!isECG) { sumSq += v * v; if (Math.abs(v) > Math.abs(peak)) { peak = v; peakAt = times[j]; } }
      const x = lblW + times[j] * pxPerSec;
      const y = traceY(centerY, v, scale); // shared with EEGCanvas.tsx via displayGeometry.ts
      if (px >= 0) r.line(px, py, x, y, color);
      px = x; py = y;
    }
    channels.push({
      index: i, label: ch.label, group: ch.group,
      rms: isECG ? 0 : Math.sqrt(sumSq / n),
      peakSigned: isECG ? 0 : peak, peakAtSec: peakAt,
    });
  }

  // Calibration bar: 100 µV tall, near the right edge
  {
    const calibPx = Math.round(100 * pxPerUV);
    const cbX = W - 16, cbY = H - 14;
    r.vline(cbX, cbY - calibPx, cbY, [40, 40, 40]);
    r.hline(cbX - 4, cbX + 4, cbY, [40, 40, 40]);
    r.hline(cbX - 4, cbX + 4, cbY - calibPx, [40, 40, 40]);
  }

  writeFileSync(out, encodePNG(W, H, r.data));
  return {
    file: out, width: W, height: H, channels, pxPerSec, pxPerMm, pxPerUV,
    labelStripPx: lblW, baselineY, fs: FS, data,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): RenderOpts {
  const o: RenderOpts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--montage': o.montage = next(); break;
      case '--state': o.state = next() as PatientState; break;
      case '--patterns': o.patterns = next().split(',').map(s => s.trim()).filter(Boolean); break;
      case '--seconds': o.seconds = Number(next()); break;
      case '--seed': o.seed = Number(next()); break;
      case '--skip': o.skipSeconds = Number(next()); break;
      case '--sensitivity': o.sensitivity = Number(next()) as SimSettings['sensitivity']; break;
      case '--speed': o.speed = Number(next()) as SimSettings['speed']; break;
      case '--out': o.out = next(); break;
    }
  }
  return o;
}

// Run when invoked directly (tsx ./src/renderTrace.ts ...)
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('renderTrace.ts')) {
  const opts = parseArgs(process.argv.slice(2));
  const res = renderTrace(opts);
  console.log(`\nwrote ${res.file}  (${res.width}×${res.height})`);
  console.log('row  label       group                signed-peak(µV, +down)  rms(µV)  @s');
  for (const c of res.channels) {
    console.log(
      `  ${String(c.index).padStart(2)}  ${c.label.padEnd(10)}  ${c.group.padEnd(18)}  ` +
      `${c.peakSigned.toFixed(1).padStart(8)}            ${c.rms.toFixed(1).padStart(6)}   ${c.peakAtSec.toFixed(2)}`,
    );
  }
}

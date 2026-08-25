/**
 * Headless "clinician's-eye" renderer for the EEG engine.
 *
 * WHY THIS EXISTS
 * ---------------
 * `validateEngine.ts` reads the engine's *referential* output and reduces it to
 * scalars (band power, correlations, envelopes). That is not what a reader looks
 * at. The trace on the page is the **montage-derived** channel
 * (`computeChannelVoltage` + `commonAverage`) painted **negative-up**
 * (`y = centerY + v`), calibrated in µV/mm and mm/s. Morphology, polarity and the
 * spatial gradient — the things the eye judges — live entirely in that display
 * transform, which the validator never exercises.
 *
 * This module closes that gap. It drives the *real* engine through the *real*
 * display transform (the exact geometry of `EEGCanvas.tsx`) and rasterises the
 * result to a PNG you can open. It adds no dependency — the PNG is encoded with
 * Node's built-in `zlib` — so any agent can run it and any reviewer can look at
 * the same picture the app draws.
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx ./src/renderTrace.ts \
 *     --state awake --patterns blink --seconds 6 --out blink.png
 *
 * or import `renderTrace(opts)` and read the returned per-channel summary.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

import { SimulationSource } from '../../artifacts/eeg-simulator/src/engine/adapter';
import { MONTAGES, GROUP_COLORS, type Montage } from '../../artifacts/eeg-simulator/src/utils/montages';
import { commonAverage, computeChannelVoltage } from '../../artifacts/eeg-simulator/src/utils/computeChannel';
import {
  defaultArtifactParams, defaultIctalParamsMap,
  type SimSettings, type PatientState, type ArtifactParams, type IctalParamsMap,
} from '../../artifacts/eeg-simulator/src/utils/simTypes';

// ── Geometry constants, copied verbatim from EEGCanvas.tsx ───────────────────
const PX_PER_MM_X = 4;    // horizontal pixels per mm
const MM_PER_ROW  = 10;   // each channel row is 10 mm tall
const GAP_UNITS   = 0.40; // fractional row-height gap between chain groups
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

// ── Minimal RGB raster with Bresenham lines (no font libs, no image deps) ────
type RGB = [number, number, number];
class Raster {
  data: Uint8Array;
  constructor(readonly w: number, readonly h: number, bg: RGB = [250, 250, 246]) {
    this.data = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) { this.data[i * 3] = bg[0]; this.data[i * 3 + 1] = bg[1]; this.data[i * 3 + 2] = bg[2]; }
  }
  px(x: number, y: number, c: RGB) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2];
  }
  hline(x0: number, x1: number, y: number, c: RGB) { for (let x = x0; x <= x1; x++) this.px(x, y, c); }
  vline(x: number, y0: number, y1: number, c: RGB) { for (let y = y0; y <= y1; y++) this.px(x, y, c); }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
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

// ── PNG encode (RGB, filter 0, zlib via built-in deflate) ────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type, ch => ch.charCodeAt(0));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes); body.set(data, typeBytes.length);
  const len = data.length;
  const out = new Uint8Array(4 + body.length + 4);
  out[0] = (len >>> 24) & 255; out[1] = (len >>> 16) & 255; out[2] = (len >>> 8) & 255; out[3] = len & 255;
  out.set(body, 4);
  const crc = crc32(body);
  const o = 4 + body.length;
  out[o] = (crc >>> 24) & 255; out[o + 1] = (crc >>> 16) & 255; out[o + 2] = (crc >>> 8) & 255; out[o + 3] = crc & 255;
  return out;
}
function encodePNG(w: number, h: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 6 });
  const ihdr = new Uint8Array(13);
  ihdr[0] = (w >>> 24) & 255; ihdr[1] = (w >>> 16) & 255; ihdr[2] = (w >>> 8) & 255; ihdr[3] = w & 255;
  ihdr[4] = (h >>> 24) & 255; ihdr[5] = (h >>> 16) & 255; ihdr[6] = (h >>> 8) & 255; ihdr[7] = h & 255;
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit, truecolor RGB
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0; for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────
export interface RenderOpts {
  montage?: string;                    // MONTAGES key, default 'bipolar-ap'
  state?: PatientState;                // default 'awake'
  patterns?: string[];                 // active toggle ids
  seconds?: number;                    // default 6
  seed?: number;                       // default 42 (deterministic)
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
  const pxPerMm = opts.pxPerMm ?? 4;
  const out = opts.out ?? `trace-${montageId}-${state}.png`;

  const settings: SimSettings = {
    speed, sensitivity, patientState: state,
    activePatterns: new Set(opts.patterns ?? []),
    ictalParams: opts.ictalParams ?? defaultIctalParamsMap(),
    artifactParams: { ...defaultArtifactParams(), ...(opts.artifactParams ?? {}) },
  };

  // ── Drive the real engine through the real display transform ──
  const src = new SimulationSource(seed, FS);
  const nCh = montage.channels.length;
  const n = Math.floor(seconds * FS);
  const data: Float64Array[] = montage.channels.map(() => new Float64Array(n));
  const times = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const allV = src.next(settings);
    const avg = commonAverage(allV);
    for (let c = 0; c < nCh; c++) data[c][i] = computeChannelVoltage(montage.channels[c], src.t, allV, avg);
    times[i] = src.t;
  }

  // ── Geometry (identical to EEGCanvas) ──
  const layout = buildLayout(montage);
  const totalRowUnits = layout.reduce((s, r) => s + (r.channelIndex < 0 ? GAP_UNITS : 1), 0);
  const lblW = 70;
  const H = Math.round(totalRowUnits * MM_PER_ROW * pxPerMm);
  const pxPerSec = speed * PX_PER_MM_X;
  const W = lblW + Math.round(seconds * pxPerSec);
  const pxPerUV = pxPerMm / sensitivity;

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
  // Vertical time grid (0.2 s minor / 1 s major)
  for (let s = 0; s * 0.2 <= seconds; s++) {
    const t = s * 0.2;
    const x = Math.round(lblW + t * pxPerSec);
    r.vline(x, 0, H - 1, s % 5 === 0 ? GRID_MAJOR : GRID_MINOR);
  }

  // Label strip
  for (let y = 0; y < H; y++) r.hline(0, lblW - 1, y, STRIP_BG);
  r.vline(lblW, 0, H - 1, GRID_MAJOR);

  // Traces + per-channel summary
  const channels: ChannelSummary[] = [];
  for (const row of layout) {
    if (row.channelIndex < 0) continue;
    const i = row.channelIndex;
    const ch = montage.channels[i];
    const isECG = ch.active === 'ECG';
    const centerY = row.centerFrac * H;
    const scale = isECG ? pxPerMm * 10 / 1000 : pxPerUV; // ECG supplied in mV
    const color = hexToRgb(GROUP_COLORS[ch.group]);

    r.hline(lblW, W - 1, Math.round(centerY), BASELINE);
    drawNum(r, 4, Math.round(centerY) - 2, i, [90, 90, 90]);

    let px = -1, py = -1;
    let sumSq = 0, peak = 0, peakAt = 0;
    for (let j = 0; j < n; j++) {
      const v = data[i][j];
      if (!isECG) { sumSq += v * v; if (Math.abs(v) > Math.abs(peak)) { peak = v; peakAt = times[j]; } }
      const x = lblW + times[j] * pxPerSec;
      const y = centerY + v * scale; // NEGATIVE-UP: +v renders downward
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
  return { file: out, width: W, height: H, channels, pxPerSec, pxPerMm, pxPerUV };
}

function hexToRgb(hex: string): RGB {
  const m = hex.replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
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

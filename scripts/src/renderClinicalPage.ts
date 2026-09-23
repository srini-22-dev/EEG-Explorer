/**
 * Render the engine's output as a CLINICAL RECORD looks, so a page can be laid
 * next to a real one and compared.
 *
 * WHY THIS EXISTS, given `renderTrace.ts` already draws the trace
 * ---------------------------------------------------------------
 * `renderTrace` renders the app: the app's green paper, the app's montage list,
 * the app's row grouping. That is the right instrument for asking "did my change
 * do what I meant on the page the user sees".
 *
 * It is the wrong instrument for asking "does this look like a real EEG", because
 * every difference from a reference record is confounded by the app's own styling.
 * Comparing a green-paper, colour-inked page against a white-paper, black-inked
 * one, the eye spends its effort on the paper.
 *
 * This renderer removes that confound. It draws on white with 1-second rules, a
 * red ECG row and named channels, and takes an ARBITRARY channel list — so the
 * reference record's own montage order can be reproduced exactly. What is left
 * over after that is signal, which is the thing under audit.
 *
 * It drives the same engine through the same display transform as `renderTrace`
 * (`SimulationSource` -> `computeChannelVoltage` -> `traceY`), so the waveform is
 * production's, not a reimplementation. The one deliberate departure is geometry:
 * this renderer pins the vertical millimetre to `PX_PER_MM_X`, so the paper grid
 * is SQUARE. `EEGCanvas` derives it from live canvas height instead, which leaves
 * the two axes' millimetre different by 14-43% depending on window and montage.
 * A page drawn with that stretch cannot be compared against a real record, since
 * the stretch is exactly what changes how sharp a transient looks.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx ./src/renderClinicalPage.ts \
 *     --patterns blink,muscle,ecg-artifact --seconds 10 --out page.png
 *
 * Or import `renderClinicalPage(opts)` for the same data programmatically.
 */
import { writeFileSync } from 'node:fs';
import { welch } from './dsp';

import { Raster, encodePNG, type RGB } from './raster';
import { SimulationSource } from '../../artifacts/eeg-simulator/src/engine/adapter';
import type { ChannelDef } from '../../artifacts/eeg-simulator/src/utils/montages';
import { commonAverage, computeChannelVoltage } from '../../artifacts/eeg-simulator/src/utils/computeChannel';
import {
  defaultArtifactParams, defaultIctalParamsMap,
  type SimSettings, type PatientState, type ArtifactParams,
} from '../../artifacts/eeg-simulator/src/utils/simTypes';
import {
  PX_PER_MM_X, MM_PER_ROW, pxPerUV as calcPxPerUV, traceY,
} from '../../artifacts/eeg-simulator/src/utils/displayGeometry';

const FS = 250;

/**
 * 5x7 alphanumeric glyphs — only the characters 10-20 channel labels use.
 * `renderTrace` keeps its own 3x5 digit font for row numbers; these are
 * different jobs at different sizes, so they are not shared (see raster.ts).
 */
const GLYPH: Record<string, string[]> = {
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'Z': ['11111', '00010', '00100', '01000', '10000', '10000', '11111'],
  'p': ['00000', '00000', '11110', '10001', '11110', '10000', '10000'],
  'z': ['00000', '00000', '11111', '00010', '00100', '01000', '11111'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
function drawLabel(r: Raster, s: string, x: number, y: number, c: RGB) {
  let cx = x;
  for (const ch of s) {
    const g = GLYPH[ch] ?? GLYPH[ch.toUpperCase()] ?? GLYPH[' '];
    for (let ry = 0; ry < 7; ry++) {
      for (let rx = 0; rx < 5; rx++) if (g[ry][rx] === '1') r.px(cx + rx, y + ry, c);
    }
    cx += 6;
  }
}

/**
 * The default "double banana": the same order as the app's `bipolar-ap` montage
 * (utils/montages.ts) — parasagittal chains first (Fp1-F3 on top), then temporal,
 * then midline — so a clinical page and an app page line up row for row. A
 * reference figure printed in another order is reproduced with `--channels`,
 * read off its own labels.
 *
 * Anterior-temporal rows (F7-T1 / T1-T3, F8-T2 / T2-T4) are absent because the
 * engine has no T1/T2 electrodes — see `electrodePositions3D.ts`, which stops at
 * the 19 electrodes of the 10-20 array plus A1/A2.
 */
export const CLINICAL_DOUBLE_BANANA: ChannelDef[] = [
  { label: 'Fp1-F3', active: 'Fp1', reference: 'F3', group: 'left-paramedian' },
  { label: 'F3-C3', active: 'F3', reference: 'C3', group: 'left-paramedian' },
  { label: 'C3-P3', active: 'C3', reference: 'P3', group: 'left-paramedian' },
  { label: 'P3-O1', active: 'P3', reference: 'O1', group: 'left-paramedian' },
  { label: 'Fp2-F4', active: 'Fp2', reference: 'F4', group: 'right-paramedian' },
  { label: 'F4-C4', active: 'F4', reference: 'C4', group: 'right-paramedian' },
  { label: 'C4-P4', active: 'C4', reference: 'P4', group: 'right-paramedian' },
  { label: 'P4-O2', active: 'P4', reference: 'O2', group: 'right-paramedian' },
  { label: 'Fp1-F7', active: 'Fp1', reference: 'F7', group: 'left-temporal' },
  { label: 'F7-T3', active: 'F7', reference: 'T3', group: 'left-temporal' },
  { label: 'T3-T5', active: 'T3', reference: 'T5', group: 'left-temporal' },
  { label: 'T5-O1', active: 'T5', reference: 'O1', group: 'left-temporal' },
  { label: 'Fp2-F8', active: 'Fp2', reference: 'F8', group: 'right-temporal' },
  { label: 'F8-T4', active: 'F8', reference: 'T4', group: 'right-temporal' },
  { label: 'T4-T6', active: 'T4', reference: 'T6', group: 'right-temporal' },
  { label: 'T6-O2', active: 'T6', reference: 'O2', group: 'right-temporal' },
  { label: 'Fz-Cz', active: 'Fz', reference: 'Cz', group: 'central' },
  { label: 'Cz-Pz', active: 'Cz', reference: 'Pz', group: 'central' },
  { label: 'ECGL-ECGR', active: 'ECG', group: 'ecg' },
];

/** Gap in row-units inserted between chain groups. */
const GAP_UNITS = 0.45;

/**
 * Build a channel list from derivation names, e.g. "Fp1-F7,F7-T3,...,ECG".
 *
 * Reference figures are printed in whatever montage order their lab used, and a
 * side-by-side is only honest if the rows line up. Rather than hard-code each
 * one, take the derivations as they are labelled on the figure. Chain grouping —
 * which controls where the gaps fall — is inferred from breaks in the chain: a
 * new group starts wherever a row's first input is not the previous row's second.
 */
export function channelsFromDerivations(spec: string): ChannelDef[] {
  const out: ChannelDef[] = [];
  let group = 0;
  const parts = spec.split(',').map(s => s.trim()).filter(Boolean);
  parts.forEach((p, i) => {
    if (/^ecg/i.test(p)) { out.push({ label: p, active: 'ECG', group: 'ecg' }); return; }
    const [a, b] = p.split('-').map(s => s.trim());
    if (!a || !b) throw new Error(`bad derivation '${p}' (want e.g. 'Fp1-F7' or 'ECG')`);
    const prev = parts[i - 1];
    const prevB = prev && !/^ecg/i.test(prev) ? prev.split('-')[1]?.trim() : undefined;
    if (i > 0 && prevB !== a) group++;
    out.push({
      label: p,
      active: a as ChannelDef['active'],
      reference: b as ChannelDef['reference'],
      // Groups only need to be DISTINCT strings for the gap rule; the montage
      // palette names are irrelevant here since this renderer draws mono ink.
      group: `chain${group}` as ChannelDef['group'],
    });
  });
  return out;
}

export interface ClinicalPageOpts {
  channels?: ChannelDef[];        // default CLINICAL_DOUBLE_BANANA
  state?: PatientState;           // default 'awake'
  patterns?: string[];            // active toggle ids
  seconds?: number;               // default 10 (one routine page, ACNS G1 §3.6)
  seed?: number;                  // default 42
  skipSeconds?: number;           // advance and discard before capturing
  sensitivity?: number;           // µV/mm, default 7
  speed?: number;                 // mm/s, default 30
  artifactParams?: Partial<ArtifactParams>;
  out?: string;
  /** Also write the page's answers here as JSON, for scoring an image reader (read-lab/py/rowtable.py). */
  truth?: string;
}

export interface PageRow {
  label: string;
  /** Largest-|value| sample WITH sign, in display space (+ = drawn downward). */
  peakSigned: number;
  /** Robust peak-to-peak: 99th minus 1st percentile, µV. */
  p2p: number;
  /** Row height the trace occupies at this sensitivity: p2p / (sensitivity × 10 mm). */
  rowHeights: number;
}

export function renderClinicalPage(opts: ClinicalPageOpts = {}) {
  const channels = opts.channels ?? CLINICAL_DOUBLE_BANANA;
  const seconds = opts.seconds ?? 10;
  const sensitivity = opts.sensitivity ?? 7;
  const speed = opts.speed ?? 30;
  const out = opts.out ?? 'clinical-page.png';

  const settings: SimSettings = {
    speed: speed as SimSettings['speed'],
    sensitivity: sensitivity as SimSettings['sensitivity'],
    patientState: opts.state ?? 'awake',
    activePatterns: new Set(opts.patterns ?? []),
    ictalParams: defaultIctalParamsMap(),
    artifactParams: { ...defaultArtifactParams(), ...(opts.artifactParams ?? {}) },
  };

  // ── Drive the real engine through the real display transform ──
  const src = new SimulationSource(opts.seed ?? 42, FS);
  for (let i = 0; i < Math.max(0, Math.floor((opts.skipSeconds ?? 0) * FS)); i++) src.next(settings);
  const n = Math.floor(seconds * FS);
  const data = channels.map(() => new Float64Array(n));
  const times = new Float64Array(n);
  let t0 = 0;
  for (let i = 0; i < n; i++) {
    const allV = src.next(settings);
    const avg = commonAverage(allV);
    for (let c = 0; c < channels.length; c++) {
      data[c][i] = computeChannelVoltage(channels[c], src.t, allV, avg);
    }
    if (i === 0) t0 = src.t;
    times[i] = src.t - t0;
  }

  // ── Geometry. A gap goes between chain GROUPS, so consecutive rows sharing a
  //    group stay visually one chain. Unlike EEGCanvas's rule (gap on every
  //    `group` change) this cannot scatter gaps through a transverse montage.
  let totalRowUnits = 0;
  const centreUnit: number[] = [];
  for (let i = 0; i < channels.length; i++) {
    centreUnit.push(totalRowUnits + 0.5);
    totalRowUnits += 1;
    const next = channels[i + 1];
    if (next && next.group !== channels[i].group) totalRowUnits += GAP_UNITS;
  }

  // Square millimetre on both axes — see the header note.
  const pxPerMm = PX_PER_MM_X;
  const pxPerSec = speed * PX_PER_MM_X;
  const pxPerUV = calcPxPerUV(pxPerMm, sensitivity);
  const lblW = 62;
  const H = Math.round(totalRowUnits * MM_PER_ROW * pxPerMm);
  const W = lblW + Math.round(seconds * pxPerSec);

  const WHITE: RGB = [255, 255, 255];
  const RULE: RGB = [203, 203, 203];
  const INK: RGB = [0, 0, 0];
  const ECG_INK: RGB = [200, 0, 0];

  const r = new Raster(W, H, WHITE);
  for (let s = 0; s <= seconds; s++) r.vline(Math.round(lblW + s * pxPerSec), 0, H - 1, RULE);

  const rows: PageRow[] = [];
  const baselineY: number[] = [];
  for (let c = 0; c < channels.length; c++) {
    const ch = channels[c];
    const isECG = ch.active === 'ECG';
    const centerY = centreUnit[c] * MM_PER_ROW * pxPerMm;
    baselineY.push(centerY);
    // ECG is a limb lead, not a scalp derivation: negative-up does not apply, so
    // the scale is negated to put the R wave up (see displayGeometry.ecgScale).
    const scale = isECG ? -(pxPerMm * MM_PER_ROW / 1000) : pxPerUV;
    const col = isECG ? ECG_INK : INK;
    drawLabel(r, ch.label, 3, Math.round(centerY) - 3, col);

    let px = -1, py = -1, peak = 0;
    for (let j = 0; j < n; j++) {
      const v = data[c][j];
      if (!isECG && Math.abs(v) > Math.abs(peak)) peak = v;
      const x = lblW + times[j] * pxPerSec;
      const y = traceY(centerY, v, scale);
      if (px >= 0) r.line(px, py, x, y, col);
      px = x; py = y;
    }

    const sorted = Array.from(data[c]).sort((a, b) => a - b);
    const p2p = isECG ? 0 : sorted[Math.floor(0.99 * n)] - sorted[Math.floor(0.01 * n)];
    rows.push({ label: ch.label, peakSigned: isECG ? 0 : peak, p2p, rowHeights: p2p / (sensitivity * MM_PER_ROW) });
  }

  writeFileSync(out, encodePNG(W, H, r.data));
  if (opts.truth) {
    // Per-row answers in the reader's own terms: p2p in row-heights, and band shares over the
    // bands read-lab/py/rowtable.py uses. Computed from the samples actually drawn.
    const bands: Array<[string, number, number]> = [['delta', 0.5, 4], ['theta', 4, 8], ['alpha', 8, 13], ['beta', 13, 30]];
    const truthRows = channels.map((ch, c) => {
      if (ch.active === 'ECG') return { label: ch.label, ecg: true };
      // Forward plus time-reversed: power-of-two segments leave the page's tail unread, and a
      // transient there (a K-complex) would be in the image but not in the truth. Reversal does
      // not change a spectrum, and the two passes between them cover every sample.
      const fwd = welch(data[c], FS, 512), rev = welch(Array.from(data[c]).reverse(), FS, 512);
      const psd = { freqs: fwd.freqs, power: fwd.power.map((v, k) => v + rev.power[k]) };
      const pow: Record<string, number> = {};
      let tot = 0;
      for (const [name, lo, hi] of bands) {
        let s = 0;
        // A bin belongs to the band its centre falls in, within half a bin: the same rule
        // rowtable.py uses, so both sides put the lowest delta bin in the same place whatever
        // their FFT length.
        const half = (psd.freqs[1] - psd.freqs[0]) / 2;
        for (let k = 0; k < psd.freqs.length; k++) if (psd.freqs[k] >= lo - half && psd.freqs[k] < hi - half) s += psd.power[k];
        pow[name] = s; tot += s;
      }
      return {
        label: ch.label, baselineY: baselineY[c], rowHeights: rows[c].rowHeights,
        share: Object.fromEntries(Object.entries(pow).map(([k, v]) => [k, v / tot])),
      };
    });
    writeFileSync(opts.truth, JSON.stringify({
      file: out, width: W, height: H, labelStripPx: lblW, pxPerSec, pitchPx: MM_PER_ROW * pxPerMm,
      sensitivity, seconds, state: settings.patientState, patterns: opts.patterns ?? [], seed: opts.seed ?? 42,
      rows: truthRows,
    }, null, 1));
  }
  // labelStripPx / baselineY / fs / data: what a reader of the IMAGE has to estimate,
  // returned exactly so scripts/read-lab can score image-reading methods against it.
  return {
    file: out, width: W, height: H, rows, pxPerMm, pxPerSec, pxPerUV, secondsPerPage: seconds,
    labelStripPx: lblW, baselineY, fs: FS, data,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): ClinicalPageOpts {
  const o: ClinicalPageOpts = {};
  const art: Partial<ArtifactParams> = {};
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case '--state': o.state = next() as PatientState; break;
      case '--patterns': o.patterns = next().split(',').map(s => s.trim()).filter(Boolean); break;
      case '--seconds': o.seconds = Number(next()); break;
      case '--seed': o.seed = Number(next()); break;
      case '--skip': o.skipSeconds = Number(next()); break;
      case '--sensitivity': o.sensitivity = Number(next()); break;
      case '--speed': o.speed = Number(next()); break;
      case '--blink-rate': art.blinkRatePerMin = Number(next()); break;
      case '--emg-severity': art.emgSeverity = Number(next()); break;
      case '--emg-regions': art.emgRegions = next().split(',').map(s => s.trim()).filter(Boolean) as ArtifactParams['emgRegions']; break;
      case '--channels': o.channels = channelsFromDerivations(next()); break;
      case '--out': o.out = next(); break;
      case '--truth': o.truth = next(); break;
    }
  }
  if (Object.keys(art).length) o.artifactParams = art;
  return o;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('renderClinicalPage.ts')) {
  const res = renderClinicalPage(parseArgs(process.argv.slice(2)));
  console.log(`\nwrote ${res.file}  (${res.width}×${res.height})`);
  console.log(`${res.secondsPerPage} s/page at ${res.pxPerSec / PX_PER_MM_X} mm/s; ${res.pxPerMm} px/mm on BOTH axes (square grid)`);
  console.log('\nlabel         signed peak (+ = down, µV)   p2p (µV)   row heights');
  for (const row of res.rows) {
    console.log(
      `  ${row.label.padEnd(12)} ${row.peakSigned.toFixed(1).padStart(10)}` +
      `             ${row.p2p.toFixed(1).padStart(8)}   ${row.rowHeights.toFixed(2).padStart(6)}`,
    );
  }
}

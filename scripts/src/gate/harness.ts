/**
 * Shared state and helpers of the validation battery (validateEngine.ts): the check()
 * recorder, the engine and display runners, and the section registry.
 */
import { AperiodicSource } from '../../../artifacts/eeg-simulator/src/engine/aperiodic';
import { HopfOscillator } from '../../../artifacts/eeg-simulator/src/engine/oscillator';
import { EegEngine, type EngineOptions } from '../../../artifacts/eeg-simulator/src/engine/engine';
import { sourceBetween, type SourceSpec } from '../../../artifacts/eeg-simulator/src/engine/forward';
import type { PatientState } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
import { welch } from '../dsp';

// Display-space transform (CLAUDE.md §4): the same pipeline EEGCanvas/
// renderTrace.ts use to turn raw electrode voltages into the montage-derived
// channel actually drawn on screen. Everything above this reads raw electrodes
// (referential/spectral space); Step 19 below reads this instead, because a
// pattern can pass every spectral check and still be wrong once a montage and a
// common-average reference are applied to it.
import { SimulationSource } from '../../../artifacts/eeg-simulator/src/engine/adapter';
import { MONTAGES, ALL_ELECTRODES } from '../../../artifacts/eeg-simulator/src/utils/montages';
import { commonAverage, computeChannelVoltage } from '../../../artifacts/eeg-simulator/src/utils/computeChannel';
import { toggle } from '../../../artifacts/eeg-simulator/src/utils/toggleRules';
import { defaultArtifactParams, defaultIctalParamsMap, type SimSettings } from '../../../artifacts/eeg-simulator/src/utils/simTypes';

import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A cortical-shell source genuinely EQUIDISTANT from two electrodes — the
 * geometry IK-003 case b describes as "midway between two electrodes".
 *
 * `sourceUnder([a, b])` is not that. It averages the two electrode positions and
 * projects the mean radially onto the shell, which lands on the perpendicular
 * bisector only when the head is a sphere and the two electrodes sit at equal
 * radius. On the mesh-derived head they do not: F8 (z 0.53) rides higher than T4
 * (z 0), so the projected mean ends up 8.4% closer to T4 than to F8 and the
 * "isoelectric" link inherits that 8.4% as a spurious deflection. Before the
 * electrodes were corrected against the head mesh the same construction was off by
 * only 1.0%, which is why this went unnoticed.
 *
 * Walk the great circle between the two radial directions and bisect on the
 * distance difference; 40 halvings is far below floating-point resolution.
 */
// The construction now lives in forward.ts (`sourceBetween`), since the focal-spike
// toggles use it too.
export const midwaySource = (id: string, a: string, b: string, extent: number): SourceSpec =>
  sourceBetween(id, a, b, extent);

// Scratch dir for Step 23's incidental PNG evidence — not asserted on, just left
// on disk for a reviewer to open (audit brief, ACCEPTANCE BAR §3). Under the OS
// temp dir and created here. It used to be one session's scratchpad path, which
// stopped existing when that session ended: the first render then threw ENOENT
// and took the gate down before Steps 23, 21 and 24, the knowledge-base audit and
// the near-bound review had run.
export const SCRATCH = join(tmpdir(), 'eeg-explorer-validate');
mkdirSync(SCRATCH, { recursive: true });

export const FS = 250;
export const DT = 1 / FS;

export const tally = { failures: 0 };
/** Every check's label and outcome, for the knowledge-base status audit at the end. */
export const results: { label: string; ok: boolean }[] = [];

/**
 * Passing checks whose value sits close to a bound. Printed at the end, never failed on. A value
 * parked at its bound is a finding in its own right: either the model is wrong and the bound is what
 * let it through, or the bound is wrong. `blink F7-T3 / Fp1-F7` passed at 0.948 against a 0.95
 * ceiling for weeks — no decay at all down the temporal chain, visible on every blink — because
 * nothing forced anyone to look at it.
 *
 * "Close" is NEAR_BOUND_FRACTION of the bound's own magnitude, capped at that fraction of the range
 * when both ends are real. A bound of 1e5 or more, an infinite one, or one at a physical limit (0, or
 * +-1 for a correlation) is not a bound here: a correlation of -1.000 against -1.0001, or zero EMG
 * against a floor of 0, is the intended value, not a near miss. The first version measured 5% of the
 * whole range, and against open ceilings like 1e6 it listed 120 checks — noise nobody would read.
 */
export const NEAR_BOUND_FRACTION = 0.1;
export const nearBound: string[] = [];

export function check(label: string, actual: number, lo: number, hi: number, unit = '') {
  const ok = actual >= lo && actual <= hi;
  results.push({ label, ok });
  const real = (b: number) => Number.isFinite(b) && Math.abs(b) < 1e5;
  const usable = (b: number) => real(b) && Math.abs(b) > 1e-3 && Math.abs(Math.abs(b) - 1) > 1e-3;
  if (ok && lo !== hi) {
    const both = real(lo) && real(hi);
    const margin = (b: number) => NEAR_BOUND_FRACTION * (both ? Math.min(Math.abs(b), hi - lo) : Math.abs(b));
    const nearLo = usable(lo) && actual - lo <= margin(lo);
    const nearHi = usable(hi) && hi - actual <= margin(hi);
    if (nearLo || nearHi) nearBound.push(`${label}: ${actual.toFixed(3)}${unit} against ${nearLo ? 'floor' : 'ceiling'} ${nearLo ? lo : hi}`);
  }
  if (!ok) tally.failures++;
  const status = ok ? 'ok  ' : 'FAIL';
  console.log(
    `  ${status} ${label.padEnd(38)} ${actual.toFixed(3).padStart(9)}${unit}   want ${lo}..${hi}`
  );
}

export function generate(src: AperiodicSource, secs: number): Float64Array {
  const n = Math.floor(secs * FS);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = src.next();
  return out;
}

export function genOsc(o: HopfOscillator, secs: number): Float64Array {
  const n = Math.floor(secs * FS);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = o.next();
  return out;
}

export function runEngine(secs: number, opts: EngineOptions = {}) {
  const eng = new EegEngine(opts);
  const n = Math.floor(secs * FS);
  const nCh = eng.electrodes.length;
  const data: Float64Array[] = eng.electrodes.map(() => new Float64Array(n));
  const buf = new Float64Array(nCh);
  for (let i = 0; i < n; i++) {
    eng.next(buf);
    for (let c = 0; c < nCh; c++) data[c][i] = buf[c];
  }
  return { eng, data };
}

// Same as runEngine, but drives a patient state and a set of active pattern
// toggles first — needed to exercise the pattern sources (sleep, variants, …).
export function runEngineState(
  secs: number, opts: EngineOptions, state: PatientState, patterns: string[],
  // Per-ictal-toggle severity/discharge-frequency/hemisphere. Default `{}` is a
  // no-op, so callers that don't care about seizure parameters read exactly as
  // they did before.
  ictalParams: Partial<Record<string, Partial<{ intensity: number; frequency: number; hemisphere: 'left' | 'right' }>>> = {},
) {
  const eng = new EegEngine(opts);
  eng.setPatientState(state);
  eng.setActivePatterns(new Set(patterns));
  eng.setIctalParams(ictalParams);
  const n = Math.floor(secs * FS);
  const nCh = eng.electrodes.length;
  const data: Float64Array[] = eng.electrodes.map(() => new Float64Array(n));
  const buf = new Float64Array(nCh);
  for (let i = 0; i < n; i++) {
    eng.next(buf);
    for (let c = 0; c < nCh; c++) data[c][i] = buf[c];
  }
  return { eng, data };
}

// Display-space runner for Step 19: drives SimulationSource -> commonAverage ->
// computeChannelVoltage exactly as renderTrace.ts / EEGCanvas do, on a montage's
// channels, rather than runEngineState's raw electrodes.
export function runDisplay(
  montageId: string, state: PatientState, patterns: string[], secs: number, seed: number,
  patternOptions?: SimSettings['patternOptions'],
) {
  const montage = MONTAGES[montageId];
  const settings: SimSettings = {
    speed: 30, sensitivity: 7, patientState: state,
    activePatterns: new Set(patterns),
    ictalParams: defaultIctalParamsMap(),
    artifactParams: { ...defaultArtifactParams() },
    patternOptions,
  };
  const src = new SimulationSource(seed, FS);
  const n = Math.floor(secs * FS);
  const data: Float64Array[] = montage.channels.map(() => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    const allV = src.next(settings);
    const avg = commonAverage(allV);
    for (let c = 0; c < montage.channels.length; c++) {
      data[c][i] = computeChannelVoltage(montage.channels[c], src.t, allV, avg);
    }
  }
  return { montage, data };
}

// A toggle's own isolated contribution on ONE display-space channel: same-seed
// on-minus-off, mirroring the raw-electrode `contrib` helper (Step 11) but after
// the montage/CAR transform.
export function displayContrib(
  montageId: string, state: PatientState, toggle: string, label: string, secs: number, seed: number,
): Float64Array {
  const off = runDisplay(montageId, state, [], secs, seed);
  const on = runDisplay(montageId, state, [toggle], secs, seed);
  const ci = on.montage.channels.findIndex((c) => c.label === label);
  if (ci < 0) throw new Error(`no channel '${label}' in montage ${montageId}`);
  const n = on.data[ci].length;
  const diff = new Float64Array(n);
  for (let k = 0; k < n; k++) diff[k] = on.data[ci][k] - off.data[ci][k];
  return diff;
}

/**
 * A toggle's isolated contribution on EVERY row of a montage at once (same-seed
 * on minus off), keyed by label. `displayContrib` above answers for one row; a
 * claim about a field — generalized, bifrontal, confined to one chain — is a
 * claim about all of them, and two electrodes on one reference cannot make it.
 */
export function displayContribAll(
  montageId: string, state: PatientState, toggle: string, secs: number, seed: number,
): Record<string, Float64Array> {
  const off = runDisplay(montageId, state, [], secs, seed);
  const on = runDisplay(montageId, state, [toggle], secs, seed);
  const out: Record<string, Float64Array> = {};
  on.montage.channels.forEach((ch, c) => {
    if (ch.group === 'ecg') return;
    out[ch.label] = on.data[c].map((v, k) => v - off.data[c][k]);
  });
  return out;
}

/** Largest absolute sample. */
export function absPeak(x: Float64Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

/** The eight left/right pairs of homologous double-banana rows. */
export const HOMOLOGOUS_ROWS: [string, string][] = [
  ['Fp1-F3', 'Fp2-F4'], ['F3-C3', 'F4-C4'], ['C3-P3', 'C4-P4'], ['P3-O1', 'P4-O2'],
  ['Fp1-F7', 'Fp2-F8'], ['F7-T3', 'F8-T4'], ['T3-T5', 'T4-T6'], ['T5-O1', 'T6-O2'],
];

/**
 * Largest side-to-side difference between homologous rows, as a fraction of the
 * larger. learningeeg (Normal Awake) draws the line for the posterior rhythm at a
 * 50% amplitude difference between sides; the same line is used here for any
 * pattern taught as symmetric. What it has to absorb is real: each electrode's
 * amplifier gain is drawn 4% either way, and a bipolar row is the difference of
 * two such electrodes, so rows fed by one mirrored source still differ by 10-20%.
 */
export function largestSideDifference(rows: Record<string, Float64Array>): number {
  return Math.max(...HOMOLOGOUS_ROWS.map(([l, r]) => {
    const a = absPeak(rows[l]), b = absPeak(rows[r]);
    return Math.abs(a - b) / Math.max(a, b);
  }));
}

/** Mean absolute peak over `els`, each read against the reference `ref(el)` names. */
export function meanPeakAt(rows: Record<string, Float64Array>, els: string[], ref: (e: string) => string): number {
  return els.reduce((a, e) => a + absPeak(rows[`${e}-${ref(e)}`]), 0) / els.length;
}
export const IPSI_EAR = (e: string) => (/[13579]$/.test(e) ? 'A1' : 'A2');
export const ANTERIOR_SITES = ['Fp1', 'Fp2', 'F3', 'F4', 'F7', 'F8'];
export const POSTERIOR_SITES = ['P3', 'P4', 'O1', 'O2', 'T5', 'T6'];

/** Robust peak-to-peak: 99th minus 1st percentile, ignoring rare outliers. */
export function pctP2p(x: Float64Array): number {
  const sorted = Array.from(x).sort((a, b) => a - b);
  return sorted[Math.floor(0.99 * sorted.length)] - sorted[Math.floor(0.01 * sorted.length)];
}

export function corr(a: Float64Array, b: Float64Array): number {
  let ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
  ma /= a.length; mb /= b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

export function bandPower(x: Float64Array, lo: number, hi: number): number {
  const psd = welch(x, FS, 2048);
  let s = 0;
  for (let k = 0; k < psd.freqs.length; k++) {
    if (psd.freqs[k] >= lo && psd.freqs[k] <= hi) s += psd.power[k];
  }
  return s;
}

// Band power on a SHORT slice: a 512-pt Welch segment (2.05 s) so that a few-second
// window still holds at least one segment. Coarser frequency resolution than
// bandPower's 2048, but ictal window checks only compare gross in-band energy.
export function winPower(x: Float64Array, lo: number, hi: number): number {
  const psd = welch(x, FS, 512);
  let s = 0;
  for (let k = 0; k < psd.freqs.length; k++) {
    if (psd.freqs[k] >= lo && psd.freqs[k] <= hi) s += psd.power[k];
  }
  return s;
}

// The sleep sources are `stateIntrinsic`: a toggle forces them even while awake,
// which lets us isolate each element against an otherwise-identical awake
// background (same seed, patterns off) rather than confounding it with the
// state-dependent shift in background bands. Clean geometry: artifacts and the
// recording chain are off so we read the source morphology and topography
// directly. Cz is the vertex; O1 is occipital.
export const SLEEP_OPTS: EngineOptions = { seed: 20, artifacts: false, recordingChain: false, subject: { alphaRms: 12 } };
export const cz = (d: Float64Array[], e: EegEngine) => d[e.indexOf('Cz')];
export const o1c = (d: Float64Array[], e: EegEngine) => d[e.indexOf('O1')];

// Baseline: awake, nothing toggled.
// The awake sleep-options record the Step 11 contrasts are taken against. Run once, on first
// use, so a partial run (--only) that never needs it does not pay for 180 s of engine.
let baseRun: ReturnType<typeof runEngineState> | undefined;
const sleepBase = () => (baseRun ??= runEngineState(180, SLEEP_OPTS, 'awake', []));
export const base = { get eng() { return sleepBase().eng; }, get data() { return sleepBase().data; } };
export const baseCzSigma = () => bandPower(cz(base.data, base.eng), 12, 15);
export const baseCzP2p = () => pctP2p(cz(base.data, base.eng));
export const baseO1P2p = () => pctP2p(o1c(base.data, base.eng));

// A source's own contribution at an electrode = band power with the toggle on
// minus off, at the same seed (the neural background is byte-identical between
// the two runs because the pattern generators draw from separate RNG streams).
// This isolates the source's topography from the state's background — the awake
// posterior alpha that otherwise swamps a distant electrode's denominator.
export const contrib = (
  on: { data: Float64Array[]; eng: EegEngine }, name: string, lo: number, hi: number,
) => bandPower(on.data[on.eng.indexOf(name)], lo, hi) - bandPower(base.data[base.eng.indexOf(name)], lo, hi);

// Frequency-resolved `contrib`: WHERE the source's own power peaks, rather than
// how much of it falls in a band chosen in advance. Same on-minus-off
// subtraction, so the background's own peaks (the posterior alpha rhythm above
// all) cancel and cannot win the argmax.
export const contribPeak = (
  on: { data: Float64Array[]; eng: EegEngine }, name: string, fLo: number, fHi: number,
): number => {
  const a = welch(on.data[on.eng.indexOf(name)], FS, 2048);
  const b = welch(base.data[base.eng.indexOf(name)], FS, 2048);
  let bestF = 0, bestP = -Infinity;
  for (let k = 0; k < a.freqs.length; k++) {
    const f = a.freqs[k];
    if (f < fLo || f > fHi) continue;
    const d = a.power[k] - b.power[k];
    if (d > bestP) { bestP = d; bestF = f; }
  }
  return bestF;
};

// Windowed accessor: a slice of one electrode's trace between t0 and t1 seconds.
// The ictal patterns are scripted evolutions, so their diagnostic features live
// in specific time windows (onset vs. spread, clonic vs. post-ictal) rather than
// in a whole-record statistic.
export const win = (r: typeof base, name: string, t0: number, t1: number) =>
  r.data[r.eng.indexOf(name)].subarray(Math.floor(t0 * FS), Math.floor(t1 * FS));
/**
 * The same window as the common-average-referenced channel (`reference-car`: X-AVG), i.e.
 * what a reader sees on that montage. Raw engine data is potential against infinity, which
 * no montage shows: since each source's field has zero mean over the head (forward.ts,
 * `surfaceMean`), a raw ratio between electrodes measures the model's absolute offset rather
 * than the page. Use this for any claim that names a referential picture.
 */
export const winCar = (r: typeof base, name: string, t0: number, t1: number) => {
  const i0 = Math.floor(t0 * FS), i1 = Math.floor(t1 * FS);
  const idx = ALL_ELECTRODES.map((e) => r.eng.indexOf(e)).filter((i) => i >= 0);
  const x = r.data[r.eng.indexOf(name)];
  const out = new Float64Array(i1 - i0);
  for (let i = i0; i < i1; i++) {
    let m = 0;
    for (const k of idx) m += r.data[k][i];
    out[i - i0] = x[i] - m / idx.length;
  }
  return out;
};

// Step 12 already checks these sources referentially (raw electrode space).
// CLAUDE.md §4 requires the clinical claims specific to each pattern's
// montage-derived shape and topography — FIRDA's frontal-max rhythmicity,
// focal temporal slowing's lateralization, generalized slowing's true
// diffuseness, triphasic waves' AP time lag, and GPEDs/LPEDs periodicity —
// verified on the channel a reader actually reads, not just a spectral
// scalar averaged across all electrodes.

// No existing primitive detects discrete event onsets in a sparse, jittered
// pulse train (GPEDs/LPEDs); autocorr's peak-search is a poor fit for signals
// this sparse (confirmed empirically — it returns no usable secondary peak).
// Threshold-crossing with a refractory period is the standard, simple way to
// recover an inter-discharge-interval series from a periodic-source generator.
export function eventIntervals(x: Float64Array, thresholdFrac: number, refractorySec: number): number[] {
  const absMax = Math.max(...Array.from(x, Math.abs));
  const thr = absMax * thresholdFrac;
  const onsets: number[] = [];
  let lastOnset = -Infinity;
  for (let i = 1; i < x.length; i++) {
    const t = i / FS;
    if (Math.abs(x[i]) >= thr && Math.abs(x[i - 1]) < thr && t - lastOnset > refractorySec) {
      onsets.push(t);
      lastOnset = t;
    }
  }
  const intervals: number[] = [];
  for (let i = 1; i < onsets.length; i++) intervals.push(onsets[i] - onsets[i - 1]);
  return intervals;
}

/**
 * Largest fractional change from one inter-discharge interval to the next.
 * learningeeg (Physiology & Terminology, Rhythmicity & Periodicity): a pattern
 * whose interval varies by 25-50% is quasi-periodic, and by more than 50% is not
 * periodic at all — so a pattern taught as periodic keeps every step under 25%.
 */
export function largestStep(intervals: number[]): number {
  let worst = 0;
  for (let i = 1; i < intervals.length; i++) {
    worst = Math.max(worst, Math.abs(intervals[i] - intervals[i - 1]) / intervals[i - 1]);
  }
  return worst;
}

// No existing primitive scans a cross-correlation across a range of lags (the
// DSP module's autocorr is single-signal only); this is the standard way to
// find the timing offset between two related channels for the triphasic-wave
// AP-lag claim.
export function bestLag(a: Float64Array, b: Float64Array, maxLagSamples: number): { lag: number; corr: number } {
  let best = -Infinity, bestLagV = 0;
  for (let lag = -maxLagSamples; lag <= maxLagSamples; lag++) {
    let sa = 0, sb = 0, cnt = 0;
    for (let i = 0; i < a.length; i++) {
      const j = i + lag;
      if (j < 0 || j >= b.length) continue;
      sa += a[i]; sb += b[j]; cnt++;
    }
    const ma = sa / cnt, mb = sb / cnt;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) {
      const j = i + lag;
      if (j < 0 || j >= b.length) continue;
      num += (a[i] - ma) * (b[j] - mb);
      da += (a[i] - ma) ** 2; db += (b[j] - mb) ** 2;
    }
    const c = num / Math.sqrt(da * db);
    if (c > best) { best = c; bestLagV = lag; }
  }
  return { lag: bestLagV, corr: best };
}

export const rmsOf = (x: Float64Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);

// ── Sections ──
// Every top-level check block of the battery is a section, registered in file order
// under the step header it sits beneath. The entry point (validateEngine.ts) runs them
// all, or with --only <regex> those whose step header or title matches.
type Section = { step: string; title: string | null; name: string; run: () => void };
export const sections: Section[] = [];
let currentStep = '';
export function step(header: string) { currentStep = header; }
export function section(title: string | null, run: () => void, name: string = title ?? '') {
  sections.push({ step: currentStep, title, name, run });
}

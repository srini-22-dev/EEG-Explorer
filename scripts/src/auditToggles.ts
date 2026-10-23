/**
 * Audit EVERY toggle at once: its isolated field, its row table and its timing.
 *
 * WHAT IT ANSWERS
 * ---------------
 * "Does each pattern put on the page what its name says?" — for all of them, in
 * one run, so a defect that several patterns share shows up as a class instead of
 * being found one toggle at a time.
 *
 * `measureField.ts` answers this carefully for one toggle. This is the wide,
 * shallow pass that tells you which toggles to point it at. It exists because of
 * what the first run of it found (2026-10-12): nine patterns taught as
 * GENERALIZED were a single midline patch and drew as a midline focus, three
 * artifact toggles drew nothing at all, and several variants sat on the wrong
 * electrodes — none of it visible to a gate whose checks each read one or two
 * electrodes of one pattern.
 *
 * HOW
 * ---
 * Same-seed on minus off through the production engine and display transform, per
 * toggle, in the state the toggle needs (a state-gated source is run in its first
 * state; a state-intrinsic one in a state OUTSIDE its list, where the toggle is
 * what switches it on).
 *
 * For each toggle it prints
 *   - the strongest electrode, with every electrode as a share of it (RMS),
 *   - every row of the chosen montage as a share of the largest row (RMS) with
 *     its signed peak (+ = drawn downward),
 *   - smallest / largest row — the one number that separates a field that is on
 *     every chain from one that is on a single chain,
 *   - the dominant frequency, the event count and the interval CV at the
 *     strongest electrode,
 * and flags a toggle whose largest row stays under one millimetre of pen at
 * 7 uV/mm (7 uV): on a real page that toggle is doing nothing.
 *
 * Read the peaks with care on oscillating sources: a signed peak averaged over
 * seeds can cancel to zero where the RMS share is 100%.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx ./src/auditToggles.ts
 *   pnpm --filter @workspace/scripts exec tsx ./src/auditToggles.ts --only gpeds,3hz-gsw --montage reference-ipsi
 *   ... --seconds 60 --seeds 42,7 --out audit.json
 *
 * The full run is ~60 toggles x 2 seeds x 2 runs of 60 s: several minutes. Do not
 * run it alongside the gate.
 */
import { writeFileSync } from 'node:fs';
import { SimulationSource } from '../../artifacts/eeg-simulator/src/engine/adapter';
import { ALL_ELECTRODES, MONTAGES } from '../../artifacts/eeg-simulator/src/utils/montages';
import { commonAverage, computeChannelVoltage } from '../../artifacts/eeg-simulator/src/utils/computeChannel';
import {
  defaultArtifactParams, defaultIctalParamsMap, type SimSettings, type PatientState,
} from '../../artifacts/eeg-simulator/src/utils/simTypes';
import { PATTERN_SOURCES } from '../../artifacts/eeg-simulator/src/engine/sources/registry';
import { PATTERN_CATEGORIES } from '../../artifacts/eeg-simulator/src/utils/patterns';
import { welch, spectralPeak } from './dsp';

const FS = 250;
/** One millimetre of pen at the standard 7 uV/mm. */
const VISIBLE_UV = 7;

const args = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SECS = Number(arg('--seconds', '60'));
const SEEDS = arg('--seeds', '42,7').split(',').map(Number);
const ONLY = arg('--only', '');
const OUT = arg('--out', '');
const ROWS = MONTAGES[arg('--montage', 'bipolar-ap')].channels.filter(c => c.group !== 'ecg');

function run(state: PatientState, patterns: string[], seed: number) {
  const settings: SimSettings = {
    speed: 30, sensitivity: 7, patientState: state, activePatterns: new Set(patterns),
    ictalParams: defaultIctalParamsMap(), artifactParams: defaultArtifactParams(),
  };
  const src = new SimulationSource(seed, FS);
  const n = Math.floor(SECS * FS);
  const el: Record<string, Float64Array> = {};
  for (const e of ALL_ELECTRODES) el[e] = new Float64Array(n);
  const rows = ROWS.map(() => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    const v = src.next(settings);
    const avg = commonAverage(v);
    for (const e of ALL_ELECTRODES) el[e][i] = v[e] ?? 0;
    for (let c = 0; c < ROWS.length; c++) rows[c][i] = computeChannelVoltage(ROWS[c], src.t, v, avg);
  }
  return { el, rows };
}

const signedPeak = (x: Float64Array) => { let p = 0; for (const v of x) if (Math.abs(v) > Math.abs(p)) p = v; return p; };
const rms = (x: Float64Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

/** The state in which a toggle's own contribution can be isolated. */
function stateFor(toggle: string): PatientState {
  const d = PATTERN_SOURCES.find(s => s.toggles.includes(toggle));
  if (!d || !d.states) return 'awake';
  if (d.stateIntrinsic) {
    return (['awake', 'drowsy', 'n1', 'n2', 'n3', 'rem'] as PatientState[]).find(s => !d.states!.includes(s)) ?? 'awake';
  }
  return d.states[0];
}

/** Onsets by threshold crossing with a refractory period; interval mean and CV. */
function events(x: Float64Array, frac = 0.4, refractory = 0.25) {
  const thr = Math.abs(signedPeak(x)) * frac;
  const on: number[] = [];
  let last = -1e9;
  for (let i = 1; i < x.length; i++) {
    if (Math.abs(x[i]) >= thr && Math.abs(x[i - 1]) < thr && i / FS - last > refractory) { on.push(i / FS); last = i / FS; }
  }
  const iv = on.slice(1).map((t, i) => t - on[i]);
  const m = iv.length ? mean(iv) : 0;
  const sd = iv.length ? Math.sqrt(mean(iv.map(v => (v - m) ** 2))) : 0;
  return { n: on.length, meanInterval: m, cv: m ? sd / m : 0 };
}

const toggles = PATTERN_CATEGORIES.flatMap(c => c.patterns.map(p => p.id))
  .filter(t => !ONLY || ONLY.split(',').includes(t));
const report: Record<string, unknown> = {};
const dead: string[] = [];
const f = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

for (const t of toggles) {
  const state = stateFor(t);
  const elPeak: Record<string, number[]> = {}, elRms: Record<string, number[]> = {};
  const rowPeak: number[][] = ROWS.map(() => []), rowRms: number[][] = ROWS.map(() => []);
  let first: Record<string, Float64Array> | null = null;
  for (const seed of SEEDS) {
    const off = run(state, [], seed), on = run(state, [t], seed);
    const el: Record<string, Float64Array> = {};
    for (const e of ALL_ELECTRODES) {
      el[e] = on.el[e].map((v, i) => v - off.el[e][i]);
      (elPeak[e] ??= []).push(signedPeak(el[e]));
      (elRms[e] ??= []).push(rms(el[e]));
    }
    on.rows.forEach((r, c) => {
      const d = r.map((v, i) => v - off.rows[c][i]);
      rowPeak[c].push(signedPeak(d));
      rowRms[c].push(rms(d));
    });
    first ??= el;
  }
  const field = ALL_ELECTRODES.map(e => ({ e, peak: mean(elPeak[e]), rms: mean(elRms[e]) })).sort((a, b) => b.rms - a.rms);
  const rows = ROWS.map((ch, c) => ({ label: ch.label, peak: mean(rowPeak[c]), rms: mean(rowRms[c]) }));
  const top = field[0];
  const largestRow = Math.max(...rows.map(r => r.rms));
  const largestRowPeak = Math.max(...rowPeak.map(p => Math.max(...p.map(Math.abs))));
  console.log(`\n== ${t} [${state}]`);
  if (top.rms < 0.05) {
    console.log('   no isolable contribution (the toggle only moves the state, or adds nothing)');
    report[t] = { state, empty: true };
    continue;
  }
  const sig = first![top.e];
  const pk = spectralPeak(welch(sig, FS, 1024), 0.5, 60);
  const ev = events(sig);
  const smallestOverLargest = Math.min(...rows.map(r => r.rms)) / largestRow;
  console.log(`   strongest ${top.e}: peak ${f(top.peak)} uV, RMS ${f(top.rms)} | dominant ${pk.freq.toFixed(1)} Hz | ` +
    `${ev.n} events in ${SECS} s, interval ${ev.meanInterval.toFixed(2)} s, CV ${ev.cv.toFixed(2)}`);
  console.log('   electrodes, peak uV (% of strongest, RMS): ' +
    field.map(x => `${x.e} ${f(x.peak)}(${(100 * x.rms / top.rms).toFixed(0)})`).join('  '));
  console.log('   rows, peak uV (% of largest row, RMS):      ' +
    rows.map(r => `${r.label} ${f(r.peak)}(${(100 * r.rms / largestRow).toFixed(0)})`).join('  '));
  console.log(`   smallest / largest row ${smallestOverLargest.toFixed(2)}; largest row peak ${f(largestRowPeak)} uV` +
    (largestRowPeak < VISIBLE_UV ? `   <-- UNDER ${VISIBLE_UV} uV: not visible at 7 uV/mm` : ''));
  if (largestRowPeak < VISIBLE_UV) dead.push(`${t} (${f(largestRowPeak)} uV)`);
  report[t] = { state, field, rows, dominantHz: pk.freq, events: ev, smallestOverLargest, largestRowPeak };
}

console.log(`\n${toggles.length} toggle(s) audited on ${arg('--montage', 'bipolar-ap')}.`);
console.log(dead.length
  ? `Under ${VISIBLE_UV} uV on every row (nothing to see at 7 uV/mm): ${dead.join(', ')}`
  : `Every toggle with a contribution reaches ${VISIBLE_UV} uV on at least one row.`);
if (OUT) writeFileSync(OUT, JSON.stringify(report));

/**
 * Measure a toggle's ISOLATED scalp field and its bipolar-chain gradient.
 *
 * WHAT IT ANSWERS
 * ---------------
 * "How far does this generator spread, and how fast does it decay down a chain?"
 * — the question behind every localisation claim the simulator teaches. A source
 * whose field is too broad turns a focal finding into a generalised one; one that
 * decays too slowly makes two adjacent bipolar rows equal, which erases the step
 * a reader localises from.
 *
 * WHY on-minus-off, AND WHY RAW ELECTRODES
 * ----------------------------------------
 * Reading a channel's peak with the toggle on measures the toggle PLUS the
 * background, muscle and mains that happen to be there. On a busy record those
 * dominate, and the resulting "field" is mostly not the generator. So every
 * number here is a same-seed difference: the identical run with the toggle off is
 * subtracted sample by sample, leaving the generator's own contribution.
 *
 * The field is read from the engine's RAW per-electrode voltages rather than from
 * a referential montage. Any reference — A1, or the common average — is itself a
 * signal, so a field measured through one is the generator minus something. That
 * is the right thing to draw and the wrong thing to measure a spatial extent
 * with. The bipolar section below is then the display-space consequence, computed
 * from those same raw values through the production channel formula.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx ./src/measureField.ts --toggle blink
 *   pnpm --filter @workspace/scripts exec tsx ./src/measureField.ts --toggle v-waves --state n2
 */
import { SimulationSource } from '../../artifacts/eeg-simulator/src/engine/adapter';
import { ALL_ELECTRODES, type ChannelDef } from '../../artifacts/eeg-simulator/src/utils/montages';
import { commonAverage, computeChannelVoltage } from '../../artifacts/eeg-simulator/src/utils/computeChannel';
import {
  defaultArtifactParams, defaultIctalParamsMap,
  type SimSettings, type PatientState,
} from '../../artifacts/eeg-simulator/src/utils/simTypes';
import { electrodeDistanceCm } from '../../artifacts/eeg-simulator/src/engine/forward';
import { PATTERN_SOURCES } from '../../artifacts/eeg-simulator/src/engine/sources/registry';
import { CLINICAL_DOUBLE_BANANA } from './renderClinicalPage';

const FS = 250;

/**
 * Below this, a measured "field" is not one. Toggling a pattern can perturb the
 * RNG stream even where the pattern never fires, leaving sub-µV residue; and
 * `RecordingChain`'s own sensor noise floor is ~0.9 µV RMS, so anything under
 * half a microvolt is below what the instrument could register anyway.
 */
const NOISE_FLOOR_UV = 0.5;

type Opts = {
  toggle: string;
  state: PatientState;
  seconds: number;
  seeds: number[];
};

/** Raw per-electrode voltages plus the bipolar rows, for one run. */
function run(o: Opts, patterns: string[], seed: number) {
  const settings: SimSettings = {
    speed: 30, sensitivity: 7, patientState: o.state,
    activePatterns: new Set(patterns),
    ictalParams: defaultIctalParamsMap(),
    artifactParams: defaultArtifactParams(),
  };
  const src = new SimulationSource(seed, FS);
  const n = Math.floor(o.seconds * FS);
  const el: Record<string, Float64Array> = {};
  for (const e of ALL_ELECTRODES) el[e] = new Float64Array(n);
  const rows = CLINICAL_DOUBLE_BANANA.map(() => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    const allV = src.next(settings);
    const avg = commonAverage(allV);
    for (const e of ALL_ELECTRODES) el[e][i] = allV[e] ?? 0;
    for (let c = 0; c < CLINICAL_DOUBLE_BANANA.length; c++) {
      rows[c][i] = computeChannelVoltage(CLINICAL_DOUBLE_BANANA[c], src.t, allV, avg);
    }
  }
  return { el, rows, n };
}

/** Same-seed on-minus-off: the toggle's own contribution. */
function contribution(o: Opts, seed: number) {
  const off = run(o, [], seed);
  const on = run(o, [o.toggle], seed);
  const el: Record<string, Float64Array> = {};
  for (const e of ALL_ELECTRODES) {
    const d = new Float64Array(off.n);
    for (let i = 0; i < off.n; i++) d[i] = on.el[e][i] - off.el[e][i];
    el[e] = d;
  }
  const rows = off.rows.map((offRow, c) => {
    const d = new Float64Array(off.n);
    for (let i = 0; i < off.n; i++) d[i] = on.rows[c][i] - offRow[i];
    return d;
  });
  return { el, rows };
}

/** Largest-|value| sample, with sign. */
function signedPeak(x: Float64Array): number {
  let p = 0;
  for (const v of x) if (Math.abs(v) > Math.abs(p)) p = v;
  return p;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Width at half maximum of the largest excursion, in milliseconds. */
function fwhmMs(x: Float64Array): number {
  let pi = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > Math.abs(x[pi])) pi = i;
  const half = Math.abs(x[pi]) / 2;
  let a = pi, b = pi;
  while (a > 0 && Math.abs(x[a]) > half) a--;
  while (b < x.length - 1 && Math.abs(x[b]) > half) b++;
  return 1000 * (b - a) / FS;
}

export function measureField(o: Opts) {
  const elPeaks: Record<string, number[]> = {};
  const rowPeaks: number[][] = CLINICAL_DOUBLE_BANANA.map(() => []);
  for (const seed of o.seeds) {
    const c = contribution(o, seed);
    for (const e of ALL_ELECTRODES) (elPeaks[e] ??= []).push(signedPeak(c.el[e]));
    c.rows.forEach((x, i) => rowPeaks[i].push(signedPeak(x)));
  }
  const field = Object.fromEntries(ALL_ELECTRODES.map(e => [e, mean(elPeaks[e])]));
  const rows = rowPeaks.map(mean);
  return { field, rows };
}

/**
 * Why an on-minus-off difference can be identically zero.
 *
 * A source marked `stateIntrinsic` is emitted by its states whether or not its
 * toggle is set — vertex waves are part of N1/N2, not an optional extra — so
 * differencing on against off yields exactly nothing. That is a real property of
 * the engine, not an empty result, and saying so is the difference between a
 * measurement and a silent zero. A zero that prints as `NaN%` reads like a broken
 * tool and invites the reader to discard a true finding.
 */
function explainEmpty(o: Opts): string {
  const d = PATTERN_SOURCES.find(src => src.toggles?.includes(o.toggle));
  if (!d) {
    return `No pattern source declares the toggle '${o.toggle}'. Check the id against utils/patterns.ts.`;
  }
  if (d.stateIntrinsic && d.states?.includes(o.state)) {
    return `'${o.toggle}' is stateIntrinsic and '${o.state}' is one of its states (${d.states.join(', ')}),\n`
      + `   so the engine emits it whether the toggle is set or not. On-minus-off is therefore\n`
      + `   exactly zero BY DESIGN, not by failure. To measure this source's field, read the\n`
      + `   transient directly off a rendered page (renderClinicalPage.ts).`;
  }
  if (d.states && !d.states.includes(o.state)) {
    return `'${o.toggle}' is gated to states [${d.states.join(', ')}] and you asked for '${o.state}',\n`
      + `   so it never fires. Re-run with --state ${d.states[0]}.`;
  }
  return `'${o.toggle}' produced no difference in state '${o.state}'. It may be gated by an\n`
    + `   artifact parameter (e.g. a rate of zero) rather than by the toggle alone.`;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): Opts {
  const o: Opts = { toggle: 'blink', state: 'awake', seconds: 60, seeds: [42, 7, 1234] };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case '--toggle': o.toggle = next(); break;
      case '--state': o.state = next() as PatientState; break;
      case '--seconds': o.seconds = Number(next()); break;
      case '--seeds': o.seeds = next().split(',').map(Number); break;
    }
  }
  return o;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('measureField.ts')) {
  const o = parseArgs(process.argv.slice(2));
  const { field, rows } = measureField(o);

  if (ALL_ELECTRODES.every(e => Math.abs(field[e]) < NOISE_FLOOR_UV)) {
    console.log(`\nISOLATED FIELD OF '${o.toggle}' — state ${o.state}: NO ISOLABLE CONTRIBUTION\n`);
    console.log('   ' + explainEmpty(o));
    process.exit(0);
  }

  console.log(`\nISOLATED FIELD OF '${o.toggle}' — state ${o.state}, ${o.seconds} s, seeds ${o.seeds.join('/')}`);
  console.log('(same-seed on-minus-off; raw electrode voltages, no reference)\n');

  const ranked = ALL_ELECTRODES
    .map(e => ({ e, v: field[e] }))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const maxEl = ranked[0];
  console.log(`A. Scalp field — maximum at ${maxEl.e} (${maxEl.v.toFixed(1)} µV)\n`);
  console.log('   electrode   peak (µV)   % of max   distance from max');
  for (const { e, v } of ranked) {
    const pct = 100 * Math.abs(v) / Math.abs(maxEl.v);
    const d = e === maxEl.e ? 0 : electrodeDistanceCm(maxEl.e, e);
    console.log(
      `   ${e.padEnd(10)} ${v.toFixed(1).padStart(8)}   ${pct.toFixed(0).padStart(7)}%` +
      `   ${d ? d.toFixed(1).padStart(11) + ' cm' : '          —'}`,
    );
  }

  console.log('\nB. Bipolar chains (clinical double banana), + = drawn downward');
  console.log('   Each row as a fraction of the FIRST row of its own chain: this is the');
  console.log('   "present but decaying" quantity, and a value near 1.0 means no decay —');
  console.log('   two adjacent rows the same size, with no step for a reader to localise.\n');
  console.log('   channel      peak (µV)   % of chain head');
  let headIdx = 0;
  CLINICAL_DOUBLE_BANANA.forEach((ch, i) => {
    if (ch.group === 'ecg') return;
    const prev = CLINICAL_DOUBLE_BANANA[i - 1];
    if (!prev || prev.group !== ch.group) { headIdx = i; console.log(''); }
    // A percentage of a chain head that is itself below the noise floor is
    // meaningless (and prints things like -125%), so say so instead.
    const pct = Math.abs(rows[headIdx]) < NOISE_FLOOR_UV
      ? '           —'
      : (100 * rows[i] / rows[headIdx]).toFixed(0).padStart(12) + '%';
    console.log(`   ${ch.label.padEnd(12)} ${rows[i].toFixed(1).padStart(8)}   ${pct}`);
  });

  const topRow = rows
    .map((v, i) => ({ v, i }))
    .filter(x => CLINICAL_DOUBLE_BANANA[x.i].group !== 'ecg')
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0];
  const single = contribution({ ...o, seconds: Math.min(o.seconds, 20) }, o.seeds[0]).rows[topRow.i];
  const ms = fwhmMs(single);
  console.log(`\nC. Width at half maximum on ${CLINICAL_DOUBLE_BANANA[topRow.i].label} (largest row)`);
  console.log(`   ${ms.toFixed(0)} ms  =  ${(ms / 1000 * 30).toFixed(1)} mm of paper at 30 mm/s`);
}

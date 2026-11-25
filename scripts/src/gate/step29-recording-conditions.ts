import { defaultArtifactParams, defaultIctalParamsMap, DEFAULT_FILTERS } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
import type { ArtifactParams, ConditionLevel, SimSettings } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
import { SimulationSource } from '../../../artifacts/eeg-simulator/src/engine/adapter';
import { MONTAGES } from '../../../artifacts/eeg-simulator/src/utils/montages';
import { commonAverage, computeChannelVoltage } from '../../../artifacts/eeg-simulator/src/utils/computeChannel';
import { markRowSizes, markRows } from '../../../artifacts/eeg-simulator/src/utils/markRows';
import { initialToggles, effective, switchOff, switchOn, type ToggleState } from '../../../artifacts/eeg-simulator/src/utils/toggleRules';
import { applyLevel, CONDITION_LEVELS, CONDITION_TOGGLES, RECIPES } from '../../../artifacts/eeg-simulator/src/utils/recordingConditions';
import { contactCoupling } from '../../../artifacts/eeg-simulator/src/engine/breathing';
import { PULSE_DELAY_S } from '../../../artifacts/eeg-simulator/src/engine/bedside';
import { electrodePositions3D } from '../../../artifacts/eeg-simulator/src/utils/electrodePositions3D';
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
    // The background the mains buries is the patient's own record, not the other
    // artifacts: since the ventilator's bursts (2026-11-25) sit on the left occipital
    // rows, measuring against everything else made the bursts the "background".
    const clean = run('icu', effective(CONDITION_TOGGLES.reduce((t, id) => switchOff(t, id), toggles)), params, SECS, seed);
    const skip = 3 * FS; // the filters settled
    const rowsB: number[] = [], rowsL: number[] = [];
    on.chans.forEach((l, k) => {
      if (!occipital(l)) return;
      const bg = p2p(clean.data[k].slice(skip));
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
      // The ventilator sets the breathing's timing, so switching it off moves every breath:
      // the breathing artifact's waves, annotated under their own toggle in either run,
      // are part of its difference too.
      const ids = new Set(id === 'ventilator' ? [id, 'respiration'] : [id]);
      const marks = [...on.marks, ...(id === 'ventilator' ? off.marks : [])].filter((m) => ids.has(m.id));
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

// ---------------------------------------------------------------------------
// Breathing artifact (IK-049) and the ventilator (IK-050), against the Resp row.
// ---------------------------------------------------------------------------

/** A Custom page with these toggles: each referential channel, the Resp row, and the marks. */
function runAux(patterns: string[], params: ArtifactParams, secs: number, seed: number,
  atS?: { t: number; params: ArtifactParams }, montageId = 'reference-car') {
  const montage = MONTAGES[montageId];
  const chans = montage.channels.filter((c) => c.active !== 'ECG');
  const key = (c: (typeof chans)[number]) => (montageId === 'reference-car' ? c.active : c.label);
  let settings: SimSettings = {
    speed: 30, sensitivity: 7, patientState: 'awake', activePatterns: new Set(patterns),
    ictalParams: defaultIctalParamsMap(), artifactParams: params, filters: DEFAULT_FILTERS,
  };
  const src = new SimulationSource(seed, FS);
  src.useAppMode();
  const n = secs * FS;
  const data: Record<string, Float64Array> = {};
  for (const c of chans) data[key(c)] = new Float64Array(n);
  const resp = new Float64Array(n);
  const ecg = new Float64Array(n);
  const marks: { id: string; t: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (atS && i === atS.t * FS) settings = { ...settings, artifactParams: atS.params };
    const v = src.next(settings);
    const avg = commonAverage(v);
    for (const c of chans) data[key(c)][i] = computeChannelVoltage(c, src.t, v, avg);
    resp[i] = v['Resp'];
    ecg[i] = v['ECG'];
    for (const m of src.groundTruth.marks) marks.push({ id: m.id, t: i / FS - (m.ago ?? 0) });
  }
  return { data, resp, ecg, marks };
}

/** Inspiration onsets on the Resp row, seconds: where the trace turns from falling to rising. */
function inspirations(resp: Float64Array): number[] {
  const out: number[] = [];
  for (let i = 1; i < resp.length - 1; i++) if (resp[i] <= resp[i - 1] && resp[i + 1] > resp[i]) out.push(i / FS);
  return out;
}
const cv = (x: number[]) => {
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / x.length) / m;
};
const diffs = (t: number[]) => t.slice(1).map((v, i) => v - t[i]);
const pearson = (a: number[], b: number[]) => {
  const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb);
};
// The furthest from 1 of several ratios.
const worstOf1 = (x: number[]) => x.reduce((w, r) => (Math.abs(r - 1) > Math.abs(w - 1) ? r : w), 1);

section('\nBreathing artifact (IK-049): a wave per breath at one contact, on the Resp row inspirations:', () => {
  const SECS = 60, skip = 3;
  const base = defaultArtifactParams();
  const matched: number[] = [], isolation: number[] = [], size: number[] = [], rate: number[] = [];
  let lyingOk = 0;
  for (const seed of SEEDS) {
    const on = runAux(['respiration'], base, SECS, seed), off = runAux([], base, SECS, seed);
    const tail = (e: string, x: { data: Record<string, Float64Array> }) => Array.from(x.data[e]).slice(skip * FS);
    const contrib = (e: string) => tail(e, on).map((v, i) => v - tail(e, off)[i]);
    // Wave onsets: the contribution passing a fifth of its largest, at least a second apart.
    const d = contrib('P4');
    const peak = Math.max(...d.map(Math.abs));
    const onsets: number[] = [];
    for (let i = 0; i < d.length; i++) {
      const t = skip + i / FS;
      if (Math.abs(d[i]) > 0.2 * peak && (onsets.length === 0 || t - onsets[onsets.length - 1] > 1)) onsets.push(t);
    }
    const insp = inspirations(on.resp);
    matched.push(onsets.filter((t) => insp.some((s) => t - s >= 0 && t - s <= 0.3)).length / onsets.length);
    const names = Object.keys(on.data);
    const coupling = contactCoupling(names, ['P4']);
    const far = names.filter((_, k) => coupling[k] === 0);
    isolation.push(p2p(d) / Math.max(...far.map((e) => p2p(contrib(e)))));
    size.push(p2p(d) / p2p(tail('P4', off)));
    rate.push(onsets.length / insp.filter((t) => t >= skip).length);
    // The second kind: on the electrodes lain on.
    const lyingParams = { ...base, respirationForm: 'lying' as const };
    const onL = runAux(['respiration'], lyingParams, 20, seed), offL = runAux([], lyingParams, 20, seed);
    const sizes = names.map((e) => [e, p2p(Array.from(onL.data[e]).map((v, i) => v - offL.data[e][i]))] as const)
      .sort((a, b) => b[1] - a[1]);
    if (['O1', 'O2'].includes(sizes[0][0]) && ['O1', 'O2'].includes(sizes[1][0])) lyingOk++;
  }
  check('respiration, one electrode: waves starting within 0.3 s of a Resp-row inspiration, share, worst of 3', Math.min(...matched), 1, 1);
  check('respiration, one electrode: its channel / largest channel not next to it, smallest of 3', Math.min(...isolation), 3, Infinity);
  check("respiration, one electrode: wave / its channel's own background, peak to peak, median of 3 (eegpedia figure: about 2)", median(size), 1.2, 3);
  check('respiration, lying on: subjects whose two largest channels are O1 and O2', lyingOk, 3, 3);
  check('respiration: artifact rate / Resp-row rate, worst of 3', worstOf1(rate), 0.98, 1.02);
});

section('\nVentilator (IK-050): identical bursts at every breath, larger on its side, gone after suctioning:', () => {
  const SECS = 60, skip = 3;
  const base = { ...defaultArtifactParams(), ventSide: 'left' as const, ventRatePerMin: 16 };
  const intervalCv: number[] = [], period: number[] = [], durations: number[] = [], corr: number[] = [], lr: number[] = [], respCv: number[] = [];
  // Left and right chains on the double banana, as the source read it (a bipolar
  // montage): on an average reference the field the leads share is taken out, and the
  // left side's excess shows as an equal and opposite deflection on the right.
  const LEFT = ['Fp1-F3', 'F3-C3', 'C3-P3', 'P3-O1', 'Fp1-F7', 'F7-T3', 'T3-T5', 'T5-O1'];
  const RIGHT = ['Fp2-F4', 'F4-C4', 'C4-P4', 'P4-O2', 'Fp2-F8', 'F8-T4', 'T4-T6', 'T6-O2'];
  for (const seed of SEEDS) {
    const on = runAux(['ventilator'], base, SECS, seed), off = runAux([], base, SECS, seed);
    const starts = on.marks.filter((m) => m.id === 'ventilator').map((m) => m.t).filter((t) => t >= skip);
    const iv = diffs(starts);
    intervalCv.push(cv(iv));
    period.push((iv.reduce((a, b) => a + b, 0) / iv.length) / (60 / base.ventRatePerMin));
    respCv.push(cv(diffs(inspirations(on.resp).filter((t) => t >= skip))));
    const contrib = (e: string) => Array.from(on.data[e]).map((v, i) => v - off.data[e][i]);
    const p = (e: string) => p2p(contrib(e).slice(skip * FS));
    const largest = Object.keys(on.data).reduce((a, b) => (p(b) > p(a) ? b : a));
    const d = contrib(largest);
    const segs = starts.filter((t) => t + 1.5 < SECS).map((t) => d.slice(Math.round(t * FS), Math.round((t + 1.5) * FS)));
    for (const s of segs) {
      const pk = Math.max(...s.map(Math.abs));
      const idx = s.map((v, i) => (Math.abs(v) > 0.1 * pk ? i : -1)).filter((i) => i >= 0);
      durations.push((idx[idx.length - 1] - idx[0]) / FS);
    }
    corr.push(Math.min(...segs.slice(1).map((s, i) => pearson(segs[i], s))));
    const onB = runAux(['ventilator'], base, 20, seed, undefined, 'bipolar-ap');
    const offB = runAux([], base, 20, seed, undefined, 'bipolar-ap');
    const pB = (row: string) => p2p(Array.from(onB.data[row]).slice(skip * FS).map((v, i) => v - offB.data[row][i + skip * FS]));
    const mean = (rows: string[]) => rows.map(pB).reduce((a, b) => a + b, 0) / rows.length;
    lr.push(mean(LEFT) / mean(RIGHT));
  }
  check('ventilator: burst interval CV, worst of 3', Math.max(...intervalCv), 0, 0.01);
  check('ventilator: mean burst interval / the set period, worst of 3', worstOf1(period), 0.99, 1.01);
  check('ventilator: burst duration, median of 3', median(durations), 0.7, 1.3, 's');
  check('ventilator: correlation of successive bursts on the largest channel, smallest of 3', Math.min(...corr), 0.9, 1);
  check('ventilator: left / right channels, ventilator on the left, smallest of 3', Math.min(...lr), 1, Infinity);
  // Suction at 20 s: nothing for the next 30 s.
  const sucked = runAux(['ventilator'], base, 55, 3, { t: 20, params: { ...base, suctionNonce: 1 } });
  check('ventilator: bursts in the 30 s after suctioning',
    sucked.marks.filter((m) => m.id === 'ventilator' && m.t > 20.01 && m.t < 50).length, 0, 0);
  check('ventilator: Resp-row breath interval CV, worst of 3', Math.max(...respCv), 0, 0.01);
});

section('\nPulse artifact (IK-051): a slow wave on one electrode, 0.2-0.3 s after every QRS:', () => {
  const SECS = 60, skip = 3;
  const base = defaultArtifactParams();
  const rate: number[] = [], delayed: number[] = [], isolation: number[] = [], size: number[] = [];
  for (const seed of SEEDS) {
    const on = runAux(['pulse'], base, SECS, seed), off = runAux([], base, SECS, seed);
    const names = Object.keys(on.data);
    const contrib = (e: string) => Array.from(on.data[e]).slice(skip * FS).map((v, i) => v - off.data[e][i + skip * FS]);
    const d = contrib('F3');
    // The wave's own sign: its largest excursion. Onsets: crossing 5% of that, signed (the
    // filter's undershoot after each wave has the other sign), at least 0.3 s apart.
    const big = d.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
    const onsets: number[] = [];
    for (let i = 1; i < d.length; i++) {
      const t = skip + i / FS;
      if (d[i] / big > 0.05 && d[i - 1] / big <= 0.05 && (onsets.length === 0 || t - onsets[onsets.length - 1] > 0.3)) onsets.push(t);
    }
    // R waves on the ECG row: its rising edge through half its peak.
    const peakEcg = Math.max(...Array.from(on.ecg));
    const rs: number[] = [];
    for (let i = 1; i < on.ecg.length; i++) if (on.ecg[i] > 0.5 * peakEcg && on.ecg[i - 1] <= 0.5 * peakEcg) rs.push(i / FS);
    rate.push(onsets.length / rs.filter((t) => t >= skip - PULSE_DELAY_S && t < SECS - PULSE_DELAY_S).length);
    delayed.push(onsets.filter((t) => rs.some((r) => t - r >= 0.2 && t - r <= 0.3)).length / onsets.length);
    isolation.push(p2p(d) / Math.max(...names.filter((e) => e !== 'F3').map((e) => p2p(contrib(e)))));
    // The four electrodes nearest F3 on the scalp: the rows eegpedia's figure compares against.
    const at = (e: string) => electrodePositions3D[e];
    const dist = (e: string) => Math.hypot(...at(e).map((x, k) => x - at('F3')[k]));
    const neighbours = names.filter((e) => e !== 'F3' && at(e)).sort((a, b) => dist(a) - dist(b)).slice(0, 4);
    size.push(p2p(d) / median(neighbours.map((e) => p2p(Array.from(off.data[e]).slice(skip * FS)))));
  }
  check('pulse: wave rate / heart rate, worst of 3', worstOf1(rate), 0.98, 1.02);
  check('pulse: waves starting 0.2-0.3 s after their R wave, share, worst of 3', Math.min(...delayed), 1, 1);
  check('pulse: its channel / largest other channel, smallest of 3', Math.min(...isolation), 3, Infinity);
  check("pulse: wave / the neighbouring channels' background, peak to peak, median of 3 (eegpedia figure: about 2.5)", median(size), 1.5, 4);
});

section('\nIV drip (IK-052): a brief polyphasic spike at each drop, on a few electrodes, regular:', () => {
  const SECS = 60, skip = 3;
  const base = { ...defaultArtifactParams(), dripRatePerMin: 30 };
  const intervalCv: number[] = [], period: number[] = [], longest: number[] = [], signs: number[] = [], wide: number[] = [];
  for (const seed of SEEDS) {
    const on = runAux(['iv-drip'], base, SECS, seed), off = runAux([], base, SECS, seed);
    const drops = on.marks.filter((m) => m.id === 'iv-drip').map((m) => m.t).filter((t) => t >= skip && t < SECS - 0.3);
    const iv = diffs(drops);
    intervalCv.push(cv(iv));
    period.push((iv.reduce((a, b) => a + b, 0) / iv.length) / (60 / base.dripRatePerMin));
    const names = Object.keys(on.data);
    const contrib = (e: string) => Array.from(on.data[e]).map((v, i) => v - off.data[e][i]);
    const sizes = names.map((e) => p2p(contrib(e).slice(skip * FS)));
    const top = Math.max(...sizes);
    wide.push(sizes.filter((x) => x >= 0.5 * top).length);
    const d = contrib(names[sizes.indexOf(top)]);
    let maxDur = 0, minSigns = Infinity;
    for (const t of drops) {
      const seg = d.slice(Math.round((t - 0.02) * FS), Math.round((t + 0.25) * FS));
      const pk = Math.max(...seg.map(Math.abs));
      const idx = seg.map((v, i) => (Math.abs(v) > 0.1 * pk ? i : -1)).filter((i) => i >= 0);
      maxDur = Math.max(maxDur, (idx[idx.length - 1] - idx[0]) / FS);
      const lobes = idx.map((i) => Math.sign(seg[i]));
      minSigns = Math.min(minSigns, lobes.slice(1).filter((x, i) => x !== lobes[i]).length);
    }
    longest.push(maxDur);
    signs.push(minSigns);
  }
  check('iv drip: interval CV, worst of 3', Math.max(...intervalCv), 0, 0.05);
  check('iv drip: mean interval / the set period, worst of 3', worstOf1(period), 0.98, 1.02);
  check('iv drip: transient duration, longest of 3', Math.max(...longest), 0, 0.1, 's');
  check('iv drip: changes of sign within a transient, fewest of 3', Math.min(...signs), 2, Infinity);
  check('iv drip: channels at half the largest or more, most of 3', Math.max(...wide), 1, 3);
});

section('\nThe patient under each level: heart and breathing that settle, rise with activity, and a ventilator that never varies:', () => {
  /** A level's page, run: R waves on the ECG row, inspirations on the Resp row, and when the patient was active. */
  const runVitals = (level: ConditionLevel, secs: number, seed: number) => {
    const { toggles, params } = levelPage(level);
    const settings: SimSettings = {
      speed: 30, sensitivity: 7, patientState: 'awake', activePatterns: effective(toggles),
      ictalParams: defaultIctalParamsMap(), artifactParams: params, filters: DEFAULT_FILTERS, conditions: level,
    };
    const src = new SimulationSource(seed, FS);
    src.useAppMode();
    const n = secs * FS;
    const ecg = new Float64Array(n), resp = new Float64Array(n), active = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = src.next(settings);
      ecg[i] = v['ECG']; resp[i] = v['Resp'];
      active[i] = src.groundTruth.live.movementActive ? 1 : 0;
    }
    const peak = Math.max(...Array.from(ecg));
    const rs: number[] = [];
    for (let i = 1; i < n; i++) if (ecg[i] > 0.5 * peak && ecg[i - 1] <= 0.5 * peak) rs.push(i / FS);
    return { rs, insp: inspirations(resp), active };
  };
  /** Beats (or breaths) a minute over [a, b), from the intervals inside it. */
  const ratePerMin = (events: number[], a: number, b: number, keep: (t: number) => boolean = () => true) => {
    const iv = events.slice(1).map((t, k) => [t, t - events[k]] as const).filter(([t]) => t >= a && t < b && keep(t)).map(([, d]) => d);
    return iv.length ? 60 / (iv.reduce((x, y) => x + y, 0) / iv.length) : NaN;
  };
  const settle: number[] = [], hrActive: number[] = [], brActive: number[] = [], ventCv: number[] = [];
  for (const seed of SEEDS) {
    const r = runVitals('routine', 300, seed);
    settle.push(ratePerMin(r.rs, 3, 60) / ratePerMin(r.rs, 180, 300));
    const a = runVitals('ambulatory', 300, seed);
    // Well inside an activity stretch (the heart takes ~10 s to quicken), against well outside one.
    const at = (t: number) => a.active[Math.min(a.active.length - 1, Math.round(t * FS))];
    const inside = (t: number) => at(t) === 1 && at(t - 15) === 1;
    const outside = (t: number) => at(t) === 0 && at(t - 30) === 0;
    hrActive.push(ratePerMin(a.rs, 3, 300, inside) / ratePerMin(a.rs, 3, 300, outside));
    brActive.push(ratePerMin(a.insp, 3, 300, inside) / ratePerMin(a.insp, 3, 300, outside));
    const icu = runVitals('icu', 120, seed);
    ventCv.push(cv(diffs(icu.insp.filter((t) => t >= 3))));
  }
  check('vitals, routine: heart rate in the first minute / in minutes 3-5, median of 3 (an anxious patient settles)', median(settle), 1.07, Infinity);
  check('vitals, ambulatory: heart rate while active / while quiet, median of 3', median(hrActive), 1.15, Infinity);
  check('vitals, ambulatory: breathing rate while active / while quiet, median of 3', median(brActive), 1.2, Infinity);
  check('vitals, icu: Resp-row breath interval CV on the ventilator, worst of 3 (the machine sets it)', Math.max(...ventCv), 0, 0.01);
});

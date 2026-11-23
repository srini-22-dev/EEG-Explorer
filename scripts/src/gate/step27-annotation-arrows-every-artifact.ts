import { defaultArtifactParams, defaultIctalParamsMap } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
import type { PatientState, SimSettings } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
import { SimulationSource } from '../../../artifacts/eeg-simulator/src/engine/adapter';
import { MONTAGES } from '../../../artifacts/eeg-simulator/src/utils/montages';
import { commonAverage, computeChannelVoltage } from '../../../artifacts/eeg-simulator/src/utils/computeChannel';
import { markRowSizes, markRows } from '../../../artifacts/eeg-simulator/src/utils/markRows';
import { PATTERN_CATEGORIES } from '../../../artifacts/eeg-simulator/src/utils/patterns';
import type { ArtifactMark } from '../../../artifacts/eeg-simulator/src/engine/engine';
import { initialToggles, effective, toggle, setPage, switchOff } from '../../../artifacts/eeg-simulator/src/utils/toggleRules';
import { join } from 'node:path';
import { FS, check, section, step } from './harness';

// ===========================================================================
// Step 27: annotation arrows — every artifact pointed at, on the rows it is on.
//
// The arrows are the app's own claim about where an artifact is, and until
// 2026-10-13 nothing checked them. The owner found the result on the page:
// artifacts with no arrow, and one arrow for an artifact on eight rows. What had
// gone wrong, each caught by a measurement below when it was first run:
//   - one arrow per event, on the first row that recorded a listed electrode;
//   - a spindle's two generators marked as one, so a central spindle was pointed
//     at on the frontal rows as well;
//   - a chew marked two or three times, at each gap in its own muscle noise;
//   - a roving eye movement's trough left out whenever a wobble came before it;
//   - the roving movement itself switching on with a 71 uV step.
//
// Run exactly as the app runs it: `SimulationSource` in app mode, the marks it
// reports, and `utils/markRows.ts` — the function the canvas calls — to turn a
// mark into rows. The artifact's true extent on the page is its on-minus-off
// contribution through the montage.
// ===========================================================================
step('\n=== Step 27: annotation arrows — every artifact pointed at, on the rows it is on ===\n');

section(null, () => {
  const SECS = 40, SEED = 3;
  const montage = MONTAGES['bipolar-ap'];
  const chans = montage.channels.map((c, i) => ({ c, i })).filter(({ c }) => c.active !== 'ECG');
  // `span`: the mark is a box over [t, t + span] (an event with extent), not an arrow;
  // Infinity while a pattern with no end is on, until the mark with its `key` closes it.
  type Mark = { id: string; label?: string; t: number; dur: number; span?: number; key?: string; rows: string[] };
  const appRun = (state: PatientState, patterns: string[], opts?: SimSettings['patternOptions'], secs = SECS) => {
    const settings: SimSettings = {
      speed: 30, sensitivity: 7, patientState: state, activePatterns: new Set(patterns),
      ictalParams: defaultIctalParamsMap(), artifactParams: defaultArtifactParams(), patternOptions: opts,
    };
    const src = new SimulationSource(SEED, FS);
    src.useAppMode();
    const n = secs * FS;
    const data = chans.map(() => new Float64Array(n));
    const marks: Mark[] = [];
    for (let i = 0; i < n; i++) {
      const allV = src.next(settings);
      const avg = commonAverage(allV);
      chans.forEach(({ c }, k) => { data[k][i] = computeChannelVoltage(c, src.t, allV, avg); });
      for (const m of src.groundTruth.marks) {
        const t = i / FS - (m.ago ?? 0);
        // As the canvas does: a closing mark ends the open box with its key.
        const open = m.key != null ? marks.find((o) => o.key === m.key && o.span === Infinity) : undefined;
        if (open) { open.span = t - open.t; continue; }
        const rows = m.page ? chans.map(({ i: c }) => c)
          : markRows(markRowSizes(m.fields, montage), m.inUv ? settings.sensitivity : undefined, m.span != null ? Infinity : undefined);
        marks.push({ id: m.id, label: m.label, t, dur: m.dur, span: m.span, key: m.key, rows: rows.map((c) => montage.channels[c].label) });
      }
    }
    return { data, marks };
  };
  // What the artifact does to the page, and what the arrows say about it.
  // `allRows`: look for events on every row, not only the rows the marks name — for a
  // toggle whose marks are the thing being tested, and may be missing.
  const survey = (state: PatientState, patterns: string[], toggle: string, opts?: SimSettings['patternOptions'], allRows = false) => {
    const on = appRun(state, patterns, opts), off = appRun(state, patterns.filter((x) => x !== toggle), opts);
    const n = SECS * FS;
    const marks = on.marks.filter((m) => m.id === toggle || (toggle === 'eye-opening' && m.id === 'eye-closing'));
    const arrowed = new Set(marks.flatMap((m) => m.rows));
    const moved = chans.map((_, k) => { let x = 0; for (let i = 0; i < n; i++) x = Math.max(x, Math.abs(on.data[k][i] - off.data[k][i])); return x; });
    const largest = Math.max(...moved);
    // Events: stretches in which a row the artifact is pointed at on is moved by
    // 2 mm or more (14 uV at 7 uV/mm), joined across gaps under 0.4 s. Only those
    // rows: eye opening also blocks the alpha rhythm at the back of the head, and
    // that difference is the background's, not the artifact's.
    const watch = chans.map(({ c }, k) => (allRows || arrowed.has(c.label) ? k : -1)).filter((k) => k >= 0);
    const episodes = (gapS: number) => {
      const out: [number, number][] = [];
      let start = -1, last = -1;
      for (let i = 0; i < n; i++) {
        let hit = false;
        for (const k of watch) if (Math.abs(on.data[k][i] - off.data[k][i]) >= 14) { hit = true; break; }
        if (hit) { if (start < 0) start = i; last = i; }
        else if (start >= 0 && i - last > gapS * FS) { out.push([start / FS, last / FS]); start = -1; }
      }
      if (start >= 0) out.push([start / FS, last / FS]);
      return out;
    };
    const events = episodes(0.4);
    // An event is marked by an arrow whose window touches it, or by a box over it.
    const covers = (m: Mark, a: number, b: number) => (m.span != null
      ? m.t <= b + 0.15 && m.t + m.span >= a - 0.15
      : m.t + m.dur >= a - 0.15 && m.t <= b + 0.15);
    const times = marks.map((m) => m.t).sort((a, b) => a - b);
    let longestGap = times.length ? Math.max(times[0], SECS - times[times.length - 1]) : SECS;
    for (let k = 1; k < times.length; k++) longestGap = Math.max(longestGap, times[k] - times[k - 1]);
    // The contribution on the row the artifact is largest on, for how much of it the boxes hold.
    const top = moved.indexOf(largest);
    const inBoxes = () => {
      let inside = 0, all = 0;
      for (let i = 0; i < n; i++) {
        const v = (on.data[top][i] - off.data[top][i]) ** 2, t = i / FS;
        all += v;
        if (marks.some((m) => m.span != null && t >= m.t && t <= m.t + m.span)) inside += v;
      }
      return inside / all;
    };
    return {
      marks, events, longestGap, episodes, inBoxes,
      unmarked: events.filter(([a, b]) => !marks.some((m) => covers(m, a, b))).length,
      // Arrows go on from 35% of the largest row (MARK_ROW_SHARE); a row moved by
      // half as much as the largest and never pointed at is a row left out.
      rowsLeftOut: chans.filter(({ c }, k) => moved[k] >= 0.5 * largest && !arrowed.has(c.label)).map(({ c }) => c.label),
    };
  };

  console.log('Events: each one has an arrow or a box, and every row it is plainly on has one:');
  const EVENTS: [string, PatientState, string[]][] = [
    ['blink', 'awake', ['eyes-open', 'blink']], ['eye-opening', 'awake', ['eye-opening']],
    ['eye-movement', 'awake', ['eye-movement']], ['chewing', 'awake', ['chewing']],
    ['rem-eyes', 'rem', ['rem-eyes']], ['roving-eyes', 'drowsy', ['roving-eyes']],
    ['posts', 'n1', ['posts']], ['v-waves', 'n1', ['v-waves']], ['k-complex', 'n2', ['k-complex']],
  ];
  for (const [toggle, state, patterns] of EVENTS) {
    const r = survey(state, patterns, toggle);
    check(`arrows: ${toggle} events on the page (the test has something to test)`, r.events.length, 2, 1e6);
    check(`arrows: ${toggle} events with no arrow or box`, r.unmarked, 0, 0);
    check(`arrows: ${toggle} rows moved by half its largest row or more and never pointed at`, r.rowsLeftOut.length, 0, 0);
    if (toggle === 'chewing') {
      // One box per episode on each side (3-5 chews, 1.5 a second): an episode is
      // chewing with no gap of 0.8 s. Every episode has at least three chews, so no
      // chew is left as an arrow of its own.
      check('boxes: chewing arrows on single chews (every episode is several chews)', r.marks.filter((m) => m.span == null).length, 0, 0);
      check('boxes: chewing boxes per episode and side (one each)',
        r.marks.filter((m) => m.span != null).length / 2 / Math.max(1, r.episodes(0.8).length), 0.9, 1.1);
    }
  }

  // Every toggle annotates what it draws. The owner, 2026-10-23: "everything should have
  // an intention, so annotations should be easy, whatever is present in the signals
  // should be by design." Each generator reports its own events (PatternMarkEvent) or
  // declares a box for as long as it is on (openBox); nothing is detected. Until then
  // 25 toggles — the benign variants, the IEDs, slowing, periodic patterns, burst-
  // suppression, photic, HV — drew on the page with no annotation, and no check
  // looked, because the arrow checks above only ever ran on toggles that had marks.
  // So this runs EVERY toggle as the app would switch it on (its state, what it
  // requires) and looks for events on every row: 2 mm of its contribution anywhere,
  // with no arrow or box over that moment, fails.
  console.log('\nEvery toggle annotates what it draws (owner, 2026-10-23: "whatever is present in the signals should be by design"):');
  {
    const silent: string[] = [];
    for (const id of PATTERN_CATEGORIES.flatMap((c) => c.patterns.map((p) => p.id))) {
      const page = toggle(initialToggles('awake'), id);
      const r = survey(page.patientState, [...page.active], id, undefined, true);
      if (!r.events.length) { silent.push(id); continue; }
      check(`by design: ${id} events on the page with no arrow or box`, r.unmarked, 0, 0);
    }
    // A toggle with nothing on the page in 40 s draws nothing of its own (Slow-Wave
    // Sleep, which sets the stage) or draws rarely; listed so a silent one is seen.
    console.log(`  no events in ${SECS} s (nothing to annotate): ${silent.join(', ') || 'none'}`);
  }

  // Common pages, every montage (2026-10-23 validation audit). Everything above reads
  // bipolar-ap, one toggle at a time, and the audit found what that misses: two bad
  // contacts boxed as one field cancelled on the row between them (T5-A1, seen only on
  // an ear reference), and the mains box ignored a bad contact's extra pickup (seen
  // only with both toggles on). So pages as the app composes them (setPage: a state's
  // defaults, what each toggle requires), each toggle's own contribution (that page
  // with it switched off, and whatever cannot stay on without it) through all six
  // montages: no moment it moves a row 2 mm without an arrow or a box over it, no mark
  // from a toggle that is off, and no row of a bad contact left unboxed.
  console.log('\nCommon pages, every montage: no event without an arrow or box:');
  {
    const PAGES: [PatientState, string[]][] = [
      ['awake', ['blink', 'eye-movement', 'muscle', 'ecg-artifact']],
      ['awake', ['eyes-open', 'blink', 'lambda', 'eye-movement']],
      ['awake', ['eye-opening', 'muscle']],
      ['awake', ['mu-rhythm', 'blink', 'muscle']],
      ['awake', ['chewing', 'muscle', 'movement']],
      ['awake', ['sweat', '50hz', 'bad-electrodes', 'electrode-pop']],
      ['awake', ['photic', 'blink']],
      ['awake', ['hyperventilation', 'absence-ictal']],
      ['awake', ['photic', 'polyspike-wave']],
      ['awake', ['focal-spikes-lt', 'focal-delta-temporal', 'blink', 'muscle']],
      ['awake', ['lpeds', 'focal-delta-temporal']],
      ['awake', ['gen-slowing', 'triphasic', 'firda']],
      ['awake', ['gpeds', 'gen-slowing']],
      ['awake', ['burst-suppression', 'ecg-artifact']],
      ['awake', ['gtc-ictal']],
      ['awake', ['focal-temporal-ictal', 'chewing']],
      ['awake', ['focal-frontal-ictal', 'muscle']],
      ['awake', ['hypsarrhythmia']],
      ['drowsy', ['roving-eyes', 'rmtd', 'wicket', 'midline-theta']],
      ['drowsy', ['6hz-sw', '14-6-pos', 'bets']],
      ['n1', ['posts', 'v-waves', 'roving-eyes']],
      ['n2', ['spindles', 'k-complex', 'v-waves', 'posts', 'bets']],
      ['n3', ['slow-waves', 'spindles', 'k-complex']],
      ['rem', ['rem-eyes', 'ecg-artifact']],
    ];
    type ElRun = { el: string[]; v: Float64Array[]; marks: (ArtifactMark & { t: number })[] };
    const runEl = (state: PatientState, on: Set<string>): ElRun => {
      const settings: SimSettings = {
        speed: 30, sensitivity: 7, patientState: state, activePatterns: on,
        ictalParams: defaultIctalParamsMap(), artifactParams: defaultArtifactParams(),
      };
      const src = new SimulationSource(SEED, FS);
      src.useAppMode();
      const n = SECS * FS;
      let el: string[] = [], v: Float64Array[] = [];
      const marks: ElRun['marks'] = [];
      for (let i = 0; i < n; i++) {
        const x = src.next(settings);
        if (i === 0) { el = Object.keys(x); v = el.map(() => new Float64Array(n)); }
        el.forEach((e, k) => { v[k][i] = x[e]; });
        for (const m of src.groundTruth.marks) {
          const t = i / FS - (m.ago ?? 0);
          const open = m.key != null ? marks.find((o) => o.key === m.key && o.span === Infinity) : undefined;
          if (open) open.span = t - open.t; else marks.push({ ...m, t });
        }
      }
      return { el, v, marks };
    };
    const rowsOf = (run: ElRun, montage: (typeof MONTAGES)[string]) => {
      const cs = montage.channels.map((c, i) => ({ c, i })).filter(({ c }) => c.active !== 'ECG');
      const n = run.v[0].length, data = cs.map(() => new Float64Array(n)), rec: Record<string, number> = {};
      for (let i = 0; i < n; i++) {
        run.el.forEach((e, k) => { rec[e] = run.v[k][i]; });
        const avg = commonAverage(rec);
        cs.forEach(({ c }, k) => { data[k][i] = computeChannelVoltage(c, i / FS, rec, avg); });
      }
      return { cs, data };
    };
    let unmarked = 0, leaked = 0, badRows = 0;
    const firsts: string[] = [];
    for (const [state, list] of PAGES) {
      const page = setPage(state, list), on = effective(page);
      const onRun = runEl(page.patientState, on);
      for (const id of on) {
        const offPage = effective(switchOff(page, id));
        const ids = [id, ...[...on].filter((x) => x !== id && !offPage.has(x))];
        const mine = (m: ArtifactMark) => ids.includes(m.id) || (ids.includes('eye-opening') && m.id === 'eye-closing');
        const offRun = runEl(page.patientState, offPage);
        leaked += offRun.marks.filter(mine).length;
        const marks = onRun.marks.filter(mine);
        for (const [mid, montage] of Object.entries(MONTAGES)) {
          const a = rowsOf(onRun, montage), b = rowsOf(offRun, montage), n = a.data[0].length;
          const ev: [number, number][] = [];
          let start = -1, last = -1;
          for (let i = 0; i < n; i++) {
            let hit = false;
            for (let k = 0; k < a.cs.length && !hit; k++) hit = Math.abs(a.data[k][i] - b.data[k][i]) >= 14;
            if (hit) { if (start < 0) start = i; last = i; }
            else if (start >= 0 && i - last > 0.4 * FS) { ev.push([start / FS, last / FS]); start = -1; }
          }
          if (start >= 0) ev.push([start / FS, last / FS]);
          const covered = (s: number, e: number) => marks.some((m) => (m.span != null
            ? m.t <= e + 0.15 && m.t + m.span >= s - 0.15 : m.t + m.dur >= s - 0.15 && m.t <= e + 0.15));
          const un = ev.filter(([s0, e0]) => !covered(s0, e0));
          unmarked += un.length;
          if (un.length && firsts.length < 5) firsts.push(`${id} on ${list.join('+')} (${state}), ${mid}, ${un[0][0].toFixed(2)} s`);
          // A bad contact's rows, and mains on them: boxed wherever they are plainly on.
          if (id === 'bad-electrodes' || id === '50hz') {
            const moved = a.cs.map((_, k) => { let x = 0; for (let i = 0; i < n; i++) x = Math.max(x, Math.abs(a.data[k][i] - b.data[k][i])); return x; });
            const largest = Math.max(...moved);
            const boxed = new Set(marks.filter((m) => m.id === id).flatMap((m) => (m.page ? a.cs.map(({ i }) => i)
              : markRows(markRowSizes(m.fields, montage), m.inUv ? 7 : undefined, m.span != null ? Infinity : undefined))));
            const left = a.cs.filter(({ i }, k) => moved[k] >= 0.5 * largest && moved[k] >= 14 && !boxed.has(i));
            badRows += left.length;
            if (left.length && firsts.length < 5) firsts.push(`${id} row ${left[0].c.label} unboxed, ${mid}`);
          }
        }
      }
    }
    if (firsts.length) console.log(`  first: ${firsts.join('; ')}`);
    check(`pages: events with no arrow or box (${PAGES.length} common pages x 6 montages)`, unmarked, 0, 0);
    check('pages: marks from a toggle while it is off', leaked, 0, 0);
    check('pages: rows of a bad contact, or mains on them, plainly on and not boxed (any montage)', badRows, 0, 0);
  }

  console.log('\nBoxes for events with extent (owner, 2026-10-22), arrows for single ones:');
  {
    // POSTS: singles more than 1 s apart stay arrows; with the trains form every
    // event is a train of 2-6 at 4-6 a second, and each is one box about a second long.
    const singles = survey('n1', ['posts'], 'posts');
    check('boxes: single POSTS given a box', singles.marks.filter((m) => m.span != null).length, 0, 0);
    const trains = survey('n1', ['posts'], 'posts', { postsForm: 'trains' });
    check('boxes: POSTS trains drawn as boxes', trains.marks.filter((m) => m.span != null).length, 2, 1e6);
    check('boxes: POSTS trains left as arrows', trains.marks.filter((m) => m.span == null).length, 0, 0);
    // The shortest train the source can draw is two elements at 6 a second (one
    // interval, at least 0.15 s with its 10% jitter) ending in the shortest element
    // (0.09 s): 0.24 s. The box is that train's own length since 2026-10-23, no
    // longer the stretch a threshold found, so the floor is 0.2; NPK's "about a
    // second (rarely > 2 s)" keeps the ceiling at 2.5.
    check('boxes: POSTS train boxes outside 0.2-2.5 s long',
      trains.marks.filter((m) => m.span != null && (m.span < 0.2 || m.span > 2.5)).length, 0, 0);
    // POSTS sides (owner, 2026-11-16): a one-sided POSTS is pointed at on its own side
    // only, and the smaller side of a bilateral one says so. A row's side is that of its
    // electrodes (odd numbers left, even right); a midline row has none.
    const rowSide = (r: string) => (r.split('-').every((e) => /[13579]$/.test(e)) ? 'L' : r.split('-').every((e) => /[02468]$/.test(e)) ? 'R' : '');
    const byEvent = (ms: Mark[]) => {
      const g = new Map<number, Mark[]>();
      for (const m of ms) { const k = Math.round(m.t * 100); g.set(k, [...(g.get(k) ?? []), m]); }
      return [...g.values()];
    };
    const allOne = byEvent(appRun('n1', ['posts'], { postsOneSidePct: 100 }, 120).marks.filter((m) => m.id === 'posts'));
    check('POSTS sides: one-sided events in 120 s (the test has something to test)', allOne.length, 8, 1e6);
    check('POSTS sides: one-sided events with other than one mark', allOne.filter((e) => e.length !== 1).length, 0, 0);
    check('POSTS sides: one-sided marks with arrows on both sides',
      allOne.filter((e) => new Set(e[0].rows.map(rowSide).filter(Boolean)).size !== 1).length, 0, 0);
    {
      const on = appRun('n1', ['posts'], undefined, 300), off = appRun('n1', [], undefined, 300);
      const row = (lab: string) => { const k = chans.findIndex(({ c }) => c.label === lab); return on.data[k].map((v, i) => v - off.data[k][i]); };
      const pl = row('P3-O1'), pr = row('P4-O2');
      const peak = (x: Float64Array, t: number) => { let m = 0; for (let i = Math.round(t * FS); i < Math.min(x.length, Math.round((t + 0.3) * FS)); i++) m = Math.max(m, Math.abs(x[i])); return m; };
      const bil = byEvent(on.marks.filter((m) => m.id === 'posts')).filter((e) => e.length === 2);
      check('POSTS sides: bilateral events in 300 s (the test has something to test)', bil.length, 15, 1e6);
      check('POSTS sides: bilateral events without exactly one "POSTS (smaller)" mark',
        bil.filter((e) => e.filter((m) => m.label === 'POSTS (smaller)').length !== 1).length, 0, 0);
      const right = bil.map((e) => {
        const sm = e.find((m) => m.label === 'POSTS (smaller)')!;
        const smL = sm.rows.some((r) => rowSide(r) === 'L');
        return (smL ? peak(pl, sm.t) < peak(pr, sm.t) : peak(pr, sm.t) < peak(pl, sm.t)) ? 1 : 0;
      });
      check('POSTS sides: "smaller" label on the side whose occipital link is lower', right.reduce((a: number, v) => a + v, 0) / right.length, 0.95, 1);
    }
    // Vertex waves: a run (waves joined by gaps under 1.2 s, 0.6 s or longer) gets a box, a single wave an arrow.
    const v = survey('n1', ['v-waves'], 'v-waves');
    const runs = v.episodes(1.2).filter(([a, b]) => b - a >= 0.6);
    const loneWaves = v.episodes(1.2).filter(([a, b]) => b - a < 0.6);
    check('boxes: vertex-wave runs with no box over them',
      runs.filter(([a, b]) => !v.marks.some((m) => m.span != null && m.t <= b && m.t + m.span >= a)).length, 0, 0);
    // Forty seconds may hold no run at all (seed 3 has none), which would let the two
    // checks around this pass on nothing; five minutes holds several.
    const vLong = appRun('n1', ['v-waves'], undefined, 300).marks.filter((m) => m.id === 'v-waves' && m.span != null);
    check('boxes: vertex-wave runs boxed in 300 s (a quarter of events are runs)', vLong.length, 2, 1e6);
    check('boxes: vertex-wave run boxes outside 0.6-2.6 s long (2-3 waves, 0.6-1.1 s apart)',
      vLong.filter((m) => m.span! < 0.6 || m.span! > 2.6).length, 0, 0);
    check('boxes: single vertex waves given a box',
      loneWaves.filter(([a, b]) => v.marks.some((m) => m.span != null && m.t <= b && m.t + m.span >= a)).length, 0, 0);
    // Spindles and K-complexes: always a box, holding the event — measured as the share
    // of its contribution on its largest row that falls inside the boxes.
    const sp = survey('n2', ['spindles'], 'spindles');
    check('boxes: spindle energy inside its boxes (largest row)', sp.inBoxes(), 0.9, 1);
    check('boxes: spindle boxes longer than 2.5 s', sp.marks.filter((m) => m.span != null && m.span > 2.5).length, 0, 0);
    const kc = survey('n2', ['k-complex'], 'k-complex');
    check('boxes: K-complex energy inside its boxes (largest row)', kc.inBoxes(), 0.9, 1);
    check('boxes: K-complexes left as arrows', kc.marks.filter((m) => m.span == null).length, 0, 0);
    const kcSp = survey('n2', ['k-complex'], 'k-complex', { kcSpindle: 'always' });
    check('boxes: K-complex energy inside its boxes, every one with a spindle (largest row)', kcSp.inBoxes(), 0.9, 1);
    // A tonic-clonic seizure reports its phases as it reaches them: tonic 10 s,
    // clonic 45 s, post-ictal suppression 35 s (sources/ictal.ts).
    const gtc = appRun('awake', ['gtc-ictal'], undefined, 70).marks.filter((m) => m.id === 'gtc-ictal' && m.span != null);
    check('boxes: tonic-clonic phases boxed, in order, at their lengths (tonic 10, clonic 45, suppression 35)',
      gtc.map((m) => `${m.label}:${m.span}`).join(',') === 'Tonic phase:10,Clonic phase:45,Post-ictal suppression:35' ? 1 : 0, 1, 1);
  }

  // A continuous artifact has no events, only a presence, so it is one box from the
  // moment it is on (owner, 2026-10-23). Until then it was an arrow every 1.5 s, and a
  // muscle burst or a drift between two arrows went unannotated (the every-toggle
  // check above found 1, 4 and 24 such stretches for muscle, sweat and bad electrodes).
  console.log('\nContinuous artifacts: one box for as long as they last, on the rows they are on:');
  const wholeRun = (r: ReturnType<typeof survey>) =>
    r.marks.filter((m) => m.span != null && m.t <= 0.05 && m.t + m.span >= SECS - 0.05).length;
  for (const toggle of ['muscle', 'sweat', 'bad-electrodes']) {
    const r = survey('awake', [toggle], toggle);
    check(`boxes: ${toggle} boxes over the whole run (one)`, wholeRun(r), 1, 1);
    check(`boxes: ${toggle} marks besides that box`, r.marks.length - 1, 0, 0);
    check(`arrows: ${toggle} rows moved by half its largest row or more and never pointed at`, r.rowsLeftOut.length, 0, 0);
  }

  console.log('\nECG under a millimetre on this montage, so on one row and not ten; mains on the two rows of its poor contact:');
  {
    const ecg = survey('awake', ['ecg-artifact'], 'ecg-artifact');
    check('arrows: ecg-artifact longest stretch with no arrow (one a beat)', ecg.longestGap, 0, 2, ' s');
    check('arrows: ecg-artifact most rows pointed at for one occurrence, bipolar-ap at 7 uV/mm',
      Math.max(...ecg.marks.map((m) => m.rows.length)), 1, 1);
    const mains = survey('awake', ['50hz'], '50hz');
    check('boxes: 50hz boxes over the whole run (one)', wholeRun(mains), 1, 1);
    check('boxes: 50hz rows boxed, bipolar-ap at 7 uV/mm (the two rows of its poor contact)', Math.max(...mains.marks.map((m) => m.rows.length)), 2, 2);
  }

  console.log('\nSpindles: each kind pointed at where it is, not both everywhere:');
  {
    const r = survey('n2', ['spindles'], 'spindles');
    const frontal = r.marks.filter((m) => m.rows.includes('Fp1-F3')).length;
    const posterior = r.marks.filter((m) => m.rows.includes('P3-O1')).length;
    check('arrows: spindles marked', r.marks.length, 2, 1e6);
    check('arrows: spindles pointed at on both the frontopolar and the parieto-occipital rows at once',
      r.marks.filter((m) => m.rows.includes('Fp1-F3') && m.rows.includes('P3-O1')).length, 0, 0);
    check('arrows: spindles marks that are on neither (every spindle is frontal or centroparietal)',
      r.marks.length - frontal - posterior, 0, 0);
  }
});

// The midline in sleep, as the app draws it with nothing switched on. The owner
// found a two-second, ~50 uV, 7 Hz burst on Fz-Cz in N1 with only POSTS on
// (2026-10-14): the background's frontal midline theta, a waking and drowsy rhythm
// (eegpedia, "Midline theta rhythm (Ciganek)"), carried into sleep by the diffuse
// sleep-theta gain and quadrupled there. Nothing caught it: the N1 midline check
// above reads RMS over minutes, where an occasional burst disappears. This reads
// it the way the eye does — does any one second stand out? With the diffuse sleep
// theta alone, the largest 1 s window of 5-8 Hz on Fz-Cz is 1.8-2.1 times the
// median one; with the burst it was 3.2-4.8 (seeds 3, 7, 11). The ceiling of 3
// separates the two and has no other source.
//
// Since 2026-10-23 the midline theta rhythm is not in the background at all: it is
// its own toggle (Midline Theta, sources/variants.ts), off unless chosen, because
// nothing should be on the page that no toggle owns (owner: "whatever is present in
// the signals should be by design"). So the waking states are read too.

section('\nThe midline (app, nothing switched on): no theta burst stands out:', () => {
  const fzcz = MONTAGES['bipolar-ap'].channels.find((c) => c.label === 'Fz-Cz')!;
  const thetaRms = (x: Float64Array) => {
    let p = 0;
    for (let f = 5; f <= 8; f += 0.5) {
      let re = 0, im = 0;
      for (let i = 0; i < x.length; i++) {
        re += x[i] * Math.cos(2 * Math.PI * f * i / FS);
        im += x[i] * Math.sin(2 * Math.PI * f * i / FS);
      }
      p += re * re + im * im;
    }
    return Math.sqrt(p);
  };
  for (const state of ['awake', 'drowsy', 'n1', 'n2'] as const) {
    let worst = 0;
    for (const seed of [3, 7, 11]) {
      const settings: SimSettings = {
        speed: 30, sensitivity: 7, patientState: state, activePatterns: new Set(),
        ictalParams: defaultIctalParamsMap(), artifactParams: defaultArtifactParams(),
      };
      const src = new SimulationSource(seed, FS);
      src.useAppMode();
      const n = 120 * FS, x = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const v = src.next(settings);
        x[i] = computeChannelVoltage(fzcz, 0, v, commonAverage(v));
      }
      const w: number[] = [];
      for (let k = 0; k + FS <= n; k += FS) w.push(thetaRms(x.subarray(k, k + FS)));
      w.sort((a, b) => a - b);
      worst = Math.max(worst, w[w.length - 1] / w[Math.floor(w.length / 2)]);
    }
    check(`${state}: largest 1 s of 5-8 Hz on Fz-Cz / the median second, worst of 3 subjects (a midline burst made it 3.2-4.8)`,
      worst, 1, 3);
  }
});

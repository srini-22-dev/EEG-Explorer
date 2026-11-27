import React, { useEffect, useRef, useState } from 'react';
import { Montage, isAux } from '../utils/montages';
import type { SimSettings } from '../utils/simTypes';
import { commonAverage, computeChannelVoltage } from '../utils/computeChannel';
import { markRowSizes, markRows, markRowSigns, markBlocks } from '../utils/markRows';
import { SimulationSource } from '../engine/adapter';
import type { ArtifactMark } from '../engine/engine';
import { PATTERN_BY_ID, PATTERN_CATEGORIES } from '../utils/patterns';
import { liveArtifacts, isLiveOn } from '../utils/liveArtifacts';
import type { LiveArtifacts } from '../engine/engine';
import { THEMES, EEGTheme } from '../utils/themes';
import { PATTERN_COLOR } from '../utils/annotations';
import { Pause, Play } from 'lucide-react';
import { buildLayout, GAP_UNITS } from './canvasLayout';
import { useCanvasPointer, drawMeasureTools } from './canvasPointer';
import {
  subscribe,
  getHighlightState,
  HighlightState,
  getChannelsUsingElectrode,
} from '../utils/highlightStore';
import {
  PX_PER_MM_X,
  MINOR_GRID_PX,
  pxPerMmFromHeight,
  pxPerUV as calcPxPerUV,
  ecgScale,
  traceY,
} from '../utils/displayGeometry';

/** The artifact toggles, in the panel's order, for the artifact list. */
const ARTIFACT_IDS = PATTERN_CATEGORIES.find(c => c.patterns.some(p => p.id === 'blink'))?.patterns.map(p => p.id) ?? [];

const MUSCLE_NAME: Record<string, string> = { temporalisL: 'temporalis L', temporalisR: 'temporalis R', frontalis: 'frontalis', nuchal: 'neck' };

/** What an artifact is doing now, in a few words, where that moves (empty otherwise). */
function liveDetail(id: string, live: LiveArtifacts | null, s: SimSettings): string {
  const p = s.artifactParams;
  const lv = live?.level ? live : null;
  switch (id) {
    case 'blink': return `${Math.round(lv ? lv.blinkRate : p.blinkRatePerMin)}/min`;
    case 'eye-movement': return `${Math.round(lv ? lv.saccadeRate : p.saccadeRatePerMin)}/min`;
    case 'muscle':
      if (lv && !lv.emgOn) return 'resting';
      return `${(lv?.emgRegions ?? p.emgRegions).map(r => MUSCLE_NAME[r] ?? r).join(', ')} ${(lv ? lv.emgSeverity : p.emgSeverity).toFixed(1)}×`;
    case 'movement': return lv ? (lv.movementActive ? `active, ${lv.movementRate.toFixed(1)}/min` : 'still') : `${p.movementRatePerMin.toFixed(1)}/min`;
    case 'ventilator': return live && live.tubingWater <= 0 ? 'tubing dry (suctioned)' : `${p.ventRatePerMin}/min`;
    case 'ecg-artifact': return `${Math.round(lv ? lv.heartRate : p.ecgBpm)} bpm`;
    case 'pulse': return `${p.pulseElectrode}, ${Math.round(lv ? lv.heartRate : p.ecgBpm)} bpm`;
    case 'respiration': return live ? `${Math.round(live.breathRate)}/min` : '';
    case 'sweat': return `${(lv ? lv.sweatSeverity : p.sweatSeverity).toFixed(1)}×`;
    case 'electrode-pop': return `${(lv ? lv.popRate : p.popRatePerMin).toFixed(1)}/min`;
    case 'iv-drip': return `${p.dripRatePerMin}/min`;
    case '50hz': return `${p.lineFreq} Hz${s.filters?.notchHz === p.lineFreq ? ', notched' : ''}`;
    default: return '';
  }
}

/** Seconds as m:ss. */
const fmtBack = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

type EEGCanvasProps = {
  montage: Montage;
  settings: SimSettings;
  theme: EEGTheme;
  showAnnotations: boolean;
  /** The list of artifacts at the top right, each marked on now or resting (separate from the trace's arrows). */
  showArtifactList: boolean;
  /** The background-state name at the top right. Off in the quiz, where it gives the answer away. */
  showStateLabel: boolean;
  isFrozen: boolean;
  setIsFrozen: (b: boolean) => void;
  dataBuffer: React.MutableRefObject<number[][]>;
  timeBuffer: React.MutableRefObject<number[]>;
  // When false, hovering the traces no longer highlights a channel. The 3D
  // brain electrode hover is independent and unaffected — hovering an electrode
  // still cross-highlights its channels here, because that comes through
  // hoveredElectrodes, not this canvas's own mouse-move.
  graphHover?: boolean;
  /**
   * The quiz's page (owner's inbox, 2026-11-27: "each page should be refreshed because
   * most of the page is from the previous questions"). A new key starts blank paper: only
   * what is recorded from then on is drawn, and `onPageFull` fires once when it reaches
   * the left edge. Undefined outside the quiz, where the whole history is drawn.
   */
  freshPageKey?: number;
  /** A fresh page has started; it fills in this many seconds at this width and speed. */
  onFreshPage?: (pageSec: number) => void;
  onPageFull?: () => void;
  /**
   * The pattern the fresh page is for. The page is full only once one of its events lies
   * inside the middle 80% of the page, clear of both edges (owner's inbox, 2026-11-27:
   * "dont put it in the corners (have a 10% margin)"); after three pages it is full anyway.
   */
  pageInterest?: string;
};

/**
 * Seconds of signal kept behind the sweep.
 *
 * The buffers used to be trimmed to whatever was currently on screen, which made
 * the retained history a function of canvas width and paper speed. Widening the
 * window, dropping to 15 mm/s, or opening the 3D panel then asked for samples
 * that had already been thrown away, and the trace restarted from the right-hand
 * edge on blank paper. Storage is now decoupled from display: this is a floor,
 * and the eviction below also never discards anything still visible, so the
 * behaviour holds on any canvas at any speed.
 */
// Five minutes, so a paused record can be paged back through (owner's inbox,
// 2026-11-25: "add a few minutes of memory ... to scroll back in time"). At 250 Hz
// that is 75,000 samples a channel, a few megabytes in all.
const HISTORY_SEC = 300;

/**
 * Samples of expired history tolerated before compacting the buffers.
 *
 * splice(0, n) costs O(buffer length) however small n is, so trimming every
 * frame would rewrite a 15,000-sample buffer 60 times a second per channel.
 * Draining a second at a time pays that cost once a second instead.
 */
const EVICT_CHUNK = 250;

/** Seconds from a disconnect to its electrode going flat: the pop rings out first (ArtifactLayer.setParams). */
const DETACH_FLAT_AFTER_S = 0.8;

/** Index of the first element >= value in a sorted array. */

function lowerBound(arr: number[], value: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export function EEGCanvas({
  montage, settings,
  theme, showAnnotations, showArtifactList, showStateLabel, isFrozen, setIsFrozen,
  dataBuffer, timeBuffer, graphHover = true, freshPageKey, onFreshPage, onPageFull, pageInterest,
}: EEGCanvasProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastTimeRef  = useRef<number>(performance.now());
  const elapsedRef   = useRef<number>(0);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const themeRef = useRef(THEMES[theme]);
  themeRef.current = THEMES[theme];
  const annotationsRef = useRef(showAnnotations);
  annotationsRef.current = showAnnotations;
  const artifactListRef = useRef(showArtifactList);
  artifactListRef.current = showArtifactList;
  const stateLabelRef = useRef(showStateLabel);
  stateLabelRef.current = showStateLabel;
  const frozenRef = useRef(isFrozen);
  frozenRef.current = isFrozen;
  // The fresh page's start (sample time), -Infinity for the whole history; and whether
  // its fill has been reported.
  const pageStartRef = useRef(-Infinity);
  const pageFullSentRef = useRef(true);
  const onPageFullRef = useRef(onPageFull);
  onPageFullRef.current = onPageFull;
  const pageInterestRef = useRef(pageInterest);
  pageInterestRef.current = pageInterest;

  // When each electrode was disconnected and reattached, sample times. A disconnected
  // electrode's rows draw no signal from the moment its pop has rung out (the engine's
  // 0.8 s, ArtifactLayer.setParams) until it is reattached (owner's inbox, 2026-11-27:
  // "it should have no signal till it is reconnected"). In a bipolar row the engine's flat
  // electrode left the neighbour's activity on the row, so a disconnect looked like nothing.
  const detachSpansRef = useRef(new Map<string, { from: number; to: number }[]>());
  const detachedNow = settings.artifactParams.detachedElectrodes;
  useEffect(() => {
    const spans = detachSpansRef.current;
    const now = elapsedRef.current;
    for (const e of detachedNow) {
      const list = spans.get(e) ?? [];
      if (!list.length || list[list.length - 1].to !== Infinity) list.push({ from: now + DETACH_FLAT_AFTER_S, to: Infinity });
      spans.set(e, list);
    }
    for (const [e, list] of spans) {
      const last = list[list.length - 1];
      if (last && last.to === Infinity && !detachedNow.includes(e)) last.to = now;
    }
  }, [detachedNow]);
  useEffect(() => {
    if (freshPageKey == null) { pageStartRef.current = -Infinity; pageFullSentRef.current = true; return; }
    pageStartRef.current = elapsedRef.current;
    pageFullSentRef.current = false;
    const canvas = canvasRef.current;
    onFreshPage?.(canvas ? canvas.width / (settingsRef.current.speed * PX_PER_MM_X) : 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshPageKey]);

  // Scroll-back while paused: how far the page's right edge sits behind the newest
  // sample, seconds. The render loop reads the ref; the slider shows the state.
  const backRef = useRef(0);
  const [back, setBack] = useState(0);
  const [backMax, setBackMax] = useState(0);
  // How far back the retained history reaches, and one page, at this width and speed.
  const historyGeometry = () => {
    const tb = timeBuffer.current;
    const canvas = canvasRef.current;
    const page = canvas ? canvas.width / (settingsRef.current.speed * PX_PER_MM_X) : 10;
    // No history on a fresh page (the quiz): only its own page is there to read (owner's
    // inbox, 2026-11-27: "no history in the quiz"). The regular app keeps its five minutes.
    if (pageStartRef.current > -Infinity) return { page, max: 0 };
    const span = tb.length > 1 ? tb[tb.length - 1] - tb[0] : 0;
    return { page, max: Math.max(0, span - page) };
  };
  const scrollBack = (sec: number) => {
    const { max } = historyGeometry();
    const v = Math.min(max, Math.max(0, sec));
    backRef.current = v;
    setBack(v);
    setBackMax(max);
  };
  // Resuming returns to the newest sample; pausing measures what there is to page through.
  useEffect(() => {
    if (!isFrozen) { backRef.current = 0; setBack(0); }
    else setBackMax(historyGeometry().max);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFrozen]);
  // Paging while paused: the arrow and Page keys a page at a time (as a review station
  // pages), Home to the oldest, End to the newest; the wheel over the trace a second a notch.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!frozenRef.current) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const { page, max } = historyGeometry();
      const to = e.key === 'ArrowLeft' || e.key === 'PageUp' ? backRef.current + page
        : e.key === 'ArrowRight' || e.key === 'PageDown' ? backRef.current - page
        : e.key === 'Home' ? max : e.key === 'End' ? 0 : null;
      if (to == null) return;
      e.preventDefault();
      scrollBack(to);
    };
    window.addEventListener('keydown', onKey);
    const canvas = canvasRef.current;
    const onWheel = (e: WheelEvent) => {
      if (!frozenRef.current) return;
      e.preventDefault();
      scrollBack(backRef.current + Math.sign(e.deltaY) * 1);
    };
    canvas?.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKey);
      canvas?.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Highlight store state, mirrored into a ref (not React state) so the rAF
  // render loop can read it every frame without triggering re-renders.
  const highlightRef = useRef<HighlightState>(getHighlightState());
  useEffect(() => {
    return subscribe(() => { highlightRef.current = getHighlightState(); });
  }, []);

  // Hover, highlight, the caliper, the measuring box and the keyboard (canvasPointer.ts).
  const pointer = useCanvasPointer({
    canvasRef, montage, settingsRef, frozenRef, elapsedRef, isFrozen, setIsFrozen, graphHover,
  });

  // The engine and each sample's raw electrode voltages outlive a montage change.
  // A montage only chooses which differences of the same electrodes to draw, so
  // switching it re-derives every row from the retained frames: the page redraws
  // the same stretch of EEG in the new montage — as re-montaging a recorded page
  // does on a real reader — instead of blanking and restarting a new subject.
  const simRef = useRef<SimulationSource | null>(null);
  if (!simRef.current) { simRef.current = new SimulationSource(); simRef.current.useAppMode(); }
  const rawFrames = useRef<Record<string, number>[]>([]);
  // Artifact onsets reported by the engine, stamped with their sample time, for
  // the annotation arrows. Times, not rows, so they survive a montage change.
  const marksRef = useRef<(ArtifactMark & { t: number })[]>([]);
  // For an artifact's fields and a montage: its size on each channel, and which
  // way it moves each one.
  const markRowsRef = useRef(new WeakMap<object, Map<Montage, { sizes: number[]; signs: number[] }>>());
  // Arrows and boxes drawn on the last frame, per 1000 px of trace, which sizes
  // this frame's tags (see markScale in the render loop).
  const markDensityRef = useRef(0);

  useEffect(() => {
    const frames = rawFrames.current;
    if (frames.length !== timeBuffer.current.length) {
      // Buffers out of step (nothing recorded yet): start clean.
      rawFrames.current = [];
      timeBuffer.current = [];
      marksRef.current = [];
      dataBuffer.current = montage.channels.map(() => []);
    } else {
      const avg = frames.map(commonAverage);
      dataBuffer.current = montage.channels.map(ch =>
        frames.map((f, k) => computeChannelVoltage(ch, timeBuffer.current[k], f, avg[k])));
    }
  }, [montage]);

  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let rafId: number;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Observe the container, not the window. The 3D panel's splitter changes this
    // element's width without the window changing size at all, so a window-only
    // listener left the backing store stale and the canvas CSS-stretched — which
    // silently falsifies the mm/s and µV/mm calibration the display is built on.
    // The equality guard matters: assigning canvas.width clears the canvas even
    // when the value is unchanged, and a ResizeObserver fires on layout passes
    // that did not actually change the size.
    const resize = () => {
      const cw = Math.max(1, Math.round(container.clientWidth));
      const chh = Math.max(1, Math.round(container.clientHeight));
      if (canvas.width === cw && canvas.height === chh) return;
      canvas.width  = cw;
      canvas.height = chh;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const layout = buildLayout(montage);
    // Row units are fixed by the montage, so the total is summed once here rather
    // than re-filtering the layout array on every frame.
    const totalRowUnits = layout.reduce((s, r) => s + (r.channelIndex < 0 ? GAP_UNITS : 1), 0);
    const simSource = simRef.current!;

    const render = (now: number) => {
      const currentSettings = settingsRef.current;
      const currentTheme = themeRef.current;

      const dtMs = now - lastTimeRef.current;
      lastTimeRef.current = now;
      
      // Only advance time if not frozen
      if (!frozenRef.current) {
        const dt = Math.min(dtMs / 1000, 0.1);
        elapsedRef.current += dt;
      }
      const currentT = elapsedRef.current;

      const pxPerSec  = currentSettings.speed * PX_PER_MM_X;
      const winSec    = canvas.width / pxPerSec;
      // Nothing before a fresh page's start is drawn (freshPageKey).
      const tMin = pageStartRef.current;
      if (!pageFullSentRef.current && currentT - tMin >= winSec) {
        // One of the pattern's events clear of both edges: a tenth of the page each side.
        const id = pageInterestRef.current;
        const lo = currentT - 0.9 * winSec, hi = currentT - 0.1 * winSec;
        const tEnd = timeBuffer.current.length ? timeBuffer.current[timeBuffer.current.length - 1] : currentT;
        const clear = !id || marksRef.current.some(m => {
          if (m.t < tMin || (m.id !== id && !(id === 'eye-opening' && m.id === 'eye-closing'))) return false;
          if (m.page) return true;
          if (m.span == null) return m.t >= lo && m.t + m.dur <= hi && m.t + m.dur <= tEnd;
          // A box: within the margins, or, for one still open or longer than the
          // page's middle, covering it.
          const end = Number.isFinite(m.span) ? m.t + m.span : Infinity;
          return (m.t >= lo && end <= hi) || (m.t <= lo && end >= hi);
        });
        if (clear || currentT - tMin >= 3 * winSec) {
          pageFullSentRef.current = true;
          onPageFullRef.current?.();
        }
      }

      // ── Fill sample buffer at 250 Hz (only if not frozen) ──
      if (!frozenRef.current) {
        const dtS  = 1 / 250;
        let lastT  = timeBuffer.current.length > 0
          ? timeBuffer.current[timeBuffer.current.length - 1]
          : currentT - dtS;

        while (lastT < currentT) {
          lastT += dtS;
          // The engine is a stateful stream, so it must be advanced exactly once
          // per sample and in order — it cannot be evaluated at an arbitrary t.
          const allV = simSource.next(currentSettings);
          const avgRef = commonAverage(allV);
          timeBuffer.current.push(lastT);
          for (const m of simSource.groundTruth.marks) {
            const t = lastT - (m.ago ?? 0);
            // A pattern that has stopped closes the box it opened (ArtifactMark.key).
            const open = m.key != null ? marksRef.current.find(o => o.key === m.key && o.span === Infinity) : undefined;
            if (open) open.span = t - open.t;
            else marksRef.current.push({ ...m, t });
          }
          // `next()` reuses its return object, so keep a copy.
          rawFrames.current.push({ ...allV });
          liveArtifacts.current = simSource.groundTruth.live;
          for (let i = 0; i < montage.channels.length; i++) {
            if (!dataBuffer.current[i]) dataBuffer.current[i] = [];
            dataBuffer.current[i].push(computeChannelVoltage(montage.channels[i], lastT, allV, avgRef));
          }
        }

        // Drop only what has aged out of the retention span — not what has merely
        // scrolled off the canvas. `winSec` is in the max so a window wider than
        // HISTORY_SEC (a 4K display at 15 mm/s) can never evict a sample it is
        // still drawing. Carrying the surplus costs nothing to render: the draw
        // loop binary-searches to the left edge rather than scanning past it.
        const cutoff = currentT - Math.max(HISTORY_SEC, winSec);
        const tb = timeBuffer.current;
        let evict = 0;
        while (evict < tb.length - 2 && tb[evict] < cutoff) evict++;
        if (evict >= EVICT_CHUNK) {
          tb.splice(0, evict);
          rawFrames.current.splice(0, evict);
          for (let i = 0; i < montage.channels.length; i++) dataBuffer.current[i]?.splice(0, evict);
          // A mark goes once all of it has aged out: a box is kept while its end is
          // still in the buffer, and an open one (span Infinity) until it closes.
          const marks = marksRef.current;
          let kept = 0;
          for (const m of marks) if (m.t + (m.span ?? m.dur) >= tb[0]) marks[kept++] = m;
          marks.length = kept;
        }
      }

      // ── RENDER ──────────────────────────────────────────────────────────────
      // The page's right edge: the newest sample, or earlier while paging back.
      const tRight = currentT - backRef.current;
      const w = canvas.width;
      const h = canvas.height;

      // Width of the fixed channel-label strip on the left. Declared here rather
      // than at its first draw (section 6) because the annotation overlay in
      // section 5b also anchors to it.
      const lblW = 66;
      // Patterns acting on the whole page (ArtifactMark.page: eyes open) are named in
      // the top-right corner while they last, not boxed (owner, 2026-11-16: a box
      // over every chain hid the very background change it was there to show).
      const pageLabels: { text: string; color: string }[] = [];

      // 1. Base paper
      ctx.fillStyle = currentTheme.bgEven;
      ctx.fillRect(0, 0, w, h);

      // 2. Alternating 1-second tinted bands (even seconds slightly darker)
      {
        const rightT = tRight;
        const leftT  = rightT - winSec;
        for (let s = Math.floor(leftT); s <= Math.ceil(rightT); s++) {
          if (s % 2 !== 0) continue;
          const x0 = w - (rightT - s)       * pxPerSec;
          const x1 = w - (rightT - (s + 1)) * pxPerSec;
          ctx.fillStyle = currentTheme.bgOdd;
          ctx.fillRect(x0, 0, x1 - x0, h);
        }
      }

      // 3. Amplitude grid (px per mm vertical)
      const pxPerMm = pxPerMmFromHeight(h, totalRowUnits);

      // Grid lines are batched by style — one path for the 1 mm lines and one for
      // the 5 mm lines — instead of a beginPath/stroke pair per line. At this
      // canvas size that turns ~260 path submissions a frame into 4. stroke()
      // carries fixed per-call overhead that dwarfs a two-point path, and the
      // output is identical: the two sets never share a y, so drawing all of one
      // before the other cannot change which line lands on top.
      const step5 = Math.max(1, Math.round(pxPerMm * 5));
      const is5mm = (y: number) => Math.abs(Math.round(y) % step5) < 1;

      ctx.beginPath();
      for (let y = 0; y < h; y += pxPerMm) if (!is5mm(y)) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.strokeStyle = currentTheme.gridH1mm;
      ctx.lineWidth   = 0.3;
      ctx.stroke();

      ctx.beginPath();
      for (let y = 0; y < h; y += pxPerMm) if (is5mm(y)) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.strokeStyle = currentTheme.gridH5mm;
      ctx.lineWidth   = 0.55;
      ctx.stroke();

      // 4. Vertical time grid: minor 5 mm (fixed paper interval), major 1 s.
      //
      // Real ruled EEG paper is printed with a fixed physical grid — 5 mm
      // minor squares — and the TIME each square represents changes with
      // paper speed, not the reverse. This used to rule minor lines every
      // 200 ms of elapsed time regardless of speed, which gave the correct
      // physical spacing only at 25 mm/s and was wrong everywhere else (6.0
      // mm at 30 mm/s, 2.0 mm at 10 mm/s). `pxOff` below is already a plain
      // pixel offset (how far the sweep has travelled past the last whole
      // second), so switching `minorW` from a time-derived quantity to a
      // fixed physical one needs no other change to the scroll math.
      {
        const secW   = pxPerSec;
        const minorW = MINOR_GRID_PX;
        const pxOff  = (tRight % 1) * secW;
        const isMajor = (x: number) => Math.abs((w - x + pxOff) % secW) < 1.8;

        ctx.beginPath();
        for (let x = w - (pxOff % minorW); x > 0; x -= minorW) if (!isMajor(x)) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
        ctx.strokeStyle = currentTheme.grid200;
        ctx.lineWidth   = 0.35;
        ctx.stroke();

        ctx.beginPath();
        for (let x = w - (pxOff % minorW); x > 0; x -= minorW) if (isMajor(x)) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
        ctx.strokeStyle = currentTheme.grid1s;
        ctx.lineWidth   = 0.7;
        ctx.stroke();
      }

      // 5. Waveform traces
      const pxPerUV = calcPxPerUV(pxPerMm, currentSettings.sensitivity);

      // Index of the leftmost sample still on screen. The buffers now hold up to
      // HISTORY_SEC of signal but only winSec of it is visible, so starting every
      // channel at 0 and discarding the misses would walk several times more
      // samples than it draws. Sample times are monotonic, so one binary search
      // finds the left edge and all channels share it.
      const firstVisible = lowerBound(timeBuffer.current, Math.max(tRight - winSec, tMin));

      // Cross-highlight: a channel is highlighted if it's directly hovered/clicked
      // (from the canvas side) or if either of its electrodes is highlighted from
      // the 3D head side.
      const hl = highlightRef.current;
      const highlightedChannels = new Set<number>(hl.hoveredChannels);
      hl.clickedChannels.forEach(c => highlightedChannels.add(c));
      const highlightedElectrodes = new Set<string>(hl.hoveredElectrodes);
      hl.clickedElectrodes.forEach(e => highlightedElectrodes.add(e));
      highlightedElectrodes.forEach(el => {
        getChannelsUsingElectrode(el, montage).forEach(idx => highlightedChannels.add(idx));
      });
      const anyHighlight = highlightedChannels.size > 0;

      // A detached electrode's rows are shaded while it is off, and draw no signal
      // from its pop's end until it is reattached (detachSpansRef above).
      const detached = currentSettings.artifactParams.detachedElectrodes;
      const detachedSet = detached.length ? new Set(detached) : null;
      const rowDetached = (ch: Montage['channels'][number]) =>
        !!detachedSet && (detachedSet.has(ch.active) || (!!ch.reference && detachedSet.has(ch.reference)));

      for (const row of layout) {
        if (row.channelIndex < 0) continue;
        const i       = row.channelIndex;
        const ch      = montage.channels[i];
        const data    = dataBuffer.current[i] ?? [];
        const centerY = row.centerFrac * h;
        // ECG and Resp: recorded channels in display units, not microvolts (isAux).
        const isECG   = isAux(ch);
        const isHighlighted = highlightedChannels.has(i);
        const dimmed  = anyHighlight && !isHighlighted;

        // ECG is a limb lead, not a scalp derivation — negative-up does not
        // apply to it, so its scale is negated relative to the EEG rows
        // (see ecgScale's doc comment: this is what puts the R wave up).
        const scale = isECG ? ecgScale(pxPerMm) : pxPerUV;

        if (rowDetached(ch)) {
          ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
          ctx.fillRect(0, (row.centerFrac - row.rowFrac / 2) * h, w, row.rowFrac * h);
        }

        ctx.save();
        if (dimmed) ctx.globalAlpha = 0.4;

        ctx.beginPath();
        ctx.strokeStyle = currentTheme.baselineColor;
        ctx.lineWidth = 0.4;
        ctx.moveTo(0, centerY); ctx.lineTo(w, centerY);
        ctx.stroke();

        ctx.beginPath();
        ctx.strokeStyle = currentTheme.traceColors[ch.group];
        ctx.lineWidth   = isHighlighted ? 2.2 : (isECG ? 1.1 : 0.9);
        let started = false;
        // Spans while one of this row's electrodes was disconnected: no signal there.
        const off = [
          ...(detachSpansRef.current.get(ch.active) ?? []),
          ...(ch.reference ? detachSpansRef.current.get(ch.reference) ?? [] : []),
        ];

        for (let j = firstVisible; j < data.length; j++) {
          const tj = timeBuffer.current[j];
          const tDist = tRight - tj;
          const x = w - tDist * pxPerSec;
          const v = off.length && off.some(o => tj >= o.from && tj < o.to) ? 0 : data[j];
          // Real EEG paper and clinical review systems never clip: a
          // high-amplitude event is drawn at its true height and simply
          // overruns into neighbouring channels, which is how reviewers judge
          // amplitude at a glance. Only guard against non-finite values —
          // that protects canvas rendering, it does not limit amplitude.
          if (!Number.isFinite(v)) continue;
          // Clinical EEG is drawn NEGATIVE-UP: a channel whose active input is
          // more positive than its reference deflects DOWNWARD. That is the
          // convention every reader is trained on and the reason a blink — which
          // drives Fp1/Fp2 positive via Bell's phenomenon — reads as a downward
          // frontopolar deflection (IK-001).
          //
          // Canvas y grows downward, so negative-up is `centerY + v * scale`,
          // not `centerY - v * scale` — that is what `traceY` (shared with
          // renderTrace.ts via displayGeometry.ts) encodes. This previously
          // read `centerY - v`, which inverted every trace in the app. It
          // looked right only for the patterns whose morphology had been
          // written pre-inverted to compensate; the ones stated in true scalp
          // polarity (V-waves, K-complexes, POSTS, lambda, triphasics, blink)
          // all rendered upside down. Fixing the convention here is what lets
          // every generator speak plain physiological sign. The ECG row is the
          // one exception to negative-up (see `scale` above / `ecgScale`).
          const y = traceY(centerY, v, scale);
          if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
        }
        ctx.stroke();
        ctx.restore();
      }

      // 5b. Annotations: the per-event marks. (A top-left legend of one sentence per
      // active pattern used to sit here; the owner removed it, 2026-11-26, since the
      // info panel carries those explanations.)
      if (annotationsRef.current) {
        // Arrows. Every artifact and sleep graphoelement the engine reports
        // (ArtifactMark) gets one on each row it is large on in this montage, at
        // the moment of its largest excursion on that row. They are anchored to a
        // sample time, so they scroll with the waves they point at.
        const tb = timeBuffer.current;
        const tEnd = tb.length ? tb[tb.length - 1] : -Infinity;
        // Tag size scales with how crowded the page is, never with which rows are
        // marked (owner, 2026-11-26: "clear where ever the artifact is ... make the
        // annotations smaller if there are too many"). Density is last frame's
        // arrows + boxes per 1000 px of trace: up to MARKS_FULL_SIZE they are full
        // size (10 px text); beyond it they shrink as sqrt(MARKS_FULL_SIZE / density),
        // so tag area falls in proportion, down to 0.6x (arrows) with text held at 8 px.
        const MARKS_FULL_SIZE = 25;
        const k = Math.min(1, Math.max(0.6, Math.sqrt(MARKS_FULL_SIZE / Math.max(1, markDensityRef.current))));
        const fontPx = Math.max(8, 10 * k);
        const tagH = fontPx + 4, padX = 4 * k;
        let drawnMarks = 0;
        ctx.font = `${fontPx}px sans-serif`;
        ctx.textAlign = 'center';
        const rowOfChannel = new Map(layout.filter(r => r.channelIndex >= 0).map(r => [r.channelIndex, r]));
        // Every arrow carries its artifact's name (the owner, 2026-10-14: "all arrows
        // should be annotated"; it was one name per artifact every 2.5 s). A name is
        // left off only where the same name already covers that spot.
        const drawnLabels: { x0: number; y0: number; x1: number; y1: number; text: string; block: number }[] = [];
        // Arrows keep a name each only once per chain block every LABEL_EVERY_S seconds
        // (owner's inbox, 2026-11-27: "annotations can be a little obstrusive"). With every
        // arrow named, a Worst case page carried a name on each row an eye movement or ECG
        // beat reached, beat after beat, and the trace went under its tags. Every arrow is
        // still drawn, so where an artifact is stays marked.
        const LABEL_EVERY_S = 2;
        const blockOf = new Map<number, number>();
        { let b = 0; for (const r of layout) { if (r.channelIndex < 0) b++; else blockOf.set(r.channelIndex, b); } }
        for (const m of marksRef.current) {
          if (m.span == null && m.t + m.dur > tEnd) continue; // still developing: its peak is not drawn yet
          if (m.t + (m.span ?? 0) < tRight - winSec) continue; // scrolled off
          if (m.t < tMin) continue; // before a fresh page (freshPageKey)
          if (m.page) {
            // Named while it lasts at the page's right edge, the moment being drawn.
            const pid = m.id === 'eye-closing' ? 'eye-opening' : m.id;
            const text = m.label ?? PATTERN_BY_ID[pid]?.name ?? pid;
            if (m.span != null && m.t + m.span >= tEnd && !pageLabels.some(l => l.text === text)) {
              pageLabels.push({ text, color: PATTERN_COLOR[pid] ?? currentTheme.overlayText });
            }
            continue;
          }
          // The rows this artifact is on, in this montage: every row within reach of
          // the largest gets an arrow — a blink is on all four frontopolar rows.
          let byMontage = markRowsRef.current.get(m.fields);
          if (!byMontage) { byMontage = new Map(); markRowsRef.current.set(m.fields, byMontage); }
          let rowInfo = byMontage.get(montage);
          if (!rowInfo) {
            rowInfo = { sizes: markRowSizes(m.fields, montage), signs: markRowSigns(m.fields, montage) };
            byMontage.set(montage, rowInfo);
          }
          const channels = markRows(rowInfo.sizes, m.inUv ? currentSettings.sensitivity : undefined, m.span != null ? Infinity : undefined);
          const j0 = lowerBound(tb, m.t);
          const pid = m.id === 'eye-closing' ? 'eye-opening' : m.id;
          const color = PATTERN_COLOR[pid] ?? currentTheme.overlayText;
          const text = m.label ?? PATTERN_BY_ID[pid]?.name ?? pid;
          const label = (x: number, ty: number, block = -1) => {
            const textW = ctx.measureText(text).width;
            // Never under the channel-label strip or past the right edge: a tag near the
            // page's left edge was cut ("ent Artifact", 2026-11-27).
            x = Math.min(w - textW / 2 - padX - 2, Math.max(lblW + textW / 2 + padX + 2, x));
            const box = { x0: x - textW / 2 - padX, y0: ty - tagH / 2, x1: x + textW / 2 + padX, y1: ty + tagH / 2, text, block };
            if (drawnLabels.some(b => b.text === text && b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) return;
            if (block >= 0 && drawnLabels.some(b => b.text === text && b.block === block
              && Math.abs((b.x0 + b.x1) / 2 - x) < LABEL_EVERY_S * pxPerSec)) return;
            drawnLabels.push(box);
            ctx.fillStyle = currentTheme.overlayBg;
            ctx.fillRect(box.x0, box.y0, textW + 2 * padX, tagH);
            ctx.fillStyle = currentTheme.overlayText;
            ctx.textBaseline = 'middle';
            ctx.fillText(text, x, ty);
          };
          if (m.span != null) {
            // An event with extent: a box from its start to its end (or to now, for a
            // seizure's phase still running) around each chain block it is on.
            const xa = Math.max(lblW, w - (tRight - m.t) * pxPerSec);
            const xb = Math.min(w, w - (tRight - Math.min(m.t + m.span, tEnd)) * pxPerSec);
            if (xb - xa < 2) continue;
            for (const block of markBlocks(channels, montage)) {
              const first = rowOfChannel.get(block[0]);
              const last = rowOfChannel.get(block[block.length - 1]);
              if (!first || !last) continue;
              const y0 = (first.centerFrac - first.rowFrac / 2) * h + 2;
              const y1 = (last.centerFrac + last.rowFrac / 2) * h - 2;
              ctx.save();
              ctx.globalAlpha = 0.08;
              ctx.fillStyle = color;
              ctx.fillRect(xa, y0, xb - xa, y1 - y0);
              ctx.restore();
              ctx.strokeStyle = color;
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.roundRect(xa, y0, xb - xa, y1 - y0, 5);
              ctx.stroke();
              const textW = ctx.measureText(text).width;
              drawnMarks++;
              label(Math.min(xa + 6 + textW / 2, xb - textW / 2 - padX), y0 + tagH / 2 + 2, blockOf.get(block[0]) ?? -1);
            }
            continue;
          }
          // Which swing each arrow points at. A one-source artifact moves every row the
          // way its field says, so the rows vote on which way this event went and each
          // arrow then goes to its row's largest swing in that direction. Each row used
          // to take its own largest swing either way, and a POSTS whose small negative
          // after-wave happened to be larger on one row got its arrow there, from below,
          // while the rest pointed at the peak.
          const picks: { row: (typeof layout)[number]; data: number[]; j1: number; sign: number }[] = [];
          let vote = 0;
          for (const c of channels) {
            const row = rowOfChannel.get(c);
            if (!row) continue;
            const data = dataBuffer.current[row.channelIndex] ?? [];
            if (j0 >= data.length) continue;
            const j1 = Math.min(data.length - 1, lowerBound(tb, m.t + m.dur));
            let jp = j0;
            for (let j = j0 + 1; j <= j1; j++) {
              if (Math.abs(data[j] - data[j0]) > Math.abs(data[jp] - data[j0])) jp = j;
            }
            vote += rowInfo.signs[c] * (data[jp] - data[j0]);
            picks.push({ row, data, j1, sign: rowInfo.signs[c] });
          }
          const polarity = Math.sign(vote);
          for (const { row, data, j1, sign } of picks) {
            const want = sign * polarity; // +1 the largest rise in uV, -1 the largest fall, 0 either
            let jp = j0;
            for (let j = j0 + 1; j <= j1; j++) {
              const d = data[j] - data[j0], best = data[jp] - data[j0];
              if (want === 0 ? Math.abs(d) > Math.abs(best) : want * d > want * best) jp = j;
            }
            const x = w - (tRight - tb[jp]) * pxPerSec;
            if (x < lblW + 6 || x > w - 4) continue;
            const centerY = row.centerFrac * h;
            const y = traceY(centerY, data[jp], pxPerUV);
            // Come at the wave from the side it points to: from above for an upward
            // deflection (and for a continuous artifact, which has no direction),
            // from below for a downward one.
            const dir = y <= traceY(centerY, data[j0], pxPerUV) ? -1 : 1;
            const tip = y + dir * 5 * k, tail = y + dir * 22 * k;
            drawnMarks++;
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 1.6 * k;
            ctx.beginPath();
            ctx.moveTo(x, tail); ctx.lineTo(x, tip + dir * 5 * k);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, tip); ctx.lineTo(x - 4 * k, tip + dir * 7 * k); ctx.lineTo(x + 4 * k, tip + dir * 7 * k);
            ctx.closePath();
            ctx.fill();
            label(x, tail + dir * (tagH / 2 + 2), blockOf.get(row.channelIndex) ?? -1);
          }
        }

        markDensityRef.current = drawnMarks * 1000 / Math.max(1, w - lblW);
      }

      // 6. Channel label strip
      ctx.fillStyle = currentTheme.labelBg;
      ctx.fillRect(0, 0, lblW, h);
      ctx.beginPath();
      ctx.strokeStyle = currentTheme.baselineColor;
      ctx.lineWidth = 0.8;
      ctx.moveTo(lblW, 0); ctx.lineTo(lblW, h);
      ctx.stroke();

      for (const row of layout) {
        if (row.channelIndex < 0) continue;
        const ch = montage.channels[row.channelIndex];
        const isHighlighted = highlightedChannels.has(row.channelIndex);
        const dimmed = anyHighlight && !isHighlighted;

        ctx.save();
        if (dimmed) ctx.globalAlpha = 0.4;
        if (isHighlighted) {
          ctx.fillStyle = 'rgba(255, 215, 0, 0.25)';
          ctx.fillRect(0, row.centerFrac * h - 7, lblW, 14);
        }
        const isDetached = rowDetached(ch);
        ctx.fillStyle    = isDetached ? '#f59e0b' : currentTheme.traceColors[ch.group];
        ctx.font         = isHighlighted ? 'bold 10.5px "Courier New", monospace' : 'bold 9.5px "Courier New", monospace';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(ch.label, 4, row.centerFrac * h);
        // A hollow amber dot at the strip's edge flags the dead electrode — the
        // one signal that survives dimming and reads at a glance without parsing
        // the label text.
        if (isDetached) {
          ctx.beginPath();
          ctx.arc(lblW - 6, row.centerFrac * h, 2.6, 0, Math.PI * 2);
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        ctx.restore();
      }

      // 7. State + sensitivity label (top-right). It names only what the state's own
      // background carries: K-complexes, spindles and REMs are toggles, and the label
      // claimed them while they were off (owner, 2026-10-23: nothing on the page that
      // is not there by design).
      {
        const stateLabel = {
          awake: 'Awake · PDR α', drowsy: 'Drowsy · θ',
          n1: 'N1 Sleep', n2: 'N2 Sleep', n3: 'N3 / SWS · δ',
          rem: 'REM · low-voltage mixed',
        }[currentSettings.patientState] ?? currentSettings.patientState;

        ctx.fillStyle    = currentTheme.stateTextColor;
        ctx.font         = '11px sans-serif';
        ctx.textAlign    = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(`${stateLabelRef.current ? stateLabel + '   ' : ''}${currentSettings.sensitivity} µV/mm · ${currentSettings.speed} mm/s`, w - 12, 6);
        // Whole-page patterns in force now, one line each under the state.
        let py = 24;
        for (const { text, color } of pageLabels) {
          ctx.font = 'bold 11px sans-serif';
          const textW = ctx.measureText(text).width;
          ctx.fillStyle = currentTheme.overlayBg;
          ctx.fillRect(w - 12 - textW - 10, py - 2, textW + 10, 16);
          ctx.fillStyle = color;
          ctx.fillRect(w - 12 - textW - 10, py - 2, 3, 16);
          ctx.fillStyle = currentTheme.overlayText;
          ctx.fillText(text, w - 12, py);
          py += 19;
        }
        // The artifacts switched on, each with a dot: solid while it is active now,
        // hollow while a recording level rests it (a muscle episode over, a quiet
        // stretch, the tubing just suctioned), and what it is doing where that moves.
        if (artifactListRef.current) {
          const live = liveArtifacts.current;
          py += pageLabels.length ? 4 : 0;
          for (const id of ARTIFACT_IDS) {
            if (!currentSettings.activePatterns.has(id)) continue;
            if (py > h - 40) break;
            const on = isLiveOn(id, live);
            const detail = liveDetail(id, live, currentSettings);
            const text = `${PATTERN_BY_ID[id]?.name ?? id}${detail ? ` — ${detail}` : ''}`;
            // 10 px on 15 px lines (11 on 18 until 2026-11-27): under Worst case the list
            // ran to twelve lines over the top four rows.
            ctx.font = '10px sans-serif';
            const textW = ctx.measureText(text).width;
            const x1 = w - 12, x0 = x1 - textW - 22;
            ctx.fillStyle = currentTheme.overlayBg;
            ctx.fillRect(x0, py - 2, textW + 22, 14);
            ctx.fillStyle = PATTERN_COLOR[id] ?? currentTheme.overlayText;
            ctx.strokeStyle = PATTERN_COLOR[id] ?? currentTheme.overlayText;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(x0 + 9, py + 5, 3.2, 0, Math.PI * 2);
            if (on) ctx.fill(); else ctx.stroke();
            ctx.globalAlpha = on ? 1 : 0.55;
            ctx.fillStyle = currentTheme.overlayText;
            ctx.fillText(text, x1, py);
            ctx.globalAlpha = 1;
            py += 15;
          }
        }
      }

      // 8. Calibration bar
      {
        const calibPx = 100 * pxPerUV;
        const cbX = w - 16, cbY = h - 14;
        ctx.strokeStyle = currentTheme.calibColor;
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.moveTo(cbX, cbY);             ctx.lineTo(cbX, cbY - calibPx);
        ctx.moveTo(cbX - 4, cbY);         ctx.lineTo(cbX + 4, cbY);
        ctx.moveTo(cbX - 4, cbY - calibPx); ctx.lineTo(cbX + 4, cbY - calibPx);
        ctx.stroke();
        ctx.fillStyle    = currentTheme.calibColor;
        ctx.font         = '9px sans-serif';
        ctx.textAlign    = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('100µV', cbX - 7, cbY - calibPx / 2);
      }

      // 9. Measurement Tool Render
      drawMeasureTools(ctx, pointer.tools, frozenRef.current, { pxPerSec, lblW, w, h });

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(rafId); observer.disconnect(); };
  }, [montage]);

  return (
    <div className="flex-1 h-full relative" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className={`block w-full h-full ${isFrozen ? 'cursor-crosshair' : ''}`}
        {...pointer.handlers}
      />
      <div className="absolute top-2 left-[70px] z-10 flex gap-2">
        <button 
          onClick={() => setIsFrozen(!isFrozen)}
          className={`flex items-center justify-center w-8 h-8 rounded shadow-sm border transition-colors ${
            isFrozen 
              ? 'bg-amber-500/90 border-amber-600 text-white hover:bg-amber-600' 
              : 'bg-white/80 border-slate-300 text-slate-700 hover:bg-white'
          }`}
          title={isFrozen ? 'Resume EEG (Space)' : 'Freeze EEG for measurement (Space)'}
        >
          {isFrozen ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
        </button>
        {/* The measuring workflow is not guessable from a pause button, so it is
            spelled out while frozen — that is the only time it applies. */}
        {isFrozen && (
          <div className="flex items-center h-8 px-2 rounded bg-black/70 text-[11px] text-amber-200 whitespace-nowrap pointer-events-none">
            Click two points or drag a box to measure · ← → page back and forward · Esc clears · Space resumes
          </div>
        )}
      </div>
      {/* Scroll-back: the retained history, oldest at the left, the newest at the right. */}
      {isFrozen && backMax > 0 && (
        <div className="absolute bottom-6 left-[74px] right-24 z-10 flex items-center gap-2 px-2 py-1 rounded bg-black/70 text-[11px] text-amber-200">
          <span className="whitespace-nowrap font-mono">{back > 0 ? `−${fmtBack(back)}` : 'newest'}</span>
          <input
            type="range" min={0} max={backMax} step={0.1} value={backMax - back}
            onChange={e => scrollBack(backMax - parseFloat(e.target.value))}
            aria-label="Scroll back in time"
            className="flex-1 accent-amber-500 cursor-pointer"
          />
          <span className="whitespace-nowrap font-mono text-amber-200/60">oldest −{fmtBack(backMax)}</span>
        </div>
      )}
    </div>
  );
}

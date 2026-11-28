import React, { useEffect, useRef, useState } from 'react';
import { isAux, type Montage } from '../utils/montages';
import type { SimSettings } from '../utils/simTypes';
import { setHoverChannels, toggleClickChannel } from '../utils/highlightStore';
import { PX_PER_MM_X, pxPerMmFromHeight, pxPerUV as calcPxPerUV, ecgScale } from '../utils/displayGeometry';
import { buildLayout, getChannelAtY, GAP_UNITS } from './canvasLayout';

/**
 * What the mouse and keyboard do on the trace (EEGCanvas): while running, hover and
 * click highlight a channel; while frozen, two clicks place a caliper and a drag
 * draws a measuring box; Space freezes and resumes, Escape clears the measurements.
 * The render loop draws the measurements with `drawMeasureTools`.
 */

type Point = { x: number, y: number, t: number, v: number };
// Drag-to-measure (owner, 2026-11-16): while frozen, a drag draws a box whose
// width is a duration and whose height is a voltage, read on the row the drag
// started on. A plain click still places caliper points; the click that ends a
// drag is swallowed so it does not place one too.
type MeasureBox = { x0: number; y0: number; x1: number; y1: number; scale: number; isEcg: boolean };

/** The measurements on the page, read by the render loop every frame. */
export type MeasureTools = {
  points: { a: Point | null, b: Point | null };
  /** The box being dragged, if any. */
  drag: MeasureBox | null;
  /** The last box kept. */
  box: MeasureBox | null;
};

export function useCanvasPointer({
  canvasRef, montage, settingsRef, frozenRef, elapsedRef, isFrozen, setIsFrozen, graphHover,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  montage: Montage;
  settingsRef: React.MutableRefObject<SimSettings>;
  frozenRef: React.MutableRefObject<boolean>;
  elapsedRef: React.MutableRefObject<number>;
  isFrozen: boolean;
  setIsFrozen: (b: boolean) => void;
  graphHover: boolean;
}) {
  const tools = useRef<MeasureTools>({ points: { a: null, b: null }, drag: null, box: null }).current;
  const [hasMeasurePoints, setHasMeasurePoints] = useState(false);
  const swallowClickRef = useRef(false);

  // A montage change redraws the page with other rows, so the calipers go.
  useEffect(() => {
    tools.points = { a: null, b: null };
    setHasMeasurePoints(false);
  }, [montage]);

  /** The row nearest `y` and the scale it is drawn with (px per µV, or per mV for ECG). */
  const rowScaleAt = (y: number, h: number) => {
    const layout = buildLayout(montage);
    let closestRow = layout[0];
    let minDist = Infinity;
    for (const row of layout) {
      if (row.channelIndex < 0) continue;
      const dist = Math.abs(y - row.centerFrac * h);
      if (dist < minDist) { minDist = dist; closestRow = row; }
    }
    const nonSp   = layout.filter(r => r.channelIndex >= 0).length;
    const totalU  = nonSp + (layout.length - nonSp) * GAP_UNITS;
    const pxPerMm = pxPerMmFromHeight(h, totalU);
    const isEcg = closestRow.channelIndex >= 0
      && isAux(montage.channels[closestRow.channelIndex]);
    return { row: closestRow, isEcg, scale: isEcg ? ecgScale(pxPerMm) : calcPxPerUV(pxPerMm, settingsRef.current.sensitivity) };
  };

  const canvasXY = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  // Pointer events, so a finger measures as a mouse does: a tap places a caliper point
  // (the click that follows it), a drag draws a box. Capturing the pointer keeps the
  // drag going when it leaves the canvas.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // A touch drag is not always followed by a click to swallow; a new press starts clean.
    swallowClickRef.current = false;
    if (!frozenRef.current || e.button !== 0 || !canvasRef.current) return;
    canvasRef.current.setPointerCapture?.(e.pointerId);
    const { x, y } = canvasXY(e);
    const { scale, isEcg } = rowScaleAt(y, canvasRef.current.clientHeight);
    tools.drag = { x0: x, y0: y, x1: x, y1: y, scale, isEcg };
  };
  const onMouseUp = (e?: React.MouseEvent<HTMLCanvasElement>) => {
    const d = tools.drag;
    if (!d) return;
    if (e) { const { x, y } = canvasXY(e); d.x1 = x; d.y1 = y; }
    tools.drag = null;
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > 4) {
      tools.box = d;
      swallowClickRef.current = true;
    }
  };

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (swallowClickRef.current) { swallowClickRef.current = false; return; }

    if (!frozenRef.current) {
      // Not frozen: clicks toggle a persistent channel highlight instead of measuring.
      const rect = canvas.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const idx = getChannelAtY(buildLayout(montage), y, canvas.clientHeight);
      if (idx !== null) toggleClickChannel(idx);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const currentSettings = settingsRef.current;
    const pxPerSec  = currentSettings.speed * PX_PER_MM_X;
    const currentT = elapsedRef.current;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    const clickT = currentT - (w - x) / pxPerSec;

    // Invert exactly the mapping the renderer used to draw this row. `traceY` is
    // `centerY + v * scale`, so the inverse is `(y - centerY) / scale` — and
    // `scale` must be the SAME one that row was drawn with, or the caliper
    // measures a curve it did not plot. The ECG row is drawn through `ecgScale`
    // (mV, and negated, being a limb lead); `rowScaleAt` branches on it, which was
    // once the whole fix for a caliper off by ~14x and the wrong sign there.
    const { row: closestRow, scale: clickScale } = rowScaleAt(y, h);
    const clickV = (y - closestRow.centerFrac * h) / clickScale;

    const point = { x, y, t: clickT, v: clickV };

    const currentPoints = tools.points;
    if (!currentPoints.a || (currentPoints.a && currentPoints.b)) {
      tools.points = { a: point, b: null };
    } else {
      tools.points = { a: currentPoints.a, b: point };
    }
    setHasMeasurePoints(!hasMeasurePoints);
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tools.drag) {
      const { x, y } = canvasXY(e);
      tools.drag.x1 = x;
      tools.drag.y1 = y;
    }
    if (!graphHover) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const idx = getChannelAtY(buildLayout(montage), y, canvas.clientHeight);
    setHoverChannels(idx !== null ? new Set([idx]) : new Set());
  };

  const onMouseLeave = (e: React.MouseEvent<HTMLCanvasElement>) => {
    onMouseUp(e);
    setHoverChannels(new Set());
  };

  // Resuming the trace moves everything a box was drawn over, so it goes.
  useEffect(() => {
    if (!isFrozen) { tools.box = null; tools.drag = null; }
  }, [isFrozen]);

  // Turning graph hover off mid-hover would otherwise leave the last hovered
  // channel stuck highlighted, since no further mouse-move fires to clear it.
  useEffect(() => {
    if (!graphHover) setHoverChannels(new Set());
  }, [graphHover]);

  // Keyboard transport. Freezing the trace and measuring on it is the single
  // most useful thing a learner can do here, and it was reachable only through
  // one small unlabelled button. Space is the freeze/resume key every clinical
  // review system uses; Escape clearing the calipers saves a throwaway third
  // click just to begin a new measurement (a third click currently restarts the
  // pair anyway, but only after the old one is still on screen).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Never steal the key from a control that already means something by it:
      // Space types into the pattern search box and activates focused buttons
      // and switches.
      if (el && (el.isContentEditable
        || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)
        || el.getAttribute('role') === 'switch')) return;
      if (e.code === 'Space') {
        e.preventDefault();          // otherwise the page scrolls
        setIsFrozen(!frozenRef.current);
      } else if (e.key === 'Escape' && frozenRef.current) {
        tools.points = { a: null, b: null };
        tools.box = null;
        setHasMeasurePoints(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setIsFrozen]);

  return {
    tools,
    handlers: { onClick, onPointerDown, onPointerUp: onMouseUp, onPointerMove: onMouseMove, onPointerLeave: onMouseLeave, onPointerCancel: onMouseLeave },
  };
}

/** Draw the measurements: the drag box (the one being drawn, else the last one kept) and the caliper. */
export function drawMeasureTools(
  ctx: CanvasRenderingContext2D, tools: MeasureTools, frozen: boolean,
  { pxPerSec, lblW, w, h }: { pxPerSec: number; lblW: number; w: number; h: number },
) {
  const mbox = frozen ? (tools.drag ?? tools.box) : null;
  if (mbox) {
    const bx = Math.min(mbox.x0, mbox.x1), by = Math.min(mbox.y0, mbox.y1);
    const bw = Math.abs(mbox.x1 - mbox.x0), bh = Math.abs(mbox.y1 - mbox.y0);
    ctx.save();
    ctx.fillStyle = 'rgba(59,130,246,0.10)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.setLineDash([]);
    const dtS = bw / pxPerSec;
    const dv = bh / mbox.scale;
    const dtText = dtS >= 1 ? `${dtS.toFixed(2)} s` : `${(dtS * 1000).toFixed(0)} ms`;
    const dvText = mbox.isEcg ? `${dv.toFixed(2)} mV` : `${dv.toFixed(1)} µV`;
    const text = `Δt ${dtText} · ΔV ${dvText}${dtS > 0 ? ` · ${(1 / dtS).toFixed(1)} Hz` : ''}`;
    ctx.font = '11px sans-serif';
    const tw = ctx.measureText(text).width + 12;
    // Above the box, unless that is under the freeze button's hint at the top.
    const ly = by > 64 ? by - 12 : by + bh + 12;
    const lx = Math.min(Math.max(bx + bw / 2, lblW + tw / 2 + 2), w - tw / 2 - 2);
    ctx.fillStyle = 'rgba(15,23,42,0.85)';
    ctx.fillRect(lx - tw / 2, ly - 10, tw, 20);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx, ly);
    ctx.restore();
  }
  if (frozen) {
    const { a, b } = tools.points;

    ctx.strokeStyle = '#ef4444';
    ctx.fillStyle = '#ef4444';
    ctx.lineWidth = 1;

    if (a) {
      ctx.beginPath(); ctx.arc(a.x, a.y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(a.x, 0); ctx.lineTo(a.x, h); ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
    }
    if (b) {
      ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(b.x, 0); ctx.lineTo(b.x, h); ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
    }

    if (a && b) {
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);

      const dt = Math.abs(b.t - a.t);
      const dv = Math.abs(b.v - a.v);
      const freq = dt > 0 ? (1 / dt).toFixed(1) : '0';
      const text = `${(dt * 1000).toFixed(0)} ms | ${dv.toFixed(1)} µV | ${freq} Hz`;

      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2 - 15;
      const tw = ctx.measureText(text).width + 12;

      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillRect(midX - tw/2, midY - 10, tw, 20);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(text, midX, midY);
    }
  }
}

import React, { useEffect, useRef } from 'react';
import { Montage, ALL_ELECTRODES, GROUP_COLORS } from '../utils/montages';
import { SimSettings } from '../utils/eegGenerator';
import { computeChannelVoltage } from '../utils/computeChannel';
import { getElectrodeVoltage } from '../utils/eegGenerator';

type EEGCanvasProps = {
  montage: Montage;
  settings: SimSettings;
  activeEffectsLabel: string;
};

// ── Visual constants ────────────────────────────────────────────────────────
const BG_EVEN  = '#c8e6c0';
const BG_ODD   = '#bdddb5';
const LABEL_BG = 'rgba(200,230,192,0.93)';

const GRID_1S   = 'rgba(0,100,0,0.26)';
const GRID_200  = 'rgba(0,100,0,0.10)';
const GRID_H5MM = 'rgba(0,100,0,0.16)';
const GRID_H1MM = 'rgba(0,100,0,0.07)';

const PX_PER_MM_X = 4;   // horizontal: pixels per mm
const MM_PER_ROW  = 10;  // each EEG channel = 10 mm vertically
const GAP_UNITS   = 0.40; // fractional row-height gap between chain groups

type RowLayout = {
  channelIndex: number;  // -1 = spacer
  centerFrac: number;
  rowFrac: number;
};

function buildLayout(montage: Montage): RowLayout[] {
  const rows: Array<{ channelIndex: number; prevGroup: string | null; group: string | null }> = [];
  let lastGroup: string | null = null;

  for (let i = 0; i < montage.channels.length; i++) {
    const g = montage.channels[i].group;
    if (lastGroup !== null && g !== lastGroup && g !== 'ecg') {
      rows.push({ channelIndex: -1, prevGroup: lastGroup, group: null });
    }
    rows.push({ channelIndex: i, prevGroup: lastGroup, group: g });
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

export function EEGCanvas({ montage, settings, activeEffectsLabel }: EEGCanvasProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dataBuffer   = useRef<number[][]>([]);
  const timeBuffer   = useRef<number[]>([]);
  const lastTimeRef  = useRef<number>(performance.now());
  const elapsedRef   = useRef<number>(0);

  useEffect(() => {
    dataBuffer.current = montage.channels.map(() => []);
    timeBuffer.current = [];
  }, [montage]);

  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let rafId: number;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width  = container.clientWidth;
      canvas.height = container.clientHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const layout = buildLayout(montage);

    const render = (now: number) => {
      const dtMs = now - lastTimeRef.current;
      lastTimeRef.current = now;
      const dt = Math.min(dtMs / 1000, 0.1);
      elapsedRef.current += dt;
      const currentT = elapsedRef.current;

      const pxPerSec  = settings.speed * PX_PER_MM_X;
      const winSec    = canvas.width / pxPerSec;

      // ── Fill sample buffer at 250 Hz ──
      const dtS  = 1 / 250;
      let lastT  = timeBuffer.current.length > 0
        ? timeBuffer.current[timeBuffer.current.length - 1]
        : currentT - dt;

      while (lastT < currentT) {
        lastT += dtS;
        const allV: Record<string, number> = {};
        for (const el of ALL_ELECTRODES) allV[el] = getElectrodeVoltage(el, lastT, settings);
        timeBuffer.current.push(lastT);
        for (let i = 0; i < montage.channels.length; i++) {
          if (!dataBuffer.current[i]) dataBuffer.current[i] = [];
          dataBuffer.current[i].push(computeChannelVoltage(montage.channels[i], lastT, settings, allV));
        }
      }

      // Evict old samples
      const cutoff = currentT - winSec;
      let evict = 0;
      while (timeBuffer.current[evict] < cutoff && evict < timeBuffer.current.length - 2) evict++;
      if (evict > 0) {
        timeBuffer.current.splice(0, evict);
        for (let i = 0; i < montage.channels.length; i++) dataBuffer.current[i]?.splice(0, evict);
      }

      // ── RENDER ──────────────────────────────────────────────────────────────
      const w = canvas.width;
      const h = canvas.height;

      // 1. Base green paper
      ctx.fillStyle = BG_EVEN;
      ctx.fillRect(0, 0, w, h);

      // 2. Alternating 1-second tinted bands (even seconds slightly darker)
      {
        const rightT = currentT;
        const leftT  = rightT - winSec;
        for (let s = Math.floor(leftT); s <= Math.ceil(rightT); s++) {
          if (s % 2 !== 0) continue;
          const x0 = w - (rightT - s)       * pxPerSec;
          const x1 = w - (rightT - (s + 1)) * pxPerSec;
          ctx.fillStyle = BG_ODD;
          ctx.fillRect(x0, 0, x1 - x0, h);
        }
      }

      // 3. Amplitude grid (px per mm vertical)
      const nonSp   = layout.filter(r => r.channelIndex >= 0).length;
      const nSp     = layout.length - nonSp;
      const totalU  = nonSp + nSp * GAP_UNITS;
      const avgRowH = h / totalU;
      const pxPerMm = avgRowH / MM_PER_ROW;

      // Horizontal lines: minor 1 mm, major 5 mm
      for (let y = 0; y < h; y += pxPerMm) {
        const is5mm = Math.abs(Math.round(y) % Math.round(pxPerMm * 5)) < 1;
        ctx.beginPath();
        ctx.strokeStyle = is5mm ? GRID_H5MM : GRID_H1MM;
        ctx.lineWidth   = is5mm ? 0.55 : 0.3;
        ctx.moveTo(0, y); ctx.lineTo(w, y);
        ctx.stroke();
      }

      // 4. Vertical time grid: minor 200 ms, major 1 s
      {
        const secW   = pxPerSec;
        const minorW = secW * 0.2;
        const pxOff  = (currentT % 1) * secW;

        for (let x = w - (pxOff % minorW); x > 0; x -= minorW) {
          const isMajor = Math.abs((w - x + pxOff) % secW) < 1.8;
          ctx.beginPath();
          ctx.strokeStyle = isMajor ? GRID_1S : GRID_200;
          ctx.lineWidth   = isMajor ? 0.7 : 0.35;
          ctx.moveTo(x, 0); ctx.lineTo(x, h);
          ctx.stroke();
        }
      }

      // 5. Waveform traces
      const pxPerUV = pxPerMm / settings.sensitivity;

      for (const row of layout) {
        if (row.channelIndex < 0) continue;
        const i       = row.channelIndex;
        const ch      = montage.channels[i];
        const data    = dataBuffer.current[i] ?? [];
        const rowH    = row.rowFrac * h;
        const centerY = row.centerFrac * h;
        const isECG   = ch.active === 'ECG';

        // ECG: 1 mV = 10 mm (standard ECG scale), independent of sensitivity
        const scale = isECG ? pxPerMm * 10 / 1000 : pxPerUV;

        // Baseline
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0,80,0,0.13)';
        ctx.lineWidth = 0.4;
        ctx.moveTo(0, centerY); ctx.lineTo(w, centerY);
        ctx.stroke();

        // Trace
        ctx.beginPath();
        ctx.strokeStyle = GROUP_COLORS[ch.group];
        ctx.lineWidth   = isECG ? 1.1 : 0.9;
        let started = false;

        for (let j = 0; j < data.length; j++) {
          const tDist = currentT - timeBuffer.current[j];
          const x = w - tDist * pxPerSec;
          if (x < 0) continue;
          // EEG convention: negative deflection = UP
          const y = centerY - Math.max(-rowH * 1.35, Math.min(rowH * 1.35, data[j] * scale));
          if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
        }
        ctx.stroke();
      }

      // 6. Channel label strip
      const lblW = 66;
      ctx.fillStyle = LABEL_BG;
      ctx.fillRect(0, 0, lblW, h);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0,80,0,0.32)';
      ctx.lineWidth = 0.8;
      ctx.moveTo(lblW, 0); ctx.lineTo(lblW, h);
      ctx.stroke();

      for (const row of layout) {
        if (row.channelIndex < 0) continue;
        const ch = montage.channels[row.channelIndex];
        ctx.fillStyle    = GROUP_COLORS[ch.group];
        ctx.font         = 'bold 9.5px "Courier New", monospace';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(ch.label, 4, row.centerFrac * h);
      }

      // 7. State + sensitivity label (top-right)
      {
        const stateLabel = {
          awake: 'Awake · PDR α', drowsy: 'Drowsy · θ',
          n1: 'N1 Sleep', n2: 'N2 Sleep · K+Spindles', n3: 'N3 / SWS · δ',
        }[settings.patientState] ?? settings.patientState;

        ctx.fillStyle    = 'rgba(0,60,0,0.60)';
        ctx.font         = '11px sans-serif';
        ctx.textAlign    = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(`${stateLabel}   ${settings.sensitivity} µV/mm · ${settings.speed} mm/s`, w - 12, 6);
      }

      // 8. Calibration bar — 100 µV
      {
        const calibPx = 100 * pxPerUV;
        const cbX = w - 16, cbY = h - 14;
        ctx.strokeStyle = '#6b4400';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.moveTo(cbX, cbY);             ctx.lineTo(cbX, cbY - calibPx);
        ctx.moveTo(cbX - 4, cbY);         ctx.lineTo(cbX + 4, cbY);
        ctx.moveTo(cbX - 4, cbY - calibPx); ctx.lineTo(cbX + 4, cbY - calibPx);
        ctx.stroke();
        ctx.fillStyle    = '#6b4400';
        ctx.font         = '9px sans-serif';
        ctx.textAlign    = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('100µV', cbX - 7, cbY - calibPx / 2);
      }

      // 9. Active patterns overlay bar
      if (activeEffectsLabel) {
        ctx.fillStyle = 'rgba(0,40,0,0.68)';
        ctx.fillRect(lblW + 2, h - 20, w - lblW - 20, 18);
        ctx.fillStyle    = '#a0e8a0';
        ctx.font         = '10px sans-serif';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`● ${activeEffectsLabel}`, lblW + 8, h - 11);
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(rafId); window.removeEventListener('resize', resize); };
  }, [montage, settings, activeEffectsLabel]);

  return (
    <div className="flex-1 h-full relative" ref={containerRef}>
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}

import React, { useEffect, useRef } from 'react';
import { Montage, ALL_ELECTRODES, ChannelGroup, GROUP_COLORS } from '../utils/montages';
import { SimSettings } from '../utils/eegGenerator';
import { computeChannelVoltage } from '../utils/computeChannel';
import { getElectrodeVoltage, getECGVoltage } from '../utils/eegGenerator';

type EEGCanvasProps = {
  montage: Montage;
  settings: SimSettings;
  activeEffects: string[];
};

// ── Colour constants ─────────────────────────────────────────────────────────
const BG_EVEN  = '#c8e6c0';          // base paper green
const BG_ODD   = '#bdddb5';          // very subtly darker every other second
const LABEL_BG = 'rgba(200,230,192,0.93)';

// Grid line colours — kept deliberately faint so waveforms read cleanly
const GRID_1S_COLOR  = 'rgba(0, 100, 0, 0.28)'; // 1-second major
const GRID_200_COLOR = 'rgba(0, 100, 0, 0.11)'; // 200 ms minor
const GRID_H_COLOR   = 'rgba(0, 100, 0, 0.09)'; // horizontal amplitude lines

// Pixels per mm — horizontal axis (controls visual paper speed)
const PX_PER_MM_X = 4;

// Each EEG channel row = 10 mm of paper vertically
const MM_PER_ROW = 10;

// Fractional channel-height gap between chain groups
const GAP_UNITS = 0.42;

type RowLayout = {
  channelIndex: number;   // -1 = spacer
  group: ChannelGroup | null;
  centerFrac: number;
  rowFrac: number;
};

function buildLayout(montage: Montage): RowLayout[] {
  const rows: Array<{ channelIndex: number; group: ChannelGroup | null }> = [];
  let lastGroup: ChannelGroup | null = null;

  for (let i = 0; i < montage.channels.length; i++) {
    const g = montage.channels[i].group;
    // Insert spacer when group changes, but not before ECG (we keep ECG snug below last EEG group)
    if (lastGroup !== null && g !== lastGroup && g !== 'ecg') {
      rows.push({ channelIndex: -1, group: null });
    }
    rows.push({ channelIndex: i, group: g });
    lastGroup = g;
  }

  const total = rows.reduce((s, r) => s + (r.channelIndex === -1 ? GAP_UNITS : 1), 0);
  let cum = 0;
  return rows.map(r => {
    const frac: number = r.channelIndex === -1 ? GAP_UNITS / total : 1 / total;
    const layout: RowLayout = { channelIndex: r.channelIndex, group: r.group, centerFrac: cum + frac / 2, rowFrac: frac };
    cum += frac;
    return layout;
  });
}

export function EEGCanvas({ montage, settings, activeEffects }: EEGCanvasProps) {
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

    const resize = () => { canvas.width = container.clientWidth; canvas.height = container.clientHeight; };
    resize();
    window.addEventListener('resize', resize);

    const layout = buildLayout(montage);

    const render = (time: number) => {
      const dtMs = time - lastTimeRef.current;
      lastTimeRef.current = time;
      const dt = Math.min(dtMs / 1000, 0.1);
      elapsedRef.current += dt;
      const currentT = elapsedRef.current;

      const pxPerSec      = settings.speed * PX_PER_MM_X;
      const windowTimeSec = canvas.width / pxPerSec;

      // Fill buffer at 250 Hz
      const dtSample = 1 / 250;
      let lastT = timeBuffer.current.length > 0
        ? timeBuffer.current[timeBuffer.current.length - 1]
        : currentT - dt;

      while (lastT < currentT) {
        lastT += dtSample;
        const allV: Record<string, number> = {};
        for (const el of ALL_ELECTRODES) allV[el] = getElectrodeVoltage(el, lastT, settings);
        timeBuffer.current.push(lastT);
        for (let i = 0; i < montage.channels.length; i++) {
          if (!dataBuffer.current[i]) dataBuffer.current[i] = [];
          dataBuffer.current[i].push(computeChannelVoltage(montage.channels[i], lastT, settings, allV));
        }
      }

      // Evict old samples
      const cutoff = currentT - windowTimeSec;
      let evict = 0;
      while (timeBuffer.current[evict] < cutoff && evict < timeBuffer.current.length - 2) evict++;
      if (evict > 0) {
        timeBuffer.current.splice(0, evict);
        for (let i = 0; i < montage.channels.length; i++) dataBuffer.current[i].splice(0, evict);
      }

      // ─── RENDER ─────────────────────────────────────────────────────────────
      const w = canvas.width;
      const h = canvas.height;

      // 1. Base background (even seconds)
      ctx.fillStyle = BG_EVEN;
      ctx.fillRect(0, 0, w, h);

      // 2. Alternating 1-second vertical bands (odd seconds slightly darker)
      //    We draw bands for every odd 1-second interval visible on screen.
      {
        const secWidth    = pxPerSec;                 // px wide per second
        const timeAtRight = currentT;                 // rightmost time on screen
        const timeAtLeft  = timeAtRight - windowTimeSec;
        const firstSec    = Math.floor(timeAtLeft);   // leftmost whole second

        for (let s = firstSec; s <= Math.ceil(timeAtRight); s++) {
          if (s % 2 !== 0) continue; // only shade even-numbered seconds (gives alternating look)
          const xLeft  = w - (timeAtRight - s)         * pxPerSec;
          const xRight = w - (timeAtRight - (s + 1))   * pxPerSec;
          ctx.fillStyle = BG_ODD;
          ctx.fillRect(xLeft, 0, xRight - xLeft, h);
        }
      }

      // 3. Grid lines
      {
        const secWidth = pxPerSec;
        const minorInt = secWidth * 0.2;   // 200 ms
        const timeOffset = currentT % 1;
        const pxOff = timeOffset * secWidth;

        // Vertical: minor (200 ms) then major (1 s) on top
        for (let x = w - (pxOff % minorInt); x > 0; x -= minorInt) {
          const isMajor = Math.abs((w - x + pxOff) % secWidth) < 1.5;
          ctx.beginPath();
          ctx.strokeStyle = isMajor ? GRID_1S_COLOR : GRID_200_COLOR;
          ctx.lineWidth   = isMajor ? 0.7 : 0.35;
          ctx.moveTo(x, 0); ctx.lineTo(x, h);
          ctx.stroke();
        }

        // Horizontal: derive pxPerMm from channel layout, draw every 1 mm (major every 5 mm)
        const nonSp   = layout.filter(r => r.channelIndex >= 0).length;
        const spacers = layout.length - nonSp;
        const totalU  = nonSp + spacers * GAP_UNITS;
        const avgRowH = h / totalU;
        const pxPerMm = avgRowH / MM_PER_ROW;

        for (let y = 0; y < h; y += pxPerMm) {
          const isMajor5 = Math.abs(Math.round(y) % Math.round(pxPerMm * 5)) < 1;
          ctx.beginPath();
          ctx.strokeStyle = isMajor5 ? 'rgba(0,100,0,0.17)' : GRID_H_COLOR;
          ctx.lineWidth   = isMajor5 ? 0.5 : 0.3;
          ctx.moveTo(0, y); ctx.lineTo(w, y);
          ctx.stroke();
        }

        // Store pxPerMm for waveform scaling below (we recompute to avoid closure issues)
        // pxPerUV = pxPerMm / sensitivity
      }

      // pxPerMm for amplitude (recomputed cleanly)
      const nonSp2   = layout.filter(r => r.channelIndex >= 0).length;
      const spacers2 = layout.length - nonSp2;
      const totalU2  = nonSp2 + spacers2 * GAP_UNITS;
      const avgRowH2 = h / totalU2;
      const pxPerMm  = avgRowH2 / MM_PER_ROW;
      const pxPerUV  = pxPerMm / settings.sensitivity;

      // 4. Waveforms
      for (const row of layout) {
        if (row.channelIndex < 0) continue;
        const i       = row.channelIndex;
        const ch      = montage.channels[i];
        const data    = dataBuffer.current[i] ?? [];
        const rowH    = row.rowFrac * h;
        const centerY = row.centerFrac * h;
        const isECG   = ch.active === 'ECG';

        // ECG: fixed scale so 1 mV = 10 mm (standard); scale factor = pxPerMm * 10 / 1000 µV
        const scale = isECG ? pxPerMm * 10 / 1000 : pxPerUV;

        // Baseline
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0,80,0,0.15)';
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
          // EEG convention: negative UP (subtract scaled value from centerY)
          const y = centerY - Math.max(-rowH * 1.35, Math.min(rowH * 1.35, data[j] * scale));
          if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
        }
        ctx.stroke();
      }

      // 5. Channel labels — left strip
      const labelW = 64;
      ctx.fillStyle = LABEL_BG;
      ctx.fillRect(0, 0, labelW, h);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0,80,0,0.35)';
      ctx.lineWidth = 0.8;
      ctx.moveTo(labelW, 0); ctx.lineTo(labelW, h);
      ctx.stroke();

      for (const row of layout) {
        if (row.channelIndex < 0) continue;
        const ch = montage.channels[row.channelIndex];
        ctx.fillStyle    = GROUP_COLORS[ch.group];
        ctx.font         = 'bold 10px "Courier New", monospace';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(ch.label, 5, row.centerFrac * h);
      }

      // 6. Calibration bar (bottom-right) — shows actual µV/mm scale
      {
        const calibUV  = 100;                          // show 100 µV bar
        const calibPx  = calibUV * pxPerUV;
        const cbX = w - 18;
        const cbY = h - 14;
        ctx.strokeStyle = '#6b4400';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.moveTo(cbX, cbY);           ctx.lineTo(cbX, cbY - calibPx);
        ctx.moveTo(cbX - 4, cbY);       ctx.lineTo(cbX + 4, cbY);
        ctx.moveTo(cbX - 4, cbY - calibPx); ctx.lineTo(cbX + 4, cbY - calibPx);
        ctx.stroke();
        ctx.fillStyle    = '#6b4400';
        ctx.font         = '9px sans-serif';
        ctx.textAlign    = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('100µV', cbX - 7, cbY - calibPx / 2);
      }

      // 7. Active effects bar
      if (activeEffects.length > 0) {
        ctx.fillStyle = 'rgba(0,40,0,0.72)';
        ctx.fillRect(labelW + 2, h - 20, w - labelW - 22, 18);
        ctx.fillStyle = '#a0e8a0';
        ctx.font      = '10.5px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`● ${activeEffects.join('  ·  ')}`, labelW + 8, h - 11);
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(rafId); window.removeEventListener('resize', resize); };
  }, [montage, settings, activeEffects]);

  return (
    <div className="flex-1 h-full relative" ref={containerRef}>
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}

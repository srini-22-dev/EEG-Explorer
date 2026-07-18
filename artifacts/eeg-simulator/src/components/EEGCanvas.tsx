import React, { useEffect, useRef } from 'react';
import { Montage, ALL_ELECTRODES, ChannelGroup, GROUP_COLORS } from '../utils/montages';
import { SimSettings } from '../utils/eegGenerator';
import { computeChannelVoltage } from '../utils/computeChannel';
import { getElectrodeVoltage } from '../utils/eegGenerator';

type EEGCanvasProps = {
  montage: Montage;
  settings: SimSettings;
  activeEffects: string[];
};

// EEG paper colours
const BG_COLOR    = '#c8e6c0';          // classic light green paper
const GRID_MAJOR  = 'rgba(0,110,0,0.35)';
const GRID_MINOR  = 'rgba(0,110,0,0.14)';
const LABEL_BG    = 'rgba(200,230,192,0.92)';

// Horizontal pixels per mm (controls paper speed visual scale)
const PX_PER_MM_X = 4;

// How many mm of vertical paper each channel row occupies
const MM_PER_ROW = 10;

// Spacer between groups (expressed in row-units, e.g. 0.5 = half a channel height)
const GAP_UNITS = 0.45;

/** Pre-compute a layout for every channel in the montage */
type RowLayout = {
  channelIndex: number;   // index into montage.channels (-1 = spacer)
  group: ChannelGroup | null;
  centerFrac: number;     // 0..1 fraction of total canvas height
  rowFrac: number;        // fraction of canvas height for this row
};

function buildLayout(montage: Montage): RowLayout[] {
  const channels = montage.channels;

  // Determine where group changes occur
  const rows: Array<{ channelIndex: number; group: ChannelGroup | null }> = [];
  let lastGroup: ChannelGroup | null = null;

  for (let i = 0; i < channels.length; i++) {
    const g = channels[i].group;
    if (lastGroup !== null && g !== lastGroup && g !== 'ecg') {
      // Insert a spacer row between groups
      rows.push({ channelIndex: -1, group: null });
    }
    rows.push({ channelIndex: i, group: g });
    lastGroup = g;
  }

  // Total weight units
  const total = rows.reduce((acc, r) => acc + (r.channelIndex === -1 ? GAP_UNITS : 1), 0);

  // Assign fractions
  let cumulative = 0;
  return rows.map(r => {
    const frac = r.channelIndex === -1 ? GAP_UNITS / total : 1 / total;
    const layout: RowLayout = {
      channelIndex: r.channelIndex,
      group: r.group,
      centerFrac: cumulative + frac / 2,
      rowFrac: frac,
    };
    cumulative += frac;
    return layout;
  });
}

export function EEGCanvas({ montage, settings, activeEffects }: EEGCanvasProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const dataBuffer   = useRef<number[][]>([]);
  const timeBuffer   = useRef<number[]>([]);
  const lastTimeRef  = useRef<number>(performance.now());
  const elapsedRef   = useRef<number>(0);

  // Reset buffers on montage change
  useEffect(() => {
    dataBuffer.current  = montage.channels.map(() => []);
    timeBuffer.current  = [];
  }, [montage]);

  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let animationFrameId: number;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width  = container.clientWidth;
      canvas.height = container.clientHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const layout = buildLayout(montage);

    const render = (time: number) => {
      const dtMs = time - lastTimeRef.current;
      lastTimeRef.current = time;
      const dt = Math.min(dtMs / 1000, 0.1);
      elapsedRef.current += dt;
      const currentT = elapsedRef.current;

      const pixelsPerSec  = settings.speed * PX_PER_MM_X;
      const windowTimeSec = canvas.width / pixelsPerSec;

      // Sample at 250 Hz
      const sampleRate = 250;
      const dtSample   = 1 / sampleRate;
      let lastT = timeBuffer.current.length > 0
        ? timeBuffer.current[timeBuffer.current.length - 1]
        : currentT - dt;

      while (lastT < currentT) {
        lastT += dtSample;
        const allV: Record<string, number> = {};
        for (const el of ALL_ELECTRODES) {
          allV[el] = getElectrodeVoltage(el, lastT, settings);
        }
        timeBuffer.current.push(lastT);
        for (let i = 0; i < montage.channels.length; i++) {
          const v = computeChannelVoltage(montage.channels[i], lastT, settings, allV);
          if (!dataBuffer.current[i]) dataBuffer.current[i] = [];
          dataBuffer.current[i].push(v);
        }
      }

      // Evict samples outside the visible window
      const cutoffTime = currentT - windowTimeSec;
      let evict = 0;
      while (timeBuffer.current[evict] < cutoffTime && evict < timeBuffer.current.length - 2) evict++;
      if (evict > 0) {
        timeBuffer.current.splice(0, evict);
        for (let i = 0; i < montage.channels.length; i++) {
          dataBuffer.current[i].splice(0, evict);
        }
      }

      // ─── RENDER ──────────────────────────────────────────────────────────────
      const w = canvas.width;
      const h = canvas.height;

      // 1. Paper background
      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, 0, w, h);

      // 2. Grid
      // Minor gridlines every 0.2 s (horizontal) and every 1 mm vertically
      // Major gridlines every 1 s (horizontal) and every 5 mm vertically

      // Vertical time grid  (minor = 0.2s, major = 1s)
      const minorIntervalX = pixelsPerSec * 0.2;
      const majorIntervalX = pixelsPerSec * 1.0;
      const timeOffset     = currentT % 1;
      const pxOffset       = timeOffset * pixelsPerSec;

      for (let x = w - pxOffset % minorIntervalX; x > 0; x -= minorIntervalX) {
        const isMajor = Math.abs(Math.round(x) % Math.round(majorIntervalX)) < 2;
        ctx.beginPath();
        ctx.strokeStyle = isMajor ? GRID_MAJOR : GRID_MINOR;
        ctx.lineWidth   = isMajor ? 0.8 : 0.4;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      // Horizontal amplitude grid  (minor = 1 mm, major = 5 mm)
      // 1 mm = pxPerMm_vertical pixels.  We derive pxPerMm_vertical from average rowH.
      // Average channel rowH (non-spacer) is h / (numChannels + numSpackers*GAP_UNITS)
      const nonSpacerCount = layout.filter(r => r.channelIndex >= 0).length;
      const spacerCount    = layout.length - nonSpacerCount;
      const totalUnits     = nonSpacerCount + spacerCount * GAP_UNITS;
      const avgRowH        = h / totalUnits;
      const pxPerMm        = avgRowH / MM_PER_ROW;
      const minorIntervalY = pxPerMm * 1;   // 1 mm
      const majorIntervalY = pxPerMm * 5;   // 5 mm

      for (let y = 0; y < h; y += minorIntervalY) {
        const isMajor = Math.abs(Math.round(y) % Math.round(majorIntervalY)) < 1;
        ctx.beginPath();
        ctx.strokeStyle = isMajor ? GRID_MAJOR : GRID_MINOR;
        ctx.lineWidth   = isMajor ? 0.8 : 0.4;
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // 3. Waveforms
      // pxPerUV: how many pixels corresponds to 1 µV
      // sensitivity = µV per mm, pxPerMm = pixels per mm  → pxPerUV = pxPerMm / sensitivity
      const pxPerUV = pxPerMm / settings.sensitivity;

      for (const row of layout) {
        if (row.channelIndex < 0) continue; // spacer

        const i = row.channelIndex;
        const ch    = montage.channels[i];
        const data  = dataBuffer.current[i] ?? [];
        const rowH  = row.rowFrac * h;
        const centerY = row.centerFrac * h;

        // ECG uses a fixed separate gain so QRS is visible
        const isECG  = ch.active === 'ECG';
        const scale  = isECG ? (pxPerMm / 50) : pxPerUV;  // ECG: 1 mV = 10 mm (standard ECG)

        // Baseline separator (thin dark line at centerY)
        ctx.beginPath();
        ctx.strokeStyle = isECG ? 'rgba(0,80,0,0.25)' : 'rgba(0,80,0,0.18)';
        ctx.lineWidth = 0.5;
        ctx.moveTo(0, centerY);
        ctx.lineTo(w, centerY);
        ctx.stroke();

        // Trace
        const color = GROUP_COLORS[ch.group];
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth   = isECG ? 1.2 : 1.0;

        let started = false;
        for (let j = 0; j < data.length; j++) {
          const t        = timeBuffer.current[j];
          const timeDist = currentT - t;
          const x        = w - timeDist * pixelsPerSec;
          if (x < 0) continue;

          // EEG convention: negative deflection plots UPWARD
          const rawVal = data[j];
          const scaled = rawVal * scale;
          // Clamp to avoid bleeding more than 1.5 rows
          const clamped = Math.max(-rowH * 1.4, Math.min(rowH * 1.4, scaled));
          const y = centerY - clamped; // subtract → negative is up

          if (!started) { ctx.moveTo(x, y); started = true; }
          else           { ctx.lineTo(x, y); }
        }
        ctx.stroke();
      }

      // 4. Channel labels (left-side overlay)
      const labelW = 62;
      ctx.fillStyle = LABEL_BG;
      ctx.fillRect(0, 0, labelW, h);

      // Thin separator line
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0,80,0,0.4)';
      ctx.lineWidth = 1;
      ctx.moveTo(labelW, 0);
      ctx.lineTo(labelW, h);
      ctx.stroke();

      for (const row of layout) {
        if (row.channelIndex < 0) continue;
        const ch      = montage.channels[row.channelIndex];
        const centerY = row.centerFrac * h;
        const color   = GROUP_COLORS[ch.group];

        ctx.fillStyle = color;
        ctx.font      = `bold 10px "Courier New", monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(ch.label, 5, centerY);
      }

      // 5. Calibration bar (bottom-right corner)
      // Show a 50 µV bar at current sensitivity
      const calibMm  = 50 / settings.sensitivity; // mm for 50 µV
      const calibPx  = calibMm * pxPerMm;
      const cbX      = w - 18;
      const cbY      = h - 16;
      ctx.strokeStyle = '#8b5e00';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(cbX, cbY);
      ctx.lineTo(cbX, cbY - calibPx);
      ctx.moveTo(cbX - 4, cbY);
      ctx.lineTo(cbX + 4, cbY);
      ctx.moveTo(cbX - 4, cbY - calibPx);
      ctx.lineTo(cbX + 4, cbY - calibPx);
      ctx.stroke();
      ctx.fillStyle    = '#8b5e00';
      ctx.font         = '9px sans-serif';
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('50µV', cbX - 8, cbY - calibPx / 2);

      // 6. Active effects status bar
      if (activeEffects.length > 0) {
        ctx.fillStyle = 'rgba(0,50,0,0.75)';
        ctx.fillRect(labelW + 2, h - 22, w - labelW - 20, 20);
        ctx.fillStyle = '#90ee90';
        ctx.font      = '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`● ${activeEffects.join('  ·  ')}`, labelW + 8, h - 12);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
    };
  }, [montage, settings, activeEffects]);

  return (
    <div className="flex-1 h-full relative" ref={containerRef}>
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}

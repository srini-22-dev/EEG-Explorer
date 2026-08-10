import React, { useEffect, useRef, useState } from 'react';
import { Montage, ALL_ELECTRODES } from '../utils/montages';
import { SimSettings } from '../utils/eegGenerator';
import { computeChannelVoltage } from '../utils/computeChannel';
import { SimulationSource } from '../engine/adapter';
import { THEMES, EEGTheme } from '../utils/themes';
import { EDUCATIONAL_ANNOTATIONS } from '../utils/annotations';
import { Pause, Play } from 'lucide-react';
import {
  subscribe,
  getHighlightState,
  HighlightState,
  setHoverChannels,
  toggleClickChannel,
  getChannelsUsingElectrode,
} from '../utils/highlightStore';

type EEGCanvasProps = {
  montage: Montage;
  settings: SimSettings;
  activeEffectsLabel: string;
  theme: EEGTheme;
  showAnnotations: boolean;
  isFrozen: boolean;
  setIsFrozen: (b: boolean) => void;
  dataBuffer: React.MutableRefObject<number[][]>;
  timeBuffer: React.MutableRefObject<number[]>;
};

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

// Hit-test a pointer y-coordinate against row bands. x is intentionally ignored so
// the label strip and the trace body behave identically for hover/click.
function getChannelAtY(layout: RowLayout[], y: number, h: number): number | null {
  for (const row of layout) {
    if (row.channelIndex < 0) continue;
    const top    = (row.centerFrac - row.rowFrac / 2) * h;
    const bottom = (row.centerFrac + row.rowFrac / 2) * h;
    if (y >= top && y < bottom) return row.channelIndex;
  }
  return null;
}

type Point = { x: number, y: number, t: number, v: number };

export function EEGCanvas({ 
  montage, settings, activeEffectsLabel, 
  theme, showAnnotations, isFrozen, setIsFrozen,
  dataBuffer, timeBuffer 
}: EEGCanvasProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastTimeRef  = useRef<number>(performance.now());
  const elapsedRef   = useRef<number>(0);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const labelRef = useRef(activeEffectsLabel);
  labelRef.current = activeEffectsLabel;
  const themeRef = useRef(THEMES[theme]);
  themeRef.current = THEMES[theme];
  const annotationsRef = useRef(showAnnotations);
  annotationsRef.current = showAnnotations;
  const frozenRef = useRef(isFrozen);
  frozenRef.current = isFrozen;

  // Highlight store state, mirrored into a ref (not React state) so the rAF
  // render loop can read it every frame without triggering re-renders.
  const highlightRef = useRef<HighlightState>(getHighlightState());
  useEffect(() => {
    return subscribe(() => { highlightRef.current = getHighlightState(); });
  }, []);

  // Measurement tool state
  const measurePointsRef = useRef<{ a: Point | null, b: Point | null }>({ a: null, b: null });
  const [hasMeasurePoints, setHasMeasurePoints] = useState(false);

  useEffect(() => {
    dataBuffer.current = montage.channels.map(() => []);
    timeBuffer.current = [];
    measurePointsRef.current = { a: null, b: null };
    setHasMeasurePoints(false);
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
    const simSource = new SimulationSource();

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
          timeBuffer.current.push(lastT);
          for (let i = 0; i < montage.channels.length; i++) {
            if (!dataBuffer.current[i]) dataBuffer.current[i] = [];
            dataBuffer.current[i].push(computeChannelVoltage(montage.channels[i], lastT, currentSettings, allV));
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
      }

      // ── RENDER ──────────────────────────────────────────────────────────────
      const w = canvas.width;
      const h = canvas.height;

      // 1. Base paper
      ctx.fillStyle = currentTheme.bgEven;
      ctx.fillRect(0, 0, w, h);

      // 2. Alternating 1-second tinted bands (even seconds slightly darker)
      {
        const rightT = currentT;
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
      const nonSp   = layout.filter(r => r.channelIndex >= 0).length;
      const nSp     = layout.length - nonSp;
      const totalU  = nonSp + nSp * GAP_UNITS;
      const avgRowH = h / totalU;
      const pxPerMm = avgRowH / MM_PER_ROW;

      for (let y = 0; y < h; y += pxPerMm) {
        const is5mm = Math.abs(Math.round(y) % Math.round(pxPerMm * 5)) < 1;
        ctx.beginPath();
        ctx.strokeStyle = is5mm ? currentTheme.gridH5mm : currentTheme.gridH1mm;
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
          ctx.strokeStyle = isMajor ? currentTheme.grid1s : currentTheme.grid200;
          ctx.lineWidth   = isMajor ? 0.7 : 0.35;
          ctx.moveTo(x, 0); ctx.lineTo(x, h);
          ctx.stroke();
        }
      }

      // 5. Waveform traces
      const pxPerUV = pxPerMm / currentSettings.sensitivity;

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

      for (const row of layout) {
        if (row.channelIndex < 0) continue;
        const i       = row.channelIndex;
        const ch      = montage.channels[i];
        const data    = dataBuffer.current[i] ?? [];
        const rowH    = row.rowFrac * h;
        const centerY = row.centerFrac * h;
        const isECG   = ch.active === 'ECG';
        const isHighlighted = highlightedChannels.has(i);
        const dimmed  = anyHighlight && !isHighlighted;

        const scale = isECG ? pxPerMm * 10 / 1000 : pxPerUV;

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

        for (let j = 0; j < data.length; j++) {
          const tDist = currentT - timeBuffer.current[j];
          const x = w - tDist * pxPerSec;
          if (x < 0) continue;
          const y = centerY - Math.max(-rowH * 1.35, Math.min(rowH * 1.35, data[j] * scale));
          if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
        }
        ctx.stroke();
        ctx.restore();
      }

      // 5b. Annotations
      if (annotationsRef.current) {
        for (const pattern of currentSettings.activePatterns) {
          const ann = EDUCATIONAL_ANNOTATIONS[pattern];
          if (ann) {
            let targetRow = layout.find(r => r.channelIndex >= 0 && (ann.targetRegion === 'all' || montage.channels[r.channelIndex].group === ann.targetRegion));
            if (!targetRow) targetRow = layout.find(r => r.channelIndex >= 0);
            
            if (targetRow) {
              const y = targetRow.centerFrac * h - 30;
              const x = w / 2;
              
              ctx.fillStyle = currentTheme.overlayBg;
              ctx.fillRect(x - 10, y - 10, ctx.measureText(ann.text).width + 20, 20);
              ctx.fillStyle = currentTheme.overlayText;
              ctx.font = '11px sans-serif';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillText(ann.text, x, y);
              
              ctx.strokeStyle = currentTheme.overlayText;
              ctx.beginPath();
              if (ann.arrowDirection === 'down') {
                ctx.moveTo(x, y + 10); ctx.lineTo(x, y + 25);
                ctx.lineTo(x - 3, y + 22); ctx.moveTo(x, y + 25); ctx.lineTo(x + 3, y + 22);
              } else if (ann.arrowDirection === 'up') {
                ctx.moveTo(x, y - 10); ctx.lineTo(x, y - 25);
                ctx.lineTo(x - 3, y - 22); ctx.moveTo(x, y - 25); ctx.lineTo(x + 3, y - 22);
              } else if (ann.arrowDirection === 'right') {
                ctx.moveTo(x + ctx.measureText(ann.text).width + 10, y); 
                ctx.lineTo(x + ctx.measureText(ann.text).width + 25, y);
                ctx.lineTo(x + ctx.measureText(ann.text).width + 22, y - 3); 
                ctx.moveTo(x + ctx.measureText(ann.text).width + 25, y); 
                ctx.lineTo(x + ctx.measureText(ann.text).width + 22, y + 3);
              } else {
                ctx.moveTo(x - 10, y); ctx.lineTo(x - 25, y);
                ctx.lineTo(x - 22, y - 3); ctx.moveTo(x - 25, y); ctx.lineTo(x - 22, y + 3);
              }
              ctx.stroke();
            }
          }
        }
      }

      // 6. Channel label strip
      const lblW = 66;
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
        ctx.fillStyle    = currentTheme.traceColors[ch.group];
        ctx.font         = isHighlighted ? 'bold 10.5px "Courier New", monospace' : 'bold 9.5px "Courier New", monospace';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(ch.label, 4, row.centerFrac * h);
        ctx.restore();
      }

      // 7. State + sensitivity label (top-right)
      {
        const stateLabel = {
          awake: 'Awake · PDR α', drowsy: 'Drowsy · θ',
          n1: 'N1 Sleep', n2: 'N2 Sleep · K+Spindles', n3: 'N3 / SWS · δ',
        }[currentSettings.patientState] ?? currentSettings.patientState;

        ctx.fillStyle    = currentTheme.stateTextColor;
        ctx.font         = '11px sans-serif';
        ctx.textAlign    = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(`${stateLabel}   ${currentSettings.sensitivity} µV/mm · ${currentSettings.speed} mm/s`, w - 12, 6);
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

      // 9. Active patterns overlay bar
      const activeLabel = labelRef.current;
      if (activeLabel) {
        ctx.fillStyle = currentTheme.overlayBg;
        ctx.fillRect(lblW + 2, h - 20, w - lblW - 20, 18);
        ctx.fillStyle    = currentTheme.overlayText;
        ctx.font         = '10px sans-serif';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`● ${activeLabel}`, lblW + 8, h - 11);
      }
      
      // 10. Measurement Tool Render
      if (frozenRef.current) {
        const { a, b } = measurePointsRef.current;
        
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

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(rafId); window.removeEventListener('resize', resize); };
  }, [montage]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!frozenRef.current) {
      // Not frozen: clicks toggle a persistent channel highlight instead of measuring.
      const rect = canvas.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const idx = getChannelAtY(buildLayout(montage), y, canvas.height);
      if (idx !== null) toggleClickChannel(idx);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const currentSettings = settingsRef.current;
    const pxPerSec  = currentSettings.speed * PX_PER_MM_X;
    const currentT = elapsedRef.current;
    const w = canvas.width;
    const h = canvas.height;
    
    const clickT = currentT - (w - x) / pxPerSec;
    
    const layout = buildLayout(montage);
    let closestRow = layout[0];
    let minDist = Infinity;
    
    for (const row of layout) {
      if (row.channelIndex < 0) continue;
      const centerY = row.centerFrac * h;
      const dist = Math.abs(y - centerY);
      if (dist < minDist) {
        minDist = dist;
        closestRow = row;
      }
    }
    
    const nonSp   = layout.filter(r => r.channelIndex >= 0).length;
    const nSp     = layout.length - nonSp;
    const totalU  = nonSp + nSp * GAP_UNITS;
    const avgRowH = h / totalU;
    const pxPerMm = avgRowH / MM_PER_ROW;
    const pxPerUV = pxPerMm / currentSettings.sensitivity;
    
    const centerY = closestRow.centerFrac * h;
    const clickV = (centerY - y) / pxPerUV;
    
    const point = { x, y, t: clickT, v: clickV };
    
    const currentPoints = measurePointsRef.current;
    if (!currentPoints.a || (currentPoints.a && currentPoints.b)) {
      measurePointsRef.current = { a: point, b: null };
    } else {
      measurePointsRef.current = { a: currentPoints.a, b: point };
    }
    setHasMeasurePoints(!hasMeasurePoints);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const idx = getChannelAtY(buildLayout(montage), y, canvas.height);
    setHoverChannels(idx !== null ? new Set([idx]) : new Set());
  };

  const handleCanvasMouseLeave = () => {
    setHoverChannels(new Set());
  };

  return (
    <div className="flex-1 h-full relative" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className={`block w-full h-full ${isFrozen ? 'cursor-crosshair' : ''}`}
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={handleCanvasMouseLeave}
      />
      <div className="absolute top-2 left-[70px] z-10 flex gap-2">
        <button 
          onClick={() => setIsFrozen(!isFrozen)}
          className={`flex items-center justify-center w-8 h-8 rounded shadow-sm border transition-colors ${
            isFrozen 
              ? 'bg-amber-500/90 border-amber-600 text-white hover:bg-amber-600' 
              : 'bg-white/80 border-slate-300 text-slate-700 hover:bg-white'
          }`}
          title={isFrozen ? 'Resume EEG' : 'Freeze EEG (for measurement)'}
        >
          {isFrozen ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

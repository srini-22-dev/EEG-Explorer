import React, { useEffect, useRef } from 'react';
import { Montage, ALL_ELECTRODES } from '../utils/montages';
import { SimSettings } from '../utils/eegGenerator';
import { computeChannelVoltage } from '../utils/computeChannel';
import { getElectrodeVoltage } from '../utils/eegGenerator';

type EEGCanvasProps = {
  montage: Montage;
  settings: SimSettings;
  activeEffects: string[];
};

export function EEGCanvas({ montage, settings, activeEffects }: EEGCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Buffer state
  const dataBuffer = useRef<number[][]>([]); // array of channel values
  const timeBuffer = useRef<number[]>([]);
  const lastTimeRef = useRef<number>(performance.now());
  const elapsedRef = useRef<number>(0);

  // Scale constants
  const pixelsPerMmX = 4; // Arbitrary zoom factor for display
  const uVperMm = 7; // standard 7uV/mm
  const basePixelsPerUv = 1.5; 

  useEffect(() => {
    // Reset buffer on montage change
    dataBuffer.current = Array(montage.channels.length).fill([]).map(() => []);
    timeBuffer.current = [];
  }, [montage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let animationFrameId: number;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const render = (time: number) => {
      // Delta time
      const dtMs = time - lastTimeRef.current;
      lastTimeRef.current = time;
      
      // We cap dt to prevent huge jumps if tab is inactive
      const dt = Math.min(dtMs / 1000, 0.1); 
      elapsedRef.current += dt;
      const currentT = elapsedRef.current;

      // pixels per second = (mm/s) * (pixels/mm)
      const pixelsPerSec = settings.speed * pixelsPerMmX;
      // Window time based on width
      const windowTimeSec = canvas.width / pixelsPerSec;
      
      // Calculate new values for this frame
      // To get a smooth line, we should generate at a fixed sample rate (e.g. 200 Hz)
      // We fill in missing samples since last frame
      const sampleRate = 250; 
      const dtSample = 1 / sampleRate;
      
      let lastT = timeBuffer.current.length > 0 ? timeBuffer.current[timeBuffer.current.length - 1] : currentT - dt;
      
      while (lastT < currentT) {
        lastT += dtSample;
        
        // Generate raw voltages
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

      // Evict old data outside the window
      const cutoffTime = currentT - windowTimeSec;
      let evictCount = 0;
      while (timeBuffer.current[evictCount] < cutoffTime && evictCount < timeBuffer.current.length - 2) {
        evictCount++;
      }
      
      if (evictCount > 0) {
        timeBuffer.current.splice(0, evictCount);
        for (let i = 0; i < montage.channels.length; i++) {
          dataBuffer.current[i].splice(0, evictCount);
        }
      }

      // --- RENDER ---
      const w = canvas.width;
      const h = canvas.height;
      const channels = montage.channels;
      
      // Clear background
      ctx.fillStyle = '#0B1121'; // very dark navy
      ctx.fillRect(0, 0, w, h);

      // Draw Grid
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(14, 165, 233, 0.15)'; // faint cyan grid
      
      // Time grid lines (1 second intervals)
      // Moving grid so the wave stays attached to the grid time
      const timeOffset = currentT % 1;
      const pxOffset = timeOffset * pixelsPerSec;
      
      ctx.beginPath();
      for (let x = w - pxOffset; x > 0; x -= pixelsPerSec) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      // Horizontal baselines
      const rowH = h / channels.length;
      for (let i = 1; i < channels.length; i++) {
        const y = i * rowH;
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();

      // Draw Channels
      ctx.lineWidth = 1.5;
      
      for (let i = 0; i < channels.length; i++) {
        const centerY = (i + 0.5) * rowH;
        const data = dataBuffer.current[i];
        
        ctx.beginPath();
        // Base color: bright green-cyan
        ctx.strokeStyle = '#10B981'; // emerald-500
        
        for (let j = 0; j < data.length; j++) {
          const t = timeBuffer.current[j];
          // time distance from now
          const timeDist = currentT - t;
          const x = w - (timeDist * pixelsPerSec);
          
          // EEG convention: Negative is UP
          // v in uV. scale = basePixelsPerUv * gain
          const val = data[j] * settings.gain;
          // dampen slightly to fit row
          const scaled = val * basePixelsPerUv;
          // clamp to avoid bleeding too much into other channels
          const clamped = Math.max(Math.min(scaled, rowH * 1.2), -rowH * 1.2);
          
          const y = centerY - clamped; // subtract because negative is up in EEG (if val is negative, y increases -> down? Wait. standard: negative up. So if val < 0, we want it UP (smaller Y). So centerY + val. If val is negative, it goes up.
          
          const finalY = centerY + clamped; 

          if (j === 0) ctx.moveTo(x, finalY);
          else ctx.lineTo(x, finalY);
        }
        ctx.stroke();

        // Draw Channel Label
        ctx.fillStyle = '#0B1121';
        ctx.fillRect(0, i * rowH, 60, rowH);
        
        ctx.fillStyle = '#94A3B8'; // slate-400
        ctx.font = '11px "Spline Sans Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(channels[i].label, 8, centerY);
      }

      // Draw Calibration Bar (50uV)
      const calibUv = 50;
      const calibPx = calibUv * basePixelsPerUv * settings.gain;
      ctx.strokeStyle = '#F59E0B'; // amber-500
      ctx.lineWidth = 2;
      ctx.beginPath();
      const cbX = w - 20;
      const cbY = h - 40;
      ctx.moveTo(cbX, cbY);
      ctx.lineTo(cbX, cbY - calibPx);
      ctx.stroke();
      
      ctx.fillStyle = '#F59E0B';
      ctx.font = '10px sans-serif';
      ctx.fillText('50µV', cbX - 30, cbY - calibPx / 2);

      // Draw active effects overlay summary
      if (activeEffects.length > 0) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
        ctx.fillRect(10, h - 30, w - 20, 24);
        ctx.fillStyle = '#38BDF8';
        ctx.font = '12px sans-serif';
        ctx.fillText(`Active: ${activeEffects.join(', ')}`, 20, h - 18);
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
      <canvas 
        ref={canvasRef} 
        className="block w-full h-full cursor-crosshair"
      />
    </div>
  );
}

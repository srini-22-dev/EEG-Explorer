import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Montage } from '../utils/montages';
import type { SimSettings } from '../utils/simTypes';

type SpectrumPanelProps = {
  dataBuffer: React.MutableRefObject<number[][]>;
  montage: Montage;
  settings: SimSettings;
};

/**
 * Analysis epoch, in samples — 8 s at 250 Hz.
 *
 * Band power used to be computed over the whole buffer. That was wrong twice over.
 * Clinically, it made the analysed span a function of canvas width and paper speed,
 * so the displayed powers shifted when the window was resized or the sweep changed —
 * nothing about the signal had changed. Computationally, the buffer now retains a
 * minute of signal, and this runs ~104 O(N) Goertzel passes every 250 ms, so an
 * uncapped N would have cost roughly 1.6M iterations a tick on the main thread.
 *
 * 2000 samples puts the Goertzel bin width at 0.125 Hz, so the 0.5 Hz sweep below
 * lands on exact bins instead of being rounded onto a neighbour, and gives the
 * 0.5 Hz bottom of the delta band four full cycles to sit in.
 */
const EPOCH_SAMPLES = 2000;

function goertzelMag(data: number[], sampleRate: number, targetFreq: number) {
  const k = Math.floor(0.5 + (data.length * targetFreq) / sampleRate);
  const omega = (2 * Math.PI * k) / data.length;
  const cosine = Math.cos(omega);
  const coeff = 2 * cosine;
  let q0 = 0, q1 = 0, q2 = 0;
  for (let i = 0; i < data.length; i++) {
    q0 = coeff * q1 - q2 + data[i];
    q2 = q1;
    q1 = q0;
  }
  const mag2 = q1 * q1 + q2 * q2 - q1 * q2 * coeff;
  return Math.sqrt(mag2) / data.length;
}

function calculateBandPower(data: number[], sampleRate: number, startFreq: number, endFreq: number) {
  if (!data || data.length === 0) return 0;
  let power = 0;
  for (let f = startFreq; f <= endFreq; f += 0.5) {
    power += goertzelMag(data, sampleRate, f);
  }
  return power;
}

export function SpectrumPanel({ dataBuffer, montage, settings }: SpectrumPanelProps) {
  const [selectedChannel, setSelectedChannel] = useState<number>(0);
  const [powerData, setPowerData] = useState<{name: string, value: number}[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      const channelData = dataBuffer.current[selectedChannel];
      if (!channelData || channelData.length === 0) return;

      // Most recent EPOCH_SAMPLES, so the analysed span is fixed rather than
      // whatever the canvas happens to be showing.
      const epoch = channelData.length > EPOCH_SAMPLES
        ? channelData.slice(channelData.length - EPOCH_SAMPLES)
        : channelData;

      const data = [
        { name: 'Delta (0.5-4 Hz)', value: calculateBandPower(epoch, 250, 0.5, 4) },
        { name: 'Theta (4-8 Hz)', value: calculateBandPower(epoch, 250, 4, 8) },
        { name: 'Alpha (8-13 Hz)', value: calculateBandPower(epoch, 250, 8, 13) },
        { name: 'Beta (13-30 Hz)', value: calculateBandPower(epoch, 250, 13, 30) },
        { name: 'Gamma (30-50 Hz)', value: calculateBandPower(epoch, 250, 30, 50) },
      ];
      setPowerData(data);
    }, 250);

    return () => clearInterval(interval);
  }, [dataBuffer, selectedChannel]);

  return (
    <div className="h-48 bg-[#1e2a1e] border-t border-[#2e4a2e] p-4 flex flex-col text-slate-200">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm font-bold text-emerald-400">FFT Spectrum Analysis</h3>
        <select 
          className="bg-slate-800 text-xs border border-slate-700 rounded p-1 text-slate-200"
          value={selectedChannel}
          onChange={(e) => setSelectedChannel(Number(e.target.value))}
        >
          {montage.channels.map((ch, idx) => (
            <option key={idx} value={idx}>{ch.label}</option>
          ))}
        </select>
      </div>
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={powerData}>
            <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} />
            <YAxis stroke="#94a3b8" fontSize={10} />
            <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '4px' }} />
            <Bar dataKey="value" fill="#34d399" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

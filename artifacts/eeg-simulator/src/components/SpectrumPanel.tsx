import React, { useState, useEffect, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Montage } from '../utils/montages';
import type { SimSettings } from '../utils/simTypes';

type SpectrumPanelProps = {
  dataBuffer: React.MutableRefObject<number[][]>;
  montage: Montage;
  freezeYAxis: boolean;
  setFreezeYAxis: (b: boolean) => void;
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

/**
 * Band power: the sum of |X(f)|² over the band, not the sum of |X(f)|.
 *
 * Summing magnitude is what this did before, and it made the bars a measure of
 * band WIDTH as much as of band content: at a 0.5 Hz step, delta spans 8 bins,
 * alpha 11, beta 35 and gamma 41, so beta and gamma start with a 3-4x head start
 * that no amount of real alpha can overcome. On a normal awake posterior channel
 * that put beta or gamma above alpha — the opposite of the posterior dominant
 * rhythm a learner is being taught to find (see IK-006). Power is amplitude
 * SQUARED, which is what the function name always claimed and what makes a
 * narrow, tall alpha peak outweigh a wide, flat beta shelf. With the square,
 * alpha ranks highest on every posterior derivation of a normal awake record.
 */
function calculateBandPower(data: number[], sampleRate: number, startFreq: number, endFreq: number) {
  if (!data || data.length === 0) return 0;
  let power = 0;
  for (let f = startFreq; f <= endFreq; f += 0.5) {
    const m = goertzelMag(data, sampleRate, f);
    power += m * m;
  }
  return power;
}

/** Axis labels are read at a glance, so two significant figures is the useful precision. */
const sig2 = (v: number) => Number(v.toPrecision(2));

export function SpectrumPanel({ dataBuffer, montage, freezeYAxis, setFreezeYAxis, settings }: SpectrumPanelProps) {
  const [selectedChannel, setSelectedChannel] = useState<number>(0);
  const [powerData, setPowerData] = useState<{name: string, value: number}[]>([]);
  // Band powers are amplitude-scaled µV from the Goertzel above, not a
  // fixed-unit quantity — a hardcoded axis maximum would be wrong for a
  // different subject, sensitivity or montage. So freezing captures whatever
  // the axis is showing at the instant it is switched on, and holds that.
  const [frozenMax, setFrozenMax] = useState<number | null>(null);
  const wasFrozen = useRef(false);

  useEffect(() => {
    if (freezeYAxis && !wasFrozen.current) {
      const max = powerData.length ? Math.max(...powerData.map(d => d.value)) : 0;
      setFrozenMax(max > 0 ? sig2(max * 1.15) : 1);
    } else if (!freezeYAxis) {
      setFrozenMax(null);
    }
    wasFrozen.current = freezeYAxis;
  }, [freezeYAxis, powerData]);

  useEffect(() => {
    const recompute = () => {
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
    };

    // Recompute up front as well as on the interval: the epoch is already in the
    // buffer, so picking a different channel has no reason to leave the previous
    // channel's bars on screen for up to 250 ms.
    recompute();
    const interval = setInterval(recompute, 250);

    return () => clearInterval(interval);
  }, [dataBuffer, selectedChannel]);

  return (
    <div className="h-48 bg-[#1e2a1e] border-t border-[#2e4a2e] p-4 flex flex-col text-slate-200">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm font-bold text-emerald-400">FFT Spectrum Analysis</h3>
        <div className="flex items-center gap-2">
        <button
          onClick={() => setFreezeYAxis(!freezeYAxis)}
          className={`text-xs px-2 py-1 rounded border transition-colors ${
            freezeYAxis
              ? 'bg-emerald-800/40 border-emerald-600 text-emerald-300'
              : 'border-slate-700 text-slate-400 hover:bg-slate-800'
          }`}
        >
          {freezeYAxis ? 'Unfreeze Y' : 'Freeze Y'}
        </button>
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
      </div>
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={powerData}>
            <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} />
            <YAxis
              stroke="#94a3b8"
              fontSize={10}
              domain={frozenMax != null ? [0, frozenMax] : undefined}
              tickFormatter={frozenMax != null ? (v: number) => String(sig2(v)) : undefined}
            />
            <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '4px' }} />
            <Bar dataKey="value" fill="#34d399" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

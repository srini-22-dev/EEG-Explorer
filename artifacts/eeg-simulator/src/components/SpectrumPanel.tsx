import React, { useState, useEffect, useRef } from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Montage } from '../utils/montages';
import { FFT_BANDS, channelBandPowers } from '../utils/fftBands';
import { getHighlightState, subscribe } from '../utils/highlightStore';

type SpectrumPanelProps = {
  dataBuffer: React.MutableRefObject<number[][]>;
  montage: Montage;
  freezeYAxis: boolean;
  setFreezeYAxis: (b: boolean) => void;
};

/**
 * What the y-axis carries. `channelBandPowers` (utils/fftBands.ts) takes the
 * display-space channel in µV (computeChannelVoltage), and for each band sums
 * (|X(f)|/N)² from the Goertzel at 0.5 Hz steps over the last 8 s — so the unit is
 * µV², a power, and not a density (no division by Hz) and not dB. It is not a
 * calibrated absolute band power either: the 0.5 Hz steps sample one DFT bin in
 * four (8 s gives 0.125 Hz bins) and the sum is one-sided without the factor of 2.
 * The bars are therefore right to compare with each other — band against band,
 * channel against channel — but not against a µV² figure from another analyser,
 * which is what the axis title's tooltip says.
 */
const POWER_UNIT = 'µV²';
const POWER_NOTE = 'Band power in µV²: the squared DFT magnitude of this channel (as displayed, in µV), summed at 0.5 Hz steps across the band, over the last 8 s. Compare bars with each other; it is not a calibrated absolute band power.';

/** Axis labels are read at a glance, so two significant figures is the useful precision. */
const sig2 = (v: number) => Number(v.toPrecision(2));

export function SpectrumPanel({ dataBuffer, montage, freezeYAxis, setFreezeYAxis }: SpectrumPanelProps) {
  const [selectedChannel, setSelectedChannel] = useState<number>(0);
  const [powerData, setPowerData] = useState<{ name: string; value: number; color: string }[]>([]);
  // Band powers (µV², see POWER_UNIT) scale with the subject, montage and
  // pattern — a hardcoded axis maximum would be wrong for a different one. So
  // freezing captures whatever the axis is showing at the instant it is switched
  // on, and holds that.
  const [frozenMax, setFrozenMax] = useState<number | null>(null);
  const wasFrozen = useRef(false);

  // When a trace is clicked on the canvas it becomes the persistent highlight;
  // the spectrum follows it so the bars describe the channel the eye is on. When
  // the highlight is cleared the panel reverts to whatever the dropdown last had.
  // Clicked channels are an insertion-ordered Set, so the last entry is the most
  // recently clicked — the sensible one to follow when several are highlighted.
  const [highlightedChannel, setHighlightedChannel] = useState<number | null>(null);
  useEffect(() => {
    const update = () => {
      const clicked = getHighlightState().clickedChannels;
      setHighlightedChannel(clicked.size > 0 ? Array.from(clicked)[clicked.size - 1] : null);
    };
    update();
    return subscribe(update);
  }, []);

  const effectiveChannel = highlightedChannel ?? selectedChannel;

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
      const channelData = dataBuffer.current[effectiveChannel];
      if (!channelData || channelData.length === 0) return;
      // The most recent EPOCH_SAMPLES, so the analysed span is fixed rather than
      // whatever the canvas happens to be showing.
      const powers = channelBandPowers(channelData);
      setPowerData(FFT_BANDS.map((b, i) => ({ name: b.name, value: powers[i], color: b.color })));
    };

    // Recompute up front as well as on the interval: the epoch is already in the
    // buffer, so picking a different channel has no reason to leave the previous
    // channel's bars on screen for up to 250 ms.
    recompute();
    const interval = setInterval(recompute, 250);

    return () => clearInterval(interval);
  }, [dataBuffer, effectiveChannel]);

  const followingLabel = highlightedChannel != null
    ? montage.channels[highlightedChannel]?.label
    : null;

  return (
    <div className="h-48 bg-[#1e2a1e] border-t border-[#2e4a2e] p-4 flex flex-col text-slate-200">
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold text-emerald-400">FFT Spectrum Analysis</h3>
          <span className="text-[10px] text-slate-400 cursor-help border-b border-dotted border-slate-600" title={POWER_NOTE}>
            band power, {POWER_UNIT}
          </span>
          {/* Legend — same colours the right-side panel and its bars use. */}
          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
            {FFT_BANDS.map(b => (
              <span key={b.key} className="flex items-center gap-1 text-[10px] text-slate-400">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: b.color }} />
                {b.name.split(' ')[0]}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {followingLabel && (
            <span className="text-[10px] px-2 py-1 rounded bg-emerald-900/40 border border-emerald-700 text-emerald-300">
              following {followingLabel}
            </span>
          )}
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
            className="bg-slate-800 text-xs border border-slate-700 rounded p-1 text-slate-200 disabled:opacity-50"
            value={selectedChannel}
            disabled={highlightedChannel != null}
            title={highlightedChannel != null ? 'Following the highlighted trace — click it off to use this' : undefined}
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
          <BarChart data={powerData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} />
            <YAxis
              stroke="#94a3b8"
              fontSize={10}
              domain={frozenMax != null ? [0, frozenMax] : undefined}
              tickFormatter={(v: number) => String(sig2(v))}
              label={{ value: `Power (${POWER_UNIT})`, angle: -90, position: 'insideLeft', offset: 0, fill: '#94a3b8', fontSize: 10, style: { textAnchor: 'middle' } }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '4px' }}
              formatter={(v: number) => [`${sig2(v)} ${POWER_UNIT}`, 'Band power']}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {powerData.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

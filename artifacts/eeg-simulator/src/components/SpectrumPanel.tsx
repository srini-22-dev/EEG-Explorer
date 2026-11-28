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
    <div className="h-48 pointer-coarse:h-64 bg-ui-root border-t border-ui-sep px-4 py-3 flex flex-col text-ui-text">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-[13px] font-semibold text-ui-text">FFT spectrum</h3>
          <span className="text-[11px] text-ui-text-2 cursor-help border-b border-dotted border-ui-text-3" title={POWER_NOTE}>
            band power, {POWER_UNIT}
          </span>
          {/* Legend — same colours the right-side panel and its bars use. */}
          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
            {FFT_BANDS.map(b => (
              <span key={b.key} className="flex items-center gap-1 text-[11px] text-ui-text-2">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: b.color }} />
                {b.name.split(' ')[0]}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {followingLabel && (
            <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-ui-accent/12 text-ui-accent">
              following {followingLabel}
            </span>
          )}
          <button
            onClick={() => setFreezeYAxis(!freezeYAxis)}
            className={`text-[12px] font-medium px-3 h-7 pointer-coarse:h-9 rounded-full transition-colors ${
              freezeYAxis
                ? 'bg-ui-accent text-ui-on-accent'
                : 'bg-ui-fill text-ui-text hover:bg-ui-fill-2'
            }`}
          >
            {freezeYAxis ? 'Unfreeze Y' : 'Freeze Y'}
          </button>
          <select
            className="appearance-none rounded-[8px] bg-ui-fill hover:bg-ui-fill-2 px-2.5 h-7 pointer-coarse:h-9 text-[12px] font-medium text-ui-text disabled:opacity-50"
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
            <XAxis dataKey="name" stroke="var(--ui-text-2)" fontSize={10} tickLine={false} />
            <YAxis
              stroke="var(--ui-text-2)"
              fontSize={10}
              tickLine={false}
              domain={frozenMax != null ? [0, frozenMax] : undefined}
              tickFormatter={(v: number) => String(sig2(v))}
              label={{ value: `Power (${POWER_UNIT})`, angle: -90, position: 'insideLeft', offset: 0, fill: 'var(--ui-text-2)', fontSize: 10, style: { textAnchor: 'middle' } }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: 'var(--ui-card)', color: 'var(--ui-text)', border: '0.5px solid var(--ui-sep)', borderRadius: '10px', boxShadow: 'var(--ui-shadow)' }}
              cursor={{ fill: 'var(--ui-fill)' }}
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

import React, { useState, useEffect } from 'react';
import { Montage } from '../utils/montages';
import { FFT_BANDS, channelBandPowers } from '../utils/fftBands';
import { getHighlightState, subscribe } from '../utils/highlightStore';

type RightSpectrumPanelProps = {
  dataBuffer: React.MutableRefObject<number[][]>;
  montage: Montage;
};

/**
 * Gap between chain groups, as a fraction of one channel row's height. Mirrors
 * `GAP_UNITS` in EEGCanvas so this panel's rows line up with the traces: both fill
 * the same PanelGroup height and lay their rows out in the same proportional units,
 * so a channel's strip here sits at the same vertical band as its trace on the left.
 */
const GAP_UNITS = 0.4;

type NormalizeMode = 'within' | 'across';

type Row =
  | { kind: 'gap'; frac: number }
  | { kind: 'channel'; frac: number; index: number; label: string; isEcg: boolean };

/** Rows and per-row flex weights, matching EEGCanvas.buildLayout's group-gap rule. */
function buildRows(montage: Montage): Row[] {
  const rows: Row[] = [];
  let lastGroup: string | null = null;
  for (let i = 0; i < montage.channels.length; i++) {
    const g = montage.channels[i].group;
    if (lastGroup !== null && g !== lastGroup && g !== 'ecg') {
      rows.push({ kind: 'gap', frac: GAP_UNITS });
    }
    rows.push({ kind: 'channel', frac: 1, index: i, label: montage.channels[i].label, isEcg: g === 'ecg' });
    lastGroup = g;
  }
  return rows;
}

/**
 * Right-side per-channel spectral panel.
 *
 * One horizontal strip per EEG channel, aligned to its trace on the left. Each
 * strip shows the five clinical bands as sideways bars anchored at the right edge
 * and growing left, coloured by the shared `FFT_BANDS` palette so the legend, this
 * panel, and the bottom FFT panel all speak the same colour language.
 *
 * The strip column fills the whole panel height; the title, mode toggle and legend
 * are a *floating* overlay rather than a header in the layout flow. A header in the
 * flow would push every strip down by its own height and break the row-for-row
 * alignment with the traces — floating it keeps the strips full-height, and it can
 * be collapsed out of the way when it covers the top strips' bars.
 *
 * Normalisation (the toggle):
 *  - within  — each channel's bars are scaled to that channel's own strongest band,
 *    so every strip shows spectral SHAPE regardless of absolute amplitude.
 *  - across  — every bar is scaled to the single strongest band across all channels,
 *    so bar length is comparable BETWEEN channels. ECG is excluded from that global
 *    maximum: its QRS is an order of magnitude larger than any scalp rhythm and
 *    would otherwise flatten every EEG strip to a sliver. The ECG strip still draws,
 *    clamped at full width.
 */
export function RightSpectrumPanel({ dataBuffer, montage }: RightSpectrumPanelProps) {
  const [mode, setMode] = useState<NormalizeMode>('within');
  const [showHeader, setShowHeader] = useState(true);
  // powers[channelIndex] = [delta, theta, alpha, beta, gamma]
  const [powers, setPowers] = useState<number[][]>([]);
  const [highlighted, setHighlighted] = useState<Set<number>>(new Set());

  useEffect(() => {
    const update = () => setHighlighted(new Set(getHighlightState().clickedChannels));
    update();
    return subscribe(update);
  }, []);

  useEffect(() => {
    const recompute = () => {
      setPowers(montage.channels.map((_, i) => channelBandPowers(dataBuffer.current[i] ?? [])));
    };
    recompute();
    const interval = setInterval(recompute, 250);
    return () => clearInterval(interval);
  }, [dataBuffer, montage]);

  const rows = buildRows(montage);

  // "across" denominator: the strongest band on any non-ECG channel, so scalp
  // rhythms stay comparable and are not dwarfed by cardiac amplitude. Falls back
  // to a tiny epsilon when the buffer is still empty.
  const globalMax = Math.max(
    1e-12,
    ...powers.filter((_, i) => montage.channels[i]?.group !== 'ecg').flat(),
  );

  return (
    <div className="h-full bg-[#1e2a1e] border-l border-[#2e4a2e] relative overflow-hidden text-slate-200">
      {/* Full-height strip column — absolutely positioned so no header steals row
          height and the strips align row-for-row with the traces. */}
      <div className="absolute inset-0 flex flex-col min-h-0">
        {rows.map((row, i) => {
          if (row.kind === 'gap') {
            return <div key={`gap-${i}`} style={{ flexGrow: row.frac }} className="min-h-0" />;
          }
          const p = powers[row.index] ?? FFT_BANDS.map(() => 0);
          const scale = mode === 'within' ? Math.max(1e-12, ...p) : globalMax;
          const isHi = highlighted.has(row.index);
          return (
            <div
              key={`ch-${row.index}`}
              style={{ flexGrow: row.frac }}
              className={`flex items-center gap-1 px-1 min-h-0 ${isHi ? 'bg-emerald-500/10' : ''}`}
            >
              <span
                className={`w-12 shrink-0 text-[9px] leading-none text-right truncate ${
                  isHi ? 'text-emerald-300' : 'text-slate-500'
                }`}
                title={row.label}
              >
                {row.label}
              </span>
              {/* Bars grow leftward from the right edge (the base). */}
              <div className="flex-1 flex flex-col justify-center gap-px min-w-0">
                {FFT_BANDS.map((b, bi) => (
                  <div key={b.key} className="flex flex-row-reverse h-[3px] w-full">
                    <div
                      style={{
                        width: `${Math.min(100, (p[bi] / scale) * 100)}%`,
                        backgroundColor: b.color,
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating controls — overlaid, collapsible, so they never displace strips. */}
      {showHeader ? (
        <div className="absolute top-1 right-1 z-10 bg-[#16211680] backdrop-blur-sm border border-[#2e4a2e] rounded shadow-lg px-2 py-1.5 max-w-[85%]">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="text-xs font-bold text-emerald-400 whitespace-nowrap">Per-channel bands</h3>
            <div className="flex items-center gap-1">
              <div className="flex rounded overflow-hidden border border-slate-700 text-[10px]">
                <button
                  onClick={() => setMode('within')}
                  title="Scale each channel to its own strongest band (compare spectral shape)"
                  className={`px-1.5 py-0.5 transition-colors ${
                    mode === 'within' ? 'bg-emerald-800/50 text-emerald-200' : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  Per signal
                </button>
                <button
                  onClick={() => setMode('across')}
                  title="Scale every channel to one global maximum, excluding ECG (compare power between channels)"
                  className={`px-1.5 py-0.5 transition-colors border-l border-slate-700 ${
                    mode === 'across' ? 'bg-emerald-800/50 text-emerald-200' : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  All signals
                </button>
              </div>
              <button
                onClick={() => setShowHeader(false)}
                title="Hide this overlay"
                className="text-slate-400 hover:text-slate-200 text-xs leading-none px-1"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
            {FFT_BANDS.map(b => (
              <span key={b.key} className="flex items-center gap-1 text-[9px] text-slate-400">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: b.color }} />
                {b.name.split(' ')[0]}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowHeader(true)}
          title="Show bands legend and scaling"
          className="absolute top-1 right-1 z-10 bg-[#16211680] backdrop-blur-sm border border-[#2e4a2e] rounded text-emerald-400 text-[10px] px-1.5 py-0.5 hover:bg-slate-800"
        >
          bands ▾
        </button>
      )}
    </div>
  );
}

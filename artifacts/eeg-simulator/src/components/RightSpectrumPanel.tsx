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
    <div className="h-full bg-ui-root border-l border-ui-sep relative overflow-hidden text-ui-text">
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
              className={`flex items-center gap-1 px-1 min-h-0 ${isHi ? 'bg-ui-accent/12' : ''}`}
            >
              <span
                className={`w-12 shrink-0 text-[9px] leading-none text-right truncate ${
                  isHi ? 'text-ui-accent font-semibold' : 'text-ui-text-2'
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
        <div className="ui-material absolute top-1.5 right-1.5 z-10 border border-ui-sep rounded-[12px] shadow-[var(--ui-shadow)] px-2.5 py-2 max-w-[90%]">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="text-[12px] font-semibold text-ui-text whitespace-nowrap">Per-channel bands</h3>
            <div className="flex items-center gap-1">
              <div className="flex rounded-[8px] bg-ui-fill p-[2px] gap-[2px] text-[11px]">
                <button
                  onClick={() => setMode('within')}
                  title="Scale each channel to its own strongest band (compare spectral shape)"
                  className={`px-2 h-6 pointer-coarse:h-8 rounded-[6px] font-medium transition-colors ${
                    mode === 'within' ? 'bg-ui-thumb text-ui-text shadow-sm' : 'text-ui-text-2 hover:text-ui-text'
                  }`}
                >
                  Per signal
                </button>
                <button
                  onClick={() => setMode('across')}
                  title="Scale every channel to one global maximum, excluding ECG (compare power between channels)"
                  className={`px-2 h-6 pointer-coarse:h-8 rounded-[6px] font-medium transition-colors ${
                    mode === 'across' ? 'bg-ui-thumb text-ui-text shadow-sm' : 'text-ui-text-2 hover:text-ui-text'
                  }`}
                >
                  All signals
                </button>
              </div>
              <button
                onClick={() => setShowHeader(false)}
                title="Hide this overlay"
                aria-label="Hide this overlay"
                className="grid place-items-center w-6 h-6 pointer-coarse:w-9 pointer-coarse:h-9 rounded-full text-ui-text-2 hover:bg-ui-fill text-xs leading-none"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
            {FFT_BANDS.map(b => (
              <span key={b.key} className="flex items-center gap-1 text-[10px] text-ui-text-2">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: b.color }} />
                {b.name.split(' ')[0]}
              </span>
            ))}
          </div>
          {/* The strips have no axis, so say what a bar's length is: a ratio of band
              powers (µV², utils/fftBands.ts) — unitless, 0 to 1 across the strip. */}
          <div className="text-[10px] text-ui-text-2 mt-1">
            {mode === 'within'
              ? "bar = band power ÷ this channel's strongest band"
              : 'bar = band power ÷ strongest band on any channel (ECG excluded)'}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowHeader(true)}
          title="Show bands legend and scaling"
          className="ui-material absolute top-1.5 right-1.5 z-10 border border-ui-sep rounded-full text-ui-accent text-[11px] font-medium px-2.5 h-7 pointer-coarse:h-9"
        >
          bands ▾
        </button>
      )}
    </div>
  );
}

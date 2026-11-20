import type { Montage } from '../utils/montages';

/** The canvas's rows: one band per channel, with a gap between chain groups. */

export const GAP_UNITS = 0.40; // fractional row-height gap between chain groups

export type RowLayout = {
  channelIndex: number;  // -1 = spacer
  centerFrac: number;
  rowFrac: number;
};

export function buildLayout(montage: Montage): RowLayout[] {
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
export function getChannelAtY(layout: RowLayout[], y: number, h: number): number | null {
  for (const row of layout) {
    if (row.channelIndex < 0) continue;
    const top    = (row.centerFrac - row.rowFrac / 2) * h;
    const bottom = (row.centerFrac + row.rowFrac / 2) * h;
    if (y >= top && y < bottom) return row.channelIndex;
  }
  return null;
}

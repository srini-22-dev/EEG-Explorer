import type { Montage } from './montages';
import { commonAverage, computeChannelVoltage } from './computeChannel';

/**
 * Which rows of a montage an annotation arrow goes on.
 *
 * An artifact is rarely on one row: a blink is on all four frontopolar rows, a
 * lateral eye movement on both temporal chains, muscle wherever the muscle is.
 * Every row it is plainly on gets an arrow — every row carrying at least
 * MARK_ROW_SHARE of what its largest row carries, and of those the largest
 * MARK_MAX_ROWS, so that something on the whole head (a K-complex) is pointed at
 * where it is largest rather than on every line of the page. The sizes come from
 * the artifact's own scalp field put through the same channel arithmetic as the
 * trace, so they follow the montage.
 *
 * The display and the gate (validateEngine, "Annotation arrows") both call this,
 * so what is asserted is what is drawn.
 */
export const MARK_ROW_SHARE = 0.35;
export const MARK_MAX_ROWS = 10;
/** An artifact given in microvolts is not pointed at on a row where it is under this many mm. */
export const MARK_MIN_MM = 1;

type Field = Readonly<Record<string, number>>;

/**
 * The artifact's size on each channel of the montage. `fields` are its
 * independent parts (see ArtifactMark): they do not cancel one another on a row,
 * so each goes through the montage on its own and the sizes add.
 */
export function markRowSizes(fields: readonly Field[], montage: Montage): number[] {
  const sizes = montage.channels.map(() => 0);
  for (const f of fields) {
    const field = f as Record<string, number>;
    const avg = commonAverage(field);
    montage.channels.forEach((ch, c) => {
      if (ch.active === 'ECG') return;
      sizes[c] += Math.abs(computeChannelVoltage(ch, 0, field, avg)) || 0;
    });
  }
  return sizes;
}

/**
 * The channels that get an arrow, in montage order. Pass `uvPerMm` when the sizes
 * are in microvolts: rows where the artifact is under a millimetre are then left
 * out, and if that is all of them the largest row alone is kept, so the artifact
 * is still pointed at once.
 *
 * `maxRows` is MARK_MAX_ROWS for arrows. A box passes Infinity: it is drawn once
 * per chain block, so it does not crowd the page the way ten arrows would, and with
 * the cap a generalized pattern (GPDs, on every chain) was boxed on three chains of
 * five (2026-10-23).
 */
export function markRows(sizes: readonly number[], uvPerMm?: number, maxRows = MARK_MAX_ROWS): number[] {
  const largest = Math.max(0, ...sizes);
  if (!(largest > 0)) return [];
  const visible = uvPerMm != null ? Math.min(largest, MARK_MIN_MM * uvPerMm) : 0;
  const floor = Math.max(MARK_ROW_SHARE * largest, visible);
  return sizes.map((_, c) => c).filter(c => sizes[c] >= floor)
    .sort((a, b) => sizes[b] - sizes[a]).slice(0, maxRows).sort((a, b) => a - b);
}

/**
 * Which way one source moves each channel: the sign of its field there, +1 or -1,
 * and 0 for an artifact made of several independent sources (no one direction
 * holds for those). The display uses it so that every arrow of one event points
 * at the swing the field predicts on its row, rather than at whatever swing on
 * that row happens to be largest.
 */
export function markRowSigns(fields: readonly Field[], montage: Montage): number[] {
  if (fields.length !== 1) return montage.channels.map(() => 0);
  const field = fields[0] as Record<string, number>;
  const avg = commonAverage(field);
  return montage.channels.map((ch) =>
    (ch.active === 'ECG' ? 0 : Math.sign(computeChannelVoltage(ch, 0, field, avg)) || 0));
}

/**
 * The channels an event with extent is on, one block per chain (`ch.group`): the
 * display draws a box around each block, from its first selected row to its last,
 * rather than one box over every row between the top of the page and the bottom.
 */
export function markBlocks(channels: readonly number[], montage: Montage): number[][] {
  const byGroup = new Map<string, number[]>();
  for (const c of channels) {
    const g = montage.channels[c].group;
    byGroup.set(g, [...(byGroup.get(g) ?? []), c]);
  }
  return [...byGroup.values()];
}

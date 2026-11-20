/**
 * The annotation marks the engine reports with each sample (`GroundTruth.marks`),
 * and the bookkeeping for the two kinds an artifact makes: an event with a
 * beginning (`mark`) and a presence with no events (`markWhile`).
 */

/**
 * One artifact (or sleep graphoelement) event, as the display needs it in order to
 * point at it: the toggle it belongs to, its own field — how large it is at each
 * electrode, signed, in relative units — and how long after this sample its
 * deflection is still developing. The display puts the field through the current
 * montage with the same arithmetic it draws the trace with (utils/markRows.ts),
 * and puts an arrow on every row where the artifact is large, at that row's
 * largest excursion inside the window. `dur` is 0 for something with no peak to
 * find: the arrow points at the row at that moment.
 *
 * `fields` is a list because some artifacts are several independent sources — the
 * four muscles, a spindle's generators. Those do not cancel one another on a row,
 * so each is put through the montage on its own and the sizes added; summed into
 * one field first, a spindle's arrows landed on rows it was not on. `inUv` says
 * the fields are in microvolts at the artifact's peak, for the two artifacts that
 * can be under a millimetre (ECG, mains): the display then leaves out the rows
 * where there is nothing to see. `ago` is how many seconds before the sample it
 * comes with the mark's time is; negative for a mark a generator reports ahead,
 * at an event's onset, for a part of it still to be drawn (PatternMarkEvent.at).
 *
 * `span` makes the mark a box instead of an arrow: an event with extent — a
 * spindle, a train of POSTS, a run of vertex waves, a chewing episode, a
 * seizure's phase — drawn from `t` to `t + span` around the rows it is on. A box
 * for a pattern with no end yet (`openBox`) has `span` Infinity and a `key`; when
 * the pattern stops, a mark with the same `key` comes with the length it had, and
 * closes it. `page` puts the box around every row (a pattern acting on the whole
 * background), and then `fields` is empty.
 *
 * It carried a short list of electrodes until 2026-10-13, and the display pointed
 * at the first row recording one of them: one arrow for a blink that is on four
 * rows, and on some montages not the row the artifact was largest on.
 */
export type ArtifactMark = {
  id: string; label?: string; fields: MarkFields; inUv?: boolean; dur: number; ago?: number; span?: number;
  key?: string; page?: boolean;
};
export type MarkFields = readonly Readonly<Record<string, number>>[];
// The fields of a mark on the whole page (`ArtifactMark.page`): none, and always this one.
export const NO_FIELDS: MarkFields = [];

/** Rising-edge and open-box bookkeeping for marks, on the engine's sample clock. */
export class MarkBook {
  private markState = new Map<string, { on: boolean; last: number; seen: number }>();
  // The boxes of the engine's own continuous artifacts while they are open (see markWhile).
  private openWhile = new Map<string, { key: string; fields: MarkFields }>();

  constructor(
    private readonly dt: number,
    /** The engine's sample index now. */
    private readonly now: () => number,
    /** Report a mark with this sample. */
    readonly push: (m: ArtifactMark) => void,
  ) {}

  private markStateOf(id: string) {
    let s = this.markState.get(id);
    if (!s) { s = { on: false, last: -Infinity, seen: -Infinity }; this.markState.set(id, s); }
    return s;
  }

  /**
   * An artifact that has a beginning: report its rising edge, at most once per
   * `minGapS`. It has not ended until it has been quiet for `holdS`. `key` keeps
   * separate track of sources that share an id.
   */
  mark(
    id: string, active: boolean, fields: MarkFields, dur: number,
    opt: { minGapS?: number; holdS?: number; label?: string; inUv?: boolean; key?: string } = {},
  ) {
    const s = this.markStateOf(opt.key ?? id);
    const now = this.now();
    if (active) s.seen = now;
    else if (opt.holdS != null && (now - s.seen) * this.dt < opt.holdS) active = true;
    if (active && !s.on && (now - s.last) * this.dt >= (opt.minGapS ?? 0)) {
      this.push({ id, label: opt.label, fields, inUv: opt.inUv, dur });
      s.last = now;
    }
    s.on = active;
  }

  /**
   * Something with no events, only a presence (a continuous artifact, the eyes held
   * open): a box opened as it starts (span Infinity) and closed with its length as it
   * stops — and closed and opened again if the rows it is on change (another muscle).
   */
  markWhile(id: string, on: boolean, fields: MarkFields, opt: { label?: string; inUv?: boolean; page?: boolean } = {}) {
    const name = `${id}:${opt.label ?? ''}`;
    const open = this.openWhile.get(name);
    const base = { id, label: opt.label, inUv: opt.inUv, page: opt.page, dur: 0 };
    if (open && (!on || open.fields !== fields)) {
      this.push({ ...base, fields: open.fields, span: 0, key: open.key });
      this.openWhile.delete(name);
    }
    if (on && !this.openWhile.has(name)) {
      const key = `${name}@${this.now()}`;
      this.openWhile.set(name, { key, fields });
      this.push({ ...base, fields, span: Infinity, key });
    }
  }
}

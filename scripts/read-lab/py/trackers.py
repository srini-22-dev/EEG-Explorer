"""Candidate trace-following methods, for scoring against ground truth.

The question: when traces cross, which reading strategy recovers the right
per-row path? Each function returns ys[row][x] in pixels.
"""
import numpy as np


def _runs(I, x):
    col = np.nonzero(I[:, x])[0]
    out = []
    for y in col:
        if out and y - out[-1][-1] <= 1:
            out[-1].append(y)
        else:
            out.append([y])
    return [(float(np.mean(r)), len(r), r[0], r[-1]) for r in out]


# ── A. order-based: match runs to rows top-to-bottom (the naive reader) ───────
def track_order(I, baselines, pitch):
    H, W = I.shape
    n = len(baselines)
    ys = np.full((n, W), np.nan)
    for x in range(W):
        r = _runs(I, x)
        if len(r) == n:
            for i in range(n):
                ys[i, x] = r[i][0]
    for i in range(n):
        ys[i] = _fill(ys[i], baselines[i])
    return ys


# ── B. nearest-to-previous (continuity only) ─────────────────────────────────
def track_nearest(I, baselines, pitch, lim=0.95):
    H, W = I.shape
    n = len(baselines)
    ys = np.full((n, W), np.nan)
    for i, b in enumerate(baselines):
        prev = b
        for x in range(W):
            cands = [c[0] for c in _runs(I, x) if abs(c[0] - b) <= lim * pitch]
            if not cands:
                ys[i, x] = prev
                continue
            pick = min(cands, key=lambda c: abs(c - prev))
            ys[i, x] = pick
            prev = pick
    return ys


# ── C. velocity-aware: predict by linear extrapolation, not last value ───────
def track_velocity(I, baselines, pitch, lim=3.0):
    """A fast-moving trace keeps moving fast, so it can be followed THROUGH a
    slow one. Prediction = prev + (prev - prev2), clipped."""
    H, W = I.shape
    n = len(baselines)
    ys = np.full((n, W), np.nan)
    for i, b in enumerate(baselines):
        prev, prev2 = b, b
        for x in range(W):
            pred = prev + np.clip(prev - prev2, -0.35 * pitch, 0.35 * pitch)
            cands = [c[0] for c in _runs(I, x) if abs(c[0] - b) <= lim * pitch]
            if not cands:
                ys[i, x] = prev
                prev2, prev = prev, prev
                continue
            pick = min(cands, key=lambda c: abs(c - pred))
            ys[i, x] = pick
            prev2, prev = prev, pick
    return ys


# ── D. peeling: confident rows first, remove their ink, attribute residual ───
def track_peel(I, baselines, pitch, quiet_lim=0.55, loose_lim=3.5):
    """The reader's method: isolate the rows you can see clearly, take them out,
    and whatever deep excursion is left must belong to the row that remains."""
    H, W = I.shape
    n = len(baselines)
    work = I.copy()
    ys = np.full((n, W), np.nan)

    # quietness: fraction of columns with exactly one run inside a tight band
    quiet = []
    for i, b in enumerate(baselines):
        c = 0
        for x in range(0, W, 3):
            k = [r for r in _runs(work, x) if abs(r[0] - b) <= quiet_lim * pitch]
            if len(k) == 1:
                c += 1
        quiet.append(c / max(1, len(range(0, W, 3))))
    order = list(np.argsort(quiet)[::-1])          # most confident first

    for i in order:
        b = baselines[i]
        lim = quiet_lim if quiet[i] > 0.8 else loose_lim
        prev, prev2 = b, b
        path = np.full(W, np.nan)
        for x in range(W):
            pred = prev + np.clip(prev - prev2, -0.35 * pitch, 0.35 * pitch)
            cands = [c[0] for c in _runs(work, x) if abs(c[0] - b) <= lim * pitch]
            if not cands:
                path[x] = prev
                prev2 = prev
                continue
            pick = min(cands, key=lambda c: abs(c - pred))
            path[x] = pick
            prev2, prev = prev, pick
        ys[i] = path
        # erase this trace so later (harder) rows see less ink
        for x in range(W):
            y = int(round(path[x]))
            work[max(0, y - 1):min(H, y + 2), x] = False
    return ys


def _fill(a, default):
    idx = np.arange(len(a))
    ok = ~np.isnan(a)
    if ok.sum() == 0:
        return np.full(len(a), default)
    return np.interp(idx, idx[ok], a[ok])


# ── E. peel-and-eliminate: the reader's procedure, done properly ─────────────
def track_peel2(I, baselines, pitch, tight=0.95, loose=4.0, sat_frac=0.02):
    """1. Track every row with a TIGHT limit. Rows that never press against it
          are trustworthy (validated: rows 2-4 recover to ~0.02 row-heights).
       2. Flag rows that DO press against it — they are excursions the tight
          limit is clipping, i.e. the plungers.
       3. Erase the trusted rows' ink.
       4. Re-track only the plungers on the residual, with a generous limit and
          velocity prediction. With the quiet traces gone, the steep stroke is
          the only thing left to follow.
    """
    H, W = I.shape
    n = len(baselines)
    first = track_nearest(I, baselines, pitch, lim=tight)

    sat = []
    for i in range(n):
        d = np.abs(first[i] - baselines[i])
        sat.append((d > 0.9 * tight * pitch).mean())
    plunger = [i for i in range(n) if sat[i] > sat_frac]
    trusted = [i for i in range(n) if i not in plunger]

    work = I.copy()
    for i in trusted:
        for x in range(W):
            y = int(round(first[i][x]))
            work[max(0, y - 2):min(H, y + 3), x] = False

    ys = first.copy()
    for i in plunger:
        b = baselines[i]
        prev, prev2 = b, b
        for x in range(W):
            pred = prev + np.clip(prev - prev2, -0.5 * pitch, 0.5 * pitch)
            cands = [c[0] for c in _runs(work, x) if abs(c[0] - b) <= loose * pitch]
            if not cands:
                ys[i, x] = prev
                prev2 = prev
                continue
            pick = min(cands, key=lambda c: abs(c - pred))
            ys[i, x] = pick
            prev2, prev = prev, pick
    return ys, plunger, trusted


# ── F. segment-first: reconstruct out of order, anchors before gaps ──────────
def track_segments(I, baselines, pitch, conf_lim=0.6):
    """Do not read left to right.

    1. Find every column where a row is UNAMBIGUOUS — exactly one ink run within
       `conf_lim` of its baseline, and that row is the nearest row to it. There
       attribution is certain and needs no tracking at all.
    2. Those columns are anchors. Ambiguous spans sit BETWEEN two anchors, so
       they are constrained from both sides rather than extrapolated from one.
    3. Fill each span by two-sided interpolation, then snap to real ink where
       ink exists that the interpolation passes near.

    Sequential tracking propagates a single bad pick forever; this cannot,
    because every confident column is fixed independently of its neighbours.
    """
    H, W = I.shape
    n = len(baselines)
    ys = np.full((n, W), np.nan)
    conf = np.zeros((n, W), dtype=bool)
    B = np.asarray(baselines, float)

    for x in range(W):
        r = [c[0] for c in _runs(I, x)]
        if not r:
            continue
        r = np.array(r)
        for i in range(n):
            d = np.abs(r - B[i])
            j = int(np.argmin(d))
            if d[j] > conf_lim * pitch:
                continue
            # the run must belong to THIS row more than to any other
            if int(np.argmin(np.abs(B - r[j]))) != i:
                continue
            if np.sum(d <= conf_lim * pitch) != 1:
                continue
            ys[i, x] = r[j]
            conf[i, x] = True

    for i in range(n):
        idx = np.nonzero(conf[i])[0]
        if len(idx) < 2:
            ys[i] = B[i]
            continue
        ys[i] = np.interp(np.arange(W), idx, ys[i][idx])
        # inside each gap, snap to the nearest real ink to the interpolation
        gaps = np.nonzero(~conf[i])[0]
        for x in gaps:
            if x < idx[0] or x > idx[-1]:
                continue
            r = [c[0] for c in _runs(I, x)]
            if not r:
                continue
            r = np.array(r)
            j = int(np.argmin(np.abs(r - ys[i, x])))
            if abs(r[j] - ys[i, x]) <= 0.9 * pitch:
                ys[i, x] = r[j]
    return ys, conf


# ── G. segments + elimination inside the gaps ───────────────────────────────
def track_hybrid(I, baselines, pitch, conf_lim=0.6, max_gap_rows=4.0):
    """Combine the two readings that a person actually uses.

    Out of order first: every column where a row is unambiguous is fixed
    independently, so no error can propagate (method F). Then, only inside the
    ambiguous spans, erase the rows that ARE known there and follow the residual
    inward from the anchor on each side (method E's elimination). The span is
    bounded on both sides, so the excursion is reconstructed rather than
    interpolated flat.
    """
    H, W = I.shape
    n = len(baselines)
    ys, conf = track_segments(I, baselines, pitch, conf_lim)

    # Resolve DEEPEST FIRST. Where two rows cross, both are ambiguous at once,
    # so eliminating for the shallower one before the deeper one is known just
    # drags it onto the deeper one's stroke. Ordering by entry displacement is
    # the same peeling logic, applied inside the gap.
    # Rank by ENTRY SPEED into the ambiguous spans, not by the interpolated
    # depth: interpolation flattens the plunger, so depth ranks it too LOW
    # (measured: the plunger read 0.5 rows where the row it crossed read 0.69,
    # so depth-ordering processed them backwards). The steep stroke is the cue a
    # reader uses, and it survives the flattening.
    speed = []
    for i in range(n):
        v = 0.0
        for a, b in _spans(~conf[i]):
            if a == 0 or b >= W - 1:
                continue
            v = max(v, abs(ys[i, a - 1] - ys[i, max(0, a - 6)]) / 5.0,
                    abs(ys[i, min(W - 1, b + 6)] - ys[i, b + 1]) / 5.0)
        speed.append(v)
    for i in sorted(range(n), key=lambda k: -speed[k]):
        gaps = _spans(~conf[i])
        for a, b in gaps:
            if a == 0 or b >= W - 1:
                continue
            # ink with every OTHER row's known path removed
            work = I[:, a:b + 1].copy()
            for k in range(n):
                if k == i:
                    continue
                for x in range(a, b + 1):
                    y = int(round(ys[k, x]))
                    work[max(0, y - 2):min(H, y + 3), x - a] = False
            yL, yR = ys[i, a - 1], ys[i, b + 1]
            # GATE: only a row that enters the gap already displaced, or moving
            # fast, can be the one making a deep excursion inside it. A quiet row
            # enters flat and near its baseline; running elimination on its tiny
            # gaps just drags it onto a neighbour's ink.
            disp = max(abs(yL - baselines[i]), abs(yR - baselines[i]))
            vL = abs(ys[i, a - 1] - ys[i, max(0, a - 6)]) / 5.0
            vR = abs(ys[i, min(W - 1, b + 6)] - ys[i, b + 1]) / 5.0
            if disp < 0.5 * pitch and max(vL, vR) < 0.08 * pitch:
                continue
            best = None
            for x in range(work.shape[1]):
                col = np.nonzero(work[:, x])[0]
                if not len(col):
                    continue
                near = col[np.abs(col - np.interp(x, [0, work.shape[1] - 1], [yL, yR]))
                           <= max_gap_rows * pitch]
                if not len(near):
                    continue
                far = near[np.argmax(np.abs(near - (yL + yR) / 2))]
                if best is None or abs(far - (yL + yR) / 2) > abs(best[1] - (yL + yR) / 2):
                    best = (x, float(far))
            if best is not None:
                # re-shape the span as a peak through the recovered extremum
                xs = np.array([0, best[0], work.shape[1] - 1])
                vs = np.array([yL, best[1], yR])
                ys[i, a:b + 1] = np.interp(np.arange(work.shape[1]), xs, vs)
    return ys, conf


def _spans(mask):
    out = []
    x = 0
    while x < len(mask):
        if mask[x]:
            j = x
            while j < len(mask) and mask[j]:
                j += 1
            out.append((x, j - 1)); x = j
        else:
            x += 1
    return out

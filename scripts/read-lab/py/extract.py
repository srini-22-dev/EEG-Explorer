"""Trace extraction from a clinical EEG page image.

Scratch investigation instrument. Recovers, per row, y(t) in row-height units,
with an ambiguity mask where traces cross.
"""
from PIL import Image
import numpy as np


def load_ink(path, keep_coloured=False):
    """Dark pixels = trace ink.

    By default coloured pixels are rejected, because published figures carry red
    ECG rows and coloured annotation boxes over black traces. The app's own page is
    the opposite case: it draws each chain in its group colour (blue #1a4fa0, red
    #8b1a1a), so with the default this reader sees ~0.6% ink on an app page against
    ~4.7% on a clinical one — 16 of 18 rows invisible. Pass keep_coloured=True for
    app renders.
    """
    a = np.asarray(Image.open(path).convert('RGB')).astype(int)
    H, W, _ = a.shape
    v = a.sum(axis=2)
    if keep_coloured:
        return v < 420, H, W
    sat = (a.max(axis=2) - a.min(axis=2)) > 45
    ink = (v < 420) & (~sat)          # dark, non-coloured = EEG trace
    return ink, H, W


def grid_period(ink_or_path, lblw=0, path=None):
    a = np.asarray(Image.open(path).convert('RGB')).astype(int)
    H, W, _ = a.shape
    v = a.sum(axis=2)
    prof = ((v > 500) & (v < 700)).sum(axis=0).astype(float)[lblw:]
    prof -= prof.mean()
    if prof.std() == 0:
        return None
    ac = np.correlate(prof, prof, mode='full')[len(prof) - 1:]
    ac /= ac[0]
    for lag in range(8, min(400, len(ac) - 1)):
        if ac[lag] > ac[lag - 1] and ac[lag] >= ac[lag + 1] and ac[lag] > 0.25:
            return lag
    return None


def comb_fit(ink, H, groups, lblw=0, pmin=12, pmax=120):
    prof = ink[:, lblw:].sum(axis=1).astype(float)
    n = sum(groups)
    best = None
    for pitch in np.arange(pmin, pmax, 0.25):
        for gap in np.arange(0, 1.51, 0.05):
            span = (n - 1 + (len(groups) - 1) * gap) * pitch
            if span > H - 4:
                continue
            offs, cum = [], 0
            for g in groups:
                for _ in range(g):
                    offs.append(cum); cum += 1
                cum += gap
            offs = np.array(offs) * pitch
            for y0 in np.arange(2, H - span - 2, 1.0):
                ys = (y0 + offs).astype(int)
                sc = prof[ys].sum()
                if best is None or sc > best[0]:
                    best = (sc, y0, pitch, gap, y0 + offs)
    return best


LIM_ROWS = 4.0   # a row may stray this many row-heights from its baseline.
# Was 0.95, which silently CLIPPED every deflection larger than one row-height —
# reference eye blinks run ~3.5 rows, so they were truncated to ~1.0 and then
# compared against engine values also sitting on the clip. A limit must be wider
# than the largest feature being measured, or it becomes the measurement.


def track_rows(ink, baselines, pitch, x0=0):
    """Continuity-tracked trace following. Returns y[row][x] and an ambiguity mask."""
    H, W = ink.shape
    nR = len(baselines)
    ys = np.full((nR, W), np.nan)
    amb = np.zeros((nR, W), dtype=bool)
    lim = pitch * LIM_ROWS       # how far a row may stray from its own baseline
    jump = max(3.0, pitch * 0.35)  # max per-column move
    for r, b in enumerate(baselines):
        prev = b
        for x in range(x0, W):
            col = np.nonzero(ink[:, x])[0]
            if len(col) == 0:
                amb[r, x] = True
                ys[r, x] = prev
                continue
            cand = col[np.abs(col - b) <= lim]
            if len(cand) == 0:
                amb[r, x] = True
                ys[r, x] = prev
                continue
            near = cand[np.abs(cand - prev) <= jump]
            if len(near) == 0:
                amb[r, x] = True
                pick = cand[np.argmin(np.abs(cand - prev))]
            else:
                # contiguous run containing the pick -> take its centre
                pick = near[np.argmin(np.abs(near - prev))]
                run = [pick]
                for d in (-1, 1):
                    y = pick + d
                    while y in set(near.tolist()):
                        run.append(y); y += d
                pick = float(np.mean(run))
                if len(run) > pitch * 0.5:
                    amb[r, x] = True
            ys[r, x] = pick
            prev = pick
    return ys, amb

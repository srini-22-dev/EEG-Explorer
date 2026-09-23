"""Gap reconstructors, compared on IDENTICAL anchors.

track_segments fixes every unambiguous column. What remains is spans bounded by
a known y on each side. The question this file answers: given those anchors and
the ink inside the span, how do you recover the trace?

Linear interpolation is the baseline and is the only one here that ignores the
ink entirely.
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
    return [(float(np.mean(r)), r[0], r[-1]) for r in out]


def _spans(mask):
    out, x = [], 0
    while x < len(mask):
        if mask[x]:
            j = x
            while j < len(mask) and mask[j]:
                j += 1
            out.append((x, j - 1)); x = j
        else:
            x += 1
    return out


# ── 1. linear interpolation (baseline; ignores the ink) ─────────────────────
def fill_interp(I, yL, yR, a, b, pitch, **kw):
    return np.interp(np.arange(a, b + 1), [a - 1, b + 1], [yL, yR])


# ── 2. bidirectional continuation: follow ink inward from BOTH anchors ──────
def fill_bidir(I, yL, yR, a, b, pitch, **kw):
    """March right from the left anchor and left from the right anchor, each
    step taking the ink nearest a velocity prediction. Two independent
    reconstructions that must meet; take the more displaced at each column,
    since a trace hidden inside a merge is the one that went furthest."""
    H, W = I.shape
    n = b - a + 1
    fwd = np.full(n, np.nan); bwd = np.full(n, np.nan)
    prev, prev2 = yL, yL
    for k, x in enumerate(range(a, b + 1)):
        pred = prev + np.clip(prev - prev2, -0.6 * pitch, 0.6 * pitch)
        r = [c[0] for c in _runs(I, x)]
        if r:
            pick = min(r, key=lambda c: abs(c - pred))
            if abs(pick - pred) > 1.2 * pitch:
                pick = pred
        else:
            pick = pred
        fwd[k] = pick; prev2, prev = prev, pick
    prev, prev2 = yR, yR
    for k, x in enumerate(range(b, a - 1, -1)):
        pred = prev + np.clip(prev - prev2, -0.6 * pitch, 0.6 * pitch)
        r = [c[0] for c in _runs(I, x)]
        if r:
            pick = min(r, key=lambda c: abs(c - pred))
            if abs(pick - pred) > 1.2 * pitch:
                pick = pred
        else:
            pick = pred
        bwd[n - 1 - k] = pick; prev2, prev = prev, pick
    mid = (yL + yR) / 2.0
    out = np.where(np.abs(fwd - mid) >= np.abs(bwd - mid), fwd, bwd)
    return out


# ── 3. dynamic programming: min-cost path that stays ON ink ─────────────────
def fill_dp(I, yL, yR, a, b, pitch, off_pen=6.0, smooth=1.0, **kw):
    """Every column in the span still contains ink. Find the y(x) path from the
    left anchor to the right anchor minimising (off-ink penalty + curvature).
    Unlike interpolation this cannot cut a corner, because the corner is not ink."""
    H, W = I.shape
    lo = int(max(0, min(yL, yR) - 4.5 * pitch))
    hi = int(min(H, max(yL, yR) + 4.5 * pitch))
    ys = np.arange(lo, hi)
    n = b - a + 1
    if n <= 0 or len(ys) == 0:
        return np.array([])
    ink = I[lo:hi, a:b + 1].astype(float)
    unary = np.where(ink > 0, 0.0, off_pen)
    maxj = max(2, int(0.7 * pitch))
    cost = np.full((len(ys), n), np.inf)
    back = np.zeros((len(ys), n), dtype=int)
    start = int(np.clip(yL, lo, hi - 1)) - lo
    cost[:, 0] = unary[:, 0] + smooth * np.abs(ys - ys[start]) / pitch
    for k in range(1, n):
        for j in range(len(ys)):
            j0, j1 = max(0, j - maxj), min(len(ys), j + maxj + 1)
            seg = cost[j0:j1, k - 1] + smooth * np.abs(np.arange(j0, j1) - j) / pitch
            m = int(np.argmin(seg))
            cost[j, k] = seg[m] + unary[j, k]
            back[j, k] = j0 + m
    end = int(np.clip(yR, lo, hi - 1)) - lo
    j = int(np.argmin(cost[:, n - 1] + smooth * np.abs(ys - ys[end]) / pitch))
    path = np.zeros(n, dtype=int)
    for k in range(n - 1, -1, -1):
        path[k] = j; j = back[j, k]
    return ys[path].astype(float)


# ── 4. geodesic within the ink component touching the left anchor ───────────
def fill_component(I, yL, yR, a, b, pitch, **kw):
    """A drawn trace is a CONNECTED curve. Restrict to the ink component that
    the left anchor sits on, and take, per column, the pixel furthest from the
    straight line — the excursion the merge is hiding."""
    from scipy import ndimage
    H, W = I.shape
    lo = int(max(0, min(yL, yR) - 4.5 * pitch))
    hi = int(min(H, max(yL, yR) + 4.5 * pitch))
    sub = I[lo:hi, max(0, a - 2):b + 3]
    lab, _ = ndimage.label(sub, structure=np.ones((3, 3)))
    sy = int(np.clip(yL, lo, hi - 1)) - lo
    col0 = lab[:, 0] if a >= 2 else lab[:, 0]
    nz = np.nonzero(col0)[0]
    if len(nz) == 0:
        return fill_interp(I, yL, yR, a, b, pitch)
    comp = col0[nz[np.argmin(np.abs(nz - sy))]]
    n = b - a + 1
    base = np.interp(np.arange(n), [0, n - 1], [yL, yR])
    out = base.copy()
    off = 2 if a >= 2 else 0
    for k in range(n):
        c = k + off
        if c >= lab.shape[1]:
            break
        px = np.nonzero(lab[:, c] == comp)[0]
        if len(px) == 0:
            continue
        out[k] = px[np.argmax(np.abs(px + lo - base[k]))] + lo
    return out

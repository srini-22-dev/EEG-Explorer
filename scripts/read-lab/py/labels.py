"""Read the row structure OFF the image instead of assuming it.

Channel labels are printed at each row's baseline. Finding them gives the row
count, the baselines and — from the gap pattern — the chain-group structure,
with no montage hard-coded and no OCR engine required.
"""
import numpy as np
from scipy import ndimage


def label_rows(path, strip_frac=0.055, min_comp=3):
    """Returns (baselines, groups, diagnostics).

    Text is a cluster of character-sized connected components at a common y.
    Trace ink in the same strip is long and thin and gets filtered by size.
    """
    from PIL import Image
    a = np.asarray(Image.open(path).convert('RGB')).astype(int)
    H, W, _ = a.shape
    v = a.sum(axis=2)
    sat = (a.max(axis=2) - a.min(axis=2)) > 45
    dark = (v < 470) & (~sat)

    # Connected components on the WHOLE image. A trace is one long curve spanning
    # most of the width; a glyph is a tiny isolated blob. Rejecting anything wide
    # removes the traces outright, which a strip-crop + size filter does not.
    lab, n = ndimage.label(dark)
    if n == 0:
        return None, None, {'reason': 'no components'}
    objs = ndimage.find_objects(lab)
    comps = []
    for sl in objs:
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        if 3 <= h <= 18 and 1 <= w <= 18 and w < 0.06 * W:
            comps.append(((sl[0].start + sl[0].stop) / 2, (sl[1].start + sl[1].stop) / 2, h, w))
    if not comps:
        return None, None, {'reason': 'no glyph-sized components'}
    # keep only those in the leftmost text band: the densest narrow x-window
    xs = np.array([c[1] for c in comps])
    sw = max(30, int(W * strip_frac))
    best_x0, best_ct = 0, -1
    for x0 in range(0, min(int(0.25 * W), max(1, W - sw)), 5):
        ct = int(((xs >= x0) & (xs < x0 + sw)).sum())
        if ct > best_ct:
            best_ct, best_x0 = ct, x0
    comps = [c for c in comps if best_x0 <= c[1] < best_x0 + sw]
    if len(comps) < min_comp * 3:
        return None, None, {'reason': f'only {len(comps)} character-sized components'}

    ys = np.array([c[0] for c in comps])
    order = np.argsort(ys)
    ys = ys[order]

    # cluster components into text lines: a break when the y gap exceeds the
    # typical character height
    ch = np.median([c[2] for c in comps])
    clusters, cur = [], [ys[0]]
    for y in ys[1:]:
        if y - cur[-1] <= ch * 0.9:
            cur.append(y)
        else:
            clusters.append(cur); cur = [y]
    clusters.append(cur)
    rows = [(float(np.mean(c)), len(c)) for c in clusters if len(c) >= min_comp]
    if len(rows) < 3:
        return None, None, {'reason': f'only {len(rows)} label lines'}

    base = np.array([r[0] for r in rows])
    gaps = np.diff(base)
    med = float(np.median(gaps))
    # a chain break is a gap materially larger than the ordinary row pitch
    groups, run = [], 1
    for g in gaps:
        if g > med * 1.45:
            groups.append(run); run = 1
        else:
            run += 1
    groups.append(run)
    return base, groups, {'pitch': med, 'n_rows': len(base), 'n_comps': len(comps),
                          'gaps': np.round(gaps, 1)}

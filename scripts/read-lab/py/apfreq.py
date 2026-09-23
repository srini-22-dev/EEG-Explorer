"""The FREQUENCY half of the A-P gradient, read the same way from real and engine pages.

Two candidate metrics, each front row(s) against back row(s) of the same chain:
  centroid  power-weighted mean frequency over 2-30 Hz, front / back
  beta/alpha  (beta 13-30 / alpha 8-13 power) front, divided by the same at the back
Same tracer (segment-first), same spectrum, same rows on both sides (the symmetry rule).

    python apfreq.py
"""
import glob, json, os, sys
import numpy as np
from scipy.signal import welch as sp_welch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import extract as E
import trackers as T


def spec(y, pxps):
    y = np.nan_to_num(np.asarray(y, float) - np.nanmean(y))
    return sp_welch(y, fs=pxps, nperseg=int(min(len(y), 4 * pxps)))


def metrics(front, back, pxps):
    def cen(y):
        f, p = spec(y, pxps); m = (f >= 2) & (f <= 30); return (f[m] * p[m]).sum() / p[m].sum()
    def ba(y):
        f, p = spec(y, pxps); return p[(f >= 13) & (f <= 30)].sum() / p[(f >= 8) & (f < 13)].sum()
    c = np.mean([cen(y) for y in front]) / np.mean([cen(y) for y in back])
    b = np.mean([ba(y) for y in front]) / np.mean([ba(y) for y in back])
    return c, b


DB = ['Fp1-F3', 'F3-C3', 'C3-P3', 'P3-O1', 'Fp2-F4', 'F4-C4', 'C4-P4', 'P4-O2']
rows = []
# real: ap-gradient (one chain, anterior row 0 .. posterior row 3), 400 px/s
ink, H, W = E.load_ink(os.path.join(HERE, '..', 'corpus', 'online', 'ap-gradient.png'))
b = E.comb_fit(ink, H, [4], lblw=0, pmin=80, pmax=180)
ys, _ = T.track_segments(ink, list(b[4]), b[2])
rows.append(('learningeeg ap-gradient', *metrics([ys[0]], [ys[3]], 400.0)))
# real: term-alpha (double banana [4,4,4,4,2,2,2]), 135 px/s
ink, H, W = E.load_ink(os.path.join(HERE, '..', 'corpus', 'online', 'term-alpha.png'))
b = E.comb_fit(ink, H, [4, 4, 4, 4, 2, 2, 2], lblw=62, pmin=18, pmax=40)
ys, _ = T.track_segments(ink[:, 62:], list(b[4]), b[2])
rows.append(('learningeeg term-alpha', *metrics([ys[0], ys[4]], [ys[3], ys[7]], 135.0)))
# engine: awake clinical bipolar-ap pages, same rows
eng = []
for j in sorted(glob.glob(os.path.join(HERE, '..', 'corpus', 'engine', 'clinical_bipolar-ap_awake_*.json'))):
    t = json.load(open(j))
    ink, H, W = E.load_ink(os.path.join(os.path.dirname(j), t['file']))
    L = [r['label'] for r in t['rows']]
    ys, _ = T.track_segments(ink[:, int(t['labelStripPx']):], [r['baselineY'] for r in t['rows']], t['pitchPx'])
    fr = [ys[L.index('Fp1-F3')], ys[L.index('Fp2-F4')]]; bk = [ys[L.index('P3-O1')], ys[L.index('P4-O2')]]
    eng.append(metrics(fr, bk, t['pxPerSec']))
eng = np.array(eng)
print(f'{"page":<28} centroid front/back   beta/alpha front vs back')
for name, c, bb in rows:
    print(f'{name:<28} {c:8.3f}               {bb:8.2f}')
print(f'{"engine awake (n=%d)" % len(eng):<28} {eng[:,0].mean():8.3f} ± {eng[:,0].std():.3f}       {eng[:,1].mean():8.2f} ± {eng[:,1].std():.2f}')

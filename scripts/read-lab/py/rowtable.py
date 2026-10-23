"""The per-row table: one reader for a reference figure and an engine render alike.

CLAUDE.md §5 (verification discipline, rule 1) forbids "matches the reference" without a table:
every row, both sides, same estimator, same units. This is that estimator.

For every row of a page it reads, from the IMAGE:
  rel     1st-99th percentile peak-to-peak, divided by the page's median row — dimensionless, so an
          uncalibrated figure and an engine page can be compared (sensitivity is unrecoverable).
  share   power share of delta 0.5-4 / theta 4-8 / alpha 8-13 / beta 13-30 Hz in the traced row.
  adb     alpha peak height above the aperiodic fit, dB, and its frequency (pdr.alpha_peak).

Use:
  python rowtable.py read --img fig.png --labels Fp1-F3,... --groups 4,4,4,4,2,2,2 \
      --lblw 62 --pxps 111 [--win 100:700,900:1600] [--json out.json]
  python rowtable.py bench truth1.json [truth2.json ...]   # score against engine truth files
      (written by renderClinicalPage.ts --truth)

Bench before trusting a number from a figure (read skill: validate the reader on the engine's own
render). A quantity whose bench error is large is not reported from figures.
"""
import argparse, json, os, sys
import numpy as np
from scipy.signal import welch as sp_welch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import extract as E
import trackers as T
import pdr as P

BANDS = [('delta', 0.5, 4.0), ('theta', 4.0, 8.0), ('alpha', 8.0, 13.0), ('beta', 13.0, 30.0)]


def _windows(spec, lblw, W):
    if not spec:
        return [(lblw, W)]
    out = []
    for part in spec.split(','):
        a, b = part.split(':')
        out.append((max(lblw, int(a)), min(W, int(b))))
    return out


def read_page(img, labels, groups, lblw, pxps, windows=None, keep_coloured=False,
              pmin=15, pmax=45, baselines=None, pitch=None, norm_rows=None):
    ink, H, W = E.load_ink(img, keep_coloured=keep_coloured)
    if baselines is None:
        fit = E.comb_fit(ink, H, groups, lblw=lblw, pmin=pmin, pmax=pmax)
        pitch, baselines = fit[2], list(fit[4])
    ys, conf = T.track_segments(ink[:, lblw:], list(baselines), pitch)
    ys = np.asarray(ys, float)
    wins = windows or [(lblw, W)]
    rows = {}
    for i, lab in enumerate(labels):
        nper = int(2 * pxps)
        segs = [ys[i][a - lblw:b - lblw] for a, b in wins if b - a >= nper]
        allv = np.concatenate(segs)
        p2p = (np.nanpercentile(allv, 99) - np.nanpercentile(allv, 1)) / pitch
        pw = 0
        for s in segs:
            s0 = np.nan_to_num(s - np.nanmean(s))
            fr, p = sp_welch(s0, fs=pxps, nperseg=nper)          # forward + reversed: cover the tail,
            _, q = sp_welch(s0[::-1], fs=pxps, nperseg=nper)     # as the truth writer does
            pw = pw + (p + q) * len(s)
        half = (fr[1] - fr[0]) / 2   # bin centre within half a bin of the band: same rule as the truth writer
        inb = lambda lo, hi: (fr >= lo - half) & (fr < hi - half)
        tot = sum(pw[inb(lo, hi)].sum() for _, lo, hi in BANDS)
        share = {n: float(pw[inb(lo, hi)].sum() / tot) for n, lo, hi in BANDS}
        hz, db = P.alpha_peak(np.concatenate([np.nan_to_num(s - np.nanmean(s)) for s in segs]), pxps)
        rows[lab] = dict(p2p=float(p2p), share=share, adb=float(db), ahz=hz,
                         conf=float(conf[i][wins[0][0] - lblw:wins[0][1] - lblw].mean()))
    norm = [rows[l]['p2p'] for l in (norm_rows or labels) if l in rows]
    med = float(np.median(norm))
    for r in rows.values():
        r['rel'] = r['p2p'] / med
    return dict(pitch=float(pitch), occupancy=med, rows=rows)


def bench(files):
    errs = {'rel': [], 'delta': [], 'theta': [], 'alpha': [], 'beta': []}
    for fn in files:
        t = json.load(open(fn))
        rows = [r for r in t['rows'] if not r.get('ecg')]
        labels = [r['label'] for r in rows]
        res = read_page(t['file'], labels, None, int(t['labelStripPx']), float(t['pxPerSec']),
                        baselines=[r['baselineY'] for r in rows], pitch=float(t['pitchPx']))
        tmed = np.median([r['rowHeights'] for r in rows])
        occ = res['occupancy']
        for r in rows:
            got = res['rows'][r['label']]
            errs['rel'].append((got['rel'], r['rowHeights'] / tmed))
            for b in ('delta', 'theta', 'alpha', 'beta'):
                errs[b].append((got['share'][b], r['share'][b]))
        print(f"{os.path.basename(t['file'])}: occupancy read {occ:.2f} (truth median {tmed:.2f})")
    print('\nquantity   n    median |read-truth|   90th pct   bias (read-truth)')
    for k, v in errs.items():
        a = np.array(v)
        d = a[:, 0] - a[:, 1]
        print(f'{k:8s} {len(a):4d}   {np.median(np.abs(d)):10.3f}        {np.percentile(np.abs(d), 90):8.3f}   {d.mean():+.3f}')


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('read')
    r.add_argument('--img', required=True); r.add_argument('--labels', required=True)
    r.add_argument('--groups', required=True); r.add_argument('--lblw', type=int, required=True)
    r.add_argument('--pxps', type=float, required=True); r.add_argument('--win')
    r.add_argument('--pmin', type=float, default=15); r.add_argument('--pmax', type=float, default=45)
    r.add_argument('--coloured', action='store_true'); r.add_argument('--json')
    b = sub.add_parser('bench'); b.add_argument('files', nargs='+')
    a = ap.parse_args()
    if a.cmd == 'bench':
        return bench(a.files)
    from PIL import Image
    W = Image.open(a.img).size[0]
    labels = a.labels.split(',')
    res = read_page(a.img, labels, [int(g) for g in a.groups.split(',')], a.lblw, a.pxps,
                    windows=_windows(a.win, a.lblw, W), keep_coloured=a.coloured, pmin=a.pmin, pmax=a.pmax)
    print(f"pitch {res['pitch']:.1f}px  median row p2p {res['occupancy']:.2f} row-heights")
    print('row        rel   delta theta alpha  beta   alpha dB @ Hz   conf')
    for lab in labels:
        x = res['rows'][lab]; s = x['share']
        hz = f"{x['ahz']:.1f}" if x['ahz'] else '  - '
        print(f"{lab:9s} {x['rel']:5.2f}  {s['delta']:.2f}  {s['theta']:.2f}  {s['alpha']:.2f}  {s['beta']:.2f}   {x['adb']:5.1f} @ {hz}   {x['conf']:.2f}")
    if a.json:
        json.dump(res, open(a.json, 'w'), indent=1)


if __name__ == '__main__':
    main()

"""Score image-reading methods against engine pages whose answers are known.

Runs over corpus/engine/ (written by scripts/src/readCorpus.ts: one PNG + one truth
JSON per page) and reports, per renderer and state, mean ± sd with n:

  px/s        grid autocorrelation (extract.grid_period) against the page's px/s
  pitch       comb fit (extract.comb_fit) against the true baseline spacing
  row p2p     segment-first tracking (trackers.track_segments), p2p in row-heights,
              against the p2p of the samples actually drawn — binned by occupancy
  PDR         alpha peak read from the TRACED posterior rows (read_pdr) against the
              drawn row's own spectral peak, and its prominence against two negative
              controls: the frontopolar rows of the same page, and N2 pages
  A-P ratio   posterior / frontopolar p2p read from the image against the true ratio

Components are scored in isolation where the next stage depends on the previous
one: tracking and PDR use the TRUE label strip and px/s, so a bad grid estimate
cannot masquerade as a bad tracker. The end-to-end column says what a reader
with no truth at all would get.

    python bench.py                      # whole corpus
    python bench.py --limit 12           # first 12 pages, for a quick look
    python bench.py --renderer clinical
"""
import argparse, glob, json, os, sys
from multiprocessing import Pool
import numpy as np
from scipy.signal import welch as sp_welch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import extract as E
import trackers as T

CORPUS = os.path.join(HERE, '..', 'corpus', 'engine')


def groups_of(rows):
    g, out = None, []
    for r in rows:
        if r['group'] != g:
            out.append(0); g = r['group']
        out[-1] += 1
    return out


def is_posterior(label):
    a, _, b = label.partition('-')
    return a in ('O1', 'O2') or b in ('O1', 'O2')


def is_frontopolar(label):
    return label.split('-')[0] in ('Fp1', 'Fp2')


def read_pdr(y, px_per_sec):
    """Alpha peak of one traced row: welch on y(t), parabolic-interpolated peak in
    6-14 Hz, and its prominence = peak power / median power of the 4-6 and 15-20 Hz
    flanks. y is in pixels with +down; sign and scale do not matter to a spectrum."""
    y = np.asarray(y, float) - np.nanmean(y)
    y = np.nan_to_num(y)
    nper = int(min(len(y), 4 * px_per_sec))
    f, p = sp_welch(y, fs=px_per_sec, nperseg=nper)
    band = (f >= 6) & (f <= 14)
    k = np.nonzero(band)[0][np.argmax(p[band])]
    if 0 < k < len(p) - 1:
        a, b, c = np.log(p[k - 1] + 1e-12), np.log(p[k] + 1e-12), np.log(p[k + 1] + 1e-12)
        d = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0.0
        fk = f[k] + d * (f[1] - f[0])
    else:
        fk = f[k]
    flank = ((f >= 4) & (f < 6)) | ((f > 15) & (f <= 20))
    prom = p[k] / (np.median(p[flank]) + 1e-12)
    return float(fk), float(prom)


def score_page(jpath):
    t = json.load(open(jpath))
    png = os.path.join(os.path.dirname(jpath), t['file'])
    ink, H, W = E.load_ink(png, keep_coloured=(t['renderer'] == 'app'))
    lblw = int(round(t['labelStripPx']))
    rows = t['rows']
    out = dict(id=t['id'], renderer=t['renderer'], montage=t['montage'], state=t['state'])

    # px/s. The clinical page draws only 1 s rules, so the first grid period IS px/s.
    # The app page also draws a 5 mm minor grid, so its first period is px per 5 mm;
    # score it against that, and record which one the page actually offers.
    g = E.grid_period(None, lblw=lblw, path=png)
    expect = t['pxPerSec'] if t['renderer'] == 'clinical' else 5 * t['pxPerMm']
    out['grid_px'] = g
    out['grid_ok'] = g is not None and abs(g - expect) <= 1

    # pitch (comb fit), with the group structure as read off the labels
    best = E.comb_fit(ink, H, groups_of(rows), lblw=lblw,
                      pmin=max(8, 0.7 * t['pitchPx']), pmax=1.3 * t['pitchPx'])
    out['pitch_est'] = best[2]
    out['pitch_err_pct'] = 100 * (best[2] - t['pitchPx']) / t['pitchPx']

    # tracking on TRUE baselines (component test)
    B = [r['baselineY'] for r in rows]
    I = ink[:, lblw:]
    ys, conf = T.track_segments(I, B, t['pitchPx'])
    per_row = []
    for i, r in enumerate(rows):
        y = ys[i]
        p2p_px = np.percentile(y, 99) - np.percentile(y, 1)
        est_rh = p2p_px / t['pitchPx']
        f, prom = read_pdr(y, t['pxPerSec'])
        per_row.append(dict(label=r['label'], true_rh=r['p2pRowHeights'], est_rh=est_rh,
                            true_alpha=r['alphaPeakHz'], est_alpha=f, prom=prom,
                            conf=float(conf[i].mean()),
                            post=is_posterior(r['label']), fp=is_frontopolar(r['label'])))
    out['rows'] = per_row
    out['iaf'] = t['subject']['iaf']

    P = [r for r in per_row if r['post']]
    F = [r for r in per_row if r['fp']]
    if P and F:
        tr = sum(r['true_rh'] for r in P) / sum(r['true_rh'] for r in F)
        er = sum(r['est_rh'] for r in P) / sum(r['est_rh'] for r in F)
        out['ap_true'], out['ap_est'] = tr, er
    return out


def msd(xs):
    xs = [x for x in xs if x is not None and np.isfinite(x)]
    if not xs:
        return '   —'
    return f'{np.mean(xs):7.2f} ± {np.std(xs):5.2f} (n={len(xs)})'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--renderer', choices=['app', 'clinical'])
    ap.add_argument('--json', help='also write every per-page result here')
    a = ap.parse_args()
    js = sorted(j for j in glob.glob(os.path.join(CORPUS, '*.json')) if not j.endswith('index.json'))
    if a.renderer:
        js = [j for j in js if os.path.basename(j).startswith(a.renderer + '_')]
    if a.limit:
        js = js[:a.limit]
    with Pool() as pool:
        res = pool.map(score_page, js)
    if a.json:
        json.dump(res, open(a.json, 'w'), indent=1)

    print(f'{len(res)} pages from {CORPUS}\n')
    for ren in ('app', 'clinical'):
        R = [r for r in res if r['renderer'] == ren]
        if not R:
            continue
        print(f'==== {ren} renderer ({len(R)} pages) ====')
        print(f'  grid period correct       {sum(r["grid_ok"] for r in R)}/{len(R)}'
              f'   (expects {"px/s" if ren == "clinical" else "px per 5 mm minor square"})')
        print(f'  pitch error %             {msd([r["pitch_err_pct"] for r in R])}')
        rows = [x for r in R for x in r['rows']]
        for lo, hi in ((0, 0.5), (0.5, 0.8), (0.8, 1.1), (1.1, 99)):
            e = [100 * abs(x['est_rh'] - x['true_rh']) / x['true_rh'] for x in rows if lo <= x['true_rh'] < hi]
            if e:
                print(f'  row p2p |err| %, occ {lo:.1f}-{hi if hi < 99 else "∞"}'.ljust(30)
                      + f'median {np.median(e):5.1f}   p90 {np.percentile(e, 90):5.1f}   worst {max(e):6.1f}   (n={len(e)})')
        for st in ('awake', 'drowsy', 'n2'):
            S = [r for r in R if r['state'] == st]
            if not S:
                continue
            post = [x for r in S for x in r['rows'] if x['post']]
            fp = [x for r in S for x in r['rows'] if x['fp']]
            print(f'  -- {st} ({len(S)} pages)')
            print(f'     PDR |est - drawn peak| Hz, posterior   {msd([abs(x["est_alpha"] - x["true_alpha"]) for x in post])}')
            print(f'     PDR |est - subject iaf| Hz, posterior  '
                  f'{msd([abs(x["est_alpha"] - r["iaf"]) for r in S for x in r["rows"] if x["post"]])}')
            print(f'     alpha prominence, posterior             {msd([x["prom"] for x in post])}')
            print(f'     alpha prominence, frontopolar (control) {msd([x["prom"] for x in fp])}')
            apr = [(r['ap_est'], r['ap_true']) for r in S if 'ap_true' in r]
            if apr:
                print(f'     A-P ratio true                          {msd([b for _, b in apr])}')
                print(f'     A-P ratio read from image               {msd([a_ for a_, _ in apr])}')
                print(f'     A-P |log2 error|                        {msd([abs(np.log2(a_ / b)) for a_, b in apr])}')
        print()


if __name__ == '__main__':
    main()

"""Iteration 1 scorer: PDR present / frequency / topography, read from the IMAGE.

Engine corpus (truth known): detection rate per state, frequency error against the
drawn posterior peak, and the two negative controls (N2 pages, frontopolar rows).
Run twice per page: with TRUE geometry (isolates the PDR method) and END-TO-END
(clinical pages only: px/s from the grid, pitch and baselines from the comb fit —
what a reader with no truth gets).

    python iter1_pdr.py
"""
import glob, json, os, sys
from multiprocessing import Pool
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import extract as E
import trackers as T
import pdr
from bench import groups_of, is_posterior, is_frontopolar

CORPUS = os.path.join(HERE, '..', 'corpus', 'engine')


def read_page(jpath):
    t = json.load(open(jpath))
    png = os.path.join(os.path.dirname(jpath), t['file'])
    ink, H, W = E.load_ink(png, keep_coloured=(t['renderer'] == 'app'))
    lblw = int(round(t['labelStripPx']))
    rows = t['rows']
    post = [i for i, r in enumerate(rows) if is_posterior(r['label'])]
    front = [i for i, r in enumerate(rows) if is_frontopolar(r['label'])]
    drawn = float(np.mean([rows[i]['alphaPeakHz'] for i in post]))
    alpha_share = float(np.mean([rows[i]['bandShare']['alpha'] for i in post]))
    out = dict(id=t['id'], renderer=t['renderer'], montage=t['montage'], state=t['state'],
               drawn=drawn, alpha_share=alpha_share)

    I = ink[:, lblw:]
    ys, _ = T.track_segments(I, [r['baselineY'] for r in rows], t['pitchPx'])
    sides = [pdr.side_of(rows[i]['label']) for i in post]
    out['true_geom'] = pdr.call_pdr([ys[i] for i in post], [ys[i] for i in front], t['pxPerSec'], sides)

    if t['renderer'] == 'clinical':
        g = E.grid_period(None, lblw=lblw, path=png)
        best = E.comb_fit(ink, H, groups_of(rows), lblw=lblw, pmin=12, pmax=80)
        if g and best:
            ys2, _ = T.track_segments(I, list(best[4]), best[2])
            out['e2e'] = pdr.call_pdr([ys2[i] for i in post], [ys2[i] for i in front], float(g), sides)
            out['e2e_pxps'] = float(g)
    return out


def summarise(res, key):
    for st in ('awake', 'drowsy', 'n2'):
        S = [r for r in res if r['state'] == st and key in r]
        if not S:
            continue
        called = [r for r in S if r[key]['present']]
        ferr = [abs(r[key]['freq'] - r['drawn']) for r in called if r[key]['freq'] is not None]
        print(f'  {st:6s} PDR called {len(called):3d}/{len(S):3d} ({100*len(called)/len(S):5.1f}%)'
              f'   post peak {np.mean([r[key]["post_db"] for r in S]):5.1f} ± {np.std([r[key]["post_db"] for r in S]):4.1f} dB'
              f'   front {np.mean([r[key]["front_db"] for r in S]):5.1f} dB'
              + (f'   |f - drawn| {np.mean(ferr):.2f} ± {np.std(ferr):.2f} Hz' if ferr else ''))


if __name__ == '__main__':
    js = sorted(j for j in glob.glob(os.path.join(CORPUS, '*.json')) if not j.endswith('index.json'))
    with Pool() as pool:
        res = pool.map(read_page, js)
    json.dump(res, open(os.path.join(HERE, '..', 'corpus', 'iter1_engine_results.json'), 'w'), indent=1)
    print(f'{len(res)} engine pages\n\nTRUE geometry (the PDR method alone):')
    summarise(res, 'true_geom')
    print('\nEND-TO-END (clinical pages: grid px/s, comb-fit baselines):')
    summarise(res, 'e2e')
    # the miss list, so a failure can be looked at rather than averaged away
    miss = [r for r in res if (r['state'] == 'awake') != r['true_geom']['present']]
    print(f'\ndisagreements with "awake = PDR, else none": {len(miss)}')
    for r in miss[:20]:
        g = r['true_geom']
        print(f"  {r['id']:<48} called={g['present']!s:5}  post {g['post_db']:5.1f} dB  front {g['front_db']:5.1f} dB"
              f"  drawn {r['drawn']:.1f} Hz  alpha share {r['alpha_share']:.2f}")

"""Iteration 2 scorer: reactivity read from the IMAGE against the true open intervals.

    python iter2_reactivity.py

Truth per page comes from corpus/reactivity/*.json (readCorpus.ts --reactivity):
`openIntervals` from the engine's groundTruth.eyesOpen, and the drawn samples'
own reactivity index over those intervals (same windows, same envelope, computed on
the true data instead of the traced pixels).
"""
import glob, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import extract as E
import trackers as T
import reactivity as RX

CORPUS = os.path.join(HERE, '..', 'corpus', 'reactivity')
FRONT = ['Fp1-F3', 'Fp2-F4']
POST = ['P3-O1', 'P4-O2', 'T5-O1', 'T6-O2']


def main():
    hits = misses = fa_ctrl = fa_man = 0
    rows_out = []
    for j in sorted(glob.glob(os.path.join(CORPUS, '*.json'))):
        t = json.load(open(j))
        png = os.path.join(CORPUS, t['file'])
        ink, H, W = E.load_ink(png, keep_coloured=(t['renderer'] == 'app'))
        L = [r['label'] for r in t['rows']]
        ys, _ = T.track_segments(ink[:, int(t['labelStripPx']):], [r['baselineY'] for r in t['rows']], t['pitchPx'])
        fr = [ys[L.index(l)] for l in FRONT]; po = [ys[L.index(l)] for l in POST]
        v = RX.read_reactivity(fr, po, t['pxPerSec'], t['pitchPx'])
        truth = [tuple(x) for x in t['openIntervals']]
        # match detected openings to true ones (start within 0.6 s)
        used = set()
        for a, b in v['windows']:
            m = [k for k, (ta, tb) in enumerate(truth) if abs(a - ta) <= 0.6 and k not in used]
            if m: used.add(m[0])
            elif truth: fa_man += 1
            else: fa_ctrl += 1
        # a true interval that starts < 1 s from the page edge cannot show its opening sweep
        scorable = [k for k, (ta, tb) in enumerate(truth) if ta >= 0.3 and tb - ta >= 1.5]
        hits += len([k for k in scorable if k in used]); misses += len([k for k in scorable if k not in used])
        # the drawn samples' own index over the TRUE intervals: same envelope, same windows
        true_idx = None
        if truth:
            env = RX.alpha_envelope([np.array(t['samples'][l]) for l in POST], t['fs'])
            true_idx = RX.reactivity_index(env, truth, t['fs'])
        rows_out.append((t['id'], len(truth), len(v['windows']), v['index'], v['reactive'], true_idx))
    print(f"{'page':<36} open intervals true/read   index read / drawn   reactive")
    for pid, nt, nr, ix, rc, ti in rows_out:
        f = lambda x: '  —  ' if x is None else f'{x:5.2f}'
        print(f"{pid:<36} {nt:4d} / {nr:<4d}              {f(ix)} / {f(ti)}        {rc}")
    man = [r for r in rows_out if r[1] > 0]; ctl = [r for r in rows_out if r[1] == 0]
    print(f"\nopenings detected {hits}/{hits + misses} ({100 * hits / max(1, hits + misses):.0f}%)   "
          f"false openings: {fa_man} on maneuver pages, {fa_ctrl} on {len(ctl)} control pages")
    # NEGATIVE CONTROL for the index: the same subject with no maneuver, read through
    # the maneuver page's TRUE windows. Same background, no blocking - so this is
    # how low the index falls from noise alone.
    ctrl_idx = []
    for pid, nt, *_ in man:
        c = json.load(open(os.path.join(CORPUS, pid.replace('eyeopen', 'control') + '.json')))
        m = json.load(open(os.path.join(CORPUS, pid + '.json')))
        env = RX.alpha_envelope([np.array(c['samples'][l]) for l in POST], c['fs'])
        ctrl_idx.append(RX.reactivity_index(env, [tuple(x) for x in m['openIntervals']], c['fs']))
    drawn = [r[5] for r in man if r[5] is not None]
    print(f"index on DRAWN samples, true windows:  maneuver {np.mean(drawn):.2f} ± {np.std(drawn):.2f} "
          f"(max {max(drawn):.2f})   no-maneuver control {np.mean(ctrl_idx):.2f} ± {np.std(ctrl_idx):.2f} (min {min(ctrl_idx):.2f})")
    ix = [r[3] for r in man if r[3] is not None]
    err = [abs(r[3] - r[5]) for r in man if r[3] is not None and r[5] is not None]
    print(f"maneuver pages called reactive {sum(1 for r in man if r[4])}/{len(man)};  "
          f"index {np.mean(ix):.2f} ± {np.std(ix):.2f} (n={len(ix)});  |read - drawn| {np.mean(err):.3f} ± {np.std(err):.3f}")


if __name__ == '__main__':
    main()

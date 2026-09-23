"""Score every trace-reading method against EXACT per-row pixel paths.

The engine renders in corpus/truthpaths/ were drawn at three blink severities
(sensitivity 7 / 5 / 4 uV/mm = shallow / medium / deep crossing) and saved with
the exact y(x) of every row. Nothing here is estimated on the truth side, so any
error is the reader's.

This is the reproduction test for the /read skill's crossover tables: if these
numbers do not come out near the published ones, those tables are unverified.

    python bench_truthpaths.py
"""
import json, os, sys
import numpy as np
import extract as E
import trackers as T
import fillers as F

HERE = os.path.dirname(os.path.abspath(__file__))
TP = os.path.join(HERE, '..', 'corpus', 'truthpaths')
ROWS = [0, 1, 2, 3]            # Fp1-F3 .. P3-O1, the chain the blink runs down
WIN = 40                       # px either side of the event column


def trace_offset(ink, paths):
    """Label-strip width: the x offset at which the truth paths land on ink."""
    best = None
    for off in range(0, ink.shape[1] - paths.shape[1] + 1):
        hit = 0
        for r in range(paths.shape[0]):
            ys = np.clip(np.round(paths[r]).astype(int), 0, ink.shape[0] - 1)
            hit += ink[ys, np.arange(paths.shape[1]) + off].sum()
        if best is None or hit > best[0]:
            best = (hit, off)
    return best[1]


def reconstruct(I, B, pitch, filler):
    """Segment-first anchors, then fill each bounded gap with `filler`."""
    ys, conf = T.track_segments(I, B, pitch)
    out = ys.copy()
    W = I.shape[1]
    for i in range(len(B)):
        for a, b in T._spans(~conf[i]):
            if a == 0 or b >= W - 1:
                continue
            yL, yR = ys[i, a - 1], ys[i, b + 1]
            f = filler
            if filler == 'auto':
                # steep entry -> bidirectional, otherwise DP (skill: select per row)
                v = max(abs(ys[i, a - 1] - ys[i, max(0, a - 6)]),
                        abs(ys[i, min(W - 1, b + 6)] - ys[i, b + 1])) / 5.0
                f = 'bidir' if v >= 0.08 * pitch else 'dp'
            fn = {'interp': F.fill_interp, 'bidir': F.fill_bidir,
                  'dp': F.fill_dp, 'component': F.fill_component}[f]
            seg = fn(I, yL, yR, a, b, pitch)
            if len(seg) == b - a + 1:
                out[i, a:b + 1] = seg
    return out, conf


def score(rec, truth, B, x0):
    """Trough error at the TRUE extremum, not at each path's own extremum.

    On rows 2-3 the blink is smaller than the background alpha inside the event
    window, whose positive and negative peaks are nearly equal. Taking each path's
    own argmax|dev| then compares a positive truth peak with a negative recovered
    one and reports ~-180% for every method alike: a metric failure, not a reader
    failure. So: locate the truth's extremum, and read the recovered path's
    same-signed extremum within 3 px of that column.
    """
    lo, hi = x0 - WIN, x0 + WIN
    err, rms = [], []
    for r in ROWS:
        t = truth[r, lo:hi] - B[r]
        e = rec[r, lo:hi] - B[r]
        c = int(np.argmax(np.abs(t)))
        tx = t[c]
        near = e[max(0, c - 3):c + 4] * np.sign(tx)
        ex = np.max(near) * np.sign(tx)
        err.append(100.0 * (ex - tx) / tx)
        rms.append(float(np.sqrt(np.mean((rec[r] - truth[r]) ** 2))))
    return err, rms


def main():
    methods = {
        'order':            lambda I, B, p: T.track_order(I, B, p),
        'nearest(0.95)':    lambda I, B, p: T.track_nearest(I, B, p, lim=0.95),
        'velocity':         lambda I, B, p: T.track_velocity(I, B, p),
        'peel (v1)':        lambda I, B, p: T.track_peel(I, B, p),
        'peel-and-elim':    lambda I, B, p: T.track_peel2(I, B, p)[0],
        'segments+snap':    lambda I, B, p: T.track_segments(I, B, p)[0],
        'hybrid':           lambda I, B, p: T.track_hybrid(I, B, p)[0],
        'seg+interp':       lambda I, B, p: reconstruct(I, B, p, 'interp')[0],
        'seg+bidir':        lambda I, B, p: reconstruct(I, B, p, 'bidir')[0],
        'seg+dp':           lambda I, B, p: reconstruct(I, B, p, 'dp')[0],
        'seg+component':    lambda I, B, p: reconstruct(I, B, p, 'component')[0],
        'seg+auto(bidir|dp)': lambda I, B, p: reconstruct(I, B, p, 'auto')[0],
    }
    only = sys.argv[1:] or None
    for sev, s in (('shallow', 7), ('medium', 5), ('deep', 4)):
        d = json.load(open(os.path.join(TP, f'eng-blink-s{s}.json')))
        truth = np.array(d['paths']); B = np.array(d['baselines'], float)
        pitch = float(B[1] - B[0])
        ink, H, W = E.load_ink(os.path.join(TP, f'eng-blink-s{s}.png'))
        off = trace_offset(ink, truth)
        I = ink[:, off:off + truth.shape[1]]
        x0 = int(np.argmax(np.abs(truth[0] - B[0])))
        print(f'\n== {sev} (sens {s}), pitch {pitch:.0f} px, label strip {off} px, event x={x0} ==')
        print(f'{"method":<20} trough error % rows 0-3            RMS px rows 0-3')
        for name, fn in methods.items():
            if only and name not in only:
                continue
            rec = fn(I, B, pitch)
            err, rms = score(rec, truth, B, x0)
            print(f'{name:<20} ' + ' '.join(f'{e:+6.0f}' for e in err)
                  + '      ' + ' '.join(f'{v:5.1f}' for v in rms))
        # confidence map quality (skill: 93% confident; 1.5 px vs 8.5 px median)
        ys, conf = T.track_segments(I, B, pitch)
        full, _ = reconstruct(I, B, pitch, 'auto')
        e = np.abs(full - truth)
        print(f'  segment-first confident on {100*conf.mean():.0f}% of row-columns; '
              f'median |err| {np.median(e[conf]):.1f} px confident vs {np.median(e[~conf]):.1f} px not')


if __name__ == '__main__':
    main()

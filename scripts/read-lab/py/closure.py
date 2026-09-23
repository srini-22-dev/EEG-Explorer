"""What does the PDR do in the seconds after the eyes close? Read it off a page.

After eye closure a real PDR emerges prominently (learningeeg: it "emerges right
after the patient closes their eyes") and can run briefly FASTER than its resting
frequency — "alpha squeak". This measures both on any traced page, relative to the
same page's own settled PDR:

  envelope profile   posterior 8-13 Hz envelope in windows after the closure,
                     over the envelope from +3 s to the next event (the settled PDR)
  frequency profile  posterior alpha frequency in the same windows, from cycle
                     counting on the 7-14 Hz band-passed trace (zero crossings /2 per
                     second) — the reader's own method, counting, not a spectrum

The closure is the most prominent DOWNWARD excursion of the low-passed frontopolar
traces (Bell's phenomenon drives Fp positive = down).

    python closure.py            # the learningeeg eye-closure figure
"""
import os, sys
import numpy as np
from scipy.signal import butter, filtfilt, hilbert, find_peaks

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import extract as E
import trackers as T

WINDOWS = [(0.0, 0.5), (0.5, 1.0), (1.0, 1.5), (1.5, 2.5), (2.5, 3.5)]


def bp(y, fs, lo, hi, order=4):
    b, a = butter(order, [lo / (fs / 2), hi / (fs / 2)], 'band')
    return filtfilt(b, a, np.nan_to_num(y - np.nanmean(y)))


def lp(y, fs, fc):
    b, a = butter(2, fc / (fs / 2), 'low')
    return filtfilt(b, a, np.nan_to_num(y - np.nanmedian(y)))


def closure_time(front_rows, fs, post_rows=None):
    """The eye closure is a frontal POSITIVE (downward) sweep AFTER WHICH THE PDR
    EMERGES — that second half is what makes it a closure and not a blink, and it is
    how learningeeg tells a reader to find it. Taking just the most prominent
    downswing picked x = 1088 on the second figure, where the alpha BEFORE the event
    was 2.2x the alpha after it. So: among prominent downswings, take the one with the
    largest posterior 8-13 Hz envelope rise, (+0.5..+2.5 s) over (-2.5..-0.5 s)."""
    y = np.mean([lp(r, fs, 1.5) for r in front_rows], axis=0)
    pk, pr = find_peaks(y, prominence=0)
    if post_rows is None:
        return pk[np.argmax(pr['prominences'])] / fs
    keep = pk[pr['prominences'] >= 0.3 * pr['prominences'].max()]
    env = np.mean([np.abs(hilbert(bp(r, fs, 8, 13))) for r in post_rows], axis=0)
    n = len(env)
    def rise(k):
        a, b = int(k + 0.5 * fs), int(k + 2.5 * fs)
        c, d = int(k - 2.5 * fs), int(k - 0.5 * fs)
        if c < 0 or b > n:
            return -np.inf
        return env[a:b].mean() / env[c:d].mean()
    k = max(keep, key=rise)
    # Refine on the UNFILTERED trace: a fast Bell's-phenomenon sweep riding on a slower
    # wave has its low-passed maximum pulled onto the slow wave — 0.58 s early on the
    # second figure (x 605 vs the visible sweep at 670). Take the raw extremum within
    # +/-0.6 s of the low-passed pick. (The engine side uses true closure times, which
    # fall at about the peak of its closing sweep.)
    raw = np.mean([np.nan_to_num(r - np.nanmedian(r)) for r in front_rows], axis=0)
    a, b = max(0, int(k - 0.6 * fs)), min(len(raw), int(k + 0.6 * fs))
    return (a + int(np.argmax(raw[a:b]))) / fs


def count_freq(x, fs):
    """Cycles per second by counting zero crossings of a band-passed trace."""
    zc = np.sum(np.diff(np.sign(x)) != 0) / 2
    return zc / (len(x) / fs)


SETTLED = (3.0, 5.5)   # short enough to fit between engine maneuvers; used for both sides


def profile(post_rows, fs, t_close, t_settled=SETTLED):
    env = np.mean([np.abs(hilbert(bp(r, fs, 8, 13))) for r in post_rows], axis=0)
    alpha = [bp(r, fs, 7, 14) for r in post_rows]
    n = len(env)
    seg = lambda a, b: slice(int((t_close + a) * fs), min(n, int((t_close + b) * fs)))
    s = seg(*t_settled)
    ref_env = env[s].mean()
    ref_f = np.mean([count_freq(x[s], fs) for x in alpha])
    out = []
    for a, b in WINDOWS:
        w = seg(a, b)
        out.append((a, b, env[w].mean() / ref_env, np.mean([count_freq(x[w], fs) for x in alpha])))
    pre = seg(-2.5, -0.5)
    return dict(pre_env=env[pre].mean() / ref_env, settled_hz=ref_f, windows=out)


L16 = ['Fp1-F3', 'F3-C3', 'C3-P3', 'P3-O1', 'Fp2-F4', 'F4-C4', 'C4-P4', 'P4-O2',
       'Fp1-F7', 'F7-T3', 'T3-T5', 'T5-O1', 'Fp2-F8', 'F8-T4', 'T4-T6', 'T6-O2']
# Real eye-closure figures: montage READ off the labels, label strip measured by eye.
FIGURES = [('eye-closure.png', 58), ('eye-closure-2.png', 58)]


def read_figure(name, lblw):
    png = os.path.join(HERE, '..', 'corpus', 'online', name)
    ink, H, W = E.load_ink(png)
    pxps = E.grid_period(None, lblw=lblw, path=png)
    best = E.comb_fit(ink, H, [4, 4, 4, 4, 2, 2, 2], lblw=lblw, pmin=15, pmax=40)
    ys, conf = T.track_segments(ink[:, lblw:], list(best[4]), best[2])
    front = [ys[L16.index(l)] for l in ('Fp1-F3', 'Fp2-F4')]
    post = [ys[L16.index(l)] for l in ('P3-O1', 'P4-O2', 'T5-O1', 'T6-O2')]
    tc = closure_time(front, pxps, post)
    print(f'{name}: grid period {pxps} px, pitch {best[2]:.1f} px, page {(W - lblw) / pxps:.1f} s, '
          f'segment-confident {100 * conf.mean():.0f}%, closure at {tc:.2f} s (x = {lblw + tc * pxps:.0f} px)')
    p = profile(post, pxps, tc)
    print(f'   eyes-open 0.5-2.5 s before closure: envelope {p["pre_env"]:.2f} x settled; '
          f'settled PDR {p["settled_hz"]:.2f} Hz by counting')
    return p


def main():
    reals = [read_figure(n, lb) for n, lb in FIGURES]
    p = reals[0]
    real = p['windows']
    # the engine, same tracer, same windows, every closure with a clean settled window after it
    import glob, json
    E_env, E_df = [], []
    for j in sorted(glob.glob(os.path.join(HERE, '..', 'corpus', 'reactivity', 'clinical_*_eyeopen.json'))):
        t = json.load(open(j))
        ink2, H2, W2 = E.load_ink(os.path.join(os.path.dirname(j), t['file']))
        LL = [r['label'] for r in t['rows']]
        ys2, _ = T.track_segments(ink2[:, int(t['labelStripPx']):], [r['baselineY'] for r in t['rows']], t['pitchPx'])
        post2 = [ys2[LL.index(l)] for l in ('P3-O1', 'P4-O2', 'T5-O1', 'T6-O2')]
        iv = t['openIntervals']
        for k, (a, b) in enumerate(iv):
            nxt = iv[k + 1][0] if k + 1 < len(iv) else t['seconds']
            if b - a < 1.5 or nxt - b < SETTLED[1] + 0.2 or b < 2.5:
                continue
            q = profile(post2, t['pxPerSec'], b)
            E_env.append([w[2] for w in q['windows']]); E_df.append([w[3] - q['settled_hz'] for w in q['windows']])
    E_env, E_df = np.array(E_env), np.array(E_df)
    print()
    print(f'{"window after closure":<20} ' + ' '.join(f'{"REAL %d env" % (k + 1):>11}' for k in range(len(reals)))
          + f'  {"ENGINE env (n=%d)" % len(E_env):>20}  ' + ' '.join(f'{"REAL %d df" % (k + 1):>10}' for k in range(len(reals)))
          + f'  {"ENGINE df":>16}')
    for i, (a, b, e, f) in enumerate(real):
        print(f'  +{a:.1f}-{b:.1f} s{"":<9} ' + ' '.join(f'{r["windows"][i][2]:11.2f}' for r in reals)
              + f'  {E_env[:, i].mean():12.2f} +/- {E_env[:, i].std():.2f}  '
              + ' '.join(f'{r["windows"][i][3] - r["settled_hz"]:+10.2f}' for r in reals)
              + f'  {E_df[:, i].mean():+8.2f} +/- {E_df[:, i].std():.2f} Hz')


if __name__ == '__main__':
    main()

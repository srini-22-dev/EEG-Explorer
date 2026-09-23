"""Event-averaged SIGNED waveform per row — the shape of a transient, not its size.

max|deviation| cannot see an overshoot. This aligns every event on its downstroke
peak and averages the signed trace, so downstroke, recovery, overshoot and timing
are all recoverable and comparable between a reference figure and an engine render.

Sign convention: image y grows downward, so +ve = DOWNWARD deflection on the page.
"""
import numpy as np
import extract as E


def rows_from_image(path, labels, groups, lblw, pmin=20, pmax=60):
    ink, H, W = E.load_ink(path)
    b = E.comb_fit(ink, H, groups, lblw=lblw, pmin=pmin, pmax=pmax)
    pitch = b[2]
    ys, amb = E.track_rows(ink[:, lblw:], b[4], pitch)
    return ys, amb, pitch


def find_events(ys, amb, idx_trigger, per, n=8, refractory=0.55, polarity=+1):
    """Events = strongest DOWNWARD (polarity +1) excursions summed over trigger rows."""
    W = ys.shape[1]
    dev = np.zeros(W)
    for i in idx_trigger:
        good = ~amb[i]
        base = np.median(ys[i][good])
        d = (ys[i] - base) * polarity
        d[~good] = 0
        dev += np.clip(d, 0, None)
    ev, guard = [], int(refractory * per)
    d = dev.copy()
    for _ in range(n):
        t = int(np.argmax(d))
        if d[t] <= 0:
            break
        ev.append(t)
        d[max(0, t - guard):min(W, t + guard)] = -1
    return sorted(ev)


def event_average(ys, amb, pitch, events, per, pre=0.35, post=1.15, fs=200.0):
    """Signed, baseline-corrected, event-aligned average per row, on a common time base.

    Returns t (seconds, 0 = downstroke peak) and A[row][t] in ROW-HEIGHTS,
    +ve = downward on the page.
    """
    n, W = ys.shape
    t = np.arange(-pre, post, 1.0 / fs)
    out = np.full((n, len(t)), np.nan)
    for i in range(n):
        good = ~amb[i]
        if good.sum() < 50:
            continue
        base = np.median(ys[i][good])
        segs = []
        for e in events:
            xs = e + t * per                      # sample positions in px
            if xs[0] < 0 or xs[-1] >= W - 1:
                continue
            x0 = np.floor(xs).astype(int)
            frac = xs - x0
            v = ys[i][x0] * (1 - frac) + ys[i][np.minimum(x0 + 1, W - 1)] * frac
            ok = good[x0] & good[np.minimum(x0 + 1, W - 1)]
            v = np.where(ok, v, np.nan)
            # pre-event baseline for this event
            pre_mask = t < -0.12
            b = np.nanmedian(v[pre_mask]) if np.any(~np.isnan(v[pre_mask])) else base
            segs.append((v - b) / pitch)
        if segs:
            out[i] = np.nanmean(np.array(segs), axis=0)
    return t, out


def describe(t, a):
    """Downstroke, overshoot and their timings from one averaged waveform."""
    if np.all(np.isnan(a)):
        return dict(down=np.nan, up=np.nan, ratio=np.nan, t_down=np.nan, t_up=np.nan, w50=np.nan)
    down_i = int(np.nanargmax(a))                 # most DOWNWARD point
    down = a[down_i]
    after = a.copy()
    after[:down_i + 1] = np.nan
    up_i = int(np.nanargmin(after)) if np.any(~np.isnan(after)) else down_i
    up = after[up_i]                              # most UPWARD point after the trough
    half = down / 2.0
    L = down_i
    while L > 0 and a[L] > half:
        L -= 1
    R = down_i
    while R < len(a) - 1 and a[R] > half:
        R += 1
    return dict(down=down, up=up, ratio=(-up / down if down > 0 else np.nan),
                t_down=t[down_i], t_up=t[up_i], w50=t[R] - t[L])

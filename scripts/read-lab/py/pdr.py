"""Read the posterior dominant rhythm off traced rows — iteration 1.

A reader calls "PDR present" from three things together: a RHYTHM, in the ALPHA
band, maximal POSTERIORLY. Power somewhere in 6-14 Hz is not that: on a 1/f
spectrum the band's lower edge always carries more power than its flanks, so any
peak-over-flanks ratio mostly measures the slope. (It did: N2 pages, which draw no
posterior alpha at all, scored 57 against 93 awake on that ratio — JOURNAL.md.)

So the peak is measured ABOVE THE APERIODIC BACKGROUND: fit a straight line to log
power vs log frequency over 2-30 Hz with the alpha region left out, and read the
height of the residual in 7-13.5 Hz. A "peak" within 0.5 Hz of either edge of that
window is the slope, not a rhythm, and is rejected.
"""
import numpy as np
from scipy.signal import welch as sp_welch

FIT_LO, FIT_HI = 2.0, 30.0
EXCL_LO, EXCL_HI = 6.0, 14.0
PK_LO, PK_HI = 7.0, 13.5


def spectrum(y, px_per_sec):
    y = np.nan_to_num(np.asarray(y, float) - np.nanmean(y))
    nper = int(min(len(y), 4 * px_per_sec))
    return sp_welch(y, fs=px_per_sec, nperseg=nper)


def alpha_peak(y, px_per_sec):
    """-> (freq Hz or None, height dB above the aperiodic fit)."""
    f, p = spectrum(y, px_per_sec)
    lf, lp = np.log10(np.maximum(f, 1e-9)), 10 * np.log10(p + 1e-20)
    fit = ((f >= FIT_LO) & (f <= FIT_HI)) & ~((f >= EXCL_LO) & (f <= EXCL_HI))
    if fit.sum() < 4:
        return None, 0.0
    slope, icpt = np.polyfit(lf[fit], lp[fit], 1)
    resid = lp - (slope * lf + icpt)
    w = (f >= PK_LO) & (f <= PK_HI)
    idx = np.nonzero(w)[0]
    k = idx[np.argmax(resid[idx])]
    if f[k] < PK_LO + 0.5 or f[k] > PK_HI - 0.5:
        return None, float(resid[k])
    # parabolic refinement on the residual
    if 0 < k < len(f) - 1:
        a, b, c = resid[k - 1], resid[k], resid[k + 1]
        den = a - 2 * b + c
        d = 0.5 * (a - c) / den if den != 0 else 0.0
        fk = f[k] + d * (f[1] - f[0])
    else:
        fk = f[k]
    return float(fk), float(resid[k])


def call_pdr(post_rows, front_rows, px_per_sec, post_sides=None,
             min_db=10.0, min_topo_db=3.0, max_lr_hz=1.0):
    """Posterior rows vs frontopolar rows of ONE page -> verdict dict.

    (i)+(ii)  posterior mean alpha-peak height >= min_db above the aperiodic fit.
              10 dB is ~4.5 noise sd for a 10 s page at 4 s Welch segments (~4
              averages, per-bin sd ~2.2 dB, max of ~26 noise bins ~ +5.5 dB); the
              first version's 6 dB sat at that noise ceiling and called N2 a PDR on
              a third of pages (JOURNAL.md, iteration 1a).
    (iii)     it exceeds the frontopolar rows' height by >= min_topo_db.
    bilateral if `post_sides` ('L'/'R' per posterior row) is given: both sides must
              carry a peak and agree within max_lr_hz — a PDR is bilateral at one
              frequency, and noise peaks have no reason to agree.
    """
    P = [alpha_peak(y, px_per_sec) for y in post_rows]
    F = [alpha_peak(y, px_per_sec) for y in front_rows]
    hp = float(np.mean([h if fr is not None else min(h, 0.0) for fr, h in P]))
    hf = float(np.mean([h if fr is not None else min(h, 0.0) for fr, h in F])) if F else -99.0
    freqs = [fr for fr, _ in P if fr is not None]
    lr_ok, lr_gap = True, None
    if post_sides is not None:
        L = [fr for (fr, _), s in zip(P, post_sides) if s == 'L' and fr is not None]
        R = [fr for (fr, _), s in zip(P, post_sides) if s == 'R' and fr is not None]
        if L and R:
            lr_gap = abs(float(np.median(L)) - float(np.median(R)))
            lr_ok = lr_gap <= max_lr_hz
        else:
            lr_ok = False
    present = hp >= min_db and (hp - hf) >= min_topo_db and len(freqs) > 0 and lr_ok
    return dict(present=bool(present), post_db=hp, front_db=hf, lr_gap=lr_gap,
                freq=float(np.median(freqs)) if freqs else None)


def side_of(label):
    """'L' / 'R' / None from the electrode that makes a row posterior (odd = left)."""
    for e in label.split('-'):
        if e in ('O1', 'T5', 'P3', 'P7'):
            return 'L'
        if e in ('O2', 'T6', 'P4', 'P8'):
            return 'R'
    return None

"""Read alpha reactivity off a page — iteration 2.

The page says when the eyes are open. Opening the eyes sweeps the positive cornea
away from Fp1/Fp2, an UPWARD frontopolar deflection (IK-011); closing them a few
seconds later gives a smaller DOWNWARD one. Between the two the PDR should be
attenuated (IK-007), and learningeeg's instruction is to grade the PDR only once the
eyes are closed. So:

  1. find opening/closing pairs on the low-passed frontopolar traces,
  2. compare the posterior 8-13 Hz envelope inside the open windows with the rest,
  3. call the PDR reactive if open / closed <= REACTIVE_MAX.

Sign convention: traced y is in image pixels, +down, so an UPWARD deflection is a
NEGATIVE excursion of y.
"""
import numpy as np
from scipy.signal import butter, filtfilt, hilbert, find_peaks

# Calibrated 2026-09-11 between the two distributions on corpus/reactivity: real
# blocking read 0.45 +/- 0.10 (max 0.66); the same subjects with no maneuver, through
# the same windows, 0.98 +/- 0.13 (min 0.80). 0.6 sat inside the first. Calibration on
# this corpus, not an independent test: that needs a real record with eye opening.
REACTIVE_MAX = 0.75
RECOVERY_S = 1.2


def _lowpass(y, fs, fc):
    b, a = butter(2, fc / (fs / 2), 'low')
    return filtfilt(b, a, y)


def _bandpass(y, fs, lo, hi):
    b, a = butter(4, [lo / (fs / 2), hi / (fs / 2)], 'band')
    return filtfilt(b, a, y)


def find_open_windows(front_rows, pxps, pitch):
    """Opening = upward excursion of the mean low-passed frontopolar trace, paired
    with the next downward excursion 1.5-6 s later (the closing). Thresholds are in
    row-heights, the unit that survives an uncalibrated page."""
    y = np.mean([_lowpass(np.nan_to_num(r - np.nanmedian(r)), pxps, 1.5) for r in front_rows], axis=0)
    thr = 0.12 * pitch
    ups, _ = find_peaks(-y, height=thr, distance=int(1.0 * pxps), prominence=thr)
    downs, props = find_peaks(y, height=0.5 * thr, distance=int(0.5 * pxps), prominence=0.5 * thr)
    prom = dict(zip(downs, props['prominences']))
    out, last_close = [], -1e9
    for u in ups:
        # An upswing within RECOVERY_S of a closing is that closing's recovery swing:
        # the amplifier's low-frequency filter makes every slow ocular transient
        # biphasic (IK-001), so a downward closing sweep is followed by an upward
        # overshoot that looks exactly like an opening. Iteration 2a took them for
        # openings and paired them with the NEXT closing, counting ~5 s of eyes-closed
        # alpha as "open".
        if u - last_close < RECOVERY_S * pxps or (out and u / pxps <= out[-1][1]):
            continue
        # The closing is the most prominent downswing 1.5-6 s later, not the first:
        # a background slow wave inside the window is not the eyes closing.
        later = [d for d in downs if 1.5 * pxps <= d - u <= 6.0 * pxps]
        if later:
            d = max(later, key=lambda k: prom[k])
            out.append((u / pxps, d / pxps))
            last_close = d
    return out


def alpha_envelope(post_rows, pxps):
    envs = [np.abs(hilbert(_bandpass(np.nan_to_num(r - np.nanmean(r)), pxps, 8, 13))) for r in post_rows]
    return np.mean(envs, axis=0)


def reactivity_index(env, windows, pxps, settle=0.5, recover=1.0):
    """Mean envelope inside [open+settle, close] over mean envelope away from every
    window (excluding the settle and a `recover` second after each close)."""
    n = len(env)
    t = np.arange(n) / pxps
    inside = np.zeros(n, bool); excluded = np.zeros(n, bool)
    for a, b in windows:
        inside |= (t >= a + settle) & (t <= b)
        excluded |= (t >= a - 0.2) & (t <= b + recover)
    closed = ~excluded
    if inside.sum() < pxps * 0.5 or closed.sum() < pxps * 2:
        return None
    return float(env[inside].mean() / env[closed].mean())


def read_reactivity(front_rows, post_rows, pxps, pitch):
    w = find_open_windows(front_rows, pxps, pitch)
    idx = reactivity_index(alpha_envelope(post_rows, pxps), w, pxps) if w else None
    return dict(windows=w, index=idx,
                reactive=None if idx is None else bool(idx <= REACTIVE_MAX))

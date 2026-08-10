/**
 * Signal-analysis utilities for validating the EEG engine (briefing §11).
 *
 * These live in `scripts` rather than in the simulator package because they are
 * only ever run offline against generated data — nothing here executes in the
 * browser render loop.
 */

/** In-place iterative radix-2 Cooley–Tukey FFT. Length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if ((n & (n - 1)) !== 0) throw new Error('fft: length must be a power of 2');

  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

export type Psd = { freqs: Float64Array; power: Float64Array };

/**
 * Welch's method: Hann-windowed, 50%-overlapping segments, averaged
 * periodograms. Returns a one-sided PSD in units^2/Hz.
 */
export function welch(x: number[] | Float64Array, fs: number, nfft = 2048): Psd {
  const hop = nfft >> 1;
  const win = new Float64Array(nfft);
  let winPow = 0;
  for (let i = 0; i < nfft; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (nfft - 1));
    winPow += win[i] * win[i];
  }
  const nBins = nfft / 2 + 1;
  const acc = new Float64Array(nBins);
  let nSeg = 0;

  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);

  for (let start = 0; start + nfft <= x.length; start += hop) {
    let mean = 0;
    for (let i = 0; i < nfft; i++) mean += x[start + i];
    mean /= nfft;
    for (let i = 0; i < nfft; i++) {
      re[i] = (x[start + i] - mean) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < nBins; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      // double all but DC and Nyquist for the one-sided spectrum
      acc[k] += (k === 0 || k === nBins - 1 ? p : 2 * p);
    }
    nSeg++;
  }
  if (nSeg === 0) throw new Error('welch: signal shorter than one segment');

  const freqs = new Float64Array(nBins);
  const power = new Float64Array(nBins);
  const norm = 1 / (fs * winPow * nSeg);
  for (let k = 0; k < nBins; k++) {
    freqs[k] = (k * fs) / nfft;
    power[k] = acc[k] * norm;
  }
  return { freqs, power };
}

export type AperiodicFit = { exponent: number; offset: number; rSquared: number };

/**
 * Fit the aperiodic component of a spectrum: log10 P = offset - exponent*log10 f.
 *
 * Follows the specparam/FOOOF strategy for the aperiodic step — fit, then treat
 * points sitting well *above* the fit as oscillatory peaks and refit without
 * them. A plain regression over a spectrum containing an alpha peak is dragged
 * upward by that peak and reports a misleadingly flat exponent, which would make
 * a wrong background look correct.
 */
export function fitAperiodic(psd: Psd, fLo: number, fHi: number, nIter = 3): AperiodicFit {
  const lf: number[] = [];
  const lp: number[] = [];
  for (let k = 0; k < psd.freqs.length; k++) {
    const f = psd.freqs[k];
    if (f >= fLo && f <= fHi && psd.power[k] > 0) {
      lf.push(Math.log10(f));
      lp.push(Math.log10(psd.power[k]));
    }
  }
  let keep = lf.map(() => true);
  let slope = 0, intercept = 0, r2 = 0;

  for (let it = 0; it <= nIter; it++) {
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < lf.length; i++) {
      if (!keep[i]) continue;
      n++; sx += lf[i]; sy += lp[i]; sxx += lf[i] * lf[i]; sxy += lf[i] * lp[i];
    }
    if (n < 3) break;
    slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    intercept = (sy - slope * sx) / n;

    let ssTot = 0, ssRes = 0;
    const meanY = sy / n;
    const resid: number[] = [];
    for (let i = 0; i < lf.length; i++) {
      const pred = intercept + slope * lf[i];
      const r = lp[i] - pred;
      resid.push(r);
      if (keep[i]) { ssRes += r * r; ssTot += (lp[i] - meanY) ** 2; }
    }
    r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    if (it === nIter) break;
    // Exclude points more than 1 SD above the fit — candidate oscillatory peaks.
    let sd = 0, cnt = 0;
    for (let i = 0; i < resid.length; i++) if (keep[i]) { sd += resid[i] * resid[i]; cnt++; }
    sd = Math.sqrt(sd / Math.max(cnt, 1));
    keep = resid.map(r => r < sd);
  }
  return { exponent: -slope, offset: intercept, rSquared: r2 };
}

/**
 * Normalised autocorrelation, lag 0..maxLag samples.
 *
 * This is the test that catches the "sum of fixed sinusoids" failure directly. A
 * deterministic tone sum is exactly periodic, so its autocorrelation returns to
 * near 1 at the beat period no matter how long you wait. A genuinely stochastic
 * rhythm decorrelates and stays decorrelated. Spectral checks cannot tell these
 * apart — both can show the same peak frequency.
 */
export function autocorr(x: number[] | Float64Array, maxLag: number): Float64Array {
  const n = x.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = x[i] - mean;
  let denom = 0;
  for (let i = 0; i < n; i++) denom += d[i] * d[i];
  const out = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += d[i] * d[i + lag];
    out[lag] = s / denom;
  }
  return out;
}

/**
 * Analytic-signal envelope via FFT Hilbert transform. Used to check envelope
 * statistics (§11.2: envelopes should be roughly log-normal) and long-range
 * temporal correlations (§6).
 */
export function hilbertEnvelope(x: Float64Array): Float64Array {
  // pad to a power of two
  let n = 1;
  while (n < x.length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(x);
  fft(re, im);
  // zero negative frequencies, double positive ones
  const half = n / 2;
  for (let k = 1; k < half; k++) { re[k] *= 2; im[k] *= 2; }
  for (let k = half + 1; k < n; k++) { re[k] = 0; im[k] = 0; }
  // inverse FFT via conjugation
  for (let k = 0; k < n; k++) im[k] = -im[k];
  fft(re, im);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const rr = re[i] / n, ii = -im[i] / n;
    out[i] = Math.sqrt(rr * rr + ii * ii);
  }
  return out;
}

/**
 * Detrended fluctuation analysis exponent. Real EEG band envelopes show
 * long-range temporal correlations with DFA ~0.6-0.8 (§6); an envelope driven by
 * white noise gives ~0.5, which is one of the ways synthetic data reads as flat.
 */
export function dfa(x: Float64Array, scales: number[]): number {
  const n = x.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  const prof = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += x[i] - mean; prof[i] = acc; }

  const lx: number[] = [], ly: number[] = [];
  for (const s of scales) {
    const nSeg = Math.floor(n / s);
    if (nSeg < 2) continue;
    let f2 = 0;
    for (let seg = 0; seg < nSeg; seg++) {
      const o = seg * s;
      // least-squares detrend within the segment
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let i = 0; i < s; i++) { sx += i; sy += prof[o + i]; sxx += i * i; sxy += i * prof[o + i]; }
      const slope = (s * sxy - sx * sy) / (s * sxx - sx * sx);
      const icpt = (sy - slope * sx) / s;
      for (let i = 0; i < s; i++) {
        const r = prof[o + i] - (icpt + slope * i);
        f2 += r * r;
      }
    }
    const f = Math.sqrt(f2 / (nSeg * s));
    if (f > 0) { lx.push(Math.log10(s)); ly.push(Math.log10(f)); }
  }
  const m = lx.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < m; i++) { sx += lx[i]; sy += ly[i]; sxx += lx[i] * lx[i]; sxy += lx[i] * ly[i]; }
  return (m * sxy - sx * sy) / (m * sxx - sx * sx);
}

/** Spectral peak within a band: centre frequency, and FWHM above the local floor. */
export function spectralPeak(psd: Psd, fLo: number, fHi: number): { freq: number; fwhm: number; power: number } {
  let bestK = -1, bestP = -Infinity;
  for (let k = 0; k < psd.freqs.length; k++) {
    const f = psd.freqs[k];
    if (f < fLo || f > fHi) continue;
    if (psd.power[k] > bestP) { bestP = psd.power[k]; bestK = k; }
  }
  if (bestK < 0) return { freq: 0, fwhm: 0, power: 0 };

  // Measure the peak against the aperiodic floor implied by the band edges,
  // otherwise the 1/f background inflates the apparent width.
  const fit = fitAperiodic(psd, Math.max(fLo * 0.4, 0.5), fHi * 2.5);
  const floorAt = (f: number) => Math.pow(10, fit.offset - fit.exponent * Math.log10(f));
  const peakExcess = bestP - floorAt(psd.freqs[bestK]);
  const halfLevel = floorAt(psd.freqs[bestK]) + peakExcess / 2;

  let kLo = bestK, kHi = bestK;
  while (kLo > 0 && psd.power[kLo] > halfLevel) kLo--;
  while (kHi < psd.freqs.length - 1 && psd.power[kHi] > halfLevel) kHi++;
  return {
    freq: psd.freqs[bestK],
    fwhm: psd.freqs[kHi] - psd.freqs[kLo],
    power: peakExcess,
  };
}

/** Skewness — used on log-envelope, which should be ~0 if the envelope is log-normal. */
export function skewness(x: number[] | Float64Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) m += x[i];
  m /= x.length;
  let m2 = 0, m3 = 0;
  for (let i = 0; i < x.length; i++) {
    const d = x[i] - m;
    m2 += d * d; m3 += d * d * d;
  }
  m2 /= x.length; m3 /= x.length;
  return m3 / Math.pow(m2, 1.5);
}

/** Sample standard deviation. */
export function std(x: number[] | Float64Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) m += x[i];
  m /= x.length;
  let v = 0;
  for (let i = 0; i < x.length; i++) v += (x[i] - m) ** 2;
  return Math.sqrt(v / (x.length - 1));
}

/** Excess kurtosis (0 for a Gaussian) — distinguishes EMG-like spiky noise. */
export function kurtosis(x: number[] | Float64Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) m += x[i];
  m /= x.length;
  let m2 = 0, m4 = 0;
  for (let i = 0; i < x.length; i++) {
    const d = x[i] - m;
    m2 += d * d; m4 += d * d * d * d;
  }
  m2 /= x.length; m4 /= x.length;
  return m4 / (m2 * m2) - 3;
}

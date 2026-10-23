/**
 * Aperiodic (1/f-like) background — the dominant component of scalp EEG variance.
 *
 * Briefing §2. The background is coloured, not white, and it is not a garnish on
 * top of the rhythms: broadband aperiodic activity carries most of the total
 * variance. Getting this wrong is the difference between "EEG" and "a rhythm
 * sitting on hiss".
 *
 * Method: superposition of Ornstein–Uhlenbeck processes with log-spaced time
 * constants (§2c). Chosen over the more common FFT spectral-shaping route (§2a)
 * because that method is block-based and circular — it synthesises a fixed-length,
 * inherently periodic buffer — and this engine streams indefinitely in real time.
 * Sum-of-OU is recursive, so it streams sample-by-sample at constant cost, and it
 * carries a physiological story the FFT method lacks: a distribution of synaptic
 * and membrane relaxation times, whose superposed Lorentzians approximate a power
 * law and produce a spectral knee naturally rather than by fiat.
 */

import { Gaussian } from './rng';

/**
 * PSD of a unit-variance discrete AR(1) process, normalised so that integrating
 * over [-fs/2, fs/2] gives 1.
 *
 * Deliberately the *discrete* spectrum rather than the textbook continuous
 * Lorentzian 2*tau/(1+(2*pi*f*tau)^2). The two agree only while tau >> dt, and
 * this bank deliberately includes components with tau at or below the sample
 * interval to supply the flat high-frequency end. Fitting those against the
 * continuous form describes a process the code does not actually generate, and
 * the resulting spectrum comes out systematically too flat.
 */
function ar1Psd(f: number, a: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs;
  return (1 - a * a) / (fs * (1 - 2 * a * Math.cos(w) + a * a));
}

/** Squared magnitude response of a one-pole lowpass with coefficient c. */
function onePoleResponse(f: number, c: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs;
  const num = (1 - c) * (1 - c);
  return num / (1 - 2 * c * Math.cos(w) + c * c);
}

/**
 * Fit non-negative component powers so the superposed spectrum — including the
 * integrator stage, if present — approximates f^-chi across [fLo, fHi].
 *
 * Fitting happens in the log domain because the target is a power law: an
 * absolute-error fit would let the high-power low-frequency end swamp everything
 * above ~5 Hz, which is precisely the band that has to look right. The overall
 * level is a free parameter (removed as the mean log offset each iteration) since
 * absolute scale is set later by the caller's target RMS.
 */
function fitComponentPowers(
  coeffs: Float64Array,
  chi: number,
  fLo: number,
  fHi: number,
  fs: number,
  integratorC: number | null,
): Float64Array {
  const nGrid = 128;
  const freqs = new Float64Array(nGrid);
  for (let i = 0; i < nGrid; i++) {
    freqs[i] = fLo * Math.pow(fHi / fLo, i / (nGrid - 1));
  }
  const logTarget = Array.from(freqs, f => -chi * Math.log(f));

  // basis[i][j] = this component's contribution at frequency j, already through
  // the integrator so the fit compensates for its knee instead of ignoring it.
  const basis: Float64Array[] = [];
  for (let i = 0; i < coeffs.length; i++) {
    const row = new Float64Array(nGrid);
    for (let j = 0; j < nGrid; j++) {
      let v = ar1Psd(freqs[j], coeffs[i], fs);
      if (integratorC !== null) v *= onePoleResponse(freqs[j], integratorC, fs);
      row[j] = v;
    }
    basis.push(row);
  }

  // Heuristic start: longer time constants carry more power for steeper targets.
  // When an integrator is present it already supplies 2 of the slope, so the bank
  // is only responsible for the remainder — starting it from the full exponent
  // puts the optimiser in a valley it will not climb out of, and the spectrum
  // comes out near f^-4.
  const initChi = integratorC !== null ? Math.max(chi - 2, 0.05) : Math.max(chi, 0.05);
  const p = new Float64Array(coeffs.length);
  for (let i = 0; i < coeffs.length; i++) {
    const tau = -1 / Math.log(Math.max(coeffs[i], 1e-12));
    p[i] = Math.pow(Math.max(tau, 1e-6), initChi);
  }

  const model = new Float64Array(nGrid);
  const resid = new Float64Array(nGrid);
  const nIter = 900;
  const step = 0.4;

  for (let it = 0; it < nIter; it++) {
    for (let j = 0; j < nGrid; j++) {
      let s = 0;
      for (let i = 0; i < p.length; i++) s += p[i] * basis[i][j];
      model[j] = Math.max(s, 1e-300);
    }
    let offset = 0;
    for (let j = 0; j < nGrid; j++) offset += Math.log(model[j]) - logTarget[j];
    offset /= nGrid;
    for (let j = 0; j < nGrid; j++) resid[j] = Math.log(model[j]) - logTarget[j] - offset;

    for (let i = 0; i < p.length; i++) {
      let g = 0;
      for (let j = 0; j < nGrid; j++) {
        g += 2 * resid[j] * ((p[i] * basis[i][j]) / model[j]);
      }
      p[i] = Math.max(p[i] * Math.exp((-step * g) / nGrid), 1e-14);
    }
  }
  return p;
}

export type AperiodicOptions = {
  /** Spectral exponent chi. Awake resting ~1.0-1.8; NREM and propofol 2-3 (§2). */
  exponent?: number;
  /** Band over which the power law is fitted. */
  fLo?: number;
  fHi?: number;
  /** Number of OU components. More = closer to a clean power law, at linear cost. */
  components?: number;
  /** Output standard deviation, in microvolts. */
  rms?: number;
};

/**
 * Corner frequency of the optional integrator stage, as a fraction of fLo. It has
 * to sit well below the fitted band so the stage contributes a clean -2 slope
 * across the whole band rather than a knee inside it.
 */
const INTEGRATOR_CORNER_RATIO = 1 / 10;

/** Exponent above which a single OU bank can no longer reach the target slope. */
const BANK_MAX_EXPONENT = 1.9;

/**
 * A streaming 1/f^chi noise source. One instance per cortical patch — they must
 * be separate instances so that different patches are genuinely different
 * signals, leaving the forward model (not shared state) to create the
 * channel-to-channel correlation that volume conduction produces.
 */
export class AperiodicSource {
  private a: Float64Array;      // per-component AR(1) coefficient
  private q: Float64Array;      // per-component innovation scale
  private w: Float64Array;      // per-component output weight
  private x: Float64Array;      // per-component state
  private g: Gaussian;
  private scale: number;
  private varNorm = 1;

  private intC = 0;
  private intState = 0;
  private useIntegrator = false;

  readonly exponent: number;

  constructor(seed: number, dt: number, opts: AperiodicOptions = {}) {
    const {
      exponent = 1.4,
      fLo = 0.5,
      fHi = 60,
      components = 14,
      rms = 1,
    } = opts;

    this.exponent = exponent;
    this.g = new Gaussian(seed);
    const fs = 1 / dt;

    // Each component's power rolls off as f^-2, and a sum with non-negative
    // weights can never be steeper than its steepest member. So exponents beyond
    // ~2 are unreachable by the bank alone — which matters, because §2 puts NREM
    // and propofol at chi = 2-3. Past that ceiling, hand part of the slope to a
    // one-pole integrator sitting below the band and let the bank supply the rest.
    this.useIntegrator = exponent > BANK_MAX_EXPONENT;

    // Time constants log-spaced from "white at this sample rate" up to well below
    // the bottom of the fitted band. Going far below dt/3 buys nothing: those
    // components are already indistinguishable from white noise once sampled.
    const tauHi = 1 / (2 * Math.PI * (fLo / 8));
    const tauLo = Math.max(dt / 3, 1 / (2 * Math.PI * (fHi * 4)));

    this.a = new Float64Array(components);
    this.q = new Float64Array(components);
    this.w = new Float64Array(components);
    this.x = new Float64Array(components);

    for (let i = 0; i < components; i++) {
      const tau = tauLo * Math.pow(tauHi / tauLo, i / (components - 1));
      const a = Math.exp(-dt / tau);
      this.a[i] = a;
      this.q[i] = Math.sqrt(1 - a * a);   // keeps each component unit-variance
    }

    let tauInt = 0;
    if (this.useIntegrator) {
      tauInt = 1 / (2 * Math.PI * (fLo * INTEGRATOR_CORNER_RATIO));
      this.intC = Math.exp(-dt / tauInt);
    }

    const powers = fitComponentPowers(
      this.a, exponent, fLo, fHi, fs, this.useIntegrator ? this.intC : null,
    );

    for (let i = 0; i < components; i++) this.w[i] = Math.sqrt(powers[i]);

    // Output variance has a closed form, which matters because a process with
    // second-long correlations would need an impractically long burn-in to
    // measure it empirically. Without the integrator, independent unit-variance
    // components simply add: Var = sum(w^2). With it, for unit-variance AR(1)
    // input with coefficient a driving a one-pole with coefficient c,
    //   Var = (1-c)^2 (1 + c a) / ((1 - c^2)(1 - c a))
    let outVar = 0;
    for (let i = 0; i < components; i++) {
      const wi2 = this.w[i] * this.w[i];
      if (this.useIntegrator) {
        const a = this.a[i], c = this.intC;
        outVar += wi2 * (((1 - c) * (1 - c) * (1 + c * a)) / ((1 - c * c) * (1 - c * a)));
      } else {
        outVar += wi2;
      }
    }
    this.varNorm = 1 / Math.sqrt(outVar);
    this.scale = rms * this.varNorm;

    // Burn in so the slowest component starts from its stationary distribution
    // rather than from zero — otherwise every recording opens with a drift
    // transient as the long time constants charge up.
    const slowest = this.useIntegrator ? Math.max(tauHi, tauInt) : tauHi;
    const burn = Math.ceil((8 * slowest) / dt);
    for (let i = 0; i < burn; i++) this.next();
  }

  /** Advance one sample. */
  next(): number {
    let sum = 0;
    for (let i = 0; i < this.x.length; i++) {
      this.x[i] = this.a[i] * this.x[i] + this.q[i] * this.g.next();
      sum += this.w[i] * this.x[i];
    }
    if (this.useIntegrator) {
      this.intState = this.intC * this.intState + (1 - this.intC) * sum;
      sum = this.intState;
    }
    return sum * this.scale;
  }

  /** Retarget the output RMS, preserving the internal variance normalisation. */
  setRms(rms: number) {
    this.scale = rms * this.varNorm;
  }
}

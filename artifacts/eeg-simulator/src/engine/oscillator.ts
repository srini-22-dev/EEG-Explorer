/**
 * Cortical rhythms as noise-driven nonlinear oscillators.
 *
 * Briefing §3.4 — the Stuart–Landau (Hopf normal form) oscillator:
 *
 *     dz/dt = z (a + i*omega - |z|^2) + sigma * eta(t),   x(t) = Re(z)
 *
 * With `a < 0` the deterministic system is a stable fixed point, so the rhythm
 * exists only because noise keeps knocking it away from rest. That is what gives
 * a realistic linewidth, continuous waxing and waning, and intermittent bursting
 * — "where most cortical rhythms live". With `a > 0` it becomes a limit cycle:
 * metronomically regular, and appropriate only for pathological states.
 *
 * This replaces the previous approach of summing several fixed sinusoids. That
 * construction is *strictly periodic* — a sum of fixed tones with fixed
 * amplitudes and fixed phases repeats exactly at the beat period of its
 * components — so it reads as two sine waves multiplied together no matter how
 * many tones are added or how carefully their frequencies are chosen. §12 lists
 * it first among failure modes. No amount of tuning fixes it; the generator has
 * to be stochastic, which is what this is.
 *
 * Three further realism features are folded in, each from the briefing:
 *   - frequency wander (§3.2), an OU jitter on the centre frequency, which turns
 *     an implausibly sharp spectral line into a realistic 2-4 Hz FWHM peak;
 *   - long-range envelope correlation (§6), by driving the noise amplitude with
 *     an fGn-like process so envelope DFA lands near 0.7 instead of 0.5;
 *   - non-sinusoidal waveform shape (§5) via phase warping, which also generates
 *     the harmonics real rhythms have.
 */

import { Gaussian, deriveSeed } from './rng';
import { AperiodicSource } from './aperiodic';

/**
 * Phase distortion parameters. The output is cos(phi + b1*sin(phi) + b2*sin(2*phi))
 * rather than cos(phi).
 *
 * `b1` controls peak/trough asymmetry (arch- vs spike-shaped); `b2` controls
 * rise/decay asymmetry (sawtooth lean). Both are needed: §5 notes that
 * non-sinusoidal shape is what generates harmonics, and harmonics are what
 * produce spurious phase-amplitude coupling — so a simulator that cannot
 * generate shape cannot be used to check whether a PAC method is fooled by it.
 *
 * The map must stay monotonic in phi or the waveform folds back on itself, which
 * requires |b1| + 2|b2| < 1.
 */
export type PhaseWarp = { b1: number; b2: number };

export const NO_WARP: PhaseWarp = { b1: 0, b2: 0 };

/** Mu rhythm's arciform shape and its obligatory ~2f harmonic (§4). */
export const MU_WARP: PhaseWarp = { b1: 0.55, b2: 0.18 };

/**
 * Slow oscillation / delta. §4: this is an alternation of cortical UP and DOWN
 * states, not an oscillation, so the waveform is markedly non-sinusoidal — a
 * steep descending slope into the DOWN state and a flatter peak. A sinusoidal
 * delta is one of the more obvious tells in a sleep record.
 */
export const SLOW_WAVE_WARP: PhaseWarp = { b1: -0.45, b2: 0.22 };

export type OscillatorOptions = {
  /** Centre frequency in Hz. */
  freq: number;
  /**
   * Bifurcation parameter `a`. Must be negative for a noise-sustained rhythm.
   * Its magnitude sets the damping: correlation time is ~1/|a|, and the
   * Lorentzian linewidth contributed by damping alone is |a|/pi Hz.
   */
  damping?: number;
  /** Target output RMS in microvolts. */
  rms?: number;
  /** SD of the OU frequency jitter, Hz (§3.2 suggests ~0.5-1 for alpha). */
  freqWander?: number;
  /** Timescale of the frequency jitter, seconds. */
  freqWanderTau?: number;
  /** Depth of long-range-correlated drive modulation; 0 disables it. */
  envelopeDepth?: number;
  /** Waveform shape. */
  warp?: PhaseWarp;
  /**
   * Optional two-pole output low-pass corner, Hz. The oscillator is driven by white
   * noise, so its output carries a random-walk tail falling only as 1/f^2 above its
   * centre frequency. For a slow oscillator at slow-wave amplitudes that tail is
   * visible: in N3 it put 20-45 Hz "fuzz" on every row, lifting that band above the
   * awake record's (F3-C3 2.49 vs 1.94 uV RMS) when NREM should have LESS fast power
   * than wake. The aperiodic background already supplies the real 1/f floor, so the
   * tail is a double count; this removes it. Calibration runs through it, so `rms`
   * still holds.
   */
  outputLowPassHz?: number;
};

/** The drive modulator is slow, so it runs on a decimated clock to keep cost down. */
const MODULATOR_HZ = 25;

export class HopfOscillator {
  private x = 0;
  private y = 0;
  private a: number;
  private dt: number;
  private sqrtDt: number;
  private g: Gaussian;

  private omega: number;           // rad/s, centre
  private wanderSd: number;
  private wanderA = 0;             // OU decay for frequency jitter
  private wanderQ = 0;
  private wanderState = 0;

  private modulator: AperiodicSource | null = null;
  private modDecimate = 1;
  private modCounter = 0;
  private modValue = 1;
  private modDepth: number;

  private warp: PhaseWarp;
  private scale = 1;
  private currentRms = 1;
  private lpA = 0;
  private lp1 = 0;
  private lp2 = 0;

  /** Instantaneous envelope |z| of the most recent sample — ground truth (§14). */
  amplitude = 0;

  constructor(seed: number, dt: number, opts: OscillatorOptions) {
    const {
      freq,
      damping = -3,
      rms = 1,
      freqWander = 0.6,
      freqWanderTau = 2.5,
      envelopeDepth = 0.55,
      warp = NO_WARP,
      outputLowPassHz,
    } = opts;
    if (outputLowPassHz != null) this.lpA = 1 - Math.exp(-2 * Math.PI * outputLowPassHz * dt);

    if (damping >= 0) {
      throw new Error('HopfOscillator: damping must be < 0 (a >= 0 gives a limit cycle, not a rhythm)');
    }
    const monotonic = Math.abs(warp.b1) + 2 * Math.abs(warp.b2);
    if (monotonic >= 1) {
      throw new Error(`HopfOscillator: phase warp is non-monotonic (|b1| + 2|b2| = ${monotonic.toFixed(2)} must be < 1)`);
    }

    this.dt = dt;
    this.sqrtDt = Math.sqrt(dt);
    this.a = damping;
    this.omega = 2 * Math.PI * freq;
    this.wanderSd = freqWander;
    this.warp = warp;
    this.g = new Gaussian(seed);
    this.modDepth = envelopeDepth;

    if (freqWander > 0) {
      const aW = Math.exp(-dt / freqWanderTau);
      this.wanderA = aW;
      this.wanderQ = Math.sqrt(1 - aW * aW);
    }

    if (envelopeDepth > 0) {
      // fGn with Hurst H relates to a power-law exponent as chi = 2H - 1, so the
      // H ~ 0.7 that §6 calls for is chi ~ 0.4. Band-limited to the slow range
      // that vigilance and rhythm-strength actually vary over.
      this.modDecimate = Math.max(1, Math.round(1 / (MODULATOR_HZ * dt)));
      this.modulator = new AperiodicSource(deriveSeed(seed, 'envelope'), 1 / MODULATOR_HZ, {
        exponent: 0.4, fLo: 0.02, fHi: 1, components: 6, rms: 1,
      });
    }

    // Amplitude depends on a, sigma and dt through the cubic term in a way that
    // has no clean closed form, so calibrate empirically. Unlike the 1/f source
    // this is cheap: the oscillator's correlation time is well under a second, so
    // a short run gives a stable variance estimate.
    this.scale = 1;
    const warm = Math.ceil(8 / dt);
    for (let i = 0; i < warm; i++) this.next();
    const measureN = Math.ceil(40 / dt);
    let sumSq = 0;
    for (let i = 0; i < measureN; i++) {
      const v = this.next();
      sumSq += v * v;
    }
    const measured = Math.sqrt(sumSq / measureN);
    this.scale = measured > 0 ? rms / measured : 1;
    this.currentRms = rms;
  }

  /**
   * Additive frequency offset in Hz, applied from the next sample. 0 leaves the
   * oscillator exactly as configured. Used for the PDR's transient quickening after
   * eye closure ("alpha squeak", engine.ts ALPHA_SQUEAK_HZ).
   */
  freqOffset = 0;

  next(): number {
    // 1. frequency jitter
    let omega = this.omega + 2 * Math.PI * this.freqOffset;
    if (this.wanderSd > 0) {
      this.wanderState = this.wanderA * this.wanderState + this.wanderQ * this.g.next();
      omega += 2 * Math.PI * this.wanderSd * this.wanderState;
    }

    // 2. slow drive modulation, giving the envelope long-range correlation
    let drive = 1;
    if (this.modulator) {
      if (this.modCounter <= 0) {
        this.modValue = Math.exp(this.modDepth * this.modulator.next());
        this.modCounter = this.modDecimate;
      }
      this.modCounter--;
      drive = this.modValue;
    }

    // 3. Stuart-Landau step, split so the rotation is applied exactly.
    //    Integrating the rotation with plain Euler at 250 Hz would leave a
    //    systematic frequency error at alpha rates (omega*dt is ~0.25 rad/step).
    const r2 = this.x * this.x + this.y * this.y;
    const growth = 1 + (this.a - r2) * this.dt;
    const wdt = omega * this.dt;
    const c = Math.cos(wdt), s = Math.sin(wdt);
    const xr = this.x * c - this.y * s;
    const yr = this.x * s + this.y * c;
    const noise = drive * this.sqrtDt;
    this.x = xr * growth + noise * this.g.next();
    this.y = yr * growth + noise * this.g.next();

    // 4. read out with phase warping.
    //    Expressed algebraically in x and y rather than via atan2: with
    //    sin(phi)=y/A and cos(phi)=x/A, the warped output A*cos(phi+d) reduces to
    //    x*cos(d) - y*sin(d), which avoids an atan2 and a divide per sample.
    const A = Math.sqrt(this.x * this.x + this.y * this.y);
    this.amplitude = A * this.scale;
    if (A < 1e-12) return 0;
    const sinPhi = this.y / A;
    const cosPhi = this.x / A;
    const d = this.warp.b1 * sinPhi + 2 * this.warp.b2 * sinPhi * cosPhi;
    const out = (this.x * Math.cos(d) - this.y * Math.sin(d)) * this.scale;
    if (this.lpA === 0) return out;
    this.lp1 += this.lpA * (out - this.lp1);
    this.lp2 += this.lpA * (this.lp1 - this.lp2);
    return this.lp2;
  }

  /** Retarget output RMS, preserving the empirical calibration from construction. */
  setRms(rms: number) {
    if (this.currentRms > 0) this.scale *= rms / this.currentRms;
    this.currentRms = rms;
  }
}

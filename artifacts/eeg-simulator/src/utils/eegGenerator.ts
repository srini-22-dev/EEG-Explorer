import { Electrode, ALL_ELECTRODES } from './montages';

// ─── Types ───────────────────────────────────────────────────────────────────

export type PatientState = 'awake' | 'drowsy' | 'n1' | 'n2' | 'n3';

export type SimSettings = {
  speed: 15 | 30 | 60;
  sensitivity: 5 | 7 | 10 | 15;
  patientState: PatientState;
  activePatterns: Set<string>;
};

// ─── Tone Sets (Oscillatory Carriers) ────────────────────────────────────────

const THETA_TONES = [
  { f: 4.3, a: 1.0 }, { f: 5.1, a: 0.8 }, { f: 5.9, a: 0.9 },
  { f: 6.5, a: 0.6 }, { f: 7.2, a: 0.7 }
];
const DELTA_TONES = [
  { f: 0.8, a: 1.0 }, { f: 1.3, a: 0.9 }, { f: 1.7, a: 0.8 }, { f: 2.1, a: 0.7 }
];
const BETA_TONES = [
  { f: 14.2, a: 1.0 }, { f: 16.8, a: 0.9 }, { f: 19.4, a: 0.8 }, { f: 23.1, a: 0.7 }
];
const SPINDLE_TONES = [
  { f: 12.3, a: 0.8 }, { f: 13.5, a: 1.0 }, { f: 14.8, a: 0.7 }
];
const MU_TONES = [
  { f: 9.2, a: 0.9 }, { f: 10.1, a: 1.0 }, { f: 11.1, a: 0.8 }
];

const ALPHA_TONES = [
  { f: 8.4,  a: 0.5  }, { f: 9.1,  a: 0.8  }, { f: 9.7,  a: 1.0  },
  { f: 10.3, a: 0.9  }, { f: 10.9, a: 0.6  }, { f: 8.8,  a: 0.35 },
  { f: 11.3, a: 0.3  }
];

function multiToneSignal(t: number, tones: { f: number; a: number }[], norm: number, freqOffset = 0, freqScale = 1): number {
  let s = 0;
  for (const { f, a } of tones) {
    s += a * Math.sin(2 * Math.PI * (f + freqOffset) * freqScale * t);
  }
  return s / norm;
}

const ALPHA_TONE_NORM = 2.4;
const THETA_TONE_NORM = 2.2;
const DELTA_TONE_NORM = 2.0;
const BETA_TONE_NORM = 2.0;
const SPINDLE_TONE_NORM = 1.6;
const MU_TONE_NORM = 1.7;

function alphaCarrier(t: number, freqOffset: number): number {
  const fundamental   = multiToneSignal(t, ALPHA_TONES, ALPHA_TONE_NORM, freqOffset, 1);
  const subharmonic   = multiToneSignal(t, ALPHA_TONES, ALPHA_TONE_NORM, freqOffset, 0.5);
  const supraharmonic = multiToneSignal(t, ALPHA_TONES, ALPHA_TONE_NORM, freqOffset, 2.0);
  return fundamental + 0.15 * subharmonic + 0.08 * supraharmonic;
}

// ─── Stochastic Envelope System (Dual Timescale) ─────────────────────────────

function stepOU(prev: number, dt: number, tau: number): number {
  const decay = Math.exp(-dt / tau);
  return decay * prev + (1 - decay) * (Math.random() * 2 - 1);
}

type EnvState = { slow: number; fast: number; lastT: number };
const envelopes = new Map<string, EnvState>();

function getEnvelope(key: string, t: number, tauSlow: number, tauFast: number): number {
  let env = envelopes.get(key);
  if (!env) {
    env = { slow: 0, fast: 0, lastT: t };
    envelopes.set(key, env);
  }
  const dt = t - env.lastT;
  if (dt > 0) {
    env.slow = stepOU(env.slow, dt, tauSlow);
    env.fast = stepOU(env.fast, dt, tauFast);
    env.lastT = t;
  }
  return 0.5 + 0.35 * env.slow + 0.15 * env.fast;
}

// ─── Event Timing & Jitter Helpers ───────────────────────────────────────────

const T: Record<string, number> = {};
const getT = (k: string) => T[k] ?? -1000;
const setT = (k: string, v: number) => { T[k] = v; };

const nextTimes = new Map<string, number>();
function nextEventTime(key: string, t: number, minInterval: number, maxInterval: number): boolean {
  let nt = nextTimes.get(key);
  if (nt === undefined) {
    nt = t + minInterval + Math.random() * (maxInterval - minInterval);
    nextTimes.set(key, nt);
  }
  if (t >= nt) {
    setT(key, t);
    // Exponentially-distributed random interval
    const delay = minInterval - Math.log(Math.random()) * ((maxInterval - minInterval) / 2);
    nextTimes.set(key, t + delay);
    return true;
  }
  return false;
}

const ampJitter = new Map<string, number>();
function getJitter(el: string) {
  let j = ampJitter.get(el);
  if (j === undefined) {
    j = 1 + (Math.random() - 0.5) * 0.3; // ±15% amplitude jitter per session
    ampJitter.set(el, j);
  }
  return j;
}

function jitter(base: number, frac: number) {
  return base * (1 + (Math.random() - 0.5) * 2 * frac);
}

// ─── Morphological Helpers ───────────────────────────────────────────────────

function gaussian(x: number, mu: number, sigma: number) {
  return Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));
}

function spikeSlowWave(dt: number, ampSpike: number, ampSlow: number): number {
  if (dt < 0 || dt > 0.9) return 0;
  const spike = ampSpike * gaussian(dt, 0.05, 0.022);
  const slow  = -ampSlow  * gaussian(dt, 0.45, 0.16);
  return spike + slow;
}

function triphasicWave(dt: number, amp: number): number {
  if (dt < 0 || dt > 0.7) return 0;
  const p1 = -amp * 0.25 * gaussian(dt, 0.06, 0.025);
  const p2 =  amp * 1.00 * gaussian(dt, 0.22, 0.06);
  const p3 = -amp * 0.50 * gaussian(dt, 0.48, 0.09);
  return p1 + p2 + p3;
}

export function getECGVoltage(t: number): number {
  const period = 60 / 72;
  const phase  = (t % period) / period;
  let v = 0;
  v += 0.12 * gaussian(phase, 0.18,  0.025);
  v -= 0.06 * gaussian(phase, 0.285, 0.008);
  v += 1.00 * gaussian(phase, 0.305, 0.012);
  v -= 0.12 * gaussian(phase, 0.330, 0.010);
  v += 0.25 * gaussian(phase, 0.520, 0.045);
  return v * 500;
}

// ─── Electrode classification ────────────────────────────────────────────────
function classify(el: string) {
  return {
    isOccipital: ['O1','O2'].includes(el),
    isParietal:  ['P3','P4','Pz'].includes(el),
    isPostTmp:   ['T5','T6'].includes(el),
    isFrontal:   ['Fp1','Fp2','F3','F4','F7','F8','Fz'].includes(el),
    isCentral:   ['C3','Cz','C4'].includes(el),
    isTemporal:  ['T3','T4'].includes(el),
    isLeftTmp:   ['T3','F7','T5'].includes(el),
    isRightTmp:  ['T4','F8','T6'].includes(el),
    isLeftFront: ['F3','Fp1'].includes(el),
    isMidline:   ['Fz','Cz','Pz'].includes(el),
  };
}

// ─── Generators & Field Maps ─────────────────────────────────────────────────

const SAMPLE_DT = 1 / 250;

const PDR_FIELD: Record<'L' | 'R', Record<string, number>> = {
  L: { O1: 1.00, P3: 0.67, T5: 0.31 },
  R: { O2: 1.00, P4: 0.67, T6: 0.31 },
};
const PDR_CEILING = 42;

type PdrHemisphereState = {
  freqOffset: number; gain: number;
  lastT: number; slowNoise: number; fastNoise: number; freqWander: number; microNoise: number;
};
function makePdrHemisphereState(): PdrHemisphereState {
  return {
    freqOffset: (Math.random() - 0.5) * 0.4,
    gain: 0.85 + Math.random() * 0.3,
    lastT: -Infinity, slowNoise: 0, fastNoise: 0, freqWander: 0, microNoise: 0,
  };
}
const pdrState: Record<'L' | 'R', PdrHemisphereState> = { L: makePdrHemisphereState(), R: makePdrHemisphereState() };

function pdrAdvance(side: 'L' | 'R', t: number): PdrHemisphereState {
  const s = pdrState[side];
  if (t > s.lastT) {
    const dt = s.lastT === -Infinity ? 0 : Math.min(t - s.lastT, 0.25);
    s.slowNoise  = stepOU(s.slowNoise,  dt, 5);
    s.fastNoise  = stepOU(s.fastNoise,  dt, 1.2);
    s.freqWander = stepOU(s.freqWander, dt, 6);
    s.microNoise = stepOU(s.microNoise, dt, 0.35);
    s.lastT = t;
  }
  return s;
}
function pdrContribution(side: 'L' | 'R', el: string, t: number): number {
  const gain = PDR_FIELD[side][el];
  if (!gain) return 0;
  const s = pdrAdvance(side, t);
  const combinedNoise = 0.65 * s.slowNoise + 0.35 * s.fastNoise;
  // A relaxed, eyes-closed awake patient's PDR wanes but rarely collapses to a flat
  // baseline for a full second+ — keep a floor under the envelope (was 0.5±0.5, i.e.
  // could hit ~0) so it reads as continuously-present-but-fluctuating rather than a
  // series of isolated, clean on/off "spindle" bursts.
  const env = 0.6 + 0.4 * combinedNoise;
  // Ripple individual cycles' peak height so a burst isn't one textbook-smooth
  // symmetric AM envelope — real alpha is raggeder cycle-to-cycle.
  const microRipple = 1 + 0.15 * s.microNoise;
  const freq = s.freqOffset + s.freqWander * 0.35;
  return PDR_CEILING * gain * s.gain * env * microRipple * alphaCarrier(t, freq) * getJitter(el);
}

// Frontal Beta Generator
const FBETA_FIELD: Record<string, number> = {
  Fp1: 0.8, Fp2: 0.8, F3: 1.0, F4: 1.0, Fz: 1.0, F7: 0.6, F8: 0.6, C3: 0.4, C4: 0.4, Cz: 0.5
};
function frontalBetaContribution(el: string, t: number): number {
  const gain = FBETA_FIELD[el];
  if (!gain) return 0;
  const env = getEnvelope('fbeta', t, 3.0, 0.8);
  const carrier = multiToneSignal(t, BETA_TONES, BETA_TONE_NORM);
  return 10 * gain * env * carrier * getJitter(el);
}

// Anterior Theta Generator
const ATHETA_FIELD: Record<string, number> = {
  Fz: 1.0, Cz: 0.8, F3: 0.6, F4: 0.6, C3: 0.4, C4: 0.4
};
function anteriorThetaContribution(el: string, t: number): number {
  const gain = ATHETA_FIELD[el];
  if (!gain) return 0;
  const env = getEnvelope('atheta', t, 4.0, 1.0);
  const carrier = multiToneSignal(t, THETA_TONES, THETA_TONE_NORM);
  return 5 * gain * env * carrier * getJitter(el);
}

// EMG Generator
const EMG_FIELD: Record<string, number> = {
  Fp1: 1, Fp2: 1, F3: 1, F4: 1, F7: 1, F8: 1, Fz: 1,
  T3: 0.75, T4: 0.75, T5: 0.75, T6: 0.75,
  C3: 0.5, C4: 0.5, Cz: 0.5, Pz: 0.5,
};
function emgContribution(el: string, t: number): number {
  const gain = EMG_FIELD[el];
  if (!gain) return 0;
  // Use OU amplitude envelope (tau ~ 0.3s) for noise modulation, no sine components
  const env = getEnvelope('emg', t, 0.3, 0.1);
  return 6 * gain * env * (Math.random() * 2 - 1) * getJitter(el);
}

// Diffuse Background
const diffuseNoise = new Map<string, {val: number, wander: number}>();
[...ALL_ELECTRODES, 'A1', 'A2'].forEach(el => diffuseNoise.set(el, {val: 0, wander: 0}));

function diffuseBackgroundContribution(el: string): number {
  const st = diffuseNoise.get(el)!;
  const decayFast = Math.exp(-SAMPLE_DT / 0.09);
  const decaySlow = Math.exp(-SAMPLE_DT / 0.5);
  st.val = decayFast * st.val + (1 - decayFast) * (Math.random() * 2 - 1);
  st.wander = decaySlow * st.wander + (1 - decaySlow) * (Math.random() * 2 - 1);
  return 2.5 * st.val + 4.0 * st.wander;
}

export function resetGenerator() {
  Object.keys(T).forEach(k => { T[k] = -1000; });
  nextTimes.clear();
  envelopes.clear();
  (['L', 'R'] as const).forEach(side => {
    pdrState[side].lastT = -Infinity;
    pdrState[side].slowNoise = 0;
    pdrState[side].fastNoise = 0;
    pdrState[side].freqWander = 0;
  });
  diffuseNoise.forEach((v) => { v.val = 0; v.wander = 0; });
}

// ─── Background States ───────────────────────────────────────────────────────

function backgroundSignal(el: string, t: number, st: PatientState, ap: Set<string>): number {
  const c = classify(el);
  const j = getJitter(el);
  const isPost = c.isOccipital || c.isParietal || c.isPostTmp;

  if (ap.has('gen-slowing')) {
    let v = 0;
    const thetaAmp = isPost ? 20 : c.isCentral ? 16 : 14;
    const deltaAmp = isPost ? 16 : 12;
    const envT = getEnvelope('gen-slowing-theta', t, 2.0, 0.5);
    const envD = getEnvelope('gen-slowing-delta', t, 3.0, 0.8);
    v += thetaAmp * envT * multiToneSignal(t, THETA_TONES, THETA_TONE_NORM);
    v += deltaAmp * envD * multiToneSignal(t, DELTA_TONES, DELTA_TONE_NORM);
    v += diffuseBackgroundContribution(el);
    return v * j;
  }

  let v = 0;
  if (st === 'awake') {
    v += pdrContribution('L', el, t);
    v += pdrContribution('R', el, t);
    v += frontalBetaContribution(el, t);
    v += anteriorThetaContribution(el, t);
    v += diffuseBackgroundContribution(el);
    v += emgContribution(el, t);
  } else if (st === 'drowsy') {
    const thetaAmp = isPost ? 22 : c.isCentral ? 14 : c.isTemporal ? 12 : c.isFrontal ? 10 : 8;
    v += thetaAmp * getEnvelope('drowsy-theta', t, 2, 1) * multiToneSignal(t, THETA_TONES, THETA_TONE_NORM);
    const alphaRemnant = c.isOccipital ? 10 : c.isParietal ? 6 : 0;
    v += alphaRemnant * getEnvelope('drowsy-alpha', t, 1, 0.5) * alphaCarrier(t, 0);
    v += 4 * multiToneSignal(t, BETA_TONES, BETA_TONE_NORM);
    v += diffuseBackgroundContribution(el);
  } else if (st === 'n1') {
    const thetaAmp = isPost ? 20 : c.isCentral ? 16 : c.isTemporal ? 14 : 12;
    v += thetaAmp * getEnvelope('n1-theta', t, 2.5, 0.8) * multiToneSignal(t, THETA_TONES, THETA_TONE_NORM);
    v += 10 * getEnvelope('n1-delta', t, 3, 1) * multiToneSignal(t, DELTA_TONES, DELTA_TONE_NORM);
    const alphaRemnant = c.isOccipital ? 2 : 0;
    v += alphaRemnant * alphaCarrier(t, 0);
    v += diffuseBackgroundContribution(el);
  } else if (st === 'n2') {
    const thetaAmp = isPost ? 16 : 12;
    v += thetaAmp * getEnvelope('n2-theta', t, 2, 1) * multiToneSignal(t, THETA_TONES, THETA_TONE_NORM);
    v += 14 * getEnvelope('n2-delta', t, 4, 1.5) * multiToneSignal(t, DELTA_TONES, DELTA_TONE_NORM);
    v += diffuseBackgroundContribution(el);
  } else { // n3
    const deltaAmp = isPost ? 55 : c.isCentral ? 60 : c.isFrontal ? 50 : 45;
    v += deltaAmp * getEnvelope('n3-delta', t, 5, 2) * multiToneSignal(t, DELTA_TONES, DELTA_TONE_NORM);
    v += 18 * getEnvelope('n3-theta', t, 2, 1) * multiToneSignal(t, THETA_TONES, THETA_TONE_NORM);
    v += diffuseBackgroundContribution(el);
  }
  return v * j;
}

// ─── Sleep Architecture ──────────────────────────────────────────────────────

function sleepStructureVoltage(el: string, t: number, st: PatientState, ap: Set<string>): number {
  const c = classify(el);
  let v = 0;

  // Vertex sharp waves
  const wantsV = ap.has('v-waves') || st === 'n1' || st === 'n2';
  if (wantsV && (c.isCentral || c.isMidline)) {
    const interval = st === 'n2' ? 8 : 14;
    if (nextEventTime('vwave', t, interval - 2, interval + 2)) {
      setT('vwave-sharp-dur', jitter(0.22, 0.2));
      setT('vwave-amp', jitter(1, 0.25));
    }
    const dt = t - getT('vwave');
    if (dt > 0 && dt < 0.9) {
      const amp = (el === 'Cz' ? 140 : (c.isCentral ? 70 : 40)) * getT('vwave-amp');
      const dur = getT('vwave-sharp-dur');
      v -= amp * Math.sin(2 * Math.PI * 2 * dt) * gaussian(dt, dur, 0.1);
    }
  }

  // K-complexes
  const wantsK = ap.has('k-complex') || st === 'n2';
  if (wantsK && (c.isMidline || c.isCentral || el === 'F3' || el === 'F4')) {
    const interval = st === 'n2' ? 14 : 22;
    if (nextEventTime('kcomplex', t, interval - 3, interval + 5)) {
      setT('k-amp-sharp', jitter(1, 0.2));
      setT('k-amp-slow', jitter(1, 0.2));
      setT('k-sharp-dur', jitter(0.20, 0.1));
    }
    const dt = t - getT('kcomplex');
    if (dt > 0 && dt < 2.2) {
      const baseAmp = c.isMidline ? 240 : (c.isCentral ? 120 : 80);
      const sharp = -baseAmp * getT('k-amp-sharp') * Math.sin(2 * Math.PI * 3 * dt) * gaussian(dt, getT('k-sharp-dur'), 0.08);
      const slow = baseAmp * 0.9 * getT('k-amp-slow') * Math.sin(2 * Math.PI * 0.8 * dt) * gaussian(dt, 0.70, 0.24);
      v += sharp + slow;
      if (dt > 0.5 && dt < 1.5 && getT('k-amp-sharp') > 1) {
         // occasional evoked spindle
         v += 20 * gaussian(dt, 1.0, 0.2) * multiToneSignal(dt, SPINDLE_TONES, SPINDLE_TONE_NORM);
      }
    }
  }

  // Sleep spindles
  const wantsSp = ap.has('spindles') || st === 'n2';
  if (wantsSp && (c.isCentral || c.isMidline)) {
    const interval = st === 'n2' ? 6 : 12;
    if (nextEventTime('spindle', t, interval - 2, interval + 4)) {
      setT('spindle-dur', jitter(1.0, 0.5));
      setT('spindle-amp', jitter(1, 0.25));
    }
    const dt = t - getT('spindle');
    const dur = getT('spindle-dur');
    if (dt > 0 && dt < dur * 2) {
      const amp = (el === 'Cz' ? 48 : (c.isCentral ? 30 : 20)) * getT('spindle-amp');
      // asymmetric envelope
      const env = dt < dur/2 ? gaussian(dt, dur/2, dur/4) : gaussian(dt, dur/2, dur/3);
      v += amp * env * multiToneSignal(dt, SPINDLE_TONES, SPINDLE_TONE_NORM);
    }
  }

  // POSTS
  const wantsPosts = ap.has('posts') || st === 'n1' || st === 'n2';
  if (wantsPosts && (c.isOccipital || c.isParietal)) {
    if (nextEventTime('posts', t, 1.0, 3.0)) {
      setT('posts-amp', jitter(1, 0.2));
      setT('posts-dur', jitter(0.1, 0.3));
    }
    const dt = t - getT('posts');
    const dur = getT('posts-dur');
    if (dt > 0 && dt < dur) {
      v += 75 * getT('posts-amp') * Math.sin(Math.PI * dt / dur);
    } else if (dt > dur && dt < dur * 2.2 && getT('posts-amp') > 1.1) {
      // occasional run of 2-4
      v += 50 * getT('posts-amp') * Math.sin(Math.PI * (dt-dur) / dur);
    }
  }

  return v;
}

// ─── Normal Variants ─────────────────────────────────────────────────────────

const PSWY_FIELD: Record<string, number> = { O1: 1.00, O2: 1.00, P3: 0.67, P4: 0.67 };

function variantVoltage(el: string, t: number, st: PatientState, ap: Set<string>): number {
  const c = classify(el);
  let v = 0;

  if (ap.has('mu-rhythm') && (c.isCentral || el === 'Cz')) {
    const env = getEnvelope('mu', t, 3.0, 1.0);
    const carrier = multiToneSignal(t, MU_TONES, MU_TONE_NORM);
    // fragmentation / arch shape
    v += 38 * env * Math.abs(carrier);
  }

  if (ap.has('wicket') && st === 'drowsy' && (c.isTemporal || c.isPostTmp || el === 'F7' || el === 'F8')) {
    if (nextEventTime('wicket', t, 2, 5)) {
      setT('wicket-amp', jitter(1, 0.2));
      setT('wicket-dur', jitter(0.9, 0.3));
    }
    const dt = t - getT('wicket');
    const dur = getT('wicket-dur');
    if (dt > 0 && dt < dur) {
      const env = gaussian(dt, dur/2, dur/4);
      const carrier = multiToneSignal(t, ALPHA_TONES, ALPHA_TONE_NORM);
      v += 90 * getT('wicket-amp') * env * Math.abs(carrier);
    }
  }

  if (ap.has('rmtd') && st === 'drowsy' && (c.isTemporal || el === 'T3' || el === 'T4')) {
    if (nextEventTime('rmtd', t, 3, 6)) {
      setT('rmtd-amp', jitter(1, 0.1));
    }
    const dt = t - getT('rmtd');
    if (dt > 0 && dt < 4) {
      const env = gaussian(dt, 2, 1.2);
      v += 65 * getT('rmtd-amp') * env * multiToneSignal(dt, THETA_TONES, THETA_TONE_NORM);
    }
  }

  if (ap.has('lambda') && (c.isOccipital || c.isParietal)) {
    if (nextEventTime('lambda', t, 0.6, 1.2)) {
      setT('lambda-amp', jitter(1, 0.25));
      setT('lambda-dur', jitter(0.15, 0.2));
    }
    const dt = t - getT('lambda');
    const dur = getT('lambda-dur');
    if (dt > 0 && dt < dur) {
      v += 60 * getT('lambda-amp') * Math.sin(Math.PI * dt / dur);
    }
  }

  if (ap.has('pswy') && st === 'awake' && PSWY_FIELD[el]) {
    if (nextEventTime('pswy', t, 2.5, 5.0)) {
      setT('pswy-dur', jitter(1.0, 0.3));
    }
    const dt = t - getT('pswy');
    const dur = getT('pswy-dur');
    if (dt > 0 && dt < dur) {
      const env = gaussian(dt, dur/2, dur/3);
      v += 95 * PSWY_FIELD[el] * env * multiToneSignal(dt, DELTA_TONES, DELTA_TONE_NORM);
    }
  }

  if (ap.has('6hz-sw')) {
    if (nextEventTime('6hz-sw', t, 3, 6)) {
      setT('6hz-amp', jitter(1, 0.2));
    }
    const dt = t - getT('6hz-sw');
    if (dt >= 0 && dt < 1) {
      const dtInCycle = dt % (1/6);
      const amp = getT('6hz-amp');
      v += 50 * amp * gaussian(dtInCycle, 0.02, 0.008);
      v -= 30 * amp * gaussian(dtInCycle, 0.1,  0.035);
    }
  }

  if (ap.has('14-6-pos') && (c.isPostTmp || c.isTemporal)) {
    if (nextEventTime('14-6', t, 4, 8)) {
      setT('14-6-ratio', jitter(0.6, 0.4)); // vary relative amplitudes
    }
    const dt = t - getT('14-6');
    if (dt > 0 && dt < 1.0) {
      const env = gaussian(dt, 0.5, 0.25);
      const r = getT('14-6-ratio');
      v += 55 * env * r * Math.abs(multiToneSignal(dt, [{f:14, a:1}], 1));
      v += 35 * env * (1-r) * Math.abs(multiToneSignal(dt, [{f:6, a:1}], 1));
    }
  }

  if (ap.has('bets') && (c.isTemporal || el === 'F7' || el === 'F8')) {
    if (nextEventTime('bets', t, 4, 9)) {
      setT('bets-amp', jitter(1, 0.3));
      setT('bets-side', Math.random() < 0.5 ? 1 : -1);
      setT('bets-decay', jitter(60, 0.2));
    }
    const isTarget = getT('bets-side') === 1 ? (c.isLeftTmp || el === 'F7') : (c.isRightTmp || el === 'F8');
    if (isTarget) {
      const dt = t - getT('bets');
      if (dt > 0 && dt < 0.05) {
        v += 40 * getT('bets-amp') * Math.exp(-dt * getT('bets-decay'));
      }
    }
  }

  return v;
}

// ─── Artifacts ───────────────────────────────────────────────────────────────

function artifactVoltage(el: string, t: number, ap: Set<string>): number {
  const c = classify(el);
  let v = 0;

  if (ap.has('blink')) {
    if (nextEventTime('blink', t, 2, 5)) {
      setT('blink-amp', jitter(1, 0.15));
      setT('blink-dur', jitter(1, 0.2));
      setT('blink-double', Math.random() < 0.2 ? 1 : 0);
    }
    const dt = t - getT('blink');
    const bDur = getT('blink-dur');
    const isDouble = getT('blink-double') === 1;
    for (let i = 0; i < (isDouble ? 2 : 1); i++) {
      const offset = i * 0.4;
      if (dt > offset && dt < offset + 0.3 * bDur) {
        const localDt = (dt - offset) / bDur;
        if (['Fp1','Fp2'].includes(el)) {
          v +=  60 * getT('blink-amp') * gaussian(localDt, 0.05, 0.025);
          v -= 280 * getT('blink-amp') * gaussian(localDt, 0.16, 0.06);
        } else if (['F3','F4','F7','F8'].includes(el)) {
          v +=  20 * getT('blink-amp') * gaussian(localDt, 0.05, 0.025);
          v -=  90 * getT('blink-amp') * gaussian(localDt, 0.16, 0.06);
        }
      }
    }
  }

  if (ap.has('eye-movement')) {
    if (nextEventTime('eye-mv', t, 3, 6)) {
      setT('eye-mv-amp', jitter(1, 0.2));
    }
    const dt = t - getT('eye-mv');
    if (dt > 0 && dt < 0.8) {
      // asymmetric onset/offset
      const env = dt < 0.25 ? gaussian(dt, 0.25, 0.08) : gaussian(dt, 0.25, 0.15);
      const pulse = 180 * getT('eye-mv-amp') * env;
      if (['F7','Fp1','T3'].includes(el)) v += pulse;
      if (['F8','Fp2','T4'].includes(el)) v -= pulse;
    }
  }

  if (ap.has('muscle')) {
    if (c.isTemporal || c.isFrontal || c.isPostTmp) {
      const env = getEnvelope('art-muscle', t, 0.3, 0.1);
      v += 60 * env * (Math.random() - 0.5);
    }
  }

  if (ap.has('chewing') && (c.isTemporal || el === 'T3' || el === 'T4')) {
    if (nextEventTime('chew', t, 0.5, 0.8)) {
      setT('chew-amp', jitter(1, 0.3));
      // cluster logic
    }
    const dt = t - getT('chew');
    if (dt > 0 && dt < 0.25) {
      v += 300 * getT('chew-amp') * gaussian(dt, 0.1, 0.05) * (1 + 0.3 * Math.random());
      // simultaneous EMG
      v += 50 * getT('chew-amp') * (Math.random() - 0.5);
    }
  }

  if (ap.has('electrode-pop')) {
    if (nextEventTime('pop-time', t, 3, 7)) {
      setT('pop-el', ALL_ELECTRODES.indexOf(ALL_ELECTRODES[Math.floor(Math.random() * ALL_ELECTRODES.length)]));
      setT('pop-amp', jitter(1, 0.3));
      setT('pop-freq', jitter(6, 0.3)); // 4-8Hz
    }
    const popIdx = Math.round(getT('pop-el'));
    if (ALL_ELECTRODES[popIdx] === el) {
      const dt = t - getT('pop-time');
      if (dt > 0 && dt < 1.5) {
        v += 350 * getT('pop-amp') * Math.exp(-dt * 12) * Math.cos(2 * Math.PI * getT('pop-freq') * dt);
        // occasional baseline drift
        if (getT('pop-amp') > 1.1) {
           v += 100 * getT('pop-amp') * gaussian(dt, 0.5, 0.3);
        }
      }
    }
  }

  if (ap.has('sweat') && (c.isFrontal || ['F3','F4'].includes(el))) {
    if (nextEventTime('sweat', t, 6, 12)) {
      setT('sweat-amp', jitter(1, 0.2));
    }
    const dt = t - getT('sweat');
    if (dt > 0 && dt < 12) {
      // asymmetric slow wave
      const env = dt < 4 ? gaussian(dt, 4, 1.5) : gaussian(dt, 4, 3);
      v += 220 * getT('sweat-amp') * multiToneSignal(dt, [{f:0.1, a:1}, {f:0.15, a:0.5}], 1) * env;
    }
  }

  if (ap.has('50hz')) {
    const j = getJitter(el + '-50hz');
    // ±5% fluctuation
    const fluct = 1 + 0.05 * Math.sin(2 * Math.PI * 0.2 * t);
    v += 45 * j * fluct * Math.sin(2 * Math.PI * 50 * t);
  }

  return v;
}

// ─── Non-epileptiform Abnormalities ──────────────────────────────────────────

function abnormalVoltage(el: string, t: number, ap: Set<string>): number {
  const c = classify(el);
  let v = 0;

  if (ap.has('firda') && (c.isFrontal || c.isMidline)) {
    if (nextEventTime('firda-burst', t, 4, 8)) {
      setT('firda-dur', jitter(3, 0.3));
    }
    const dt = t - getT('firda-burst');
    if (dt >= 0 && dt < getT('firda-dur')) {
      const env = getEnvelope('firda-env', t, 0.5, 0.1);
      v += 100 * env * multiToneSignal(dt, [{f:2.4, a:1}, {f:2.6, a:0.8}], 1.8);
    }
  }

  if (ap.has('focal-delta-temporal') && (c.isLeftTmp || el === 'F7')) {
    if (nextEventTime('fdt-burst', t, 3, 6)) {
      setT('fdt-dur', jitter(2.5, 0.3));
    }
    const dt = t - getT('fdt-burst');
    if (dt >= 0 && dt < getT('fdt-dur')) {
      v += 80 * multiToneSignal(dt, [{f:1.2, a:1}, {f:1.8, a:0.9}, {f:2.2, a:0.8}, {f:2.5, a:0.6}], 2.5);
    }
  }

  if (ap.has('triphasic')) {
    if (nextEventTime('triphasic', t, 0.5, 1.2)) {
      setT('tri-amp', jitter(1, 0.2));
    }
    const baseDt = t - getT('triphasic');
    // anterior-posterior time lag
    const lag = c.isOccipital ? 0.04 : c.isParietal ? 0.02 : c.isCentral ? 0.01 : 0;
    const dt = baseDt - lag;
    if (dt > 0) {
      const antAmp = (c.isFrontal ? 180 : c.isMidline ? 160 : c.isCentral ? 120 : 80) * getT('tri-amp');
      v += triphasicWave(dt, antAmp);
    }
  }

  if (ap.has('gpeds')) {
    if (nextEventTime('gped', t, 1.0, 2.0)) {
      setT('gped-amp', jitter(1, 0.2));
      setT('gped-morph', jitter(1, 0.15));
    }
    const dt = t - getT('gped');
    if (dt < 0.2) {
      const amp = (c.isFrontal || c.isMidline ? 200 : 150) * getT('gped-amp');
      const morph = getT('gped-morph');
      v += amp * gaussian(dt, 0.05 * morph, 0.02 * morph);
      v -= amp * 0.5 * gaussian(dt, 0.11 * morph, 0.04 * morph);
    }
  }

  if (ap.has('lpeds') && (c.isLeftTmp || el === 'F7')) {
    if (nextEventTime('lped', t, 0.8, 1.5)) {
      setT('lped-amp', jitter(1, 0.2));
      setT('lped-morph', jitter(1, 0.2));
    }
    const dt = t - getT('lped');
    if (dt < 0.25) {
      const amp = (c.isLeftTmp ? 220 : 120) * getT('lped-amp');
      const morph = getT('lped-morph');
      v += spikeSlowWave(dt / morph, amp, amp * 0.6);
    }
    // background slowing for this region
    v += 40 * getEnvelope('lped-slow', t, 2, 0.5) * multiToneSignal(t, DELTA_TONES, DELTA_TONE_NORM);
  }

  return v;
}

// ─── Interictal Epileptiform ─────────────────────────────────────────────────

const LT_FIELD: Record<string, number> = { T3: 1.0, F7: 0.5, T5: 0.42, Fp1: 0.15, O1: 0.07, C3: 0.1, P3: 0.05 };
const RT_FIELD: Record<string, number> = { T4: 1.0, F8: 0.5, T6: 0.42, Fp2: 0.15, O2: 0.07, C4: 0.1, P4: 0.05 };
const LF_FIELD: Record<string, number> = { F3: 1.0, Fp1: 0.58, Fz: 0.32, C3: 0.22, F7: 0.18, Cz: 0.1, Fp2: 0.08, F4: 0.12 };

function epileptiformVoltage(el: string, t: number, ap: Set<string>): number {
  const c = classify(el);
  let v = 0;

  if (ap.has('focal-spikes-lt')) {
    if (nextEventTime('lt-spike', t, 3, 7)) {
      setT('lt-amp', jitter(1, 0.2));
      setT('lt-dur', jitter(1, 0.15));
    }
    const dt = t - getT('lt-spike');
    const att = LT_FIELD[el] ?? 0;
    if (att > 0) v += att * getT('lt-amp') * spikeSlowWave(dt / getT('lt-dur'), 185, 130);
  }

  if (ap.has('focal-spikes-rt')) {
    if (nextEventTime('rt-spike', t, 3, 7)) {
      setT('rt-amp', jitter(1, 0.2));
      setT('rt-dur', jitter(1, 0.15));
    }
    const dt = t - getT('rt-spike');
    const att = RT_FIELD[el] ?? 0;
    if (att > 0) v += att * getT('rt-amp') * spikeSlowWave(dt / getT('rt-dur'), 185, 130);
  }

  if (ap.has('focal-spikes-lf')) {
    if (nextEventTime('lf-spike', t, 4, 8)) {
      setT('lf-amp', jitter(1, 0.2));
      setT('lf-dur', jitter(1, 0.15));
    }
    const dt = t - getT('lf-spike');
    const att = LF_FIELD[el] ?? 0;
    if (att > 0) v += att * getT('lf-amp') * spikeSlowWave(dt / getT('lf-dur'), 165, 120);
  }

  if (ap.has('3hz-gsw')) {
    if (nextEventTime('3hz-gsw-burst', t, 3, 7)) {
      setT('3hz-dur', jitter(3, 0.2));
      setT('3hz-freq', jitter(3.0, 0.06)); // 2.8-3.2Hz
    }
    const burstDt = t - getT('3hz-gsw-burst');
    const dur = getT('3hz-dur');
    if (burstDt >= 0 && burstDt < dur) {
      const cycle = 1 / getT('3hz-freq');
      const dt = burstDt % cycle;
      // gradual burst ending (decrement)
      const env = burstDt > dur - 1.0 ? 1.0 - (burstDt - (dur - 1.0)) : 1.0;
      const amp = (c.isFrontal || c.isMidline ? 200 : 160) * env;
      v += spikeSlowWave(dt, amp, amp * 0.65);
    }
  }

  if (ap.has('polyspike-wave')) {
    if (nextEventTime('psw-burst', t, 4, 8)) {
      setT('psw-count', Math.floor(2 + Math.random() * 4)); // 2-5 polyspikes
      setT('psw-amp', jitter(1, 0.25));
    }
    const burstDt = t - getT('psw-burst');
    if (burstDt >= 0 && burstDt < 3) {
      // freq evolution
      const cycleLen = 0.35 + burstDt * 0.05;
      const dt = burstDt % cycleLen;
      const amp = (c.isFrontal || c.isMidline ? 180 : 140) * getT('psw-amp');
      const count = getT('psw-count');
      for (let i=0; i<count; i++) {
        v += amp * jitter(0.8, 0.2) * gaussian(dt, 0.03 + i*0.04, 0.015);
      }
      v -= amp * 0.7 * gaussian(dt, 0.03 + count*0.04 + 0.1, 0.07);
    }
  }

  if (ap.has('hypsarrhythmia')) {
    // Independent, mutually-desynchronized delta generators — no organized shared background
    const delta1 = multiToneSignal(t, DELTA_TONES, DELTA_TONE_NORM);
    const delta2 = multiToneSignal(t, DELTA_TONES, DELTA_TONE_NORM, 0.2, 1.1);
    const delta3 = multiToneSignal(t, DELTA_TONES, DELTA_TONE_NORM, -0.15, 0.95);
    v += (c.isFrontal ? 150 : 90) * delta1;
    v += (c.isOccipital || c.isParietal ? 150 : 90) * delta2;
    v += (c.isCentral || c.isTemporal ? 120 : 90) * delta3;

    // Multifocal spikes: each electrode gets its own independent trigger/amplitude so
    // spikes appear at random, shifting locations rather than synchronized everywhere,
    // and each one plays out through the real spike-slow-wave morphology over time.
    if (nextEventTime('hyps-spike-' + el, t, 1.2, 3.5)) {
      setT('hyps-spike-amp-' + el, 150 + Math.random() * 150); // 150-300 µV per plan
    }
    const spikeDt = t - getT('hyps-spike-' + el);
    if (spikeDt >= 0 && spikeDt < 0.9) {
      const amp = getT('hyps-spike-amp-' + el);
      v += spikeSlowWave(spikeDt, amp, amp * 0.5);
    }
  }

  return v;
}

// ─── Voltage Gating ──────────────────────────────────────────────────────────

function voltageGate(t: number, ap: Set<string>): number {
  if (ap.has('burst-suppression')) {
    // random period 3-6s, burst 0.5-2s
    if (nextEventTime('bs-cycle', t, 3, 6)) {
      setT('bs-dur', jitter(1.25, 0.6)); // 0.5 to 2.0
    }
    const dt = t - getT('bs-cycle');
    if (dt < getT('bs-dur')) {
      return 1.0 + 1.5 * gaussian(dt, getT('bs-dur') / 2, getT('bs-dur') / 4);
    }
    return 0.04;
  }

  if (ap.has('gtc-ictal')) {
    // Diffusely attenuate ongoing background during the post-ictal suppression window,
    // then ramp back to normal amplitude as the patient recovers — real post-ictal EEG
    // is suppressed, not simply silent or instantly normal.
    const start = getT('gtc-epoch');
    if (start >= 0) {
      const cycle = (t - start) % 105;
      if (cycle >= 35 && cycle < 50) return 0.08;
      if (cycle >= 50 && cycle < 70) return 0.08 + 0.92 * ((cycle - 50) / 20);
    }
  }

  return 1.0;
}

// ─── Ictal Seizure ───────────────────────────────────────────────────────────

function ictalVoltage(el: string, t: number, ap: Set<string>): number {
  const c = classify(el);
  let v = 0;

  if (ap.has('absence-ictal')) {
    const k = 'absence-epoch';
    if (getT(k) < 0) {
      setT(k, t + 4);
      setT('abs-dur', 5 + Math.random() * 10); // 5-15s
    }
    const el2 = t - getT(k);
    const dur = getT('abs-dur');
    if (el2 >= 0) {
      const cycle = el2 % (dur + 15);
      if (cycle < dur) {
        const freq = 3.2 - (cycle / dur) * 0.7; // 3->slowing
        const cycleLen = 1 / freq;
        const dt = cycle % cycleLen;
        const frontAmp = c.isFrontal || c.isMidline ? 220 : 160;
        // abrupt offset, handled by cycle check
        v += spikeSlowWave(dt, frontAmp, frontAmp * 0.7);
      } else if (cycle < dur + 5) {
        // post-ictal slowing
        v += 40 * multiToneSignal(el2, DELTA_TONES, DELTA_TONE_NORM);
      }
    }
  }

  if (ap.has('gtc-ictal')) {
    const k = 'gtc-epoch';
    if (getT(k) < 0) setT(k, t + 6);
    const el2 = t - getT(k);
    if (el2 >= 0) {
      const cycle = el2 % 105;
      if (cycle < 4) {
        // recruiting crescendo
        const env = Math.pow(cycle / 4, 2);
        v += env * 30 * multiToneSignal(el2, BETA_TONES, BETA_TONE_NORM, 0, 1.2);
      } else if (cycle < 18) {
        const pos = (cycle - 4) / 14;
        const freq = 3 - pos * 1.5; // progressive slowing
        const phaseF = ((cycle - 4) * freq) % 1;
        const amp = 100 + pos * 100;
        v += amp * gaussian(phaseF, 0.05, 0.02);
        v += amp * 0.4 * multiToneSignal(el2, DELTA_TONES, DELTA_TONE_NORM);
        if (phaseF < 0.3) v -= amp * 0.5 * gaussian(phaseF, 0.25, 0.06);
      } else if (cycle < 35) {
        const env = 1 - (cycle - 18) / 17;
        v += env * 120 * multiToneSignal(el2, DELTA_TONES, DELTA_TONE_NORM, -0.5);
      } else if (cycle < 50) {
        // Post-ictal suppression: background amplitude is attenuated by voltageGate()
        // below; on top of that near-flat trace, add sparse, low-amplitude delta bursts
        // rather than true silence.
        if (nextEventTime('gtc-postictal-delta', t, 2, 4)) {
          setT('gtc-pid-amp', jitter(1, 0.3));
        }
        const dt = t - getT('gtc-postictal-delta');
        if (dt >= 0 && dt < 1.2) {
          v += 25 * getT('gtc-pid-amp') * gaussian(dt, 0.5, 0.3) * multiToneSignal(dt, DELTA_TONES, DELTA_TONE_NORM);
        }
      } else if (cycle < 70) {
        // Gradual recovery: intermittent delta grows back in as suppression lifts
        const pos = (cycle - 50) / 20;
        v += pos * 30 * multiToneSignal(el2, DELTA_TONES, DELTA_TONE_NORM);
      }
    }
  }

  if (ap.has('focal-temporal-ictal') && (c.isLeftTmp || c.isTemporal || c.isRightTmp || ['F7','F8','T3','T4','T5','T6','Fp1','Fp2'].includes(el))) {
    const k = 'ftemp-epoch';
    if (getT(k) < 0) setT(k, t + 5);
    const el2 = t - getT(k);
    if (el2 >= 0) {
      const cycle = el2 % 90;
      if (cycle < 30) {
        const pos = cycle / 30;
        const freq = 6 - pos * 2.5;
        // contralateral spread: starts late
        const isContra = c.isRightTmp || el === 'F8' || el === 'T4' || el === 'T6' || el === 'Fp2';
        const spreadFactor = isContra ? Math.max(0, (pos - 0.5) * 2) : 1.0;
        const amp = (c.isLeftTmp ? 120 : 60) * (0.1 + 0.9 * pos) * spreadFactor;
        // evolving theta
        v += amp * multiToneSignal(el2, THETA_TONES, THETA_TONE_NORM, freq - 5);
      }
    }
  }

  if (ap.has('focal-frontal-ictal') && (c.isLeftFront || c.isFrontal)) {
    const k = 'ffront-epoch';
    if (getT(k) < 0) setT(k, t + 5);
    const el2 = t - getT(k);
    if (el2 >= 0) {
      const cycle = el2 % 70;
      // shorter 10-20s
      if (cycle < 15) {
        const pos = cycle / 15;
        const freq = 18 - pos * 15;
        const amp = (c.isLeftFront ? 100 : 50) * (0.1 + 0.9 * pos);
        v += amp * multiToneSignal(el2, BETA_TONES, BETA_TONE_NORM, freq - 15);
        // movement artifact
        v += 30 * pos * (Math.random() - 0.5);
      }
    }
  }

  return v;
}

export function getElectrodeVoltage(electrode: Electrode, t: number, settings: SimSettings): number {
  if (electrode === 'A1' || electrode === 'A2') return (Math.random() - 0.5) * 3;

  const { patientState: st, activePatterns: ap } = settings;

  let v = backgroundSignal(electrode, t, st, ap);

  const gate = voltageGate(t, ap);
  v *= gate;

  if (ap.has('burst-suppression') && gate > 1) {
    // mixed frequency burst content
    v += 80 * multiToneSignal(t, THETA_TONES, THETA_TONE_NORM) * (Math.random() * 0.5 + 0.5);
    v += 40 * multiToneSignal(t, BETA_TONES, BETA_TONE_NORM);
  }

  v += sleepStructureVoltage(electrode, t, st, ap);
  v += variantVoltage(electrode, t, st, ap);
  v += artifactVoltage(electrode, t, ap);
  v += abnormalVoltage(electrode, t, ap);
  v += epileptiformVoltage(electrode, t, ap);
  v += ictalVoltage(electrode, t, ap);

  return v;
}

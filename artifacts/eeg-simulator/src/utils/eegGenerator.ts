import { Electrode, ALL_ELECTRODES } from './montages';

export type PatientState = 'awake' | 'drowsy' | 'sleep';

export type SimSettings = {
  speed: 15 | 30 | 60;
  sensitivity: 5 | 7 | 10 | 15; // µV per mm
  patientState: PatientState;
  artifacts: Set<string>;
  sleepStructures: Set<string>;
};

// Persistent per-electrode phase offsets (prevent discontinuities on re-render)
const electrodePhases = new Map<Electrode, {
  alpha: number; alpha2: number;
  beta: number;
  theta: number; theta2: number;
  delta: number;
}>();

ALL_ELECTRODES.forEach(el => {
  electrodePhases.set(el, {
    alpha:  Math.random() * Math.PI * 2,
    alpha2: Math.random() * Math.PI * 2,
    beta:   Math.random() * Math.PI * 2,
    theta:  Math.random() * Math.PI * 2,
    theta2: Math.random() * Math.PI * 2,
    delta:  Math.random() * Math.PI * 2,
  });
});
(['A1', 'A2'] as Electrode[]).forEach(el =>
  electrodePhases.set(el, { alpha: 0, alpha2: 0, beta: 0, theta: 0, theta2: 0, delta: 0 })
);

// Episodic event timing
let lastElectrodePopTime = -100;
let popElectrode: Electrode | null = null;
let sweatStartTime  = -100;
let blinkTime       = -100;
let eyeMovementTime = -100;
let postsTime       = -100;
let vWaveTime       = -100;
let kComplexTime    = -100;
let spindleTime     = -100;

export function resetGenerator() {
  lastElectrodePopTime = -100;
  sweatStartTime  = -100;
  blinkTime       = -100;
  eyeMovementTime = -100;
  postsTime       = -100;
  vWaveTime       = -100;
  kComplexTime    = -100;
  spindleTime     = -100;
  popElectrode    = null;
}

function gaussian(x: number, center: number, width: number) {
  return Math.exp(-((x - center) ** 2) / (2 * width * width));
}

/** Simulated ECG — normal sinus rhythm ~72 bpm, returns µV-scale value */
export function getECGVoltage(t: number): number {
  const period = 60 / 72;
  const phase  = (t % period) / period;
  let v = 0;
  v += 0.12 * gaussian(phase, 0.18,  0.025);   // P wave
  v -= 0.06 * gaussian(phase, 0.285, 0.008);   // Q dip
  v += 1.00 * gaussian(phase, 0.305, 0.012);   // R spike
  v -= 0.12 * gaussian(phase, 0.330, 0.010);   // S dip
  v += 0.25 * gaussian(phase, 0.520, 0.045);   // T wave
  return v * 500;
}

/** Generate absolute electrode voltage (µV) for a single electrode at time t */
export function getElectrodeVoltage(
  electrode: Electrode,
  t: number,
  settings: SimSettings,
): number {
  if (electrode === 'A1' || electrode === 'A2') return (Math.random() - 0.5) * 3;

  const ph = electrodePhases.get(electrode)!;
  const st = settings.patientState;

  const isOccipital = ['O1','O2'].includes(electrode);
  const isParietal  = ['P3','P4','Pz'].includes(electrode);
  const isPostTmp   = ['T5','T6'].includes(electrode);
  const isFrontal   = ['Fp1','Fp2','F3','F4','F7','F8','Fz'].includes(electrode);
  const isCentral   = ['C3','Cz','C4'].includes(electrode);
  const isTemporal  = ['T3','T4'].includes(electrode);
  const isPost      = isOccipital || isParietal || isPostTmp;

  let v = 0;

  // ── Background rhythms weighted by patient state ───────────────────────────

  if (st === 'awake') {
    // Posterior-predominant alpha (9-11 Hz), sinusoidally modulated amplitude
    const alphaAmp = isOccipital ? 28 : isParietal ? 22 : isPostTmp ? 14 : isCentral ? 8 : 4;
    v += alphaAmp
      * Math.sin(2 * Math.PI * 10 * t + ph.alpha)
      * (0.75 + 0.25 * Math.sin(2 * Math.PI * 0.12 * t + ph.alpha2)); // spindle-like AM

    // Beta frontal
    const betaAmp = isFrontal ? 10 : 4;
    v += betaAmp * Math.sin(2 * Math.PI * 18 * t + ph.beta);

    // Very subtle theta/delta elsewhere
    v += (isPost ? 3 : 5) * Math.sin(2 * Math.PI * 5   * t + ph.theta);
    v += (isPost ? 2 : 4) * Math.sin(2 * Math.PI * 1.5 * t + ph.delta);
    v += (Math.random() - 0.5) * 5;

  } else if (st === 'drowsy') {
    // Theta replaces alpha in posterior channels; diffuse slowing
    const thetaAmp = isPost ? 22 : isCentral ? 14 : isTemporal ? 12 : isFrontal ? 10 : 8;
    v += thetaAmp * Math.sin(2 * Math.PI * 5.5 * t + ph.theta)
                  * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.08 * t + ph.theta2));

    // Fading alpha (only in occipital, reduced)
    const alphaAmp = isOccipital ? 10 : isParietal ? 6 : 0;
    v += alphaAmp * Math.sin(2 * Math.PI * 9.5 * t + ph.alpha);

    // Slow delta background
    v += 8 * Math.sin(2 * Math.PI * 2 * t + ph.delta);

    // Beta greatly reduced
    v += (isFrontal ? 5 : 2) * Math.sin(2 * Math.PI * 18 * t + ph.beta);
    v += (Math.random() - 0.5) * 6;

  } else {
    // Sleep: delta/theta dominant everywhere; posterior slowing; sleep structures prominent
    const deltaAmp = isPost ? 20 : isCentral ? 18 : 15;
    v += deltaAmp * Math.sin(2 * Math.PI * 1.5 * t + ph.delta);

    const thetaAmp = isPost ? 14 : 10;
    v += thetaAmp * Math.sin(2 * Math.PI * 4.5 * t + ph.theta);

    // No significant alpha or beta
    v += 2 * Math.sin(2 * Math.PI * 10 * t + ph.alpha);  // residual
    v += (Math.random() - 0.5) * 5;
  }

  // ── Artifacts ──────────────────────────────────────────────────────────────

  // 1. Electrode pop
  if (settings.artifacts.has('electrode-pop')) {
    if (t - lastElectrodePopTime > 4 && Math.random() < 0.02) {
      lastElectrodePopTime = t;
      popElectrode = ALL_ELECTRODES[Math.floor(Math.random() * ALL_ELECTRODES.length)];
    }
    if (electrode === popElectrode) {
      const dt = t - lastElectrodePopTime;
      if (dt > 0 && dt < 1) v += 300 * Math.exp(-dt * 10) * Math.cos(2 * Math.PI * 5 * dt);
    }
  }

  // 2. Sweat
  if (settings.artifacts.has('sweat')) {
    if (t - sweatStartTime > 8 && Math.random() < 0.01) sweatStartTime = t;
    if (isFrontal || ['F3','F4'].includes(electrode)) {
      const dt = t - sweatStartTime;
      if (dt > 0 && dt < 6)
        v += 200 * Math.sin(2 * Math.PI * 0.1 * dt) * gaussian(dt, 3, 1.5);
    }
  }

  // 3. 50 Hz mains
  if (settings.artifacts.has('50hz')) v += 40 * Math.sin(2 * Math.PI * 50 * t);

  // 4. Eye blink
  if (settings.artifacts.has('blink')) {
    if (t - blinkTime > 3 && Math.random() < 0.01) blinkTime = t;
    const dt = t - blinkTime;
    if (dt > 0 && dt < 1) {
      if (['Fp1','Fp2'].includes(electrode))           v += 250 * gaussian(dt, 0.2, 0.05);
      else if (['F3','F4','F7','F8'].includes(electrode)) v += 80 * gaussian(dt, 0.2, 0.05);
    }
  }

  // 5. Horizontal eye movement
  if (settings.artifacts.has('eye-movement')) {
    if (t - eyeMovementTime > 4 && Math.random() < 0.01) eyeMovementTime = t;
    const dt = t - eyeMovementTime;
    if (dt > 0 && dt < 1) {
      const pulse = 150 * gaussian(dt, 0.3, 0.1);
      if (['F7','Fp1'].includes(electrode)) v += pulse;
      if (['F8','Fp2'].includes(electrode)) v -= pulse;
    }
  }

  // ── Sleep Structures ───────────────────────────────────────────────────────
  // Auto-enable during sleep state with increased probability; manual toggles add them independently
  const isSleep = st === 'sleep';
  const sleepBoost = isSleep ? 6 : 1; // frequency multiplier when state=sleep

  // 6. POSTS (occipital sharp transients)
  const wantsPosts = settings.sleepStructures.has('posts') || isSleep;
  if (wantsPosts) {
    if (t - postsTime > 1.2 && Math.random() < 0.025 * sleepBoost) postsTime = t;
    const dt = t - postsTime;
    if (isOccipital && dt > 0 && dt < 0.4 && dt < 0.1)
      v += 70 * Math.sin(dt * 10 * Math.PI);
  }

  // 7. Vertex sharp waves
  const wantsV = settings.sleepStructures.has('v-waves') || isSleep;
  if (wantsV) {
    if (t - vWaveTime > 4 && Math.random() < 0.008 * sleepBoost) vWaveTime = t;
    const dt = t - vWaveTime;
    if (['Cz','C3','C4'].includes(electrode) && dt > 0 && dt < 1) {
      const amp = electrode === 'Cz' ? 130 : 65;
      v -= amp * Math.sin(2 * Math.PI * 2 * dt) * gaussian(dt, 0.25, 0.1);
    }
  }

  // 8. K complex
  const wantsK = settings.sleepStructures.has('k-complex') || isSleep;
  if (wantsK) {
    if (t - kComplexTime > 10 && Math.random() < 0.004 * sleepBoost) kComplexTime = t;
    const dt = t - kComplexTime;
    if (['Fz','Cz','Pz','F3','F4','C3','C4'].includes(electrode) && dt > 0 && dt < 2) {
      const amp   = ['Fz','Cz','Pz'].includes(electrode) ? 220 : 110;
      const sharp = -amp       * Math.sin(2 * Math.PI * 3   * dt) * gaussian(dt, 0.20, 0.08);
      const slow  =  amp * 0.8 * Math.sin(2 * Math.PI * 0.8 * dt) * gaussian(dt, 0.65, 0.22);
      v += sharp + slow;
    }
  }

  // 9. Sleep spindles
  const wantsSp = settings.sleepStructures.has('spindles') || isSleep;
  if (wantsSp) {
    if (t - spindleTime > 6 && Math.random() < 0.008 * sleepBoost) spindleTime = t;
    const dt = t - spindleTime;
    if (['Cz','C3','C4','Fz','Pz'].includes(electrode) && dt > 0 && dt < 1.8) {
      const amp = electrode === 'Cz' ? 45 : 28;
      v += amp * gaussian(dt, 0.7, 0.28) * Math.sin(2 * Math.PI * 14 * dt);
    }
  }

  return v;
}

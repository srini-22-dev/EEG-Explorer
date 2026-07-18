import { Electrode, ALL_ELECTRODES } from './montages';

export type SimSettings = {
  speed: 15 | 30 | 60; // mm/sec
  gain: 0.5 | 1 | 2; // multiplier
  artifacts: Set<string>;
  sleepStructures: Set<string>;
};

// Global state for continuous generation so it doesn't jump on re-renders
const electrodePhases = new Map<Electrode, { alpha: number, beta: number, theta: number, delta: number }>();

ALL_ELECTRODES.forEach(el => {
  electrodePhases.set(el, {
    alpha: Math.random() * Math.PI * 2,
    beta: Math.random() * Math.PI * 2,
    theta: Math.random() * Math.PI * 2,
    delta: Math.random() * Math.PI * 2,
  });
});

// A1 and A2 are mostly quiet but let's give them some noise
['A1', 'A2'].forEach(el => {
  electrodePhases.set(el as Electrode, {
    alpha: 0, beta: 0, theta: 0, delta: 0
  });
});

// Timing state for episodic events
let lastElectrodePopTime = 0;
let popElectrode: Electrode | null = null;

let sweatStartTime = -100; // in seconds
let blinkTime = -100;
let eyeMovementTime = -100;

let postsTime = -100;
let vWaveTime = -100;
let kComplexTime = -100;
let spindleTime = -100;

export function resetGenerator() {
  const now = performance.now() / 1000;
  lastElectrodePopTime = now - 100;
  sweatStartTime = now - 100;
  blinkTime = now - 100;
  eyeMovementTime = now - 100;
  postsTime = now - 100;
  vWaveTime = now - 100;
  kComplexTime = now - 100;
  spindleTime = now - 100;
  popElectrode = null;
}

function gaussian(x: number, center: number, width: number) {
  return Math.exp(-Math.pow(x - center, 2) / (2 * width * width));
}

// Generate the absolute voltage for a single electrode at time t
export function getElectrodeVoltage(electrode: Electrode, t: number, settings: SimSettings): number {
  if (electrode === 'A1' || electrode === 'A2') {
    return (Math.random() - 0.5) * 5; // just a tiny bit of noise
  }

  const phases = electrodePhases.get(electrode)!;
  
  let v = 0;

  // Background rhythms
  const isOccipital = ['O1', 'O2', 'P3', 'P4'].includes(electrode);
  const isFrontal = ['Fp1', 'Fp2', 'F3', 'F4', 'F7', 'F8', 'Fz'].includes(electrode);
  const isCentral = ['C3', 'Cz', 'C4'].includes(electrode);
  const isTemporal = ['T3', 'T4', 'T5', 'T6'].includes(electrode);

  // Alpha (8-12 Hz) - dominant in occipital
  const alphaAmp = isOccipital ? 25 : (isCentral || isTemporal ? 10 : 5);
  v += alphaAmp * Math.sin(2 * Math.PI * 10 * t + phases.alpha) * (0.8 + 0.2 * Math.sin(t * 0.5));

  // Beta (13-30 Hz) - dominant in frontal
  const betaAmp = isFrontal ? 15 : 5;
  v += betaAmp * Math.sin(2 * Math.PI * 18 * t + phases.beta);

  // Theta (4-7 Hz) - low everywhere
  v += 10 * Math.sin(2 * Math.PI * 5 * t + phases.theta);

  // Delta (1-3 Hz) - low everywhere
  v += 10 * Math.sin(2 * Math.PI * 1.5 * t + phases.delta);

  // Random noise
  v += (Math.random() - 0.5) * 8;

  // --- ARTIFACTS ---
  const now = performance.now() / 1000;
  
  // 1. Electrode Pop
  if (settings.artifacts.has('electrode-pop')) {
    if (t - lastElectrodePopTime > 4 && Math.random() < 0.02) {
      lastElectrodePopTime = t;
      popElectrode = ALL_ELECTRODES[Math.floor(Math.random() * ALL_ELECTRODES.length)];
    }
    if (electrode === popElectrode) {
      const dt = t - lastElectrodePopTime;
      if (dt > 0 && dt < 1) {
        // Abrupt spike followed by RC decay
        const spike = 300 * Math.exp(-dt * 10) * Math.cos(2 * Math.PI * 5 * dt);
        v += spike;
      }
    }
  }

  // 2. Sweat Artifact (Slow drift on frontals)
  if (settings.artifacts.has('sweat')) {
    if (t - sweatStartTime > 8 && Math.random() < 0.01) {
      sweatStartTime = t;
    }
    if (['Fp1', 'Fp2', 'F3', 'F4', 'F7', 'F8'].includes(electrode)) {
      const dt = t - sweatStartTime;
      if (dt > 0 && dt < 6) {
        // Very slow 0.1 Hz wave
        v += 200 * Math.sin(2 * Math.PI * 0.1 * dt) * gaussian(dt, 3, 1.5);
      }
    }
  }

  // 3. 50Hz Mains
  if (settings.artifacts.has('50hz')) {
    v += 40 * Math.sin(2 * Math.PI * 50 * t);
  }

  // 4. Eye Blink
  if (settings.artifacts.has('blink')) {
    if (t - blinkTime > 3 && Math.random() < 0.01) {
      blinkTime = t;
    }
    const dt = t - blinkTime;
    if (dt > 0 && dt < 1) {
      if (['Fp1', 'Fp2'].includes(electrode)) {
        v += 250 * gaussian(dt, 0.2, 0.05); // Positive down/up depending on reference
      } else if (['F3', 'F4', 'F7', 'F8'].includes(electrode)) {
        v += 80 * gaussian(dt, 0.2, 0.05);
      }
    }
  }

  // 5. Horizontal Eye Movement
  if (settings.artifacts.has('eye-movement')) {
    if (t - eyeMovementTime > 4 && Math.random() < 0.01) {
      eyeMovementTime = t;
    }
    const dt = t - eyeMovementTime;
    if (dt > 0 && dt < 1) {
      const pulse = 150 * gaussian(dt, 0.3, 0.1);
      if (['F7', 'Fp1'].includes(electrode)) v += pulse; // Look left
      if (['F8', 'Fp2'].includes(electrode)) v -= pulse;
    }
  }

  // --- SLEEP STRUCTURES ---
  
  // 6. POSTS (Occipital sharp transients)
  if (settings.sleepStructures.has('posts')) {
    if (t - postsTime > 1.5 && Math.random() < 0.03) {
      postsTime = t;
    }
    const dt = t - postsTime;
    if (isOccipital && dt > 0 && dt < 0.5) {
      // sharp positive triangle
      if (dt < 0.1) {
        v += 60 * Math.sin(dt * 10 * Math.PI); // Sharp transient
      }
    }
  }

  // 7. V waves (Vertex sharp waves)
  if (settings.sleepStructures.has('v-waves')) {
    if (t - vWaveTime > 5 && Math.random() < 0.01) {
      vWaveTime = t;
    }
    const dt = t - vWaveTime;
    if (['Cz', 'C3', 'C4'].includes(electrode) && dt > 0 && dt < 1) {
      const amp = electrode === 'Cz' ? 120 : 60;
      // Biphasic: negative then positive slow
      const wave = amp * Math.sin(2 * Math.PI * 2 * dt) * gaussian(dt, 0.25, 0.1);
      v -= wave; // Convention: negative is UP, but wait, usually display logic handles polarity. We just output uV.
    }
  }

  // 8. K Complex
  if (settings.sleepStructures.has('k-complex')) {
    if (t - kComplexTime > 12 && Math.random() < 0.005) {
      kComplexTime = t;
    }
    const dt = t - kComplexTime;
    if (['Fz', 'Cz', 'F3', 'F4', 'C3', 'C4'].includes(electrode) && dt > 0 && dt < 2) {
      const amp = (electrode === 'Fz' || electrode === 'Cz') ? 200 : 100;
      // Initial sharp negative, then large positive slow wave
      const sharp = -amp * Math.sin(2 * Math.PI * 3 * dt) * gaussian(dt, 0.2, 0.08);
      const slow = amp * 0.8 * Math.sin(2 * Math.PI * 0.8 * dt) * gaussian(dt, 0.6, 0.2);
      v += sharp + slow;
    }
  }

  // 9. Sleep Spindles
  if (settings.sleepStructures.has('spindles')) {
    if (t - spindleTime > 7 && Math.random() < 0.01) {
      spindleTime = t;
    }
    const dt = t - spindleTime;
    if (['Cz', 'C3', 'C4', 'Fz'].includes(electrode) && dt > 0 && dt < 1.5) {
      const amp = (electrode === 'Cz') ? 40 : 25;
      // 14 Hz bursting with crescendo-decrescendo envelope
      const env = gaussian(dt, 0.5, 0.2);
      v += amp * env * Math.sin(2 * Math.PI * 14 * dt);
    }
  }

  return v;
}

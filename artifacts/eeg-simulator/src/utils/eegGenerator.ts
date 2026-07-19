import { Electrode, ALL_ELECTRODES } from './montages';

// ─── Types ───────────────────────────────────────────────────────────────────

export type PatientState = 'awake' | 'drowsy' | 'n1' | 'n2' | 'n3';

export type SimSettings = {
  speed: 15 | 30 | 60;
  sensitivity: 5 | 7 | 10 | 15;
  patientState: PatientState;
  activePatterns: Set<string>;
};

// ─── Persistent per-electrode phase offsets ──────────────────────────────────

type ElPhase = {
  alpha: number; alpha2: number;
  beta: number;
  theta: number; theta2: number;
  delta: number; delta2: number;
  mu: number;
};

const elPhase = new Map<string, ElPhase>();
[...ALL_ELECTRODES, 'A1', 'A2'].forEach(el => {
  elPhase.set(el, {
    alpha:  Math.random() * Math.PI * 2,
    alpha2: Math.random() * Math.PI * 2,
    beta:   Math.random() * Math.PI * 2,
    theta:  Math.random() * Math.PI * 2,
    theta2: Math.random() * Math.PI * 2,
    delta:  Math.random() * Math.PI * 2,
    delta2: Math.random() * Math.PI * 2,
    mu:     Math.random() * Math.PI * 2,
  });
});

// ─── Global pattern timing state ─────────────────────────────────────────────
const T: Record<string, number> = {};
const getT = (k: string) => T[k] ?? -1000;
const setT = (k: string, v: number) => { T[k] = v; };

/** Reset all timing so patterns re-trigger from the current moment */
export function resetGenerator() {
  Object.keys(T).forEach(k => { T[k] = -1000; });
}

// ─── Utility functions ───────────────────────────────────────────────────────

function gaussian(x: number, mu: number, sigma: number) {
  return Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));
}

/** Simulate a spike + slow-wave complex starting at dt=0 */
function spikeSlowWave(dt: number, ampSpike: number, ampSlow: number): number {
  if (dt < 0 || dt > 0.9) return 0;
  const spike = ampSpike * gaussian(dt, 0.05, 0.022);
  const slow  = -ampSlow  * gaussian(dt, 0.45, 0.16);
  return spike + slow;
}

/** Triphasic complex (−, +, −) starting at dt=0 */
function triphasicWave(dt: number, amp: number): number {
  if (dt < 0 || dt > 0.7) return 0;
  const p1 = -amp * 0.25 * gaussian(dt, 0.06, 0.025);  // initial neg
  const p2 =  amp * 1.00 * gaussian(dt, 0.22, 0.06);   // large positive
  const p3 = -amp * 0.50 * gaussian(dt, 0.48, 0.09);   // trailing neg
  return p1 + p2 + p3;
}

/** ECG: normal sinus rhythm ~72 bpm */
export function getECGVoltage(t: number): number {
  const period = 60 / 72;
  const phase  = (t % period) / period;
  let v = 0;
  v += 0.12 * gaussian(phase, 0.18,  0.025);   // P wave
  v -= 0.06 * gaussian(phase, 0.285, 0.008);   // Q
  v += 1.00 * gaussian(phase, 0.305, 0.012);   // R
  v -= 0.12 * gaussian(phase, 0.330, 0.010);   // S
  v += 0.25 * gaussian(phase, 0.520, 0.045);   // T wave
  return v * 500;
}

// ─── Electrode topology helpers ──────────────────────────────────────────────

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

// ─── Background rhythm per patient state ─────────────────────────────────────

function backgroundSignal(el: string, t: number, st: PatientState, ap: Set<string>): number {
  const ph = elPhase.get(el)!;
  const c  = classify(el);
  const isPost = c.isOccipital || c.isParietal || c.isPostTmp;

  // Generalised slowing overrides the background completely
  if (ap.has('gen-slowing')) {
    const thetaAmp = isPost ? 20 : c.isCentral ? 16 : 14;
    const deltaAmp = isPost ? 16 : 12;
    let v = thetaAmp * Math.sin(2 * Math.PI * 5 * t + ph.theta);
    v += deltaAmp  * Math.sin(2 * Math.PI * 1.8 * t + ph.delta);
    v += (Math.random() - 0.5) * 7;
    return v;
  }

  let v = 0;

  if (st === 'awake') {
    // ── Posterior alpha spindles (PDR, 9-11 Hz) ──────────────────────────────
    // Waxing-waning envelope: 0→1→0 sinusoidal at ~0.10 Hz (≈10 s full cycle)
    // → ~5 s alpha run, ~5 s relative quiet, realistic spindle morphology.
    // Each electrode has its own phase offset (ph.alpha2) so spindles don't
    // all peak simultaneously across the montage.
    const spindleEnv = 0.5 + 0.5 * Math.cos(2 * Math.PI * 0.10 * t + ph.alpha2);
    const alphaAmp   = c.isOccipital ? 42 : c.isParietal ? 28 : c.isPostTmp ? 13 : 0;
    v += alphaAmp * spindleEnv * Math.sin(2 * Math.PI * 10 * t + ph.alpha);

    // ── Non-posterior channels: deliberately subtle ───────────────────────────
    // Frontal/central show only low-amplitude beta + trace theta so students
    // can clearly see the posterior alpha gradient.
    const betaAmp = c.isFrontal ? 5 : c.isCentral || c.isMidline ? 4 : c.isTemporal ? 3 : 1;
    v += betaAmp * Math.sin(2 * Math.PI * 18 * t + ph.beta);

    // Trace slow activity (physiological but unobtrusive at 7 µV/mm sensitivity)
    v += 2.0 * Math.sin(2 * Math.PI * 5.0 * t + ph.theta);
    v += 1.5 * Math.sin(2 * Math.PI * 1.5 * t + ph.delta);
    v += (Math.random() - 0.5) * (isPost ? 3 : 2);

  } else if (st === 'drowsy') {
    // Posterior theta replaces alpha; diffuse slowing; residual occipital alpha
    const thetaAmp = isPost ? 22 : c.isCentral ? 14 : c.isTemporal ? 12 : c.isFrontal ? 10 : 8;
    v += thetaAmp
      * Math.sin(2 * Math.PI * 5.5 * t + ph.theta)
      * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.08 * t + ph.theta2));

    const alphaRemnant = c.isOccipital ? 10 : c.isParietal ? 6 : 0;
    v += alphaRemnant * Math.sin(2 * Math.PI * 9.5 * t + ph.alpha);
    v += 8 * Math.sin(2 * Math.PI * 2 * t + ph.delta);
    v += (c.isFrontal ? 4 : 2) * Math.sin(2 * Math.PI * 18 * t + ph.beta);
    v += (Math.random() - 0.5) * 6;

  } else if (st === 'n1') {
    // Stage 1 NREM: theta background, vertex waves start, POSTS, no spindles/K yet
    const thetaAmp = isPost ? 20 : c.isCentral ? 16 : c.isTemporal ? 14 : 12;
    v += thetaAmp * Math.sin(2 * Math.PI * 5 * t + ph.theta)
                  * (0.65 + 0.35 * Math.sin(2 * Math.PI * 0.07 * t + ph.theta2));
    v += 10 * Math.sin(2 * Math.PI * 1.5 * t + ph.delta);
    v += 2  * Math.sin(2 * Math.PI * 10  * t + ph.alpha);
    v += (Math.random() - 0.5) * 6;

  } else if (st === 'n2') {
    // Stage 2 NREM: theta/delta background; K-complexes and spindles prominent
    const thetaAmp = isPost ? 16 : 12;
    v += thetaAmp * Math.sin(2 * Math.PI * 4.5 * t + ph.theta);
    v += 14 * Math.sin(2 * Math.PI * 2 * t + ph.delta)
             * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.05 * t + ph.delta2));
    v += (Math.random() - 0.5) * 6;

  } else {
    // n3 — Slow wave sleep: high-amplitude delta dominant (0.5-2 Hz)
    const deltaAmp = isPost ? 55 : c.isCentral ? 60 : c.isFrontal ? 50 : 45;
    v += deltaAmp
      * Math.sin(2 * Math.PI * 1.0 * t + ph.delta)
      * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.04 * t + ph.delta2));
    v += 18 * Math.sin(2 * Math.PI * 2.5 * t + ph.theta);
    v += (Math.random() - 0.5) * 8;
  }

  return v;
}

// ─── Voltage gating (burst suppression) ──────────────────────────────────────

function voltageGate(t: number, ap: Set<string>): number {
  if (!ap.has('burst-suppression')) return 1.0;
  const bsPeriod = 3.8;
  const burstDur = 1.3;
  const phase = t % bsPeriod;
  if (phase < burstDur) {
    return 1.0 + 1.5 * gaussian(phase, burstDur * 0.5, 0.28);
  }
  return 0.04; // suppression
}

// ─── Ictal seizure patterns ───────────────────────────────────────────────────

function ictalVoltage(el: string, t: number, ap: Set<string>): number {
  const c = classify(el);
  const isAll = true; // generalized = all electrodes

  let v = 0;

  // ── Absence seizure: 10 s ictal (3 Hz GSW) + 5 s inter-ictal ──────────────
  if (ap.has('absence-ictal')) {
    const k = 'absence-epoch';
    if (getT(k) < 0) setT(k, t + 4);   // 4-second lead-in
    const el2 = t - getT(k);
    if (el2 >= 0) {
      const cycle = el2 % 28;           // 10s seizure, 18s quiet
      if (cycle < 10) {
        const dt = cycle % (1 / 3);     // within each 0.333 s cycle
        const frontAmp = c.isFrontal || c.isMidline ? 220 : 160;
        v += spikeSlowWave(dt, frontAmp, frontAmp * 0.7);
      } else if (cycle < 12) {
        v *= 0.5;                       // brief post-ictal slowing (handled outside)
      }
    }
  }

  // ── GTC seizure ─────────────────────────────────────────────────────────────
  // Phase 0-4s:  recruiting fast (20 Hz, low amplitude)
  // Phase 4-18s: polyspike-wave 3→2 Hz evolving
  // Phase 18-35s: slow wave dominance 1.5 Hz
  // Phase 35-45s: post-ictal suppression
  // Cycle: 45s seizure + 60s recovery = 105s
  if (ap.has('gtc-ictal')) {
    const k = 'gtc-epoch';
    if (getT(k) < 0) setT(k, t + 6);
    const el2 = t - getT(k);
    if (el2 >= 0) {
      const cycle = el2 % 105;
      if (cycle < 4) {
        // Recruiting fast low-amplitude rhythm
        const env = cycle / 4;
        v += env * 30 * Math.sin(2 * Math.PI * 20 * t);
      } else if (cycle < 18) {
        // Evolving polyspike-wave (3 Hz at start, slowing to 2 Hz)
        const pos    = (cycle - 4) / 14;
        const freq   = 3 - pos * 1;          // 3→2 Hz
        const phaseF = ((cycle - 4) * freq) % 1;
        const amp    = 100 + pos * 100;
        v += amp * gaussian(phaseF, 0.05, 0.02);  // spike
        v += amp * 0.4 * Math.sin(2 * Math.PI * 2 * t); // added slow
        if (phaseF < 0.3) v -= amp * 0.5 * gaussian(phaseF, 0.25, 0.06); // poly
      } else if (cycle < 35) {
        // Slow post-clonic waves
        const env = 1 - (cycle - 18) / 17;
        v += env * 120 * Math.sin(2 * Math.PI * 1.5 * t + 1.2);
      }
      // cycle 35-45: handled by voltageGate-like suppression (returned as normal * 0.1 = tiny)
    }
  }

  // ── Focal temporal seizure (left temporal) ───────────────────────────────────
  // Rhythmic theta at 6 Hz → evolves → spreads; 30s seizure, 60s recovery
  if (ap.has('focal-temporal-ictal') && (c.isLeftTmp || c.isTemporal || ['F7','T3','T5','Fp1'].includes(el))) {
    const k = 'ftemp-epoch';
    if (getT(k) < 0) setT(k, t + 5);
    const el2 = t - getT(k);
    if (el2 >= 0) {
      const cycle = el2 % 90;
      if (cycle < 30) {
        const pos    = cycle / 30;                      // 0→1
        const freq   = 6 - pos * 2.5;                  // 6→3.5 Hz (slowing)
        const amp    = (c.isLeftTmp ? 120 : 60) * (0.3 + 0.7 * pos);
        v += amp * Math.sin(2 * Math.PI * freq * t);
      }
    }
  }

  // ── Focal frontal seizure (left frontal) ─────────────────────────────────────
  // Fast low-voltage onset → rhythmic delta; 20s seizure, 50s recovery
  if (ap.has('focal-frontal-ictal') && (c.isLeftFront || c.isFrontal)) {
    const k = 'ffront-epoch';
    if (getT(k) < 0) setT(k, t + 5);
    const el2 = t - getT(k);
    if (el2 >= 0) {
      const cycle = el2 % 70;
      if (cycle < 20) {
        const pos  = cycle / 20;
        const freq = 18 - pos * 15;                    // 18→3 Hz
        const amp  = (c.isLeftFront ? 100 : 50) * (0.2 + 0.8 * pos);
        v += amp * Math.sin(2 * Math.PI * freq * t);
      }
    }
  }

  return v;
}

// ─── Interictal epileptiform patterns ────────────────────────────────────────
//
// Spatial field maps give each electrode a fraction of the focus amplitude.
// This is what drives montage-correct behaviour automatically:
//
//  BIPOLAR (active − reference):
//   • Channel whose reference IS the focus: (small − large) → NEGATIVE → DOWN
//   • Channel whose active IS the focus:    (large − small) → POSITIVE → UP
//   → Phase REVERSAL at the focus electrode ✓
//   → Channels at chain ends deflect in the same direction as their nearest
//     focus-flanking channel but with smaller amplitude (beginning/end of
//     chain phenomena) ✓
//
//  REFERENTIAL (electrode − ear/AVG):
//   • Focus electrode: largest deflection (maximum amplitude)
//   • Adjacent electrodes: proportionally smaller deflections ✓

// Left temporal focus at T3
const LT_FIELD: Record<string, number> = {
  T3: 1.00,          // focus — maximum
  F7: 0.50,          // adjacent anterior (same chain)
  T5: 0.42,          // adjacent posterior (same chain) — MUST differ from T3
  Fp1: 0.15,         // distant anterior (beginning-of-chain neighbour)
  O1:  0.07,         // distant posterior (end-of-chain neighbour)
  C3:  0.10,         // adjacent central — remote spread
  P3:  0.05,         // parietal — very remote
};

// Right temporal focus at T4
const RT_FIELD: Record<string, number> = {
  T4: 1.00,
  F8: 0.50,
  T6: 0.42,
  Fp2: 0.15,
  O2:  0.07,
  C4:  0.10,
  P4:  0.05,
};

// Left frontal focus at F3
// Bipolar paramedian: Fp1-F3 DOWN, F3-C3 UP  (phase reversal at F3)
// Bipolar temporal:   Fp1-F7 picks up Fp1 field (small, same direction)
const LF_FIELD: Record<string, number> = {
  F3:  1.00,         // focus
  Fp1: 0.58,         // adjacent anterior
  Fz:  0.32,         // midline spread
  C3:  0.22,         // posterior spread — MUST differ so F3-C3 shows UP deflection
  F7:  0.18,         // lateral spread
  Cz:  0.10,
  Fp2: 0.08,
  F4:  0.12,
};

function epileptiformVoltage(el: string, t: number, ap: Set<string>): number {
  let v = 0;

  // ── Left temporal spikes (focus T3) ──────────────────────────────────────────
  if (ap.has('focal-spikes-lt')) {
    const k = 'lt-spike';
    if (t - getT(k) > 4 && Math.random() < 0.006) setT(k, t);
    const dt  = t - getT(k);
    const att = LT_FIELD[el] ?? 0;
    if (att > 0) v += att * spikeSlowWave(dt, 185, 130);
  }

  // ── Right temporal spikes (focus T4) ─────────────────────────────────────────
  if (ap.has('focal-spikes-rt')) {
    const k = 'rt-spike';
    if (t - getT(k) > 4 && Math.random() < 0.006) setT(k, t);
    const dt  = t - getT(k);
    const att = RT_FIELD[el] ?? 0;
    if (att > 0) v += att * spikeSlowWave(dt, 185, 130);
  }

  // ── Left frontal spikes (focus F3) ───────────────────────────────────────────
  if (ap.has('focal-spikes-lf')) {
    const k = 'lf-spike';
    if (t - getT(k) > 5 && Math.random() < 0.005) setT(k, t);
    const dt  = t - getT(k);
    const att = LF_FIELD[el] ?? 0;
    if (att > 0) v += att * spikeSlowWave(dt, 165, 120);
  }

  // ── Generalised 3 Hz spike-wave (interictal bursts) ──────────────────────────
  if (ap.has('3hz-gsw')) {
    const k = '3hz-gsw-burst';
    if (t - getT(k) > 4 && Math.random() < 0.005) setT(k, t);
    const burstDt = t - getT(k);
    if (burstDt >= 0 && burstDt < 3) {
      const dt = burstDt % (1 / 3);
      const amp = c.isFrontal || c.isMidline ? 200 : 160;
      v += spikeSlowWave(dt, amp, amp * 0.65);
    }
  }

  // ── Polyspike-wave (generalised) ─────────────────────────────────────────────
  if (ap.has('polyspike-wave')) {
    const k = 'psw-burst';
    if (t - getT(k) > 5 && Math.random() < 0.004) setT(k, t);
    const burstDt = t - getT(k);
    if (burstDt >= 0 && burstDt < 3) {
      const cycleLen = 0.4;
      const dt = burstDt % cycleLen;
      const amp = c.isFrontal || c.isMidline ? 180 : 140;
      // Multiple spikes: 3 rapid spikes then slow wave
      v += amp * 0.7 * gaussian(dt, 0.03, 0.015);
      v += amp * 0.8 * gaussian(dt, 0.07, 0.015);
      v += amp * 1.0 * gaussian(dt, 0.11, 0.015);
      v -= amp * 0.7 * gaussian(dt, 0.28, 0.07);
    }
  }

  // ── Hypsarrhythmia ───────────────────────────────────────────────────────────
  if (ap.has('hypsarrhythmia')) {
    // Chaotic: random spikes at random electrodes, high-amplitude delta
    v += 80 * Math.sin(2 * Math.PI * 1.5 * t + Math.random() * 0.2);  // HV delta
    if (Math.random() < 0.02) {
      v += 300 * Math.exp(-(Math.random() * 10));   // random spikes
    }
    v += (Math.random() - 0.5) * 50;
  }

  return v;
}

// ─── Non-epileptiform abnormalities ──────────────────────────────────────────

function abnormalVoltage(el: string, t: number, ap: Set<string>): number {
  const c = classify(el);
  let v = 0;

  // ── FIRDA: frontal intermittent rhythmic delta ────────────────────────────────
  if (ap.has('firda') && (c.isFrontal || c.isMidline)) {
    const k = 'firda-burst';
    if (t - getT(k) > 5 && Math.random() < 0.008) setT(k, t);
    const dt = t - getT(k);
    if (dt >= 0 && dt < 3) {
      v += 100 * Math.sin(2 * Math.PI * 2.5 * dt);
    }
  }

  // ── Focal polymorphic delta (left temporal) ───────────────────────────────────
  if (ap.has('focal-delta-temporal') && (c.isLeftTmp || el === 'F7')) {
    const k = 'fdt-burst';
    if (t - getT(k) > 4 && Math.random() < 0.01) setT(k, t);
    const dt = t - getT(k);
    if (dt >= 0 && dt < 2.5) {
      const ph2 = elPhase.get(el)!;
      v += 80 * Math.sin(2 * Math.PI * 2 * dt + ph2.delta);
      v += 40 * Math.sin(2 * Math.PI * 1.5 * dt + ph2.delta2);
    }
  }

  // ── Triphasic waves (generalised, anteriorly predominant) ────────────────────
  if (ap.has('triphasic')) {
    const k = 'triphasic';
    if (t - getT(k) > 0.5 && Math.random() < 0.02) setT(k, t);
    const dt = t - getT(k);
    const antAmp = c.isFrontal ? 180 : c.isMidline ? 160 : c.isCentral ? 120 : 80;
    v += triphasicWave(dt, antAmp);
  }

  // ── GPEDs: generalised periodic epileptiform discharges ──────────────────────
  if (ap.has('gpeds')) {
    const period = 1.4;
    const phase = t % period;
    if (phase < 0.12) {
      const amp = c.isFrontal || c.isMidline ? 200 : 150;
      v += amp * gaussian(phase, 0.05, 0.02);      // spike
      v -= amp * 0.5 * gaussian(phase, 0.11, 0.04); // following neg
    }
  }

  // ── LPEDs: lateralised periodic epileptiform discharges (left temporal) ───────
  if (ap.has('lpeds') && (c.isLeftTmp || el === 'F7')) {
    const period = 1.2;
    const phase = t % period;
    if (phase < 0.15) {
      const amp = c.isLeftTmp ? 220 : 120;
      v += spikeSlowWave(phase, amp, amp * 0.6);
    }
  }

  return v;
}

// ─── Artifacts ───────────────────────────────────────────────────────────────

function artifactVoltage(el: string, t: number, ap: Set<string>): number {
  const c = classify(el);
  let v = 0;

  // ── Eye blink ────────────────────────────────────────────────────────────────
  if (ap.has('blink')) {
    if (t - getT('blink') > 3 && Math.random() < 0.008) setT('blink', t);
    const dt = t - getT('blink');
    if (dt > 0 && dt < 0.4) {
      if (['Fp1','Fp2'].includes(el))              v += 280 * gaussian(dt, 0.12, 0.05);
      else if (['F3','F4','F7','F8'].includes(el)) v +=  90 * gaussian(dt, 0.12, 0.05);
    }
  }

  // ── Lateral eye movement ──────────────────────────────────────────────────────
  if (ap.has('eye-movement')) {
    if (t - getT('eye-mv') > 4 && Math.random() < 0.008) setT('eye-mv', t);
    const dt = t - getT('eye-mv');
    if (dt > 0 && dt < 0.8) {
      const pulse = 180 * gaussian(dt, 0.25, 0.12);
      if (['F7','Fp1','T3'].includes(el)) v += pulse;
      if (['F8','Fp2','T4'].includes(el)) v -= pulse;
    }
  }

  // ── Muscle (EMG) ─────────────────────────────────────────────────────────────
  if (ap.has('muscle')) {
    // High-frequency random noise (temporal/frontal)
    if (c.isTemporal || c.isFrontal || c.isPostTmp) {
      v += (Math.random() - 0.5) * 60;
      v += 30 * Math.sin(2 * Math.PI * 80 * t + Math.random());
      v += 20 * Math.sin(2 * Math.PI * 120 * t + Math.random());
    }
  }

  // ── Chewing artifact ─────────────────────────────────────────────────────────
  if (ap.has('chewing') && (c.isTemporal || el === 'T3' || el === 'T4')) {
    const k = 'chew';
    if (t - getT(k) > 0.8 && Math.random() < 0.02) setT(k, t);
    const dt = t - getT(k);
    if (dt > 0 && dt < 0.25) {
      v += 300 * gaussian(dt, 0.1, 0.05) * (1 + 0.3 * Math.random());
    }
  }

  // ── Electrode pop ────────────────────────────────────────────────────────────
  if (ap.has('electrode-pop')) {
    if (t - getT('pop-time') > 4 && Math.random() < 0.02) {
      setT('pop-time', t);
      setT('pop-el', ALL_ELECTRODES.indexOf(
        ALL_ELECTRODES[Math.floor(Math.random() * ALL_ELECTRODES.length)]
      ));
    }
    const popIdx = Math.round(getT('pop-el'));
    if (ALL_ELECTRODES[popIdx] === el) {
      const dt = t - getT('pop-time');
      if (dt > 0 && dt < 1) v += 350 * Math.exp(-dt * 12) * Math.cos(2 * Math.PI * 6 * dt);
    }
  }

  // ── Sweat artifact ────────────────────────────────────────────────────────────
  if (ap.has('sweat') && (c.isFrontal || ['F3','F4'].includes(el))) {
    if (t - getT('sweat') > 8 && Math.random() < 0.008) setT('sweat', t);
    const dt = t - getT('sweat');
    if (dt > 0 && dt < 8) v += 220 * Math.sin(2 * Math.PI * 0.08 * dt) * gaussian(dt, 4, 2);
  }

  // ── 50 Hz mains ──────────────────────────────────────────────────────────────
  if (ap.has('50hz')) v += 45 * Math.sin(2 * Math.PI * 50 * t);

  return v;
}

// ─── Normal variants ──────────────────────────────────────────────────────────

function variantVoltage(el: string, t: number, ap: Set<string>): number {
  const c  = classify(el);
  const ph = elPhase.get(el)!;
  let v = 0;

  // ── Mu rhythm (central arch-shaped 10 Hz) ────────────────────────────────────
  if (ap.has('mu-rhythm') && (c.isCentral || el === 'Cz')) {
    const env  = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.12 * t + ph.mu);
    const arch = Math.abs(Math.sin(2 * Math.PI * 10 * t + ph.mu));
    v += 38 * env * arch;
  }

  // ── Wicket spikes (temporal arch 9 Hz bursts) ────────────────────────────────
  if (ap.has('wicket') && (c.isTemporal || c.isPostTmp || el === 'F7' || el === 'F8')) {
    if (t - getT('wicket') > 3 && Math.random() < 0.015) setT('wicket', t);
    const dt = t - getT('wicket');
    if (dt > 0 && dt < 0.9) {
      const env  = gaussian(dt, 0.45, 0.22);
      const arch = Math.abs(Math.sin(2 * Math.PI * 9 * t + ph.alpha));
      v += 90 * env * arch;
    }
  }

  // ── RMTD (rhythmic mid-temporal theta of drowsiness) ─────────────────────────
  if (ap.has('rmtd') && (c.isTemporal || el === 'T3' || el === 'T4')) {
    if (t - getT('rmtd') > 4 && Math.random() < 0.01) setT('rmtd', t);
    const dt = t - getT('rmtd');
    if (dt > 0 && dt < 4) {
      const env = gaussian(dt, 2, 1.2);
      v += 65 * env * Math.sin(2 * Math.PI * 5.5 * t + ph.theta);
    }
  }

  // ── Lambda waves (occipital positive transients) ──────────────────────────────
  if (ap.has('lambda') && (c.isOccipital || c.isParietal)) {
    if (t - getT('lambda') > 0.8 && Math.random() < 0.025) setT('lambda', t);
    const dt = t - getT('lambda');
    if (dt > 0 && dt < 0.15) {
      // Lambda is positive (surface positive in occipital)
      v += 60 * Math.sin(Math.PI * dt / 0.15);
    }
  }

  // ── 6 Hz phantom spike-wave ───────────────────────────────────────────────────
  if (ap.has('6hz-sw')) {
    if (t - getT('6hz-sw') > 4 && Math.random() < 0.005) setT('6hz-sw', t);
    const dt = t - getT('6hz-sw');
    if (dt >= 0 && dt < 1) {
      const cycleLen = 1 / 6;
      const dtInCycle = dt % cycleLen;
      v += 50 * gaussian(dtInCycle, 0.02, 0.008); // tiny spike
      v -= 30 * gaussian(dtInCycle, 0.1,  0.035); // small slow wave
    }
  }

  // ── 14 & 6 Hz positive bursts ─────────────────────────────────────────────────
  if (ap.has('14-6-pos') && (c.isPostTmp || c.isTemporal)) {
    if (t - getT('14-6') > 5 && Math.random() < 0.01) setT('14-6', t);
    const dt = t - getT('14-6');
    if (dt > 0 && dt < 1.0) {
      const env = gaussian(dt, 0.5, 0.25);
      // 14 Hz component (positive)
      v += 55 * env * Math.abs(Math.sin(2 * Math.PI * 14 * dt));
      // 6 Hz component
      v += 35 * env * Math.abs(Math.sin(2 * Math.PI * 6  * dt));
    }
  }

  // ── BETS / Small sharp spikes ─────────────────────────────────────────────────
  if (ap.has('bets') && (c.isTemporal || el === 'F7' || el === 'F8')) {
    if (t - getT('bets') > 6 && Math.random() < 0.007) setT('bets', t);
    const dt = t - getT('bets');
    if (dt > 0 && dt < 0.05) {
      // Very brief (<50 ms), low amplitude (<50 µV), monophasic
      v += 40 * Math.exp(-dt * 60);
    }
  }

  // ── Sleep-state auto patterns ─────────────────────────────────────────────────
  // These are always present in N1/N2 sleep regardless of manual toggles
  return v;
}

// ─── Sleep-stage structural patterns (N1, N2, N3) ────────────────────────────

function sleepStructureVoltage(el: string, t: number, st: PatientState, ap: Set<string>): number {
  const c = classify(el);
  let v = 0;

  const isSleeping = st === 'n1' || st === 'n2' || st === 'n3';
  const isN2orN3   = st === 'n2' || st === 'n3';

  // ── Vertex sharp waves (N1, N2; Cz maximal) ──────────────────────────────────
  const wantsV = ap.has('v-waves') || st === 'n1' || st === 'n2';
  if (wantsV && (c.isCentral || c.isMidline)) {
    const interval = st === 'n2' ? 8 : 14;
    if (t - getT('vwave') > interval && Math.random() < 0.005) setT('vwave', t);
    const dt = t - getT('vwave');
    if (dt > 0 && dt < 0.9) {
      const amp = el === 'Cz' ? 140 : (c.isCentral ? 70 : 40);
      v -= amp * Math.sin(2 * Math.PI * 2 * dt) * gaussian(dt, 0.22, 0.1);
    }
  }

  // ── K-complexes (N2; Fz/Cz/Pz maximal) ──────────────────────────────────────
  const wantsK = ap.has('k-complex') || st === 'n2';
  if (wantsK && (c.isMidline || c.isCentral || el === 'F3' || el === 'F4')) {
    const interval = st === 'n2' ? 14 : 22;
    if (t - getT('kcomplex') > interval && Math.random() < 0.003) setT('kcomplex', t);
    const dt = t - getT('kcomplex');
    if (dt > 0 && dt < 2.2) {
      const amp   = c.isMidline ? 240 : (c.isCentral ? 120 : 80);
      const sharp = -amp       * Math.sin(2 * Math.PI * 3   * dt) * gaussian(dt, 0.20, 0.08);
      const slow  =  amp * 0.9 * Math.sin(2 * Math.PI * 0.8 * dt) * gaussian(dt, 0.70, 0.24);
      v += sharp + slow;
    }
  }

  // ── Sleep spindles (N2; central 12-15 Hz) ────────────────────────────────────
  const wantsSp = ap.has('spindles') || st === 'n2';
  if (wantsSp && (c.isCentral || c.isMidline)) {
    const interval = st === 'n2' ? 6 : 12;
    if (t - getT('spindle') > interval && Math.random() < 0.008) setT('spindle', t);
    const dt = t - getT('spindle');
    if (dt > 0 && dt < 1.8) {
      const amp = el === 'Cz' ? 48 : (c.isCentral ? 30 : 20);
      v += amp * gaussian(dt, 0.75, 0.32) * Math.sin(2 * Math.PI * 14 * dt);
    }
  }

  // ── POSTS (occipital sharp transients of sleep, N1/N2) ───────────────────────
  const wantsPosts = ap.has('posts') || st === 'n1' || st === 'n2';
  if (wantsPosts && (c.isOccipital || c.isParietal)) {
    if (t - getT('posts') > 1.5 && Math.random() < 0.02) setT('posts', t);
    const dt = t - getT('posts');
    if (dt > 0 && dt < 0.12) v += 75 * Math.sin(Math.PI * dt / 0.1);
  }

  return v;
}

// ─── Main exported voltage function ──────────────────────────────────────────

export function getElectrodeVoltage(electrode: Electrode, t: number, settings: SimSettings): number {
  if (electrode === 'A1' || electrode === 'A2') return (Math.random() - 0.5) * 3;

  const { patientState: st, activePatterns: ap } = settings;

  // 1. Background rhythm
  let v = backgroundSignal(electrode, t, st, ap);

  // 2. Voltage gate (burst suppression can suppress everything below)
  const gate = voltageGate(t, ap);
  v *= gate;

  // Add burst noise during burst phase
  if (ap.has('burst-suppression') && gate > 1) {
    v += 80 * (Math.random() - 0.5);
  }

  // 3. Sleep structural patterns (auto-triggered by state + manual toggles)
  v += sleepStructureVoltage(electrode, t, st, ap);

  // 4. Normal variants
  v += variantVoltage(electrode, t, ap);

  // 5. Artifacts
  v += artifactVoltage(electrode, t, ap);

  // 6. Non-epileptiform abnormalities
  v += abnormalVoltage(electrode, t, ap);

  // 7. Interictal epileptiform
  v += epileptiformVoltage(electrode, t, ap);

  // 8. Ictal / seizure (added on top; may dominate)
  v += ictalVoltage(electrode, t, ap);

  return v;
}

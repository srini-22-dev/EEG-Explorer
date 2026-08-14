/**
 * The streaming EEG engine: sources -> leadfield -> electrodes -> recording chain.
 *
 * Implements the generative model of briefing §1:
 *
 *   V_scalp(t) = L * [ s_aperiodic(t) + s_oscillatory(t) ]      (neural, via leadfield)
 *              + A_ocular + A_muscle + A_cardiac + A_electrode   (own topographies)
 *              + n_instrument                                    (sensor floor)
 *              -> reference -> amplifier filter
 *
 * Streaming and stateful by construction. Every generator here — OU banks, Hopf
 * oscillators, burst renewal processes, shot-noise EMG — is a recursive process
 * that has to be advanced one sample at a time in order. That is the reason the
 * old `getElectrodeVoltage(electrode, t)` signature had to go: presenting a
 * stateful process behind a pure-function-of-t interface is what allowed a
 * frequency-wander term to be multiplied by absolute elapsed time, which drifted
 * the posterior rhythm into the theta band after ten minutes of running.
 */

import { AperiodicSource } from './aperiodic';
import { HopfOscillator, MU_WARP, SLOW_WAVE_WARP, type PhaseWarp } from './oscillator';
import { BurstyOscillator } from './bursts';
import { VigilanceState } from './state';
import {
  buildLeadfield, sourceUnder, backgroundPatches, tangentialAt,
  type SourceSpec, type Leadfield,
} from './forward';
import {
  ARTIFACT_SOURCES, BlinkGenerator, SaccadeGenerator, EmgGenerator, EcgGenerator,
  ElectrodePopGenerator, SweatGenerator, LineNoiseGenerator, MovementGenerator,
  artifactSeeds,
} from './artifacts';
import { RecordingChain, sampleDefects, type ChannelDefect } from './chain';
import { Gaussian, deriveSeed } from './rng';
import {
  PATTERN_SOURCES,
  type PatternGenerator, type PatternSourceDescriptor, type SampleContext, type Band,
} from './sources/registry';
import type { PatientState } from '../utils/simTypes';

/**
 * Per-subject parameters (briefing §9/§12). Real datasets vary enormously in
 * individual alpha frequency, aperiodic exponent, skull conductivity and artifact
 * burden; a simulator that emits one canonical subject produces benchmarks that
 * do not survive contact with real inter-subject variability.
 */
export type SubjectParams = {
  /** Individual alpha frequency, Hz (§4: 8-12 across people, declining with age). */
  iaf: number;
  /** Aperiodic exponent (§2: awake resting 1.0-1.8). */
  exponent: number;
  /** Broadband background RMS per channel, microvolts (§2: 5-20). */
  backgroundRms: number;
  /** Posterior alpha strength at its maximal electrode, microvolts RMS. */
  alphaRms: number;
  /** Sensorimotor beta strength, microvolts RMS. */
  betaRms: number;
  /** Scalp field width — stands in for skull conductivity. */
  smearing: number;
  /** Multiplier on artifact rates and bad-channel likelihood. */
  artifactBurden: number;
  /** Baseline vigilance, 0-1. */
  vigilanceBias: number;
  /** Mains frequency, Hz. */
  lineFreq: 50 | 60;
  /** Mains amplitude in microvolts (0 disables). */
  lineAmp: number;
};

export function sampleSubject(seed: number): SubjectParams {
  const g = new Gaussian(deriveSeed(seed, 'subject'));
  return {
    iaf: 8.2 + g.uniform() * 3.4,
    exponent: 1.05 + g.uniform() * 0.75,
    backgroundRms: g.range(6, 14),
    alphaRms: g.range(8, 20),
    betaRms: g.range(2.5, 6),
    smearing: g.range(0.21, 0.30),
    artifactBurden: g.range(0.5, 1.6),
    vigilanceBias: g.range(0.35, 0.7),
    lineFreq: 50,
    lineAmp: g.uniform() < 0.5 ? 0 : g.range(1, 8),
  };
}

export type EngineOptions = {
  seed?: number;
  fs?: number;
  subject?: Partial<SubjectParams>;
  /** Number of distributed cortical patches carrying the aperiodic background. */
  backgroundPatchCount?: number;
  /** Set false to omit artifacts (useful for isolating neural validation). */
  artifacts?: boolean;
  /** Set false to omit the amplifier/sensor chain. */
  recordingChain?: boolean;
};

/** Per-sample ground truth, for the structured sidecar §14 asks for from step 1. */
export type GroundTruth = {
  t: number;
  vigilance: number;
  blinking: boolean;
  betaBursting: boolean;
  popChannel: number;
};

/**
 * Per-generator runtime enable flags for the engine's own artifact layer (§8,
 * `artifacts.ts`). Distinct from the `artifacts` *constructor* option: that one
 * decides once, at build time, whether the artifact sources exist in the
 * leadfield at all (used to isolate neural-only validation runs). This is the
 * opposite kind of switch — read every sample, on an engine that already
 * exists, so a UI checkbox can silence a generator without rebuilding the
 * engine (see `next()`'s comment and the class doc on `setPatientState`).
 * Every flag defaults to true so a caller that never touches this — every
 * existing construction, including `validateEngine.ts` — sees the engine's
 * previous always-on artifact behaviour unchanged.
 */
export type ArtifactGates = {
  /** Corneo-retinal blink deflection at the ocular sources. */
  blink: boolean;
  /** Lateral gaze / saccade deflection and its onset spike. */
  saccade: boolean;
  /** Temporalis + frontalis EMG (muscle) shot noise. */
  emg: boolean;
  /** Electrode pop (single-channel step + decay, leadfield bypassed). */
  pop: boolean;
  /** Frontal sweat-gland drift. */
  sweat: boolean;
  /** Mains interference injected in the recording chain. */
  line: boolean;
  /**
   * Cardiac field contaminating scalp electrodes — the QRS complex volume-
   * conducted onto the EEG. This is the scalp contamination only, not a
   * dedicated ECG trace.
   */
  ecgScalp: boolean;
  /** Large, rare mechanical movement transients. */
  movement: boolean;
};

export type { PatientState };

type NeuralSource =
  | { kind: 'aperiodic'; src: AperiodicSource; band: 'background' }
  | { kind: 'hopf'; src: HopfOscillator; band: Band; baseRms: number }
  | { kind: 'burst'; src: BurstyOscillator; band: Band; baseRms: number };

/**
 * Per-state band gains. Sleep is not "the same EEG, slower": each stage has its
 * own balance of rhythms, and §4 is explicit that strong delta in an awake adult
 * signals artifact or pathology rather than normal variation — hence awake delta
 * being gated almost to nothing here.
 */
const STATE_GAINS: Record<PatientState, Record<Band, number>> = {
  awake:  { background: 1.00, alpha: 1.00, mu: 1.00, theta: 0.35, delta: 0.06, beta: 1.00 },
  drowsy: { background: 1.10, alpha: 0.45, mu: 0.55, theta: 1.20, delta: 0.30, beta: 0.70 },
  n1:     { background: 1.20, alpha: 0.12, mu: 0.15, theta: 1.70, delta: 0.70, beta: 0.45 },
  n2:     { background: 1.35, alpha: 0.04, mu: 0.05, theta: 1.30, delta: 1.60, beta: 0.30 },
  n3:     { background: 1.60, alpha: 0.02, mu: 0.02, theta: 0.90, delta: 3.20, beta: 0.20 },
};

/** Baseline vigilance for each state, feeding the slow drift in `state.ts`. */
const STATE_VIGILANCE: Record<PatientState, number> = {
  awake: 0.68, drowsy: 0.38, n1: 0.25, n2: 0.15, n3: 0.08,
};

export class EegEngine {
  readonly electrodes: string[];
  readonly fs: number;
  readonly subject: SubjectParams;
  readonly groundTruth: GroundTruth;

  private dt: number;
  private leadfield: Leadfield;
  private neural: NeuralSource[];
  private nNeural: number;
  private srcValues: Float64Array;
  private vigilance: VigilanceState;

  private blink: BlinkGenerator | null = null;
  private saccade: SaccadeGenerator | null = null;
  private emgL: EmgGenerator | null = null;
  private emgR: EmgGenerator | null = null;
  private emgF: EmgGenerator | null = null;
  private ecg: EcgGenerator | null = null;
  private pop: ElectrodePopGenerator | null = null;
  private sweat: SweatGenerator | null = null;
  private line: LineNoiseGenerator | null = null;
  private movement: MovementGenerator | null = null;
  private artifactIndex: Record<string, number> = {};

  // Pattern sources: every toggleable clinical element (sleep grapho-elements,
  // benign variants, non-epileptiform abnormalities, interictal epileptiform,
  // ictal). Each owns one leadfield column appended after the artifact block, so
  // `patternIndex[i]` is the source slot for descriptor `i`. Generators advance
  // every sample; their `next()` returns 0 when the source is not enabled.
  private patternDescriptors: PatternSourceDescriptor[] = [];
  private patternGens: PatternGenerator[] = [];
  private patternIndex: number[] = [];
  private activePatterns: Set<string> = new Set();

  // A dedicated, always-on ECG generator whose full-amplitude morphology drives
  // the synthetic ECG display channel (not the scalp cardiac contamination that
  // `this.ecg` feeds into V). Exposed via `ecgChannelValue`, read by the adapter.
  private ecgChannel!: EcgGenerator;
  ecgChannelValue = 0;

  private chain: RecordingChain | null = null;
  private defects: ChannelDefect[] = [];
  private sampleIndex = 0;
  private patientState: PatientState = 'awake';
  private gates: ArtifactGates = {
    blink: true, saccade: true, emg: true, pop: true,
    sweat: true, line: true, ecgScalp: true, movement: true,
  };

  constructor(opts: EngineOptions = {}) {
    const {
      seed = 1,
      fs = 250,
      backgroundPatchCount = 16,
      artifacts = true,
      recordingChain = true,
    } = opts;

    this.fs = fs;
    this.dt = 1 / fs;
    this.subject = { ...sampleSubject(seed), ...(opts.subject ?? {}) };
    const S = this.subject;

    // ---- source geometry ----
    const bgPatches = backgroundPatches(backgroundPatchCount);
    const rhythmSpecs: SourceSpec[] = [
      sourceUnder('pdrL', ['O1', 'P3'], { extent: S.smearing * 1.6 }),
      sourceUnder('pdrR', ['O2', 'P4'], { extent: S.smearing * 1.6 }),
      // Mu is sensorimotor and largely sulcal, hence tangential — which is why it
      // is focal at C3/C4 rather than a broad central blob (§4).
      (() => {
        const s = sourceUnder('muL', ['C3'], { extent: S.smearing });
        return { ...s, orientation: tangentialAt(s.pos, [0, 0, 1]) };
      })(),
      (() => {
        const s = sourceUnder('muR', ['C4'], { extent: S.smearing });
        return { ...s, orientation: tangentialAt(s.pos, [0, 0, 1]) };
      })(),
      sourceUnder('betaL', ['C3'], { extent: S.smearing * 1.1 }),
      sourceUnder('betaR', ['C4'], { extent: S.smearing * 1.1 }),
      sourceUnder('betaF', ['Fz', 'F3', 'F4'], { extent: S.smearing * 1.4 }),
      sourceUnder('thetaFm', ['Fz'], { extent: S.smearing * 1.3 }),
      // Sleep rhythms. Delta is frontally predominant (§4), so it gets broad
      // frontal and central patches rather than one diffuse blob.
      sourceUnder('deltaF', ['Fz', 'Fp1', 'Fp2'], { extent: S.smearing * 2.0 }),
      sourceUnder('deltaC', ['Cz', 'C3', 'C4'], { extent: S.smearing * 2.0 }),
      sourceUnder('thetaDiffuse', ['Cz', 'Pz'], { extent: S.smearing * 2.2 }),
    ];

    const artifactSpecs: SourceSpec[] = artifacts ? Object.values(ARTIFACT_SOURCES) : [];

    // Pattern sources sit at the tail of the source list so their leadfield
    // columns form a known contiguous block after the artifact columns.
    this.patternDescriptors = PATTERN_SOURCES;
    const patternSpecs = PATTERN_SOURCES.map(d => d.spec);

    const allSpecs = [...bgPatches, ...rhythmSpecs, ...artifactSpecs, ...patternSpecs];
    this.leadfield = buildLeadfield(allSpecs);
    this.electrodes = this.leadfield.electrodes;

    if (artifacts) {
      const base = bgPatches.length + rhythmSpecs.length;
      Object.keys(ARTIFACT_SOURCES).forEach((k, i) => { this.artifactIndex[k] = base + i; });
    }

    const patternBase = bgPatches.length + rhythmSpecs.length + artifactSpecs.length;
    this.patternIndex = PATTERN_SOURCES.map((_, i) => patternBase + i);
    this.patternGens = PATTERN_SOURCES.map(d => d.make(deriveSeed(seed, d.id), this.dt));

    // ---- neural generators ----
    this.neural = [];
    // Background patches share a spectral exponent but are independent processes,
    // so neighbouring electrodes see overlapping mixtures rather than identical or
    // wholly unrelated noise.
    for (let i = 0; i < bgPatches.length; i++) {
      this.neural.push({
        kind: 'aperiodic',
        band: 'background',
        src: new AperiodicSource(deriveSeed(seed, `bg${i}`), this.dt, {
          exponent: S.exponent,
          rms: S.backgroundRms,
        }),
      });
    }
    const hemisphereOffset = 0.25;   // the two hemispheres are never identical
    this.neural.push({
      kind: 'hopf', band: 'alpha', baseRms: S.alphaRms,
      src: new HopfOscillator(deriveSeed(seed, 'pdrL'), this.dt, {
        freq: S.iaf, rms: S.alphaRms, freqWander: 0.55, damping: -2.6,
      }),
    });
    this.neural.push({
      kind: 'hopf', band: 'alpha', baseRms: S.alphaRms * 0.92,
      src: new HopfOscillator(deriveSeed(seed, 'pdrR'), this.dt, {
        freq: S.iaf + hemisphereOffset, rms: S.alphaRms * 0.92, freqWander: 0.55, damping: -2.6,
      }),
    });
    for (const [id, warp] of [['muL', MU_WARP], ['muR', MU_WARP]] as [string, PhaseWarp][]) {
      this.neural.push({
        kind: 'hopf', band: 'mu', baseRms: S.alphaRms * 0.45,
        src: new HopfOscillator(deriveSeed(seed, id), this.dt, {
          freq: S.iaf + 0.4, rms: S.alphaRms * 0.45, freqWander: 0.4, damping: -3.2, warp,
        }),
      });
    }
    for (const id of ['betaL', 'betaR', 'betaF']) {
      this.neural.push({
        kind: 'burst', band: 'beta', baseRms: S.betaRms,
        src: new BurstyOscillator(deriveSeed(seed, id), this.dt, {
          freq: 20, freqSpread: 3, medianDuration: 0.15, meanInterval: 0.7, rms: S.betaRms,
        }),
      });
    }
    // Frontal midline theta is task-locked and bursty (§4), not a sustained rhythm.
    this.neural.push({
      kind: 'burst', band: 'theta', baseRms: S.betaRms * 0.9,
      src: new BurstyOscillator(deriveSeed(seed, 'thetaFm'), this.dt, {
        freq: 6, freqSpread: 0.8, medianDuration: 0.9, meanInterval: 4.5, rms: S.betaRms * 0.9,
      }),
    });
    for (const id of ['deltaF', 'deltaC']) {
      this.neural.push({
        kind: 'hopf', band: 'delta', baseRms: 28,
        src: new HopfOscillator(deriveSeed(seed, id), this.dt, {
          freq: 1.1, rms: 28, freqWander: 0.35, damping: -0.9, warp: SLOW_WAVE_WARP,
        }),
      });
    }
    this.neural.push({
      kind: 'hopf', band: 'theta', baseRms: 12,
      src: new HopfOscillator(deriveSeed(seed, 'thetaDiffuse'), this.dt, {
        freq: 5.4, rms: 12, freqWander: 0.7, damping: -2.2,
      }),
    });

    this.nNeural = this.neural.length;
    this.srcValues = new Float64Array(allSpecs.length);
    this.vigilance = new VigilanceState(seed, this.dt, S.vigilanceBias);

    // ---- artifacts ----
    if (artifacts) {
      const A = artifactSeeds(seed);
      const b = S.artifactBurden;
      this.blink = new BlinkGenerator(A.blink, this.dt, 16 * b);
      this.saccade = new SaccadeGenerator(A.saccade, this.dt, 25 * b);
      this.emgL = new EmgGenerator(A.emgL, this.dt);
      this.emgR = new EmgGenerator(A.emgR, this.dt);
      this.emgF = new EmgGenerator(A.emgF, this.dt);
      this.ecg = new EcgGenerator(A.ecg, this.dt);
      this.pop = new ElectrodePopGenerator(A.pop, this.dt, this.electrodes.length, 60 / b);
      this.sweat = new SweatGenerator(A.sweat, this.dt);
      this.line = new LineNoiseGenerator(A.line, this.dt, S.lineFreq);
      this.movement = new MovementGenerator(A.movement, this.dt, 90 / b);
    }

    if (recordingChain) {
      this.defects = sampleDefects(seed, this.electrodes.length, S.artifactBurden);
      this.chain = new RecordingChain(seed, this.dt, this.electrodes.length, this.defects);
    }

    // Independent of the `artifacts` flag: the ECG display channel is a first-class
    // recorded trace, not an artifact, so it exists even when scalp artifacts are off.
    this.ecgChannel = new EcgGenerator(deriveSeed(seed, 'ecgChannel'), this.dt);

    this.groundTruth = { t: 0, vigilance: 0.5, blinking: false, betaBursting: false, popChannel: -1 };
  }

  /** Advance one sample, filling `out` with electrode potentials in microvolts. */
  next(out: Float64Array): void {
    this.vigilance.advance();
    const gains = this.vigilance.gains();
    const V = this.srcValues;
    V.fill(0);

    // Pattern sources first: each writes its scalar into its own leadfield slot,
    // and any active generator's gate() composes into `neuralGate`, the single
    // multiplier applied to the ongoing background+rhythm activity. That is how
    // burst-suppression and post-ictal attenuation dampen the whole record
    // without touching individual oscillators. `t` matches the sample about to be
    // emitted (sampleIndex increments at the end of next()), so the first sample
    // is evaluated at t = dt, aligning patterns with groundTruth.t.
    const tNow = (this.sampleIndex + 1) * this.dt;
    const baseCtx = { t: tNow, dt: this.dt, state: this.patientState, vigilance: this.vigilance.value };
    let neuralGate = 1;
    // Per-band multipliers on the ongoing background, for patterns that reshape the
    // spectrum (gen-slowing abolishing the alpha PDR). 1 = untouched; band gates
    // from multiple active patterns compose multiplicatively.
    const bandGate: Record<Band, number> = {
      background: 1, alpha: 1, mu: 1, theta: 1, delta: 1, beta: 1,
    };
    for (let i = 0; i < this.patternGens.length; i++) {
      const d = this.patternDescriptors[i];
      const toggleOn = d.toggles.some(tg => this.activePatterns.has(tg));
      const stateInList = d.states != null && d.states.includes(this.patientState);
      // See PatternSourceDescriptor.stateIntrinsic for the two gating modes.
      const enabled = d.stateIntrinsic
        ? toggleOn || stateInList
        : toggleOn && (d.states == null || stateInList);
      const ctx: SampleContext = { ...baseCtx, enabled };
      const gen = this.patternGens[i];
      V[this.patternIndex[i]] = gen.next(ctx);
      if (enabled && gen.gate) neuralGate *= gen.gate(ctx);
      if (enabled && gen.bandGate) {
        const bg = gen.bandGate(ctx);
        for (const b in bg) bandGate[b as Band] *= bg[b as Band]!;
      }
    }

    const sg = STATE_GAINS[this.patientState];
    let betaBursting = false;
    for (let i = 0; i < this.nNeural; i++) {
      const n = this.neural[i];
      let v = n.src.next();
      // Two multipliers, deliberately separate: the discrete clinical state sets
      // the balance of bands, and the continuous vigilance drift modulates it so
      // the record is never stationary within a state (§6).
      v *= sg[n.band];
      if (n.kind === 'hopf') {
        v *= n.band === 'alpha' || n.band === 'mu' ? gains.alpha
          : n.band === 'theta' ? gains.theta
          : n.band === 'delta' ? gains.delta : 1;
      } else if (n.kind === 'burst') {
        v *= n.band === 'theta' ? gains.theta : gains.beta;
        if (n.src.bursting && n.band === 'beta') betaBursting = true;
      }
      // Pattern gates attenuate only the ongoing neural background, never the
      // pattern sources themselves or the artifacts. The scalar `neuralGate`
      // dampens the whole record (burst-suppression); `bandGate` reshapes which
      // rhythms survive (gen-slowing abolishing alpha).
      V[i] = v * neuralGate * bandGate[n.band];
    }

    let lineVal = 0;
    if (this.blink) {
      const ix = this.artifactIndex;
      const g = this.gates;
      // Every generator advances unconditionally every sample — gating only
      // decides whether its output is added to V. That keeps each renewal
      // process's own statistics (rate, phase, decay) running underneath a
      // disabled toggle, so re-enabling it resumes rather than restarts.
      const blinkV = this.blink.next(gains.ocularRate) * 110;
      if (g.blink) { V[ix.eyeL] += blinkV; V[ix.eyeR] += blinkV; }
      const saccadeV = this.saccade!.next(gains.ocularRate) * 45;
      if (g.saccade) V[ix.gaze] += saccadeV;
      const emgLV = this.emgL!.next(gains.emg) * 9 * gains.emg;
      const emgRV = this.emgR!.next(gains.emg) * 9 * gains.emg;
      const emgFV = this.emgF!.next(gains.emg) * 6 * gains.emg;
      if (g.emg) {
        V[ix.temporalisL] += emgLV;
        V[ix.temporalisR] += emgRV;
        V[ix.frontalis] += emgFV;
      }
      const heartV = this.ecg!.next() * 9;
      if (g.ecgScalp) V[ix.heart] += heartV;
      const sweatV = this.sweat!.next() * 7;
      if (g.sweat) V[ix.sweatFrontal] += sweatV;
      const mv = this.movement!.next() * 60;
      if (g.movement) { V[ix.eyeL] += mv; V[ix.eyeR] += mv; }
      const lineRaw = this.line!.next();
      lineVal = g.line ? lineRaw : 0;
    }

    // project sources to electrodes
    const nS = this.leadfield.nSources;
    const G = this.leadfield.gain;
    for (let e = 0; e < out.length; e++) {
      let acc = 0;
      const row = e * nS;
      for (let s = 0; s < nS; s++) acc += G[row + s] * V[s];
      out[e] = acc;
    }

    // Electrode pop bypasses the leadfield entirely: it has no anatomical source,
    // so it must stay confined to one channel and spatially discontinuous (§8,
    // and the teaching point that this is how artifact is told from generator).
    if (this.pop) {
      const popV = this.pop.next() * 220;
      const c = this.pop.channel;
      if (this.gates.pop && c >= 0 && c < out.length) out[c] += popV;
    }

    if (this.chain) this.chain.process(out, lineVal, this.subject.lineAmp);

    // Synthetic ECG display channel: advanced once per sample, full amplitude.
    this.ecgChannelValue = this.ecgChannel.next() * 500;

    this.sampleIndex++;
    this.groundTruth.t = this.sampleIndex * this.dt;
    this.groundTruth.vigilance = this.vigilance.value;
    this.groundTruth.blinking = this.blink?.active ?? false;
    this.groundTruth.betaBursting = betaBursting;
    this.groundTruth.popChannel = this.pop?.channel ?? -1;
  }

  /**
   * Switch clinical state. Cheap by design: it only changes band gains and the
   * vigilance baseline, never the generators themselves, so a state change can
   * happen mid-stream without rebuilding filters or losing oscillator phase.
   */
  setPatientState(state: PatientState) {
    this.patientState = state;
    this.vigilance.setBias(STATE_VIGILANCE[state]);
  }

  /**
   * Enable/disable individual artifact generators' contribution to the
   * output. Cheap by design, same as `setPatientState`: it only flips flags
   * read at the top of `next()`, never rebuilds a generator or the leadfield,
   * so a UI checkbox can be toggled mid-recording without resetting any
   * oscillator phase or vigilance state elsewhere in the engine.
   */
  setArtifactGates(gates: Partial<ArtifactGates>) {
    Object.assign(this.gates, gates);
  }

  /**
   * Set the currently-enabled pattern toggles (the UI's `activePatterns` set).
   * Like the gates above, this only swaps a reference read at the top of
   * `next()` — no generator is rebuilt, so a toggle flips mid-recording without
   * disturbing oscillator phase or the vigilance walk. A pattern source is only
   * emitted when one of its `toggles` is in this set (and its state gate passes).
   */
  setActivePatterns(active: Set<string>) {
    this.activePatterns = active;
  }

  /** Index of a named electrode, or -1. */
  indexOf(name: string): number {
    return this.electrodes.indexOf(name);
  }
}

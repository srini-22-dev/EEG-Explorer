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
  buildLeadfield, sourceUnder, backgroundPatches, CORTICAL_SHELL,
  type SourceSpec, type Leadfield,
} from './forward';
import {
  ARTIFACT_SOURCES, BlinkGenerator, EyeOpeningGenerator, SaccadeGenerator, EmgGenerator, EcgGenerator,
  ElectrodePopGenerator, SweatGenerator, LineNoiseGenerator, MovementGenerator,
  artifactSeeds,
} from './artifacts';
import { RecordingChain, sampleDefects, type ChannelDefect } from './chain';
import { Gaussian, deriveSeed } from './rng';
import {
  PATTERN_SOURCES,
  type PatternGenerator, type PatternSourceDescriptor, type SampleContext, type Band,
} from './sources/registry';
import type {
  PatientState, IctalHemisphere, IctalParams, IctalParamsMap,
  ArtifactParams, EmgRegion,
} from '../utils/simTypes';
import { defaultIctalParamsMap, POP_TARGET_ANY } from '../utils/simTypes';

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
  /**
   * Seconds of pipeline to run and discard at construction so the recording
   * chain's causal high-passes reach their settled baseline before the first
   * emitted sample. Default 0 (cold start) — the display path opts in; direct
   * callers that assert exact sample statistics leave it off.
   */
  warmup?: number;
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
  /** Eye opening/closing maneuver: slow upward (open) then smaller downward (close) at Fp. */
  eyeOpening: boolean;
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

// Sensorimotor beta burst shape (betaL/betaR/betaF). `ampSigma` is the log-SD of
// the log-normal burst-amplitude tail: at the 0.6 default it threw occasional
// bursts 3-4x the median, standing proud of the awake background as sharp central
// packets a learner could misread as muscle or an epileptiform transient. 0.4
// narrows the tail so beta reads as a low, even admixture; total beta power is
// unchanged (the oscillator recalibrates its RMS to `rms`). Exported so the
// crest-factor bound in validateEngine §6e guards the value the engine ships.
// `rms` is per-subject and supplied at construction.
export const BETA_BURST_OPTS = {
  freq: 20, freqSpread: 3, medianDuration: 0.15, meanInterval: 0.7, ampSigma: 0.4,
} as const;

// Posterior-dominant-rhythm (pdrL/pdrR) envelope depth. The HopfOscillator drives
// its waxing/waning with a log-normal multiplier exp(depth * modulator); at the
// 0.55 constructor default the tallest alpha bursts reached ~3.7x the in-band RMS,
// which lands referentially (O1/O2-AVG) as ~120-180 uV p2p in the top decile of
// bursts — above the 100 uV ceiling for a normal awake PDR (LEARNINGEEG §1) and
// sharp enough that a learner could misread a waxing alpha burst as an
// epileptiform transient. 0.42 narrows the tail while keeping enough waxing for a
// log-normal envelope (skewness stays within the §11.2 bound) and its long-range
// correlation (DFA); mean alpha power is unchanged (the oscillator recalibrates its
// RMS to `rms`). Exported so the crest-factor bound in validateEngine guards the
// value the engine ships. Not applied to mu, which is already lower-amplitude and
// central. See INFORMING-KNOWLEDGE IK-031.
export const PDR_ENVELOPE_DEPTH = 0.42;

// Antero-posterior gradient of the aperiodic background (LEARNINGEEG §3: "faster,
// lower amplitude frequencies towards the front... slower, higher amplitude
// frequencies in the back").
//
// The background patches used to be built with one `rms` and one `exponent` each,
// so the broadband floor - which carries most of the scalp variance - was spatially
// uniform, and the gradient was left entirely to the alpha sources. Those are far
// too focal to make one: measured on the production display transform the baseline
// ran O > C > F > P > Fp, i.e. parietal was the quietest region on the head, and the
// midline ran Fz > Cz > Pz, backwards.
//
// Two knobs, both applied per patch from its position on the A-P axis
// (z = +1 anterior .. -1 posterior; see `backgroundPatches` in forward.ts):
//
//   AP_AMPLITUDE_TILT  posterior:anterior broadband amplitude ratio - the "higher
//     amplitude in the back" half of the gradient.
//   AP_EXPONENT_TILT   half-range of the per-patch 1/f exponent shift. A steeper
//     exponent posteriorly puts relatively more power at low frequency (reads
//     slower); a flatter one anteriorly puts relatively more at high frequency
//     (reads faster) - the "faster towards the front" half, which nothing in the
//     engine modelled at all. AperiodicSource renormalises to its target rms, so
//     this redistributes power across frequency without changing how much of it
//     there is.
//
// Both are applied mean-preserving over the patch set: the amplitude weights are
// normalised to unit RMS and the exponent shift is centred on the subject's own
// exponent. Total head power and the subject's mean spectral slope are therefore
// unchanged - only their spatial distribution - which is what keeps the absolute
// amplitude bounds (10-100 uV, LEARNINGEEG §1) where they were. Exported so the
// A-P gradient checks in validateEngine guard the values the engine ships.
export const AP_AMPLITUDE_TILT = 4.0;
export const AP_EXPONENT_TILT = 0.20;

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
  private eyeOpening: EyeOpeningGenerator | null = null;
  private saccade: SaccadeGenerator | null = null;
  private emgL: EmgGenerator | null = null;
  private emgR: EmgGenerator | null = null;
  private emgF: EmgGenerator | null = null;
  private emgN: EmgGenerator | null = null;
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
  private ictalParams: IctalParamsMap = defaultIctalParamsMap();

  // One heart. It drives both the synthetic ECG display channel (full amplitude,
  // exposed via `ecgChannelValue` and read by the adapter) and the scalp cardiac
  // contamination injected at the `heart` source. These used to be two
  // independently seeded generators, so the QRS complexes leaking into the scalp
  // channels did not coincide with the R waves on the ECG trace — which is
  // exactly the check a reader is taught to make to confirm ECG artifact.
  private ecgChannel!: EcgGenerator;
  ecgChannelValue = 0;
  /** This sample's raw cardiac waveform, shared by the display channel and the scalp artifact. */
  private ecgRaw = 0;

  private chain: RecordingChain | null = null;
  private defects: ChannelDefect[] = [];
  private sampleIndex = 0;
  private patientState: PatientState = 'awake';
  private gates: ArtifactGates = {
    blink: true, eyeOpening: true, saccade: true, emg: true, pop: true,
    sweat: true, line: true, ecgScalp: true, movement: true,
  };

  // Contextual artifact settings. Empty by default and read with `??`, so an
  // engine nobody configures behaves exactly as it did before these existed.
  private aparams: Partial<ArtifactParams> = {};
  private lastAparams: Partial<ArtifactParams> | null = null;
  /** Electrode indices the user has detached, whether or not the flat has taken effect yet. */
  private detached = new Set<number>();
  /**
   * Electrode index -> samples remaining before its channel goes flat. Contact
   * failure is a pop *followed by* a dead channel; flattening on the same sample
   * would swallow the pop that announces it.
   */
  private detachDelay = new Map<number, number>();

  constructor(opts: EngineOptions = {}) {
    const {
      seed = 1,
      fs = 250,
      backgroundPatchCount = 16,
      artifacts = true,
      recordingChain = true,
      warmup = 0,
    } = opts;

    this.fs = fs;
    this.dt = 1 / fs;
    this.subject = { ...sampleSubject(seed), ...(opts.subject ?? {}) };
    const S = this.subject;

    // ---- source geometry ----
    const bgPatches = backgroundPatches(backgroundPatchCount);
    const rhythmSpecs: SourceSpec[] = [
      // The posterior dominant rhythm is maximal at the occiput and read off the
      // posterior links of an antero-posterior chain — P3-O1/P4-O2 and T5-O1/T6-O2
      // (IK-006). A bipolar link's amplitude tracks the *spatial gradient* of the
      // field across it, not the field's height, so getting the alpha onto those
      // links is a question of where the field is steepest. Anchoring the source
      // squarely under O1/O2 puts O and P at near-equal gain (the peak of a
      // Gaussian is flat), so P3-O1/P4-O2 nearly cancel and the steepest gradient —
      // and thus the visible alpha — lands one link forward at C3-P3/C4-P4, which
      // is the reported defect. The real medial-occipital (calcarine) generator
      // sits posterior-inferior to the O1/O2 scalp sites, toward the occipital
      // pole; anchoring it there (offset inferior in y) drops the scalp field
      // sharply between O and P, so the O-P links carry the dominant alpha and
      // T5-O1/T6-O2 stay strong, while C-P retains a smaller share — the clinical
      // topography. Extent is the plain smearing width; the inferior offset, not a
      // broadened patch, is what shapes the gradient.
      //
      // Widening this patch to lift the parietal amplitude was tried and reverted:
      // at 1.5x it took P4-O2 / C4-P4 alpha power from 1.77 to 0.53 (floor 1.2) —
      // i.e. it moved the PDR off the posterior link and onto C4-P4, the exact
      // defect IK-006 exists to prevent — and at the largest width that keeps that
      // ratio legal (1.25x with the offset deepened to -0.55) it raised
      // (P3+P4)/(C3+C4) by only 0.950 -> 0.974. Widening leaks alpha forward, and
      // "forward" is where it must not go. The parietal shortfall is a background
      // problem, addressed by AP_AMPLITUDE_TILT instead.
      sourceUnder('pdrL', ['O1'], { extent: S.smearing, offset: [0, -0.4, 0] }),
      sourceUnder('pdrR', ['O2'], { extent: S.smearing, offset: [0, -0.4, 0] }),
      // Radial (default orientation): a tangential field is zero at its own
      // anchor point by construction, which would put this always-on background
      // mu's peak off at F3/F4/Fz instead of C3/C4. The deliberately tangential,
      // toggleable arch-shaped mu variant lives separately in sources/variants.ts.
      sourceUnder('muL', ['C3'], { extent: S.smearing }),
      sourceUnder('muR', ['C4'], { extent: S.smearing }),
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
    // Background patches are independent processes, so neighbouring electrodes see
    // overlapping mixtures rather than identical or wholly unrelated noise. Their
    // amplitude and spectral slope are tilted along the antero-posterior axis to
    // produce the A-P gradient - see AP_AMPLITUDE_TILT / AP_EXPONENT_TILT above for
    // what that models and why it is mean-preserving.
    const apZ = bgPatches.map(sp => sp.pos[2] / CORTICAL_SHELL);  // +1 anterior .. -1 posterior
    const apZMean = apZ.reduce((a, b) => a + b, 0) / apZ.length;
    const apW = apZ.map(z => Math.pow(AP_AMPLITUDE_TILT, -z / 2));
    const apWNorm = Math.sqrt(apW.reduce((a, b) => a + b * b, 0) / apW.length);
    for (let i = 0; i < bgPatches.length; i++) {
      // Clamped below aperiodic.ts's BANK_MAX_EXPONENT so the tilt can never flip a
      // single patch onto the integrator path while its neighbours stay on the bank.
      const exponent = Math.min(S.exponent - AP_EXPONENT_TILT * (apZ[i] - apZMean), 1.85);
      this.neural.push({
        kind: 'aperiodic',
        band: 'background',
        src: new AperiodicSource(deriveSeed(seed, `bg${i}`), this.dt, {
          exponent,
          rms: S.backgroundRms * (apW[i] / apWNorm),
        }),
      });
    }
    const hemisphereOffset = 0.25;   // the two hemispheres are never identical
    this.neural.push({
      kind: 'hopf', band: 'alpha', baseRms: S.alphaRms,
      src: new HopfOscillator(deriveSeed(seed, 'pdrL'), this.dt, {
        freq: S.iaf, rms: S.alphaRms, freqWander: 0.55, damping: -2.6,
        envelopeDepth: PDR_ENVELOPE_DEPTH,
      }),
    });
    this.neural.push({
      kind: 'hopf', band: 'alpha', baseRms: S.alphaRms * 0.92,
      src: new HopfOscillator(deriveSeed(seed, 'pdrR'), this.dt, {
        freq: S.iaf + hemisphereOffset, rms: S.alphaRms * 0.92, freqWander: 0.55, damping: -2.6,
        envelopeDepth: PDR_ENVELOPE_DEPTH,
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
          ...BETA_BURST_OPTS, rms: S.betaRms,
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
      this.eyeOpening = new EyeOpeningGenerator(A.eyeOpening, this.dt, 5 * b);
      this.saccade = new SaccadeGenerator(A.saccade, this.dt, 25 * b);
      this.emgL = new EmgGenerator(A.emgL, this.dt);
      this.emgR = new EmgGenerator(A.emgR, this.dt);
      this.emgF = new EmgGenerator(A.emgF, this.dt);
      this.emgN = new EmgGenerator(A.emgN, this.dt);
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
    // The scalp cardiac artifact reads this same generator (see `ecgRaw`).
    this.ecgChannel = new EcgGenerator(deriveSeed(seed, 'ecgChannel'), this.dt);

    this.groundTruth = { t: 0, vigilance: 0.5, blinking: false, betaBursting: false, popChannel: -1 };

    // Warm-up. The recording chain's high-passes start cold (prevIn=prevOut=0) with
    // a 0.25 Hz corner (time constant ~0.64 s), so without this the first ~2 s of
    // output rides a decaying baseline transient — which exaggerates the recovery
    // overshoot of any early blink or slow artifact and is what makes the very
    // first blink look distorted. Running the whole pipeline for `warmup` seconds
    // and discarding it settles the filters (and leaves every source mid-stream, as
    // a real record already is when you start reading it) before the first visible
    // sample. The sample clock is rewound so display time still starts at zero; the
    // settled filter/oscillator/generator states are what carry forward.
    if (warmup > 0) {
      const scratch = new Float64Array(this.electrodes.length);
      const warmupSamples = Math.round(warmup * this.fs);
      for (let i = 0; i < warmupSamples; i++) this.next(scratch);
      this.sampleIndex = 0;
      this.groundTruth = { t: 0, vigilance: this.vigilance.value, blinking: false, betaBursting: false, popChannel: -1 };
    }
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
    const baseCtx = {
      t: tNow, dt: this.dt, state: this.patientState, vigilance: this.vigilance.value,
    };
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
      const ip = this.ictalParams[d.toggles[0]];
      const ctx: SampleContext = {
        ...baseCtx,
        enabled,
        ictalIntensity: ip?.intensity ?? 1,
        ictalFrequency: ip?.frequency ?? 1,
        ictalHemisphere: ip?.hemisphere ?? 'left',
      };
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

    // One cardiac cycle per sample, advanced before the artifact block so the
    // scalp contamination and the ECG display channel are the same heartbeat.
    this.ecgRaw = this.ecgChannel.next();

    let lineVal = 0;
    if (this.blink) {
      const ix = this.artifactIndex;
      const g = this.gates;
      const p = this.aparams;
      // Every generator advances unconditionally every sample — gating only
      // decides whether its output is added to V. That keeps each renewal
      // process's own statistics (rate, phase, decay) running underneath a
      // disabled toggle, so re-enabling it resumes rather than restarts.
      const blinkV = this.blink.next(gains.ocularRate) * 110;
      if (g.blink) { V[ix.eyeL] += blinkV; V[ix.eyeR] += blinkV; }
      // Eye opening rides the same ocular sources as the blink but at half the
      // amplitude and opposite sign on opening (see EyeOpeningGenerator): opening
      // drives Fp negative -> upward, closing a smaller downward transient.
      const openV = this.eyeOpening!.next() * 55;
      if (g.eyeOpening) { V[ix.eyeL] += openV; V[ix.eyeR] += openV; }
      const saccadeV = this.saccade!.next(gains.ocularRate) * 45;
      if (g.saccade) V[ix.gaze] += saccadeV;
      // Which muscles are tense is a separate question from how hard they are
      // contracting, so region selection and severity are separate controls.
      const emgSev = p.emgSeverity ?? 1;
      const regions = p.emgRegions;
      const on = (r: EmgRegion) => regions == null || regions.includes(r);
      const emgLV = this.emgL!.next(gains.emg) * 9 * gains.emg * emgSev;
      const emgRV = this.emgR!.next(gains.emg) * 9 * gains.emg * emgSev;
      const emgFV = this.emgF!.next(gains.emg) * 6 * gains.emg * emgSev;
      const emgNV = this.emgN!.next(gains.emg) * 8 * gains.emg * emgSev;
      if (g.emg) {
        if (on('temporalisL')) V[ix.temporalisL] += emgLV;
        if (on('temporalisR')) V[ix.temporalisR] += emgRV;
        if (on('frontalis'))   V[ix.frontalis]   += emgFV;
        if (on('nuchal'))      V[ix.nuchal]      += emgNV;
      }
      const heartV = this.ecgRaw * 9;
      if (g.ecgScalp) V[ix.heart] += heartV;
      const sweatV = this.sweat!.next() * 7 * (p.sweatSeverity ?? 1);
      if (g.sweat) V[ix.sweatFrontal] += sweatV;
      const mv = this.movement!.next() * 60 * (p.movementSeverity ?? 1);
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

    // A detached electrode does not go dead the instant the pop starts: the pop
    // IS the contact failing, and it rings for a few hundred milliseconds
    // afterwards. Only once it has decayed does the channel fall to the noise
    // floor, which is what `ChannelDefect.flat` models.
    if (this.detachDelay.size > 0 && this.chain) {
      for (const [c, left] of this.detachDelay) {
        if (left <= 1) {
          this.chain.setDefect(c, { kind: 'flat' });
          this.detachDelay.delete(c);
        } else {
          this.detachDelay.set(c, left - 1);
        }
      }
    }

    if (this.chain) this.chain.process(out, lineVal, this.aparams.lineAmpUv ?? this.subject.lineAmp);

    // Synthetic ECG display channel: same waveform as the scalp contamination
    // above, at the amplitude a real ECG lead records rather than the fraction
    // that reaches the scalp.
    this.ecgChannelValue = this.ecgRaw * 500;

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

  /**
   * Set the ictal severity multiplier, discharge-frequency multiplier and
   * focal-seizure hemisphere, independently
   * per ictal toggle id. Cheap by design, same as the setters above: values are
   * only read at the top of `next()`, so any can change mid-recording without
   * resetting a seizure's epoch clock.
   */
  setIctalParams(params: Partial<Record<string, Partial<IctalParams>>>) {
    for (const key of Object.keys(params)) {
      const p = params[key]!;
      const cur = this.ictalParams[key] ?? { intensity: 1, frequency: 1, hemisphere: 'left' as IctalHemisphere };
      this.ictalParams[key] = {
        intensity: p.intensity ?? cur.intensity,
        frequency: p.frequency ?? cur.frequency,
        hemisphere: p.hemisphere ?? cur.hemisphere,
      };
    }
  }

  /**
   * Set the contextual artifact settings (rates, severities, which muscles are
   * contracting, which electrode pops, which electrodes have come off).
   *
   * Called every sample by the adapter with the UI's params object, so it
   * short-circuits on an unchanged reference: the fields that need a generator
   * touched — rates, mains frequency, heart rate, detachment — must not be
   * re-applied 250 times a second. Anything omitted is left as the generator was
   * constructed, which is why a caller that never calls this (validateEngine)
   * sees the engine's original behaviour.
   */
  setArtifactParams(params: Partial<ArtifactParams>) {
    if (params === this.lastAparams) return;
    this.lastAparams = params;
    Object.assign(this.aparams, params);
    const p = this.aparams;

    if (p.blinkRatePerMin != null) this.blink?.setRatePerMin(p.blinkRatePerMin);
    if (p.saccadeRatePerMin != null) this.saccade?.setRatePerMin(p.saccadeRatePerMin);
    if (p.popRatePerMin != null) this.pop?.setMeanInterval(60 / Math.max(p.popRatePerMin, 0.05));
    if (p.movementRatePerMin != null) this.movement?.setMeanInterval(60 / Math.max(p.movementRatePerMin, 0.05));
    if (p.lineFreq != null) this.line?.setFreq(p.lineFreq);
    if (p.ecgBpm != null) this.ecgChannel.setBpm(p.ecgBpm);
    if (p.popTarget != null) {
      this.pop?.setTarget(p.popTarget === POP_TARGET_ANY ? -1 : this.indexOf(p.popTarget));
    }

    // Detachment is declarative: this list is the set of electrodes currently
    // off. Entering the list breaks contact (pop, then flat); leaving it is the
    // technologist re-gelling the electrode, which restores whatever contact
    // quality this subject's electrode had to begin with.
    if (p.detachedElectrodes != null) {
      const want = new Set<number>();
      for (const name of p.detachedElectrodes) {
        const c = this.indexOf(name);
        if (c >= 0) want.add(c);
      }
      for (const c of want) {
        if (this.detached.has(c)) continue;
        this.pop?.trigger(c);
        this.detachDelay.set(c, Math.max(1, Math.round(0.8 / this.dt)));
      }
      for (const c of this.detached) {
        if (want.has(c)) continue;
        this.detachDelay.delete(c);
        this.chain?.setDefect(c, this.defects[c] ?? { kind: 'ok' });
      }
      this.detached = want;
    }
  }

  /** Index of a named electrode, or -1. */
  indexOf(name: string): number {
    return this.electrodes.indexOf(name);
  }
}

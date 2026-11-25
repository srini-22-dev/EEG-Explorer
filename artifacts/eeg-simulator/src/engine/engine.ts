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
import { HopfOscillator, MU_WARP, SLOW_WAVE_WARP } from './oscillator';
import { BurstyOscillator } from './bursts';
import { VigilanceState } from './state';
import {
  buildLeadfield, sourceUnder, synchronousPatches, backgroundPatches, CORTICAL_SHELL,
  type SourceSpec, type Leadfield,
} from './forward';
import { ARTIFACT_SOURCES, EcgGenerator } from './artifacts';
import { RespirationGenerator } from './breathing';
import { ArtifactLayer, type ArtifactGates, type LiveArtifacts } from './artifactLayer';
import { MarkBook, NO_FIELDS, type ArtifactMark, type MarkFields } from './marks';
import { sampleSubject, type SubjectParams } from './subject';
import {
  STATE_GAINS, BETA_FRONTAL_GAIN, BETA_BURST_OPTS, PDR_ENVELOPE_DEPTH, EYES_OPEN_ALPHA_GAIN,
  BREACH_GAIN_LOW, BREACH_GAIN_HIGH, BREACH_CORNER_HZ, ALPHA_BLOCK_TAU_S, ALPHA_RETURN_TAU_S,
  ALPHA_REBOUND_GAIN, ALPHA_REBOUND_PEAK_S, ALPHA_SQUEAK_HZ, ALPHA_SQUEAK_TAU_S,
  AP_AMPLITUDE_TILT, AP_EXPONENT_TILT, SLEEP_SITES, SLEEP_PATCH, SLOW_WAVE_FIELD,
  SLEEP_THETA_RMS, SLOW_WAVE_SYNC_RMS, SLOW_WAVE_LOCAL_RMS, SLOW_WAVE_LOCAL_TILT, SLOW_WAVE_LOWPASS_HZ,
  MU_MAX_RMS, STATE_VIGILANCE,
} from './tuning';
import { RecordingChain, sampleDefects, mainsManyRegion, MAINS_MANY_WEIGHT, MAINS_MANY_GAIN, type ChannelDefect } from './chain';
import type { ConditionLevel, FilterSettings } from '../utils/simTypes';
import { Gaussian, deriveSeed } from './rng';
import {
  PATTERN_SOURCES,
  type PatternGenerator, type PatternSourceDescriptor, type SampleContext, type Band,
  type PatternMarkEvent, type MarkWhere,
} from './sources/registry';
import { MU_FIELD } from './sources/fields';
import type {
  PatientState, IctalHemisphere, IctalParams, IctalParamsMap,
  ArtifactParams, PatternOptions, PostsForm, FocalPlacement, KcSpindle, SixHzForm, BreachSite, Pos146Sides,
} from '../utils/simTypes';
import { defaultIctalParamsMap, POSTS_SMALLER_DEFAULT, POSTS_ONE_SIDE_DEFAULT } from '../utils/simTypes';

// The engine's public surface, wherever its parts now live.
export { sampleSubject, type SubjectParams } from './subject';
export type { ArtifactMark } from './marks';
export type { LiveArtifacts } from './artifactLayer';
export { BLINK_DRIVE_UV, type ArtifactGates } from './artifactLayer';
export * from './tuning';

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
  /** Alpha-blocking level from eye opening, 0 closed .. 1 open (IK-007). */
  eyesOpen: number;
  /**
   * Artifacts that START on this sample, for the display's annotation arrows.
   * Empty unless `setArtifactMarks(true)` was called, and cleared every sample,
   * so a consumer copies what it wants to keep.
   */
  marks: ArtifactMark[];
  /** What the artifacts are doing now, for the controls (LiveArtifacts); the layer's own object, updated in place. */
  live: LiveArtifacts;
};

export type { PatientState };

type NeuralSource =
  | { kind: 'aperiodic'; src: AperiodicSource; band: 'background' }
  | { kind: 'hopf'; src: HopfOscillator; band: Band; baseRms: number }
  | { kind: 'burst'; src: BurstyOscillator; band: Band; baseRms: number };

/** Background mu's cortical field, per side (see the muL/muR sources in the constructor). */
export { MU_FIELD };
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

  /** Blinks, gaze, muscle, heart, sweat, movement, mains, pops and bad contacts (artifactLayer.ts). */
  private artifactLayer: ArtifactLayer;
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
  // 0 = eyes closed, 1 = eyes open, smoothed with ALPHA_BLOCK_TAU_S / ALPHA_RETURN_TAU_S.
  // Reported per sample as groundTruth.eyesOpen.
  private alphaBlock = 0;
  // Post-closure rebound and squeak: time since the eyes last closed, and how deeply
  // the PDR was blocked at that moment.
  private wasEyesOpen = false;
  private sinceClose = Infinity;
  private blockAtClose = 0;
  // Which toggle opened the eyes, so the rebound after they close is marked under it.
  private openedBy = 'eye-opening';
  // The posterior rhythm's rows, for the box over its rebound (built with the leadfield).
  private pdrField: MarkFields = [];

  // One heart. It drives both the synthetic ECG display channel (full amplitude,
  // exposed via `ecgChannelValue` and read by the adapter) and the scalp cardiac
  // contamination injected at the `heart` source. These used to be two
  // independently seeded generators, so the QRS complexes leaking into the scalp
  // channels did not coincide with the R waves on the ECG trace — which is
  // exactly the check a reader is taught to make to confirm ECG artifact.
  private ecgChannel!: EcgGenerator;
  ecgChannelValue = 0;
  // The breathing, as a respiration belt records it: the Resp row's trace (IK-049).
  // Like the heart, a recorded channel, so it exists with artifacts off.
  private resp!: RespirationGenerator;
  respChannelValue = 0;
  /** This sample's raw cardiac waveform, shared by the display channel and the scalp artifact. */
  private ecgRaw = 0;

  private chain: RecordingChain | null = null;
  private defects: ChannelDefect[] = [];
  private sampleIndex = 0;
  private patientState: PatientState = 'awake';
  // Annotation arrows (see ArtifactMark). Off unless the display asks for them: the
  // gate and the renderers run this same engine and should not pay for bookkeeping
  // they never read.
  private marksOn = false;
  private marks: MarkBook;
  // One unit field per electrode, for a mark on a single channel (a pop, the breach).
  private electrodeFields: MarkFields[] = [];
  // The fields a source's own marks use (`PatternMarkEvent.where`), built when first needed.
  private sourceField: (MarkFields | undefined)[] = [];
  private toggleField = new Map<string, MarkFields>();
  // For each source with an `openBox`: the key of its box while it is open.
  private openKey: (string | null)[] = [];
  // See setStateDrivesIntrinsic.
  private stateDrivesIntrinsic = true;
  // See setBackgroundMu.
  private backgroundMu = true;
  private postsForm: PostsForm = 'singles';
  private postsSmallerPct = POSTS_SMALLER_DEFAULT;
  private postsOneSidePct = POSTS_ONE_SIDE_DEFAULT;
  private focalPlacement: FocalPlacement = 'under';
  private seizureMuscle = false;
  private kcSpindle: KcSpindle = 'sometimes';
  private sixHzForm: SixHzForm = 'fold';
  private pos146Sides: Pos146Sides = 'shifting';
  // The electrodes over skull defects, and the breach rhythm's high-pass state at
  // each (see BREACH_*). Several defects are independent: each electrode has its own.
  private breachIdx: number[] = [];
  private breachKey = '';
  private breachOn = false;
  private breachHp: number[] = [];
  private breachPrev: number[] = [];
  private breachFields: MarkFields = [];
  private breachA = 0;
  // Leadfield columns of sources outside the skull: the artifact block and the
  // extracranial pattern sources (PatternSourceDescriptor.extracranial).
  private extracranialIdx: number[] = [];
  private ictalDelay: number | null = null;

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
      // links is a question of where the field is steepest, but the PRIMARY
      // constraint is the referential topography, because that is the physical
      // fact; what the bipolar links then show follows from it by subtraction.
      //
      // The alpha field is broad and posterior: O maximal, parietal high, and
      // posterior temporal comparable to parietal. The previous version of this
      // source violated that badly — measured referentially, T5 carried 3.5x the
      // alpha of P3 (T5 69% of O1, P3 only 20%). P3 sits over parieto-occipital
      // cortex and must not be starved relative to posterior temporal. The cause
      // was a -0.4 inferior offset (3.8 cm below O1, which is off the cortex
      // altogether) combined with the narrowest extent of any neural source here
      // — mu and beta get 1.25x, the sleep rhythms 2.0-2.2x, and the PDR, the
      // broadest normal rhythm of them all, was on 1.0x.
      //
      // That geometry existed to satisfy a check asserting P4-O2 / C4-P4 alpha
      // power >= 1.2, derived in turn from IK-006's clause that the PDR is "read
      // off the posterior links". Two problems with that. First, the reference
      // course does not make the claim: it says only that the PDR is the resting
      // occipital rhythm and that "slower, higher amplitude frequencies are found
      // in the back". Second, it is arithmetically self-defeating — a bipolar
      // link measures the field GRADIENT, so a realistic topography (O 100%,
      // P 75%, C 40%) gives C-P = 35 against P-O = 25, i.e. the parietal link
      // legitimately carries MORE alpha than the posterior one. Forcing the
      // opposite is only possible by making P artificially low, which is exactly
      // the defect above.
      //
      // A prior note here recorded that widening "was tried and reverted" because
      // it took that ratio to 0.53. That measurement was made under the OLD
      // electrode placement, where P3 sat 4.13 cm from O1 and 8.38 from C3; the
      // parasagittal chain has since been rebuilt to the 10-20 standard's own
      // parasagittal measurement (build1020.ts) and the reasoning no longer holds.
      //
      // 1.5x with a -0.1 offset (~1 cm, a defensible displacement toward the
      // occipital pole) gives P3 62% of O1 and P3/T5 = 0.87, and both posterior
      // links carry clear, comparable alpha — the smooth antero-posterior
      // gradient the reference illustrates, rather than all the alpha appearing
      // abruptly on the last link.
      sourceUnder('pdrL', ['O1'], { extent: S.smearing * 1.5, offset: [0, -0.1, 0] }),
      sourceUnder('pdrR', ['O2'], { extent: S.smearing * 1.5, offset: [0, -0.1, 0] }),
      // Radial (default orientation): a tangential field is zero at its own
      // anchor point by construction, which would put this always-on background
      // mu's peak off at F3/F4/Fz instead of C3/C4. The deliberately tangential,
      // toggleable arch-shaped mu variant lives separately in sources/variants.ts.
      // Sensorimotor cortex is a strip, not a point: pre- and postcentral gyri
      // run from the foot area at the vertex (under Cz) laterally down to the
      // face area at the sylvian fissure (near T3/T4), ~7-8 cm of cortex. A
      // point patch under C3 models that strip as a spike, which renders mu and
      // beta as isolated C3/C4 hotspots with nothing at Cz — measured C3 beta
      // 4.6 uV against Cz 1.96, and a 5x step between adjacent rows of one
      // chain (Fp1-F3 0.91 -> F3-C3 4.69).
      //
      // 1.25x -> sigma ~3.3 cm, FWHM ~7.8 cm of scalp at the median subject.
      // An earlier version of this comment claimed that at half maximum the
      // field "spans roughly Cz to T3, which is the strip"; measuring the built
      // leadfield says otherwise, and the measurement wins. With the electrodes
      // ~6 cm apart, NO neighbour reaches half of the C3 peak — F3 picks up
      // 0.24, P3 0.19, Cz 0.15, T3 0.11. So this reads as a central maximum
      // with a shoulder onto its neighbours, not a strip.
      //
      // That focality is correct rather than a defect: mu is a focal central
      // rhythm, so wherever it is present the parasagittal chain SHOULD phase-
      // reverse at C3/C4, and that reversal is how a reader recognises it
      // (IK-003). What was wrong was running it in every subject — see
      // `sampleSubject`'s muFraction, which makes it the benign variant it is.
      //
      // mu and beta share one multiplier because they arise from the same
      // cortex; anatomy does not discriminate between 1.25 and 1.35 here, so
      // this takes the conservative end rather than the end that happens to
      // suit any one check. C3/C4 stay the maxima (IK-006 C3/F3 floor: 12.4).
      //
      // MU'S FIELD, revised 2026-09-14 (the above describes the single patch it
      // replaced). A patch under C3 alone made F3-C3 and C3-P3 equal (1.03) and left
      // Fz-Cz nearly empty (0.09 of F3-C3): a symmetric reversal exactly at C3. On
      // learningeeg's mu figure ("Mu Rhythm III", traced over its whole marked run)
      // the anterior link dominates — C3-P3 0.66 of F3-C3, C4-P4 0.76 of F4-C4 — and
      // Fz-Cz carries 0.61, the course's "centroparietal ... along the parasagittal
      // chains". Sensorimotor cortex is a strip reaching the vertex, so each side is now
      // a co-active group: C3 (C4) with P3 (P4) at 0.3 and Cz at 0.35, at the sleep
      // sources' scalp depth. On the bipolar rows that gives C3-P3/F3-C3 0.71 and
      // Fz-Cz/F3-C3 0.61, and the reversal at C3/C4 stays — asymmetric now, as on the
      // reference. Beta keeps its single patch; nothing here measured beta's field.
      synchronousPatches('muL', MU_FIELD.left, { extent: 0.3 }),
      synchronousPatches('muR', MU_FIELD.right, { extent: 0.3 }),
      sourceUnder('betaL', ['C3'], { extent: S.smearing * 1.6 }),
      sourceUnder('betaR', ['C4'], { extent: S.smearing * 1.6 }),
      // Anchored Fz/F3/F4. A frontopolar-weighted anchor
      // ('Fz','Fz','Fz','F3','F4','Fp1','Fp2') was tried on 2026-09-01 to carry the
      // frequency half of the antero-posterior gradient (IK-030) and is REVERTED:
      // it took the spectral centroid to 1.204 and passed every numeric check,
      // including the beta crest factor at 7.94 against a 9 ceiling — and it looked
      // wrong on the page. Concentrating beta into a frontal-midline focus made its
      // bursts stand proud of the background as discrete high-amplitude packets on
      // Fz-Cz and Cz-Pz, which is the very thing IK-014 says awake beta must not do
      // ("no individual burst towers over the background enough to read as a
      // discrete sharp transient"). The crest-factor check measures one seed-averaged
      // number and did not catch it; a reader looking at the trace did immediately.
      // CLAUDE.md §4 — display space is authoritative, not the scalar.
      sourceUnder('betaF', ['Fz', 'F3', 'F4'], { extent: S.smearing * 1.4 }),
      // Sleep rhythms: distributed theta, then synchronized + local slow waves.
      // See SLEEP_SITES for what these replaced and why.
      ...SLEEP_SITES.map(site => sourceUnder(`theta-${site}`, [site], SLEEP_PATCH)),
      synchronousPatches('deltaSync', SLOW_WAVE_FIELD, { extent: SLEEP_PATCH.extent }),
      ...SLEEP_SITES.map(site => sourceUnder(`delta-${site}`, [site], SLEEP_PATCH)),
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
    this.extracranialIdx = [
      ...artifactSpecs.map((_, i) => bgPatches.length + rhythmSpecs.length + i),
      ...PATTERN_SOURCES.flatMap((d, i) => (d.extracranial ? [patternBase + i] : [])),
    ];
    const breachRc = 1 / (2 * Math.PI * BREACH_CORNER_HZ);
    this.breachA = breachRc / (breachRc + this.dt);
    this.patternGens = PATTERN_SOURCES.map(d => d.make(deriveSeed(seed, d.id), this.dt, seed));

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
    // Per-side mu amplitude. `muFraction` is the per-side strength as a fraction
    // of alphaRms at symmetric laterality, and is zero in most subjects; the
    // `2 * share` split reproduces the previous fixed 0.45x per side when
    // muLaterality is 0.5. Both sources are pushed even at zero amplitude:
    // `this.neural` is index-aligned with the leadfield source list built above,
    // so skipping one would misalign every source after it.
    for (const [id, share] of [['muL', S.muLaterality], ['muR', 1 - S.muLaterality]] as [string, number][]) {
      const muRms = Math.min(S.alphaRms * S.muFraction * 2 * share, MU_MAX_RMS);
      this.neural.push({
        kind: 'hopf', band: 'mu', baseRms: muRms,
        src: new HopfOscillator(deriveSeed(seed, id), this.dt, {
          freq: S.iaf + 0.4, rms: muRms, freqWander: 0.4, damping: -3.2, warp: MU_WARP,
        }),
      });
    }
    // Beta is frontally predominant in the normal awake adult — it is the "faster,
    // lower amplitude frequencies towards the front" half of the antero-posterior
    // gradient. All three beta sources previously carried the SAME amplitude, which
    // left the frontal ones no stronger than the central pair and gave the
    // frontopolar electrodes almost no fast activity of their own: the 2-30 Hz
    // spectral centroid at Fp1/Fp2 sat at 1.066x the occipital one against a 1.1
    // floor. The per-patch aperiodic exponent tilt cannot supply that gradient on
    // its own (raising AP_EXPONENT_TILT 0.20 -> 0.35 and its clamp 1.85 -> 2.0
    // moved the ratio by -0.006, because every electrode averages all sixteen
    // background patches and per-patch differences wash out), so the frequency
    // gradient has to come from where the fast rhythms actually are.
    for (const id of ['betaL', 'betaR', 'betaF']) {
      this.neural.push({
        kind: 'burst', band: 'beta', baseRms: S.betaRms * (id === 'betaF' ? BETA_FRONTAL_GAIN : 1),
        src: new BurstyOscillator(deriveSeed(seed, id), this.dt, {
          ...BETA_BURST_OPTS, rms: S.betaRms * (id === 'betaF' ? BETA_FRONTAL_GAIN : 1),
        }),
      });
    }
    // Index-aligned with the rhythmSpecs above: theta patches, deltaSync, delta patches.
    // Each patch draws its own centre frequency, so the theta is polymorphic across
    // the head and the local slow waves drift in and out of step with each other.
    const sleepFreqs = new Gaussian(deriveSeed(seed, 'sleepPatchFreqs'));
    for (const site of SLEEP_SITES) {
      this.neural.push({
        kind: 'hopf', band: 'theta', baseRms: SLEEP_THETA_RMS,
        src: new HopfOscillator(deriveSeed(seed, `theta-${site}`), this.dt, {
          freq: sleepFreqs.range(4.5, 6.5), rms: SLEEP_THETA_RMS, freqWander: 0.7, damping: -2.2,
        }),
      });
    }
    this.neural.push({
      kind: 'hopf', band: 'delta', baseRms: SLOW_WAVE_SYNC_RMS,
      src: new HopfOscillator(deriveSeed(seed, 'deltaSync'), this.dt, {
        freq: 0.85, rms: SLOW_WAVE_SYNC_RMS, freqWander: 0.25, damping: -0.9, warp: SLOW_WAVE_WARP,
        outputLowPassHz: SLOW_WAVE_LOWPASS_HZ,
      }),
    });
    // Local slow waves are frontally weighted too, more gently than the synchronized field
    // (its weights to the power SLOW_WAVE_LOCAL_TILT, normalised so the mean power over sites
    // is unchanged): slow waves arise frontally more often than posteriorly (Massimini et al.
    // 2004, J Neurosci 24:6862), and with equal local patches the frontal predominance AASM
    // scores from was diluted to F3/O1 ~1.16 on the gate's subjects. The DIRECTION is sourced;
    // the size is not — no source found gives a frontal/occipital slow-wave ratio — so the tilt
    // is a modelling choice: 0.3 gives F3-A1/O1-A1 delta ~1.7 while leaving T5-O1 ~0.75 of
    // Fp1-F7, i.e. clearly frontal without emptying the posterior chains learningeeg's
    // slow-wave figure shows full of delta. (Measured 4 subjects x 60 s: tilt 0 -> ~1.4 / 0.8,
    // 0.5 -> 1.9 / 0.66.)
    const localW = SLEEP_SITES.map(site => Math.pow(SLOW_WAVE_FIELD[site], SLOW_WAVE_LOCAL_TILT));
    const localNorm = Math.sqrt(localW.reduce((a, w) => a + w * w, 0) / localW.length);
    SLEEP_SITES.forEach((site, i) => {
      const rms = SLOW_WAVE_LOCAL_RMS * localW[i] / localNorm;
      this.neural.push({
        kind: 'hopf', band: 'delta', baseRms: rms,
        src: new HopfOscillator(deriveSeed(seed, `delta-${site}`), this.dt, {
          freq: sleepFreqs.range(0.8, 1.6), rms, freqWander: 0.3, damping: -1.0,
          warp: SLOW_WAVE_WARP, outputLowPassHz: SLOW_WAVE_LOWPASS_HZ,
        }),
      });
    });

    this.nNeural = this.neural.length;
    this.srcValues = new Float64Array(allSpecs.length);
    this.vigilance = new VigilanceState(seed, this.dt, S.vigilanceBias);

    if (recordingChain) {
      this.defects = sampleDefects(seed, this.electrodes.length, S.artifactBurden);
      this.chain = new RecordingChain(seed, this.dt, this.electrodes.length, this.defects);
      // The poor contacts the mains shows on (chain.ts MAINS_CONTACT_COUPLING and
      // MAINS_MANY_WEIGHT): one scalp electrode, or many graded front to back; never an
      // ear reference. Each from its own stream, so no other draw moves.
      const scalp = this.electrodes.flatMap((e, c) => (/^A[12]$/.test(e) ? [] : [c]));
      const gContact = new Gaussian(deriveSeed(seed, 'mainsContact'));
      const contact = scalp[Math.floor(gContact.uniform() * scalp.length)];
      const gMany = new Gaussian(deriveSeed(seed, 'mainsContactsMany'));
      const manyExtra = this.electrodes.map(e => {
        const region = mainsManyRegion(e);
        return region == null ? 0 : MAINS_MANY_GAIN * MAINS_MANY_WEIGHT[region] * gMany.range(0.6, 1.4);
      });
      this.chain.setMainsContacts(contact, manyExtra);
    }

    // One unit field per electrode: a mark on a single channel (a pop, the breach).
    const perElectrode = (at: (c: number) => number): Record<string, number> =>
      Object.fromEntries(this.electrodes.map((e, c) => [e, at(c)]));
    this.electrodeFields = this.electrodes.map((_, c) => [perElectrode(k => (k === c ? 1 : 0))]);
    this.setBreachSites(['C4']);
    this.pdrField = ['pdrL', 'pdrR'].map(id => this.fieldOf([[allSpecs.findIndex(sp => sp.id === id), 1]]));

    // Independent of the `artifacts` flag: the ECG display channel is a first-class
    // recorded trace, not an artifact, so it exists even when scalp artifacts are off.
    // The scalp cardiac artifact reads this same generator (see `ecgRaw`).
    this.ecgChannel = new EcgGenerator(deriveSeed(seed, 'ecgChannel'), this.dt);
    this.resp = new RespirationGenerator(deriveSeed(seed, 'respiration'), this.dt);

    this.marks = new MarkBook(this.dt, () => this.sampleIndex, mk => this.groundTruth.marks.push(mk));
    this.artifactLayer = new ArtifactLayer({
      seed, dt: this.dt, subject: S, electrodes: this.electrodes, artifactIndex: this.artifactIndex,
      artifacts, chain: this.chain, defects: this.defects, ecg: this.ecgChannel, resp: this.resp,
      fieldOf: sources => this.fieldOf(sources), electrodeFields: this.electrodeFields, marks: this.marks,
    });

    this.groundTruth = { t: 0, vigilance: 0.5, blinking: false, betaBursting: false, popChannel: -1, eyesOpen: 0, marks: [], live: this.artifactLayer.live };

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
      // Artifact gates OFF for the warm-up: it exists to settle filters, not to fire
      // artifacts the user never asked for. With the default all-on gates an
      // eye-opening maneuver could start here and carry into the record — and, once
      // eye opening blocked the PDR (IK-007), every record began with ~0.3 s of
      // attenuated alpha even with every toggle off. A generator enabled after
      // warm-up schedules its first event promptly (OCULAR_FIRST_EVENT_LEAD_SEC).
      const savedGates = this.artifactLayer.gates;
      this.artifactLayer.gates = Object.fromEntries(Object.keys(savedGates).map(k => [k, false])) as unknown as ArtifactGates;
      const scratch = new Float64Array(this.electrodes.length);
      const warmupSamples = Math.round(warmup * this.fs);
      for (let i = 0; i < warmupSamples; i++) this.next(scratch);
      this.artifactLayer.gates = savedGates;
      this.sampleIndex = 0;
      this.groundTruth = { t: 0, vigilance: this.vigilance.value, blinking: false, betaBursting: false, popChannel: -1, eyesOpen: this.alphaBlock, marks: [], live: this.artifactLayer.live };
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
      postsForm: this.postsForm, focalPlacement: this.focalPlacement, ictalDelay: this.ictalDelay,
      seizureMuscle: this.seizureMuscle, kcSpindle: this.kcSpindle, sixHzForm: this.sixHzForm,
      pos146Sides: this.pos146Sides,
      postsSmallerPct: this.postsSmallerPct, postsOneSidePct: this.postsOneSidePct,
    };
    const marking = this.marksOn;
    if (marking) this.groundTruth.marks.length = 0;
    let neuralGate = 1;
    // Per-band multipliers on the ongoing background, for patterns that reshape the
    // spectrum (gen-slowing abolishing the alpha PDR). 1 = untouched; band gates
    // from multiple active patterns compose multiplicatively.
    const bandGate: Record<Band, number> = {
      background: 1, alpha: 1, mu: this.backgroundMu ? 1 : 0, theta: 1, delta: 1, beta: 1,
    };
    for (let i = 0; i < this.patternGens.length; i++) {
      const d = this.patternDescriptors[i];
      const toggleOn = d.toggles.some(tg => this.activePatterns.has(tg));
      const stateInList = d.states != null && d.states.includes(this.patientState);
      // See PatternSourceDescriptor.stateIntrinsic for the two gating modes.
      const enabled = d.stateIntrinsic
        ? toggleOn || (stateInList && this.stateDrivesIntrinsic)
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
      const value = gen.next(ctx);
      V[this.patternIndex[i]] = value;
      if (enabled && gen.gate) neuralGate *= gen.gate(ctx);
      if (enabled && gen.bandGate) {
        const bg = gen.bandGate(ctx);
        for (const b in bg) bandGate[b as Band] *= bg[b as Band]!;
      }
      // What the generator says it has just begun to draw (taken after `gate`, which
      // is where burst-suppression keeps its cycle), and the box of a pattern that
      // is simply on.
      if (gen.takeMarks) {
        const ms = gen.takeMarks();
        if (marking) for (const pm of ms) this.groundTruth.marks.push(this.patternMarkOf(i, pm));
      }
      if (d.openBox) this.markOpen(i, enabled && marking);
    }

    // Eyes open -> the PDR blocks (IK-007). Mu is a separate band and untouched.
    const eyesOpen = this.activePatterns.has('eyes-open') || this.artifactLayer.manoeuvreEyesOpen;
    const tau = eyesOpen ? ALPHA_BLOCK_TAU_S : ALPHA_RETURN_TAU_S;
    if (this.wasEyesOpen && !eyesOpen) {
      this.sinceClose = 0; this.blockAtClose = this.alphaBlock;
      // The rebound is part of what the eyes did, so it is boxed: from closure until
      // its gain is down to ~0.2 of its peak (2.4 x ALPHA_REBOUND_PEAK_S, above), on the
      // posterior rhythm's rows, under the toggle that had the eyes open. Unmarked, it
      // was the one thing eye opening drew that nothing pointed at (2026-10-23).
      if (marking && this.blockAtClose > 0.3) {
        this.groundTruth.marks.push({ id: this.openedBy, label: 'Alpha rebound', fields: this.pdrField, dur: 0, span: 2.4 * ALPHA_REBOUND_PEAK_S });
      }
    }
    if (!this.wasEyesOpen && eyesOpen) this.openedBy = this.activePatterns.has('eyes-open') ? 'eyes-open' : 'eye-opening';
    this.wasEyesOpen = eyesOpen;
    this.alphaBlock += ((eyesOpen ? 1 : 0) - this.alphaBlock) * (this.dt / (tau + this.dt));
    bandGate.alpha *= 1 - (1 - EYES_OPEN_ALPHA_GAIN) * this.alphaBlock;
    // After closure: the PDR overshoots and briefly quickens (constants above).
    let squeakHz = 0;
    if (!eyesOpen && this.sinceClose < 6 * ALPHA_REBOUND_PEAK_S) {
      const u = this.sinceClose / ALPHA_REBOUND_PEAK_S;
      bandGate.alpha *= 1 + ALPHA_REBOUND_GAIN * this.blockAtClose * u * u * u * Math.exp(3 * (1 - u));
      squeakHz = ALPHA_SQUEAK_HZ * this.blockAtClose * Math.exp(-this.sinceClose / ALPHA_SQUEAK_TAU_S);
      this.sinceClose += this.dt;
    }

    const sg = STATE_GAINS[this.patientState];
    let betaBursting = false;
    for (let i = 0; i < this.nNeural; i++) {
      const n = this.neural[i];
      if (n.kind === 'hopf' && n.band === 'alpha') (n.src as HopfOscillator).freqOffset = squeakHz;
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
    this.resp.next(this.patientState);

    const lineVal = this.artifactLayer.addSources(V, gains, this.patientState, this.ecgRaw, marking);

    // project sources to electrodes
    const nS = this.leadfield.nSources;
    const G = this.leadfield.gain;
    for (let e = 0; e < out.length; e++) {
      let acc = 0;
      const row = e * nS;
      for (let s = 0; s < nS; s++) acc += G[row + s] * V[s];
      out[e] = acc;
    }

    // Breach rhythm: the intracranial part of the potential at the electrode over the
    // skull defect, amplified more the faster it is (constants and sources at BREACH_*).
    const breachOn = this.activePatterns.has('breach');
    if (breachOn !== this.breachOn) {
      this.breachOn = breachOn;
      this.breachHp = this.breachIdx.map(() => 0);
      this.breachPrev = this.breachIdx.map(() => NaN);
    }
    if (breachOn) {
      for (let k = 0; k < this.breachIdx.length; k++) {
        const bc = this.breachIdx[k];
        let extra = 0;
        const row = bc * nS;
        for (const s of this.extracranialIdx) extra += G[row + s] * V[s];
        const x = out[bc] - extra;
        // A fresh start takes the current level as its own, so switching on is not a step.
        if (Number.isNaN(this.breachPrev[k])) this.breachPrev[k] = x;
        this.breachHp[k] = this.breachA * (this.breachHp[k] + x - this.breachPrev[k]);
        this.breachPrev[k] = x;
        out[bc] += (BREACH_GAIN_LOW - 1) * x + (BREACH_GAIN_HIGH - BREACH_GAIN_LOW) * this.breachHp[k];
      }
    }
    if (marking) this.marks.markWhile('breach', breachOn && this.breachIdx.length > 0, breachOn ? this.breachFields : NO_FIELDS);

    // A pop is on one channel, past the leadfield; a detached contact goes flat once
    // its pop has rung out (artifactLayer.ts).
    this.artifactLayer.addPop(out, marking);
    this.artifactLayer.addContact(out, this.resp.inspirationStarted, marking);
    this.artifactLayer.tickDetach();

    if (this.chain) this.chain.process(out, lineVal, this.artifactLayer.lineAmp);

    // Synthetic ECG display channel: same waveform as the scalp contamination
    // above, at the amplitude a real ECG lead records rather than the fraction
    // that reaches the scalp.
    this.ecgChannelValue = this.ecgRaw * 500;
    // Lung volume, centred, in the display units the ECG row uses (ecgScale: 1000 to
    // 10 mm): a breath is 6 mm peak to peak, inspiration upward as a belt records it.
    this.respChannelValue = (this.resp.volume - 0.5) * 600;

    this.sampleIndex++;
    this.groundTruth.t = this.sampleIndex * this.dt;
    this.groundTruth.vigilance = this.vigilance.value;
    this.groundTruth.blinking = this.artifactLayer.blinking;
    this.groundTruth.betaBursting = betaBursting;
    this.groundTruth.popChannel = this.artifactLayer.popChannel;
    this.groundTruth.eyesOpen = this.alphaBlock;
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
  private filters: FilterSettings | undefined;
  /**
   * The reader's filter settings (low cut, high cut, notch), applied in the recording
   * chain. Short-circuits on an unchanged object, so the app can pass it every
   * sample; omitted leaves the chain's own defaults (0.25 Hz, 100 Hz, no notch).
   */
  setFilters(f?: FilterSettings) {
    if (f === this.filters) return;
    this.filters = f;
    if (f && this.chain) this.chain.setFilters(f);
    this.artifactLayer.setNotch(f?.notchHz ?? null);
  }

  /** Choices between forms of one pattern (see `PatternOptions`); omitted means the defaults. */
  setPatternOptions(o?: PatternOptions) {
    this.postsForm = o?.postsForm ?? 'singles';
    this.postsSmallerPct = o?.postsSmallerPct ?? POSTS_SMALLER_DEFAULT;
    this.postsOneSidePct = o?.postsOneSidePct ?? POSTS_ONE_SIDE_DEFAULT;
    this.focalPlacement = o?.focalPlacement ?? 'under';
    this.seizureMuscle = o?.seizureMuscle ?? false;
    this.kcSpindle = o?.kcSpindle ?? 'sometimes';
    this.sixHzForm = o?.sixHzForm ?? 'fold';
    this.pos146Sides = o?.pos146Sides ?? 'shifting';
    this.setBreachSites(o?.breachSites ?? [o?.breachSite ?? 'C4']);
  }

  /** The electrodes over skull defects (breach rhythm); C4 until told otherwise. */
  private setBreachSites(sites: BreachSite[]) {
    const key = sites.join();
    if (key === this.breachKey) return;
    this.breachKey = key;
    this.breachIdx = sites.map(e => this.electrodes.indexOf(e)).filter(c => c >= 0);
    this.breachHp = this.breachIdx.map(() => 0);
    this.breachPrev = this.breachIdx.map(() => NaN);
    // One part per defect: each is its own electrode's change.
    this.breachFields = this.breachIdx.flatMap(c => this.electrodeFields[c]);
  }

  /**
   * How long after a seizure toggle is switched on the seizure begins; null for
   * each seizure's own delay. The app sets one short delay for all four: a
   * learner who switches a seizure on is waiting for it, and 4-6 s of an
   * unchanged page (longer before a slow build-up shows) read as a dead toggle.
   */
  setIctalOnsetDelay(seconds: number | null) { this.ictalDelay = seconds; }

  /** Report artifact onsets in `groundTruth.marks` (off by default; see ArtifactMark). */
  setArtifactMarks(on: boolean) {
    this.marksOn = on;
    if (!on) this.groundTruth.marks.length = 0;
  }

  /**
   * Whether a `stateIntrinsic` source runs because of the patient's state (the
   * default) or only when its toggle is set.
   *
   * The app turns this off. It shows the stage's own graphoelements and eye
   * movements as toggles that are ON — it sets them itself on entering the stage —
   * so that what the toggles say and what is on the page are the same thing, and
   * switching one off really removes it. Everything else that drives the engine
   * (the gate, the renderers) leaves it on and gets a stage complete with its
   * defining features from the state alone.
   */
  setStateDrivesIntrinsic(on: boolean) { this.stateDrivesIntrinsic = on; }

  /**
   * Whether the subject's own background mu is drawn. About one subject in seven
   * has one (IK-033) and it needs no toggle — right for a record, wrong for the
   * app, where nothing is on the page unless its toggle is on: the owner, with
   * every toggle off but Eyes Open, was shown a left central rhythm and had to
   * ask what it was (2026-10-13). The app turns this off; mu there is the
   * `mu-rhythm` toggle and nothing else.
   */
  setBackgroundMu(on: boolean) { this.backgroundMu = on; }

  /** The scalp field of one or more sources, each with a weight: electrode -> signed relative size. */
  private fieldOf(sources: [index: number, weight: number][]): Record<string, number> {
    const nS = this.leadfield.nSources, G = this.leadfield.gain;
    return Object.fromEntries(this.electrodes.map((name, e) => {
      let v = 0;
      for (const [s, w] of sources) v += w * G[e * nS + s];
      return [name, v];
    }));
  }

  /** A generator's `PatternMarkEvent` as an `ArtifactMark` on the rows it names. */
  private patternMarkOf(i: number, pm: PatternMarkEvent): ArtifactMark {
    const where = pm.where ?? 'source';
    return {
      id: this.patternDescriptors[i].toggles[0], label: pm.label,
      fields: this.markFieldsOf(i, where), page: where === 'page' || undefined,
      dur: pm.dur ?? 0.3, ago: -(pm.at ?? 0), span: pm.span,
    };
  }

  private markFieldsOf(i: number, where: MarkWhere): MarkFields {
    if (where === 'page') return NO_FIELDS;
    if (where === 'source') return (this.sourceField[i] ??= [this.fieldOf([[this.patternIndex[i], 1]])]);
    const toggle = this.patternDescriptors[i].toggles[0];
    let f = this.toggleField.get(toggle);
    if (!f) {
      f = this.patternDescriptors.flatMap((d, k) => (d.toggles[0] === toggle ? [this.fieldOf([[this.patternIndex[k], 1]])] : []));
      this.toggleField.set(toggle, f);
    }
    return f;
  }

  /**
   * A pattern with no events (`PatternSourceDescriptor.openBox`): a box opened when
   * the source comes on, left open (span Infinity), and closed with its length when
   * the source goes off.
   */
  private markOpen(i: number, on: boolean) {
    const key = this.openKey[i] ?? null;
    if (on === (key != null)) return;
    const d = this.patternDescriptors[i];
    const where = d.openBox!.where ?? 'source';
    const base = { id: d.toggles[0], label: d.openBox!.label, fields: this.markFieldsOf(i, where), page: where === 'page' || undefined, dur: 0 };
    if (on) {
      const k = `${d.id}@${this.sampleIndex}`;
      this.openKey[i] = k;
      this.groundTruth.marks.push({ ...base, span: Infinity, key: k });
    } else {
      this.openKey[i] = null;
      this.groundTruth.marks.push({ ...base, span: 0, key: key! });
    }
  }

  /** Switch the engine's own artifacts on and off (see ArtifactGates). */
  setArtifactGates(gates: Partial<ArtifactGates>) {
    this.artifactLayer.setGates(gates);
  }

  /** Recording conditions (top bar): when the artifacts the toggles allow happen. See conditions.ts. */
  setConditions(level: ConditionLevel) {
    this.artifactLayer.setConditions(level);
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
    this.artifactLayer.setParams(params);
  }

  /** Index of a named electrode, or -1. */
  indexOf(name: string): number {
    return this.electrodes.indexOf(name);
  }
}

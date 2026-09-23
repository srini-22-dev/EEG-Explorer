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
  buildLeadfield, sourceUnder, synchronousPatches, backgroundPatches, CORTICAL_SHELL, CORTEX_BELOW_SCALP,
  type SourceSpec, type Leadfield,
} from './forward';
import {
  ARTIFACT_SOURCES, OCULAR_DIPOLE_SHARE, OCULAR_FIRST_EVENT_LEAD_SEC, BlinkGenerator, EyeOpeningGenerator, SaccadeGenerator, EmgGenerator, EcgGenerator,
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
  /**
   * Per-side background-mu RMS as a fraction of `alphaRms`, at symmetric
   * laterality. Zero in most subjects — see `sampleSubject`.
   */
  muFraction: number;
  /** Left-hemisphere share of the two-sided mu total; 0.5 is symmetric. */
  muLaterality: number;
};

export function sampleSubject(seed: number): SubjectParams {
  const g = new Gaussian(deriveSeed(seed, 'subject'));
  return {
    // 8.5-12.0 Hz: the reference course's normal ADULT posterior-dominant-rhythm
    // band. This used to be 8.2-11.6, which is wrong at both ends — it put ~9% of
    // "normal awake" subjects below 8.5 Hz, i.e. it generated an abnormally slow
    // PDR and presented it as normal, while never reaching the top of the normal
    // range. (The course notes 8.0 is sometimes accepted in the elderly; this
    // simulator has no age parameter, so it uses the adult floor.)
    iaf: 8.5 + g.uniform() * 3.5,
    exponent: 1.05 + g.uniform() * 0.75,
    // Aperiodic floor, 3-7 uV RMS per patch. Was 6-14 (cited only to the project briefing,
    // "§2: 5-20"). Halved 2026-09-22 against learningeeg's awake figures, read row by row
    // with one estimator on both sides (read-lab/py/statetable.py, reader benched against
    // engine truth at the same geometry). At 6-14 the engine carried 0.26-0.63 of each
    // row's 0.5-30 Hz power below 4 Hz on the non-frontopolar rows, against 0.05-0.33 on
    // the two clean eyes-closed pages ("normal-alpha-eye-closure", Atlas "alpha
    // activity"); it also carried too much beta, and posterior alpha stood 10-15 dB over
    // the aperiodic fit against 20-31 dB. A floor too high explains all three at once,
    // where a flatter exponent would have added beta. The value is where the frontal
    // rows, which are mostly this floor, match the pages' relative size (F3-C3 0.91 and
    // 0.97 of the page median, against 0.92 and 0.93); lower, they fall below it.
    // Still open: the posterior rows carry more non-alpha than the pages (P3-O1/F3-C3
    // non-alpha power 1.2 against 0.25-0.65). Lowering AP_AMPLITUDE_TILT does not fix it
    // without flattening the bipolar front-to-back ratio away from the page's 3.75.
    backgroundRms: g.range(3, 7),
    alphaRms: g.range(8, 20),
    // 1.25-3.0 uV RMS, i.e. roughly 7-18 uV peak-to-peak — the textbook range for
    // awake sensorimotor beta. This was 2.5-6.0, and at that level beta was not an
    // admixture but the dominant rhythm of the central rows: measured across ten
    // seeds on bipolar-ap, beta reached 17 uV and 67-70% of the 2-45 Hz power on
    // F3-C3 and F4-C4 against 33-36% on rows with no beta source near them, and it
    // was LOUDER than alpha there (beta/alpha 1.7-1.8). IK-014 requires beta to be
    // "a low-amplitude, relatively even central admixture" riding within the
    // background envelope; at that amplitude it WAS the envelope, and on the page
    // the parasagittal and midline rows read as serrated and noisy against clean
    // temporal rows.
    //
    // Note the floor this can never go below: the aperiodic background carries its
    // own 13-30 Hz content, worth ~33-36% of a row, so beta share cannot approach
    // zero however far the oscillators are turned down — and beta/alpha stays above
    // 1 on central rows regardless, because those rows have little alpha by design.
    // Share against that floor, not beta/alpha, is the quantity that matters.
    //
    // Scaled 0.7x to 0.875-2.1 (~5-12 uV p-p) on 2026-09-22, when the aperiodic floor
    // was halved: beta is an absolute amplitude, so the quieter floor raised its share of
    // the central rows to IK-014's ceiling (excess over a beta-free row 0.248 against
    // 0.25). learningeeg's clean eyes-closed pages read 0.03-0.09 of F3-C3's 0.5-30 Hz
    // power as beta; at 0.7x the engine reads ~0.23, still above them, so this is the
    // direction the reference asks for, not a fit to it.
    betaRms: g.range(0.875, 2.1),
    // Scalp-field width, in scene units, for the neural sources below. The
    // range is tied to inter-electrode spacing: the same physical field must
    // span the same electrodes. When electrodePositions3D was rebuilt from the
    // mesh, the 10-20 array grew — mean montage-link distance 5.34 -> 5.98 cm
    // (x1.121), mean nearest-neighbour spacing 4.50 -> 5.09 cm (x1.132) — so
    // this range is scaled by that measured factor, not tuned to a trace.
    smearing: g.range(0.235, 0.336),
    artifactBurden: g.range(0.5, 1.6),
    vigilanceBias: g.range(0.35, 0.7),
    lineFreq: 50,
    lineAmp: g.uniform() < 0.5 ? 0 : g.range(1, 8),
    // Mu is a benign VARIANT, not part of the normal awake background. The
    // reference course puts it in "Normal Variants" — the epileptiform-mimic
    // chapter, next to wicket and RMTD — while its "Normal Awake" chapter
    // describes only the PDR, the antero-posterior gradient, reactivity and
    // activation, and no central rhythm at all. Recognisable mu is a minority
    // finding in routine adult records; reported prevalence spans roughly
    // 20-50% depending on age and how hard the reader looks, so the third
    // below is a modelling choice inside that range, not a measured figure.
    //
    // This matters for what the default record teaches. Mu is focal at C3/C4,
    // so whenever it is present the bipolar chain shows a phase reversal there
    // — which is correct, and is how a reader recognises it. Running it in
    // every subject, bilaterally and symmetrically, made that reversal a
    // permanent fixture of the default awake record, training the learner to
    // ignore the one sign the double-banana exists to produce (IK-003). Most
    // subjects now get none, so the default background is clean and mu is
    // something the learner meets rather than something they filter out.
    //
    // Drawn last on purpose: inserting draws earlier would shift every
    // subsequent parameter for every existing seed.
    // The `mu-rhythm` toggle (sources/variants.ts) still summons mu
    // deliberately in any subject, independent of this draw.
    muFraction: g.uniform() < 0.34 ? g.range(0.3, 0.5) : 0,
    // "Can be bilateral but is often predominant on one side or the other", so
    // an exactly symmetric mu is the exception rather than the rule. Left share
    // of the two-sided total: 0.5 symmetric, 0.75 strongly left-predominant.
    muLaterality: g.range(0.25, 0.75),
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
  /** Alpha-blocking level from eye opening, 0 closed .. 1 open (IK-007). */
  eyesOpen: number;
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
  /**
   * Pre-existing bad electrodes: the noisy / flat / intermittent channels
   * `sampleDefects` draws per subject.
   *
   * This was the one abnormality in the engine that ran ungated. Every other
   * artifact here is off unless its toggle is set, but defects were applied
   * unconditionally and reached **84% of subjects** (mean 1.05 noisy at 3-9x
   * noise, plus 0.18 flat and 0.21 intermittent). A noisy electrode shows on the
   * TWO bipolar rows that share it, so the default record — every toggle off —
   * usually had two rows buried in grass. That is not what a reader means by a
   * normal awake record, and it is not what the reference course teaches from.
   *
   * The subject still DRAWS its defects either way, so a given seed keeps the
   * same bad electrodes whenever the toggle is on; this gates whether they are
   * applied, not whether they exist.
   */
  defects: boolean;
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
 *
 * The amplitude envelope across states is NOT monotonic, and used to be. The
 * reference course describes the descent into sleep as "gradual loss of the PDR
 * with coinciding diffuse attenuation of the tracing" — drowsiness and N1 are
 * LOW-amplitude states, the record getting quieter as alpha drops out, not
 * louder. This table previously ran background 1.00 -> 1.10 -> 1.20 -> 1.35 ->
 * 1.60 with delta climbing alongside, which took display-space row RMS from
 * 8.3 uV awake to 15.7 in N1: the tracing nearly doubled through the one
 * transition the course calls an attenuation.
 *
 * The other half of that error was WHICH band carried it. Delta at 0.30/0.70 in
 * drowsy/N1, against a 28 uV delta oscillator, put roughly 8-20 uV of 1.1 Hz
 * activity into stages that are defined by theta. Delta is N3's defining
 * feature — "high amplitude (>75 uV), synchronized delta activity, usually
 * 0.5-2 Hz" — and it is nearly absent earlier. So drowsy/N1 now attenuate
 * (background below 1.0, delta near nil, theta carrying the slowing), N2 rises
 * only slightly (its big slow events are discrete K-complexes, not background
 * delta), and N3 keeps its full delta.
 */
const STATE_GAINS: Record<PatientState, Record<Band, number>> = {
  awake:  { background: 1.00, alpha: 1.00, mu: 1.00, theta: 0.35, delta: 0.06, beta: 1.00 },
  drowsy: { background: 0.92, alpha: 0.45, mu: 0.55, theta: 1.20, delta: 0.10, beta: 0.70 },
  n1:     { background: 0.78, alpha: 0.12, mu: 0.15, theta: 1.40, delta: 0.10, beta: 0.45 },
  n2:     { background: 0.88, alpha: 0.04, mu: 0.05, theta: 1.20, delta: 0.40, beta: 0.30 },
  n3:     { background: 1.30, alpha: 0.02, mu: 0.02, theta: 0.90, delta: 3.20, beta: 0.20 },
  // REM is the paradoxical stage: "diffuse attenuation of amplitudes, with a
  // range of frequencies amongst the background". Electrically it resembles N1
  // or drowsy wakefulness — low-voltage, mixed-frequency, no PDR to speak of and
  // very little delta — which is precisely why the EEG alone does not identify
  // it. What identifies it is the pair of features the background CANNOT show:
  // the rapid eye movements (`rem-eyes`, sources/sleep.ts) and muscle atonia
  // (STATE_EMG_SCALE below). Beta stays comparatively preserved because REM is
  // not a slow state.
  rem:    { background: 0.75, alpha: 0.20, mu: 0.10, theta: 1.30, delta: 0.08, beta: 0.70 },
};

// Sensorimotor beta burst shape (betaL/betaR/betaF). `ampSigma` is the log-SD of
// the log-normal burst-amplitude tail: at the 0.6 default it threw occasional
// bursts 3-4x the median, standing proud of the awake background as sharp central
// packets a learner could misread as muscle or an epileptiform transient. 0.4
// narrows the tail so beta reads as a low, even admixture; total beta power is
// unchanged (the oscillator recalibrates its RMS to `rms`). Exported so the
// crest-factor bound in validateEngine §6e guards the value the engine ships.
// `rms` is per-subject and supplied at construction.
/**
 * Frontal beta amplitude, as a multiple of the central beta sources' RMS.
 *
 * Held at 1.0 — i.e. currently inert — and kept as a named seam because the
 * experiment it enabled produced a useful negative result. Beta IS frontally
 * predominant in the awake adult, and weighting it so does raise the frontopolar
 * spectral centroid that IK-030 asserts. But it cannot be used, because amplifying
 * beta at Fz raises Fz's peak-to-peak as well as its centroid, and IK-029 requires
 * Fz < Cz. Measured across three seeds on reference-ipsi:
 *
 *     gain 1.00   centroid 1.066 (needs >= 1.10)   Cz/Fz 1.114 (needs >= 1.0)
 *     gain 1.20   centroid 1.095                   Cz/Fz 0.978
 *     gain 1.35   centroid 1.117                   Cz/Fz 0.886
 *
 * Cz/Fz crosses below 1.0 before the centroid reaches 1.1: there is no value that
 * satisfies both. The frequency half of the antero-posterior gradient cannot be
 * bought with amplitude at Fz, which is the sharper form of IK-030's open problem.
 */
export const BETA_FRONTAL_GAIN = 1.0;

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

// Alpha reactivity to eye opening (IK-007). The PDR is the resting, eyes-closed
// occipital rhythm: learningeeg's Normal Awake chapter has it emerge "right after the
// patient closes their eyes", and reactivity is part of every background read.
//
// Both ways the eyes can be open drive ONE state here, so they cannot disagree: the
// `eyes-open` toggle (eyes held open), and the `eye-opening` maneuver's open interval
// (open on command, close a few seconds later). Before this, the maneuver drew its
// ocular sweep with the alpha running straight through the open interval, and the
// toggle stepped alpha to its open level within one sample.
//
// EYES_OPEN_ALPHA_GAIN is the residual PDR amplitude with the eyes open. A normal
// PDR attenuates markedly, often by well over half, and may block outright; 0.35
// (-9 dB) keeps a visibly reduced rhythm, which is what most normal records show.
// The two time constants give the transition its physiological shape: blocking
// follows opening within a few hundred ms, and the PDR re-emerges more slowly over
// roughly the first second after closure. They are approximate (the literature
// quotes latencies, not time constants) and not asserted beyond "within ~1 s".
export const EYES_OPEN_ALPHA_GAIN = 0.35;
export const ALPHA_BLOCK_TAU_S = 0.15;
export const ALPHA_RETURN_TAU_S = 0.4;

// What the PDR does in the seconds after the eyes close. A real record does not just
// resume its resting rhythm: the PDR comes back PROMINENTLY, overshooting its settled
// amplitude before easing down, and it can briefly run faster ("alpha squeak",
// learningeeg's Normal Awake chapter: "a transient quickening of the PDR immediately
// after eye closure").
//
// The rebound is measured, not assumed. On learningeeg's two eye-closure figures
// (Normal Awake: pdr-emerges-eye-closure, normal-alpha-eye-closure), traced by
// scripts/read-lab (py/closure.py), the posterior 8-13 Hz envelope relative to the
// settled PDR averages 1.27 / 1.30 / 2.10 / 1.83 / 1.48 over +0-0.5 / 0.5-1 / 1-1.5 /
// 1.5-2.5 / 2.5-3.5 s after closure: it peaks 1-2 s after the eyes close and is still
// raised at 3 s. Modelled as a gain 1 + GAIN*g(t) with g = (t/PEAK)^3 * exp(3(1 - t/PEAK)),
// which peaks at 1 when t = PEAK and falls to ~0.2 by 2.4*PEAK. Scaled by how deeply the
// PDR had been blocked, so a closure after a brief half-blocked opening rebounds less.
// Measured with the same tracer and windows over 7 engine closures: 1.17 / 1.75 / 1.99 /
// 1.53 / 1.39. A peak of 1.25 s (matched to the first figure alone) rose too early and
// settled too soon against the pair; the engine is still a little early at 0.5-1 s.
// Two real records, matched loosely, not fitted.
//
// The squeak is the uncertain half. The same figure shows NO quickening of 1 Hz or more
// averaged over the first second (10.6 Hz there against 10.9 settled, counted), so the
// squeak is kept small: +1.0 Hz at closure decaying with 0.4 s, which averages ~+0.4 Hz
// over that second — inside what the record allows, and still the transient quickening
// the source describes.
export const ALPHA_REBOUND_GAIN = 0.8;
export const ALPHA_REBOUND_PEAK_S = 1.7;
export const ALPHA_SQUEAK_HZ = 1.0;
export const ALPHA_SQUEAK_TAU_S = 0.4;

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

// The sleep background: theta for drowsiness and light sleep, slow waves for N3.
//
// These were three single sources — `thetaDiffuse` (one patch midway between Cz
// and Pz), `deltaF` (under Fz/Fp1/Fp2) and `deltaC` (under Cz/C3/C4) — and on
// the page each became a midline rhythm. Measured on bipolar-ap over 4 subjects
// x 60 s, same seed with one source muted at a time: in N1, Fz-Cz ran 18-22 uV RMS
// against 6.5-11 on every other row, a continuous 5.1-5.9 Hz rhythm of which
// `thetaDiffuse` alone supplied 14.6 uV; in N3, Fz-Cz 110-118 and Cz-Pz 83-94 uV
// against 7-10 on T5-O1, because two INDEPENDENT generators either side of Cz make
// the link between them the largest on the page. Real drowsiness and N1 carry
// low-amplitude, mixed, predominantly 4-7 Hz activity over the whole head (AASM),
// with quiet midline rows in every learningeeg drowsy/N1/N2 figure; and slow-wave
// sleep is "diffuse and synchronized, high amplitude delta" (learningeeg), scored
// over the frontal regions (AASM), with large delta on every chain of its figure,
// posterior ones included.
//
// Now:
//  - theta: an independent patch under every 10-20 site, each at its own 4.5-6.5
//    Hz — diffuse and polymorphic, no site privileged;
//  - slow waves: one SYNCHRONIZED component — a single slow oscillation driving a
//    frontally weighted field over the whole head (`SLOW_WAVE_FIELD`) — plus an
//    independent local patch under every site. Most human slow waves are partly
//    local rather than global (Nir et al. 2011, Neuron 70:153), and it is the local
//    part that puts delta onto every bipolar link; the common part is what makes
//    the referential record synchronized and frontally predominant.
// All at one depth below the scalp (forward.ts CORTEX_BELOW_SCALP). State and
// vigilance gains apply as before (bands 'theta' and 'delta'); the RMS values are
// set so the page matches the stage descriptions — see the checks in Step 19.
export const SLEEP_SITES = [
  'Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T3', 'C3', 'Cz', 'C4', 'T4',
  'T5', 'P3', 'Pz', 'P4', 'T6', 'O1', 'O2',
];
const SLEEP_PATCH = { extent: 0.3, belowScalp: CORTEX_BELOW_SCALP };
export const SLOW_WAVE_FIELD: Record<string, number> = {
  Fp1: 0.9, Fp2: 0.9, F7: 0.75, F8: 0.75, F3: 1, F4: 1, Fz: 1,
  T3: 0.55, T4: 0.55, C3: 0.75, C4: 0.75, Cz: 0.75,
  T5: 0.4, T6: 0.4, P3: 0.55, P4: 0.55, Pz: 0.55, O1: 0.4, O2: 0.4,
};
// Halved from 2.4 on 2026-09-22 with the aperiodic floor (`backgroundRms`, sampleSubject): this
// RMS was set against that floor, and halving one without the other made N1 louder than awake
// (N1/awake IQR 1.09), reversing IK-034. Halving both keeps their old ratio. The learningeeg N1
// (vertex-wave) and N2 (K-complex) pages had already read the engine's theta share high against
// the reference on most rows (0.41-0.51 vs 0.12-0.41 on the N1 page) before either change.
export const SLEEP_THETA_RMS = 1.2;
export const SLOW_WAVE_SYNC_RMS = 5.3;
export const SLOW_WAVE_LOCAL_RMS = 3.2;
// How strongly the local slow waves follow SLOW_WAVE_FIELD's frontal weighting (0 = equal
// everywhere, 1 = as steep as the synchronized field). See the local patches in the constructor.
const SLOW_WAVE_LOCAL_TILT = 0.3;
// Slow waves carry nothing above a few Hz; see HopfOscillator `outputLowPassHz`.
const SLOW_WAVE_LOWPASS_HZ = 4;

// Ocular drive for a blink, microvolts at the ocular sources before the leadfield. Eye
// opening uses half of it (next()).
//
// Was 110, which put the median blink at 100 uV on Fp1-F3 (1.4 row-heights at 7 uV/mm, the
// largest ~180): blinks that never crossed more than the row beneath. learningeeg's blink
// figures cross two to four rows. No calibrated uV figure for scalp blinks was found in a
// citable source, so the size is read RELATIVE TO EACH PAGE'S OWN BACKGROUND, the one
// quantity an uncalibrated screenshot keeps (read skill), both sides measured the same way:
// Fp1-F3 blink trough over P3-O1 1st-99th percentile peak-to-peak (2026-09-14).
//   learningeeg Artifacts, "Eye Blinks and Chewing and Tongue artifact" (eyes open):
//     blinks 3.3-4.2 row-heights over 0.22-0.38 -> ~13;  engine, eyes open: 2.8
//   learningeeg Atlas, "alpha activity" (background eyes-closed alpha):
//     blinks 2.0-2.9 over 0.69 -> 2.9-4.2;                engine, eyes closed: 2.2
// The second page's alpha (0.69 rows) is 48 uV at 7 uV/mm against the engine's 47, so its
// scale is close to the engine's and its blinks read ~140-200 uV; the first page's read
// ~230-290. Two records call for 1.6x-4.6x. Doubling, to a ~200 uV median, is the
// conservative end of that range, weighted toward the better-calibrated page; the
// log-normal per-blink spread (BlinkGenerator) still throws the occasional ~350 uV blink.
// 220 gave that median with the ocular sources at the pupil; moving them to upper-lid height
// (artifacts.ts, same day) changed how their columns normalise and dropped it to 172 uV, so
// the drive is rescaled to keep the ~200 uV median: 220 x 200/172.
export const BLINK_DRIVE_UV = 255;

/**
 * Ceiling on one side's background mu RMS, microvolts (ear-referenced at C3/C4).
 *
 * Mu's typical amplitude is under 50 uV (StatPearls, EEG Basal Cortical Rhythms,
 * NBK532986). Uncapped, `alphaRms * muFraction * 2 * share` reached 11 uV RMS in
 * strong-alpha, strongly lateralised subjects, and across 16 mu subjects (eyes open,
 * 120 s, isolated same-seed) the 95th-percentile cycle ran 25-80 uV with single cycles
 * to 169 uV: the runs that tower over the parasagittal chain on the page (reported by
 * the user, 2026-09-14). The 95th-percentile cycle is ~7x the per-side RMS — a
 * sinusoid's 2.8x, the oscillator's Rayleigh amplitude spread, and the vigilance alpha
 * gain in relaxed wakefulness — so 7 uV holds 95% of cycles near 50 uV. Only subjects
 * above it change; the envelope depth was tried first and moved the worst 95th only
 * 81 -> 72 uV at 0.3.
 */
export const MU_MAX_RMS = 7;

/** Background mu's cortical field, per side (see the muL/muR sources in the constructor). */
export const MU_FIELD = {
  left: { C3: 1, P3: 0.3, Cz: 0.35 },
  right: { C4: 1, P4: 0.3, Cz: 0.35 },
};

/** Baseline vigilance for each state, feeding the slow drift in `state.ts`. */
const STATE_VIGILANCE: Record<PatientState, number> = {
  awake: 0.68, drowsy: 0.38, n1: 0.25, n2: 0.15, n3: 0.08,
  // REM sits high for a sleep stage because vigilance here drives the arousal-
  // like character of the background, which in REM is genuinely wake-like. It
  // must NOT be used to infer muscle tone — see STATE_EMG_SCALE.
  rem: 0.30,
};

/**
 * Per-state multiplier on muscle (EMG) amplitude.
 *
 * Everything else scales muscle through vigilance (`state.ts`, emg = 0.35 +
 * 1.3*v), which works for the descent through NREM: less alert, less tone. REM
 * breaks that relationship. It is the one stage with an arousal-like EEG and
 * near-total loss of muscle tone at the same time — "muscle activity should be
 * near-absent throughout this stage" — and a vigilance-derived scale cannot
 * express it, because raising vigilance to make the background wake-like would
 * raise the muscle with it. So atonia is stated separately, as the physiological
 * fact it is, rather than being derived from something it does not follow from.
 */
const STATE_EMG_SCALE: Record<PatientState, number> = {
  awake: 1, drowsy: 1, n1: 1, n2: 1, n3: 1, rem: 0.06,
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
  // 0 = eyes closed, 1 = eyes open, smoothed with ALPHA_BLOCK_TAU_S / ALPHA_RETURN_TAU_S.
  // Reported per sample as groundTruth.eyesOpen.
  private alphaBlock = 0;
  // Post-closure rebound and squeak: time since the eyes last closed, and how deeply
  // the PDR was blocked at that moment.
  private wasEyesOpen = false;
  private sinceClose = Infinity;
  private blockAtClose = 0;

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
  // Defaults for a standalone engine (validation, scripts). The app never relies on
  // them: SimulationSource sets every gate from the toggles on every sample.
  // `eyeOpening` defaults OFF: it is a command maneuver ("open your eyes ... close
  // them"), not background, and since eye opening blocks the PDR (IK-007) leaving it on
  // held a "resting" record's eyes open ~45% of the time.
  private gates: ArtifactGates = {
    blink: true, eyeOpening: false, saccade: true, emg: true, pop: true, defects: true,
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
  /** Last-seen manual-pop counter; a change fires one pop (see setArtifactParams). */
  private lastManualPopNonce = 0;

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
      sourceUnder('thetaFm', ['Fz'], { extent: S.smearing * 1.3 }),
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
    // Frontal midline theta is task-locked and bursty (§4), not a sustained rhythm.
    this.neural.push({
      kind: 'burst', band: 'theta', baseRms: S.betaRms * 0.9,
      src: new BurstyOscillator(deriveSeed(seed, 'thetaFm'), this.dt, {
        freq: 6, freqSpread: 0.8, medianDuration: 0.9, meanInterval: 4.5, rms: S.betaRms * 0.9,
      }),
    });
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

    this.groundTruth = { t: 0, vigilance: 0.5, blinking: false, betaBursting: false, popChannel: -1, eyesOpen: 0 };

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
      const savedGates = this.gates;
      this.gates = Object.fromEntries(Object.keys(savedGates).map(k => [k, false])) as unknown as ArtifactGates;
      const scratch = new Float64Array(this.electrodes.length);
      const warmupSamples = Math.round(warmup * this.fs);
      for (let i = 0; i < warmupSamples; i++) this.next(scratch);
      this.gates = savedGates;
      this.sampleIndex = 0;
      this.groundTruth = { t: 0, vigilance: this.vigilance.value, blinking: false, betaBursting: false, popChannel: -1, eyesOpen: this.alphaBlock };
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

    // Eyes open -> the PDR blocks (IK-007). Mu is a separate band and untouched.
    const eyesOpen = this.activePatterns.has('eyes-open') || (this.eyeOpening?.isOpen ?? false);
    const tau = eyesOpen ? ALPHA_BLOCK_TAU_S : ALPHA_RETURN_TAU_S;
    if (this.wasEyesOpen && !eyesOpen) { this.sinceClose = 0; this.blockAtClose = this.alphaBlock; }
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

    let lineVal = 0;
    if (this.blink) {
      const ix = this.artifactIndex;
      const g = this.gates;
      const p = this.aparams;
      // The ocular EVENT generators (blink, eye-opening, saccade) take their gate
      // directly: while disabled they are silent, and re-enabling schedules the
      // first event promptly (a fresh start, not a resumed schedule) so the toggle
      // has an immediate visible effect. They return 0 when gated off, so their
      // output is added unconditionally. The remaining generators below instead
      // advance every sample and are gated only at the point of addition — keeping
      // each renewal process's phase/decay running underneath a disabled toggle, so
      // those resume rather than restart.
      // Each eye is a dipole term plus a monopole term at the same point, co-fired
      // in fixed proportion (see OCULAR_DIPOLE_SHARE). Every lid-driven generator
      // goes through here so all of them keep the same scalp field.
      const eyes = (v: number) => {
        const d = v * OCULAR_DIPOLE_SHARE, m = v * (1 - OCULAR_DIPOLE_SHARE);
        V[ix.eyeL] += d; V[ix.eyeR] += d;
        V[ix.eyeMonoL] += m; V[ix.eyeMonoR] += m;
      };
      const blinkV = this.blink.next(g.blink, gains.ocularRate) * BLINK_DRIVE_UV;
      eyes(blinkV);
      // Eye opening rides the same ocular sources as the blink but at half the
      // amplitude and opposite sign on opening (see EyeOpeningGenerator): opening
      // drives Fp negative -> upward, closing a smaller downward transient.
      const openV = this.eyeOpening!.next(g.eyeOpening) * BLINK_DRIVE_UV / 2;
      eyes(openV);
      const saccadeV = this.saccade!.next(g.saccade, gains.ocularRate) * 45;
      V[ix.gaze] += saccadeV;
      // Which muscles are tense is a separate question from how hard they are
      // contracting, so region selection and severity are separate controls.
      const emgSev = p.emgSeverity ?? 1;
      const regions = p.emgRegions;
      const on = (r: EmgRegion) => regions == null || regions.includes(r);
      const atonia = STATE_EMG_SCALE[this.patientState];
      const emgLV = this.emgL!.next(gains.emg) * 9 * gains.emg * emgSev * atonia;
      const emgRV = this.emgR!.next(gains.emg) * 9 * gains.emg * emgSev * atonia;
      const emgFV = this.emgF!.next(gains.emg) * 6 * gains.emg * emgSev * atonia;
      const emgNV = this.emgN!.next(gains.emg) * 8 * gains.emg * emgSev * atonia;
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
      if (g.movement) eyes(mv);
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
  setArtifactGates(gates: Partial<ArtifactGates>) {
    const hadDefects = this.gates.defects;
    const hadPop = this.gates.pop, hadMovement = this.gates.movement;
    Object.assign(this.gates, gates);
    // Rare-event artifacts run their renewal schedule underneath a disabled toggle, so
    // on the toggle-on edge the next event could be a minute away. Bring only that first
    // event forward, as the ocular generators do; the rate afterwards is unchanged.
    if (this.gates.pop && !hadPop) this.pop?.startSoon(OCULAR_FIRST_EVENT_LEAD_SEC);
    if (this.gates.movement && !hadMovement) this.movement?.startSoon(OCULAR_FIRST_EVENT_LEAD_SEC);
    // Defects are the one gate that is not simply read at the top of `next()`:
    // they live in the recording chain, so flipping the flag has to push the
    // channel state across. Detached electrodes are left alone — those are a
    // separate, deliberate user action and outrank a subject's drawn defects.
    if (this.gates.defects !== hadDefects && this.chain) {
      for (let c = 0; c < this.electrodes.length; c++) {
        if (this.detached.has(c)) continue;
        this.chain.setDefect(c, this.gates.defects ? (this.defects[c] ?? { kind: 'ok' }) : { kind: 'ok' });
      }
    }
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
    if (p.popRatePerMin != null) this.pop?.setMeanInterval(p.popRatePerMin > 0 ? 60 / p.popRatePerMin : Infinity);
    if (p.movementRatePerMin != null) this.movement?.setMeanInterval(60 / Math.max(p.movementRatePerMin, 0.05));
    if (p.lineFreq != null) this.line?.setFreq(p.lineFreq);
    if (p.ecgBpm != null) this.ecgChannel.setBpm(p.ecgBpm);
    if (p.popTarget != null) {
      this.pop?.setTarget(p.popTarget === POP_TARGET_ANY ? -1 : this.indexOf(p.popTarget));
    }

    // Manual "Pop" button: a discrete event, delivered as a rising counter (a pop
    // is a moment, not a state). Fire one pop on the selected electrode — or a
    // random one when "any" is selected (trigger(-1)) — each time it increases.
    if (p.manualPopNonce != null && p.manualPopNonce !== this.lastManualPopNonce) {
      this.lastManualPopNonce = p.manualPopNonce;
      const ch = !p.popTarget || p.popTarget === POP_TARGET_ANY ? -1 : this.indexOf(p.popTarget);
      this.pop?.trigger(ch);
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

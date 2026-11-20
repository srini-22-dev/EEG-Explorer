/**
 * The neural model's tuning constants: per-state band gains, rhythm shapes, the
 * antero-posterior gradient, the sleep background, and eye-opening reactivity.
 * Each carries the measurement or source it was set from.
 */

import { CORTEX_BELOW_SCALP } from './forward';
import type { Band } from './sources/registry';
import type { PatientState } from '../utils/simTypes';

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
export const STATE_GAINS: Record<PatientState, Record<Band, number>> = {
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
  // (STATE_EMG_SCALE, artifactLayer.ts). Beta stays comparatively preserved because REM is
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

// Breach rhythm (2026-10-27; the sources are in variants.ts at the `breach`
// descriptor). At the electrode over a skull defect the intracranial potential is
// multiplied by BREACH_GAIN_LOW at the slow end, rising through a first-order
// high-pass at BREACH_CORNER_HZ to BREACH_GAIN_HIGH: about 1.84 at 1 Hz, 2.37 at 5 Hz,
// 2.73 at 10 Hz, 2.92 at 20 Hz. The ceiling is the IFCN glossary's "usually by a factor
// of less than 3"; the slow end is raised too (EEG Atlas: "increased amplitude of high
// and low frequencies"), at 1.8 so that the electrode as a whole clears the AES
// series' "≥50% greater than the contralateral homologous site" with room; the corner
// puts most of the gain on the alpha band (mu "high amplitude and sharp", learningeeg)
// and all of it on beta. Measured (awake, 60 s, three subjects): C4-AVG 2.05-2.29x
// C3-AVG peak to peak; F4-C4 and C4-P4 1.9-2.1x and 1.4-1.8x what they are without the
// defect, Fp2-F4 and P4-O2 unchanged. eegpedia's figure has F4-C4 1.8x and C4-P4 2.9x
// their twins; C4-P4 comes out lower here because on an awake eyes-closed page that
// row carries P4's alpha, which the defect does not touch. 1.5 at the slow end gave
// C4-AVG 1.95-2.22x.
export const BREACH_GAIN_LOW = 1.8;
export const BREACH_GAIN_HIGH = 3;
export const BREACH_CORNER_HZ = 6;
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
export const SLEEP_PATCH = { extent: 0.3, belowScalp: CORTEX_BELOW_SCALP };
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
export const SLOW_WAVE_LOCAL_TILT = 0.3;
// Slow waves carry nothing above a few Hz; see HopfOscillator `outputLowPassHz`.
export const SLOW_WAVE_LOWPASS_HZ = 4;

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

/** Baseline vigilance for each state, feeding the slow drift in `state.ts`. */
export const STATE_VIGILANCE: Record<PatientState, number> = {
  awake: 0.68, drowsy: 0.38, n1: 0.25, n2: 0.15, n3: 0.08,
  // REM sits high for a sleep stage because vigilance here drives the arousal-
  // like character of the background, which in REM is genuinely wake-like. It
  // must NOT be used to infer muscle tone — see STATE_EMG_SCALE.
  rem: 0.30,
};

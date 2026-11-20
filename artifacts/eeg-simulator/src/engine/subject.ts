/**
 * The per-subject draw: what makes one simulated person differ from the next.
 */

import { Gaussian, deriveSeed } from './rng';

const MU_PREVALENCE = 0.15;

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
    // About one subject in seven. Published figures for mu on a routine record run
    // from 4% (visual review of 100 normal adults, Ain Shams series) to 22% (a
    // sleep-EEG cohort); Niedermeyer has it in "a minority of subjects". It was one
    // in three, a figure with no source. The second draw is still taken for every
    // subject who used to have mu, so no other parameter moves for any seed.
    muFraction: ((u: number) => (u < 0.34 ? g.range(0.3, 0.5) * (u < MU_PREVALENCE ? 1 : 0) : 0))(g.uniform()),
    // "Can be bilateral but is often predominant on one side or the other", so
    // an exactly symmetric mu is the exception rather than the rule. Left share
    // of the two-sided total: 0.5 symmetric, 0.75 strongly left-predominant.
    muLaterality: g.range(0.25, 0.75),
  };
}

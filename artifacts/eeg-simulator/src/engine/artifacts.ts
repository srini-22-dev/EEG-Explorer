/**
 * Artifact generators (briefing §8).
 *
 * "Artifacts are not noise to be added later — they are a large fraction of the
 * signal", routinely exceeding the neural signal in amplitude. Two properties
 * matter beyond amplitude:
 *
 *  - Each artifact has its OWN topography, distinct from the neural leadfield.
 *    That distinctness is exactly what ICA-based cleaning exploits, so a
 *    simulator that projects artifacts through the neural leadfield (or worse,
 *    adds them per-channel independently) makes artifact rejection look trivial.
 *    Here they are given source positions of their own — eyeballs, temporalis,
 *    heart — and pushed through the same Gaussian projector, which yields
 *    genuinely different spatial patterns because the generators are in
 *    genuinely different places.
 *
 *  - Morphology and statistics have to be right, not just the band. EMG is the
 *    clearest case: it is shot noise from randomly-timed motor unit action
 *    potentials, which is non-Gaussian and heavy-tailed. Modelling it as scaled
 *    uniform noise (as the previous engine did) produces something with the
 *    right bandwidth, the right amplitude, and the wrong distribution.
 */

import { Gaussian, deriveSeed } from './rng';
import type { SourceSpec, Vec3 } from './forward';

/**
 * Artifact generator positions. These sit outside the cortical shell — the eyes
 * in front and below, temporalis muscle laterally, the heart far below — which is
 * what makes their scalp patterns unlike any neural source's.
 *
 * These are the only sources with literal coordinates; every neural source is placed
 * under named electrodes by `sourceUnder()` and so follows the electrode frame
 * automatically. That makes this block the one place a frame change has to be applied
 * by hand — so state the frame: **+x is anatomically LEFT**, +y up, +z anterior
 * (scripts/src/processColinMesh.ts). Hence the L entries carry positive x.
 *
 * WHY THE BLINK NEEDS TWO SOURCES PER EYE. A single `radial` source weights every
 * electrode by a Gaussian in straight-line 3-D distance, which is monotone: an electrode
 * farther from the orbit must see less. From the true orbit F3 is FARTHER than F7
 * (8.1 cm vs 5.6 cm), yet a clinical blink shows F3 at least as large as F7 (read off
 * learningeeg's blink figures, 2026-09-14: F7 0.10-0.31 of Fp1, F3 0.25-0.33 — this said
 * "roughly 40-50%" for both until then, with no source). Getting there from Fp1 needs a
 * steep drop over the short Fp1->F7 step and no further drop over the longer F7->F3
 * step — the shorter step needs the bigger fall, which no
 * monotone function of distance can produce at any `extent`. Widening `extent` to lift F3
 * raises F7 faster and inverts the Fp1-F7 > F7-T3 gradient instead.
 *
 * The missing ingredient is angular structure, and `tangential` already supplies it: the
 * forward model's tangential gain is a derivative-of-Gaussian, i.e. a dipole. So the eye
 * is modelled as a vertical dipole plus a monopole, co-fired in equal parts (see
 * `OCULAR_DIPOLE_SHARE` and its use in engine.ts). The dipole term carries the
 * up-down asymmetry that lifts F3 relative to F7; the monopole term restores the broad
 * bifrontal spread onto Fz/Cz that a pure dipole nulls out.
 */
export const ARTIFACT_SOURCES: Record<string, SourceSpec> = {
  // Orbit measured off skin.bin, not estimated: scanning anterior surface depth over
  // the face finds a trough running x 0.15..0.45 at y ~= -0.66, with the brow rising
  // above it and the malar eminence below. Its ends are the medial canthus (1.4 cm
  // from midline) and the lateral orbital rim (4.3 cm) — both adult norms — so its
  // midpoint x = 0.30 is the pupil, 1.3 cm below the nasion (y = -0.540), and the ocular
  // sources keep that x. Their height and depth are NOT the pupil's: see HEIGHT below.
  //
  // Two co-fired terms per eye — see WHY THE BLINK NEEDS TWO SOURCES PER EYE above.
  //
  // The dipole is VERTICAL (dir [0,1,0]): the lid sweeps down and back up across the
  // cornea, and the resulting scalp field is strongest above the orbit and reverses
  // below it. Note this is the lid-sweep account, not Bell's globe rotation — a Bell's
  // rotation about the globe centre would tilt the dipole out of vertical. The fit is
  // shallow between about 70 and 90 degrees of tilt, so the observable cannot tell those
  // two mechanisms apart; vertical is chosen as the simpler of the pair. IK-001 lists
  // Bell's as explicitly non-binding for exactly this reason.
  //
  // The two terms take DIFFERENT extents. The monopole keeps 0.25, the principled
  // value for an EXTRACRANIAL source: its field reaches the scalp without crossing
  // the skull, so it does not get the skull-smearing width that neural sources do
  // (and must not track S.smearing if that is ever recalibrated). The dipole's gain peaks not at the source but at +/-sigma from it, so it
  // must be wider to reach the frontal electrodes at all; 0.675 is fitted.
  //
  // HEIGHT: the blink's EQUIVALENT source sits at the upper lid / brow (y = -0.44), 2.3 cm
  // above the pupil and just under the skin there (skin.bin surface z = 0.859 at x 0.30,
  // y -0.44; source at 0.84). It used to sit at the pupil (y -0.68, z 0.75), and there the
  // eye is almost as close to F7 (5.6 cm) as to Fp1 (4.8 cm): the blink field put F7 at
  // 0.57 of Fp1, so F7-T3 deflected 0.95 as far as Fp1-F7 and every blink on the temporal
  // chain looked like two stacked frontopolar blinks (reported by the user, 2026-09-14).
  // learningeeg's blink figures, read row by row at 4x (5 blinks on two records, 2026-09-14),
  // give F7-T3 / Fp1-F7 0.07-0.32 (median 0.14), and summed back from O1 a field of F7
  // 0.10-0.31, F3 0.25-0.33, T3 0.04-0.09, C3 0.06-0.10 of Fp1 — F7 no larger than F3.
  // No orientation, tilt or extent fits that at the pupil (best F7 0.37); raising the source
  // does, with every other parameter unchanged: F7 0.26, F3 0.30, T3 0.06, C3 0.10, Fz
  // 0.28, Cz 0.09, F7-T3 / Fp1-F7 0.28, Fp1-F7 / Fp1-F3 1.06. Physically this stands in
  // for what the homogeneous-sphere model leaves out — the lid is a conductor carrying the
  // corneal potential to the skin ABOVE the eye (Lins et al. 1993; Iwasaki et al. 2005:
  // lid movement, not eyeball rotation, dominates the blink potential), and the bony
  // lateral orbital rim and temporalis lie between the orbit and F7. So read the height as
  // a fitted equivalent position inside the periorbital skin, not as an anatomical claim.
  eyeL:        { id: 'eyeL',        pos: [ 0.30,-0.44, 0.84], orientation: { kind: 'tangential', dir: [0, 1, 0] }, extent: 0.58 },
  eyeR:        { id: 'eyeR',        pos: [-0.30,-0.44, 0.84], orientation: { kind: 'tangential', dir: [0, 1, 0] }, extent: 0.58 },
  eyeMonoL:    { id: 'eyeMonoL',    pos: [ 0.30,-0.44, 0.84], orientation: { kind: 'radial' }, extent: 0.25 },
  eyeMonoR:    { id: 'eyeMonoR',    pos: [-0.30,-0.44, 0.84], orientation: { kind: 'radial' }, extent: 0.25 },
  // Horizontal gaze is a left-right dipole: tangential, so F7 and F8 move in
  // opposite directions, which is the diagnostic feature of a lateral eye movement.
  // A horizontal rotation pivots about the globe CENTRE, ~1.3 cm behind the cornea.
  gaze:        { id: 'gaze',        pos: [ 0.00,-0.68, 0.61], orientation: { kind: 'tangential', dir: [-1, 0, 0] }, extent: 0.55 },
  temporalisL: { id: 'temporalisL', pos: [ 0.80, 0.10, 0.10], orientation: { kind: 'radial' }, extent: 0.30 },
  temporalisR: { id: 'temporalisR', pos: [-0.80, 0.10, 0.10], orientation: { kind: 'radial' }, extent: 0.30 },
  // Frontalis is the FOREHEAD muscle, spanning brow to hairline. It was at
  // y = +0.50, which is Fz's height (y = 0.5155) — the vertex, roughly 8 cm too
  // high, a leftover from the pre-mesh electrode frame. Anchored between the
  // nasion (y = -0.540, from build1020's mesh-derived fiducials) and Fp1/Fp2
  // (y = -0.222): y = -0.38 is mid-forehead, z = 0.90 just inside the skin.
  frontalis:   { id: 'frontalis',   pos: [ 0.00,-0.38, 0.90], orientation: { kind: 'radial' }, extent: 0.45 },
  // The heart is far enough away that its field across the scalp is broad and
  // shallow, with the mild lateralisation §8 notes. It sits left of midline.
  heart:       { id: 'heart',       pos: [ 0.55, -2.60, 0.20], orientation: { kind: 'radial' }, extent: 3.2 },
  // Sweat artifact is a skin-potential shift in frontal scalp skin, so it shares
  // the forehead with frontalis and was misplaced at the vertex the same way.
  // Slightly deeper and broader: it is a diffuse skin phenomenon, not a compact
  // muscle belly.
  sweatFrontal:{ id: 'sweatFrontal',pos: [ 0.00,-0.38, 0.86], orientation: { kind: 'radial' }, extent: 0.55 },
  // Posterior cervical (nuchal) muscles: behind and below the occipital
  // electrodes, which is why neck tone obscures the posterior dominant rhythm
  // and can mimic posterior sharp transients. Broad extent because the muscle
  // sheet is wide and bilateral, unlike the compact temporalis bellies.
  // These attach along the superior nuchal line, at and BELOW the inion, and run
  // down the neck — so the belly centre sits well below it. y = -0.35 put it
  // ABOVE the inion (Iz y = -0.446), i.e. on the occiput itself, which made neck
  // tone read as an occipital-electrode artifact rather than one arriving from
  // below. y = -0.80 is ~3.4 cm below the inion, z = -0.80 behind it.
  nuchal:      { id: 'nuchal',      pos: [ 0.00,-0.80,-0.80], orientation: { kind: 'radial' }, extent: 0.50 },
};

/**
 * How the ocular drive splits between the dipole term (`eyeL`/`eyeR`) and the monopole
 * term (`eyeMonoL`/`eyeMonoR`). Every source column is normalised to unit peak gain by
 * `buildLeadfield`, so the split has to be applied where the sources are driven rather
 * than baked into the specs. 0.4 is a fitted number, chosen against the published bifrontal
 * topography, not measured off the head mesh the way the orbit position was.
 */
export const OCULAR_DIPOLE_SHARE = 0.4;

/**
 * Minimum interval between consecutive blink onsets, seconds. Set to the longest
 * lid-deflection (0.40 s, see `next`) so two blinks can never overlap, and within
 * the physiological ~0.3-0.5 s spontaneous blink refractory period.
 */
const BLINK_REFRACTORY_SEC = 0.4;

/**
 * Lead time (s) to the FIRST event after an ocular toggle is switched on. Without
 * it the first blink/saccade/eye-opening is a full inter-event interval away
 * (seconds), so the toggle looks dead for a beat before anything happens. Making
 * the first event prompt is a UI-responsiveness fix; the ongoing event RATE — the
 * physiological quantity — is untouched. Shared by the three ocular event
 * generators below (mirrors `FIRST_EVENT_LEAD` for pattern sources in transient.ts).
 */
export const OCULAR_FIRST_EVENT_LEAD_SEC = 0.3;

/**
 * Inter-event timing jitter, as a fraction of the nominal interval, for the ocular
 * event generators. A pure exponential (Poisson) schedule has CV = 1: its most
 * likely gap is near-zero and long gaps are common, so events clump and skip
 * rather than tracking the set rate. A small symmetric jitter (interval =
 * mean·[1 ± FRAC]) keeps the long-run rate exactly at ratePerMin while making each
 * interval hug the nominal spacing — the artifact then "follows the rate".
 */
const OCULAR_JITTER_FRAC = 0.2;

/** Blink: a smooth monophasic lid-movement deflection, 200-400 ms (§8). */
export class BlinkGenerator {
  private g: Gaussian;
  private samplesToNext = 0;
  private elapsed = -1;
  private length = 0;
  private amp = 1;
  private enabled = false;
  active = false;

  constructor(seed: number, private dt: number, private ratePerMin = 16) {
    this.g = new Gaussian(seed);
  }
  /** Blink rate is clinically informative in itself — it rises with anxiety and falls with drowsiness. */
  setRatePerMin(r: number) { this.ratePerMin = r; }
  private schedule(rateScale: number) {
    const mean = 60 / Math.max(this.ratePerMin * rateScale, 0.5);
    // Low-variance schedule: symmetric jitter around the nominal interval keeps the
    // long-run rate at ratePerMin, floored at the refractory period so two blinks
    // can never start within one lid deflection (0.22-0.40 s) of each other and
    // render as a single jagged "double" — non-physiological, since the
    // orbicularis/levator cannot re-fire instantly (~0.3-0.5 s minimum gap).
    const interval = Math.max(
      BLINK_REFRACTORY_SEC,
      mean * (1 + (this.g.uniform() - 0.5) * 2 * OCULAR_JITTER_FRAC),
    );
    this.samplesToNext = Math.max(1, Math.round(interval / this.dt));
  }
  /**
   * Advance one sample. `enabled` is the blink toggle. On its rising edge the first
   * blink is scheduled promptly (OCULAR_FIRST_EVENT_LEAD_SEC) so the toggle has an
   * immediate visible effect; while disabled the generator is silent and does not
   * advance, so re-enabling restarts it cleanly. `rateScale` lets the vigilance
   * state modulate the rate (drowsiness lowers it, anxiety raises it).
   */
  next(enabled: boolean, rateScale = 1): number {
    if (!enabled) {
      this.enabled = false;
      this.elapsed = -1;
      this.active = false;
      return 0;
    }
    if (!this.enabled) {
      this.enabled = true;
      this.elapsed = -1;
      this.samplesToNext = Math.max(1, Math.round(OCULAR_FIRST_EVENT_LEAD_SEC / this.dt));
    }
    if (--this.samplesToNext <= 0) {
      this.elapsed = 0;
      this.length = Math.round(this.g.range(0.22, 0.40) / this.dt);
      this.amp = this.g.logNormal(1, 0.28);
      this.schedule(rateScale);
    }
    if (this.elapsed < 0) { this.active = false; return 0; }
    const u = this.elapsed / this.length;
    this.elapsed++;
    if (u >= 1) { this.elapsed = -1; this.active = false; return 0; }
    this.active = true;
    // Asymmetric lid movement: fast close, slower reopen.
    const shape = u < 0.35
      ? 0.5 - 0.5 * Math.cos((Math.PI * u) / 0.35)
      : 0.5 + 0.5 * Math.cos((Math.PI * (u - 0.35)) / 0.65);
    return this.amp * shape;
  }
}

/** Asymmetric lid-movement transient: fast onset, slower return, 0 -> 1 -> 0 over u in [0,1]. */
function lidShape(u: number): number {
  return u < 0.35
    ? 0.5 - 0.5 * Math.cos((Math.PI * u) / 0.35)
    : 0.5 + 0.5 * Math.cos((Math.PI * (u - 0.35)) / 0.65);
}

/**
 * Eye opening/closing maneuver: the slow ocular deflection when a patient opens
 * their eyes on command and closes them again a few seconds later (§8).
 *
 * The eye is a standing dipole with an electropositive cornea. On EYE OPENING
 * the lids retract and the globe settles from its resting/Bell's-elevated
 * position toward primary gaze, sweeping the positive cornea inferiorly — away
 * from Fp1/Fp2, which therefore go negative and render UPWARD on the negative-up
 * display. This is the mirror image of a blink (BlinkGenerator, IK-001), and
 * both slower and smaller. On EYE CLOSING the cornea sweeps back up toward Fp by
 * the same mechanism as a blink, a downward deflection. One maneuver is thus an
 * upward transient at opening, a baseline plateau while the eyes are held open
 * (the ocular DC potential re-baselines over ~1 s), and a smaller downward
 * transient at closing.
 */
export class EyeOpeningGenerator {
  private g: Gaussian;
  private samplesToNext = 0;
  private elapsed = -1;
  private length = 0;
  private openLen = 0;
  private closeLen = 0;
  private amp = 1;
  private enabled = false;
  /**
   * True from the start of the opening sweep until the closing sweep begins —
   * the interval in which the eyes are open. The engine blocks the posterior
   * alpha rhythm over it (IK-007): an eye-opening artifact with the PDR running
   * straight through it is the one picture reactivity says cannot happen.
   */
  isOpen = false;

  constructor(seed: number, private dt: number, private ratePerMin = 5) {
    this.g = new Gaussian(seed);
  }
  private schedule() {
    // Symmetric jitter around the nominal interval (low variance) keeps the
    // long-run maneuver rate at ratePerMin instead of the wide Poisson spread.
    const mean = 60 / Math.max(this.ratePerMin, 0.2);
    const interval = mean * (1 + (this.g.uniform() - 0.5) * 2 * OCULAR_JITTER_FRAC);
    this.samplesToNext = Math.max(1, Math.round(interval / this.dt));
  }
  next(enabled: boolean): number {
    if (!enabled) { this.enabled = false; this.elapsed = -1; this.isOpen = false; return 0; }
    if (!this.enabled) {
      this.enabled = true;
      this.elapsed = -1;
      this.samplesToNext = Math.max(1, Math.round(OCULAR_FIRST_EVENT_LEAD_SEC / this.dt));
    }
    if (--this.samplesToNext <= 0) {
      this.elapsed = 0;
      // Eyes are held open for a few seconds between opening and closing.
      this.length = Math.round(this.g.range(2.5, 4.5) / this.dt);
      // Lid retraction/settling is slower than a blink's snap-close (~0.2 s).
      this.openLen = Math.round(this.g.range(0.35, 0.55) / this.dt);
      this.closeLen = Math.round(this.g.range(0.35, 0.55) / this.dt);
      this.amp = this.g.logNormal(1, 0.25);
      this.schedule();
    }
    if (this.elapsed < 0) { this.isOpen = false; return 0; }
    const i = this.elapsed;
    this.elapsed++;
    if (i >= this.length) { this.elapsed = -1; this.isOpen = false; return 0; }
    const startClose = this.length - this.closeLen;
    this.isOpen = i < startClose;
    // Opening: upward -> negative transient at the start of the maneuver.
    if (i < this.openLen) return -this.amp * lidShape(i / this.openLen);
    // Closing: downward -> positive transient at the end, smaller than the open.
    if (i >= startClose) return 0.7 * this.amp * lidShape((i - startClose) / this.closeLen);
    // Eyes held open: baseline.
    return 0;
  }
}

/**
 * Saccade: a gaze step plus the brief extraocular spike potential at onset.
 * The spike is broadband and ~20 ms, and §4 notes it is a major contaminant of
 * apparent scalp gamma — so it must be present, or gamma-detection methods get
 * benchmarked on an unrealistically clean signal.
 */
export class SaccadeGenerator {
  private g: Gaussian;
  private samplesToNext = 0;
  private level = 0;
  private target = 0;
  private spikeLeft = 0;
  private spikeAmp = 0;
  private enabled = false;

  constructor(seed: number, private dt: number, private ratePerMin = 25) {
    this.g = new Gaussian(seed);
  }
  setRatePerMin(r: number) { this.ratePerMin = r; }
  private schedule(rateScale: number) {
    // Symmetric jitter around the nominal interval (low variance) keeps the
    // long-run saccade rate at ratePerMin instead of the wide Poisson spread.
    const mean = 60 / Math.max(this.ratePerMin * rateScale, 0.5);
    const interval = mean * (1 + (this.g.uniform() - 0.5) * 2 * OCULAR_JITTER_FRAC);
    this.samplesToNext = Math.max(1, Math.round(interval / this.dt));
  }
  next(enabled: boolean, rateScale = 1): number {
    if (!enabled) {
      // Reset gaze so re-enabling starts from primary position, not a stale angle.
      this.enabled = false;
      this.level = 0;
      this.target = 0;
      this.spikeLeft = 0;
      return 0;
    }
    if (!this.enabled) {
      this.enabled = true;
      this.samplesToNext = Math.max(1, Math.round(OCULAR_FIRST_EVENT_LEAD_SEC / this.dt));
    }
    if (--this.samplesToNext <= 0) {
      this.target = this.g.range(-1, 1);
      this.spikeLeft = Math.max(1, Math.round(0.02 / this.dt));
      this.spikeAmp = Math.sign(this.target - this.level) * this.g.logNormal(0.5, 0.3);
      this.schedule(rateScale);
    }
    // Gaze steps quickly to the new position and holds there.
    this.level += (this.target - this.level) * Math.min(1, 40 * this.dt);
    let v = this.level;
    if (this.spikeLeft > 0) {
      this.spikeLeft--;
      v += this.spikeAmp * (this.g.uniform() * 0.6 + 0.7);
    }
    return v;
  }
}

/**
 * EMG as shot noise: a sum of randomly-timed motor unit action potentials.
 *
 * This is the point of the exercise. Filtered white noise has EMG's bandwidth
 * but Gaussian statistics; real EMG is spiky and heavy-tailed (high kurtosis),
 * because it is a sparse sum of discrete transients. Methods that key off
 * non-Gaussianity — ICA above all — behave completely differently on the two.
 */
export class EmgGenerator {
  private g: Gaussian;
  private buf: Float64Array;
  private head = 0;
  private muap: Float64Array;
  private samplesToNext = 0;
  private scale = 1;

  constructor(seed: number, private dt: number, private rateHz = 90) {
    this.g = new Gaussian(seed);
    // A single motor unit action potential: brief, biphasic, ~6 ms.
    const n = Math.max(3, Math.round(0.006 / dt));
    this.muap = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      this.muap[i] = Math.sin(2 * Math.PI * u) * Math.exp(-3 * u);
    }
    this.buf = new Float64Array(Math.max(n * 4, 64));
    this.schedule(1);

    const warm = Math.ceil(10 / dt);
    for (let i = 0; i < warm; i++) this.next();
    let sq = 0;
    const m = Math.ceil(30 / dt);
    for (let i = 0; i < m; i++) { const v = this.next(); sq += v * v; }
    const rms = Math.sqrt(sq / m);
    this.scale = rms > 0 ? 1 / rms : 1;
  }
  private schedule(rateScale: number) {
    const mean = 1 / Math.max(this.rateHz * rateScale, 1);
    this.samplesToNext = Math.max(1, Math.round(this.g.exponential(mean) / this.dt));
  }
  next(rateScale = 1): number {
    if (--this.samplesToNext <= 0) {
      const amp = this.g.logNormal(1, 0.7) * (this.g.uniform() < 0.5 ? -1 : 1);
      for (let i = 0; i < this.muap.length; i++) {
        this.buf[(this.head + i) % this.buf.length] += amp * this.muap[i];
      }
      this.schedule(rateScale);
    }
    const v = this.buf[this.head];
    this.buf[this.head] = 0;
    this.head = (this.head + 1) % this.buf.length;
    return v * this.scale;
  }
}

/** ECG: a QRS template on a heart-rate-variable R-peak train (§8). */
export class EcgGenerator {
  private g: Gaussian;
  private phase = 0;
  private interval: number;

  constructor(seed: number, private dt: number, private bpm = 68) {
    this.g = new Gaussian(seed);
    this.interval = 60 / bpm;
  }
  /**
   * Change the heart rate. The current beat runs to completion first — a rate
   * change takes effect from the next R wave, as it does physiologically.
   */
  setBpm(bpm: number) { this.bpm = bpm; }
  next(): number {
    this.phase += this.dt;
    if (this.phase >= this.interval) {
      this.phase -= this.interval;
      // Heart-rate variability: a fixed interval reads as a metronome and is one
      // of the easier tells in a long record.
      this.interval = (60 / this.bpm) * (1 + 0.06 * this.g.next());
    }
    const u = this.phase / this.interval;
    const gauss = (mu: number, s: number) => Math.exp(-((u - mu) ** 2) / (2 * s * s));
    return (
      0.10 * gauss(0.16, 0.026) -
      0.13 * gauss(0.256, 0.010) +
      1.00 * gauss(0.284, 0.011) -
      0.22 * gauss(0.315, 0.012) +
      0.28 * gauss(0.50, 0.045)
    );
  }
}

/**
 * Electrode pop: a rare step followed by exponential recovery, confined to a
 * single channel. Its spatial discontinuity is the teaching point — no
 * anatomical source means no smooth decay to neighbours, which is how a reader
 * tells a bad electrode from a real generator at a glance.
 */
export class ElectrodePopGenerator {
  private g: Gaussian;
  private samplesToNext = 0;
  private level = 0;
  private decay: number;
  /** Index of the channel currently affected, or -1. */
  channel = -1;
  /** Electrode index pops are confined to, or -1 for "any electrode". */
  private target = -1;

  constructor(seed: number, private dt: number, private nChannels: number, private meanInterval = 45) {
    this.g = new Gaussian(seed);
    this.decay = Math.exp(-dt / 0.35);
    this.schedule();
  }
  /**
   * Toggle-on edge: bring the next automatic pop forward to `leadSec`. The renewal
   * interval (45 s mean) is right for how rare pops are, but it meant a learner who
   * switched the toggle on usually waited most of a minute to see one. Only the wait
   * for the first pop is shortened; later pops keep the renewal schedule.
   */
  startSoon(leadSec: number) {
    if (isFinite(this.meanInterval)) this.samplesToNext = Math.max(1, Math.round(leadSec / this.dt));
  }
  /** Confine pops to one electrode (teaching a single bad lead) or -1 for any. */
  setTarget(ch: number) { this.target = ch; }
  /** A non-positive interval turns AUTOMATIC popping off; a decaying pop still rings out. */
  setMeanInterval(sec: number) {
    const wasOff = !isFinite(this.meanInterval);
    if (!(sec > 0) || !isFinite(sec)) { this.meanInterval = Infinity; this.samplesToNext = Infinity; return; }
    this.meanInterval = Math.max(0.5, sec);
    if (wasOff) this.schedule(); // re-arm after having been off
  }
  /**
   * Fire a pop right now, outside the renewal schedule (`ch < 0` -> a random
   * electrode). Used when the user deliberately breaks an electrode's contact —
   * the pop *is* the moment the junction fails — or presses the manual Pop button,
   * so it must be a definite event rather than something to wait for.
   */
  trigger(ch: number) {
    this.channel = ch >= 0 ? ch : Math.floor(this.g.uniform() * this.nChannels);
    this.level = this.g.logNormal(1.3, 0.3) * (this.g.uniform() < 0.5 ? -1 : 1);
    this.decay = Math.exp(-this.dt / this.g.range(0.25, 0.5));
  }
  private schedule() {
    if (!isFinite(this.meanInterval)) { this.samplesToNext = Infinity; return; }
    this.samplesToNext = Math.max(1, Math.round(this.g.exponential(this.meanInterval) / this.dt));
  }
  next(): number {
    if (--this.samplesToNext <= 0) {
      this.channel = this.target >= 0 ? this.target : Math.floor(this.g.uniform() * this.nChannels);
      this.level = this.g.logNormal(1, 0.5) * (this.g.uniform() < 0.5 ? -1 : 1);
      this.decay = Math.exp(-this.dt / this.g.range(0.15, 0.6));
      this.schedule();
    }
    this.level *= this.decay;
    if (Math.abs(this.level) < 1e-4) this.channel = -1;
    return this.level;
  }
}

/** Sweat: a very-low-frequency random walk producing large rolling drift (§8). */
export class SweatGenerator {
  private g: Gaussian;
  private x = 0;
  private a: number;
  constructor(seed: number, dt: number, tau = 12) {
    this.g = new Gaussian(seed);
    this.a = Math.exp(-dt / tau);
  }
  next(): number {
    this.x = this.a * this.x + (1 - this.a) * this.g.next() * 6;
    return this.x;
  }
}

/**
 * Mains interference. §8 is explicit that this is "not a perfect sinusoid":
 * supply frequency wanders slightly, amplitude drifts, and there is mild
 * harmonic content. A pure tone is trivially notch-filtered and teaches nothing
 * about how line noise actually looks on a record.
 */
export class LineNoiseGenerator {
  private g: Gaussian;
  private phase = 0;
  private freqState = 0;
  private ampState = 0;
  private aF: number;
  private aA: number;

  constructor(seed: number, private dt: number, private baseFreq = 50) {
    this.g = new Gaussian(seed);
    this.aF = Math.exp(-dt / 8);
    this.aA = Math.exp(-dt / 4);
  }
  /** 50 Hz across most of the world, 60 Hz in the Americas — the reader has to recognise both. */
  setFreq(hz: number) { this.baseFreq = hz; }
  next(): number {
    this.freqState = this.aF * this.freqState + Math.sqrt(1 - this.aF * this.aF) * this.g.next();
    this.ampState = this.aA * this.ampState + Math.sqrt(1 - this.aA * this.aA) * this.g.next();
    const f = this.baseFreq + 0.05 * this.freqState;
    this.phase += 2 * Math.PI * f * this.dt;
    if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
    const amp = 1 + 0.08 * this.ampState;
    return amp * (Math.sin(this.phase) + 0.12 * Math.sin(2 * this.phase) + 0.05 * Math.sin(3 * this.phase));
  }
}

/** Movement: rare, very large, broadband multi-channel transients (§8). */
export class MovementGenerator {
  private g: Gaussian;
  private samplesToNext = 0;
  private left = 0;
  private amp = 0;
  private len = 1;

  constructor(seed: number, private dt: number, private meanInterval = 70) {
    this.g = new Gaussian(seed);
    this.schedule();
  }
  setMeanInterval(sec: number) { this.meanInterval = Math.max(1, sec); }
  /** Toggle-on edge: first movement after `leadSec` instead of a 70-90 s mean wait (see ElectrodePopGenerator.startSoon). */
  startSoon(leadSec: number) { this.samplesToNext = Math.max(1, Math.round(leadSec / this.dt)); }
  private schedule() {
    this.samplesToNext = Math.max(1, Math.round(this.g.exponential(this.meanInterval) / this.dt));
  }
  next(): number {
    if (--this.samplesToNext <= 0) {
      this.len = Math.max(2, Math.round(this.g.range(0.2, 0.9) / this.dt));
      this.left = this.len;
      this.amp = this.g.logNormal(1, 0.5);
      this.schedule();
    }
    if (this.left <= 0) return 0;
    const u = (this.len - this.left) / this.len;
    this.left--;
    const env = Math.sin(Math.PI * u);
    return this.amp * env * this.g.next();
  }
}

export function artifactSeeds(seed: number) {
  return {
    blink: deriveSeed(seed, 'blink'),
    eyeOpening: deriveSeed(seed, 'eyeOpening'),
    saccade: deriveSeed(seed, 'saccade'),
    emgL: deriveSeed(seed, 'emgL'),
    emgR: deriveSeed(seed, 'emgR'),
    emgF: deriveSeed(seed, 'emgF'),
    emgN: deriveSeed(seed, 'emgN'),
    pop: deriveSeed(seed, 'pop'),
    sweat: deriveSeed(seed, 'sweat'),
    line: deriveSeed(seed, 'line'),
    movement: deriveSeed(seed, 'movement'),
  };
}

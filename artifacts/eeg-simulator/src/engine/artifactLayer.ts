/**
 * The engine's own artifact layer (§8): eye blink, eye opening, lateral gaze and
 * its lateral rectus spike, eye flutter, muscle, ECG on the scalp, sweat, movement,
 * mains, electrode pop and bad or detached electrodes — their generators, their
 * per-toggle gates and settings, and the marks that annotate them.
 *
 * These are not `PatternSourceDescriptor`s (sources/registry.ts), and the
 * difference is structural, not historical: a descriptor is one generator writing
 * one scalar into one leadfield column, enabled by its toggle. Artifacts here drive
 * several columns at once (a blink is a dipole and a monopole at each eye), take
 * their rates from vigilance, are switched by `ArtifactGates` rather than the
 * toggle set, and two of them do not go through the leadfield at all (a pop is on
 * one channel; mains enters in the amplifier). Artifacts that do fit the
 * descriptor contract — chewing, glossokinetic — are descriptors
 * (sources/artifactsPatterns.ts).
 *
 * The engine owns the leadfield and the sample loop; it calls `addSources` while
 * it fills the source vector, `addPop` after projecting it to the electrodes, and
 * `tickDetach` before the recording chain.
 */

import {
  OCULAR_DIPOLE_SHARE, OCULAR_FIRST_EVENT_LEAD_SEC, BlinkGenerator, EyeOpeningGenerator, SaccadeGenerator,
  EmgGenerator, EcgGenerator, EyeFlutterGenerator, FLUTTER_SHARE, FLUTTER_TAIL_S, LRS_PEAK_UV, LRS_SPIKE_S,
  ElectrodePopGenerator, SweatGenerator, SWEAT_SKIN_UV, ECG_SCALP_UV, LineNoiseGenerator, MovementGenerator,
  artifactSeeds,
} from './artifacts';
import { defectLineMultiplier, type ChannelDefect, type RecordingChain } from './chain';
import { deriveSeed } from './rng';
import type { VigilanceGains } from './state';
import type { SubjectParams } from './subject';
import { NO_FIELDS, type MarkBook, type MarkFields } from './marks';
import type { ArtifactParams, EmgRegion, PatientState } from '../utils/simTypes';
import { POP_TARGET_ANY } from '../utils/simTypes';

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
  /** Lateral gaze / saccade deflection and the lateral rectus spike that leads it. */
  saccade: boolean;
  /** Eye flutter: runs of rapid lid movements on the blink's sources. Off unless asked for. */
  flutter: boolean;
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

// Orbicularis oculi EMG during a blink, microvolts of shot noise (RMS) at each orbit
// at full envelope (owner, 2026-11-16: "a very slight muscle artifact" with each
// blink, "more subtle than the actual muscle EEG artifact"). Set so a blink's EMG at
// Fp1-F3, 25-70 Hz, is a small fraction of the muscle toggle's there (gate: 'blink
// EMG / muscle EMG'); no source gives a microvolt figure.
const BLINK_EMG_UV = 9;
// Ocular drive for a blink, microvolts at the ocular sources before the leadfield. Eye
// opening uses half of it (addSources()).
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

type LayerOptions = {
  seed: number;
  dt: number;
  subject: SubjectParams;
  electrodes: string[];
  /** Leadfield column of each artifact source (ARTIFACT_SOURCES keys); empty when artifacts are off. */
  artifactIndex: Record<string, number>;
  /** Whether the artifact generators exist (the engine's `artifacts` option). */
  artifacts: boolean;
  chain: RecordingChain | null;
  defects: ChannelDefect[];
  /** The one heart; its rate is an artifact setting (ecgBpm). */
  ecg: EcgGenerator;
  /** The scalp field of weighted leadfield columns (EegEngine.fieldOf). */
  fieldOf: (sources: [index: number, weight: number][]) => Record<string, number>;
  /** One unit field per electrode, for a mark on a single channel. */
  electrodeFields: MarkFields[];
  marks: MarkBook;
};

export class ArtifactLayer {
  private readonly dt: number;
  private readonly subject: SubjectParams;
  private readonly electrodes: string[];
  private readonly ix: Record<string, number>;
  private readonly chain: RecordingChain | null;
  private readonly defects: ChannelDefect[];
  private readonly ecg: EcgGenerator;
  private readonly fieldOf: LayerOptions['fieldOf'];
  private readonly marks: MarkBook;

  private blink: BlinkGenerator | null = null;
  private eyeOpening: EyeOpeningGenerator | null = null;
  private saccade: SaccadeGenerator | null = null;
  private flutter: EyeFlutterGenerator | null = null;
  private emgL: EmgGenerator | null = null;
  private emgR: EmgGenerator | null = null;
  private emgF: EmgGenerator | null = null;
  private emgN: EmgGenerator | null = null;
  /** Orbicularis oculi EMG, enveloped by each blink (BlinkGenerator.emgEnvelope). */
  private emgBlink: EmgGenerator | null = null;
  private pop: ElectrodePopGenerator | null = null;
  private sweat: SweatGenerator | null = null;
  private line: LineNoiseGenerator | null = null;
  private movement: MovementGenerator | null = null;

  // Defaults for a standalone engine (validation, scripts). The app never relies on
  // them: SimulationSource sets every gate from the toggles on every sample.
  // `eyeOpening` defaults OFF: it is a command maneuver ("open your eyes ... close
  // them"), not background, and since eye opening blocks the PDR (IK-007) leaving it on
  // held a "resting" record's eyes open ~45% of the time. Public because the engine's
  // warm-up runs with every gate off and then restores these.
  gates: ArtifactGates = {
    blink: true, eyeOpening: false, saccade: true, flutter: false, emg: true, pop: true, defects: true,
    sweat: true, line: true, ecgScalp: true, movement: true,
  };
  // Whether setGates has been called yet (see there).
  private gatesSet = false;

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
  /** Last-seen manual-pop counter; a change fires one pop (see setParams). */
  private lastManualPopNonce = 0;

  private prevSaccadeV = 0;
  private prevPopV = 0;
  // Each artifact's fields (see ArtifactMark), built once from the leadfield.
  private markField: Record<'ocular' | 'gaze' | 'lrsL' | 'lrsR' | 'heart' | 'sweat' | 'defects', MarkFields> & { pop: MarkFields[] } =
    { ocular: [], gaze: [], lrsL: [], lrsR: [], heart: [], sweat: [], defects: [], pop: [] };
  private hasDefects = false;
  // null, not undefined: `undefined` is a value the region list can take (all four).
  private muscleFieldRegions: unknown = null;
  private muscleFieldCache: MarkFields = [];
  private lineCoupling: Record<string, number> = {};
  private lineFieldAmp = NaN;
  private lineFieldCache: MarkFields = [];
  private lineFieldDefects = false;

  constructor(o: LayerOptions) {
    this.dt = o.dt;
    this.subject = o.subject;
    this.electrodes = o.electrodes;
    this.ix = o.artifactIndex;
    this.chain = o.chain;
    this.defects = o.defects;
    this.ecg = o.ecg;
    this.fieldOf = o.fieldOf;
    this.marks = o.marks;
    const S = this.subject;

    if (o.artifacts) {
      const A = artifactSeeds(o.seed);
      const b = S.artifactBurden;
      this.blink = new BlinkGenerator(A.blink, this.dt, 16 * b);
      this.eyeOpening = new EyeOpeningGenerator(A.eyeOpening, this.dt, 5 * b);
      this.saccade = new SaccadeGenerator(A.saccade, this.dt, 25 * b);
      this.flutter = new EyeFlutterGenerator(A.flutter, this.dt);
      this.emgL = new EmgGenerator(A.emgL, this.dt);
      this.emgR = new EmgGenerator(A.emgR, this.dt);
      this.emgF = new EmgGenerator(A.emgF, this.dt);
      this.emgN = new EmgGenerator(A.emgN, this.dt);
      this.emgBlink = new EmgGenerator(deriveSeed(o.seed, 'emgBlink'), this.dt);
      this.pop = new ElectrodePopGenerator(A.pop, this.dt, this.electrodes.length, 60 / b);
      this.sweat = new SweatGenerator(A.sweat, this.dt);
      this.line = new LineNoiseGenerator(A.line, this.dt, S.lineFreq);
      this.movement = new MovementGenerator(A.movement, this.dt, 90 / b);
    }

    // What each artifact looks like across the head, for the annotation arrows.
    const perElectrode = (at: (c: number) => number): Record<string, number> =>
      Object.fromEntries(this.electrodes.map((e, c) => [e, at(c)]));
    const ix = this.ix;
    if (ix.eyeL != null) {
      const d = OCULAR_DIPOLE_SHARE, m = 1 - OCULAR_DIPOLE_SHARE;
      // The two eyes move together, so the ocular sources make one field.
      this.markField.ocular = [this.fieldOf([[ix.eyeL, d], [ix.eyeR, d], [ix.eyeMonoL, m], [ix.eyeMonoR, m]])];
      this.markField.gaze = [this.fieldOf([[ix.gaze, 1]])];
      this.markField.lrsL = [this.fieldOf([[ix.lateralRectusL, LRS_PEAK_UV]])];
      this.markField.lrsR = [this.fieldOf([[ix.lateralRectusR, LRS_PEAK_UV]])];
      // In microvolts at the R wave, where the generator's own output is 1.
      this.markField.heart = [this.fieldOf([[ix.heart, ECG_SCALP_UV]])];
      this.markField.sweat = [this.fieldOf([[ix.sweatFrontal, 1]])];
    }
    this.markField.pop = o.electrodeFields;
    const defective = (c: number) => this.defects[c] != null && this.defects[c].kind !== 'ok';
    this.hasDefects = this.electrodes.some((_, c) => defective(c));
    // Each bad contact is its own part: their noise is independent, so on a row
    // between two of them it adds rather than cancels (subject 3: T5 and A1, whose
    // shared row T5-A1 is the worst on the page and was the one left unboxed when
    // the two were one field, 2026-10-23 audit).
    this.markField.defects = this.electrodes.flatMap((_, c) => (defective(c) ? [perElectrode(k => (k === c ? 1 : 0))] : []));
    // Mains is the same waveform on every electrode, each picking up a little more
    // or less of it; what reaches a row is the difference between its two.
    this.lineCoupling = perElectrode(c => this.chain?.lineCouplingAt(c) ?? 1);
  }

  /** Whether a blink is under way (GroundTruth.blinking). */
  get blinking(): boolean { return this.blink?.active ?? false; }
  /** Whether the eye-opening manoeuvre has the eyes open now (it blocks the PDR, IK-007). */
  get manoeuvreEyesOpen(): boolean { return this.eyeOpening?.isOpen ?? false; }
  /** The channel a pop is on, or -1 (GroundTruth.popChannel). */
  get popChannel(): number { return this.pop?.channel ?? -1; }
  /** Mains amplitude now, microvolts, for the recording chain. */
  get lineAmp(): number { return this.aparams.lineAmpUv ?? this.subject.lineAmp; }

  /**
   * Add this sample's artifact sources into the source vector `V`, and report their
   * marks when `marking`. Returns the mains value for the recording chain.
   */
  addSources(V: Float64Array, gains: VigilanceGains, state: PatientState, ecgRaw: number, marking: boolean): number {
    if (!this.blink) return 0;
    let lineVal = 0;
    const ix = this.ix;
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
    // The orbicularis contraction behind the blink, at the orbits (the ocular
    // monopoles' radial patches) and gated with it. Its shot noise runs every
    // sample so its statistics never restart; the envelope is 0 between blinks.
    const blinkEmgV = this.emgBlink!.next() * BLINK_EMG_UV * this.blink.emgEnvelope;
    V[ix.eyeMonoL] += blinkEmgV; V[ix.eyeMonoR] += blinkEmgV;
    // Eye opening rides the same ocular sources as the blink but at half the
    // amplitude and opposite sign on opening (see EyeOpeningGenerator): opening
    // drives Fp negative -> upward, closing a smaller downward transient.
    const openV = this.eyeOpening!.next(g.eyeOpening) * BLINK_DRIVE_UV / 2;
    eyes(openV);
    const saccadeV = this.saccade!.next(g.saccade, gains.ocularRate) * 45;
    V[ix.gaze] += saccadeV;
    V[ix.lateralRectusL] += this.saccade!.lrsL * LRS_PEAK_UV;
    V[ix.lateralRectusR] += this.saccade!.lrsR * LRS_PEAK_UV;
    // Eye flutter rides the blink's sources, a share of a blink's sweep per lid cycle.
    eyes(this.flutter!.next(g.flutter) * BLINK_DRIVE_UV * FLUTTER_SHARE);
    // Which muscles are tense is a separate question from how hard they are
    // contracting, so region selection and severity are separate controls.
    const emgSev = p.emgSeverity ?? 1;
    const regions = p.emgRegions;
    const on = (r: EmgRegion) => regions == null || regions.includes(r);
    const atonia = STATE_EMG_SCALE[state];
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
    const heartV = ecgRaw * ECG_SCALP_UV;
    if (g.ecgScalp) V[ix.heart] += heartV;
    const sweatV = this.sweat!.next() * SWEAT_SKIN_UV * (p.sweatSeverity ?? 1);
    if (g.sweat) V[ix.sweatFrontal] += sweatV;
    const mv = this.movement!.next() * 60 * (p.movementSeverity ?? 1);
    if (g.movement) eyes(mv);
    const lineRaw = this.line!.next();
    lineVal = g.line ? lineRaw : 0;

    if (marking) {
      const F = this.markField;
      const M = this.marks;
      M.mark('blink', this.blink.active, F.ocular, 0.45);
      // One maneuver, two transients: opening is the negative one, closing the positive.
      M.mark('eye-opening', openV < 0, F.ocular, 0.55, { label: 'Eye opening' });
      M.mark('eye-closing', openV > 0, F.ocular, 0.55, { label: 'Eye closing' });
      // A gaze step: the level is moving. Steps too small to see (under ~6 uV) are not marked.
      M.mark('eye-movement', g.saccade && Math.abs(saccadeV - this.prevSaccadeV) > 0.9, F.gaze, 0.25, { minGapS: 0.5 });
      this.prevSaccadeV = saccadeV;
      // The lateral rectus spike that leads each movement, on its own side's rows.
      const lrs = this.saccade!.lrsStarted;
      if (lrs !== 0) M.push({ id: 'eye-movement', label: 'LRS', fields: lrs < 0 ? F.lrsL : F.lrsR, inUv: true, dur: LRS_SPIKE_S });
      // A run of eye flutter: one box over the whole run, from its first lid cycle, and
      // the filter's recovery after it (FLUTTER_TAIL_S).
      if (this.flutter!.runStarted > 0) M.push({ id: 'eye-flutter', fields: F.ocular, dur: 0, span: this.flutter!.runStarted + FLUTTER_TAIL_S });
      M.mark('movement', g.movement && mv !== 0, F.ocular, 0.9);
      // Every beat, at the upstroke of its R wave.
      M.mark('ecg-artifact', g.ecgScalp && ecgRaw > 0.5, F.heart, 0.08, { inUv: true });
      // Not in REM: atonia leaves no muscle on the page to point at.
      // A continuous artifact has no events, only a presence: one box for as long as
      // it lasts. Until 2026-10-23 each was pointed at every 1.5 s, which left the
      // muscle burst or the drift between two arrows unannotated (owner: "whatever is
      // present in the signals should be by design").
      M.markWhile('muscle', g.emg && atonia > 0.5 && emgSev > 0, this.muscleField(regions));
      M.markWhile('sweat', g.sweat, F.sweat);
      M.markWhile('50hz', g.line, this.lineField(), { inUv: true });
      M.markWhile('bad-electrodes', g.defects && this.hasDefects, F.defects);
      // Between its two arrows, the eyes are open and the alpha rhythm is blocked
      // everywhere: that stretch is part of the manoeuvre, so it is boxed too.
      M.markWhile('eye-opening', g.eyeOpening && this.eyeOpening!.isOpen, NO_FIELDS, { page: true, label: 'Eyes open' });
    }
    return lineVal;
  }

  /**
   * Electrode pop bypasses the leadfield entirely: it has no anatomical source,
   * so it must stay confined to one channel and spatially discontinuous (§8,
   * and the teaching point that this is how artifact is told from generator).
   */
  addPop(out: Float64Array, marking: boolean) {
    if (!this.pop) return;
    const popV = this.pop.next() * 220;
    const c = this.pop.channel;
    if (this.gates.pop && c >= 0 && c < out.length) out[c] += popV;
    if (marking) {
      // A pop only ever decays, so a level that has grown is a new pop.
      const fresh = this.gates.pop && c >= 0 && c < out.length && Math.abs(popV) > Math.abs(this.prevPopV) + 1;
      this.marks.mark('electrode-pop', fresh, this.markField.pop[fresh ? c : 0], 0.3);
      this.prevPopV = popV;
    }
  }

  /**
   * A detached electrode does not go dead the instant the pop starts: the pop
   * IS the contact failing, and it rings for a few hundred milliseconds
   * afterwards. Only once it has decayed does the channel fall to the noise
   * floor, which is what `ChannelDefect.flat` models.
   */
  tickDetach() {
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
  }

  /**
   * Muscle's fields for the muscles now contracting, each at the amplitude the
   * artifact block gives it. The four are independent sources (see ArtifactMark).
   */
  private muscleField(regions: EmgRegion[] | undefined): MarkFields {
    if (regions === this.muscleFieldRegions) return this.muscleFieldCache;
    const ix = this.ix;
    const parts: [EmgRegion, number][] = [['temporalisL', 9], ['temporalisR', 9], ['frontalis', 6], ['nuchal', 8]];
    this.muscleFieldCache = parts.filter(([r]) => regions == null || regions.includes(r))
      .map(([r, amp]) => this.fieldOf([[ix[r], amp]]));
    this.muscleFieldRegions = regions;
    return this.muscleFieldCache;
  }

  /**
   * Mains at each electrode, in microvolts, at the amplitude now set — with each bad
   * contact's extra pickup while Bad Electrodes is on (chain.ts), so the box is on the
   * electrode carrying the most of it. It used to leave that one out (2026-10-23 audit).
   */
  private lineField(): MarkFields {
    const amp = this.lineAmp;
    const withDefects = this.gates.defects;
    if (amp !== this.lineFieldAmp || withDefects !== this.lineFieldDefects) {
      this.lineFieldCache = [Object.fromEntries(this.electrodes.map((e, c) =>
        [e, this.lineCoupling[e] * amp * (withDefects && this.defects[c] ? defectLineMultiplier(this.defects[c]) : 1)]))];
      this.lineFieldAmp = amp;
      this.lineFieldDefects = withDefects;
    }
    return this.lineFieldCache;
  }

  setGates(gates: Partial<ArtifactGates>) {
    const hadDefects = this.gates.defects;
    // The gates start all on, so the first call is when a toggle is really switched on:
    // an engine made with Electrode Pop already on (renderTrace, the audits) otherwise
    // waited up to a minute for its first pop (2026-10-23 audit).
    const first = !this.gatesSet;
    this.gatesSet = true;
    const hadPop = this.gates.pop && !first, hadMovement = this.gates.movement && !first;
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

  /** See EegEngine.setArtifactParams. */
  setParams(params: Partial<ArtifactParams>) {
    if (params === this.lastAparams) return;
    this.lastAparams = params;
    Object.assign(this.aparams, params);
    const p = this.aparams;
    const indexOf = (name: string) => this.electrodes.indexOf(name);

    if (p.blinkRatePerMin != null) this.blink?.setRatePerMin(p.blinkRatePerMin);
    if (p.saccadeRatePerMin != null) this.saccade?.setRatePerMin(p.saccadeRatePerMin);
    if (p.popRatePerMin != null) this.pop?.setMeanInterval(p.popRatePerMin > 0 ? 60 / p.popRatePerMin : Infinity);
    if (p.movementRatePerMin != null) this.movement?.setMeanInterval(60 / Math.max(p.movementRatePerMin, 0.05));
    if (p.lineFreq != null) this.line?.setFreq(p.lineFreq);
    if (p.ecgBpm != null) this.ecg.setBpm(p.ecgBpm);
    if (p.popTarget != null) {
      this.pop?.setTarget(p.popTarget === POP_TARGET_ANY ? -1 : indexOf(p.popTarget));
    }

    // Manual "Pop" button: a discrete event, delivered as a rising counter (a pop
    // is a moment, not a state). Fire one pop on the selected electrode — or a
    // random one when "any" is selected (trigger(-1)) — each time it increases.
    if (p.manualPopNonce != null && p.manualPopNonce !== this.lastManualPopNonce) {
      this.lastManualPopNonce = p.manualPopNonce;
      const ch = !p.popTarget || p.popTarget === POP_TARGET_ANY ? -1 : indexOf(p.popTarget);
      this.pop?.trigger(ch);
    }

    // Detachment is declarative: this list is the set of electrodes currently
    // off. Entering the list breaks contact (pop, then flat); leaving it is the
    // technologist re-gelling the electrode, which restores whatever contact
    // quality this subject's electrode had to begin with.
    if (p.detachedElectrodes != null) {
      const want = new Set<number>();
      for (const name of p.detachedElectrodes) {
        const c = indexOf(name);
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
}

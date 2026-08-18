import { ChannelGroup } from './montages';
import { PATTERN_CATEGORIES } from './patterns';

export type AnnotationDef = {
  patternId: string;
  /**
   * One-line "what to look for" cue drawn live over the trace while the pattern
   * is active. Kept short (one legible line) and derived from the pattern's
   * vetted `desc` in patterns.ts — it must not assert anything the description
   * does not. Where a direction of deflection or a set of channels is well
   * defined, it is named in the text ("downward at Fp1/Fp2", "T3") rather than
   * in a separate arrow, so the cue carries its own localisation.
   */
  text: string;
  /**
   * The region the cue is about. Only used to order the on-screen stack top-to-
   * bottom the way the montage rows run, so a cue sits near the trace it
   * describes; `all` for generalised/diffuse patterns.
   */
  targetRegion: ChannelGroup | 'all';
};

/**
 * Educational cue for every clinical pattern the simulator can generate — the
 * annotation overlay is universal, not a handful of special cases. Each entry is
 * a compressed restatement of the corresponding `desc` in `patterns.ts`; when a
 * description changes, its cue should be re-checked against it.
 */
export const EDUCATIONAL_ANNOTATIONS: Record<string, AnnotationDef> = {
  // ── Sleep architecture ──────────────────────────────────────────────────
  'posts':      { patternId: 'posts',      targetRegion: 'all',            text: 'POSTS: downward occipital (O1/O2) checkmarks, N1' },
  'v-waves':    { patternId: 'v-waves',    targetRegion: 'central',        text: 'Vertex wave: sharp Cz-maximal transient (N2)' },
  'k-complex':  { patternId: 'k-complex',  targetRegion: 'central',        text: 'K-complex: sharp + slow after-wave, Fz/Cz/Pz' },
  'spindles':   { patternId: 'spindles',   targetRegion: 'central',        text: 'Spindle: 12–15 Hz waxing burst, central-maximal' },

  // ── Benign variants ─────────────────────────────────────────────────────
  'mu-rhythm':  { patternId: 'mu-rhythm',  targetRegion: 'central',        text: 'Mu: arciform 8–12 Hz at C3/C4; blocks with hand movement' },
  'wicket':     { patternId: 'wicket',     targetRegion: 'left-temporal',  text: 'Wicket: temporal 6–11 Hz arches, NO following slow wave' },
  'rmtd':       { patternId: 'rmtd',       targetRegion: 'left-temporal',  text: 'RMTD: rhythmic 4–7 Hz theta runs at T3/T4 (drowsy)' },
  'lambda':     { patternId: 'lambda',     targetRegion: 'all',            text: 'Lambda: downward occipital sharps while visually scanning' },
  'pswy':       { patternId: 'pswy',       targetRegion: 'left-paramedian', text: 'PSWY: posterior 2.5–4.5 Hz slow waves fused with alpha' },
  '6hz-sw':     { patternId: '6hz-sw',     targetRegion: 'all',            text: '6 Hz phantom spike-wave: brief, low-amplitude, generalised' },
  '14-6-pos':   { patternId: '14-6-pos',   targetRegion: 'right-temporal', text: '14 & 6 Hz positive bursts, posterior-temporal (light sleep)' },
  'bets':       { patternId: 'bets',       targetRegion: 'left-temporal',  text: 'BETS: tiny (<50 ms) temporal spikes, no slow wave' },
  'eyes-open':  { patternId: 'eyes-open',  targetRegion: 'all',            text: 'Eyes open: posterior alpha attenuates (Berger effect)' },

  // ── Artifacts ───────────────────────────────────────────────────────────
  'blink':        { patternId: 'blink',        targetRegion: 'all',          text: 'Blink: large downward deflection at Fp1/Fp2 (~200 ms)' },
  'eye-movement': { patternId: 'eye-movement', targetRegion: 'all',          text: 'Lateral gaze: opposite-polarity deflection at F7 vs F8' },
  'eye-opening':  { patternId: 'eye-opening',  targetRegion: 'all',          text: 'Eye opening: upward frontopolar sweep (mirror of a blink)' },
  'muscle':       { patternId: 'muscle',       targetRegion: 'all',          text: 'Muscle: high-frequency fuzz over the contracting muscle' },
  'chewing':      { patternId: 'chewing',      targetRegion: 'left-temporal', text: 'Chewing: rhythmic 1–2 Hz temporal bursts (masseter)' },
  'electrode-pop':{ patternId: 'electrode-pop', targetRegion: 'all',         text: 'Pop: abrupt step + decay at ONE electrode, no field to neighbours' },
  'sweat':        { patternId: 'sweat',        targetRegion: 'all',          text: 'Sweat: very slow (<0.5 Hz) frontal baseline drift' },
  'ecg-artifact': { patternId: 'ecg-artifact', targetRegion: 'all',          text: 'ECG: regular QRS ~1 Hz; line it up against the ECG trace' },
  'movement':     { patternId: 'movement',     targetRegion: 'all',          text: 'Movement: large broadband transients, frontal, often off-scale' },
  '50hz':         { patternId: '50hz',         targetRegion: 'all',          text: 'Mains: uniform 50/60 Hz thickening of every trace' },

  // ── Non-epileptiform abnormalities ──────────────────────────────────────
  'gen-slowing':          { patternId: 'gen-slowing',          targetRegion: 'all',           text: 'Generalised slowing: diffuse θ/δ, no posterior alpha' },
  'focal-delta-temporal': { patternId: 'focal-delta-temporal', targetRegion: 'left-temporal', text: 'Focal delta: polymorphic δ, left temporal (lesion until proven)' },
  'firda':                { patternId: 'firda',                targetRegion: 'central',       text: 'FIRDA: frontal rhythmic 2–3 Hz delta (encephalopathy)' },
  'triphasic':            { patternId: 'triphasic',            targetRegion: 'all',           text: 'Triphasic: ~1.5 Hz, big DOWNWARD middle phase, anterior' },
  'gpeds':                { patternId: 'gpeds',                targetRegion: 'all',           text: 'GPEDs: generalised periodic spike/sharp every 0.5–2 s' },
  'lpeds':                { patternId: 'lpeds',                targetRegion: 'left-temporal', text: 'LPEDs: left-temporal sharp+slow every 1–2 s' },

  // ── Interictal epileptiform ─────────────────────────────────────────────
  'focal-spikes-lt': { patternId: 'focal-spikes-lt', targetRegion: 'left-temporal',  text: 'Phase reversal at T3 — compare F7-T3 vs T3-T5' },
  'focal-spikes-rt': { patternId: 'focal-spikes-rt', targetRegion: 'right-temporal', text: 'Phase reversal at T4 — compare F8-T4 vs T4-T6' },
  'focal-spikes-lf': { patternId: 'focal-spikes-lf', targetRegion: 'left-paramedian', text: 'Left frontal focus: phase reversal at F3/Fp1' },
  'ied-spike':       { patternId: 'ied-spike',       targetRegion: 'left-temporal',  text: 'Spike: 20–70 ms pointed transient, NO slow wave (T3)' },
  'ied-spike-wave':  { patternId: 'ied-spike-wave',  targetRegion: 'left-temporal',  text: 'Spike-and-wave: spike + slow after-wave (T3)' },
  'ied-sharp':       { patternId: 'ied-sharp',       targetRegion: 'left-temporal',  text: 'Sharp wave: 70–200 ms pointed transient, NO slow wave (T3)' },
  'ied-sharp-wave':  { patternId: 'ied-sharp-wave',  targetRegion: 'left-temporal',  text: 'Sharp-and-wave: sharp + slow after-wave (T3)' },
  '3hz-gsw':         { patternId: '3hz-gsw',         targetRegion: 'all',            text: '3 Hz spike-wave, frontally predominant (absence hallmark)' },
  'polyspike-wave':  { patternId: 'polyspike-wave',  targetRegion: 'all',            text: 'Polyspike-wave: 3–5 spikes then a slow wave, generalised' },
  'burst-suppression':{ patternId: 'burst-suppression', targetRegion: 'all',         text: 'Burst-suppression: high-amplitude bursts alternating with near-flat' },
  'hypsarrhythmia':  { patternId: 'hypsarrhythmia',  targetRegion: 'all',            text: 'Hypsarrhythmia: chaotic high-amplitude multifocal spikes' },

  // ── Ictal / seizures ────────────────────────────────────────────────────
  'absence-ictal':        { patternId: 'absence-ictal',        targetRegion: 'all',           text: 'Absence: 3 Hz generalised spike-wave, sudden on/off' },
  'gtc-ictal':            { patternId: 'gtc-ictal',            targetRegion: 'all',           text: 'GTC: recruiting fast → polyspike → slowing → suppression' },
  'focal-temporal-ictal': { patternId: 'focal-temporal-ictal', targetRegion: 'left-temporal', text: 'Focal temporal Sz: rhythmic theta onset, evolving' },
  'focal-frontal-ictal':  { patternId: 'focal-frontal-ictal',  targetRegion: 'left-paramedian', text: 'Focal frontal Sz: low-voltage fast onset, evolving' },

  // ── Activation procedures ───────────────────────────────────────────────
  'photic':           { patternId: 'photic',           targetRegion: 'all', text: 'Photic driving: occipital rhythm locked to the flash rate (must be symmetric)' },
  'hyperventilation': { patternId: 'hyperventilation', targetRegion: 'all', text: 'HV build-up: growing rhythmic slowing, frontally predominant' },
};

/**
 * Category accent colour for each pattern id, so an on-trace cue can be tinted
 * to match the control-panel category it came from. Built from the single
 * registry in `patterns.ts` rather than duplicated, so the two never diverge.
 */
export const PATTERN_COLOR: Record<string, string> = Object.fromEntries(
  PATTERN_CATEGORIES.flatMap(c => c.patterns.map(p => [p.id, c.color])),
);

/** Vertical ordering key so cues stack in the same order the montage rows run. */
export const REGION_ORDER: Record<ChannelGroup | 'all', number> = {
  'left-paramedian': 0,
  'right-paramedian': 1,
  'left-temporal': 2,
  'right-temporal': 3,
  'central': 4,
  'ecg': 5,
  'all': 6,
};

/**
 * Source geometry and the forward model (briefing §7).
 *
 * "Never generate channels independently." Scalp EEG is X(t) = G · S(t): source
 * dipole time courses projected through a leadfield. Generating each electrode
 * on its own destroys the near-zero-lag correlation that volume conduction
 * creates between neighbours, and makes ICA and source localisation look
 * impossibly good (§12).
 *
 * Head model: §7 ranks single sphere → concentric spheres → BEM → FEM, and notes
 * that a template BEM is the pragmatic default for research work. This engine
 * runs in a browser at 250 Hz, and §0 puts a teaching simulator's head model in
 * the "can be crude" column, so a full BEM solve is not warranted. What is
 * warranted — and what the hand-authored per-electrode gain tables this replaces
 * could not guarantee — is that every field be spatially continuous, decay
 * smoothly from an anatomical source, and produce channel correlation that falls
 * off with real inter-electrode distance.
 *
 * The model used: each source is a current dipole on a cortical shell, and its
 * scalp field is the standard potential of a current dipole in a homogeneous
 * conductor, softened by the source's spatial extent (see `buildLeadfield`).
 * Radial dipoles (gyral crowns) give a monopolar blob with a weak opposite-signed
 * return field over the rest of the head; tangential dipoles (sulcal walls) give
 * the bipolar +/- pattern. Both fall out of one formula rather than being
 * special-cased.
 *
 * This replaced a Gaussian falloff, `exp(-d^2/2*sigma^2)`, which was wrong in a
 * way that mattered. A Gaussian has no algebraic tail: at the distances of a real
 * 10-20 array it does not merely under-estimate the far field, it annihilates it.
 * With sigma ~4 cm the gain 19 cm away — occiput to frontopole — came out at
 * exp(-19^2/(2*4.1^2)) ~ 2e-5, so a posterior rhythm contributed literally
 * nothing frontally and every distant field in the model was carried by whatever
 * happened to be anchored nearby instead. Real volume conduction falls
 * algebraically, ~1/r^3 for the lateral tail of a radial source, which over that
 * distance is about 30x down rather than 50,000x.
 *
 * Skull conductivity: §7 notes the historical 1:80 skull-to-brain ratio has been
 * revised to roughly 1:15-1:25, which means materially *less* spatial smearing
 * than older simulations assume. SMEARING_SIGMA is set for that modern range.
 */

import { electrodePositions3D } from '../utils/electrodePositions3D';

export type Vec3 = [number, number, number];

/**
 * Scene units are those of the Colin27 mesh, normalised so the head's largest
 * semi-axis is 1. A real head is ~9 cm in that direction, so 1 unit ~ 9-10 cm.
 */
export const SCENE_UNITS_TO_CM = 9.5;

/** Centroid of the brain within the scene, a little above the geometric origin. */
export const HEAD_CENTRE: Vec3 = [0, 0.15, 0];

/** Radius of the cortical shell that sources are placed on. */
export const CORTICAL_SHELL = 0.62;

/**
 * Default Gaussian width of a scalp field, in scene units. ~0.25 units is ~2.4 cm,
 * giving a focal source a scalp FWHM near 5.5 cm — consistent with the modern,
 * less-smearing skull conductivity ratio.
 */
export const SMEARING_SIGMA = 0.25;

/**
 * Depth of a cortical generator below the scalp, in scene units (0.2 ~ 1.9 cm).
 *
 * The shell above is a sphere about HEAD_CENTRE, but the electrodes are not: Cz
 * sits 0.67 units from the centre, O1 and Fp1 1.05. So a shell source is 0.05
 * units (~0.5 cm) under Cz and 0.43 (~4 cm) under O1 — a tenfold spread in
 * depth, which makes every vertex source hyper-focal (a Cz patch gives C3 4%)
 * and every occipital or frontopolar one hyper-broad (an O1 patch gives P3
 * 40-48%, whatever its extent). Sources placed with `belowScalp` sit at one
 * depth everywhere instead. The value is the scalp-to-cortex distance — MRI
 * measured 14.3 +- 2.5 mm over M1 in young adults (Lu et al. 2019, CNS Neurosci
 * Ther, PMC6834924) — plus a few millimetres into the gyral crown.
 *
 * Used by `synchronousPatches` (the sleep graphoelements and the distributed
 * sleep background). Every older source still sits on the shell; moving them
 * all would re-fit every extent in the model, so that is left as a finding.
 */
export const CORTEX_BELOW_SCALP = 0.2;

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(a: Vec3, k: number): Vec3 { return [a[0] * k, a[1] * k, a[2] * k]; }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a: Vec3): number { return Math.sqrt(dot(a, a)); }
function unit(a: Vec3): Vec3 { const n = norm(a) || 1; return scale(a, 1 / n); }
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export type Orientation =
  | { kind: 'radial' }
  /** Tangential dipoles produce a bipolar scalp field; `dir` is the tangential axis. */
  | { kind: 'tangential'; dir: Vec3 };

export type SourceSpec = {
  id: string;
  /** Position on the cortical shell. */
  pos: Vec3;
  orientation: Orientation;
  /**
   * Spatial extent of the source patch, scene units. §7: a scalp-visible rhythm
   * needs roughly 6+ cm^2 of synchronously active cortex, so a physiologically
   * plausible patch is never a point — extents below ~0.18 would not be visible
   * on the scalp at all.
   *
   * In the dipole model this enters as a softening length (see `buildLeadfield`):
   * it sets how broad the field is near the source, which is what a distributed
   * patch does, while leaving the far-field falloff algebraic. It is no longer a
   * Gaussian sigma, so it no longer controls the tail at all — only the core.
   */
  extent: number;
  /**
   * Set when the generator is not one patch but several cortical patches active
   * IN SYNCHRONY — one time course, each patch with its own weight. See
   * `synchronousPatches`. When present, the column is built from these and
   * `pos`/`orientation`/`extent` above only describe the group as a whole.
   */
  patches?: { spec: SourceSpec; weight: number }[];
};

/**
 * Place a source on the cortical shell beneath one or more named electrodes.
 * Anchoring source geometry to the 10-20 positions keeps the anatomy honest:
 * a "left occipital" generator ends up genuinely under O1, not at a hand-picked
 * coordinate that happens to look right.
 */
export function sourceUnder(
  id: string,
  electrodes: string[],
  opts: {
    extent?: number; orientation?: Orientation; depth?: number; offset?: Vec3;
    /** Place the source this far (scene units) straight below the scalp anchor instead of on the shell. */
    belowScalp?: number;
  } = {},
): SourceSpec {
  let acc: Vec3 = [0, 0, 0];
  for (const e of electrodes) {
    const p = electrodePositions3D[e];
    if (!p) throw new Error(`sourceUnder: unknown electrode ${e}`);
    acc = add(acc, p as Vec3);
  }
  // `offset` nudges the anchor away from the scalp electrode(s) before it is
  // projected to the cortical shell — used when a generator sits deeper than its
  // nearest scalp site (e.g. the medial-occipital alpha generator, which lies
  // posterior-inferior to O1/O2 at the occipital pole).
  const mean = add(scale(acc, 1 / electrodes.length), opts.offset ?? [0, 0, 0]);
  const dir = unit(sub(mean, HEAD_CENTRE));
  if (opts.belowScalp != null) {
    return {
      id,
      pos: sub(mean, scale(dir, opts.belowScalp)),
      orientation: opts.orientation ?? { kind: 'radial' },
      extent: opts.extent ?? SMEARING_SIGMA,
    };
  }
  const depth = opts.depth ?? CORTICAL_SHELL;
  return {
    id,
    pos: add(HEAD_CENTRE, scale(dir, depth)),
    orientation: opts.orientation ?? { kind: 'radial' },
    extent: opts.extent ?? SMEARING_SIGMA,
  };
}

/**
 * One generator made of several cortical patches that fire together: a patch
 * under each named electrode, weighted, all radial with the same extent.
 *
 * Why this exists. A single patch in this forward model is sharply peaked at
 * the electrode above it: however wide its `extent`, the next electrode out
 * (~7 cm away) sees little of it — at extent 0.7 a Cz patch gives C3 34% — and
 * widening it further spreads it over the whole head before the neighbours
 * catch up. Graphoelements that are genuinely BILATERAL and REGIONAL (a vertex
 * wave "maximal over the parasagittal and central chains", a spindle seen on
 * every parasagittal row, a frontally-maximal but diffuse K-complex) are not
 * point sources; they are regions of cortex acting at once. By superposition,
 * patches with one shared time course project as ONE leadfield column whose
 * map is the weighted sum of their fields — which is what this builds.
 */
export function synchronousPatches(
  id: string,
  weights: Record<string, number>,
  opts: { extent: number; offset?: Vec3; belowScalp?: number },
): SourceSpec {
  const patches = Object.entries(weights).map(([el, weight]) => ({
    spec: sourceUnder(`${id}:${el}`, [el], {
      extent: opts.extent, offset: opts.offset, belowScalp: opts.belowScalp ?? CORTEX_BELOW_SCALP,
    }),
    weight,
  }));
  const wSum = patches.reduce((a, p) => a + Math.abs(p.weight), 0) || 1;
  let c: Vec3 = [0, 0, 0];
  for (const p of patches) c = add(c, scale(p.spec.pos, Math.abs(p.weight) / wSum));
  return {
    id,
    pos: add(HEAD_CENTRE, scale(unit(sub(c, HEAD_CENTRE)), CORTICAL_SHELL)),
    orientation: { kind: 'radial' },
    extent: opts.extent,
    patches,
  };
}

/** A tangential axis at a given shell position, perpendicular to the radial direction. */
export function tangentialAt(pos: Vec3, towards: Vec3 = [0, 1, 0]): Orientation {
  const radial = unit(sub(pos, HEAD_CENTRE));
  let t = cross(cross(radial, towards), radial);
  if (norm(t) < 1e-6) t = cross(radial, [1, 0, 0]);
  return { kind: 'tangential', dir: unit(t) };
}

/**
 * A blanket of broad, independent cortical patches used for the aperiodic
 * background.
 *
 * This is the fix for the single most consequential spatial defect in the old
 * engine, which gave every electrode its own private background noise. That is
 * only correct for *instrument* noise (§9), which genuinely is independent per
 * channel. Neural background is cortical activity seen through volume
 * conduction, so neighbouring electrodes must see overlapping mixtures of the
 * same patches — which is exactly what a spread of broad patches produces.
 */
export function backgroundPatches(count = 16, extent = 0.39): SourceSpec[] {
  const out: SourceSpec[] = [];
  // Fibonacci sphere, biased to the upper hemisphere where cortex actually is.
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(count - 1, 1)) * 1.35;  // 1 .. -0.35
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    const dir = unit([Math.cos(th) * r, y, Math.sin(th) * r]);
    out.push({
      id: `bg${i}`,
      pos: add(HEAD_CENTRE, scale(dir, CORTICAL_SHELL)),
      orientation: { kind: 'radial' },
      extent,
    });
  }
  return out;
}

export type Leadfield = {
  electrodes: string[];
  nSources: number;
  /** Row-major [electrode][source] gains. */
  gain: Float64Array;
  gainAt(electrodeIndex: number, sourceIndex: number): number;
};

/**
 * Build the leadfield matrix G.
 *
 * Each source's column is normalised so its largest absolute gain is 1, which
 * makes a source's configured RMS mean "microvolts at the electrode where this
 * generator is strongest" — the way amplitudes are quoted clinically.
 */
export function buildLeadfield(sources: SourceSpec[], electrodeNames?: string[]): Leadfield {
  const names = electrodeNames ?? Object.keys(electrodePositions3D);
  const nE = names.length;
  const nS = sources.length;
  const gain = new Float64Array(nE * nS);

  for (let s = 0; s < nS; s++) {
    const src = sources[s];
    let maxAbs = 0;
    for (let e = 0; e < nE; e++) {
      const pe = electrodePositions3D[names[e]] as Vec3;
      // A synchronous multi-patch generator is the weighted sum of its patches'
      // raw fields, normalised as one column (see `synchronousPatches`).
      const g = src.patches
        ? src.patches.reduce((a, p) => a + p.weight * patchGain(p.spec, pe), 0)
        : patchGain(src, pe);
      gain[e * nS + s] = g;
      maxAbs = Math.max(maxAbs, Math.abs(g));
    }
    if (maxAbs > 0) {
      // Remove the column's monopole: its mean over the closed head surface. See
      // `surfaceMean`. Subtracting a constant from every electrode leaves every
      // referenced display (bipolar, ear, average) exactly as it was; it changes only
      // the potentials against infinity.
      const offset = surfaceMean(src) / maxAbs;
      for (let e = 0; e < nE; e++) gain[e * nS + s] = gain[e * nS + s] / maxAbs - offset;
    }
  }

  return {
    electrodes: names,
    nSources: nS,
    gain,
    gainAt: (e, s) => gain[e * nS + s],
  };
}

/**
 * A sphere fitted (least squares) to the electrode positions, standing in for the
 * closed scalp surface. Crude, as §0 allows a teaching simulator's head model to be;
 * it only has to be closed and roughly head-sized for `surfaceMean`.
 */
let scalpSphere: { c: Vec3; r: number; pts: Vec3[] } | null = null;
function getScalpSphere() {
  if (scalpSphere) return scalpSphere;
  // |p|^2 = 2 c.p + (r^2 - |c|^2): linear in (cx, cy, cz, k). Normal equations, 4x4.
  const P = Object.values(electrodePositions3D) as Vec3[];
  const A: number[][] = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const b = [0, 0, 0, 0];
  for (const p of P) {
    const row = [2 * p[0], 2 * p[1], 2 * p[2], 1];
    const y = dot(p, p);
    for (let i = 0; i < 4; i++) { b[i] += row[i] * y; for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j]; }
  }
  for (let i = 0; i < 4; i++) {          // Gauss-Jordan
    let piv = i;
    for (let k = i + 1; k < 4; k++) if (Math.abs(A[k][i]) > Math.abs(A[piv][i])) piv = k;
    [A[i], A[piv]] = [A[piv], A[i]]; [b[i], b[piv]] = [b[piv], b[i]];
    for (let k = 0; k < 4; k++) {
      if (k === i) continue;
      const f = A[k][i] / A[i][i];
      for (let j = 0; j < 4; j++) A[k][j] -= f * A[i][j];
      b[k] -= f * b[i];
    }
  }
  const x = b.map((v, i) => v / A[i][i]);
  const c: Vec3 = [x[0], x[1], x[2]];
  const r = Math.sqrt(x[3] + dot(c, c));
  // Evenly spread points over the WHOLE sphere, underside included: the constraint
  // is on the closed surface, not on the part the electrodes cover.
  const n = 2048, golden = Math.PI * (3 - Math.sqrt(5)), pts: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, rr = Math.sqrt(1 - y * y), th = golden * i;
    pts.push(add(c, scale([Math.cos(th) * rr, y, Math.sin(th) * rr], r)));
  }
  scalpSphere = { c, r, pts };
  return scalpSphere;
}

/**
 * A source's mean raw potential over the closed scalp surface.
 *
 * A current dipole injects no net current, so in a bounded conductor its surface
 * potential has no monopole (l = 0) term: it integrates to zero over the closed
 * surface. The positive profile in `patchGain` models only the near lobe (see the
 * comment there on why a point dipole's infinite-medium return lobe was rejected),
 * so on its own it carries a spurious monopole — every electrode, however far, sees
 * the source with the same sign. Subtracting the surface mean restores the missing
 * return as the weak, diffuse, opposite-signed offset a bounded head gives.
 *
 * Why it matters (2026-09-22): against infinity, the posterior alpha source alone
 * made electrodes more than 16 cm apart correlate at 0.91, and the whole model's
 * distant correlation rose past its ceiling once the independent background was
 * quieted. No referenced display can see this term, which is why it went unnoticed;
 * anything that works in reference-free potentials — ICA, source localisation, the
 * volume-conduction check — does.
 */
function surfaceMean(src: SourceSpec): number {
  const { pts } = getScalpSphere();
  let sum = 0;
  for (const p of pts) {
    sum += src.patches
      ? src.patches.reduce((a, q) => a + q.weight * patchGain(q.spec, p), 0)
      : patchGain(src, p);
  }
  return sum / pts.length;
}

/** One patch's raw (un-normalised) gain at an electrode position. */
function patchGain(src: SourceSpec, pe: Vec3): number {
  // `extent` is this profile's own width parameter, re-derived per source when
  // the falloff changed — NOT a converted Gaussian sigma. A single global
  // conversion was tried and abandoned: the two profiles differ in SHAPE, not
  // just width (this one is the tighter out to r ~ 2.2 sigma and only fatter
  // beyond), so no one factor transfers them. Half-width matching (x1.537) made
  // the focal sources too broad; leaving them unscaled made the diffuse ones too
  // focal; x1.25 split the difference and failed in both directions at once.
  // Each family's extent is therefore fitted to its own clinical target.
  const sigma = src.extent;
  const d = sub(pe, src.pos);
  const u2 = dot(d, d) / (sigma * sigma);
  // Algebraic falloff, (1 + (r/sigma)^2)^(-3/2). Same shape near the source
  // as the Gaussian it replaces — peak at the anchor, width set by sigma —
  // but the tail is a POWER law: for r >> sigma it goes as (sigma/r)^3, the
  // decay of a dipole's lateral field, instead of dying super-exponentially.
  //
  // That tail is the whole point. exp(-r^2/2sigma^2) at 19 cm with sigma
  // ~4 cm is ~2e-5, so under the old model a posterior rhythm contributed
  // literally nothing frontally and every distant field was carried by
  // whatever source happened to sit nearby. The same distance here gives
  // ~9e-3 — about 450x more, and in the range real volume conduction spreads.
  //
  // A true point dipole, (p·d)/|d|^3, was tried and rejected. It is the more
  // faithful infinite-medium formula, but an infinite medium gives it a
  // negative return lobe comparable in magnitude to its own peak, spread over
  // the whole head. That is not what a BOUNDED conductor does — in a head the
  // return currents disperse through the volume as a weak, diffuse offset —
  // and it broke the model comprehensively: 50 checks, including blinks and
  // K-complexes rendering with inverted polarity (the far lobe became the
  // column's maximum) and diffuse generators like GPEDs cancelling against
  // their own return field (O1 fell to 2.5 uV against a 15 uV floor).
  // Modelling the positive lobe with a physical tail, and letting the diffuse
  // return be absorbed by the reference, is both closer to a bounded head and
  // closer to what an ear-referenced clinical recording actually shows.
  const falloff = Math.pow(1 + u2, -1.5);
  if (src.orientation.kind === 'radial') return falloff;
  // Tangential: the directional derivative of that profile along the
  // dipole axis — the classic bipolar sulcal pattern, positive one side of
  // the source and negative the other, zero directly above it. The steeper
  // exponent keeps its far field at ~(sigma/r)^3 too, since the numerator
  // grows with r.
  return (dot(d, src.orientation.dir) / sigma) * Math.pow(1 + u2, -2);
}

/** Straight-line distance between two electrodes, in centimetres. */
export function electrodeDistanceCm(a: string, b: string): number {
  const pa = electrodePositions3D[a] as Vec3;
  const pb = electrodePositions3D[b] as Vec3;
  return norm(sub(pa, pb)) * SCENE_UNITS_TO_CM;
}

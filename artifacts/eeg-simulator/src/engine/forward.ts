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
 * scalp field is a Gaussian in distance from the source's scalp projection.
 * Radial dipoles (gyral crowns) give a monopolar blob; tangential dipoles (sulcal
 * walls) give the bipolar +/- pattern that a derivative-of-Gaussian describes.
 * The Gaussian width stands in for skull smearing.
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
   * Spatial extent of the scalp field, scene units. §7: a scalp-visible rhythm
   * needs roughly 6+ cm^2 of synchronously active cortex, so a physiologically
   * plausible patch is never a point — extents below ~0.18 would not be visible
   * on the scalp at all.
   */
  extent: number;
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
  opts: { extent?: number; orientation?: Orientation; depth?: number } = {},
): SourceSpec {
  let acc: Vec3 = [0, 0, 0];
  for (const e of electrodes) {
    const p = electrodePositions3D[e];
    if (!p) throw new Error(`sourceUnder: unknown electrode ${e}`);
    acc = add(acc, p as Vec3);
  }
  const mean = scale(acc, 1 / electrodes.length);
  const dir = unit(sub(mean, HEAD_CENTRE));
  const depth = opts.depth ?? CORTICAL_SHELL;
  return {
    id,
    pos: add(HEAD_CENTRE, scale(dir, depth)),
    orientation: opts.orientation ?? { kind: 'radial' },
    extent: opts.extent ?? SMEARING_SIGMA,
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
export function backgroundPatches(count = 16, extent = 0.42): SourceSpec[] {
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
    const sigma = src.extent;
    let maxAbs = 0;
    for (let e = 0; e < nE; e++) {
      const pe = electrodePositions3D[names[e]] as Vec3;
      const d = sub(pe, src.pos);
      const dist = norm(d);
      const falloff = Math.exp(-(dist * dist) / (2 * sigma * sigma));
      let g: number;
      if (src.orientation.kind === 'radial') {
        g = falloff;
      } else {
        // Derivative-of-Gaussian along the tangential axis: the classic bipolar
        // scalp pattern of a sulcal source, positive on one side of the dipole
        // and negative on the other.
        g = (dot(d, src.orientation.dir) / sigma) * falloff;
      }
      gain[e * nS + s] = g;
      maxAbs = Math.max(maxAbs, Math.abs(g));
    }
    if (maxAbs > 0) {
      for (let e = 0; e < nE; e++) gain[e * nS + s] /= maxAbs;
    }
  }

  return {
    electrodes: names,
    nSources: nS,
    gain,
    gainAt: (e, s) => gain[e * nS + s],
  };
}

/** Straight-line distance between two electrodes, in centimetres. */
export function electrodeDistanceCm(a: string, b: string): number {
  const pa = electrodePositions3D[a] as Vec3;
  const pb = electrodePositions3D[b] as Vec3;
  return norm(sub(pa, pb)) * SCENE_UNITS_TO_CM;
}

/**
 * Builds the 10-20 electrode positions by the standard construction.
 *
 * Run: pnpm --filter @workspace/scripts run build-1020
 *
 * The positions are built on `skin.bin`, an isosurface extracted from the MNI152_T1_1mm
 * template MRI (scripts/src/extractSkinFromNifti.ts) — not the old Colin27 BEM watershed
 * shell, which had no ears, nose or eye sockets. It is also the surface `HeadModel3D`
 * renders and the volume conductor the forward model assumes. Deriving them on any other
 * mesh reintroduces the frame mismatch this script exists to remove — see the note on
 * head_face.bin at the foot of the file.
 *
 * Why this replaces hand-authored directions
 * ------------------------------------------
 * The previous positions came from a table of eyeballed unit vectors that were
 * then ray-projected onto a scalp. That cannot satisfy the 10-20 system, because
 * the system is not a set of directions — it is a set of *arc-length fractions*
 * of measured head circumferences. The visible symptom was that Fp1, F7, T3, T5
 * and O1, which by construction all lie on one circumference and must therefore
 * be near-coplanar, were spread over 1.6 cm of height, with F7 sitting 1.3 cm
 * above T3 and well off the anterior temporal region it is meant to overlie.
 *
 * The construction implemented here (Jasper 1958):
 *
 *   1. Fiducials. Nasion and inion are taken at the height where the skull's
 *      antero-posterior extent is greatest — the glabella/inion level the
 *      circumference is measured around. The preauricular points are the lateral
 *      extremes of that same plane, and Cz is the vertex.
 *   2. Sagittal arc, nasion -> vertex -> inion: Fpz 10%, Fz 30%, Cz 50%,
 *      Pz 70%, Oz 90%.
 *   3. Coronal arc, left preauricular -> vertex -> right: T3 10%, C3 30%,
 *      Cz 50%, C4 70%, T4 90%.
 *   4. Circumference through Fpz, T3, Oz, T4. Measured as fractions of the
 *      Fpz->Oz half: Fp1 10%, F7 30%, T3 50%, T5 70%, O1 90% (equivalently
 *      5/15/25/35/45% of the full circumference), mirrored on the right.
 *   5. F3 midway along the forehead arc F7->Fz; F4, P3, P4 likewise.
 *
 * Symmetry. MNI152_T1_1mm is a template averaged over 152 real heads, but the
 * average is not perfectly symmetric, and taking positions from it directly
 * puts each left/right pair at slightly different |x|. Fed through the
 * leadfield that becomes a standing left-right amplitude difference for a
 * midline source — a simulator that teaches lateralisation must not
 * manufacture any of it from atlas anatomy. Each pair is therefore averaged
 * and mirrored. This is also what the real procedure does: a technician
 * placing electrodes at measured percentages of measured arcs produces a
 * symmetric layout by construction.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Vec3, type Mesh,
  add, mul, sub, len, unit, cross,
  readBin, signedVolume, cast, castDist,
} from './mesh';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Surface curve in the plane through a, b and `via`, sampled by angle. */
function arc(m: Mesh, a: Vec3, b: Vec3, via: Vec3, steps = 1440) {
  const n = unit(cross(sub(a, via), sub(b, via)));
  const o = mul(add(add(a, b), via), 1 / 3);
  const u = unit(sub(a, o)), w = unit(cross(n, u));
  const pts: Vec3[] = [];
  for (let i = 0; i < steps; i++) {
    const th = (2 * Math.PI * i) / steps;
    const hit = cast(m, o, unit(add(mul(u, Math.cos(th)), mul(w, Math.sin(th)))));
    if (hit) pts.push(hit);
  }
  return pts;
}

const nearest = (pts: Vec3[], q: Vec3) => {
  let bi = 0, bd = Infinity;
  pts.forEach((p, i) => { const d = len(sub(p, q)); if (d < bd) { bd = d; bi = i; } });
  return bi;
};

function walk(pts: Vec3[], ia: number, ib: number, dir: number) {
  const n = pts.length, path: Vec3[] = [];
  for (let k = 0, i = ia; k <= n; k++, i = (i + dir + n) % n) {
    path.push(pts[i]);
    if (i === ib) break;
  }
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + len(sub(path[i], path[i - 1])));
  return { path, cum, L: cum[cum.length - 1] };
}

/**
 * Sample the surface arc from a to b at the given arc-length fractions.
 * `via` fixes the plane. Mode 'via' takes the way round that passes through it
 * (arcs that must cross the vertex); 'short' takes the shorter way (the forehead
 * and parietal arcs, where the vertex route is the long way round).
 */
function place(m: Mesh, a: Vec3, b: Vec3, via: Vec3, fracs: number[], mode: 'via' | 'short' = 'via'): Vec3[] {
  const pts = arc(m, a, b, via);
  const ia = nearest(pts, a), ib = nearest(pts, b);
  let dir: number;
  if (mode === 'short') {
    dir = walk(pts, ia, ib, 1).L <= walk(pts, ia, ib, -1).L ? 1 : -1;
  } else {
    const iv = nearest(pts, via), n = pts.length, fwd = (i: number, j: number) => (j - i + n) % n;
    dir = fwd(ia, iv) < fwd(ia, ib) ? 1 : -1;
  }
  const { path, cum, L } = walk(pts, ia, ib, dir);
  return fracs.map(f => {
    const target = f * L;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < target) i++;
    const t = (target - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return add(path[i - 1], mul(sub(path[i], path[i - 1]), t));
  });
}

// ── Build ────────────────────────────────────────────────────────────────────

const skin = readBin('skin.bin');

// Which way is anatomically left is read off the left-hemisphere mesh, never assumed.
// The 10-20 numbering is anatomical — odd on the left, even on the right — so if this
// were hard-coded, a change to the mesh frame would silently move every even electrode
// onto the left hemisphere while leaving the code looking correct.
const lh = readBin('lh_pial.bin');
let lhSumX = 0;
for (let i = 0; i < lh.pos.length; i += 3) lhSumX += lh.pos[i];
const LEFT = Math.sign(lhSumX);

// A closed surface wound counter-clockwise has positive signed volume; a mirrored one
// does not — that is the mirror guard below. But the sign is *also* flipped by nothing
// more than reversed triangle winding (normals pointing inward) with every vertex
// position untouched, and that is what's happening on the current skin.bin, not a
// mirror. extractSkinFromNifti.ts applies MNI152_T1_1mm's own sform faithfully, and
// that sform — [[-1,0,0,90],[0,1,0,-126],[0,0,1,-72]], determinant -1 — is the standard
// header for this template, an artifact of how its voxels are stored, not a reflection
// of the anatomy it describes. The RAS->scene remap that follows (x'=-x, y'=z, z'=y)
// has determinant +1, so nothing downstream cancels it: positions are correct, only
// winding is backwards. (Verified independently while investigating this — not
// something this script re-derives at runtime.) Correct the winding in memory — index
// order only, no vertex moves, and cast()/castDist() don't use winding regardless —
// instead of refusing to build. This makes the guard weaker than before: it can no
// longer tell a genuine mirror apart from this case using signedVolume alone. If
// skin.bin's source pipeline changes again, re-check by hand rather than trust this.
if (signedVolume(skin) < 0) {
  for (let i = 0; i < skin.idx.length; i += 3) {
    const t = skin.idx[i + 1]; skin.idx[i + 1] = skin.idx[i + 2]; skin.idx[i + 2] = t;
  }
  console.warn(`skin.bin: reversed triangle winding corrected in memory `
    + `(signed volume now ${signedVolume(skin).toFixed(3)}) — see comment above; not written to disk.`);
}

// Fiducials, set BY HAND against the Jasper diagram and the rendered head.
// The former "height of greatest mid-sagittal AP extent" heuristic mislocated
// these on the face-bearing MNI152 mesh: the nose and occiput inflate the AP
// extent at one low plane (~y=-0.22), and forcing nasion, inion AND the
// preauricular points onto that single plane rode the coronal arc (T3/C3) up.
// Each landmark now has its own height, cast independently. Tune THESE three
// numbers, not the electrodes — the arc construction below derives all 21.
const Y_NASION = 0.00;         // nasion: nose-root / glabella level
const Y_INION = -0.22;         // inion: occipital protuberance
const Y_PREAURICULAR = -0.35;  // preauricular: ear-canal level (lateral extremes)

const ORIGIN: Vec3 = [0, 0, 0];
const Cz0 = cast(skin, ORIGIN, [0, 1, 0])!;
const Nz = cast(skin, [0, Y_NASION, 0], [0, 0, 1])!;
const Iz = cast(skin, [0, Y_INION, 0], [0, 0, -1])!;
const LPA = cast(skin, [0, Y_PREAURICULAR, 0], [LEFT, 0, 0])!;
const RPA = cast(skin, [0, Y_PREAURICULAR, 0], [-LEFT, 0, 0])!;
console.log(`fiducials  Nz=${Nz.map(n=>n.toFixed(2))}  Iz=${Iz.map(n=>n.toFixed(2))}`
  + `  LPA=${LPA.map(n=>n.toFixed(2))}  vertex=${Cz0[1].toFixed(3)}`);

const [Fpz, Fz, Cz, Pz, Oz] = place(skin, Nz, Iz, Cz0, [0.10, 0.30, 0.50, 0.70, 0.90]);
const [T3, C3, C4, T4] = place(skin, LPA, RPA, Cz0, [0.10, 0.30, 0.70, 0.90]);
const [Fp1, F7, , T5, O1] = place(skin, Fpz, Oz, T3, [0.10, 0.30, 0.50, 0.70, 0.90]);
const [Fp2, F8, , T6, O2] = place(skin, Fpz, Oz, T4, [0.10, 0.30, 0.50, 0.70, 0.90]);
const [F3] = place(skin, F7, Fz, ORIGIN, [0.5], 'short');
const [F4] = place(skin, F8, Fz, ORIGIN, [0.5], 'short');
const [P3] = place(skin, T5, Pz, ORIGIN, [0.5], 'short');
const [P4] = place(skin, T6, Pz, ORIGIN, [0.5], 'short');

// Ear electrodes. A1/A2 go on the ear lobule — the soft, cartilage-free
// inferior tip of the pinna — used as a (near-)neutral reference. skin.bin
// now has a real pinna (see header), so this is read off the mesh instead of
// approximated on bare skull.
//
// Casts near the midline are unreliable at this height (the pharyngeal
// cavity artifact described in the header), so the lobule is found by
// scanning vertex positions directly. PINNA_Z is the antero-posterior band
// that isolates the pinna from the jaw/cheek at these heights (measured on
// this mesh: the protruding cluster sits in z -0.40..-0.05, the same window
// on both sides; jaw/cheek vertices nearby sit at lateral extent ~0.75-0.76,
// against ~0.80-0.846 for the pinna, hence the 0.79 cutoff below).
//
// The mesh's bottom crop truncates the lobule before it tapers to a point:
// measured, the pinna's protrusion beyond the local jaw surface shrinks from
// ~10mm near the ear's widest point to ~7mm in the last row before the
// floor, still falling, not converging to zero. The true tip is therefore
// below the crop and absent from this mesh — see the finding reported
// alongside this script. MARGIN keeps the search a conservative 5mm clear of
// the floor so the electrode doesn't land on that cut edge.
const PINNA_Z: [number, number] = [-0.40, -0.05];
const PINNA_LAT_MIN = 0.79; // separates pinna (~0.80-0.846) from jaw (~0.75-0.76)
const MARGIN = 0.05; // ~5mm, see comment above
let floorY = Infinity;
for (let i = 1; i < skin.pos.length; i += 3) if (skin.pos[i] < floorY) floorY = skin.pos[i];
function findLobe(sign: number): Vec3 {
  let best: Vec3 | null = null;
  for (let i = 0; i < skin.pos.length; i += 3) {
    const x = skin.pos[i], y = skin.pos[i + 1], z = skin.pos[i + 2];
    if (Math.sign(x) !== sign) continue;
    if (z < PINNA_Z[0] || z > PINNA_Z[1]) continue;
    if (x * sign < PINNA_LAT_MIN) continue;
    if (y < floorY + MARGIN) continue;
    if (!best || y < best[1]) best = [x, y, z];
  }
  if (!best) throw new Error(`findLobe(${sign}): no candidate vertex found on the pinna`);
  return best;
}
const A1 = findLobe(LEFT);
const A2 = findLobe(-LEFT);

const raw: Record<string, Vec3> = {
  Fp1, Fp2, F7, F3, Fz, F4, F8, T3, C3, Cz, C4, T4,
  T5, P3, Pz, P4, T6, O1, O2, A1, A2,
};

// Mirror-average each left/right pair; pin the midline to x = 0.
const PAIRS: [string, string][] = [
  ['Fp1', 'Fp2'], ['F7', 'F8'], ['F3', 'F4'], ['T3', 'T4'],
  ['C3', 'C4'], ['T5', 'T6'], ['P3', 'P4'], ['O1', 'O2'], ['A1', 'A2'],
];
for (const [l, r] of PAIRS) {
  const x = (Math.abs(raw[l][0]) + Math.abs(raw[r][0])) / 2;
  const y = (raw[l][1] + raw[r][1]) / 2;
  const z = (raw[l][2] + raw[r][2]) / 2;
  raw[l] = [LEFT * x, y, z];
  raw[r] = [-LEFT * x, y, z];
}
for (const m of ['Fz', 'Cz', 'Pz']) raw[m] = [0, raw[m][1], raw[m][2]];

// Seat the markers just proud of the scalp so they read as electrodes on the
// surface rather than z-fighting with it.
const positions: Record<string, Vec3> = {};
for (const [k, v] of Object.entries(raw)) {
  positions[k] = mul(v, 1.02).map(n => Number(n.toFixed(4))) as Vec3;
}

const order = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T3', 'C3', 'Cz', 'C4', 'T4',
  'T5', 'P3', 'Pz', 'P4', 'T6', 'O1', 'O2', 'A1', 'A2'];
const ts = `// 10-20 electrode positions, built by scripts/src/build1020.ts from the
// arc-length construction on the MNI152_T1_1mm scalp shell. Do not hand-edit —
// re-run the script instead.
export const electrodePositions3D: Record<string, [number, number, number]> = {
${order.map(n => `  ${n}: [${positions[n].join(', ')}],`).join('\n')}
};
`;
fs.writeFileSync(
  path.join(__dirname, '../../artifacts/eeg-simulator/src/utils/electrodePositions3D.ts'),
  ts,
);
console.log('wrote electrodePositions3D.ts');
console.log('circumference heights:', ['Fp1', 'F7', 'T3', 'T5', 'O1']
  .map(k => `${k}=${positions[k][1].toFixed(3)}`).join('  '));

// Odd electrodes must overlie the left hemisphere mesh and even ones the right.
// This is the property the numbering means, so assert it rather than trusting the
// arithmetic above.
let rhSumX = 0;
const rh = readBin('rh_pial.bin');
for (let i = 0; i < rh.pos.length; i += 3) rhSumX += rh.pos[i];
for (const [name, p] of Object.entries(positions)) {
  const digit = name.match(/(\d)$/);
  if (!digit) continue;
  const wantLeft = +digit[1] % 2 === 1;
  if (Math.sign(p[0]) !== (wantLeft ? LEFT : -LEFT)) {
    throw new Error(`${name} is on the wrong hemisphere (x=${p[0]})`);
  }
}
console.log(`hemispheres: anatomical left is x${LEFT > 0 ? '>' : '<'}0 `
  + `(lh_pial mean x ${(lhSumX / (lh.pos.length / 3)).toFixed(3)}, `
  + `rh_pial ${(rhSumX / (rh.pos.length / 3)).toFixed(3)}); odd/even placement OK`);

// Report how far each electrode sits outside the scalp it was built on. These
// should all be the 2% seating offset and nothing else; a spread here means the
// markers and the rendered head have drifted into different frames again.
const drift = order.map(n => {
  const p = positions[n];
  const r = Math.hypot(...p);
  return r / castDist(skin, ORIGIN, mul(p, 1 / r))!;
});
console.log(`seating ratio vs rendered scalp: ${Math.min(...drift).toFixed(3)}–${Math.max(...drift).toFixed(3)}`);

// Why not head_face.bin
// ---------------------
// `processHeadMesh.ts` also produces a photogrammetric head scan, which has a face
// and ears the BEM shell lacks. It is not used, and electrodes must not be built on
// it, for two measured reasons.
//
// It is a different person. Fitting a uniform scale and offset over the cranial
// vault matches the crown to 3 mm, but the scan's cranium is ~0.9 cm narrower than
// the BEM shell at every height above the ears, so the same fit leaves T3/T4 1.1 cm
// and A1/A2 1.8 cm proud of the surface. No similarity transform closes both gaps.
//
// It is also too coarse where it matters. Above the ear line the scan carries ~50
// vertices per 0.1-unit height band against ~550 for skin.bin — its detail is in the
// face — so arc lengths walked across the vault would be quantised by its topology.


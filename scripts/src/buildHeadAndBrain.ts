/**
 * Rebuilds skin.bin AND brain.bin from two co-registered MNI152 NIfTIs, so the
 * cortex and the scalp are finally the same subject in the same world space.
 *
 * Run: pnpm --filter @workspace/scripts run build-head-brain -- <T1_head.nii.gz> <skullstripped_brain.nii.gz> [skinFactor=2] [brainFactor=1] [skinSmooth=8] [brainTargetTris=250000]
 *
 * The two inputs share MNI world-mm coordinates (verified: the brain's
 * thresholded bbox nests inside the head's on every axis), so registration is
 * free — map each to RAS mm through its own affine, then normalise BOTH by the
 * HEAD's centre+scale (from the skin mesh's own bbox). Normalising the brain by
 * its own bbox would rescale it to fill a unit sphere and burst out of the
 * scalp; sharing the head's transform is what seats it inside.
 *
 * The two surfaces use DIFFERENT extractors on purpose:
 *
 *  - Skin: the trusted boundary-face pipeline (fill cavities so sinuses/orbits/
 *    ear canals don't punch holes -> majority-downsample the mask -> boundary
 *    faces -> Laplacian smooth). Watertight by construction. Surface Nets on the
 *    scalp was tried and abandoned — blurring the mask spawned disconnected
 *    chunks off the ears/face. The staircase this leaves is taken off by the
 *    Laplacian pass; `skinSmooth` iterations control how much.
 *
 *  - Brain: Surface Nets straight on the intensity field at 50 (MRIcroGL's
 *    threshold on this 0-91 volume). Sub-voxel vertex placement resolves the
 *    sulci/gyri; boundary faces + smoothing cannot. Run at FULL resolution
 *    (brainFactor 1): averaging the field across a 1-voxel sulcus lifts it above
 *    threshold and webs the fold shut, so downsampling — here OR via
 *    decimateMesh, which welds sulcal banks the same way — is what produces the
 *    "weird structures in the sulci". The cost is triangle count.
 */

import { readNifti } from './nifti';
import { fillEnclosedCavities, downsampleMask, extractBoundaryMesh, laplacianSmooth, type Dims } from './isosurface';
import { surfaceNets, boxDownsampleField, countBoundaryEdges, marchSphere } from './surfaceNets';
import { quadricDecimate } from './quadricDecimate';
import { writeBin, signedVolume, bbox, MODELS, type Mesh } from './mesh';
import * as path from 'node:path';

const t1File = process.argv[2];
const brainFile = process.argv[3];
if (!t1File || !brainFile) {
  console.error('usage: tsx buildHeadAndBrain.ts <T1_head.nii.gz> <skullstripped_brain.nii.gz> [skinFactor] [brainFactor] [skinSmooth] [brainTargetTris]');
  process.exit(1);
}
const skinFactor = Number(process.argv[4] ?? 2);
const brainFactor = Number(process.argv[5] ?? 1);
const skinSmooth = Number(process.argv[6] ?? 8);
const brainTargetTris = Number(process.argv[7] ?? 250000); // 0 disables QEM decimation.
const SKIN_THRESHOLD = 3000; // MRIcroGL default lower bound on the T1 (0-9999).
const BRAIN_THRESHOLD = 50;  // MRIcroGL threshold on the skull-stripped file (0-91).

// Gate on the analytic sphere before touching real data.
const sphere = marchSphere(30, 0);
if (!sphere.closed || sphere.volErrPct > 2) {
  throw new Error(`surfaceNets self-test failed: closed=${sphere.closed} volErr=${sphere.volErrPct.toFixed(2)}%`);
}
console.log(`surfaceNets self-test OK (sphere closed, volErr ${sphere.volErrPct.toFixed(2)}%)\n`);

/** Map a mesh in coarse voxel coords into RAS mm via `affine`, undoing `factor`. */
function toRas(mesh: Mesh, affine: number[][], factor: number): Float32Array {
  const ras = new Float32Array(mesh.pos.length);
  for (let i = 0; i < mesh.pos.length; i += 3) {
    const vx = mesh.pos[i] * factor, vy = mesh.pos[i + 1] * factor, vz = mesh.pos[i + 2] * factor;
    for (let k = 0; k < 3; k++)
      ras[i + k] = affine[k][0] * vx + affine[k][1] * vy + affine[k][2] * vz + affine[k][3];
  }
  return ras;
}

function rasBbox(ras: Float32Array) {
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < ras.length; i += 3) {
    mnx = Math.min(mnx, ras[i]); mxx = Math.max(mxx, ras[i]);
    mny = Math.min(mny, ras[i + 1]); mxy = Math.max(mxy, ras[i + 1]);
    mnz = Math.min(mnz, ras[i + 2]); mxz = Math.max(mxz, ras[i + 2]);
  }
  return { mnx, mny, mnz, mxx, mxy, mxz };
}

/** Same scene convention as extractSkinFromNifti/processColinMesh: centre+scale, then RAS->scene with x-negation. */
function toScene(ras: Float32Array, cx: number, cy: number, cz: number, scale: number): Float32Array {
  const scene = new Float32Array(ras.length);
  for (let i = 0; i < ras.length; i += 3) {
    const rx = (ras[i] - cx) * scale, ry = (ras[i + 1] - cy) * scale, rz = (ras[i + 2] - cz) * scale;
    scene[i] = -rx; scene[i + 1] = rz; scene[i + 2] = ry;
  }
  return scene;
}

// ---- Skin: boundary-face pipeline (the good, watertight one) ---------------
console.log(`reading head ${t1File}...`);
const t1 = readNifti(t1File);
console.log(`  dims ${t1.dims.join('x')}, pixdim ${t1.pixdim.map(p => p.toFixed(2)).join('x')} mm`);
console.log('  filling enclosed cavities...');
const inside = fillEnclosedCavities(t1.dims, t1.data, SKIN_THRESHOLD);
const skinCoarse = skinFactor > 1 ? downsampleMask(t1.dims, inside, skinFactor) : { dims: t1.dims, inside };
console.log(`  boundary mesh on ${skinCoarse.dims.join('x')} (factor ${skinFactor})...`);
const skinVox = extractBoundaryMesh(skinCoarse.dims, skinCoarse.inside);
const skinRas = toRas(skinVox, t1.affine, skinFactor);
console.log(`  skin: ${skinVox.pos.length / 3} verts, ${skinVox.idx.length / 3} tris`);

// The head defines the shared normalisation both surfaces use.
const hb = rasBbox(skinRas);
const cx = (hb.mnx + hb.mxx) / 2, cy = (hb.mny + hb.mxy) / 2, cz = (hb.mnz + hb.mxz) / 2;
const scale = 1 / Math.max((hb.mxx - hb.mnx) / 2, (hb.mxy - hb.mny) / 2, (hb.mxz - hb.mnz) / 2);
console.log(`  shared normalisation: centre (${cx.toFixed(1)}, ${cy.toFixed(1)}, ${cz.toFixed(1)}) mm, scale ${scale.toFixed(5)} (1/${(1 / scale).toFixed(1)}mm)`);
console.log(`  smoothing skin ${skinSmooth} iters...`);
const skinScene: Mesh = laplacianSmooth({ pos: toScene(skinRas, cx, cy, cz, scale), idx: skinVox.idx }, skinSmooth, 0.5) as Mesh;

// ---- Brain: Surface Nets on the intensity field, HEAD's normalisation ------
console.log(`\nreading brain ${brainFile}...`);
const brainVol = readNifti(brainFile);
console.log(`  dims ${brainVol.dims.join('x')}, pixdim ${brainVol.pixdim.map(p => p.toFixed(2)).join('x')} mm`);
const brainCoarse = boxDownsampleField(brainVol.dims, brainVol.data, brainFactor);
console.log(`  surface nets @ ${BRAIN_THRESHOLD} on ${brainCoarse.dims.join('x')} (factor ${brainFactor})...`);
const brainFull = surfaceNets(brainCoarse.dims, brainCoarse.data, BRAIN_THRESHOLD);
console.log(`  brain (full): ${brainFull.pos.length / 3} verts, ${brainFull.idx.length / 3} tris, boundary edges ${countBoundaryEdges(brainFull)}`);
// Fold-preserving decimation. Grid clustering (decimateMesh.ts) would weld the
// sulcal banks it just cost us full resolution to keep open; QEM collapses the
// cheapest edges first — flat gyral crowns melt while the high-curvature sulcal
// walls stay — so the fold structure survives the triangle-budget cut. Done in
// voxel space (uniform grid) before the affine.
const brainVox = brainTargetTris > 0 && brainFull.idx.length / 3 > brainTargetTris
  ? quadricDecimate(brainFull, brainTargetTris)
  : brainFull;
const brainRas = toRas(brainVox, brainVol.affine, brainFactor);
console.log(`  brain: ${brainVox.pos.length / 3} verts, ${brainVox.idx.length / 3} tris, boundary edges ${countBoundaryEdges(brainVox)}`);

// Verify the brain still nests inside the head in RAS mm (co-registration sanity).
const bb = rasBbox(brainRas);
const fb = (o: typeof hb) => `x[${o.mnx.toFixed(0)},${o.mxx.toFixed(0)}] y[${o.mny.toFixed(0)},${o.mxy.toFixed(0)}] z[${o.mnz.toFixed(0)},${o.mxz.toFixed(0)}]`;
console.log(`  head  RAS ${fb(hb)}`);
console.log(`  brain RAS ${fb(bb)}`);
// Lateral (x) and antero-posterior (y) nesting is the real co-registration test.
// The inferior bound (z-min) gets a looser tolerance: the templates are cropped
// at slightly different neck/brainstem planes, so the brainstem floor can sit a
// few mm below the scalp's neck-rim (hidden inside the head) — a crop diff, not
// a registration error.
const nested = bb.mnx >= hb.mnx - 3 && bb.mxx <= hb.mxx + 3 && bb.mny >= hb.mny - 3 && bb.mxy <= hb.mxy + 3 && bb.mnz >= hb.mnz - 8 && bb.mxz <= hb.mxz + 3;
console.log(`  brain RAS bbox nests inside head: ${nested}\n`);
if (!nested) throw new Error('brain does not nest inside head in RAS mm — the two files are not co-registered as assumed');

const brainScene: Mesh = { pos: toScene(brainRas, cx, cy, cz, scale), idx: brainVox.idx };
console.log(`skin signedVolume ${signedVolume(skinScene).toFixed(4)}, brain signedVolume ${signedVolume(brainScene).toFixed(4)} (loader auto-flips if <0)`);
const sBox = bbox(skinScene.pos), brBox = bbox(brainScene.pos);
console.log(`skin scene bbox  x[${sBox.mn[0].toFixed(2)},${sBox.mx[0].toFixed(2)}] y[${sBox.mn[1].toFixed(2)},${sBox.mx[1].toFixed(2)}] z[${sBox.mn[2].toFixed(2)},${sBox.mx[2].toFixed(2)}]`);
console.log(`brain scene bbox x[${brBox.mn[0].toFixed(2)},${brBox.mx[0].toFixed(2)}] y[${brBox.mn[1].toFixed(2)},${brBox.mx[1].toFixed(2)}] z[${brBox.mn[2].toFixed(2)},${brBox.mx[2].toFixed(2)}]`);

writeBin(path.join(MODELS, 'skin.bin'), skinScene);
writeBin(path.join(MODELS, 'brain.bin'), brainScene);

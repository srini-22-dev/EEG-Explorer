/**
 * Extracts an outer-body isosurface from a whole-head T1 NIfTI volume, as a
 * candidate replacement for the FreeSurfer-watershed `skin.bin` (see the "no
 * ears/nose" investigation this addresses).
 *
 * Run: pnpm --filter @workspace/scripts run extract-skin-nifti -- <input.nii.gz> [factor] [threshold] [smoothIters]
 *
 * Pipeline: NIfTI -> air/tissue threshold -> fill enclosed cavities (so
 * sinuses/ear canals/eye sockets don't punch holes in the shell) -> majority-
 * downsample the mask to the triangle budget -> boundary-face mesh -> voxel
 * space to scanner RAS mm via the file's affine -> the same axis convention
 * processColinMesh.ts's toSceneSpace uses -> Laplacian smooth.
 *
 * Threshold defaults to 3000, MRIcroGL's default lower bound for this data.
 * Otsu picks 3261 on MNI152 unaided, which is close, but a fixed value is
 * reproducible across volumes and is the number the reference render uses.
 *
 * Triangle budget is set by `factor` (the mask downsample), NOT by decimating
 * the finished mesh — see downsampleMask() in isosurface.ts for why that
 * distinction is load-bearing for a surface with a face on it.
 *
 * Does NOT write to skin.bin. This is a candidate for measurement against the
 * existing Colin27-registered skin/brain/electrodes first — see
 * measureNiftiSkinFit.ts. Output goes to scripts/raw/ (gitignored).
 */

import * as path from 'node:path';
import { readNifti } from './nifti';
import { fillEnclosedCavities, downsampleMask, extractBoundaryMesh, laplacianSmooth } from './isosurface';
import { writeBin, type Mesh } from './mesh';

const input = process.argv[2];
if (!input) { console.error('usage: tsx extractSkinFromNifti.ts <input.nii.gz> [factor] [threshold] [smoothIters]'); process.exit(1); }
const factor = Number(process.argv[3] ?? 2);
const threshold = Number(process.argv[4] ?? 3000);
const smoothIters = Number(process.argv[5] ?? 5);

console.log(`reading ${input}...`);
const vol = readNifti(input);
console.log(`dims ${vol.dims.join('x')}, pixdim ${vol.pixdim.map(v => v.toFixed(2)).join('x')} mm`);
console.log(`threshold ${threshold}, downsample factor ${factor}, smoothing ${smoothIters} iters`);

// Threshold + cavity fill at full resolution: a 1mm ear canal has to be found
// before the grid gets coarser than it is.
console.log('filling enclosed cavities...');
const inside = fillEnclosedCavities(vol.dims, vol.data, threshold);
let insideCount = 0;
for (const v of inside) insideCount += v;
console.log(`inside voxels: ${insideCount} (${(insideCount / inside.length * 100).toFixed(1)}% of volume)`);

const coarse = factor > 1 ? downsampleMask(vol.dims, inside, factor) : { dims: vol.dims, inside };
if (factor > 1) console.log(`downsampled mask to ${coarse.dims.join('x')} (${factor * vol.pixdim[0]}mm effective)`);

console.log('extracting boundary mesh...');
const voxelMesh = extractBoundaryMesh(coarse.dims, coarse.inside);
console.log(`mesh: ${voxelMesh.pos.length / 3} verts, ${voxelMesh.idx.length / 3} tris`);

// Coarse-grid index space -> original voxel index space -> scanner RAS mm.
const rasPos = new Float32Array(voxelMesh.pos.length);
for (let i = 0; i < voxelMesh.pos.length; i += 3) {
  const vx = voxelMesh.pos[i] * factor, vy = voxelMesh.pos[i + 1] * factor, vz = voxelMesh.pos[i + 2] * factor;
  const [rx, ry, rz] = [0, 1, 2].map(k =>
    vol.affine[k][0] * vx + vol.affine[k][1] * vy + vol.affine[k][2] * vz + vol.affine[k][3]);
  rasPos[i] = rx; rasPos[i + 1] = ry; rasPos[i + 2] = rz;
}

// Same convention as processColinMesh.ts's toSceneSpace: centre + normalise to
// unit largest semi-axis (self-normalised, since this dataset's own raw bbox
// stats — not the Colin27 ones — are all that's available), then permute
// FreeSurfer/scanner RAS (+x=Right,+y=Anterior,+z=Superior) into scene space
// (+y=Up, +z=Anterior) with the same load-bearing x-negation for winding/handedness.
let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
for (let i = 0; i < rasPos.length; i += 3) {
  mnx = Math.min(mnx, rasPos[i]); mxx = Math.max(mxx, rasPos[i]);
  mny = Math.min(mny, rasPos[i + 1]); mxy = Math.max(mxy, rasPos[i + 1]);
  mnz = Math.min(mnz, rasPos[i + 2]); mxz = Math.max(mxz, rasPos[i + 2]);
}
const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, cz = (mnz + mxz) / 2;
const scale = 1 / Math.max((mxx - mnx) / 2, (mxy - mny) / 2, (mxz - mnz) / 2);
console.log(`self-normalisation: centre (${cx.toFixed(1)}, ${cy.toFixed(1)}, ${cz.toFixed(1)}) mm, scale ${scale.toFixed(5)} (1/${(1 / scale).toFixed(1)}mm)`);

const scenePos = new Float32Array(rasPos.length);
for (let i = 0; i < rasPos.length; i += 3) {
  const rx = (rasPos[i] - cx) * scale;
  const ry = (rasPos[i + 1] - cy) * scale;
  const rz = (rasPos[i + 2] - cz) * scale;
  scenePos[i] = -rx;
  scenePos[i + 1] = rz;
  scenePos[i + 2] = ry;
}

// Just enough to take the voxel staircase off. More than this and the eyelids,
// nostrils and ear folds — the whole reason for going to the raw volume — wash out.
console.log('smoothing...');
const smoothed = laplacianSmooth({ pos: scenePos, idx: voxelMesh.idx }, smoothIters, 0.5);

const outFile = path.join(path.dirname(input), 'mni_skin_candidate.bin');
writeBin(path.resolve(outFile), smoothed as Mesh);

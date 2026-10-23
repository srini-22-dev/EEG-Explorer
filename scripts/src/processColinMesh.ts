// One-off preprocessing script: converts the public-domain Colin27 FreeSurfer
// surface meshes (https://github.com/fangq/Colin27BrainMesh, surf/*.asc) into
// compact binary geometry for the EEG simulator's 3D head panel.
//
// Run once via: pnpm --filter @workspace/scripts run process-colin-mesh -- <rawDir>
//
// Inputs (not checked in — download separately from the source above):
//   <rawDir>/outer_skin.asc, lh_pial.asc, rh_pial.asc
// Outputs:
//   artifacts/eeg-simulator/public/models/{skin,lh_pial,rh_pial}.bin
//
// It does NOT write electrode positions. It used to, by ray-projecting a table of
// hand-authored 10-20 directions onto the scalp — an approach `build1020.ts`
// replaced, because the 10-20 system is defined by arc-length fractions of measured
// circumferences rather than by directions. Re-run `build-1020` after this script.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Mesh, MODELS, bbox, writeBin } from './mesh';

function parseAsc(text: string): Mesh {
  const lines = text.split('\n');
  const [nv, nf] = lines[1].trim().split(/\s+/).map(Number);
  const pos = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const parts = lines[2 + i].trim().split(/\s+/);
    pos[i * 3] = parseFloat(parts[0]);
    pos[i * 3 + 1] = parseFloat(parts[1]);
    pos[i * 3 + 2] = parseFloat(parts[2]);
  }
  const idx = new Uint32Array(nf * 3);
  const faceBase = 2 + nv;
  for (let i = 0; i < nf; i++) {
    const parts = lines[faceBase + i].trim().split(/\s+/);
    idx[i * 3] = parseInt(parts[0], 10);
    idx[i * 3 + 1] = parseInt(parts[1], 10);
    idx[i * 3 + 2] = parseInt(parts[2], 10);
  }
  return { pos, idx };
}

function bboxCenterAndScale(positions: Float32Array) {
  const { mn, mx } = bbox(positions);
  const [cx, cy, cz] = [0, 1, 2].map(k => (mn[k] + mx[k]) / 2);
  const scale = 1 / Math.max(...[0, 1, 2].map(k => (mx[k] - mn[k]) / 2));
  return { cx, cy, cz, scale };
}

// FreeSurfer RAS (+x=Right, +y=Anterior, +z=Superior) -> this scene's convention
// (+y=Up, +z=Anterior/front-of-face-toward-camera), matching electrodePositions3D.ts
// (Fp1 has z>0, O1 has z<0).
//
// The x negation is load-bearing, not a preference. Swapping the Y and Z axes is an
// odd permutation with determinant -1, so on its own it *mirrors* the head rather
// than rotating it. Negating x restores determinant +1. Without it the model is a
// left-handed copy of a real head: with the face toward the camera the anatomical
// right lands on the viewer's right, whereas facing a real patient their right is on
// your left. It also silently reversed every triangle winding, which made all three
// meshes render inside-out (see the guard in HeadModel3D.tsx).
//
// Consequence of the fixed frame: anatomical LEFT is +x, so odd-numbered electrodes
// sit at +x and even-numbered at -x. Nothing should hard-code that — read it off
// lh_pial.bin the way build1020.ts does.
function toSceneSpace(positions: Float32Array, cx: number, cy: number, cz: number, scale: number): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const rx = (positions[i] - cx) * scale;
    const ry = (positions[i + 1] - cy) * scale;
    const rz = (positions[i + 2] - cz) * scale;
    out[i] = -rx;
    out[i + 1] = rz;
    out[i + 2] = ry;
  }
  return out;
}

const RAW_DIR = process.argv[2];
if (!RAW_DIR) {
  console.error('Usage: tsx processColinMesh.ts <rawDir containing outer_skin.asc, lh_pial.asc, rh_pial.asc>');
  process.exit(1);
}

const skinRaw = parseAsc(fs.readFileSync(path.join(RAW_DIR, 'outer_skin.asc'), 'utf-8'));
const lhRaw = parseAsc(fs.readFileSync(path.join(RAW_DIR, 'lh_pial.asc'), 'utf-8'));
const rhRaw = parseAsc(fs.readFileSync(path.join(RAW_DIR, 'rh_pial.asc'), 'utf-8'));

const { cx, cy, cz, scale } = bboxCenterAndScale(skinRaw.pos);
const skin: Mesh = { pos: toSceneSpace(skinRaw.pos, cx, cy, cz, scale), idx: skinRaw.idx };
const lh: Mesh = { pos: toSceneSpace(lhRaw.pos, cx, cy, cz, scale), idx: lhRaw.idx };
const rh: Mesh = { pos: toSceneSpace(rhRaw.pos, cx, cy, cz, scale), idx: rhRaw.idx };

writeBin(path.join(MODELS, 'skin.bin'), skin);
writeBin(path.join(MODELS, 'lh_pial.bin'), lh);
writeBin(path.join(MODELS, 'rh_pial.bin'), rh);

console.log('\nnow run: pnpm --filter @workspace/scripts run build-1020');

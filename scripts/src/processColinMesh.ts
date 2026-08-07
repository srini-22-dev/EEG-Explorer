// One-off preprocessing script: converts the public-domain Colin27 FreeSurfer
// surface meshes (https://github.com/fangq/Colin27BrainMesh, surf/*.asc) into
// compact binary geometry for the EEG simulator's 3D head panel, and
// re-projects the simulator's hand-authored 10-20 electrode directions onto
// the real scalp surface.
//
// Run once via: pnpm --filter @workspace/scripts exec tsx src/processColinMesh.ts
//
// Inputs (not checked in — download separately from the source above):
//   <rawDir>/outer_skin.asc, lh_pial.asc, rh_pial.asc
// Outputs:
//   artifacts/eeg-simulator/public/models/{skin,lh_pial,rh_pial}.bin
//   artifacts/eeg-simulator/src/utils/electrodePositions3D.ts (regenerated)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type Mesh = { positions: Float32Array; indices: Uint32Array };

function parseAsc(text: string): Mesh {
  const lines = text.split('\n');
  const [nv, nf] = lines[1].trim().split(/\s+/).map(Number);
  const positions = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const parts = lines[2 + i].trim().split(/\s+/);
    positions[i * 3] = parseFloat(parts[0]);
    positions[i * 3 + 1] = parseFloat(parts[1]);
    positions[i * 3 + 2] = parseFloat(parts[2]);
  }
  const indices = new Uint32Array(nf * 3);
  const faceBase = 2 + nv;
  for (let i = 0; i < nf; i++) {
    const parts = lines[faceBase + i].trim().split(/\s+/);
    indices[i * 3] = parseInt(parts[0], 10);
    indices[i * 3 + 1] = parseInt(parts[1], 10);
    indices[i * 3 + 2] = parseInt(parts[2], 10);
  }
  return { positions, indices };
}

function bboxCenterAndScale(positions: Float32Array) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const hx = (maxX - minX) / 2, hy = (maxY - minY) / 2, hz = (maxZ - minZ) / 2;
  const scale = 1 / Math.max(hx, hy, hz);
  return { cx, cy, cz, scale };
}

// FreeSurfer RAS (+x=Right, +y=Anterior, +z=Superior) -> this scene's convention
// (+x=Right, +y=Up, +z=Anterior/front-of-face-toward-camera), matching the
// hand-authored electrodePositions3D.ts already in use (Fp1 has z>0, O1 has z<0).
function toSceneSpace(positions: Float32Array, cx: number, cy: number, cz: number, scale: number): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const rx = (positions[i] - cx) * scale;
    const ry = (positions[i + 1] - cy) * scale;
    const rz = (positions[i + 2] - cz) * scale;
    out[i] = rx;
    out[i + 1] = rz;
    out[i + 2] = ry;
  }
  return out;
}

function writeBin(filePath: string, mesh: Mesh) {
  const vCount = mesh.positions.length / 3;
  const fCount = mesh.indices.length / 3;
  const header = Buffer.alloc(8);
  header.writeUInt32LE(vCount, 0);
  header.writeUInt32LE(fCount, 4);
  const buf = Buffer.concat([header, Buffer.from(mesh.positions.buffer), Buffer.from(mesh.indices.buffer)]);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
  console.log(`wrote ${filePath}: ${vCount} verts, ${fCount} faces, ${(buf.length / 1e6).toFixed(2)} MB`);
}

// Möller–Trumbore ray-triangle intersection.
function rayTriangle(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  v0x: number, v0y: number, v0z: number, v1x: number, v1y: number, v1z: number, v2x: number, v2y: number, v2z: number,
): number | null {
  const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
  const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;
  const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
  const a = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(a) < 1e-9) return null;
  const f = 1 / a;
  const sx = ox - v0x, sy = oy - v0y, sz = oz - v0z;
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return null;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = f * (dx * qx + dy * qy + dz * qz);
  if (v < 0 || u + v > 1) return null;
  const t = f * (e2x * qx + e2y * qy + e2z * qz);
  return t > 1e-6 ? t : null;
}

function nearestHit(mesh: Mesh, dx: number, dy: number, dz: number): number | null {
  let best: number | null = null;
  const { positions: p, indices: idx } = mesh;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const t = rayTriangle(
      0, 0, 0, dx, dy, dz,
      p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2],
    );
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

const RAW_DIR = process.argv[2];
if (!RAW_DIR) {
  console.error('Usage: tsx processColinMesh.ts <rawDir containing outer_skin.asc, lh_pial.asc, rh_pial.asc>');
  process.exit(1);
}

const skinRaw = parseAsc(fs.readFileSync(path.join(RAW_DIR, 'outer_skin.asc'), 'utf-8'));
const lhRaw = parseAsc(fs.readFileSync(path.join(RAW_DIR, 'lh_pial.asc'), 'utf-8'));
const rhRaw = parseAsc(fs.readFileSync(path.join(RAW_DIR, 'rh_pial.asc'), 'utf-8'));

const { cx, cy, cz, scale } = bboxCenterAndScale(skinRaw.positions);
const skin: Mesh = { positions: toSceneSpace(skinRaw.positions, cx, cy, cz, scale), indices: skinRaw.indices };
const lh: Mesh = { positions: toSceneSpace(lhRaw.positions, cx, cy, cz, scale), indices: lhRaw.indices };
const rh: Mesh = { positions: toSceneSpace(rhRaw.positions, cx, cy, cz, scale), indices: rhRaw.indices };

const outDir = path.join(__dirname, '../../artifacts/eeg-simulator/public/models');
writeBin(path.join(outDir, 'skin.bin'), skin);
writeBin(path.join(outDir, 'lh_pial.bin'), lh);
writeBin(path.join(outDir, 'rh_pial.bin'), rh);

// Re-project the existing hand-authored electrode directions onto the real scalp mesh.
const electrodePositions3D: Record<string, [number, number, number]> = {
  Fp1: [-0.3, 0.5, 0.85], Fp2: [0.3, 0.5, 0.85],
  F7: [-0.85, 0.3, 0.6], F3: [-0.4, 0.7, 0.6], Fz: [0, 0.8, 0.6], F4: [0.4, 0.7, 0.6], F8: [0.85, 0.3, 0.6],
  T3: [-0.95, 0.1, 0], C3: [-0.5, 0.85, 0], Cz: [0, 1.0, 0], C4: [0.5, 0.85, 0], T4: [0.95, 0.1, 0],
  T5: [-0.85, 0.3, -0.6], P3: [-0.4, 0.7, -0.6], Pz: [0, 0.8, -0.6], P4: [0.4, 0.7, -0.6], T6: [0.85, 0.3, -0.6],
  O1: [-0.3, 0.4, -0.9], O2: [0.3, 0.4, -0.9],
  A1: [-1.0, -0.2, 0.1], A2: [1.0, -0.2, 0.1],
};

const projected: Record<string, [number, number, number]> = {};
for (const [name, [x, y, z]] of Object.entries(electrodePositions3D)) {
  const len = Math.hypot(x, y, z);
  const dx = x / len, dy = y / len, dz = z / len;
  const t = nearestHit(skin, dx, dy, dz);
  if (t === null) {
    console.warn(`no ray hit for ${name}, keeping original direction at r=${len.toFixed(2)}`);
    projected[name] = [x, y, z];
    continue;
  }
  const r = t * 1.02; // sit just proud of the skin surface
  projected[name] = [
    Number((dx * r).toFixed(4)),
    Number((dy * r).toFixed(4)),
    Number((dz * r).toFixed(4)),
  ];
}

const tsOut = `// Electrode scalp positions, projected onto the real Colin27 scalp surface
// (see scripts/src/processColinMesh.ts) along each electrode's original
// hand-authored 10-20 direction. Regenerate via that script if the head
// mesh or electrode set changes.
export const electrodePositions3D: Record<string, [number, number, number]> = {
${Object.entries(projected).map(([name, [x, y, z]]) => `  ${name}: [${x}, ${y}, ${z}],`).join('\n')}
};
`;
const positionsPath = path.join(__dirname, '../../artifacts/eeg-simulator/src/utils/electrodePositions3D.ts');
fs.writeFileSync(positionsPath, tsOut);
console.log(`wrote ${positionsPath}`);

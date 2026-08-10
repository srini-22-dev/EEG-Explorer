/**
 * Converts a GLB head model into the simulator's compact binary mesh format and
 * re-projects the 10-20 electrode positions onto its scalp.
 *
 * Run: pnpm --filter @workspace/scripts run process-head-mesh -- <input.glb>
 *
 * Source model: "Infinite" 3D head scan by Lee Perry-Smith, CC-BY 3.0, obtained
 * from the three.js examples repository. See LICENSE note written alongside the
 * output — the licence requires attribution.
 *
 * The scan is a bust: head plus shoulders and a base. Only the head is wanted, so
 * the script locates the neck automatically (the narrowest horizontal slice
 * between the shoulders and the skull) and discards everything below it. Doing
 * this by bounding box instead would scale the head by the shoulder width and
 * leave every electrode floating.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type Mesh = { positions: Float32Array; indices: Uint32Array };

function parseGlb(file: string): Mesh {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB file');
  let off = 12;
  let json: any = null;
  let bin: Buffer | null = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
    off += (4 - (off % 4)) % 4;
  }
  if (!json || !bin) throw new Error('GLB missing JSON or BIN chunk');

  const readAccessor = (i: number) => {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const comps = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type];
    const n = a.count * comps;
    switch (a.componentType) {
      case 5126: return new Float32Array(bin!.buffer, bin!.byteOffset + start, n);
      case 5125: return new Uint32Array(bin!.buffer, bin!.byteOffset + start, n);
      case 5123: return new Uint16Array(bin!.buffer, bin!.byteOffset + start, n);
      default: throw new Error('unsupported componentType ' + a.componentType);
    }
  };

  const positions: number[] = [];
  const indices: number[] = [];
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      const base = positions.length / 3;
      const p = readAccessor(prim.attributes.POSITION) as Float32Array;
      for (let i = 0; i < p.length; i++) positions.push(p[i]);
      const idx = readAccessor(prim.indices);
      for (let i = 0; i < idx.length; i++) indices.push(base + idx[i]);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/**
 * Find the neck: scan horizontal slices and take the narrowest one in the lower-
 * middle of the model, where a bust transitions from shoulders up into the head.
 */
function findNeckY(pos: Float32Array): number {
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < pos.length; i += 3) { minY = Math.min(minY, pos[i]); maxY = Math.max(maxY, pos[i]); }
  const nSlices = 60;
  let best = -1, bestWidth = Infinity;
  for (let s = 0; s < nSlices; s++) {
    const y0 = minY + ((maxY - minY) * s) / nSlices;
    const y1 = minY + ((maxY - minY) * (s + 1)) / nSlices;
    const frac = (y0 - minY) / (maxY - minY);
    if (frac < 0.15 || frac > 0.62) continue;   // neck is never at the very top or bottom
    let lo = Infinity, hi = -Infinity, count = 0;
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i + 1] >= y0 && pos[i + 1] < y1) { lo = Math.min(lo, pos[i]); hi = Math.max(hi, pos[i]); count++; }
    }
    if (count < 20) continue;
    const width = hi - lo;
    if (width < bestWidth) { bestWidth = width; best = y0; }
  }
  return best;
}

/** Keep only triangles entirely above `cutY`, and drop now-unused vertices. */
function cropAbove(mesh: Mesh, cutY: number): Mesh {
  const keep: number[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ok = [0, 1, 2].every(k => mesh.positions[mesh.indices[i + k] * 3 + 1] >= cutY);
    if (ok) keep.push(mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]);
  }
  const remap = new Map<number, number>();
  const positions: number[] = [];
  const indices: number[] = new Array(keep.length);
  for (let i = 0; i < keep.length; i++) {
    const old = keep[i];
    let n = remap.get(old);
    if (n === undefined) {
      n = positions.length / 3;
      remap.set(old, n);
      positions.push(mesh.positions[old * 3], mesh.positions[old * 3 + 1], mesh.positions[old * 3 + 2]);
    }
    indices[i] = n;
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function bbox(pos: Float32Array) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
  }
  return { mn, mx };
}

function writeBin(file: string, mesh: Mesh) {
  const vCount = mesh.positions.length / 3;
  const fCount = mesh.indices.length / 3;
  const header = Buffer.alloc(8);
  header.writeUInt32LE(vCount, 0);
  header.writeUInt32LE(fCount, 4);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, Buffer.from(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength), Buffer.from(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength)]));
  console.log(`wrote ${file}: ${vCount} verts, ${fCount} tris, ${(8 + mesh.positions.byteLength + mesh.indices.byteLength) / 1e6} MB`);
}

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

/** Farthest hit along a ray — the outer scalp, not an interior surface (eyes, mouth). */
function farthestHit(mesh: Mesh, o: number[], d: number[]): number | null {
  let best: number | null = null;
  const p = mesh.positions, idx = mesh.indices;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const t = rayTriangle(o[0], o[1], o[2], d[0], d[1], d[2],
      p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]);
    if (t !== null && (best === null || t > best)) best = t;
  }
  return best;
}

// The original hand-authored 10-20 directions, before any projection.
const ELECTRODE_DIRECTIONS: Record<string, [number, number, number]> = {
  Fp1: [-0.3, 0.5, 0.85], Fp2: [0.3, 0.5, 0.85],
  F7: [-0.85, 0.3, 0.6], F3: [-0.4, 0.7, 0.6], Fz: [0, 0.8, 0.6], F4: [0.4, 0.7, 0.6], F8: [0.85, 0.3, 0.6],
  T3: [-0.95, 0.1, 0], C3: [-0.5, 0.85, 0], Cz: [0, 1.0, 0], C4: [0.5, 0.85, 0], T4: [0.95, 0.1, 0],
  T5: [-0.85, 0.3, -0.6], P3: [-0.4, 0.7, -0.6], Pz: [0, 0.8, -0.6], P4: [0.4, 0.7, -0.6], T6: [0.85, 0.3, -0.6],
  O1: [-0.3, 0.4, -0.9], O2: [0.3, 0.4, -0.9],
  A1: [-1.0, -0.2, 0.1], A2: [1.0, -0.2, 0.1],
};

const input = process.argv[2];
if (!input) { console.error('usage: tsx processHeadMesh.ts <input.glb>'); process.exit(1); }

const raw = parseGlb(input);
console.log(`parsed: ${raw.positions.length / 3} verts, ${raw.indices.length / 3} tris`);

const neckY = findNeckY(raw.positions);
console.log(`neck detected at y = ${neckY.toFixed(3)}`);
const head = cropAbove(raw, neckY);
console.log(`cropped head: ${head.positions.length / 3} verts, ${head.indices.length / 3} tris`);

// Normalise into scene space: centre the head and scale so its largest semi-axis
// is 1, matching the convention the Colin27 meshes already use.
const bb = bbox(head.positions);
const centre = [0, 1, 2].map(k => (bb.mn[k] + bb.mx[k]) / 2);
const semi = [0, 1, 2].map(k => (bb.mx[k] - bb.mn[k]) / 2);
const scale = 1 / Math.max(...semi);
console.log(`head bbox semi-axes: ${semi.map(v => v.toFixed(2)).join(', ')}  scale=${scale.toFixed(4)}`);

const norm = new Float32Array(head.positions.length);
for (let i = 0; i < head.positions.length; i += 3) {
  norm[i] = (head.positions[i] - centre[0]) * scale;
  norm[i + 1] = (head.positions[i + 1] - centre[1]) * scale;
  norm[i + 2] = (head.positions[i + 2] - centre[2]) * scale;
}
const normMesh: Mesh = { positions: norm, indices: head.indices };

const outDir = path.join(__dirname, '../../artifacts/eeg-simulator/public/models');
writeBin(path.join(outDir, 'head_face.bin'), normMesh);
fs.copyFileSync(
  path.join(path.dirname(input), 'LeePerrySmith_License.txt'),
  path.join(outDir, 'head_face_LICENSE.txt'),
);

// Project electrodes onto the scalp. Rays start at the head centre and take the
// FARTHEST hit: a face scan has interior geometry (eye sockets, mouth cavity),
// and the nearest hit would sink electrodes inside the head.
const origin = [0, 0, 0];
const projected: Record<string, [number, number, number]> = {};
let misses = 0;
for (const [name, dir] of Object.entries(ELECTRODE_DIRECTIONS)) {
  const len = Math.hypot(...dir);
  const d = dir.map(v => v / len);
  const t = farthestHit(normMesh, origin, d);
  if (t === null) {
    misses++;
    console.warn(`  no scalp hit for ${name} — keeping unprojected direction`);
    projected[name] = dir;
    continue;
  }
  const r = t * 1.02;
  projected[name] = [
    Number((d[0] * r).toFixed(4)),
    Number((d[1] * r).toFixed(4)),
    Number((d[2] * r).toFixed(4)),
  ];
}
console.log(`projected ${Object.keys(projected).length - misses}/${Object.keys(projected).length} electrodes`);

const ts = `// Electrode scalp positions, projected onto the head mesh by
// scripts/src/processHeadMesh.ts along each electrode's hand-authored 10-20
// direction. Regenerate with that script if the head model changes.
export const electrodePositions3D: Record<string, [number, number, number]> = {
${Object.entries(projected).map(([n, [x, y, z]]) => `  ${n}: [${x}, ${y}, ${z}],`).join('\n')}
};
`;
fs.writeFileSync(path.join(__dirname, '../../artifacts/eeg-simulator/src/utils/electrodePositions3D.ts'), ts);
console.log('wrote electrodePositions3D.ts');

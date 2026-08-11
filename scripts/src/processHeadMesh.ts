/**
 * Converts a GLB head model into the simulator's compact binary mesh format.
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
 * this by bounding box instead would scale the head by the shoulder width.
 *
 * NOT WIRED IN. `head_face.bin` is not rendered and electrodes are not built on
 * it — see the "Why not head_face.bin" note at the foot of build1020.ts for the
 * two measured reasons. This script is kept so that evaluation is reproducible.
 * It deliberately does not write electrodePositions3D.ts; build1020.ts owns that.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Mesh, MODELS, bbox, writeBin } from './mesh';

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
  return { pos: new Float32Array(positions), idx: new Uint32Array(indices) };
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
  for (let i = 0; i < mesh.idx.length; i += 3) {
    const ok = [0, 1, 2].every(k => mesh.pos[mesh.idx[i + k] * 3 + 1] >= cutY);
    if (ok) keep.push(mesh.idx[i], mesh.idx[i + 1], mesh.idx[i + 2]);
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
      positions.push(mesh.pos[old * 3], mesh.pos[old * 3 + 1], mesh.pos[old * 3 + 2]);
    }
    indices[i] = n;
  }
  return { pos: new Float32Array(positions), idx: new Uint32Array(indices) };
}

const input = process.argv[2];
if (!input) { console.error('usage: tsx processHeadMesh.ts <input.glb>'); process.exit(1); }

const raw = parseGlb(input);
console.log(`parsed: ${raw.pos.length / 3} verts, ${raw.idx.length / 3} tris`);

const neckY = findNeckY(raw.pos);
console.log(`neck detected at y = ${neckY.toFixed(3)}`);
const head = cropAbove(raw, neckY);
console.log(`cropped head: ${head.pos.length / 3} verts, ${head.idx.length / 3} tris`);

// Normalise into scene space: centre the head and scale so its largest semi-axis
// is 1, matching the convention the Colin27 meshes already use.
const bb = bbox(head.pos);
const centre = [0, 1, 2].map(k => (bb.mn[k] + bb.mx[k]) / 2);
const semi = [0, 1, 2].map(k => (bb.mx[k] - bb.mn[k]) / 2);
const scale = 1 / Math.max(...semi);
console.log(`head bbox semi-axes: ${semi.map(v => v.toFixed(2)).join(', ')}  scale=${scale.toFixed(4)}`);

const norm = new Float32Array(head.pos.length);
for (let i = 0; i < head.pos.length; i += 3) {
  norm[i] = (head.pos[i] - centre[0]) * scale;
  norm[i + 1] = (head.pos[i + 1] - centre[1]) * scale;
  norm[i + 2] = (head.pos[i + 2] - centre[2]) * scale;
}

writeBin(path.join(MODELS, 'head_face.bin'), { pos: norm, idx: head.idx });
fs.copyFileSync(
  path.join(path.dirname(input), 'LeePerrySmith_License.txt'),
  path.join(MODELS, 'head_face_LICENSE.txt'),
);

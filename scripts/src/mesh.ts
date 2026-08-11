/**
 * Shared mesh geometry for the head-model scripts.
 *
 * The binary mesh format used throughout, and read by `useMeshBin` in
 * HeadModel3D.tsx:
 *
 *   [vertexCount: u32][faceCount: u32][positions: f32 × v × 3][indices: u32 × f × 3]
 *
 * all little-endian. Positions are in scene space: +x anatomical LEFT, +y up,
 * +z anterior, scaled so the scalp's largest semi-axis is 1. That frame is
 * established by `toSceneSpace` in processColinMesh.ts — read the note there
 * before changing anything here.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Directory holding the exported meshes the simulator fetches at runtime. */
export const MODELS = path.join(__dirname, '../../artifacts/eeg-simulator/public/models');

export type Vec3 = [number, number, number];
export type Mesh = { pos: Float32Array; idx: Uint32Array };

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: Vec3) => Math.sqrt(dot(a, a));
export const unit = (a: Vec3): Vec3 => mul(a, 1 / (len(a) || 1));
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Reads a mesh binary. The typed arrays are views onto the file buffer, so
 * mutating them and writing the same Buffer back edits the file in place —
 * fixMeshFrame.ts relies on this.
 */
export function readBinAt(file: string): Mesh & { buf: Buffer } {
  const buf = fs.readFileSync(file);
  const v = buf.readUInt32LE(0), f = buf.readUInt32LE(4);
  return {
    buf,
    pos: new Float32Array(buf.buffer, buf.byteOffset + 8, v * 3),
    idx: new Uint32Array(buf.buffer, buf.byteOffset + 8 + v * 3 * 4, f * 3),
  };
}

/** As `readBinAt`, resolved against the models directory. */
export const readBin = (name: string): Mesh => readBinAt(path.join(MODELS, name));

export function writeBin(file: string, m: Mesh) {
  const v = m.pos.length / 3, f = m.idx.length / 3;
  const header = Buffer.alloc(8);
  header.writeUInt32LE(v, 0);
  header.writeUInt32LE(f, 4);
  const buf = Buffer.concat([
    header,
    Buffer.from(m.pos.buffer, m.pos.byteOffset, m.pos.byteLength),
    Buffer.from(m.idx.buffer, m.idx.byteOffset, m.idx.byteLength),
  ]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  console.log(`wrote ${file}: ${v} verts, ${f} tris, ${(buf.length / 1e6).toFixed(2)} MB`);
}

/**
 * Signed volume of a closed triangle mesh (divergence theorem). The sign reports
 * the winding: positive means counter-clockwise faces with outward normals.
 * A reflection flips it, which makes this a reliable detector for a mirrored mesh.
 */
export function signedVolume(m: Mesh): number {
  const p = m.pos, idx = m.idx;
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return v;
}

/**
 * Möller–Trumbore ray-triangle intersection, returning the ray parameter t.
 * Takes loose scalars rather than Vec3 tuples: this is the innermost loop of
 * every cast below, run once per face per ray, and tuple allocation dominates
 * the arithmetic otherwise.
 */
export function rayTri(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  p: Float32Array, a: number, b: number, c: number,
): number | null {
  const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
  const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
  const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) < 1e-12) return null;
  const f = 1 / det;
  const sx = ox - p[a], sy = oy - p[a + 1], sz = oz - p[a + 2];
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return null;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = f * (dx * qx + dy * qy + dz * qz);
  if (v < 0 || u + v > 1) return null;
  const t = f * (e2x * qx + e2y * qy + e2z * qz);
  return t > 1e-6 ? t : null;
}

/**
 * Distance from `o` along `d` to the mesh surface.
 *
 * Defaults to the FARTHEST hit, which is what scalp projection wants: both the
 * BEM shell and the face scan carry interior geometry (ventricles, eye sockets,
 * mouth cavity), and the nearest hit would seat electrodes inside the head.
 */
export function castDist(m: Mesh, o: Vec3, d: Vec3, pick: 'far' | 'near' = 'far'): number | null {
  let best: number | null = null;
  const p = m.pos, idx = m.idx;
  for (let i = 0; i < idx.length; i += 3) {
    const t = rayTri(o[0], o[1], o[2], d[0], d[1], d[2],
      p, idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3);
    if (t === null) continue;
    if (best === null || (pick === 'far' ? t > best : t < best)) best = t;
  }
  return best;
}

/** The surface point itself, or null if the ray misses. */
export function cast(m: Mesh, o: Vec3, d: Vec3, pick: 'far' | 'near' = 'far'): Vec3 | null {
  const t = castDist(m, o, d, pick);
  return t === null ? null : add(o, mul(d, t));
}

/** Axis-aligned bounds as {mn, mx} triples. */
export function bbox(pos: Float32Array) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (pos[i + k] < mn[k]) mn[k] = pos[i + k];
      if (pos[i + k] > mx[k]) mx[k] = pos[i + k];
    }
  }
  return { mn, mx };
}

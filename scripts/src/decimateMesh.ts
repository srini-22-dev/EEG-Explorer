/**
 * Decimates a surface mesh by grid vertex clustering.
 *
 * Run: pnpm --filter @workspace/scripts run decimate-mesh [targetVerts]
 *
 * The Colin27 pial surfaces arrive at full FreeSurfer resolution — ~171k vertices
 * and 342k triangles per hemisphere, 5.9 MB each. That is ~17x the vertex density
 * of `skin.bin`, the scalp shell they sit inside, and all of it goes through the
 * blended transparent pass on every frame. For a teaching model rendered at a fixed
 * camera distance behind a semi-transparent scalp, the fold pattern reads from
 * shading, not from vertex count.
 *
 * Method: snap vertices to a uniform grid, replace each occupied cell with the
 * centroid of the vertices that fell in it, remap the triangles and drop the ones
 * that collapsed. Chosen over quadric edge collapse because it is ~50 lines instead
 * of ~250 and the quality difference does not survive being viewed through a
 * translucent head. It welds the opposing banks of a sulcus once the cell exceeds
 * the sulcal gap, which is why the geometric error is measured and reported rather
 * than assumed.
 *
 * `skin.bin` is deliberately NOT decimated: build1020.ts ray-casts the 10-20
 * positions onto it, so changing it would move the electrodes.
 */

import * as path from 'node:path';
import { type Mesh, MODELS, bbox, readBin, signedVolume, writeBin } from './mesh';

/** Scene units to millimetres — the scalp's largest semi-axis is 1 unit ≈ 9.5 cm. */
const MM_PER_UNIT = 95;

type Decimated = Mesh & { meanErr: number; maxErr: number };

/**
 * Cluster vertices onto a `cells`-per-longest-axis grid.
 *
 * The representative is the cell centroid rather than an arbitrary member, which
 * keeps the surface centred in its original position instead of letting it drift
 * toward whichever vertex happened to be visited first.
 */
function cluster(m: Mesh, cells: number): Decimated {
  const { mn, mx } = bbox(m.pos);
  const extent = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  const cell = extent / cells;
  const stride = cells + 2;

  const nV = m.pos.length / 3;
  const cellOf = new Int32Array(nV);
  const index = new Map<number, number>();
  const sum: number[] = [];
  const count: number[] = [];

  for (let i = 0; i < nV; i++) {
    const ix = Math.floor((m.pos[i * 3] - mn[0]) / cell);
    const iy = Math.floor((m.pos[i * 3 + 1] - mn[1]) / cell);
    const iz = Math.floor((m.pos[i * 3 + 2] - mn[2]) / cell);
    const key = ix + iy * stride + iz * stride * stride;
    let c = index.get(key);
    if (c === undefined) {
      c = count.length;
      index.set(key, c);
      sum.push(0, 0, 0);
      count.push(0);
    }
    cellOf[i] = c;
    sum[c * 3] += m.pos[i * 3];
    sum[c * 3 + 1] += m.pos[i * 3 + 1];
    sum[c * 3 + 2] += m.pos[i * 3 + 2];
    count[c]++;
  }

  const pos = new Float32Array(count.length * 3);
  for (let c = 0; c < count.length; c++) {
    pos[c * 3] = sum[c * 3] / count[c];
    pos[c * 3 + 1] = sum[c * 3 + 1] / count[c];
    pos[c * 3 + 2] = sum[c * 3 + 2] / count[c];
  }

  // How far each original vertex moved to reach its representative. This is the
  // honest quality number: it is what the surface actually lost.
  let errSum = 0, maxErr = 0;
  for (let i = 0; i < nV; i++) {
    const c = cellOf[i];
    const dx = m.pos[i * 3] - pos[c * 3];
    const dy = m.pos[i * 3 + 1] - pos[c * 3 + 1];
    const dz = m.pos[i * 3 + 2] - pos[c * 3 + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    errSum += d;
    if (d > maxErr) maxErr = d;
  }

  // Triangles whose corners no longer land in three distinct cells have collapsed
  // to an edge or a point and carry no area; keeping them would only feed
  // degenerate normals to computeVertexNormals().
  const kept: number[] = [];
  for (let i = 0; i < m.idx.length; i += 3) {
    const a = cellOf[m.idx[i]], b = cellOf[m.idx[i + 1]], c = cellOf[m.idx[i + 2]];
    if (a !== b && b !== c && a !== c) kept.push(a, b, c);
  }

  return { pos, idx: new Uint32Array(kept), meanErr: errSum / nV, maxErr };
}

/**
 * Find the grid resolution that lands nearest `target` vertices. Cluster count is
 * monotonic in `cells`, so a bisection converges; the surface is two-dimensional
 * inside a three-dimensional grid, which makes the relationship closer to
 * quadratic than cubic and not worth solving analytically.
 */
function decimateTo(m: Mesh, target: number): Decimated {
  let lo = 8, hi = 1024;
  let best = cluster(m, lo);
  for (let step = 0; step < 18 && lo < hi; step++) {
    const mid = (lo + hi) >> 1;
    const out = cluster(m, mid);
    const n = out.pos.length / 3;
    if (Math.abs(n - target) < Math.abs(best.pos.length / 3 - target)) best = out;
    if (n < target) lo = mid + 1; else hi = mid;
  }
  return best;
}

const target = Number(process.argv[2] ?? 25000);
if (!Number.isFinite(target) || target < 100) {
  console.error('usage: tsx decimateMesh.ts [targetVerts]');
  process.exit(1);
}

for (const file of ['lh_pial.bin', 'rh_pial.bin']) {
  const src = readBin(file);
  const before = { v: src.pos.length / 3, t: src.idx.length / 3, vol: signedVolume(src) };

  // Idempotent, like fixMeshFrame.ts. This rewrites its own input, and the raw
  // FreeSurfer .asc sources are not checked in, so a second run would quietly
  // decimate an already-decimated surface with no way back.
  if (before.v <= target * 1.05) {
    console.log(`${file}: already ${before.v} verts (target ${target}), unchanged`);
    continue;
  }

  const out = decimateTo(src, target);
  const after = { v: out.pos.length / 3, t: out.idx.length / 3, vol: signedVolume(out) };
  const volDelta = ((after.vol - before.vol) / before.vol) * 100;

  console.log(`\n${file}`);
  console.log(`  verts  ${before.v} -> ${after.v}  (${(after.v / before.v * 100).toFixed(1)}%)`);
  console.log(`  tris   ${before.t} -> ${after.t}  (${(after.t / before.t * 100).toFixed(1)}%)`);
  console.log(`  volume ${before.vol.toFixed(4)} -> ${after.vol.toFixed(4)}  (${volDelta >= 0 ? '+' : ''}${volDelta.toFixed(2)}%)`);
  console.log(`  error  mean ${(out.meanErr * MM_PER_UNIT).toFixed(2)} mm, max ${(out.maxErr * MM_PER_UNIT).toFixed(2)} mm`);

  writeBin(path.join(MODELS, file), { pos: out.pos, idx: out.idx });
}

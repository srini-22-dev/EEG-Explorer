/**
 * Builds the display-resolution head meshes the simulator actually downloads.
 *
 * Run: pnpm --filter @workspace/scripts run compress-meshes [brainTris=55000] [skinTris=30000]
 *
 * `buildHeadAndBrain.ts` emits skin.bin and brain.bin at analysis resolution —
 * together ~9 MB and ~507k triangles. That is the right resolution for the
 * geometry to be *measured* against, and the wrong one to ship: the browser pays
 * for it on every load and on every frame, and the 3D panel is a teaching
 * orientation aid rendered at a fixed camera distance behind a translucent scalp.
 *
 * So this writes SEPARATE `*_lod.bin` files rather than shrinking the originals.
 * That split is not tidiness — it is required:
 *
 *   - `build1020.ts` ray-casts the 10-20 positions onto skin.bin to generate
 *     electrodePositions3D.ts. Decimating skin.bin in place would move every
 *     electrode the next time that script runs, silently.
 *   - The masters stay the reference surface for any future measurement.
 *
 * Only the LOD pair is fetched at runtime (see `useMeshBin` in HeadModel3D).
 *
 * QEM (quadricDecimate) rather than the grid clustering in decimateMesh.ts, for
 * the reason that file gives: clustering welds the opposing banks of a sulcus as
 * soon as its cell exceeds the sulcal gap, re-closing exactly the folds
 * buildHeadAndBrain runs at full resolution to keep open. QEM collapses the
 * cheapest edge first, so flat gyral crowns melt while high-curvature sulcal
 * walls survive.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { type Mesh, MODELS, bbox, castDist, readBin, signedVolume, writeBin } from './mesh';
import { quadricDecimate } from './quadricDecimate';
import { electrodePositions3D } from '../../artifacts/eeg-simulator/src/utils/electrodePositions3D';

/** Scene units to millimetres — the scalp's largest semi-axis is 1 unit ~ 9.5 cm. */
const MM_PER_UNIT = 95;

/** Squared distance from a point to a triangle (Ericson, Real-Time Collision Detection §5.1.5). */
function pointTriDist2(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let qx: number, qy: number, qz: number;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
  else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; }
    else {
      const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
      const d5 = abx * cpx + aby * cpy + abz * cpz;
      const d6 = acx * cpx + acy * cpy + acz * cpz;
      if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; }
      else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) {
          const v = d1 / (d1 - d3);
          qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v;
        } else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w;
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
              qx = bx + (cx - bx) * w; qy = by + (cy - by) * w; qz = bz + (cz - bz) * w;
            } else {
              const denom = 1 / (va + vb + vc);
              const v = vb * denom, w = vc * denom;
              qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
            }
          }
        }
      }
    }
  }
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * How far the surface actually moved, in mm: true point-to-TRIANGLE distance
 * from original vertices to the decimated surface.
 *
 * The obvious cheap version — distance to the nearest surviving *vertex* — was
 * tried first and is worthless as a quality gate. It over-reports wherever a
 * dense patch of original vertices sits above one large flat LOD triangle, and
 * because that bias is about triangle *size* rather than surface error, raising
 * the triangle budget did not reduce it. Measuring against the triangles removes
 * the bias, at the cost of needing a spatial index and a sample rather than
 * every vertex.
 *
 * Triangles are binned by the cells their bounding box overlaps; a query walks
 * outward in shells and stops once the next shell cannot beat the best distance
 * found so far, which makes the result exact for the sampled points rather than
 * a nearest-cell approximation.
 */
function deviationMm(orig: Mesh, lod: Mesh, sampleCount = 20000): { mean: number; max: number; p95: number } {
  const { mn, mx } = bbox(lod.pos);
  const extent = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  const nTri = lod.idx.length / 3;
  const cells = Math.max(4, Math.min(96, Math.ceil(Math.cbrt(nTri))));
  const cell = extent / cells;
  const stride = cells + 3;
  const at = (ix: number, iy: number, iz: number) => ix + iy * stride + iz * stride * stride;
  const clamp = (i: number) => Math.min(cells + 1, Math.max(0, i));
  const cellOf = (v: number, k: number) => clamp(Math.floor((v - mn[k]) / cell));

  const bucket = new Map<number, number[]>();
  for (let f = 0; f < nTri; f++) {
    const a = lod.idx[f * 3] * 3, b = lod.idx[f * 3 + 1] * 3, c = lod.idx[f * 3 + 2] * 3;
    // Bin over the triangle's whole bbox so a long triangle is reachable from
    // every cell it crosses, not just the one holding its first corner.
    const lo0 = cellOf(Math.min(lod.pos[a], lod.pos[b], lod.pos[c]), 0);
    const hi0 = cellOf(Math.max(lod.pos[a], lod.pos[b], lod.pos[c]), 0);
    const lo1 = cellOf(Math.min(lod.pos[a + 1], lod.pos[b + 1], lod.pos[c + 1]), 1);
    const hi1 = cellOf(Math.max(lod.pos[a + 1], lod.pos[b + 1], lod.pos[c + 1]), 1);
    const lo2 = cellOf(Math.min(lod.pos[a + 2], lod.pos[b + 2], lod.pos[c + 2]), 2);
    const hi2 = cellOf(Math.max(lod.pos[a + 2], lod.pos[b + 2], lod.pos[c + 2]), 2);
    for (let iz = lo2; iz <= hi2; iz++) for (let iy = lo1; iy <= hi1; iy++) for (let ix = lo0; ix <= hi0; ix++) {
      const key = at(ix, iy, iz);
      const arr = bucket.get(key);
      if (arr) arr.push(f); else bucket.set(key, [f]);
    }
  }

  const nOrig = orig.pos.length / 3;
  const step = Math.max(1, Math.floor(nOrig / sampleCount));
  const dists: number[] = [];
  let sum = 0, max = 0;
  for (let i = 0; i < nOrig; i += step) {
    const px = orig.pos[i * 3], py = orig.pos[i * 3 + 1], pz = orig.pos[i * 3 + 2];
    const ix = cellOf(px, 0), iy = cellOf(py, 1), iz = cellOf(pz, 2);
    let best = Infinity;
    for (let r = 0; r <= cells; r++) {
      // Everything in shell r is at least (r-1)*cell away; once that floor
      // exceeds the best distance so far, no further shell can improve it.
      if (best < Infinity && (r - 1) * cell * (r - 1) * cell > best) break;
      for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) < r) continue; // shell only
        const arr = bucket.get(at(ix + dx, iy + dy, iz + dz));
        if (!arr) continue;
        for (const f of arr) {
          const a = lod.idx[f * 3] * 3, b = lod.idx[f * 3 + 1] * 3, c = lod.idx[f * 3 + 2] * 3;
          const d2 = pointTriDist2(px, py, pz,
            lod.pos[a], lod.pos[a + 1], lod.pos[a + 2],
            lod.pos[b], lod.pos[b + 1], lod.pos[b + 2],
            lod.pos[c], lod.pos[c + 1], lod.pos[c + 2]);
          if (d2 < best) best = d2;
        }
      }
    }
    const d = Math.sqrt(best) * MM_PER_UNIT;
    dists.push(d);
    sum += d;
    if (d > max) max = d;
  }
  dists.sort((x, y) => x - y);
  return { mean: sum / dists.length, max, p95: dists[Math.floor(dists.length * 0.95)] };
}

/**
 * Do the 21 electrode markers still sit OUTSIDE the decimated scalp?
 *
 * This is the failure that would actually be visible: electrodePositions3D.ts is
 * a frozen table generated against full-resolution skin.bin and seated 2% proud
 * of it, so if decimation pulls the surface outward anywhere under a marker, the
 * marker sinks into the head. Cast from the origin through each electrode and
 * compare the surface crossing against the electrode's own radius.
 *
 * Positive clearance = marker proud of the scalp, which is what we want.
 */
function electrodeClearanceMm(lod: Mesh): { worst: string; worstMm: number; sunk: string[] } {
  let worst = '', worstMm = Infinity;
  const sunk: string[] = [];
  for (const [name, p] of Object.entries(electrodePositions3D)) {
    const r = Math.hypot(p[0], p[1], p[2]);
    if (r < 1e-6) continue;
    const dir: [number, number, number] = [p[0] / r, p[1] / r, p[2] / r];
    // 'far' matches build1020's own convention: the scalp shell carries interior
    // geometry (orbits, sinuses), and the nearest hit would be one of those.
    const t = castDist(lod, [0, 0, 0], dir, 'far');
    if (t === null) continue; // ray missed entirely — not a seating question
    const clearance = (r - t) * MM_PER_UNIT;
    if (clearance < worstMm) { worstMm = clearance; worst = name; }
    if (clearance < 0) sunk.push(name);
  }
  return { worst, worstMm, sunk };
}

const brainTris = Number(process.argv[2] ?? 55000);
const skinTris = Number(process.argv[3] ?? 30000);
if (!Number.isFinite(brainTris) || !Number.isFinite(skinTris) || brainTris < 100 || skinTris < 100) {
  console.error('usage: tsx compressMeshes.ts [brainTris] [skinTris]');
  process.exit(1);
}

const JOBS: { src: string; out: string; target: number }[] = [
  { src: 'brain.bin', out: 'brain_lod.bin', target: brainTris },
  { src: 'skin.bin', out: 'skin_lod.bin', target: skinTris },
];

let bytesBefore = 0, bytesAfter = 0;

for (const job of JOBS) {
  const srcPath = path.join(MODELS, job.src);
  if (!fs.existsSync(srcPath)) {
    throw new Error(`${job.src} not found — run build-head-brain first`);
  }
  // Read into fresh arrays: quadricDecimate reads them repeatedly and readBin
  // hands back views onto the file Buffer.
  const raw = readBin(job.src);
  const src: Mesh = { pos: Float32Array.from(raw.pos), idx: Uint32Array.from(raw.idx) };
  const beforeTris = src.idx.length / 3;
  const beforeBytes = fs.statSync(srcPath).size;
  bytesBefore += beforeBytes;

  console.log(`\n${job.src} -> ${job.out}`);
  if (beforeTris <= job.target) {
    console.log(`  already ${beforeTris} tris (target ${job.target}) — copying unchanged`);
    writeBin(path.join(MODELS, job.out), src);
    bytesAfter += fs.statSync(path.join(MODELS, job.out)).size;
    continue;
  }

  const lod = quadricDecimate(src, job.target);
  const outPath = path.join(MODELS, job.out);
  writeBin(outPath, lod);
  const afterBytes = fs.statSync(outPath).size;
  bytesAfter += afterBytes;

  const volBefore = signedVolume(src), volAfter = signedVolume(lod);
  const dev = deviationMm(src, lod);
  console.log(`  tris   ${beforeTris} -> ${lod.idx.length / 3}  (${(lod.idx.length / 3 / beforeTris * 100).toFixed(1)}%)`);
  console.log(`  verts  ${src.pos.length / 3} -> ${lod.pos.length / 3}`);
  console.log(`  bytes  ${(beforeBytes / 1e6).toFixed(2)} MB -> ${(afterBytes / 1e6).toFixed(2)} MB  (${(afterBytes / beforeBytes * 100).toFixed(1)}%)`);
  console.log(`  volume ${volBefore.toFixed(4)} -> ${volAfter.toFixed(4)}  (${((volAfter - volBefore) / volBefore * 100).toFixed(2)}%)`);
  console.log(`  surface deviation: mean ${dev.mean.toFixed(2)} mm, p95 ${dev.p95.toFixed(2)} mm, max ${dev.max.toFixed(2)} mm`);

  // The scalp carries the electrode markers; the brain does not, so this check
  // only means something for skin.
  if (job.src === 'skin.bin') {
    const c = electrodeClearanceMm(lod);
    console.log(`  electrode seating: tightest ${c.worst} at +${c.worstMm.toFixed(2)} mm proud`);
    if (c.sunk.length) {
      throw new Error(
        `decimation sank ${c.sunk.length} electrode(s) below the scalp: ${c.sunk.join(', ')} — ` +
        `raise the skin triangle target`,
      );
    }
  }
}

console.log(`\ntotal fetched by the browser: ${(bytesBefore / 1e6).toFixed(2)} MB -> ${(bytesAfter / 1e6).toFixed(2)} MB  (${(bytesAfter / bytesBefore * 100).toFixed(1)}%)`);

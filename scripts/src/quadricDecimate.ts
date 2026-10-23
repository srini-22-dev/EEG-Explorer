/**
 * Quadric-error-metric (Garland-Heckbert) edge-collapse mesh simplification.
 *
 * Why this exists alongside decimateMesh.ts: grid clustering welds the opposing
 * banks of a sulcus as soon as its cell exceeds the sulcal gap, which re-bridges
 * exactly the cortical folds buildHeadAndBrain.ts extracts at full resolution to
 * keep open. QEM instead collapses the cheapest edge first, where "cheap" is the
 * squared distance the collapse moves the surface off the planes of the faces
 * that met at it — so flat gyral crowns simplify hard while the high-curvature
 * sulcal walls are kept. That is the whole point: shrink the triangle budget
 * without filling the folds.
 *
 * Each vertex carries a quadric Q (the summed outer products of its incident
 * face planes, as a symmetric 4x4 in 10 coefficients); an edge's cost is the
 * quadric error at the optimal contraction point. Open boundaries (the brainstem
 * crop rim) get heavily-weighted perpendicular constraint planes so they hold
 * their shape, and any collapse that would flip a face normal is rejected so the
 * surface never folds through itself.
 */

import { type Mesh } from './mesh';

// Quadric stored as [xx, xy, xz, xw, yy, yz, yw, zz, zw, ww] (symmetric 4x4).
type Q = Float64Array;

function qAddPlane(q: Q, o: number, a: number, b: number, c: number, d: number, w: number) {
  q[o] += w * a * a; q[o + 1] += w * a * b; q[o + 2] += w * a * c; q[o + 3] += w * a * d;
  q[o + 4] += w * b * b; q[o + 5] += w * b * c; q[o + 6] += w * b * d;
  q[o + 7] += w * c * c; q[o + 8] += w * c * d;
  q[o + 9] += w * d * d;
}

/** Quadric error v^T Q v at point (x,y,z), Q taken from q[o..o+9]. */
function qError(q: Q, o: number, x: number, y: number, z: number): number {
  return q[o] * x * x + 2 * q[o + 1] * x * y + 2 * q[o + 2] * x * z + 2 * q[o + 3] * x
    + q[o + 4] * y * y + 2 * q[o + 5] * y * z + 2 * q[o + 6] * y
    + q[o + 7] * z * z + 2 * q[o + 8] * z + q[o + 9];
}

/** Solve the 3x3 [Q]v = -[linear] for the error-minimising point; null if near-singular. */
function qOptimum(q: Q, o: number): [number, number, number] | null {
  const a = q[o], b = q[o + 1], c = q[o + 2], e = q[o + 4], f = q[o + 5], g = q[o + 7];
  // Cofactors of the symmetric 3x3 [[a,b,c],[b,e,f],[c,f,g]].
  const c00 = e * g - f * f, c01 = c * f - b * g, c02 = b * f - c * e;
  const det = a * c00 + b * c01 + c * c02;
  if (Math.abs(det) < 1e-10) return null;
  const c11 = a * g - c * c, c12 = b * c - a * f, c22 = a * e - b * b;
  const bx = -q[o + 3], by = -q[o + 6], bz = -q[o + 8];
  const inv = 1 / det;
  return [
    (c00 * bx + c01 * by + c02 * bz) * inv,
    (c01 * bx + c11 * by + c12 * bz) * inv,
    (c02 * bx + c12 * by + c22 * bz) * inv,
  ];
}

// Binary min-heap of edge records, each [cost, v1, v2, tx, ty, tz, ver1, ver2].
type Rec = [number, number, number, number, number, number, number, number];
function heapPush(h: Rec[], r: Rec) {
  h.push(r);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]]; i = p;
  }
}
function heapPop(h: Rec[]): Rec | undefined {
  if (h.length === 0) return undefined;
  const top = h[0], last = h.pop()!;
  if (h.length === 0) return top;
  h[0] = last;
  let i = 0;
  for (;;) {
    const l = 2 * i + 1, r = 2 * i + 2; let s = i;
    if (l < h.length && h[l][0] < h[s][0]) s = l;
    if (r < h.length && h[r][0] < h[s][0]) s = r;
    if (s === i) break;
    [h[s], h[i]] = [h[i], h[s]]; i = s;
  }
  return top;
}

export function quadricDecimate(mesh: Mesh, targetTris: number): Mesh {
  const nV = mesh.pos.length / 3;
  const pos = Float64Array.from(mesh.pos);
  const faces = Int32Array.from(mesh.idx); // 3 indices per face, mutated in place
  let nF = faces.length / 3;
  const faceAlive = new Uint8Array(nF).fill(1);
  let aliveFaces = nF;
  const vAlive = new Uint8Array(nV).fill(1);
  const ver = new Int32Array(nV);
  // Incident faces per vertex.
  const vf: Set<number>[] = Array.from({ length: nV }, () => new Set<number>());
  for (let f = 0; f < nF; f++) for (let k = 0; k < 3; k++) vf[faces[f * 3 + k]].add(f);

  // Unnormalised face normal (edge cross product) into out[0..2].
  const fn = (ia: number, ib: number, ic: number, out: Float64Array, ax = pos, sub?: { from: number; to: [number, number, number] }) => {
    const px = (v: number) => (sub && v === sub.from ? sub.to[0] : ax[v * 3]);
    const py = (v: number) => (sub && v === sub.from ? sub.to[1] : ax[v * 3 + 1]);
    const pz = (v: number) => (sub && v === sub.from ? sub.to[2] : ax[v * 3 + 2]);
    const e1x = px(ib) - px(ia), e1y = py(ib) - py(ia), e1z = pz(ib) - pz(ia);
    const e2x = px(ic) - px(ia), e2y = py(ic) - py(ia), e2z = pz(ic) - pz(ia);
    out[0] = e1y * e2z - e1z * e2y; out[1] = e1z * e2x - e1x * e2z; out[2] = e1x * e2y - e1y * e2x;
  };

  // --- Quadrics: face planes, plus heavy boundary-edge constraint planes ----
  const Qs: Q = new Float64Array(nV * 10);
  const tmp = new Float64Array(3);
  const edgeFaceCount = new Map<number, number>();
  const key = (a: number, b: number) => (a < b ? a * nV + b : b * nV + a);
  for (let f = 0; f < nF; f++) {
    const a = faces[f * 3], b = faces[f * 3 + 1], c = faces[f * 3 + 2];
    fn(a, b, c, tmp);
    const len = Math.hypot(tmp[0], tmp[1], tmp[2]) || 1;
    const nx = tmp[0] / len, ny = tmp[1] / len, nz = tmp[2] / len;
    const d = -(nx * pos[a * 3] + ny * pos[a * 3 + 1] + nz * pos[a * 3 + 2]);
    for (const v of [a, b, c]) qAddPlane(Qs, v * 10, nx, ny, nz, d, 1);
    for (const [u, w] of [[a, b], [b, c], [c, a]] as [number, number][])
      edgeFaceCount.set(key(u, w), (edgeFaceCount.get(key(u, w)) ?? 0) + 1);
  }
  // Boundary edges (in exactly one face): add a plane through the edge,
  // perpendicular to the face, weighted large, to both endpoints.
  let boundaryEdges = 0;
  for (let f = 0; f < nF; f++) {
    const a = faces[f * 3], b = faces[f * 3 + 1], c = faces[f * 3 + 2];
    fn(a, b, c, tmp);
    const len = Math.hypot(tmp[0], tmp[1], tmp[2]) || 1;
    const fnx = tmp[0] / len, fny = tmp[1] / len, fnz = tmp[2] / len;
    for (const [u, w] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      if (edgeFaceCount.get(key(u, w)) !== 1) continue;
      boundaryEdges++;
      let ex = pos[w * 3] - pos[u * 3], ey = pos[w * 3 + 1] - pos[u * 3 + 1], ez = pos[w * 3 + 2] - pos[u * 3 + 2];
      const el = Math.hypot(ex, ey, ez) || 1; ex /= el; ey /= el; ez /= el;
      // n = edge x faceNormal → perpendicular to the edge, in-ish plane.
      const nx = ey * fnz - ez * fny, ny = ez * fnx - ex * fnz, nz = ex * fny - ey * fnx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const px = nx / nl, py = ny / nl, pz = nz / nl;
      const d = -(px * pos[u * 3] + py * pos[u * 3 + 1] + pz * pos[u * 3 + 2]);
      qAddPlane(Qs, u * 10, px, py, pz, d, 1000);
      qAddPlane(Qs, w * 10, px, py, pz, d, 1000);
    }
  }

  // --- Cost of contracting edge (v1,v2): error at the optimal target ---------
  const scratch = new Float64Array(10);
  const cost = (v1: number, v2: number): Rec => {
    for (let i = 0; i < 10; i++) scratch[i] = Qs[v1 * 10 + i] + Qs[v2 * 10 + i];
    let t = qOptimum(scratch, 0);
    if (!t) {
      // Fall back to the cheapest of the two endpoints and the midpoint.
      const cands: [number, number, number][] = [
        [pos[v1 * 3], pos[v1 * 3 + 1], pos[v1 * 3 + 2]],
        [pos[v2 * 3], pos[v2 * 3 + 1], pos[v2 * 3 + 2]],
        [(pos[v1 * 3] + pos[v2 * 3]) / 2, (pos[v1 * 3 + 1] + pos[v2 * 3 + 1]) / 2, (pos[v1 * 3 + 2] + pos[v2 * 3 + 2]) / 2],
      ];
      let best = cands[0], bestE = Infinity;
      for (const c of cands) { const e = qError(scratch, 0, c[0], c[1], c[2]); if (e < bestE) { bestE = e; best = c; } }
      t = best;
    }
    const e = Math.max(0, qError(scratch, 0, t[0], t[1], t[2]));
    return [e, v1, v2, t[0], t[1], t[2], ver[v1], ver[v2]];
  };

  const heap: Rec[] = [];
  for (const k of edgeFaceCount.keys()) heapPush(heap, cost(Math.floor(k / nV), k % nV));

  // Would collapsing v1,v2 to target flip any surviving incident face? Also
  // rejects near-degenerate results (normal shrinks to noise).
  const wouldFlip = (v1: number, v2: number, tx: number, ty: number, tz: number): boolean => {
    const oldN = new Float64Array(3), newN = new Float64Array(3);
    for (const v of [v1, v2]) {
      for (const f of vf[v]) {
        if (!faceAlive[f]) continue;
        const a = faces[f * 3], b = faces[f * 3 + 1], c = faces[f * 3 + 2];
        if ((a === v1 || a === v2 ? 1 : 0) + (b === v1 || b === v2 ? 1 : 0) + (c === v1 || c === v2 ? 1 : 0) === 2) continue; // degenerate
        fn(a, b, c, oldN);
        // Substitute both v1 and v2 with the target for the new normal.
        const map = (x: number) => (x === v1 || x === v2);
        const px = (x: number) => (map(x) ? tx : pos[x * 3]);
        const py = (x: number) => (map(x) ? ty : pos[x * 3 + 1]);
        const pz = (x: number) => (map(x) ? tz : pos[x * 3 + 2]);
        const e1x = px(b) - px(a), e1y = py(b) - py(a), e1z = pz(b) - pz(a);
        const e2x = px(c) - px(a), e2y = py(c) - py(a), e2z = pz(c) - pz(a);
        newN[0] = e1y * e2z - e1z * e2y; newN[1] = e1z * e2x - e1x * e2z; newN[2] = e1x * e2y - e1y * e2x;
        const dot = oldN[0] * newN[0] + oldN[1] * newN[1] + oldN[2] * newN[2];
        const nl = Math.hypot(newN[0], newN[1], newN[2]);
        if (dot <= 0 || nl < 1e-12) return true;
      }
    }
    return false;
  };

  // --- Collapse loop ---------------------------------------------------------
  while (aliveFaces > targetTris) {
    const rec = heapPop(heap);
    if (!rec) break;
    const [, v1, v2, tx, ty, tz, r1, r2] = rec;
    if (!vAlive[v1] || !vAlive[v2] || ver[v1] !== r1 || ver[v2] !== r2) continue; // stale
    if (wouldFlip(v1, v2, tx, ty, tz)) continue;

    // Move v1 to target, fold v2's quadric in.
    pos[v1 * 3] = tx; pos[v1 * 3 + 1] = ty; pos[v1 * 3 + 2] = tz;
    for (let i = 0; i < 10; i++) Qs[v1 * 10 + i] += Qs[v2 * 10 + i];

    for (const f of vf[v2]) {
      if (!faceAlive[f]) continue;
      const o = f * 3, a = faces[o], b = faces[o + 1], c = faces[o + 2];
      const hasV1 = a === v1 || b === v1 || c === v1;
      if (hasV1) { // triangle degenerates — drop it
        faceAlive[f] = 0; aliveFaces--;
        for (const w of [a, b, c]) if (w !== v2) vf[w].delete(f);
      } else { // rewrite v2 -> v1
        if (a === v2) faces[o] = v1; else if (b === v2) faces[o + 1] = v1; else faces[o + 2] = v1;
        vf[v1].add(f);
      }
    }
    vAlive[v2] = 0; vf[v2].clear(); ver[v2]++; ver[v1]++;

    // Re-cost every edge now incident to v1.
    const nbrs = new Set<number>();
    for (const f of vf[v1]) {
      if (!faceAlive[f]) continue;
      for (let k = 0; k < 3; k++) { const w = faces[f * 3 + k]; if (w !== v1 && vAlive[w]) nbrs.add(w); }
    }
    for (const w of nbrs) heapPush(heap, cost(v1, w));
  }

  // --- Compact to a fresh vertex/index buffer --------------------------------
  const remap = new Int32Array(nV).fill(-1);
  const outPos: number[] = [];
  const outIdx: number[] = [];
  for (let f = 0; f < nF; f++) {
    if (!faceAlive[f]) continue;
    for (let k = 0; k < 3; k++) {
      const v = faces[f * 3 + k];
      if (remap[v] === -1) { remap[v] = outPos.length / 3; outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); }
      outIdx.push(remap[v]);
    }
  }
  console.log(`  quadric decimate: ${nF} -> ${aliveFaces} tris (${boundaryEdges} boundary edges preserved)`);
  return { pos: new Float32Array(outPos), idx: new Uint32Array(outIdx) };
}

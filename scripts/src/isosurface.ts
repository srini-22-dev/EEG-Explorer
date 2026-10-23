/**
 * Boundary-face isosurface extraction from a scalar volume, plus Laplacian
 * smoothing to de-blockify the result.
 *
 * Deliberately NOT marching cubes. Marching cubes needs a 256-entry triangle
 * lookup table; transcribing one from memory with no way to check it against a
 * reference risks silent per-configuration bugs (a missing triangle here or
 * there) that would show up as pinhole leaks in the final mesh and be very hard
 * to spot by eye. A boundary-face mesh — emit a quad on every voxel face that
 * separates "inside" from "outside" — is watertight by construction (every
 * emitted face has exactly one inside and one outside neighbour, so faces can
 * never partially cancel or leave a gap) and trivial to get right. The cost is
 * a blocky, axis-aligned surface, which Laplacian smoothing fixes.
 */

import { type Mesh } from './mesh';

export type Dims = [number, number, number];

/** Otsu's method: the threshold that maximises between-class variance of the histogram. */
export function otsuThreshold(data: Float32Array, nBins = 256): number {
  let min = Infinity, max = -Infinity;
  for (const v of data) { if (v < min) min = v; if (v > max) max = v; }
  const hist = new Float64Array(nBins);
  const scale = nBins / (max - min || 1);
  for (const v of data) {
    const b = Math.min(nBins - 1, Math.floor((v - min) * scale));
    hist[b]++;
  }
  const total = data.length;
  let sumAll = 0;
  for (let b = 0; b < nBins; b++) sumAll += b * hist[b];

  let sumB = 0, wB = 0, best = -1, bestVar = -1;
  for (let b = 0; b < nBins; b++) {
    wB += hist[b];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += b * hist[b];
    const meanB = sumB / wB;
    const meanF = (sumAll - sumB) / wF;
    const between = wB * wF * (meanB - meanF) ** 2;
    if (between > bestVar) { bestVar = between; best = b; }
  }
  return min + (best + 0.5) / scale;
}

/**
 * Flood-fills air reachable from outside the volume through sub-threshold
 * voxels, then returns a mask that also fills any sub-threshold pocket the
 * flood never reached (sinuses, ear canals, eye sockets, mouth) — otherwise
 * the boundary-face pass would carve tunnels into those cavities instead of
 * producing a closed outer skin envelope.
 */
export function fillEnclosedCavities(dims: Dims, data: Float32Array, threshold: number): Uint8Array {
  const [nx, ny, nz] = dims;
  const n = nx * ny * nz;
  const idx = (x: number, y: number, z: number) => x + y * nx + z * nx * ny;

  const externalAir = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;

  const tryPush = (x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
    const i = idx(x, y, z);
    if (externalAir[i] || data[i] >= threshold) return;
    externalAir[i] = 1;
    stack[sp++] = i;
  };

  // Seed from every boundary-plane voxel that is sub-threshold: the volume's
  // outer faces are guaranteed background, so any of them is a valid start.
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) { tryPush(x, y, 0); tryPush(x, y, nz - 1); }
  for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) { tryPush(x, 0, z); tryPush(x, ny - 1, z); }
  for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) { tryPush(0, y, z); tryPush(nx - 1, y, z); }

  while (sp > 0) {
    const i = stack[--sp];
    const z = Math.floor(i / (nx * ny));
    const y = Math.floor((i - z * nx * ny) / nx);
    const x = i - z * nx * ny - y * nx;
    tryPush(x + 1, y, z); tryPush(x - 1, y, z);
    tryPush(x, y + 1, z); tryPush(x, y - 1, z);
    tryPush(x, y, z + 1); tryPush(x, y, z - 1);
  }

  const inside = new Uint8Array(n);
  for (let i = 0; i < n; i++) inside[i] = externalAir[i] ? 0 : 1;
  return inside;
}

// Six cube faces as (dx,dy,dz) corner offsets in CCW order (viewed from outside)
// so (v1-v0) x (v2-v0) points along the stated outward normal. Derived and
// verified by hand — see the extraction commit for the cross-product check.
const FACES: { normal: Dims; corners: Dims[] }[] = [
  { normal: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { normal: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { normal: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
  { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
];

/**
 * Majority-downsamples an inside/outside mask by an integer factor.
 *
 * This is how the mesh gets its triangle budget, instead of decimating the
 * extracted mesh. Vertex-clustering decimation collapses every vertex inside a
 * grid cell to one point, and on a face that destroys exactly the features
 * worth having: at any useful ratio the cell spans a thin structure — the rim of
 * an ear, an eyelid fold, the ridge of the nose — merging its two opposing walls
 * into a single vertex and inverting the triangles between them. Coarsening the
 * *mask* instead keeps the boundary-face guarantee (one inside and one outside
 * neighbour per face) intact, so the result is still watertight and correctly
 * wound at any factor; detail degrades gradually rather than tearing.
 *
 * Thresholding and cavity-filling must happen at full resolution first — a
 * 1mm ear canal is not resolvable once the grid is coarser than it is.
 */
export function downsampleMask(dims: Dims, inside: Uint8Array, factor: number): { dims: Dims; inside: Uint8Array } {
  const [nx, ny, nz] = dims;
  const cx = Math.ceil(nx / factor), cy = Math.ceil(ny / factor), cz = Math.ceil(nz / factor);
  const out = new Uint8Array(cx * cy * cz);
  const half = (factor ** 3) / 2;

  for (let z = 0; z < cz; z++) {
    for (let y = 0; y < cy; y++) {
      for (let x = 0; x < cx; x++) {
        let count = 0;
        for (let dz = 0; dz < factor; dz++) {
          const sz = z * factor + dz;
          if (sz >= nz) break;
          for (let dy = 0; dy < factor; dy++) {
            const sy = y * factor + dy;
            if (sy >= ny) break;
            for (let dx = 0; dx < factor; dx++) {
              const sx = x * factor + dx;
              if (sx >= nx) break;
              count += inside[sx + sy * nx + sz * nx * ny];
            }
          }
        }
        out[x + y * cx + z * cx * cy] = count > half ? 1 : 0;
      }
    }
  }
  return { dims: [cx, cy, cz], inside: out };
}

/** Boundary mesh of an inside/outside voxel mask, in voxel-index space (unit cube per voxel). */
export function extractBoundaryMesh(dims: Dims, inside: Uint8Array): Mesh {
  const [nx, ny, nz] = dims;
  const isInside = (x: number, y: number, z: number) =>
    x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && inside[x + y * nx + z * nx * ny] === 1;

  const cornerIndex = new Map<number, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  const stride = [1, nx + 1, (nx + 1) * (ny + 1)];

  const cornerId = (x: number, y: number, z: number) => x * stride[0] + y * stride[1] + z * stride[2];
  const getVertex = (x: number, y: number, z: number) => {
    const key = cornerId(x, y, z);
    let v = cornerIndex.get(key);
    if (v === undefined) {
      v = positions.length / 3;
      cornerIndex.set(key, v);
      positions.push(x, y, z);
    }
    return v;
  };

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (!isInside(x, y, z)) continue;
        for (const face of FACES) {
          const [dx, dy, dz] = face.normal;
          if (isInside(x + dx, y + dy, z + dz)) continue;
          const v = face.corners.map(([cx, cy, cz]) => getVertex(x + cx, y + cy, z + cz));
          indices.push(v[0], v[1], v[2], v[0], v[2], v[3]);
        }
      }
    }
  }

  return { pos: new Float32Array(positions), idx: new Uint32Array(indices) };
}

/**
 * Uniform Laplacian smoothing: repeatedly move each vertex partway toward the
 * average of its edge-connected neighbours. `lambda` < 0.5 and enough
 * iterations reads as smooth without visibly shrinking the volume.
 */
export function laplacianSmooth(mesh: Mesh, iterations: number, lambda: number): Mesh {
  const nV = mesh.pos.length / 3;
  const neighborSet: Set<number>[] = Array.from({ length: nV }, () => new Set());
  for (let i = 0; i < mesh.idx.length; i += 3) {
    const [a, b, c] = [mesh.idx[i], mesh.idx[i + 1], mesh.idx[i + 2]];
    neighborSet[a].add(b); neighborSet[a].add(c);
    neighborSet[b].add(a); neighborSet[b].add(c);
    neighborSet[c].add(a); neighborSet[c].add(b);
  }
  const neighbors = neighborSet.map(s => Int32Array.from(s));

  let pos = mesh.pos.slice();
  for (let it = 0; it < iterations; it++) {
    const next = new Float32Array(pos.length);
    for (let v = 0; v < nV; v++) {
      const nbrs = neighbors[v];
      if (nbrs.length === 0) {
        next[v * 3] = pos[v * 3]; next[v * 3 + 1] = pos[v * 3 + 1]; next[v * 3 + 2] = pos[v * 3 + 2];
        continue;
      }
      let ax = 0, ay = 0, az = 0;
      for (const n of nbrs) { ax += pos[n * 3]; ay += pos[n * 3 + 1]; az += pos[n * 3 + 2]; }
      ax /= nbrs.length; ay /= nbrs.length; az /= nbrs.length;
      next[v * 3] = pos[v * 3] + lambda * (ax - pos[v * 3]);
      next[v * 3 + 1] = pos[v * 3 + 1] + lambda * (ay - pos[v * 3 + 1]);
      next[v * 3 + 2] = pos[v * 3 + 2] + lambda * (az - pos[v * 3 + 2]);
    }
    pos = next;
  }
  return { pos, idx: mesh.idx };
}


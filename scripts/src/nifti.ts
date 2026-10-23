// Minimal NIfTI-1 reader. Only handles what's needed to pull a scalar intensity
// volume plus its voxel-to-RAS affine out of a .nii.gz — no NIfTI-2, no non-affine
// qform-only files (falls back to qform only if sform_code is 0). See
// https://nifti.nimh.nih.gov/nifti-1/documentation/nifti1fields for the layout.

import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

export type NiftiVolume = {
  dims: [number, number, number];
  pixdim: [number, number, number];
  // Row-major 4x4 voxel-index -> RAS-mm affine, as used by srow_x/y/z.
  affine: number[][];
  // Flattened, x-fastest (i + j*nx + k*nx*ny), scaled to real intensity units.
  data: Float32Array;
};

const DATATYPE_READERS: Record<number, (buf: Buffer, off: number, n: number) => Float32Array> = {
  2: (buf, off, n) => Float32Array.from(new Uint8Array(buf.buffer, buf.byteOffset + off, n)),
  4: (buf, off, n) => Float32Array.from(new Int16Array(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + n * 2))),
  8: (buf, off, n) => Float32Array.from(new Int32Array(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + n * 4))),
  16: (buf, off, n) => new Float32Array(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + n * 4)),
  512: (buf, off, n) => Float32Array.from(new Uint16Array(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + n * 2))),
};

export function readNifti(file: string): NiftiVolume {
  const raw = fs.readFileSync(file);
  const buf = file.endsWith('.gz') ? zlib.gunzipSync(raw) : raw;

  const nx = buf.readInt16LE(40 + 1 * 2);
  const ny = buf.readInt16LE(40 + 2 * 2);
  const nz = buf.readInt16LE(40 + 3 * 2);
  const datatype = buf.readInt16LE(70);
  const voxOffset = buf.readFloatLE(108);
  const sclSlope = buf.readFloatLE(112);
  const sclInter = buf.readFloatLE(116);
  const sformCode = buf.readInt16LE(254);
  const qformCode = buf.readInt16LE(252);

  const pixdim: [number, number, number] = [
    buf.readFloatLE(76 + 1 * 4),
    buf.readFloatLE(76 + 2 * 4),
    buf.readFloatLE(76 + 3 * 4),
  ];

  let affine: number[][];
  if (sformCode > 0) {
    const row = (base: number) => [0, 1, 2, 3].map(i => buf.readFloatLE(base + i * 4));
    affine = [row(280), row(296), row(312), [0, 0, 0, 1]];
  } else if (qformCode > 0) {
    throw new Error('qform-only affine not implemented; this file needs an sform');
  } else {
    // No orientation info: fall back to voxel-scaled identity, origin at corner.
    affine = [
      [pixdim[0], 0, 0, 0],
      [0, pixdim[1], 0, 0],
      [0, 0, pixdim[2], 0],
      [0, 0, 0, 1],
    ];
  }

  const n = nx * ny * nz;
  const reader = DATATYPE_READERS[datatype];
  if (!reader) throw new Error(`unsupported NIfTI datatype code ${datatype}`);
  const raw16 = reader(buf, voxOffset, n);

  const slope = sclSlope === 0 ? 1 : sclSlope;
  const data = sclInter === 0 && slope === 1
    ? raw16
    : Float32Array.from(raw16, v => v * slope + sclInter);

  return { dims: [nx, ny, nz], pixdim, affine, data };
}

export function applyAffine(affine: number[][], vx: number, vy: number, vz: number): [number, number, number] {
  return [
    affine[0][0] * vx + affine[0][1] * vy + affine[0][2] * vz + affine[0][3],
    affine[1][0] * vx + affine[1][1] * vy + affine[1][2] * vz + affine[1][3],
    affine[2][0] * vx + affine[2][1] * vy + affine[2][2] * vz + affine[2][3],
  ];
}

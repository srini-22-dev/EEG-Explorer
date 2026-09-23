/**
 * Minimal RGB raster and PNG encoder — no image dependencies.
 *
 * Extracted from `renderTrace.ts` when a second renderer (`renderClinicalPage.ts`)
 * needed the same primitives. The alternative was a second copy of a PNG encoder
 * in the repo, which is the kind of duplication that drifts silently: the two
 * copies would agree until one of them was fixed.
 *
 * This module is deliberately about pixels only. Fonts live with their callers —
 * `renderTrace` numbers rows with a 3x5 digit font, `renderClinicalPage` writes
 * channel names with a 5x7 alphanumeric one — because those are different jobs at
 * different sizes, not one job with a parameter.
 */
import { deflateSync } from 'node:zlib';

export type RGB = [number, number, number];

export class Raster {
  data: Uint8Array;
  constructor(readonly w: number, readonly h: number, bg: RGB = [250, 250, 246]) {
    this.data = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) { this.data[i * 3] = bg[0]; this.data[i * 3 + 1] = bg[1]; this.data[i * 3 + 2] = bg[2]; }
  }
  px(x: number, y: number, c: RGB) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2];
  }
  hline(x0: number, x1: number, y: number, c: RGB) { for (let x = x0; x <= x1; x++) this.px(x, y, c); }
  vline(x: number, y0: number, y1: number, c: RGB) { for (let y = y0; y <= y1; y++) this.px(x, y, c); }
  /**
   * Integer Bresenham. Note the `|= 0` truncation of all four endpoints BEFORE
   * `dx`/`dy` are derived from them. That ordering is load-bearing: deriving the
   * error terms from fractional endpoints while testing termination against
   * truncated ones lets the walk step past the endpoint, after which the
   * `x0 === x1 && y0 === y1` test can never fire and the line runs away across
   * the raster. (Observed, in a caller that got this wrong.)
   */
  line(x0: number, y0: number, x1: number, y1: number, c: RGB) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
}

export function hexToRgb(hex: string): RGB {
  const m = hex.replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}

// ── PNG encode (RGB, filter 0, zlib via built-in deflate) ────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type, ch => ch.charCodeAt(0));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes); body.set(data, typeBytes.length);
  const len = data.length;
  const out = new Uint8Array(4 + body.length + 4);
  out[0] = (len >>> 24) & 255; out[1] = (len >>> 16) & 255; out[2] = (len >>> 8) & 255; out[3] = len & 255;
  out.set(body, 4);
  const crc = crc32(body);
  const o = 4 + body.length;
  out[o] = (crc >>> 24) & 255; out[o + 1] = (crc >>> 16) & 255; out[o + 2] = (crc >>> 8) & 255; out[o + 3] = crc & 255;
  return out;
}
export function encodePNG(w: number, h: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 6 });
  const ihdr = new Uint8Array(13);
  ihdr[0] = (w >>> 24) & 255; ihdr[1] = (w >>> 16) & 255; ihdr[2] = (w >>> 8) & 255; ihdr[3] = w & 255;
  ihdr[4] = (h >>> 24) & 255; ihdr[5] = (h >>> 16) & 255; ihdr[6] = (h >>> 8) & 255; ihdr[7] = h & 255;
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit, truecolor RGB
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0; for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

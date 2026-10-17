/**
 * A small independent JBIG2 decoder for tests: arithmetic generic regions
 * only (templates 0-3 are not needed; the encoder writes template 0). It
 * follows T.88 Annex E and G rather than sharing code with the encoder.
 */

const QE: [number, number, number, number][] = [
  [0x5601, 1, 1, 1], [0x3401, 2, 6, 0], [0x1801, 3, 9, 0], [0x0ac1, 4, 12, 0], [0x0521, 5, 29, 0],
  [0x0221, 38, 33, 0], [0x5601, 7, 6, 1], [0x5401, 8, 14, 0], [0x4801, 9, 14, 0], [0x3801, 10, 14, 0],
  [0x3001, 11, 17, 0], [0x2401, 12, 18, 0], [0x1c01, 13, 20, 0], [0x1601, 29, 21, 0], [0x5601, 15, 14, 1],
  [0x5401, 16, 14, 0], [0x5101, 17, 15, 0], [0x4801, 18, 16, 0], [0x3801, 19, 17, 0], [0x3401, 20, 18, 0],
  [0x3001, 21, 19, 0], [0x2801, 22, 19, 0], [0x2401, 23, 20, 0], [0x2201, 24, 21, 0], [0x1c01, 25, 22, 0],
  [0x1801, 26, 23, 0], [0x1601, 27, 24, 0], [0x1401, 28, 25, 0], [0x1201, 29, 26, 0], [0x1101, 30, 27, 0],
  [0x0ac1, 31, 28, 0], [0x09c1, 32, 29, 0], [0x08a1, 33, 30, 0], [0x0521, 34, 31, 0], [0x0441, 35, 32, 0],
  [0x02a1, 36, 33, 0], [0x0221, 37, 34, 0], [0x0141, 38, 35, 0], [0x0111, 39, 36, 0], [0x0085, 40, 37, 0],
  [0x0049, 41, 38, 0], [0x0025, 42, 39, 0], [0x0015, 43, 40, 0], [0x0009, 44, 41, 0], [0x0005, 45, 42, 0],
  [0x0001, 45, 43, 0], [0x5601, 46, 46, 0],
];

class MqDecoder {
  private bp: number;
  private chigh: number;
  private clow = 0;
  private ct = 0;
  private a = 0x8000;
  constructor(private data: Uint8Array, start: number, private end: number) {
    this.bp = start;
    this.chigh = data[start];
    this.byteIn();
    this.chigh = ((this.chigh << 7) & 0xffff) | ((this.clow >> 9) & 0x7f);
    this.clow = (this.clow << 7) & 0xffff;
    this.ct -= 7;
  }
  private byteIn() {
    const { data } = this;
    let bp = this.bp;
    if (data[bp] === 0xff) {
      if (data[bp + 1] > 0x8f) {
        this.clow += 0xff00;
        this.ct = 8;
      } else {
        bp++;
        this.clow += data[bp] << 9;
        this.ct = 7;
        this.bp = bp;
      }
    } else {
      bp++;
      this.clow += bp < this.end ? data[bp] << 8 : 0xff00;
      this.ct = 8;
      this.bp = bp;
    }
    if (this.clow > 0xffff) {
      this.chigh += this.clow >> 16;
      this.clow &= 0xffff;
    }
  }
  bit(contexts: Uint8Array, pos: number): number {
    let index = contexts[pos] >> 1;
    let mps = contexts[pos] & 1;
    const [qe, nmps, nlps, sw] = QE[index];
    let d: number;
    let a = this.a - qe;
    if (this.chigh < qe) {
      if (a < qe) {
        a = qe;
        d = mps;
        index = nmps;
      } else {
        a = qe;
        d = 1 ^ mps;
        if (sw === 1) mps = d;
        index = nlps;
      }
    } else {
      this.chigh -= qe;
      if ((a & 0x8000) !== 0) {
        this.a = a;
        return mps;
      }
      if (a < qe) {
        d = 1 ^ mps;
        if (sw === 1) mps = d;
        index = nlps;
      } else {
        d = mps;
        index = nmps;
      }
    }
    do {
      if (this.ct === 0) this.byteIn();
      a <<= 1;
      this.chigh = ((this.chigh << 1) & 0xffff) | ((this.clow >> 15) & 1);
      this.clow = (this.clow << 1) & 0xffff;
      this.ct--;
    } while ((a & 0x8000) === 0);
    this.a = a;
    contexts[pos] = (index << 1) | mps;
    return d;
  }
}

const u32 = (d: Uint8Array, o: number) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
const s8 = (n: number) => (n > 127 ? n - 256 : n);

/** Decodes a PDF-embedded JBIG2 stream holding one generic region; 1 is ink. */
export function decodeJbig2Generic(
  stream: Uint8Array,
): { pixels: Uint8Array; width: number; height: number } {
  let o = 0;
  let width = 0;
  let height = 0;
  let pixels: Uint8Array | null = null;
  while (o < stream.length) {
    const type = stream[o + 4] & 63;
    const refs = stream[o + 5] >> 5;
    if (refs > 4) throw new Error("long referred-to list not supported");
    const pageSize = stream[o + 4] & 0x40 ? 4 : 1;
    const lengthAt = o + 6 + pageSize;
    const length = u32(stream, lengthAt);
    const data = lengthAt + 4;
    if (type === 48) {
      width = u32(stream, data);
      height = u32(stream, data + 4);
    } else if (type === 38 || type === 39 || type === 36) {
      const w = u32(stream, data);
      const h = u32(stream, data + 4);
      const flags = stream[data + 17];
      if (flags & 1) throw new Error("MMR not supported");
      if (((flags >> 1) & 3) !== 0) throw new Error("only template 0");
      const tpgd = (flags & 8) !== 0;
      const at: [number, number][] = [];
      for (let i = 0; i < 4; i++) at.push([s8(stream[data + 18 + 2 * i]), s8(stream[data + 19 + 2 * i])]);
      pixels = decodeRegion(stream, data + 26, data + length, w, h, tpgd, at);
      width = w;
      height = h;
    }
    o = data + length;
  }
  if (!pixels) throw new Error("no region");
  return { pixels, width, height };
}

function decodeRegion(
  stream: Uint8Array,
  start: number,
  end: number,
  w: number,
  h: number,
  tpgd: boolean,
  at: [number, number][],
) {
  const dec = new MqDecoder(stream, start, end);
  const contexts = new Uint8Array(1 << 16);
  const px = new Uint8Array(w * h);
  const get = (x: number, y: number) => (x < 0 || x >= w || y < 0 ? 0 : px[y * w + x]);
  // Template pixels in reading order with the adaptive ones in their places.
  const fixed: [number, number][] = [
    [-1, -2], [0, -2], [1, -2], [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1], [-4, 0], [-3, 0], [-2, 0], [-1, 0],
  ];
  const all = [...fixed, ...at].sort((p, q) => p[1] - q[1] || p[0] - q[0]);
  let ltp = 0;
  for (let y = 0; y < h; y++) {
    if (tpgd) ltp ^= dec.bit(contexts, 0x9b25);
    if (ltp) {
      for (let x = 0; x < w; x++) px[y * w + x] = y > 0 ? px[(y - 1) * w + x] : 0;
      continue;
    }
    for (let x = 0; x < w; x++) {
      let cx = 0;
      for (const [dx, dy] of all) cx = (cx << 1) | get(x + dx, y + dy);
      px[y * w + x] = dec.bit(contexts, cx);
    }
  }
  return px;
}

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

type Bitmap = { width: number; height: number; px: Uint8Array };

function readInt(dec: MqDecoder, cx: Uint8Array): number | null {
  let prev = 1;
  const bits = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const bit = dec.bit(cx, prev);
      prev = prev < 256 ? (prev << 1) | bit : (((prev << 1) | bit) & 511) | 256;
      v = (v * 2) + bit;
    }
    return v;
  };
  const sign = bits(1);
  const value = bits(1)
    ? bits(1)
      ? bits(1)
        ? bits(1)
          ? bits(1)
            ? bits(32) + 4436
            : bits(12) + 340
          : bits(8) + 84
        : bits(6) + 20
      : bits(4) + 4
    : bits(2);
  if (sign === 0) return value;
  return value > 0 ? -value : null;
}

function readId(dec: MqDecoder, cx: Uint8Array, len: number): number {
  let prev = 1;
  for (let i = 0; i < len; i++) prev = (prev << 1) | dec.bit(cx, prev);
  return prev - (1 << len);
}

function decodeSymbolDict(stream: Uint8Array, data: number, length: number): Bitmap[] {
  const flags = (stream[data] << 8) | stream[data + 1];
  if (flags & 1 || flags & 2) throw new Error("huffman/refagg dictionaries not supported");
  if (((flags >> 10) & 3) !== 0) throw new Error("only template 0");
  const at: [number, number][] = [];
  for (let i = 0; i < 4; i++) at.push([s8(stream[data + 2 + 2 * i]), s8(stream[data + 3 + 2 * i])]);
  const numEx = u32(stream, data + 10);
  const numNew = u32(stream, data + 14);
  const dec = new MqDecoder(stream, data + 18, data + length);
  const gb = new Uint8Array(1 << 16);
  const iadh = new Uint8Array(512);
  const iadw = new Uint8Array(512);
  const iaex = new Uint8Array(512);
  const symbols: Bitmap[] = [];
  let height = 0;
  while (symbols.length < numNew) {
    height += readInt(dec, iadh) as number;
    let width = 0;
    for (;;) {
      const dw = readInt(dec, iadw);
      if (dw === null) break;
      width += dw;
      symbols.push({ width, height, px: decodeBitmap(dec, gb, width, height, false, at) });
    }
  }
  const flagsOut: boolean[] = [];
  let current = false;
  while (flagsOut.length < numNew) {
    const run = readInt(dec, iaex) as number;
    for (let i = 0; i < run; i++) flagsOut.push(current);
    current = !current;
  }
  const exported = symbols.filter((_, i) => flagsOut[i]);
  if (exported.length !== numEx) throw new Error("export count mismatch");
  return exported;
}

function decodeTextRegion(
  stream: Uint8Array,
  data: number,
  length: number,
  w: number,
  h: number,
  symbols: Bitmap[],
): Uint8Array {
  const flags = (stream[data + 17] << 8) | stream[data + 18];
  if (flags & 1 || flags & 2) throw new Error("huffman/refine text regions not supported");
  const strips = 1 << ((flags >> 2) & 3);
  const corner = (flags >> 4) & 3; // 0 BL, 1 TL, 2 BR, 3 TR
  if ((flags >> 6) & 1) throw new Error("transposed not supported");
  const dsOffset = ((flags >> 10) & 31) > 15 ? ((flags >> 10) & 31) - 32 : (flags >> 10) & 31;
  const count = u32(stream, data + 19);
  const dec = new MqDecoder(stream, data + 23, data + length);
  const codeLen = Math.ceil(Math.log2(Math.max(symbols.length, 1)));
  const iadt = new Uint8Array(512);
  const iafs = new Uint8Array(512);
  const iads = new Uint8Array(512);
  const iait = new Uint8Array(512);
  const iaid = new Uint8Array(1 << (codeLen + 1));
  const out = new Uint8Array(w * h);
  let stripT = -(readInt(dec, iadt) as number);
  let firstS = 0;
  let n = 0;
  while (n < count) {
    stripT += readInt(dec, iadt) as number;
    firstS += readInt(dec, iafs) as number;
    let curS = firstS;
    for (;;) {
      const curT = strips > 1 ? (readInt(dec, iait) as number) : 0;
      const t = strips * stripT + curT;
      const sym = symbols[readId(dec, iaid, codeLen)];
      if (!sym) throw new Error("bad symbol id");
      if (corner === 2 || corner === 3) curS += sym.width - 1;
      const x0 = corner === 2 || corner === 3 ? curS - sym.width + 1 : curS;
      const y0 = corner === 0 || corner === 2 ? t - sym.height + 1 : t;
      for (let y = 0; y < sym.height; y++)
        for (let x = 0; x < sym.width; x++) {
          const px = x0 + x;
          const py = y0 + y;
          if (px >= 0 && px < w && py >= 0 && py < h && sym.px[y * sym.width + x]) out[py * w + px] = 1;
        }
      if (corner === 0 || corner === 1) curS += sym.width - 1;
      n++;
      const ds = readInt(dec, iads);
      if (ds === null) break;
      curS += ds + dsOffset;
    }
  }
  return out;
}

/** Decodes a PDF-embedded JBIG2 stream: generic regions, symbol dictionaries, and text regions. 1 is ink. */
export function decodeJbig2(
  stream: Uint8Array,
): { pixels: Uint8Array; width: number; height: number } {
  let o = 0;
  let width = 0;
  let height = 0;
  let page: Uint8Array | null = null;
  const dicts = new Map<number, Bitmap[]>();
  const compose = (px: Uint8Array, rx: number, ry: number, rw: number, rh: number, op: number) => {
    if (!page) page = new Uint8Array(width * height);
    for (let y = 0; y < rh; y++)
      for (let x = 0; x < rw; x++) {
        const i = (ry + y) * width + rx + x;
        const v = px[y * rw + x];
        page[i] = op === 0 ? page[i] | v : op === 2 ? page[i] ^ v : v;
      }
  };
  while (o < stream.length) {
    const number = u32(stream, o);
    const type = stream[o + 4] & 63;
    const refs = stream[o + 5] >> 5;
    if (refs > 4) throw new Error("long referred-to list not supported");
    const referred = [...stream.subarray(o + 6, o + 6 + refs)];
    const pageSize = stream[o + 4] & 0x40 ? 4 : 1;
    const lengthAt = o + 6 + refs + pageSize;
    const length = u32(stream, lengthAt);
    const data = lengthAt + 4;
    if (type === 48) {
      width = u32(stream, data);
      height = u32(stream, data + 4);
    } else if (type === 0) {
      dicts.set(number, decodeSymbolDict(stream, data, length));
    } else if (type === 4 || type === 6 || type === 7) {
      const rw = u32(stream, data);
      const rh = u32(stream, data + 4);
      const symbols = referred.flatMap((n) => dicts.get(n) ?? []);
      compose(decodeTextRegion(stream, data, length, rw, rh, symbols), u32(stream, data + 8), u32(stream, data + 12), rw, rh, stream[data + 16] & 7);
    } else if (type === 38 || type === 39 || type === 36) {
      const rw = u32(stream, data);
      const rh = u32(stream, data + 4);
      const flags = stream[data + 17];
      if (flags & 1) throw new Error("MMR not supported");
      if (((flags >> 1) & 3) !== 0) throw new Error("only template 0");
      const at: [number, number][] = [];
      for (let i = 0; i < 4; i++) at.push([s8(stream[data + 18 + 2 * i]), s8(stream[data + 19 + 2 * i])]);
      const px = decodeRegion(stream, data + 26, data + length, rw, rh, (flags & 8) !== 0, at);
      compose(px, u32(stream, data + 8), u32(stream, data + 12), rw, rh, stream[data + 16] & 7);
    }
    o = data + length;
  }
  if (!page) throw new Error("no region");
  return { pixels: page, width, height };
}

/** Kept for the generic-only tests. */
export const decodeJbig2Generic = decodeJbig2;

/** One bitmap with shared contexts; pixels outside it read as 0. */
function decodeBitmap(
  dec: MqDecoder,
  contexts: Uint8Array,
  w: number,
  h: number,
  tpgd: boolean,
  at: [number, number][],
): Uint8Array {
  const px = new Uint8Array(w * h);
  const get = (x: number, y: number) => (x < 0 || x >= w || y < 0 ? 0 : px[y * w + x]);
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

function decodeRegion(
  stream: Uint8Array,
  start: number,
  end: number,
  w: number,
  h: number,
  tpgd: boolean,
  at: [number, number][],
) {
  return decodeBitmap(new MqDecoder(stream, start, end), new Uint8Array(1 << 16), w, h, tpgd, at);
}

/**
 * JBIG2 (ITU-T T.88) generic-region encoder: arithmetic coded, template 0,
 * typical-prediction rows. The output is the embedded form PDF wants for
 * /JBIG2Decode: a page-information segment plus one immediate generic
 * region, no file header.
 */

// MQ coder probability table (T.88 Table E.1): [Qe, NMPS, NLPS, SWITCH].
const QE = new Uint16Array([
  0x5601, 0x3401, 0x1801, 0x0ac1, 0x0521, 0x0221, 0x5601, 0x5401, 0x4801, 0x3801, 0x3001, 0x2401,
  0x1c01, 0x1601, 0x5601, 0x5401, 0x5101, 0x4801, 0x3801, 0x3401, 0x3001, 0x2801, 0x2401, 0x2201,
  0x1c01, 0x1801, 0x1601, 0x1401, 0x1201, 0x1101, 0x0ac1, 0x09c1, 0x08a1, 0x0521, 0x0441, 0x02a1,
  0x0221, 0x0141, 0x0111, 0x0085, 0x0049, 0x0025, 0x0015, 0x0009, 0x0005, 0x0001, 0x5601,
]);
const NMPS = new Uint8Array([
  1, 2, 3, 4, 5, 38, 7, 8, 9, 10, 11, 12, 13, 29, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 45, 46,
]);
const NLPS = new Uint8Array([
  1, 6, 9, 12, 29, 33, 6, 14, 14, 14, 17, 18, 20, 21, 14, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22,
  23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 46,
]);
const SWITCH = new Uint8Array([
  1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

/** Arithmetic encoder over a set of adaptive contexts (T.88 Annex E). */
export class MqEncoder {
  private buf = new Uint8Array(4096);
  /** Index of the byte under construction; -1 is the dummy slot before the first. */
  private bp = -1;
  private a = 0x8000;
  private c = 0;
  private ct = 12;
  readonly index: Uint8Array;
  readonly mps: Uint8Array;

  constructor(contexts: number) {
    this.index = new Uint8Array(contexts);
    this.mps = new Uint8Array(contexts);
    this.buf[0] = 0;
  }

  private byteAt(i: number) {
    return i < 0 ? 0 : this.buf[i];
  }

  private put(value: number) {
    this.bp++;
    if (this.bp >= this.buf.length) {
      const bigger = new Uint8Array(this.buf.length * 2);
      bigger.set(this.buf);
      this.buf = bigger;
    }
    this.buf[this.bp] = value;
  }

  private byteOut() {
    if (this.byteAt(this.bp) === 0xff) {
      this.put(this.c >>> 20);
      this.c &= 0xfffff;
      this.ct = 7;
    } else if (this.c < 0x8000000) {
      this.put(this.c >>> 19);
      this.c &= 0x7ffff;
      this.ct = 8;
    } else {
      if (this.bp >= 0) this.buf[this.bp]++;
      if (this.byteAt(this.bp) === 0xff) {
        this.c &= 0x7ffffff;
        this.put(this.c >>> 20);
        this.c &= 0xfffff;
        this.ct = 7;
      } else {
        this.put(this.c >>> 19);
        this.c &= 0x7ffff;
        this.ct = 8;
      }
    }
  }

  private renorm() {
    do {
      this.a = (this.a << 1) & 0xffff;
      this.c = (this.c << 1) >>> 0;
      this.ct--;
      if (this.ct === 0) this.byteOut();
    } while ((this.a & 0x8000) === 0);
  }

  encode(cx: number, bit: number) {
    const i = this.index[cx];
    const qe = QE[i];
    if (bit === this.mps[cx]) {
      this.a -= qe;
      if ((this.a & 0x8000) === 0) {
        if (this.a < qe) this.a = qe;
        else this.c += qe;
        this.index[cx] = NMPS[i];
        this.renorm();
      } else {
        this.c += qe;
      }
    } else {
      this.a -= qe;
      if (this.a < qe) this.c += qe;
      else this.a = qe;
      if (SWITCH[i]) this.mps[cx] ^= 1;
      this.index[cx] = NLPS[i];
      this.renorm();
    }
  }

  /** Terminates the stream with the 0xFF 0xAC marker JBIG2 expects. */
  finish(): Uint8Array {
    const temp = this.c + this.a;
    this.c = (this.c | 0xffff) >>> 0;
    if (this.c >= temp) this.c -= 0x8000;
    this.c = (this.c << this.ct) >>> 0;
    this.byteOut();
    this.c = (this.c << this.ct) >>> 0;
    this.byteOut();
    if (this.byteAt(this.bp) !== 0xff) this.put(0xff);
    this.put(0xac);
    return this.buf.slice(0, this.bp + 1);
  }
}

export const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

/** One segment: number, type, the segments it refers to, then its data. */
export function segment(
  number: number,
  type: number,
  data: Uint8Array,
  refers: number[] = [],
): Uint8Array {
  const head = [...be32(number), type, refers.length << 5, ...refers, 1, ...be32(data.length)];
  const out = new Uint8Array(head.length + data.length);
  out.set(head);
  out.set(data, head.length);
  return out;
}

/** Context for template 0 with the default adaptive pixels; 0x9b25 codes the typical-row flag. */
const SLTP_CONTEXT = 0x9b25;

/** Adaptive pixels A1..A4 for template 0, as the stream spells them. */
export const DEFAULT_AT = new Uint8Array([3, 0xff, 0xfd, 0xff, 2, 0xfe, 0xfe, 0xfe]);

/**
 * Codes one bitmap (template 0, default adaptive pixels) with the given
 * arithmetic coder. Generic contexts live at 0..65535. With typical
 * prediction, rows equal to the one above cost one flag.
 * pixels holds width * height samples, 1 for ink and 0 for paper.
 */
export function codeBitmap(
  mq: MqEncoder,
  pixels: Uint8Array,
  width: number,
  height: number,
  typicalPrediction: boolean,
) {
  // Padded copy: 4 columns each side and 2 rows above keep the loop branch-free.
  const stride = width + 8;
  const pad = new Uint8Array(stride * (height + 2));
  for (let y = 0; y < height; y++) {
    pad.set(pixels.subarray(y * width, (y + 1) * width), (y + 2) * stride + 4);
  }
  let previousTypical = 0;
  for (let y = 0; y < height; y++) {
    const row = (y + 2) * stride + 4;
    if (typicalPrediction) {
      let same = true;
      const above = row - stride;
      for (let x = 0; x < width; x++) {
        if (pad[row + x] !== pad[above + x]) {
          same = false;
          break;
        }
      }
      const typical = same ? 1 : 0;
      mq.encode(SLTP_CONTEXT, typical ^ previousTypical);
      previousTypical = typical;
      if (typical) continue;
    }
    const r1 = row - stride;
    const r2 = row - 2 * stride;
    // Windows hold the pixels around the cursor, MSB = leftmost.
    let w0 = 0; // x-4..x-1
    // x = 0: row y-2 spans x-2..x+2 and row y-1 spans x-3..x+3; the left padding is zero.
    let w2 = (pad[r2] << 2) | (pad[r2 + 1] << 1) | pad[r2 + 2];
    let w1 = (pad[r1] << 3) | (pad[r1 + 1] << 2) | (pad[r1 + 2] << 1) | pad[r1 + 3];
    for (let x = 0; x < width; x++) {
      const bit = pad[row + x];
      mq.encode((w2 << 11) | (w1 << 4) | w0, bit);
      w2 = ((w2 << 1) | pad[r2 + x + 3]) & 0x1f;
      w1 = ((w1 << 1) | pad[r1 + x + 4]) & 0x7f;
      w0 = ((w0 << 1) | bit) & 0xf;
    }
  }
}

/** Codes one generic region into MQ bytes. */
export function encodeGenericRegion(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const mq = new MqEncoder(1 << 16);
  codeBitmap(mq, pixels, width, height, true);
  return mq.finish();
}

export function pageInfoSegment(number: number, width: number, height: number): Uint8Array {
  return segment(
    number,
    48,
    new Uint8Array([
      ...be32(width),
      ...be32(height),
      ...be32(0),
      ...be32(0),
      0, // flags: default pixel 0, OR combination
      0,
      0, // not striped
    ]),
  );
}

/** Region segment information field: size, position, and OR combination. */
export function regionInfo(width: number, height: number): number[] {
  return [...be32(width), ...be32(height), ...be32(0), ...be32(0), 0];
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
export { concat };

/** Generic region segment (immediate, arithmetic, template 0, typical prediction). */
export function genericRegionSegment(
  number: number,
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const flags = 0x08; // template 0, typical prediction on, arithmetic coding
  const body = encodeGenericRegion(pixels, width, height);
  return segment(
    number,
    38,
    concat([new Uint8Array([...regionInfo(width, height), flags]), DEFAULT_AT, body]),
  );
}

/**
 * The bytes of a PDF /JBIG2Decode stream for one bilevel image, coded as a
 * single generic region. pixels holds width * height samples, 1 for ink.
 */
export function encodeJbig2(pixels: Uint8Array, width: number, height: number): Uint8Array {
  return concat([
    pageInfoSegment(0, width, height),
    genericRegionSegment(1, pixels, width, height),
  ]);
}

/**
 * Lossless image coding the way a good PNG optimiser does it, in PDF terms: a palette when the
 * image has 256 colours or fewer (packed to 1, 2, 4 or 8 bits), grey when every pixel is grey,
 * and PNG row filters (Predictor 15) chosen row by row. Also undoes predictors on the way in,
 * which pdf-lib does not. Pure: bytes in, bytes out.
 */
import { zlibSync } from "fflate";

export type Lossless = {
  bytes: Uint8Array;
  /** Samples per pixel as stored: 1 for grey or palette, 3 for RGB. */
  channels: 1 | 3;
  bitsPerComponent: 1 | 2 | 4 | 8;
  /** RGB or grey triples for an Indexed colour space. */
  palette?: Uint8Array;
  /** Predictor 15 with these columns and colours, when used. */
  predictor?: { colors: number; bits: number; columns: number };
  /** True when an RGB image was stored as grey. */
  gray: boolean;
};

/** Candidates are compared at a quick level; only the winner is deflated hard. */
const trial = (b: Uint8Array) => zlibSync(b, { level: 4, mem: 12 });
/** Level 9 is about five times slower than 6 for some 6% on noisy pixels, so huge buffers take 6. */
const deflateFinal = (b: Uint8Array) => zlibSync(b, { level: b.length > 3_000_000 ? 6 : 9, mem: 12 });

/** Undoes /Predictor 2 (TIFF) or 10-15 (PNG). Returns null when the data does not fit. */
export function unpredict(data: Uint8Array, predictor: number, colors: number, bits: number, columns: number): Uint8Array | null {
  if (predictor <= 1) return data;
  const bpp = Math.max(1, Math.ceil((colors * bits) / 8));
  const rowBytes = Math.ceil((colors * bits * columns) / 8);
  if (predictor === 2) {
    if (bits !== 8) return null;
    const out = data.slice();
    for (let r = 0; r * rowBytes < out.length; r++) {
      const o = r * rowBytes;
      for (let i = bpp; i < rowBytes && o + i < out.length; i++) out[o + i] = (out[o + i] + out[o + i - bpp]) & 255;
    }
    return out;
  }
  if (predictor < 10) return null;
  const rows = Math.floor(data.length / (rowBytes + 1));
  const out = new Uint8Array(rows * rowBytes);
  let prev = new Uint8Array(rowBytes);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowBytes + 1)];
    const src = data.subarray(r * (rowBytes + 1) + 1, (r + 1) * (rowBytes + 1));
    const cur = out.subarray(r * rowBytes, (r + 1) * rowBytes);
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (type === 1) v += a;
      else if (type === 2) v += b;
      else if (type === 3) v += (a + b) >> 1;
      else if (type === 4) v += paeth(a, b, c);
      else if (type !== 0) return null;
      cur[i] = v & 255;
    }
    prev = cur;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** PNG filtering, each row with the filter that leaves the smallest sum of signed bytes. */
export function pngFilter(data: Uint8Array, rowBytes: number, bpp: number): Uint8Array {
  const rows = data.length / rowBytes;
  const out = new Uint8Array(rows * (rowBytes + 1));
  const trial = Array.from({ length: 5 }, () => new Uint8Array(rowBytes));
  const zero = new Uint8Array(rowBytes);
  for (let r = 0; r < rows; r++) {
    const cur = data.subarray(r * rowBytes, (r + 1) * rowBytes);
    const prev = r ? data.subarray((r - 1) * rowBytes, r * rowBytes) : zero;
    let best = 0;
    let bestCost = Infinity;
    for (let t = 0; t < 5; t++) {
      const row = trial[t];
      let cost = 0;
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const pred = t === 0 ? 0 : t === 1 ? a : t === 2 ? b : t === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (cur[i] - pred) & 255;
        row[i] = v;
        cost += v < 128 ? v : 256 - v;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = t;
      }
    }
    out[r * (rowBytes + 1)] = best;
    out.set(trial[best], r * (rowBytes + 1) + 1);
  }
  return out;
}

/** Up to 256 colours as a palette and one index per pixel, or null for more. */
function toPalette(raw: Uint8Array, count: number, ch: 1 | 3): { palette: Uint8Array; index: Uint8Array } | null {
  const lookup = new Map<number, number>();
  const index = new Uint8Array(count);
  for (let p = 0, s = 0; p < count; p++, s += ch) {
    const key = ch === 3 ? (raw[s] << 16) | (raw[s + 1] << 8) | raw[s + 2] : raw[s];
    let k = lookup.get(key);
    if (k === undefined) {
      if (lookup.size === 256) return null;
      k = lookup.size;
      lookup.set(key, k);
    }
    index[p] = k;
  }
  const palette = new Uint8Array(lookup.size * ch);
  for (const [key, k] of lookup) {
    if (ch === 3) {
      palette[k * 3] = key >> 16;
      palette[k * 3 + 1] = (key >> 8) & 255;
      palette[k * 3 + 2] = key & 255;
    } else palette[k] = key;
  }
  return { palette, index };
}

/** Packs 8-bit samples into rows of 1, 2 or 4 bits, each row starting on a byte. */
function pack(samples: Uint8Array, width: number, height: number, bits: 1 | 2 | 4 | 8): Uint8Array {
  if (bits === 8) return samples;
  const rowBytes = Math.ceil((width * bits) / 8);
  const out = new Uint8Array(rowBytes * height);
  const per = 8 / bits;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = samples[y * width + x];
      out[y * rowBytes + Math.floor(x / per)] |= v << (8 - bits * (1 + (x % per)));
    }
  }
  return out;
}

function isGray(raw: Uint8Array, count: number): boolean {
  for (let p = 0, s = 0; p < count; p++, s += 3) if (raw[s] !== raw[s + 1] || raw[s] !== raw[s + 2]) return false;
  return true;
}

/**
 * The smallest lossless coding of 8-bit samples (1 or 3 per pixel): a packed palette, or the
 * pixels with or without PNG filters, as grey when the colour adds nothing.
 */
export function encodeLossless(raw: Uint8Array, width: number, height: number, ch: 1 | 3): Lossless {
  const count = width * height;
  let samples = raw;
  let channels: 1 | 3 = ch;
  let gray = false;
  if (ch === 3 && isGray(raw, count)) {
    samples = new Uint8Array(count);
    for (let p = 0; p < count; p++) samples[p] = raw[p * 3];
    channels = 1;
    gray = true;
  }
  type Trial = Lossless & { input: Uint8Array };
  const candidates: Trial[] = [];
  const pal = toPalette(samples, count, channels);
  if (pal) {
    const n = pal.palette.length / channels;
    const bits = n <= 2 ? 1 : n <= 4 ? 2 : n <= 16 ? 4 : 8;
    // A grey palette in natural order is just fewer bits of grey.
    const packed = pack(pal.index, width, height, bits);
    const rowBytes = Math.ceil((width * bits) / 8);
    candidates.push({ input: packed, bytes: trial(packed), channels: 1, bitsPerComponent: bits, palette: pal.palette, gray });
    if (bits === 8 || width > 64) {
      const filtered = pngFilter(packed, rowBytes, 1);
      candidates.push({
        input: filtered,
        bytes: trial(filtered),
        channels: 1,
        bitsPerComponent: bits,
        palette: pal.palette,
        predictor: { colors: 1, bits, columns: width },
        gray,
      });
    }
  }
  if (!pal || pal.palette.length / channels > 16) {
    const filtered = pngFilter(samples, width * channels, channels);
    candidates.push({
      input: filtered,
      bytes: trial(filtered),
      channels,
      bitsPerComponent: 8,
      predictor: { colors: channels, bits: 8, columns: width },
      gray,
    });
    if (!pal) candidates.push({ input: samples, bytes: trial(samples), channels, bitsPerComponent: 8, gray });
  }
  const { input, ...best } = candidates.sort((a, b) => a.bytes.length + (a.palette?.length ?? 0) - (b.bytes.length + (b.palette?.length ?? 0)))[0];
  return { ...best, bytes: deflateFinal(input) };
}

/** The colours of an image when there are 256 or fewer, as packed 0xRRGGBB (or grey) keys. */
export function paletteOf(raw: Uint8Array, count: number, ch: 1 | 3): number[] | null {
  const seen = new Set<number>();
  for (let p = 0, s = 0; p < count; p++, s += ch) {
    seen.add(ch === 3 ? (raw[s] << 16) | (raw[s + 1] << 8) | raw[s + 2] : raw[s]);
    if (seen.size > 256) return null;
  }
  return [...seen];
}

/**
 * The 256 commonest colours, for screenshots whose antialiased text adds a long tail of
 * near-duplicates. Colours are counted on 5 bits per channel, then each bucket's commonest
 * exact colour stands for it, so the flat fills keep their exact values.
 */
export function commonColours(raw: Uint8Array, count: number, ch: 1 | 3, size = 256): number[] {
  const buckets = new Map<number, Map<number, number>>();
  const step = Math.max(1, Math.floor(count / 400000));
  for (let p = 0; p < count; p += step) {
    const s = p * ch;
    const key = ch === 3 ? (raw[s] << 16) | (raw[s + 1] << 8) | raw[s + 2] : raw[s];
    const bucket = ch === 3 ? ((raw[s] >> 3) << 10) | ((raw[s + 1] >> 3) << 5) | (raw[s + 2] >> 3) : raw[s] >> 2;
    const m = buckets.get(bucket) ?? new Map<number, number>();
    m.set(key, (m.get(key) ?? 0) + 1);
    buckets.set(bucket, m);
  }
  const reps = [...buckets.values()].map((m) => {
    let best = 0;
    let n = 0;
    let total = 0;
    for (const [k, c] of m) {
      total += c;
      if (c > n) {
        n = c;
        best = k;
      }
    }
    return { key: best, total };
  });
  return reps.sort((a, b) => b.total - a.total).slice(0, size).map((r) => r.key);
}

/** Moves every pixel to the nearest colour of a palette, so a resampled flat graphic stays flat. */
export function snapToPalette(raw: Uint8Array, count: number, ch: 1 | 3, palette: number[]): Uint8Array {
  const out = new Uint8Array(raw.length);
  const cache = new Map<number, number>();
  const comps = palette.map((k) => (ch === 3 ? [k >> 16, (k >> 8) & 255, k & 255] : [k]));
  for (let p = 0, s = 0; p < count; p++, s += ch) {
    const key = ch === 3 ? (raw[s] << 16) | (raw[s + 1] << 8) | raw[s + 2] : raw[s];
    let best = cache.get(key);
    if (best === undefined) {
      let d = Infinity;
      best = 0;
      for (let i = 0; i < comps.length; i++) {
        const c = comps[i];
        // Luma-weighted distance: green differences show most.
        const e = ch === 3 ? 3 * (raw[s] - c[0]) ** 2 + 4 * (raw[s + 1] - c[1]) ** 2 + 2 * (raw[s + 2] - c[2]) ** 2 : (raw[s] - c[0]) ** 2;
        if (e < d) {
          d = e;
          best = i;
        }
      }
      cache.set(key, best);
    }
    const c = comps[best];
    out[s] = c[0];
    if (ch === 3) {
      out[s + 1] = c[1];
      out[s + 2] = c[2];
    }
  }
  return out;
}

/**
 * Screenshots, charts and exported art repeat exact pixel values side by side; scans and photos
 * carry sensor noise and almost never do.
 */
export function looksDigital(raw: Uint8Array, width: number, height: number, ch: 1 | 3): boolean {
  let same = 0;
  let n = 0;
  const rowStep = Math.max(1, Math.floor(height / 200));
  for (let y = 0; y < height; y += rowStep) {
    const o = y * width * ch;
    for (let x = 1; x < width; x++, n++) {
      const a = o + (x - 1) * ch;
      const b = o + x * ch;
      if (raw[a] === raw[b] && (ch === 1 || (raw[a + 1] === raw[b + 1] && raw[a + 2] === raw[b + 2]))) same++;
    }
  }
  return n > 0 && same / n > 0.6;
}

/** Distinct colours among a sample of pixels, stopping at cap. */
export function colourCount(raw: Uint8Array, count: number, ch: 1 | 3, cap: number): number {
  const step = Math.max(1, Math.floor(count / 16384));
  const seen = new Set<number>();
  for (let p = 0; p < count && seen.size < cap; p += step) {
    const s = p * ch;
    seen.add(ch === 3 ? (raw[s] << 16) | (raw[s + 1] << 8) | raw[s + 2] : raw[s]);
  }
  return seen.size;
}

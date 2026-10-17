import {
  MqEncoder,
  be32,
  codeBitmap,
  concat,
  DEFAULT_AT,
  genericRegionSegment,
  pageInfoSegment,
  regionInfo,
  segment,
} from "@/lib/jbig2-encode";

/**
 * JBIG2 symbol mode for scanned text: every letter-sized blob that looks
 * like an earlier one is stored once in a symbol dictionary and then only
 * placed on the page. What can't be matched safely stays as ink in a
 * generic region, so no mark is ever dropped.
 */

/** Blobs larger than this (either side) are drawings, not letters. */
const MAX_SYMBOL_SIDE = 160;
const MIN_SYMBOL_AREA = 6;
/** Share of ink that may differ between two blobs called the same letter. */
const MAX_DIFF_SHARE = 0.07;
/** No 3x3 neighbourhood may disagree in more pixels than this. */
const MAX_LOCAL_DIFF = 4;
/** Classes seen fewer times than this are cheaper left in the generic region. */
const MIN_INSTANCES = 2;

type Blob = {
  /** Bounding box top-left and size. */
  x: number;
  y: number;
  w: number;
  h: number;
  px: Uint8Array;
  ink: number;
  /** Indices into the page bitmap, used to clear the blob from the residual. */
  cells: number[];
};

/** 8-connected blobs of ink no larger than a letter. */
function findBlobs(ink: Uint8Array, width: number, height: number): Blob[] {
  const seen = new Uint8Array(ink.length);
  const blobs: Blob[] = [];
  let stack = new Int32Array(4096);
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    const cells: number[] = [];
    let x0 = width;
    let x1 = -1;
    let y0 = height;
    let y1 = -1;
    let tooBig = false;
    while (top > 0) {
      const p = stack[--top];
      const y = (p / width) | 0;
      const x = p - y * width;
      if (!tooBig) cells.push(p);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x1 - x0 >= MAX_SYMBOL_SIDE || y1 - y0 >= MAX_SYMBOL_SIDE) {
        tooBig = true;
        cells.length = 0;
      }
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (ink[q] && !seen[q]) {
            seen[q] = 1;
            if (top === stack.length) {
              const bigger = new Int32Array(stack.length * 2);
              bigger.set(stack);
              stack = bigger;
            }
            stack[top++] = q;
          }
        }
      }
    }
    if (tooBig) continue;
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (cells.length < MIN_SYMBOL_AREA) continue;
    const px = new Uint8Array(w * h);
    for (const p of cells) {
      const y = (p / width) | 0;
      px[(y - y0) * w + (p - y * width - x0)] = 1;
    }
    blobs.push({ x: x0, y: y0, w, h, px, ink: cells.length, cells });
  }
  return blobs;
}

type Rep = { w: number; h: number; px: Uint8Array; ink: number };
type Match = { diff: number; sx: number; sy: number };

/**
 * How well a blob lies on a representative: the fewest differing pixels over
 * a few one-pixel alignments, or null when it breaks the local-diff rule.
 * (sx, sy) says where the rep's top-left sits relative to the blob's.
 */
function compare(blob: Blob, rep: Rep): Match | null {
  const dw = blob.w - rep.w;
  const dh = blob.h - rep.h;
  if (Math.abs(dw) > 1 || Math.abs(dh) > 1) return null;
  const limit = Math.round(MAX_DIFF_SHARE * Math.max(blob.ink, rep.ink)) + 1;
  let best: Match | null = null;
  for (const sx of dw === 0 ? [0] : [0, dw]) {
    for (const sy of dh === 0 ? [0] : [0, dh]) {
      // Union rectangle in blob coordinates.
      const ux0 = Math.min(0, sx);
      const uy0 = Math.min(0, sy);
      const ux1 = Math.max(blob.w, sx + rep.w);
      const uy1 = Math.max(blob.h, sy + rep.h);
      let diff = 0;
      for (let y = uy0; y < uy1 && diff <= limit; y++) {
        for (let x = ux0; x < ux1; x++) {
          const a = x >= 0 && x < blob.w && y >= 0 && y < blob.h ? blob.px[y * blob.w + x] : 0;
          const rx = x - sx;
          const ry = y - sy;
          const b = rx >= 0 && rx < rep.w && ry >= 0 && ry < rep.h ? rep.px[ry * rep.w + rx] : 0;
          if (a !== b) diff++;
        }
      }
      if (diff > limit || (best && diff >= best.diff)) continue;
      if (!localDiffOk(blob, rep, sx, sy, ux0, uy0, ux1, uy1)) continue;
      best = { diff, sx, sy };
    }
  }
  return best;
}

function localDiffOk(
  blob: Blob,
  rep: Rep,
  sx: number,
  sy: number,
  ux0: number,
  uy0: number,
  ux1: number,
  uy1: number,
): boolean {
  const w = ux1 - ux0;
  const h = uy1 - uy0;
  const d = new Uint8Array(w * h);
  for (let y = uy0; y < uy1; y++) {
    for (let x = ux0; x < ux1; x++) {
      const a = x >= 0 && x < blob.w && y >= 0 && y < blob.h ? blob.px[y * blob.w + x] : 0;
      const rx = x - sx;
      const ry = y - sy;
      const b = rx >= 0 && rx < rep.w && ry >= 0 && ry < rep.h ? rep.px[ry * rep.w + rx] : 0;
      if (a !== b) d[(y - uy0) * w + (x - ux0)] = 1;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w) n += d[yy * w + xx];
        }
      }
      if (n > MAX_LOCAL_DIFF) return false;
    }
  }
  return true;
}

type Placed = { cls: number; x: number; y: number };

/** Groups blobs into letter classes and returns where each class instance sits. */
function cluster(blobs: Blob[], pageW: number, pageH: number) {
  type Group = { rep: Rep; votes: Uint16Array; count: number };
  const groups: Group[] = [];
  const buckets = new Map<number, number[]>();
  const key = (w: number, h: number) => w * 512 + h;
  for (const blob of blobs) {
    let bestGroup = -1;
    let bestDiff = Infinity;
    let bestMatch: Match | null = null;
    for (let dw = -1; dw <= 1; dw++) {
      for (let dh = -1; dh <= 1; dh++) {
        for (const g of buckets.get(key(blob.w + dw, blob.h + dh)) ?? []) {
          const match = compare(blob, groups[g].rep);
          if (match && match.diff < bestDiff) {
            bestDiff = match.diff;
            bestGroup = g;
            bestMatch = match;
          }
        }
      }
    }
    if (bestGroup < 0 || !bestMatch) {
      const rep: Rep = { w: blob.w, h: blob.h, px: blob.px.slice(), ink: blob.ink };
      groups.push({ rep, votes: Uint16Array.from(blob.px), count: 1 });
      const k = key(blob.w, blob.h);
      const list = buckets.get(k);
      if (list) list.push(groups.length - 1);
      else buckets.set(k, [groups.length - 1]);
      continue;
    }
    const g = groups[bestGroup];
    g.count++;
    for (let y = 0; y < g.rep.h; y++) {
      for (let x = 0; x < g.rep.w; x++) {
        const bx = x + bestMatch.sx;
        const by = y + bestMatch.sy;
        if (bx >= 0 && bx < blob.w && by >= 0 && by < blob.h) g.votes[y * g.rep.w + x] += blob.px[by * blob.w + bx];
      }
    }
  }
  // Reps become the majority shape of their group.
  for (const g of groups) {
    let ink = 0;
    for (let i = 0; i < g.votes.length; i++) {
      g.rep.px[i] = g.votes[i] * 2 > g.count ? 1 : 0;
      ink += g.rep.px[i];
    }
    g.rep.ink = ink;
  }
  // Assign each blob to its final group, rechecking against the voted shape.
  const members = new Map<number, { blob: Blob; match: Match }[]>();
  for (const blob of blobs) {
    let best = -1;
    let bestMatch: Match | null = null;
    for (let dw = -1; dw <= 1; dw++) {
      for (let dh = -1; dh <= 1; dh++) {
        // Voted reps keep their founding size, so look up by it.
        for (const g of buckets.get(key(blob.w + dw, blob.h + dh)) ?? []) {
          const match = compare(blob, groups[g].rep);
          if (match && (!bestMatch || match.diff < bestMatch.diff)) {
            best = g;
            bestMatch = match;
          }
        }
      }
    }
    if (best >= 0 && bestMatch) {
      const list = members.get(best);
      if (list) list.push({ blob, match: bestMatch });
      else members.set(best, [{ blob, match: bestMatch }]);
    }
  }
  const classes: Rep[] = [];
  const placed: Placed[] = [];
  const used: Blob[] = [];
  for (const [g, list] of members) {
    if (list.length < MIN_INSTANCES) continue;
    const rep = groups[g].rep;
    const cls = classes.length;
    const spots: Placed[] = [];
    const blobsUsed: Blob[] = [];
    for (const { blob, match } of list) {
      const x = blob.x + match.sx;
      const y = blob.y + match.sy;
      if (x < 0 || y < 0 || x + rep.w > pageW || y + rep.h > pageH) continue;
      spots.push({ cls, x, y });
      blobsUsed.push(blob);
    }
    if (spots.length < MIN_INSTANCES) continue;
    classes.push(rep);
    placed.push(...spots);
    used.push(...blobsUsed);
  }
  return { classes, placed, used };
}

/** Largest bit count for IAID, at least 1 so ids always have a code. */
function codeLength(symbols: number): number {
  let len = 0;
  while (1 << len < symbols) len++;
  return len;
}

const IA = 512;
const BASE = {
  gb: 0,
  iadh: 1 << 16,
  iadw: (1 << 16) + IA,
  iaex: (1 << 16) + 2 * IA,
  total: (1 << 16) + 3 * IA,
};

/** Annex A integer coder; null writes OOB. */
function encodeInt(mq: MqEncoder, base: number, value: number | null) {
  let prev = 1;
  const bit = (b: number) => {
    mq.encode(base + prev, b);
    prev = prev < 256 ? (prev << 1) | b : (((prev << 1) | b) & 511) | 256;
  };
  const bits = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bit(Math.floor(v / 2 ** i) % 2);
  };
  const negative = value === null || value < 0 ? 1 : 0;
  const mag = value === null ? 0 : Math.abs(value);
  bit(negative);
  if (mag < 4) {
    bit(0);
    bits(mag, 2);
  } else if (mag < 20) {
    bit(1);
    bit(0);
    bits(mag - 4, 4);
  } else if (mag < 84) {
    bit(1);
    bit(1);
    bit(0);
    bits(mag - 20, 6);
  } else if (mag < 340) {
    bit(1);
    bit(1);
    bit(1);
    bit(0);
    bits(mag - 84, 8);
  } else if (mag < 4436) {
    bit(1);
    bit(1);
    bit(1);
    bit(1);
    bit(0);
    bits(mag - 340, 12);
  } else {
    bit(1);
    bit(1);
    bit(1);
    bit(1);
    bit(1);
    bits(mag - 4436, 32);
  }
}

function dictionarySegment(number: number, classes: Rep[]): Uint8Array {
  const mq = new MqEncoder(BASE.total);
  let height = 0;
  let i = 0;
  while (i < classes.length) {
    const h = classes[i].h;
    encodeInt(mq, BASE.iadh, h - height);
    height = h;
    let width = 0;
    while (i < classes.length && classes[i].h === h) {
      const c = classes[i];
      encodeInt(mq, BASE.iadw, c.w - width);
      width = c.w;
      codeBitmap(mq, c.px, c.w, c.h, false);
      i++;
    }
    encodeInt(mq, BASE.iadw, null);
  }
  encodeInt(mq, BASE.iaex, 0);
  encodeInt(mq, BASE.iaex, classes.length);
  const flags = new Uint8Array([0, 0]); // arithmetic, template 0, no refinement
  const counts = new Uint8Array([...be32(classes.length), ...be32(classes.length)]);
  return segment(1, 0, concat([flags, DEFAULT_AT, counts, mq.finish()]));
}

function textRegionSegment(
  number: number,
  referred: number,
  classes: Rep[],
  placed: Placed[],
  pageW: number,
  pageH: number,
  logStrips: number,
): Uint8Array {
  const strips = 1 << logStrips;
  const len = codeLength(classes.length);
  const IADT = 0;
  const IAFS = IA;
  const IADS = 2 * IA;
  const IAIT = 3 * IA;
  const IAID = 4 * IA;
  const mq = new MqEncoder(IAID + (1 << (len + 1)));
  // Bottom-left reference corner: T is the symbol's bottom row.
  const rows = placed
    .map((p) => {
      const t = p.y + classes[p.cls].h - 1;
      return { ...p, t, strip: Math.floor(t / strips) };
    })
    .sort((a, b) => a.strip - b.strip || a.x - b.x);
  encodeInt(mq, IADT, 0); // initial strip = 0
  let stripNow = 0;
  let firstS = 0;
  let k = 0;
  while (k < rows.length) {
    const strip = rows[k].strip;
    encodeInt(mq, IADT, strip - stripNow);
    stripNow = strip;
    let end = k;
    while (end < rows.length && rows[end].strip === strip) end++;
    encodeInt(mq, IAFS, rows[k].x - firstS);
    firstS = rows[k].x;
    let curS = firstS;
    for (let j = k; j < end; j++) {
      const r = rows[j];
      if (j > k) {
        encodeInt(mq, IADS, r.x - curS);
        curS = r.x;
      }
      if (strips > 1) encodeInt(mq, IAIT, r.t - strip * strips);
      let prev = 1;
      for (let b = len - 1; b >= 0; b--) {
        const bit = (r.cls >> b) & 1;
        mq.encode(IAID + prev, bit);
        prev = (prev << 1) | bit;
      }
      curS += classes[r.cls].w - 1;
    }
    encodeInt(mq, IADS, null);
    k = end;
  }
  const flags = (logStrips << 2) | (0 << 4); // arithmetic, no refinement, bottom-left corner, OR
  const data = concat([
    new Uint8Array([...regionInfo(pageW, pageH), (flags >> 8) & 255, flags & 255, ...be32(placed.length)]),
    mq.finish(),
  ]);
  return segment(number, 6, data, [referred]);
}

/**
 * A /JBIG2Decode stream using a symbol dictionary, a text region that places
 * its letters, and a generic region for everything else. Null when there is
 * nothing worth putting in a dictionary.
 */
export function encodeJbig2Symbols(ink: Uint8Array, width: number, height: number): Uint8Array | null {
  const blobs = findBlobs(ink, width, height);
  if (blobs.length < 8) return null;
  const { classes, placed, used } = cluster(blobs, width, height);
  if (classes.length < 2 || placed.length < 8) return null;

  // Dictionary order: by height, then width.
  const order = classes.map((_, i) => i).sort((a, b) => classes[a].h - classes[b].h || classes[a].w - classes[b].w);
  const remap = new Map(order.map((old, now) => [old, now]));
  const sorted = order.map((i) => classes[i]);
  const spots = placed.map((p) => ({ ...p, cls: remap.get(p.cls)! }));

  const rest = ink.slice();
  for (const blob of used) for (const p of blob.cells) rest[p] = 0;
  const parts = [pageInfoSegment(0, width, height), dictionarySegment(1, sorted)];
  let bestText: Uint8Array | null = null;
  for (let log = 0; log <= 3; log++) {
    const text = textRegionSegment(2, 1, sorted, spots, width, height, log);
    if (!bestText || text.length < bestText.length) bestText = text;
  }
  parts.push(bestText!);
  if (rest.some((v) => v)) parts.push(genericRegionSegment(3, rest, width, height));
  return concat(parts);
}

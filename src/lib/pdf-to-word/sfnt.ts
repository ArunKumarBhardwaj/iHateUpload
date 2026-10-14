/** Just enough of the TrueType/OpenType container to retarget a PDF's font for Word: read tables, rebuild cmap and name, write it back. */

export type Tables = Map<string, Uint8Array>;
export type Sfnt = { flavor: number; tables: Tables };

export const TRUETYPE = 0x00010000;
export const OTTO = 0x4f54544f;

const u16 = (d: Uint8Array, at: number) => (d[at] << 8) | d[at + 1];
const u32 = (d: Uint8Array, at: number) => ((d[at] << 24) | (d[at + 1] << 16) | (d[at + 2] << 8) | d[at + 3]) >>> 0;
const tag = (d: Uint8Array, at: number) => String.fromCharCode(d[at], d[at + 1], d[at + 2], d[at + 3]);

/** The tables of a single-font file, or null when it is not a font this can read. */
export function readSfnt(data: Uint8Array): Sfnt | null {
  if (data.length < 12) return null;
  const flavor = u32(data, 0);
  if (flavor !== TRUETYPE && flavor !== OTTO) return null;
  const count = u16(data, 4);
  const tables: Tables = new Map();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    if (at + 16 > data.length) return null;
    const offset = u32(data, at + 8);
    const length = u32(data, at + 12);
    if (offset + length > data.length) return null;
    tables.set(tag(data, at), data.subarray(offset, offset + length));
  }
  return { flavor, tables };
}

function checksum(d: Uint8Array): number {
  let sum = 0;
  const whole = d.length & ~3;
  for (let i = 0; i < whole; i += 4) sum = (sum + u32(d, i)) >>> 0;
  if (d.length > whole) {
    let last = 0;
    for (let i = whole; i < whole + 4; i++) last = (last << 8) | (d[i] ?? 0);
    sum = (sum + (last >>> 0)) >>> 0;
  }
  return sum;
}

/** Tables to a font file with directory, padding and checksums (head's adjustment included). */
export function writeSfnt(flavor: number, input: Tables): Uint8Array {
  const tags = [...input.keys()].sort();
  const n = tags.length;
  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= n) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  const padded = (len: number) => (len + 3) & ~3;
  let total = 12 + n * 16;
  for (const t of tags) total += padded(input.get(t)!.length);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, flavor);
  view.setUint16(4, n);
  view.setUint16(6, searchRange);
  view.setUint16(8, entrySelector);
  view.setUint16(10, n * 16 - searchRange);
  let offset = 12 + n * 16;
  let headAt = -1;
  tags.forEach((t, i) => {
    const body = input.get(t)!;
    const copy = out.subarray(offset, offset + body.length);
    copy.set(body);
    if (t === "head" && body.length >= 12) {
      headAt = offset;
      view.setUint32(offset + 8, 0);
    }
    const at = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[at + k] = t.charCodeAt(k);
    view.setUint32(at + 4, checksum(out.subarray(offset, offset + padded(body.length))));
    view.setUint32(at + 8, offset);
    view.setUint32(at + 12, body.length);
    offset += padded(body.length);
  });
  if (headAt >= 0) view.setUint32(headAt + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

export type CmapSubtable = { platform: number; encoding: number; map: Map<number, number> };

function readSubtable(d: Uint8Array, at: number): Map<number, number> | null {
  const map = new Map<number, number>();
  const format = u16(d, at);
  if (format === 0) {
    for (let c = 0; c < 256; c++) if (d[at + 6 + c]) map.set(c, d[at + 6 + c]);
  } else if (format === 4) {
    const segs = u16(d, at + 6) / 2;
    const ends = at + 14;
    const starts = ends + segs * 2 + 2;
    const deltas = starts + segs * 2;
    const ranges = deltas + segs * 2;
    for (let s = 0; s < segs; s++) {
      const end = u16(d, ends + s * 2);
      const start = u16(d, starts + s * 2);
      const delta = u16(d, deltas + s * 2);
      const rangeOffset = u16(d, ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let gid: number;
        if (rangeOffset === 0) gid = (c + delta) & 0xffff;
        else {
          const g = ranges + s * 2 + rangeOffset + (c - start) * 2;
          if (g + 2 > d.length) continue;
          gid = u16(d, g);
          if (gid) gid = (gid + delta) & 0xffff;
        }
        if (gid) map.set(c, gid);
      }
    }
  } else if (format === 6) {
    const first = u16(d, at + 6);
    const count = u16(d, at + 8);
    for (let i = 0; i < count; i++) {
      const gid = u16(d, at + 10 + i * 2);
      if (gid) map.set(first + i, gid);
    }
  } else if (format === 12) {
    const groups = u32(d, at + 12);
    for (let g = 0; g < groups; g++) {
      const base = at + 16 + g * 12;
      const start = u32(d, base);
      const end = u32(d, base + 4);
      const gid = u32(d, base + 8);
      for (let c = start; c <= end && c - start < 0x110000; c++) map.set(c, gid + (c - start));
    }
  } else return null;
  return map;
}

export function readCmap(cmap: Uint8Array | undefined): CmapSubtable[] {
  if (!cmap || cmap.length < 4) return [];
  const out: CmapSubtable[] = [];
  const count = u16(cmap, 2);
  for (let i = 0; i < count; i++) {
    const platform = u16(cmap, 4 + i * 8);
    const encoding = u16(cmap, 6 + i * 8);
    const offset = u32(cmap, 8 + i * 8);
    if (offset + 4 > cmap.length) continue;
    const map = readSubtable(cmap, offset);
    if (map) out.push({ platform, encoding, map });
  }
  return out;
}

export const isPrivateUse = (c: number) =>
  (c >= 0xe000 && c <= 0xf8ff) || (c >= 0xf0000 && c <= 0xffffd) || (c >= 0x100000 && c <= 0x10fffd);

/** Character to glyph, from the richest Unicode subtable the font has. */
export function unicodeMap(cmap: Uint8Array | undefined): Map<number, number> {
  const subs = readCmap(cmap);
  const pick =
    subs.find((s) => s.platform === 3 && s.encoding === 10) ??
    subs.find((s) => s.platform === 3 && s.encoding === 1) ??
    subs.find((s) => s.platform === 0);
  return pick ? pick.map : new Map();
}

/** The map without private-use codes for glyphs that also have a real character. */
export function withoutPrivateCopies(map: Map<number, number>): Map<number, number> {
  const withReal = new Set<number>();
  for (const [c, g] of map) if (!isPrivateUse(c)) withReal.add(g);
  return new Map([...map].filter(([c, g]) => !isPrivateUse(c) || !withReal.has(g)));
}

/**
 * A cmap table with a single Windows Unicode subtable. A glyph that has a real character keeps
 * only that; private-use codes stay only for glyphs that have nothing else.
 */
export function buildCmap(map: Map<number, number>): Uint8Array {
  const entries = [...withoutPrivateCopies(map)]
    .filter(([c, g]) => c <= 0x10ffff && g > 0 && g < 0x10000)
    .sort((a, b) => a[0] - b[0]);
  const bmp = entries.filter(([c]) => c <= 0xfffe);
  const wide = entries.some(([c]) => c > 0xffff);

  // Format 4: runs where character and glyph move together share one segment.
  const segs: { start: number; end: number; delta: number }[] = [];
  for (const [c, g] of bmp) {
    const last = segs[segs.length - 1];
    if (last && c === last.end + 1 && ((g - c) & 0xffff) === last.delta) last.end = c;
    else segs.push({ start: c, end: c, delta: (g - c) & 0xffff });
  }
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const n = segs.length;
  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= n) entrySelector++;
  const searchRange = (1 << entrySelector) * 2;
  const len4 = 16 + n * 8;
  const f4 = new Uint8Array(len4);
  const v4 = new DataView(f4.buffer);
  v4.setUint16(0, 4);
  v4.setUint16(2, len4);
  v4.setUint16(6, n * 2);
  v4.setUint16(8, searchRange);
  v4.setUint16(10, entrySelector);
  v4.setUint16(12, n * 2 - searchRange);
  segs.forEach((s, i) => {
    v4.setUint16(14 + i * 2, s.end);
    v4.setUint16(16 + n * 2 + i * 2, s.start);
    v4.setUint16(16 + n * 4 + i * 2, s.delta);
  });

  const subtables: { platform: number; encoding: number; data: Uint8Array }[] = [{ platform: 3, encoding: 1, data: f4 }];
  if (wide) {
    const groups: { start: number; end: number; gid: number }[] = [];
    for (const [c, g] of entries) {
      const last = groups[groups.length - 1];
      if (last && c === last.end + 1 && g === last.gid + (c - last.start)) last.end = c;
      else groups.push({ start: c, end: c, gid: g });
    }
    const f12 = new Uint8Array(16 + groups.length * 12);
    const v12 = new DataView(f12.buffer);
    v12.setUint16(0, 12);
    v12.setUint32(4, f12.length);
    v12.setUint32(12, groups.length);
    groups.forEach((g, i) => {
      v12.setUint32(16 + i * 12, g.start);
      v12.setUint32(20 + i * 12, g.end);
      v12.setUint32(24 + i * 12, g.gid);
    });
    subtables.push({ platform: 3, encoding: 10, data: f12 });
  }
  const head = 4 + subtables.length * 8;
  const out = new Uint8Array(head + subtables.reduce((a, s) => a + s.data.length, 0));
  const view = new DataView(out.buffer);
  view.setUint16(2, subtables.length);
  let at = head;
  subtables.forEach((s, i) => {
    view.setUint16(4 + i * 8, s.platform);
    view.setUint16(6 + i * 8, s.encoding);
    view.setUint32(8 + i * 8, at);
    out.set(s.data, at);
    at += s.data.length;
  });
  return out;
}

export type FontStyle = { bold: boolean; italic: boolean };

const styleName = (s: FontStyle) => (s.bold && s.italic ? "Bold Italic" : s.bold ? "Bold" : s.italic ? "Italic" : "Regular");

/** A name table that calls the font `family` in the style given, which is how Word finds an embedded font. */
export function buildName(family: string, style: FontStyle): Uint8Array {
  const sub = styleName(style);
  const full = sub === "Regular" ? family : `${family} ${sub}`;
  const ps = `${family.replace(/[^A-Za-z0-9]/g, "")}-${sub.replace(/\s/g, "")}`;
  const records: [number, string][] = [
    [1, family],
    [2, sub],
    [3, `${ps};iHateUpload`],
    [4, full],
    [5, "Version 1.0"],
    [6, ps],
  ];
  const utf16 = (s: string) => {
    const b = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) {
      b[i * 2] = s.charCodeAt(i) >> 8;
      b[i * 2 + 1] = s.charCodeAt(i) & 0xff;
    }
    return b;
  };
  const latin = (s: string) => Uint8Array.from(s, (ch) => (ch.charCodeAt(0) < 256 ? ch.charCodeAt(0) : 63));
  const rows = records.flatMap(([id, text]) => [
    { platform: 1, encoding: 0, language: 0, id, data: latin(text) },
    { platform: 3, encoding: 1, language: 0x409, id, data: utf16(text) },
  ]);
  rows.sort((a, b) => a.platform - b.platform || a.encoding - b.encoding || a.language - b.language || a.id - b.id);
  const storage = 6 + rows.length * 12;
  const out = new Uint8Array(storage + rows.reduce((a, r) => a + r.data.length, 0));
  const view = new DataView(out.buffer);
  view.setUint16(2, rows.length);
  view.setUint16(4, storage);
  let at = storage;
  rows.forEach((r, i) => {
    const base = 6 + i * 12;
    view.setUint16(base, r.platform);
    view.setUint16(base + 2, r.encoding);
    view.setUint16(base + 4, r.language);
    view.setUint16(base + 6, r.id);
    view.setUint16(base + 8, r.data.length);
    view.setUint16(base + 10, at - storage);
    out.set(r.data, at);
    at += r.data.length;
  });
  return out;
}

/** The embedding permission bits of OS/2, or 0 (installable) when the font has none. */
export function embeddingFlags(tables: Tables): number {
  const os2 = tables.get("OS/2");
  return os2 && os2.length >= 10 ? u16(os2, 8) : 0;
}

/** Word may only embed a font that allows editing or installing; restricted and preview-only ones stay out. */
export function mayEmbed(tables: Tables): boolean {
  const f = embeddingFlags(tables);
  return (f & 0x0002) === 0 && (f & 0x0004) === 0;
}

/** Marks a font file as the regular/bold/italic face of `family` (name, OS/2 selection bits, head style bits). */
export function retarget(font: Sfnt, family: string, style: FontStyle, cmap: Map<number, number>): Uint8Array {
  const tables = new Map(font.tables);
  tables.set("name", buildName(family, style));
  tables.set("cmap", buildCmap(cmap));
  const head = tables.get("head");
  if (head && head.length >= 54) {
    const h = head.slice();
    const v = new DataView(h.buffer);
    v.setUint16(44, (style.bold ? 1 : 0) | (style.italic ? 2 : 0));
    tables.set("head", h);
  }
  const os2 = tables.get("OS/2");
  if (os2 && os2.length >= 64) {
    const o = os2.slice();
    const v = new DataView(o.buffer);
    v.setUint16(4, style.bold ? 700 : 400);
    // fsSelection: bit 0 italic, bit 5 bold, bit 6 regular; keep the rest.
    let sel = v.getUint16(62) & ~(1 | 32 | 64);
    sel |= (style.italic ? 1 : 0) | (style.bold ? 32 : 0) | (!style.bold && !style.italic ? 64 : 0);
    v.setUint16(62, sel);
    tables.set("OS/2", o);
  }
  return writeSfnt(font.flavor, tables);
}

/** ECMA-376 17.8.1: the first 32 bytes are XORed with the font key's GUID bytes, last byte first. */
export function obfuscate(font: Uint8Array, guid: string): Uint8Array {
  const hex = guid.replace(/[{}-]/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error("A font key is 32 hex digits.");
  const key = new Uint8Array(16);
  for (let i = 0; i < 16; i++) key[i] = parseInt(hex.slice(30 - i * 2, 32 - i * 2), 16);
  const out = font.slice();
  for (let i = 0; i < 32 && i < out.length; i++) out[i] ^= key[i % 16];
  return out;
}


/** Glyph outlines, advances and bearings of a TrueType font, by glyph number. */
export type Glyphs = { outlines: Uint8Array[]; advance: number[]; bearing: number[]; unitsPerEm: number };

export function readGlyphs(font: Sfnt): Glyphs | null {
  const { tables } = font;
  const head = tables.get("head");
  const maxp = tables.get("maxp");
  const loca = tables.get("loca");
  const glyf = tables.get("glyf");
  const hhea = tables.get("hhea");
  const hmtx = tables.get("hmtx");
  if (!head || !maxp || !loca || !glyf || !hhea || !hmtx || head.length < 54) return null;
  const count = u16(maxp, 4);
  const long = u16(head, 50) === 1;
  const at = (i: number) => (long ? u32(loca, i * 4) : u16(loca, i * 2) * 2);
  if (loca.length < (count + 1) * (long ? 4 : 2)) return null;
  const metrics = Math.max(1, u16(hhea, 34));
  const outlines: Uint8Array[] = [];
  const advance: number[] = [];
  const bearing: number[] = [];
  for (let g = 0; g < count; g++) {
    const a = at(g);
    const b = at(g + 1);
    if (b < a || b > glyf.length) return null;
    outlines.push(glyf.subarray(a, b));
    const m = Math.min(g, metrics - 1);
    advance.push(u16(hmtx, m * 4));
    bearing.push(g < metrics ? (u16(hmtx, g * 4 + 2) << 16) >> 16 : (u16(hmtx, metrics * 4 + (g - metrics) * 2) << 16) >> 16);
  }
  return { outlines, advance, bearing, unitsPerEm: u16(head, 18) };
}

/** Same outline, allowing for the zero padding a rewritten glyf table adds. */
function sameOutline(x: Uint8Array, y: Uint8Array): boolean {
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (long.length - short.length > 3) return false;
  for (let i = 0; i < long.length; i++) if ((short[i] ?? 0) !== long[i]) return false;
  return true;
}

/** The glyphs the characters map to, plus every glyph a composite among them is built from. */
function neededGlyphs(glyphs: Glyphs, map: Map<number, number>): Set<number> {
  const need = new Set<number>([0]);
  const queue: number[] = [];
  for (const g of map.values()) {
    if (!need.has(g)) {
      need.add(g);
      queue.push(g);
    }
  }
  while (queue.length) {
    const o = glyphs.outlines[queue.pop()!];
    if (!o || o.length < 10 || ((o[0] << 8) | o[1]) < 0x8000) continue;
    for (let at = 10; at + 4 <= o.length; ) {
      const flags = u16(o, at);
      const part = u16(o, at + 2);
      if (!need.has(part)) {
        need.add(part);
        queue.push(part);
      }
      at += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
      if (!(flags & 0x20)) break;
    }
  }
  return need;
}

/**
 * Joins two subsets of one font into a single file. PDF producers subset a font several times (Chrome
 * does it per size), but glyph numbers stay those of the full font, so the glyphs just add up.
 * Returns null when the two disagree about a glyph or a character, or are not the same kind of file.
 */
export function mergeSubsets(a: Sfnt, b: Sfnt): Sfnt | null {
  if (a.flavor !== TRUETYPE || b.flavor !== TRUETYPE) return null;
  const ga = readGlyphs(a);
  const gb = readGlyphs(b);
  if (!ga || !gb || ga.unitsPerEm !== gb.unitsPerEm) return null;
  const count = Math.max(ga.outlines.length, gb.outlines.length);
  const mapA = withoutPrivateCopies(unicodeMap(a.tables.get("cmap")));
  const mapB = withoutPrivateCopies(unicodeMap(b.tables.get("cmap")));
  const same = (g: number, h: number) => {
    const oa = ga.outlines[g] ?? new Uint8Array(0);
    const ob = gb.outlines[h] ?? new Uint8Array(0);
    const wa = ga.advance[g] ?? 0;
    const wb = gb.advance[h] ?? 0;
    return sameOutline(oa, ob) && (!wa || !wb || wa === wb);
  };
  const cmap = new Map(mapA);
  const extra = new Map<number, number>();
  for (const [c, g] of mapB) {
    // Each subset parks its own filler glyph under the first private-use code; that is not a character.
    if (isPrivateUse(c)) {
      if (cmap.has(c) && !same(cmap.get(c)!, g)) cmap.delete(c);
      continue;
    }
    const have = cmap.get(c);
    if (have === undefined) {
      cmap.set(c, g);
      extra.set(c, g);
    } else if (!same(have, g)) return null;
  }
  const usedA = neededGlyphs(ga, mapA);
  const usedB = neededGlyphs(gb, extra);
  const outlines: Uint8Array[] = [];
  const advance: number[] = [];
  const bearing: number[] = [];
  for (let g = 0; g < count; g++) {
    const oa = ga.outlines[g] ?? new Uint8Array(0);
    const ob = gb.outlines[g] ?? new Uint8Array(0);
    const wa = ga.advance[g] ?? 0;
    const wb = gb.advance[g] ?? 0;
    if (g > 0 && usedA.has(g) && usedB.has(g)) {
      if (!sameOutline(oa, ob) || (wa && wb && wa !== wb)) return null;
    }
    const fromB = !usedA.has(g) && (usedB.has(g) || !oa.length);
    outlines.push(fromB ? ob : oa);
    advance.push(fromB ? wb || wa : wa || wb);
    bearing.push(fromB ? (gb.bearing[g] ?? 0) : (ga.bearing[g] ?? 0));
  }

  const offsets = [0];
  for (const o of outlines) offsets.push(offsets[offsets.length - 1] + ((o.length + 3) & ~3));
  const glyf = new Uint8Array(offsets[offsets.length - 1]);
  outlines.forEach((o, i) => glyf.set(o, offsets[i]));
  const loca = new Uint8Array((count + 1) * 4);
  const lv = new DataView(loca.buffer);
  offsets.forEach((o, i) => lv.setUint32(i * 4, o));
  const hmtx = new Uint8Array(count * 4);
  const hv = new DataView(hmtx.buffer);
  for (let g = 0; g < count; g++) {
    hv.setUint16(g * 4, advance[g]);
    hv.setInt16(g * 4 + 2, bearing[g]);
  }

  const tables = new Map(a.tables);
  tables.set("glyf", glyf);
  tables.set("loca", loca);
  tables.set("hmtx", hmtx);
  tables.set("cmap", buildCmap(cmap));
  const head = a.tables.get("head")!.slice();
  new DataView(head.buffer).setInt16(50, 1);
  tables.set("head", head);
  const hhea = a.tables.get("hhea")!.slice();
  new DataView(hhea.buffer).setUint16(34, count);
  tables.set("hhea", hhea);
  const maxpA = a.tables.get("maxp")!;
  const maxpB = b.tables.get("maxp")!;
  const maxp = maxpA.slice();
  const mv = new DataView(maxp.buffer);
  mv.setUint16(4, count);
  for (let at = 6; at + 2 <= maxp.length && at + 2 <= maxpB.length; at += 2) mv.setUint16(at, Math.max(u16(maxpA, at), u16(maxpB, at)));
  tables.set("maxp", maxp);
  // Glyph names would no longer line up with the glyph count.
  const post = a.tables.get("post");
  if (post && post.length >= 32) {
    const p = post.slice(0, 32);
    new DataView(p.buffer).setUint32(0, 0x00030000);
    tables.set("post", p);
  }
  return { flavor: a.flavor, tables };
}

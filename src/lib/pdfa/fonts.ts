import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from "@cantoo/pdf-lib";
import { Encodings, Font, type FontNames } from "@pdf-lib/standard-fonts";

import { TRUETYPE, buildCmap, readSfnt, unicodeMap, writeSfnt } from "@/lib/pdf-to-word/sfnt";

import { cffGlyphNames, cffSubset, cffWidths, withAccentParts } from "./cff";
import { reachable } from "./walk";

/**
 * PDF/A wants every font's program inside the file. Fonts a PDF only names
 * (the standard 14, or "Arial" left unembedded) are swapped for free
 * metric-compatible ones that pdf.js already ships: Liberation Sans (TrueType)
 * for Helvetica/Arial, and the Chromium/Foxit CFF fonts for Times, Courier,
 * Symbol and ZapfDingbats. Widths are rewritten from the font we embed, so
 * the dictionary and the program always agree.
 */

const N = PDFName.of;

export type LoadFont = (file: string) => Promise<Uint8Array>;

type Family = "sans" | "serif" | "mono" | "symbol" | "dingbats";
type Style = { bold: boolean; italic: boolean };

type Target = {
  file: string;
  afm: FontNames;
  kind: "ttf" | "cff";
  psName: string;
};

function target(family: Family, { bold, italic }: Style): Target {
  const suffix = (bold ? "Bold" : "") + (italic ? "Italic" : "");
  switch (family) {
    case "sans":
      return {
        file: `LiberationSans-${suffix || "Regular"}.ttf`,
        afm: (["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"] as FontNames[])[
          (bold ? 1 : 0) + (italic ? 2 : 0)
        ],
        kind: "ttf",
        psName: `LiberationSans${suffix ? `-${suffix}` : ""}`,
      };
    case "serif":
      return {
        file: `FoxitSerif${suffix}.pfb`,
        afm: (["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"] as FontNames[])[
          (bold ? 1 : 0) + (italic ? 2 : 0)
        ],
        kind: "cff",
        psName: `FoxitSerif${suffix}`,
      };
    case "mono":
      return {
        file: `FoxitFixed${suffix}.pfb`,
        afm: (["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"] as FontNames[])[
          (bold ? 1 : 0) + (italic ? 2 : 0)
        ],
        kind: "cff",
        psName: `FoxitFixed${suffix}`,
      };
    case "symbol":
      return { file: "FoxitSymbol.pfb", afm: "Symbol" as FontNames, kind: "cff", psName: "FoxitSymbol" };
    case "dingbats":
      return { file: "FoxitDingbats.pfb", afm: "ZapfDingbats" as FontNames, kind: "cff", psName: "FoxitDingbats" };
  }
}

// --- encodings -------------------------------------------------------------

type CodeMap = Map<number, string>;

function fromEncoding(enc: (typeof Encodings)[keyof typeof Encodings]): CodeMap {
  const map: CodeMap = new Map();
  const mappings = (enc as unknown as { unicodeMappings: Record<number, [number, string]> }).unicodeMappings;
  for (const [code, name] of Object.values(mappings)) if (!map.has(code)) map.set(code, name);
  return map;
}

const WIN_ANSI = fromEncoding(Encodings.WinAnsi);

/** Glyph name to Unicode for every name WinAnsi uses, plus the few StandardEncoding adds. */
const NAME_TO_UNICODE = new Map<string, number>([
  ["fi", 0xfb01],
  ["fl", 0xfb02],
  ["fraction", 0x2044],
  ["Lslash", 0x141],
  ["lslash", 0x142],
  ["dotlessi", 0x131],
  ["breve", 0x2d8],
  ["dotaccent", 0x2d9],
  ["ring", 0x2da],
  ["hungarumlaut", 0x2dd],
  ["ogonek", 0x2db],
  ["caron", 0x2c7],
]);
for (const [unicode, [, name]] of Object.entries(
  (Encodings.WinAnsi as unknown as { unicodeMappings: Record<number, [number, string]> }).unicodeMappings,
)) {
  if (!NAME_TO_UNICODE.has(name)) NAME_TO_UNICODE.set(name, Number(unicode));
}

/** StandardEncoding, as the codes where it differs from WinAnsi (PDF 32000 annex D). */
const STANDARD_DIFFS: [number, string | null][] = [
  [0x27, "quoteright"], [0x60, "quoteleft"],
  ...Array.from({ length: 0x21 }, (_, i) => [0x80 + i, null] as [number, null]),
  ...(
    "a1 exclamdown a2 cent a3 sterling a4 fraction a5 yen a6 florin a7 section a8 currency a9 quotesingle " +
    "aa quotedblleft ab guillemotleft ac guilsinglleft ad guilsinglright ae fi af fl b0 - b1 endash b2 dagger " +
    "b3 daggerdbl b4 periodcentered b5 - b6 paragraph b7 bullet b8 quotesinglbase b9 quotedblbase ba quotedblright " +
    "bb guillemotright bc ellipsis bd perthousand be - bf questiondown c0 - c1 grave c2 acute c3 circumflex c4 tilde " +
    "c5 macron c6 breve c7 dotaccent c8 dieresis c9 - ca ring cb cedilla cc - cd hungarumlaut ce ogonek cf caron " +
    "d0 emdash e1 AE e3 ordfeminine e8 Lslash e9 Oslash ea OE eb ordmasculine f1 ae f5 dotlessi f8 lslash " +
    "f9 oslash fa oe fb germandbls"
  )
    .split(" ")
    .reduce<[number, string | null][]>((out, word, i, all) => {
      if (i % 2 === 0) out.push([parseInt(word, 16), all[i + 1] === "-" ? null : all[i + 1]]);
      return out;
    }, []),
];

function standardEncoding(): CodeMap {
  const map = new Map(WIN_ANSI);
  for (const [code, name] of STANDARD_DIFFS) {
    if (name) map.set(code, name);
    else map.delete(code);
  }
  // Every code from d0 to ff that StandardEncoding leaves out.
  for (let code = 0xd1; code <= 0xff; code++) {
    if (!STANDARD_DIFFS.some(([c]) => c === code)) map.delete(code);
  }
  return map;
}

const STANDARD = standardEncoding();

const BUILTIN: Partial<Record<Family, CodeMap>> = {
  symbol: fromEncoding(Encodings.Symbol),
  dingbats: fromEncoding(Encodings.ZapfDingbats),
};

/** The code to glyph-name map a simple font dictionary asks for. Null when it cannot be known. */
function effectiveEncoding(doc: PDFDocument, font: PDFDict, family: Family): CodeMap | null {
  const builtin = BUILTIN[family] ?? STANDARD;
  const raw = font.get(N("Encoding"));
  const enc = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
  const base = (name: string | undefined): CodeMap | null => {
    if (!name) return new Map(builtin);
    if (name === "/WinAnsiEncoding") return new Map(WIN_ANSI);
    if (name === "/StandardEncoding") return new Map(STANDARD);
    return null; // MacRoman and Expert: not mapped here.
  };
  if (enc instanceof PDFName) return base(enc.toString());
  if (!enc) return base(undefined);
  if (!(enc instanceof PDFDict)) return null;
  const map = base(enc.get(N("BaseEncoding"))?.toString());
  if (!map) return null;
  const diffs = enc.lookupMaybe(N("Differences"), PDFArray);
  let code = 0;
  for (const item of diffs?.asArray() ?? []) {
    if (item instanceof PDFNumber) code = item.asNumber();
    else if (item instanceof PDFName) map.set(code++, item.decodeText());
  }
  return map;
}

// --- choosing a replacement --------------------------------------------------

const KNOWN: [RegExp, Family][] = [
  [/^(helvetica|arial|arialmt|liberationsans|nimbussans)/, "sans"],
  [/^(times|timesnewroman|liberationserif|nimbusroman)/, "serif"],
  [/^(courier|couriernew|liberationmono|nimbusmono)/, "mono"],
  [/^symbol/, "symbol"],
  [/^(zapfdingbats|dingbats)/, "dingbats"],
];

function familyOf(name: string, flags: number): Family {
  const flat = name.toLowerCase().replace(/[\s_-]/g, "");
  for (const [re, family] of KNOWN) if (re.test(flat)) return family;
  if (flags & 1) return "mono";
  if (/mono|consol|typewriter/.test(flat)) return "mono";
  if (flags & 2 || /serif|georgia|garamond|cambria|book|roman|minion|palatino/.test(flat)) {
    return /sans/.test(flat) ? "sans" : "serif";
  }
  return "sans";
}

function styleOf(name: string, desc: PDFDict | undefined): Style {
  const flags = Number(desc?.get(N("Flags"))?.toString() ?? 0);
  const weight = Number(desc?.get(N("FontWeight"))?.toString() ?? 0);
  const angle = Number(desc?.get(N("ItalicAngle"))?.toString() ?? 0);
  return {
    bold: /bold|black|heavy|semibold|demi/i.test(name) || weight >= 600 || (flags & 0x40000) !== 0,
    italic: /italic|oblique/i.test(name) || angle !== 0 || (flags & 64) !== 0,
  };
}

export type FontVerdict =
  | { kind: "embedded" }
  | { kind: "replace"; family: Family; style: Style; codes: CodeMap }
  | { kind: "picture"; reason: string };

function baseName(font: PDFDict) {
  return (font.get(N("BaseFont"))?.toString() ?? "/Unknown").slice(1).replace(/^[A-Z]{6}\+/, "");
}

function hasProgram(desc: PDFDict | undefined) {
  return !!desc && ["FontFile", "FontFile2", "FontFile3"].some((k) => desc.has(N(k)));
}

export function judgeFont(doc: PDFDocument, font: PDFDict): FontVerdict {
  const subtype = font.get(N("Subtype"))?.toString();
  // Type 3 fonts are drawings; CIDFonts are judged through their Type 0 parent.
  if (subtype === "/Type3" || subtype?.startsWith("/CIDFontType")) return { kind: "embedded" };
  if (subtype === "/Type0") {
    const kid = font.lookupMaybe(N("DescendantFonts"), PDFArray)?.lookup(0);
    const desc = kid instanceof PDFDict ? kid.lookupMaybe(N("FontDescriptor"), PDFDict) : undefined;
    return hasProgram(desc)
      ? { kind: "embedded" }
      : { kind: "picture", reason: `font ${baseName(font)} is not in the file` };
  }
  const desc = font.lookupMaybe(N("FontDescriptor"), PDFDict);
  if (hasProgram(desc)) return { kind: "embedded" };
  const name = baseName(font);
  const flags = Number(desc?.get(N("Flags"))?.toString() ?? 0);
  const family = familyOf(name, flags);
  // A symbolic font we have no stand-in for (Wingdings and the like).
  if (flags & 4 && family !== "symbol" && family !== "dingbats" && !KNOWN.some(([re]) => re.test(name.toLowerCase().replace(/[\s_-]/g, "")))) {
    return { kind: "picture", reason: `symbol font ${name} is not in the file` };
  }
  const codes = effectiveEncoding(doc, font, family);
  if (!codes) return { kind: "picture", reason: `font ${name} uses an encoding we cannot map` };
  const style = family === "symbol" || family === "dingbats" ? { bold: false, italic: false } : styleOf(name, desc);
  if (family === "sans") {
    for (const glyph of codes.values()) {
      if (!NAME_TO_UNICODE.has(glyph)) return { kind: "picture", reason: `font ${name} needs glyph ${glyph}` };
    }
  }
  return { kind: "replace", family, style, codes };
}

// --- TrueType subsetting that keeps glyph ids ---------------------------------

const u16 = (d: Uint8Array, at: number) => (d[at] << 8) | d[at + 1];
const u32 = (d: Uint8Array, at: number) => ((d[at] << 24) | (d[at + 1] << 16) | (d[at + 2] << 8) | d[at + 3]) >>> 0;

// Layout and hinting tables a PDF never uses; without hints, glyph instructions go too.
const DROP = ["GSUB", "GPOS", "GDEF", "kern", "DSIG", "hdmx", "LTSH", "VDMX", "JSTF", "BASE", "morx", "feat", "meta", "fpgm", "prep", "cvt ", "gasp", "FFTM", "name"];

/** A glyph with its hinting instructions cut out. */
function withoutInstructions(data: Uint8Array): Uint8Array {
  if (data.length < 10) return data;
  const contours = (data[0] << 8 | data[1]) << 16 >> 16;
  if (contours >= 0) {
    const at = 10 + contours * 2;
    if (at + 2 > data.length) return data;
    const length = u16(data, at);
    const out = new Uint8Array(data.length - length);
    out.set(data.subarray(0, at));
    out.set(data.subarray(at + 2 + length), at + 2);
    return out;
  }
  const out = data.slice();
  let at = 10;
  for (;;) {
    const flags = u16(out, at);
    out[at] &= ~0x01; // clear WE_HAVE_INSTRUCTIONS (0x100)
    at += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
    if (!(flags & 0x20) || at >= out.length) break;
  }
  return out.subarray(0, at);
}

/**
 * Empties every glyph outside `keep` (and their composite parts) but keeps the
 * glyph count, so the cmap, hmtx and the PDF's codes stay valid.
 */
export function zeroUnusedGlyphs(
  font: Uint8Array,
  keep: Set<number>,
  cmap?: Map<number, number>,
  /** Tables to keep that would otherwise go, e.g. "name" for fontkit. */
  keepTables: string[] = [],
): Uint8Array {
  const sfnt = readSfnt(font);
  const head = sfnt?.tables.get("head");
  const loca = sfnt?.tables.get("loca");
  const glyf = sfnt?.tables.get("glyf");
  const maxp = sfnt?.tables.get("maxp");
  if (!sfnt || !head || !loca || !glyf || !maxp) return font;
  const count = u16(maxp, 4);
  const long = u16(head, 50) === 1;
  const offset = (g: number) => (long ? u32(loca, g * 4) : u16(loca, g * 2) * 2);
  const glyph = (g: number) => glyf.subarray(offset(g), offset(g + 1));

  const wanted = new Set<number>([0]);
  const visit = (g: number) => {
    if (g >= count || wanted.has(g) && g !== 0) return;
    wanted.add(g);
    const data = glyph(g);
    if (data.length < 10 || (u16(data, 0) & 0x8000) === 0) return;
    let at = 10;
    for (;;) {
      const flags = u16(data, at);
      visit(u16(data, at + 2));
      at += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
      if (!(flags & 0x20) || at >= data.length) break;
    }
  };
  for (const g of keep) visit(g);
  visit(0);

  const parts: Uint8Array[] = [];
  const newLoca = new Uint8Array((count + 1) * 4);
  const view = new DataView(newLoca.buffer);
  let at = 0;
  for (let g = 0; g < count; g++) {
    view.setUint32(g * 4, at);
    if (!wanted.has(g)) continue;
    const data = withoutInstructions(glyph(g));
    const padded = (data.length + 3) & ~3;
    const copy = new Uint8Array(padded);
    copy.set(data);
    parts.push(copy);
    at += padded;
  }
  view.setUint32(count * 4, at);
  const newGlyf = new Uint8Array(at);
  let cursor = 0;
  for (const p of parts) {
    newGlyf.set(p, cursor);
    cursor += p.length;
  }
  const newHead = head.slice();
  newHead[50] = 0;
  newHead[51] = 1;
  const tables = new Map(sfnt.tables);
  tables.set("head", newHead);
  tables.set("loca", newLoca);
  tables.set("glyf", newGlyf);
  for (const t of DROP) if (!keepTables.includes(t)) tables.delete(t);
  const post = tables.get("post");
  if (post && post.length >= 32) {
    // Version 3: no glyph names; the PDF finds glyphs through the cmap.
    const v3 = post.slice(0, 32);
    v3.set([0, 3, 0, 0], 0);
    tables.set("post", v3);
  }
  if (cmap) tables.set("cmap", buildCmap(cmap));
  return writeSfnt(TRUETYPE, tables);
}

function tagFor(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += String.fromCharCode(65 + (h % 26));
    h = Math.floor(h / 26) + i * 7919;
  }
  return out;
}

// --- writing the replacement ----------------------------------------------------

type Prepared = {
  file: PDFRef;
  widths: (name: string) => number | undefined;
  descriptor: (flags: number) => Record<string, unknown>;
  name: string;
};

function afmDescriptor(afm: Font, name: string) {
  return {
    Type: "FontDescriptor",
    FontName: name,
    FontBBox: afm.FontBBox,
    ItalicAngle: afm.ItalicAngle,
    Ascent: afm.Ascender ?? afm.FontBBox[3],
    Descent: afm.Descender ?? afm.FontBBox[1],
    CapHeight: afm.CapHeight ?? afm.FontBBox[3],
    StemV: afm.StdVW ?? 80,
  };
}

/**
 * `used`: the codes this font draws, when known. The TrueType stand-in keeps
 * only those glyphs; without it every glyph the encoding names is kept.
 */
export type ReplaceJob = { font: PDFDict; verdict: Extract<FontVerdict, { kind: "replace" }>; used?: Set<number> };

/**
 * Embeds a stand-in for each font in `jobs`. One font program per file is
 * shared by every dictionary that uses it. Returns the names it embedded.
 */
export async function replaceFonts(doc: PDFDocument, jobs: ReplaceJob[], loadFont: LoadFont): Promise<string[]> {
  const byFile = new Map<string, { target: Target; jobs: ReplaceJob[] }>();
  for (const job of jobs) {
    const t = target(job.verdict.family, job.verdict.style);
    const entry = byFile.get(t.file) ?? { target: t, jobs: [] };
    entry.jobs.push(job);
    byFile.set(t.file, entry);
  }
  const embedded: string[] = [];
  for (const { target: t, jobs: group } of byFile.values()) {
    const prepared = await prepare(doc, t, group, loadFont);
    embedded.push(prepared.name);
    for (const job of group) writeFont(doc, job, t, prepared);
  }
  return embedded;
}

async function prepare(doc: PDFDocument, t: Target, group: ReplaceJob[], loadFont: LoadFont): Promise<Prepared> {
  const bytes = await loadFont(t.file);
  const afm = Font.load(t.afm);
  if (t.kind === "cff") {
    // Read from the program itself: the old AFM metrics have no Euro, for one.
    const widths = cffWidths(bytes);
    if (!widths) throw new Error(`${t.file} is not a CFF font.`);
    let program = bytes;
    let name = t.psName;
    let charSet: string | undefined;
    if (group.every((job) => job.used)) {
      const names = new Set<string>();
      for (const job of group) for (const code of job.used!) {
        const glyph = job.verdict.codes.get(code);
        if (glyph) names.add(glyph);
      }
      const keep = withAccentParts(names);
      const subset = cffSubset(bytes, keep);
      const kept = subset && cffGlyphNames(subset);
      if (subset && kept) {
        program = subset;
        name = `${tagFor(t.psName + [...keep].sort().join(","))}+${t.psName}`;
        charSet = kept.map((n) => `/${n}`).join("");
      }
    }
    const stream = doc.context.flateStream(program, { Subtype: "Type1C" });
    return {
      file: doc.context.register(stream),
      widths: (glyph) => widths.get(glyph),
      descriptor: (flags) => ({ ...afmDescriptor(afm, name), Flags: flags, ...(charSet ? { CharSet: PDFString.of(charSet) } : {}) }),
      name,
    };
  }
  const sfnt = readSfnt(bytes);
  if (!sfnt) throw new Error(`${t.file} is not a TrueType font.`);
  const cmap = unicodeMap(sfnt.tables.get("cmap"));
  const head = sfnt.tables.get("head")!;
  const hhea = sfnt.tables.get("hhea")!;
  const hmtx = sfnt.tables.get("hmtx")!;
  const upem = u16(head, 18);
  const metrics = u16(hhea, 34);
  const advance = (gid: number) => u16(hmtx, Math.min(gid, metrics - 1) * 4);
  const gidOf = (name: string) => {
    const unicode = NAME_TO_UNICODE.get(name);
    return unicode === undefined ? undefined : cmap.get(unicode);
  };
  const keep = new Set<number>();
  for (const job of group) {
    for (const [code, name] of job.verdict.codes) {
      if (job.used && !job.used.has(code)) continue;
      const gid = gidOf(name);
      if (gid !== undefined) keep.add(gid);
    }
  }
  const kept = new Map([...cmap].filter(([, g]) => keep.has(g)));
  const program = zeroUnusedGlyphs(bytes, keep, kept);
  const stream = doc.context.flateStream(program, { Length1: program.length });
  const name = `${tagFor(t.psName + [...keep].join(","))}+${t.psName}`;
  return {
    file: doc.context.register(stream),
    widths: (glyph) => {
      const gid = gidOf(glyph);
      return gid === undefined ? undefined : Math.round((advance(gid) * 1000) / upem);
    },
    descriptor: (flags) => ({ ...afmDescriptor(afm, name), Flags: flags }),
    name,
  };
}

function writeFont(doc: PDFDocument, { font, verdict }: ReplaceJob, t: Target, prepared: Prepared) {
  const ctx = doc.context;
  const { codes, family, style } = verdict;
  const symbolic = family === "symbol" || family === "dingbats";
  const flags =
    (symbolic ? 4 : 32) | (family === "serif" ? 2 : 0) | (family === "mono" ? 1 : 0) | (style.italic ? 64 : 0);

  const usable = [...codes.entries()].filter(([, name]) => prepared.widths(name) !== undefined);
  const first = usable.length ? Math.min(...usable.map(([c]) => c)) : 32;
  const last = usable.length ? Math.max(...usable.map(([c]) => c)) : 32;
  const widths: number[] = [];
  for (let code = first; code <= last; code++) {
    const name = codes.get(code);
    widths.push((name && prepared.widths(name)) || 0);
  }

  // The encoding is spelt out in full, against WinAnsi, for both kinds of font.
  const diffs: (number | PDFName)[] = [];
  let run = -2;
  for (let code = first; code <= last; code++) {
    const name = codes.get(code);
    if (!name || (!symbolic && WIN_ANSI.get(code) === name)) continue;
    if (code !== run + 1) diffs.push(code);
    diffs.push(N(name));
    run = code;
  }
  const encoding = symbolic
    ? { Type: "Encoding", Differences: diffs }
    : diffs.length
      ? { Type: "Encoding", BaseEncoding: "WinAnsiEncoding", Differences: diffs }
      : "WinAnsiEncoding";

  const descriptor = ctx.obj(prepared.descriptor(flags) as never) as unknown as PDFDict;
  descriptor.set(N(t.kind === "ttf" ? "FontFile2" : "FontFile3"), prepared.file);

  font.set(N("Subtype"), N(t.kind === "ttf" ? "TrueType" : "Type1"));
  font.set(N("BaseFont"), N(prepared.name));
  font.set(N("FirstChar"), ctx.obj(first));
  font.set(N("LastChar"), ctx.obj(last));
  font.set(N("Widths"), ctx.obj(widths));
  font.set(N("Encoding"), ctx.obj(encoding as never));
  font.set(N("FontDescriptor"), ctx.register(descriptor));
}

/** Every font dictionary reachable in the file, direct ones in resource dictionaries too. */
export function allFontDicts(doc: PDFDocument): PDFDict[] {
  return reachable(doc)
    .filter(
      ({ dict, stream }) =>
        !stream &&
        (dict.get(N("Type"))?.toString() === "/Font" ||
          (dict.has(N("BaseFont")) && /^\/(Type1|MMType1|TrueType|Type0)$/.test(dict.get(N("Subtype"))?.toString() ?? ""))),
    )
    .map(({ dict }) => dict);
}

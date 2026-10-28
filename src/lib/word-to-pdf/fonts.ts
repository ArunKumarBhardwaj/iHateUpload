/**
 * Fonts for the Word -> PDF engine.
 *  - Arial/Times/Courier-like text uses the PDF standard fonts (not embedded, tiny files).
 *  - Calibri and Cambria text uses bundled metric-compatible Carlito and Caladea (embedded) so line breaks match Word.
 *  - A word whose glyphs the chosen face lacks switches, for that word only, to an embedded
 *    Liberation Sans (Latin, Greek, Cyrillic). Currency signs it lacks (₹, ₽, ₺, ...) come from a
 *    small DejaVu Sans subset, and the Indian scripts and Urdu from their Noto fonts, which HarfBuzz
 *    shapes (conjuncts, matras, joining) and are drawn glyph by glyph at the shaped positions.
 *    Glyphs nobody has (CJK, ...) become "?" and are reported.
 */
import {
  PDFHexString,
  PDFName,
  PDFOperator,
  LineJoinStyle,
  StandardFonts,
  TextRenderingMode,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFillingColor,
  setFontAndSize,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  type Color,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
} from "@cantoo/pdf-lib";

import { hbFont, loadHarfBuzz, type HbFont, type Shaped } from "./harfbuzz";
import type { FontKey } from "./layout";
import type { Family } from "./model";

const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

export function isWinAnsi(cp: number): boolean {
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(cp);
}

/** Normalise whitespace and drop control characters. */
export function normalise(text: string): string {
  return text
    .replace(/[   ]/g, " ")
    .replace(/[ -  - ]/g, " ")
    // ZWNJ and ZWJ (U+200C, U+200D) stay: they choose Devanagari half forms
    .replace(/[​‎‏­⁠﻿]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "");
}

const STD: Record<string, StandardFonts> = {
  "sans-0-0": StandardFonts.Helvetica,
  "sans-1-0": StandardFonts.HelveticaBold,
  "sans-0-1": StandardFonts.HelveticaOblique,
  "sans-1-1": StandardFonts.HelveticaBoldOblique,
  "serif-0-0": StandardFonts.TimesRoman,
  "serif-1-0": StandardFonts.TimesRomanBold,
  "serif-0-1": StandardFonts.TimesRomanItalic,
  "serif-1-1": StandardFonts.TimesRomanBoldItalic,
  "mono-0-0": StandardFonts.Courier,
  "mono-1-0": StandardFonts.CourierBold,
  "mono-0-1": StandardFonts.CourierOblique,
  "mono-1-1": StandardFonts.CourierBoldOblique,
};

/**
 * Scripts that are shaped (letters join, reorder and stack), each from one Noto font, regular weight
 * for every style: Noto's bolds are far heavier than the Indian fonts in Office files (Kruti Dev and
 * DevLys have no bold at all, so Office emboldens them), so bold is drawn by thickening the regular
 * glyphs, and italic by slanting them.
 */
const SCRIPTS: { name: string; file: string; label: string; ranges: [number, number][] }[] = [
  { name: "deva", file: "NotoSansDevanagari", label: "Hindi", ranges: [[0x0900, 0x097f], [0xa8e0, 0xa8ff], [0x1cd0, 0x1cff]] },
  { name: "beng", file: "NotoSansBengali", label: "Bengali", ranges: [[0x0980, 0x09ff]] },
  { name: "guru", file: "NotoSansGurmukhi", label: "Punjabi", ranges: [[0x0a00, 0x0a7f]] },
  { name: "gujr", file: "NotoSansGujarati", label: "Gujarati", ranges: [[0x0a80, 0x0aff]] },
  { name: "orya", file: "NotoSansOriya", label: "Odia", ranges: [[0x0b00, 0x0b7f]] },
  { name: "taml", file: "NotoSansTamil", label: "Tamil", ranges: [[0x0b80, 0x0bff], [0x11fc0, 0x11fff]] },
  { name: "telu", file: "NotoSansTelugu", label: "Telugu", ranges: [[0x0c00, 0x0c7f]] },
  { name: "knda", file: "NotoSansKannada", label: "Kannada", ranges: [[0x0c80, 0x0cff]] },
  { name: "mlym", file: "NotoSansMalayalam", label: "Malayalam", ranges: [[0x0d00, 0x0d7f]] },
  { name: "olck", file: "NotoSansOlChiki", label: "Santali", ranges: [[0x1c50, 0x1c7f]] },
  { name: "mtei", file: "NotoSansMeeteiMayek", label: "Manipuri", ranges: [[0xaae0, 0xaaff], [0xabc0, 0xabff]] },
  {
    name: "arab",
    file: "NotoNaskhArabic",
    label: "Urdu",
    ranges: [[0x0600, 0x06ff], [0x0750, 0x077f], [0x08a0, 0x08ff], [0xfb50, 0xfdff], [0xfe70, 0xfeff]],
  },
];
const SCRIPT_BY_NAME = new Map(SCRIPTS.map((s) => [s.name, s]));
/** The shaped script a code point belongs to, if any. */
export function scriptOf(cp: number): string | undefined {
  for (const s of SCRIPTS) for (const [a, b] of s.ranges) if (cp >= a && cp <= b) return s.name;
  return undefined;
}
/** Devanagari, Devanagari Extended and Vedic Extensions */
export const isDevanagari = (cp: number) => scriptOf(cp) === "deva";
/** Arabic-Indic and Extended Arabic-Indic digits, and numbers made of them */
const ARABIC_DIGIT = /[\u0660-\u0669\u06F0-\u06F9]/;
const ARABIC_NUMBER = /([\u0660-\u0669\u06F0-\u06F9]+(?:[.,\u066B\u066C][\u0660-\u0669\u06F0-\u06F9]+)*)/;
const ARABIC_NUMBER_ONLY = /^[\u0660-\u0669\u06F0-\u06F9.,\u066B\u066C]+$/;
/** the danda and double danda, which Bengali, Gurmukhi and Odia text use from the Devanagari block */
const isDanda = (cp: number) => cp === 0x0964 || cp === 0x0965;

const FILES: Record<string, string> = {
  carlito: "Carlito",
  caladea: "Caladea",
  uni: "LiberationSans",
  cur: "DejaVuCurrency",
  ...Object.fromEntries(SCRIPTS.map((s) => [s.name, s.file])),
};
type Bundled = "carlito" | "caladea" | "uni" | "cur" | (typeof SCRIPTS)[number]["name"];
const fileFor = (name: Bundled, v: string) => `${FILES[name]}-${SCRIPT_BY_NAME.has(name) ? "Regular" : SUFFIX[v]}.ttf`;
/** outline added to each stroke of faux-bold shaped scripts, as a fraction of the font size */
const FAUX_BOLD = 0.02;
/** the Currency Symbols block, which the DejaVuCurrency subset covers */
const isCurrency = (cp: number) => cp >= 0x20a0 && cp <= 0x20c0;
const SUFFIX: Record<string, string> = { "0-0": "Regular", "1-0": "Bold", "0-1": "Italic", "1-1": "BoldItalic" };
/**
 * Latin text is set without kerning, ligatures or contextual alternates, as Word and Excel do by
 * default. It also keeps measuring and drawing in step: pdf-lib draws plain advances (no kerning), and
 * only writes widths for glyphs reachable from a character, so a ligature glyph (Carlito has "ti",
 * "fi", "ff"...) would get the default 1em width and push the rest of the line right.
 * Devanagari keeps every feature: its shaping needs them, and it places its own glyphs.
 */
const LATIN_FEATURES = { kern: false, liga: false, clig: false, calt: false, dlig: false };

interface Face {
  id: string;
  has(cp: number): boolean;
  advance(text: string, size: number): number;
  lineFactor: number;
  pdfFont(): PDFFont;
  /** embed (async) if not yet embedded */
  ready(): Promise<void>;
  /** draws shaped text itself (complex scripts); faces without it go through page.drawText */
  draw?(page: PDFPage, text: string, x: number, y: number, size: number, color: Color): void;
}

interface Kit {
  hasGlyphForCodePoint(cp: number): boolean;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  lineGap: number;
  layout(t: string, features?: Record<string, boolean>): {
    advanceWidth: number;
    glyphs: { id: number }[];
    positions: { xAdvance: number; xOffset: number; yOffset: number }[];
  };
}

export interface Seg {
  face: Face;
  text: string;
}

export class FontSet {
  warnings: string[] = [];
  private doc: PDFDocument;
  private bytes = new Map<string, Uint8Array>();
  private unavailable = new Set<Family>();
  private faces = new Map<string, Face>();
  private missing = new Set<number>();
  private hasUni = false;
  private hasCur = false;
  /** shaped scripts whose font loaded */
  private scripts = new Set<string>();
  private shapers = new Map<string, HbFont>();
  private hb: Awaited<ReturnType<typeof loadHarfBuzz>> = null;
  private fontkit?: { create(bytes: Uint8Array): unknown };

  constructor(doc: PDFDocument) {
    this.doc = doc;
  }

  private variant(key: FontKey): string {
    return `${key.bold ? 1 : 0}-${key.italic ? 1 : 0}`;
  }

  /** Load whatever the document's text needs. Failures degrade to standard fonts and "?". */
  async prepare(
    runs: Iterable<{ text: string; key: FontKey }>,
    loadFont: (file: string) => Promise<Uint8Array>,
  ): Promise<void> {
    const list = [...runs];
    const families = new Set(list.map((r) => r.key.family));
    for (const fam of ["carlito", "caladea"] as const) {
      if (!families.has(fam)) continue;
      const ok = await this.loadFamily(fam, loadFont);
      if (!ok) {
        this.unavailable.add(fam);
        this.warnings.push(
          `The bundled ${fam === "carlito" ? "Calibri" : "Cambria"} substitute could not be loaded, so a standard font was used and line breaks may differ from Word.`,
        );
      }
    }
    let needUni = false;
    for (const r of list) {
      const primary = this.primary(r.key);
      for (const ch of normalise(r.text)) {
        if (!primary.has(ch.codePointAt(0) as number)) {
          needUni = true;
          break;
        }
      }
      if (needUni) break;
    }
    if (needUni) {
      this.hasUni = await this.loadFamily("uni", loadFont);
      if (!this.hasUni) {
        this.warnings.push(
          "Could not load the Unicode font, so characters outside Western European text were replaced with '?'.",
        );
      }
      const uni = this.hasUni ? this.embedded("uni", "0-0") : undefined;
      const needCur = list.some((r) =>
        Array.from(normalise(r.text)).some((ch) => {
          const cp = ch.codePointAt(0) as number;
          return isCurrency(cp) && !this.primary(r.key).has(cp) && !uni?.has(cp);
        }),
      );
      if (needCur) this.hasCur = await this.loadFamily("cur", loadFont);
      const needed = new Set<string>();
      for (const r of list) {
        for (const ch of r.text) {
          const sc = scriptOf(ch.codePointAt(0) as number);
          if (sc) needed.add(sc);
        }
      }
      if (needed.size) this.hb = await loadHarfBuzz(loadFont);
      for (const sc of needed) {
        if (await this.loadFamily(sc, loadFont)) this.scripts.add(sc);
        else this.warnings.push(`Could not load the ${SCRIPT_BY_NAME.get(sc)?.label} font, so that text was replaced with '?'.`);
      }
    }
  }

  private async loadFamily(name: Bundled, loadFont: (f: string) => Promise<Uint8Array>) {
    try {
      if (!this.fontkit) {
        // fontkit's Indic shaper is compiled to regenerator generators and expects this global
        const g = globalThis as { regeneratorRuntime?: unknown };
        g.regeneratorRuntime ??= (await import("regenerator-runtime")).default;
        this.fontkit = (await import("@pdf-lib/fontkit")).default as unknown as { create(b: Uint8Array): unknown };
      }
      const files = new Map<string, Promise<Uint8Array>>();
      for (const v of Object.keys(SUFFIX)) {
        const file = fileFor(name, v);
        if (!files.has(file)) files.set(file, loadFont(file));
        this.bytes.set(`${name}-${v}`, await (files.get(file) as Promise<Uint8Array>));
      }
      return true;
    } catch {
      for (const v of Object.keys(SUFFIX)) this.bytes.delete(`${name}-${v}`);
      return false;
    }
  }

  private embedded(name: string, v: string): Face {
    const id = `${name}-${v}`;
    let f = this.faces.get(id);
    if (f) return f;
    const bytes = this.bytes.get(id) as Uint8Array;
    const kit = (this.fontkit as { create(b: Uint8Array): unknown }).create(bytes) as unknown as Kit;
    let pdf: PDFFont | undefined;
    // italic and upright share one file: share one embedded copy too
    const twin = [...this.faces.values()].find((f) => f.id.startsWith(`${name}-`) && this.bytes.get(f.id) === bytes);
    const doc = this.doc;
    const fk = this.fontkit as { create(b: Uint8Array): unknown };
    const shaped = SCRIPT_BY_NAME.has(name);
    const features = shaped ? undefined : LATIN_FEATURES;
    const shape = shaped ? this.shaper(name, bytes, kit) : undefined;
    f = {
      id,
      has: (cp) => kit.hasGlyphForCodePoint(cp),
      advance: shape
        ? (t, size) => (shape(t).width / kit.unitsPerEm) * size
        : (t, size) => (kit.layout(t, features).advanceWidth / kit.unitsPerEm) * size,
      lineFactor: (kit.ascent - kit.descent + kit.lineGap) / kit.unitsPerEm,
      pdfFont: () => {
        if (!pdf) throw new Error("font not embedded yet");
        return pdf;
      },
      ready: async () => {
        if (pdf) return;
        if (twin) {
          await twin.ready();
          pdf = twin.pdfFont();
          return;
        }
        // fontkit's glyph subsetter garbles some faces (Caladea, Carlito Bold Italic), so embed the
        // already-small bundled files whole
        doc.registerFontkit(fk as never);
        pdf = await doc.embedFont(bytes, { subset: false, features });
      },
    };
    if (shape) {
      // pdf-lib draws glyphs at their plain advances, which leaves gaps and misplaced matras in
      // shaped text. Place each glyph where the shaper put it instead.
      // the font has no italic: slant the upright glyphs, as Office does for a font without one
      const slant = v.endsWith("1") ? 0.2 : 0;
      const bold = v.startsWith("1");
      f.draw = (page, text, x, y, size, color) => {
        const font = f?.pdfFont() as PDFFont;
        const run = shape(text);
        const k = size / kit.unitsPerEm;
        const key = page.node.newFontDictionary(font.name, font.ref);
        // ActualText keeps copy and paste right: ligature glyphs have no single character to map back to
        const actual = page.doc.context.obj({ ActualText: PDFHexString.fromText(text) });
        const ops = [
          // an inline property list; pdf-lib types operator operands without dictionaries
          PDFOperator.of("BDC" as never, [PDFName.of("Span"), actual as never]),
          pushGraphicsState(),
          setFillingColor(color),
          beginText(),
          setFontAndSize(key, size),
        ];
        if (bold) {
          ops.push(setStrokingColor(color), setLineWidth(size * FAUX_BOLD), setLineJoin(LineJoinStyle.Round));
          ops.push(setTextRenderingMode(TextRenderingMode.FillAndOutline));
        }
        let pen = 0;
        run.glyphs.forEach((g, i) => {
          const dx = run.xOffset[i];
          const dy = run.yOffset[i];
          ops.push(setTextMatrix(1, 0, slant, 1, x + (pen + dx) * k + slant * dy * k, y + dy * k));
          ops.push(showText(PDFHexString.of(g.toString(16).padStart(4, "0"))));
          pen += run.xAdvance[i];
        });
        ops.push(endText(), popGraphicsState(), PDFOperator.of("EMC" as never));
        page.pushOperators(...ops);
      };
    }
    this.faces.set(id, f);
    return f;
  }

  /**
   * Shaping for one script's font: HarfBuzz, else fontkit (which shapes most Indian scripts the same
   * but fails on some Gurmukhi, Telugu and Malayalam mark positioning; then the glyphs go unpositioned).
   */
  private shaper(name: string, bytes: Uint8Array, kit: Kit): (text: string) => Shaped {
    const fallback = (t: string): Shaped => {
      let run: ReturnType<Kit["layout"]>;
      try {
        run = kit.layout(t);
      } catch {
        run = kit.layout(t, { mark: false, mkmk: false });
      }
      return {
        glyphs: run.glyphs.map((g) => g.id),
        xAdvance: run.positions.map((p) => p.xAdvance),
        xOffset: run.positions.map((p) => p.xOffset),
        yOffset: run.positions.map((p) => p.yOffset),
        width: run.positions.reduce((w, p) => w + p.xAdvance, 0),
      };
    };
    if (!this.hb) return fallback;
    let font = this.shapers.get(name);
    if (!font) this.shapers.set(name, (font = hbFont(this.hb, bytes, fileFor(name as Bundled, "0-0"))));
    const hb = font;
    // should HarfBuzz fail on some text after all, fontkit still shapes it
    return (t) => {
      try {
        return hb.shape(t);
      } catch {
        return fallback(t);
      }
    };
  }

  private standard(family: "sans" | "serif" | "mono", v: string): Face {
    const id = `${family}-${v}`;
    let f = this.faces.get(id);
    if (f) return f;
    let pdf: PDFFont | undefined;
    const doc = this.doc;
    const get = () => (pdf ??= doc.embedStandardFont(STD[id]));
    f = {
      id,
      has: isWinAnsi,
      advance: (t, size) => get().widthOfTextAtSize(t, size),
      lineFactor: 1.22,
      pdfFont: get,
      ready: async () => {
        get();
      },
    };
    this.faces.set(id, f);
    return f;
  }

  private primary(key: FontKey): Face {
    const v = this.variant(key);
    let fam: Family = key.family;
    if (this.unavailable.has(fam)) fam = fam === "caladea" ? "serif" : "sans";
    if (fam === "carlito" || fam === "caladea") return this.embedded(fam, v);
    return this.standard(fam, v);
  }

  lineFactor(key: FontKey): number {
    return this.primary(key).lineFactor;
  }

  /** The faces and text to draw for one space-free word. */
  private resolve(word: string, key: FontKey): Seg[] {
    const primary = this.primary(key);
    const cps = Array.from(word, (c) => c.codePointAt(0) as number);
    if (cps.every((cp) => primary.has(cp))) return [{ face: primary, text: word }];
    // the whole word switches face so its letters match; only glyphs that face lacks go further.
    // A currency sign alone (₹ in a Carlito amount) doesn't: the digits keep the cell's font and width.
    const onlyCurrency = cps.every((cp) => primary.has(cp) || isCurrency(cp));
    const face = this.hasUni && !onlyCurrency ? this.embedded("uni", this.variant(key)) : primary;
    const uni = this.hasUni ? this.embedded("uni", this.variant(key)) : undefined;
    const cur = this.hasCur ? this.embedded("cur", this.variant(key)) : undefined;
    const v = this.variant(key);
    const scriptFace = (sc: string | undefined) => (sc && this.scripts.has(sc) ? this.embedded(sc, v) : undefined);
    const shapedFaces = new Set([...this.scripts].map((sc) => this.embedded(sc, v)));
    const segs: Seg[] = [];
    const push = (f: Face, t: string) => {
      const last = segs[segs.length - 1];
      if (last && last.face === f) last.text += t;
      else segs.push({ face: f, text: t });
    };
    for (const ch of word) {
      const cp = ch.codePointAt(0) as number;
      const last = segs[segs.length - 1]?.face;
      const inShaped = last && shapedFaces.has(last) ? last : undefined;
      if (cp === 0x200c || cp === 0x200d) {
        // joiners only matter inside shaped text
        if (inShaped) push(inShaped, ch);
        continue;
      }
      // a danda ends Bengali, Punjabi and Odia sentences too: keep it in that script's font
      if (isDanda(cp) && inShaped?.has(cp)) push(inShaped, ch);
      else if (scriptFace(scriptOf(cp))) push(scriptFace(scriptOf(cp)) as Face, ch);
      else if (face.has(cp)) push(face, ch);
      else if (cur?.has(cp)) push(cur, ch);
      else if (uni?.has(cp)) push(uni, ch);
      else {
        push(face, "?");
        this.missing.add(cp);
      }
    }
    return segs;
  }

  /** The face draws right-to-left text (Urdu, Arabic); numbers in it still run left to right. */
  isRtl(face: Face, text?: string): boolean {
    return face.id.startsWith("arab-") && !(text && ARABIC_NUMBER_ONLY.test(text));
  }

  /** Split text into runs of one face each, exactly as it will be measured and drawn. */
  segments(text: string, key: FontKey): Seg[] {
    const segs: Seg[] = [];
    for (const tok of normalise(text).split(/( +)/)) {
      if (!tok) continue;
      const isSpace = tok[0] === " ";
      const parts: Seg[] = isSpace ? [{ face: segs[segs.length - 1]?.face ?? this.primary(key), text: tok }] : this.resolve(tok, key);
      for (const seg of parts) {
        const prev = segs[segs.length - 1];
        if (prev && prev.face === seg.face) prev.text += seg.text;
        else segs.push(seg);
      }
    }
    // Arabic-Indic numbers run left to right inside Urdu: give them their own runs, shaped that way
    return segs.flatMap((s) =>
      this.isRtl(s.face) && ARABIC_DIGIT.test(s.text)
        ? s.text.split(ARABIC_NUMBER).filter(Boolean).map((text) => ({ face: s.face, text }))
        : [s],
    );
  }

  width(text: string, key: FontKey, size: number): number {
    let w = 0;
    for (const s of this.segments(text, key)) w += s.face.advance(s.text, size);
    return w;
  }

  /** Embed every face the given draws will use. */
  async ensure(runs: Iterable<{ text: string; key: FontKey }>): Promise<void> {
    const seen = new Set<Face>();
    for (const r of runs) for (const s of this.segments(r.text, r.key)) seen.add(s.face);
    for (const f of seen) await f.ready();
  }

  /** Warnings plus a summary of glyphs no bundled font had. */
  summary(): string[] {
    const w = [...this.warnings];
    if (this.missing.size) {
      w.push(
        `${this.missing.size} character${this.missing.size === 1 ? "" : "s"} (such as CJK or Arabic) have no glyph in the bundled fonts and were replaced with '?'.`,
      );
    }
    return w;
  }
}

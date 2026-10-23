/**
 * Fonts for the Word -> PDF engine.
 *  - Arial/Times/Courier-like text uses the PDF standard fonts (not embedded, tiny files).
 *  - Calibri and Cambria text uses bundled metric-compatible Carlito and Caladea (embedded) so line breaks match Word.
 *  - A word whose glyphs the chosen face lacks switches, for that word only, to an embedded
 *    Liberation Sans (Latin, Greek, Cyrillic). Currency signs it lacks (₹, ₽, ₺, ...) come from a
 *    small DejaVu Sans subset, and Hindi and other Devanagari text from Noto Sans Devanagari, which
 *    is shaped by fontkit (conjuncts, matras) and drawn glyph by glyph at the shaped positions.
 *    Glyphs nobody has (CJK, Arabic, ...) become "?" and are reported.
 */
import {
  PDFHexString,
  PDFName,
  PDFOperator,
  StandardFonts,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFillingColor,
  setFontAndSize,
  setTextMatrix,
  showText,
  type Color,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
} from "@cantoo/pdf-lib";

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

const FILES: Record<string, string> = {
  carlito: "Carlito",
  caladea: "Caladea",
  uni: "LiberationSans",
  cur: "DejaVuCurrency",
  deva: "NotoSansDevanagari",
};
type Bundled = "carlito" | "caladea" | "uni" | "cur" | "deva";
/** Noto Sans Devanagari ships upright weights only; italics use them */
const fileFor = (name: Bundled, v: string) =>
  `${FILES[name]}-${name === "deva" ? (v.startsWith("1") ? "Bold" : "Regular") : SUFFIX[v]}.ttf`;
/** Devanagari, Devanagari Extended and Vedic Extensions */
export const isDevanagari = (cp: number) =>
  (cp >= 0x0900 && cp <= 0x097f) || (cp >= 0xa8e0 && cp <= 0xa8ff) || (cp >= 0x1cd0 && cp <= 0x1cff);
/** the Currency Symbols block, which the DejaVuCurrency subset covers */
const isCurrency = (cp: number) => cp >= 0x20a0 && cp <= 0x20c0;
const SUFFIX: Record<string, string> = { "0-0": "Regular", "1-0": "Bold", "0-1": "Italic", "1-1": "BoldItalic" };

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
  layout(t: string): {
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
  private hasDeva = false;
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
      const needDeva = list.some((r) => Array.from(r.text).some((ch) => isDevanagari(ch.codePointAt(0) as number)));
      if (needDeva) {
        this.hasDeva = await this.loadFamily("deva", loadFont);
        if (!this.hasDeva) this.warnings.push("Could not load the Hindi font, so Devanagari text was replaced with '?'.");
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
    f = {
      id,
      has: (cp) => kit.hasGlyphForCodePoint(cp),
      advance: (t, size) => (kit.layout(t).advanceWidth / kit.unitsPerEm) * size,
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
        pdf = await doc.embedFont(bytes, { subset: false });
      },
    };
    if (name === "deva") {
      // pdf-lib draws glyphs at their plain advances, which leaves gaps and misplaced matras in
      // shaped Devanagari. Place each glyph where fontkit's shaping put it instead.
      f.draw = (page, text, x, y, size, color) => {
        const font = f?.pdfFont() as PDFFont;
        const run = kit.layout(text);
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
        let pen = 0;
        run.glyphs.forEach((g, i) => {
          const p = run.positions[i];
          ops.push(setTextMatrix(1, 0, 0, 1, x + (pen + p.xOffset) * k, y + p.yOffset * k));
          ops.push(showText(PDFHexString.of(g.id.toString(16).padStart(4, "0"))));
          pen += p.xAdvance;
        });
        ops.push(endText(), popGraphicsState(), PDFOperator.of("EMC" as never));
        page.pushOperators(...ops);
      };
    }
    this.faces.set(id, f);
    return f;
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
    // the whole word switches face so its letters match; only glyphs that face lacks go further
    const face = this.hasUni ? this.embedded("uni", this.variant(key)) : primary;
    const cur = this.hasCur ? this.embedded("cur", this.variant(key)) : undefined;
    const deva = this.hasDeva ? this.embedded("deva", this.variant(key)) : undefined;
    const segs: Seg[] = [];
    const push = (f: Face, t: string) => {
      const last = segs[segs.length - 1];
      if (last && last.face === f) last.text += t;
      else segs.push({ face: f, text: t });
    };
    for (const ch of word) {
      const cp = ch.codePointAt(0) as number;
      if (cp === 0x200c || cp === 0x200d) {
        if (deva && segs[segs.length - 1]?.face === deva) push(deva, ch);
        continue;
      }
      if (deva && isDevanagari(cp)) push(deva, ch);
      else if (face.has(cp)) push(face, ch);
      else if (cur?.has(cp)) push(cur, ch);
      else {
        push(face, "?");
        this.missing.add(cp);
      }
    }
    return segs;
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
    return segs;
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

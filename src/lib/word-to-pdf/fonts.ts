/**
 * Fonts for the Word -> PDF engine.
 *  - Arial/Times/Courier-like text uses the PDF standard fonts (not embedded, tiny files).
 *  - Calibri and Cambria text uses bundled metric-compatible Carlito and Caladea (embedded) so line breaks match Word.
 *  - A word whose glyphs the chosen face lacks switches, for that word only, to an embedded
 *    Liberation Sans (Latin, Greek, Cyrillic). Glyphs nobody has (CJK, Arabic, ...) become "?"
 *    and are reported.
 */
import { StandardFonts, type PDFDocument, type PDFFont } from "@cantoo/pdf-lib";

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
    .replace(/[​-‏­⁠﻿]/g, "")
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
};
const SUFFIX: Record<string, string> = { "0-0": "Regular", "1-0": "Bold", "0-1": "Italic", "1-1": "BoldItalic" };

interface Face {
  id: string;
  has(cp: number): boolean;
  advance(text: string, size: number): number;
  lineFactor: number;
  pdfFont(): PDFFont;
  /** embed (async) if not yet embedded */
  ready(): Promise<void>;
}

interface Kit {
  hasGlyphForCodePoint(cp: number): boolean;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  lineGap: number;
  layout(t: string): { advanceWidth: number };
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
    }
  }

  private async loadFamily(name: "carlito" | "caladea" | "uni", loadFont: (f: string) => Promise<Uint8Array>) {
    try {
      this.fontkit ??= (await import("@pdf-lib/fontkit")).default as unknown as { create(b: Uint8Array): unknown };
      for (const v of Object.keys(SUFFIX)) {
        const bytes = await loadFont(`${FILES[name]}-${SUFFIX[v]}.ttf`);
        this.bytes.set(`${name}-${v}`, bytes);
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
        // fontkit's glyph subsetter garbles some faces (Caladea, Carlito Bold Italic), so embed the
        // already-small bundled files whole
        doc.registerFontkit(fk as never);
        pdf = await doc.embedFont(bytes, { subset: false });
      },
    };
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

  /** The face and text to draw for one space-free word. */
  private resolve(word: string, key: FontKey): Seg {
    const primary = this.primary(key);
    const cps = Array.from(word, (c) => c.codePointAt(0) as number);
    if (cps.every((cp) => primary.has(cp))) return { face: primary, text: word };
    const face = this.hasUni ? this.embedded("uni", this.variant(key)) : primary;
    let out = "";
    for (const ch of word) {
      const cp = ch.codePointAt(0) as number;
      if (face.has(cp)) out += ch;
      else {
        out += "?";
        this.missing.add(cp);
      }
    }
    return { face, text: out };
  }

  /** Split text into runs of one face each, exactly as it will be measured and drawn. */
  segments(text: string, key: FontKey): Seg[] {
    const segs: Seg[] = [];
    for (const tok of normalise(text).split(/( +)/)) {
      if (!tok) continue;
      const isSpace = tok[0] === " ";
      const prev = segs[segs.length - 1];
      const seg: Seg = isSpace ? { face: prev?.face ?? this.primary(key), text: tok } : this.resolve(tok, key);
      if (prev && prev.face === seg.face) prev.text += seg.text;
      else segs.push(seg);
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

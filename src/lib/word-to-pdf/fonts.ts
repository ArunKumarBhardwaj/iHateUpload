/**
 * Fonts for the Word -> PDF engine. Latin documents use the PDF standard fonts (no embedding,
 * tiny files). If any text needs glyphs outside WinAnsi, the whole document switches to an
 * embedded Liberation Sans (metric-compatible with Arial/Helvetica, covers Latin, Greek and
 * Cyrillic); glyphs it lacks (CJK, Arabic, ...) are replaced with "?" and reported.
 */
import { StandardFonts, type PDFDocument, type PDFFont } from "@cantoo/pdf-lib";

import type { FontKey } from "./layout";

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

export function needsUnicode(text: string): boolean {
  for (const ch of normalise(text)) {
    if (!isWinAnsi(ch.codePointAt(0) as number)) return true;
  }
  return false;
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

const UNI_FILES: Record<string, string> = {
  "0-0": "LiberationSans-Regular.ttf",
  "1-0": "LiberationSans-Bold.ttf",
  "0-1": "LiberationSans-Italic.ttf",
  "1-1": "LiberationSans-BoldItalic.ttf",
};

interface UniFace {
  bytes: Uint8Array;
  font?: PDFFont;
  has: (cp: number) => boolean;
  advance: (text: string) => number;
}

/**
 * @cantoo/pdf-lib prefers a sync subset.encode(), which @pdf-lib/fontkit only half implements.
 * Hide it so pdf-lib falls back to encodeStream(), which works.
 */
function compatFontkit(fk: { create: (...a: never[]) => unknown }) {
  return {
    create(...args: unknown[]) {
      const font = (fk.create as (...a: unknown[]) => Record<string, unknown>)(...args);
      const orig = (font.createSubset as () => Record<string, unknown>).bind(font);
      font.createSubset = () => {
        const sub = orig();
        const encode = sub.encode;
        const stream = sub.encodeStream as () => unknown;
        let streaming = false;
        Object.defineProperty(sub, "encode", { configurable: true, get: () => (streaming ? encode : undefined) });
        sub.encodeStream = () => {
          streaming = true;
          return stream.call(sub);
        };
        return sub;
      };
      return font;
    },
  };
}

export class FontSet {
  warnings: string[] = [];
  private std = new Map<string, PDFFont>();
  private uni = new Map<string, UniFace>();
  private missing = new Set<number>();
  unicode = false;
  private embedUni?: (k: string) => Promise<PDFFont>;
  private embedded = new Map<string, PDFFont>();

  constructor(private doc: PDFDocument) {}

  /** Load the embedded font if any text needs it. Failure degrades to "?" replacement. */
  async prepare(
    needsUni: boolean,
    loadFont: (file: string) => Promise<Uint8Array>,
  ): Promise<void> {
    if (!needsUni) return;
    try {
      const fontkit = (await import("@pdf-lib/fontkit")).default;
      this.doc.registerFontkit(compatFontkit(fontkit) as never);
      for (const [k, file] of Object.entries(UNI_FILES)) {
        const bytes = await loadFont(file);
        const kit = fontkit.create(bytes) as unknown as {
          hasGlyphForCodePoint(cp: number): boolean;
          unitsPerEm: number;
          layout(t: string): { advanceWidth: number };
        };
        this.uni.set(k, {
          bytes,
          has: (cp) => kit.hasGlyphForCodePoint(cp),
          advance: (t) => kit.layout(t).advanceWidth / kit.unitsPerEm,
        });
      }
      // embed only the faces the layout asks for
      this.embedUni = (k) => this.doc.embedFont((this.uni.get(k) as UniFace).bytes, { subset: true });
      this.unicode = true;
    } catch {
      this.uni.clear();
      this.unicode = false;
      this.warnings.push(
        "Could not load the Unicode font, so characters outside Western European text were replaced with '?'.",
      );
    }
  }

  private variant(key: FontKey): string {
    return `${key.bold ? 1 : 0}-${key.italic ? 1 : 0}`;
  }

  private stdFont(key: FontKey): PDFFont {
    const id = `${key.family}-${this.variant(key)}`;
    let f = this.std.get(id);
    if (!f) {
      f = this.doc.embedStandardFont(STD[id]);
      this.std.set(id, f);
    }
    return f;
  }

  font(key: FontKey): PDFFont {
    if (this.unicode) {
      const f = this.embedded.get(this.variant(key));
      if (!f) throw new Error("Unicode face not embedded yet; call ensure() first");
      return f;
    }
    return this.stdFont(key);
  }

  /** Embed the Unicode faces a draw pass will need (async); no-op for standard fonts. */
  async ensure(keys: FontKey[]): Promise<void> {
    if (!this.unicode || !this.embedUni) return;
    for (const key of keys) {
      const v = this.variant(key);
      if (!this.embedded.has(v)) this.embedded.set(v, await this.embedUni(v));
    }
  }

  /** Text exactly as it will be drawn: normalised, unsupported glyphs replaced with "?". */
  encodable(text: string): string {
    const t = normalise(text);
    let out = "";
    const face = this.unicode ? this.uni.get("0-0") : undefined;
    for (const ch of t) {
      const cp = ch.codePointAt(0) as number;
      const ok = face ? face.has(cp) : isWinAnsi(cp);
      if (ok) out += ch;
      else {
        out += "?";
        if (this.unicode && !this.missing.has(cp)) {
          this.missing.add(cp);
        }
      }
    }
    return out;
  }

  /** Warnings plus a summary of glyphs the font lacked. */
  summary(): string[] {
    const w = [...this.warnings];
    if (this.missing.size) {
      w.push(
        `${this.missing.size} character${this.missing.size === 1 ? "" : "s"} (such as CJK or Arabic) have no glyph in the bundled font and were replaced with '?'.`,
      );
    }
    return w;
  }

  width(text: string, key: FontKey, size: number): number {
    const t = this.encodable(text);
    if (this.unicode) return (this.uni.get(this.variant(key)) as UniFace).advance(t) * size;
    return this.stdFont(key).widthOfTextAtSize(t, size);
  }
}

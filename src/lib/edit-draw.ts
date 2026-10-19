import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFPage,
} from "@cantoo/pdf-lib";

import { keepHelveticaWinAnsi } from "@/lib/ocr-words";
import { boxToPlacement, boxToUserRect, pageFrame } from "@/lib/page-geometry";
import { stripTextInRects } from "@/lib/pdf-text-strip";
import type { EditMark } from "@/lib/tool-options";

type TextMark = Extract<EditMark, { kind: "text" }>;

export function hexRgb(hex: string) {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((bit) => bit + bit)
          .join("")
      : raw;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return rgb(0.08, 0.09, 0.11);
  return rgb(
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  );
}

export function dataUrlBytes(raw: string) {
  const comma = raw.indexOf(",");
  const binary = atob(comma >= 0 ? raw.slice(comma + 1) : raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function standardFontFor(mark: TextMark): StandardFonts {
  const bold = Boolean(mark.bold);
  const italic = Boolean(mark.italic);
  switch (mark.family) {
    case "times":
      return bold
        ? italic ? StandardFonts.TimesRomanBoldItalic : StandardFonts.TimesRomanBold
        : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman;
    case "courier":
      return bold
        ? italic ? StandardFonts.CourierBoldOblique : StandardFonts.CourierBold
        : italic ? StandardFonts.CourierOblique : StandardFonts.Courier;
    default:
      return bold
        ? italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold
        : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
  }
}

/** Greedy word wrap to a width in points. Hard newlines are kept. */
export function wrapLines(text: string, width: number, measure: (s: string) => number) {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const tryLine = line + word;
      if (line && measure(tryLine.trimEnd()) > width) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else line = tryLine;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export type FontCache = Map<StandardFonts, PDFFont>;

async function fontFrom(doc: PDFDocument, cache: FontCache, name: StandardFonts) {
  let font = cache.get(name);
  if (!font) {
    font = await doc.embedFont(name);
    cache.set(name, font);
  }
  return font;
}

/**
 * Deletes the original glyphs under every replaced line. Runs before anything
 * is drawn so new text is never mistaken for old. Returns glyphs removed per mark.
 */
export async function stripCoveredText(
  doc: PDFDocument,
  marks: EditMark[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const byPage = new Map<number, TextMark[]>();
  for (const mark of marks) {
    if (mark.kind !== "text" || !mark.cover) continue;
    const list = byPage.get(mark.pageIndex) ?? [];
    list.push(mark);
    byPage.set(mark.pageIndex, list);
  }
  for (const [index, list] of byPage) {
    const page = doc.getPages()[index];
    if (!page) continue;
    const frame = pageFrame(page);
    // One mark at a time so each knows whether it found glyphs of its own.
    for (const mark of list) {
      counts.set(mark.id, await stripTextInRects(doc, page, [boxToUserRect(frame, mark)]));
    }
  }
  return counts;
}

/**
 * Draws one edit mark. Replacing a line (`cover`) first deletes the original
 * glyphs from the page's content, so extracting text gives only the new words.
 * A white patch is the fallback for scans and pictures of text, which have no glyphs.
 */
export async function drawEditMark(
  doc: PDFDocument,
  page: PDFPage,
  fonts: FontCache,
  mark: EditMark,
  /** Glyphs `stripCoveredText` removed under this mark. */
  removed = 0,
): Promise<void> {
  const frame = pageFrame(page);
  const at = boxToPlacement(frame, mark);
  const turn = degrees(at.rotate);
  switch (mark.kind) {
    case "highlight":
      page.drawRectangle({
        x: at.x,
        y: at.y,
        width: at.width,
        height: at.height,
        rotate: turn,
        color: hexRgb(mark.color),
        opacity: 0.38,
        borderWidth: 0,
      });
      return;
    case "rect":
      page.drawRectangle({
        x: at.x,
        y: at.y,
        width: at.width,
        height: at.height,
        rotate: turn,
        ...(mark.fill
          ? { color: hexRgb(mark.color), opacity: 0.22, borderColor: hexRgb(mark.color), borderWidth: 1.2 }
          : { borderColor: hexRgb(mark.color), borderWidth: 1.5 }),
      });
      return;
    case "image": {
      const bytes = dataUrlBytes(mark.dataUrl);
      const image = mark.dataUrl.includes("image/png")
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes);
      page.drawImage(image, {
        x: at.x,
        y: at.y,
        width: at.width,
        height: at.height,
        rotate: turn,
      });
      return;
    }
    case "text": {
      if (mark.cover) {
        if (removed === 0) {
          const pad = 0.6;
          const a = (at.rotate * Math.PI) / 180;
          page.drawRectangle({
            x: at.x - pad * (Math.cos(a) - Math.sin(a)),
            y: at.y - pad * (Math.sin(a) + Math.cos(a)),
            width: at.width + pad * 2,
            height: at.height + pad * 2,
            rotate: turn,
            color: hexRgb("#ffffff"),
            borderWidth: 0,
          });
        }
      }
      const text = keepHelveticaWinAnsi(mark.text).trim();
      if (!text) return;
      const font = await fontFrom(doc, fonts, standardFontFor(mark));
      const pageH = at.rotate === 90 || at.rotate === 270 ? frame.width : frame.height;
      const size = Math.max(4, Math.min(mark.fontSize * pageH, 200));
      const viewW = at.rotate === 90 || at.rotate === 270 ? frame.height : frame.width;
      // A replaced line grows toward the page edge instead of wrapping under itself.
      const room = mark.cover ? Math.max(at.width, viewW * (1 - mark.x) - 4) : at.width;
      const lines = wrapLines(text, Math.max(8, room), (s) => font.widthOfTextAtSize(s, size));
      const lead = size * 1.15;
      const a = (at.rotate * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      lines.forEach((line, i) => {
        const w = font.widthOfTextAtSize(line, size);
        const lx =
          mark.align === "center"
            ? Math.max(0, (at.width - w) / 2)
            : mark.align === "right"
              ? Math.max(0, at.width - w)
              : 0.4 + (mark.cover ? 0.004 * viewW : 0);
        const ly =
          lines.length === 1
            ? Math.max(0, (at.height - size) / 2)
            : at.height - size * 0.85 - i * lead;
        page.drawText(line, {
          x: at.x + lx * cos - ly * sin,
          y: at.y + lx * sin + ly * cos,
          size,
          font,
          color: hexRgb(mark.color),
          rotate: turn,
        });
      });
    }
  }
}

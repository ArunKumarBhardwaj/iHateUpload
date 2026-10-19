import {
  BlendMode,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFPage,
  rgb,
} from "@cantoo/pdf-lib";

import { stripTextInRects } from "../pdf-text-strip";
import {
  DARK_CEIL,
  DARK_FLOOR,
  SEPIA_INK,
  SEPIA_PAPER,
} from "./colour";
import type { InvertMode } from "./types";

/**
 * pdf-lib only accepts the separable blend modes. Hue and Color are drawn with
 * these stand-ins, which this module never uses otherwise, and renamed in the
 * graphics states afterwards.
 */
const HUE = BlendMode.Exclusion;
const COLOR = BlendMode.Overlay;
const REAL: Record<string, string> = { Exclusion: "Hue", Overlay: "Color" };

function renameBlendModes(doc: PDFDocument) {
  for (const page of doc.getPages()) {
    const res = page.node.Resources();
    const states = res?.lookupMaybe(PDFName.of("ExtGState"), PDFDict);
    if (!states) continue;
    for (const [, value] of states.entries()) {
      const gs = doc.context.lookup(value);
      if (!(gs instanceof PDFDict)) continue;
      const bm = gs.get(PDFName.of("BM"));
      const name = bm?.toString().replace("/", "");
      if (name && REAL[name]) gs.set(PDFName.of("BM"), PDFName.of(REAL[name]));
    }
  }
}

const c = (t: readonly [number, number, number]) => rgb(t[0] / 255, t[1] / 255, t[2] / 255);

/**
 * Paints the paper first. A page group starts transparent in strict readers,
 * and a blend mode over nothing just returns the overlay colour.
 */
function paintPaper(doc: PDFDocument, page: PDFPage) {
  const box = page.getMediaBox();
  const ctx = doc.context;
  const paper = ctx.register(
    ctx.stream(`q 1 1 1 rg ${box.x} ${box.y} ${box.width} ${box.height} re f Q\n`),
  );
  const raw = page.node.get(PDFName.of("Contents"));
  const list: unknown[] = [paper];
  if (raw instanceof PDFArray) {
    for (let i = 0; i < raw.size(); i++) list.push(raw.get(i));
  } else if (raw) list.push(raw);
  page.node.set(PDFName.of("Contents"), ctx.obj(list as never));
}

function overlay(
  page: PDFPage,
  mode: BlendMode,
  color: ReturnType<typeof rgb>,
) {
  const box = page.getMediaBox();
  page.drawRectangle({
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    color,
    borderWidth: 0,
    blendMode: mode,
  });
}

/**
 * Recolours the document without touching its content: a full-page rectangle
 * drawn with a blend mode after the page. Text, vectors and fonts stay as they
 * were, so text stays selectable and the file barely grows.
 *
 * invert: Difference with white, which is exactly 255 - colour.
 * grayscale: Color blend with grey takes the luminosity and drops hue and saturation.
 * sepia: Color blend with a brown, then Multiply by a paper tone.
 * dark: invert, a floor and ceiling so it is not pure black on pure white, then
 * the original drawn again with the Hue blend (text removed from that copy) so
 * pictures and fills get their own hue back.
 */
export async function recolourPages(
  doc: PDFDocument,
  mode: InvertMode,
  hueSource?: PDFDocument,
) {
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    paintPaper(doc, page);
    switch (mode) {
      case "invert":
        overlay(page, BlendMode.Difference, rgb(1, 1, 1));
        break;
      case "grayscale":
        overlay(page, COLOR, rgb(0.5, 0.5, 0.5));
        break;
      case "sepia":
        overlay(page, COLOR, c(SEPIA_INK));
        overlay(page, BlendMode.Multiply, c(SEPIA_PAPER));
        break;
      case "dark": {
        overlay(page, BlendMode.Difference, rgb(1, 1, 1));
        overlay(page, BlendMode.Lighten, c(DARK_FLOOR));
        overlay(page, BlendMode.Darken, c(DARK_CEIL));
        if (hueSource) {
          const embedded = await doc.embedPage(hueSource.getPage(i));
          const box = page.getMediaBox();
          page.drawPage(embedded, { x: box.x, y: box.y, blendMode: HUE });
        }
        break;
      }
    }
  }
  renameBlendModes(doc);
}

/** A copy of the document with every glyph removed, used as the Hue pass in dark mode. */
export async function withoutText(bytes: ArrayBuffer | Uint8Array): Promise<PDFDocument> {
  const copy = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const big = 1e6;
  for (const page of copy.getPages()) {
    await stripTextInRects(copy, page, [{ x0: -big, y0: -big, x1: big, y1: big }]);
  }
  return copy;
}

/**
 * Translate PDF: the shared document engine finds each paragraph and table
 * cell and where it sits; the texts are translated in batches; then, on the
 * original PDF, the old glyphs in each box are deleted and the translation is
 * drawn into the same box, shrunk to fit. Pictures, lines and colours stay.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, degrees, rgb, type PDFFont } from "@cantoo/pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { markerText } from "@/lib/pdf-to-html/html-writer";
import { splitAtTabs } from "@/lib/pdf-to-pptx/pptx-writer";
import { buildDocument, type ConvertDeps } from "@/lib/pdf-to-word";
import type { ParagraphBlock, TableBlock } from "@/lib/pdf-to-word/model";
import { boxToPlacement, boxToUserRect, pageFrame } from "@/lib/page-geometry";
import { stripTextInRects } from "@/lib/pdf-text-strip";
import { zeroUnusedGlyphs } from "@/lib/pdfa/fonts";
import { readSfnt, unicodeMap } from "@/lib/pdf-to-word/sfnt";
import type { RatioBox } from "@/lib/tool-options";

import { batchTexts } from "./gemini-translate";
import { fitText, LINE_HEIGHT } from "./layout";
import { fontFiles, type Script } from "./languages";

export type Unit = {
  /** 0-based page. */
  page: number;
  /** Ratio box, origin top-left, as the page is shown. */
  box: RatioBox;
  text: string;
  size: number;
  bold: boolean;
  /** Hex, no hash. */
  color?: string;
  align?: "center" | "right";
  /** A table cell: text sits in the middle of the cell and may not spill out of it. */
  cell?: boolean;
  /** The original was set in a serif face. */
  serif?: boolean;
  /** Free space around the box the translation may use before it shrinks. Set by collectUnits. */
  room?: RatioBox;
};

const HAS_LETTERS = /\p{L}/u;

function plainText(p: ParagraphBlock) {
  return p.runs.map((r) => (r.tab ? " " : r.field ? "" : r.text)).join("").replace(/\s+/g, " ").trim();
}

function styleOf(paragraphs: ParagraphBlock[]) {
  const runs = paragraphs.flatMap((p) => p.runs).filter((r) => r.text.trim());
  const size = Math.max(4, ...runs.map((r) => r.size ?? 11));
  const boldChars = runs.filter((r) => r.bold).reduce((n, r) => n + r.text.length, 0);
  const allChars = runs.reduce((n, r) => n + r.text.length, 0);
  const serif = runs.some((r) => /times|serif|georgia|garamond|cambria|palatino|minion|book/i.test(r.font ?? "") && !/sans/i.test(r.font ?? ""));
  return { size, bold: boldChars * 2 > allChars, color: runs[0]?.color, serif };
}

/** Every paragraph and table cell with words in it, from the exact-layout model. */
export async function collectUnits(
  pdf: PDFDocumentProxy,
  deps: ConvertDeps,
  onProgress: (ratio: number) => void,
  pages?: number[],
): Promise<{ units: Unit[]; notes: string[] }> {
  const wanted = pages ?? Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  const built = await buildDocument(pdf, { mode: "exact", embedFonts: false }, { ...deps, rasterizeImage: async () => ({ mime: "image/png", data: new Uint8Array() }) }, onProgress, wanted);
  const units: Unit[] = [];
  (built.model.pages ?? []).forEach((page, i) => {
    // List numbers live in the model's list data, not the runs, but their glyphs sit in the box.
    const counts = new Map<string, number>();
    const pageIndex = wanted[i] - 1;
    const ratio = (b: { x: number; y: number; w: number; h: number }): RatioBox => ({
      x: b.x / page.width,
      y: b.y / page.height,
      w: b.w / page.width,
      h: b.h / page.height,
    });
    // A one-line paragraph with tabs is laid out as separate pieces, each at its own tab stop.
    const items = page.items.flatMap((item) => {
      if (item.kind !== "text") return [item];
      const block = item.block as ParagraphBlock;
      const tallest = Math.max(1, ...block.runs.map((r) => r.size ?? 12));
      return item.box.h < tallest * 1.6 && !block.list && block.runs.some((r) => r.tab) ? splitAtTabs(item, block) : [item];
    });
    for (const item of items) {
      if (item.kind === "text") {
        const block = item.block as ParagraphBlock;
        const marker = block.list ? markerText(block, counts) : "";
        const text = (marker ? `${marker} ` : "") + plainText(block);
        if (!HAS_LETTERS.test(text)) continue;
        units.push({ page: pageIndex, box: ratio(item.box), text, align: block.align, ...styleOf([block]) });
      } else if (item.kind === "table") {
        const table = item.block as TableBlock;
        const widthSum = table.colWidths.reduce((a, b) => a + b, 0) || 1;
        const xs = [0];
        for (const w of table.colWidths) xs.push(xs[xs.length - 1] + (w / widthSum) * item.box.w);
        const heights = table.rowHeights && table.rowHeights.length === table.rows.length ? table.rowHeights : table.rows.map(() => 1);
        const heightSum = heights.reduce((a, b) => a + b, 0) || 1;
        let y = item.box.y;
        table.rows.forEach((row, r) => {
          const h = (heights[r] / heightSum) * item.box.h;
          let col = 0;
          for (const cell of row) {
            const span = cell.colSpan || 1;
            const x0 = item.box.x + xs[Math.min(col, xs.length - 1)];
            const x1 = item.box.x + xs[Math.min(col + span, xs.length - 1)];
            col += span;
            if (cell.vMerge === "continue") continue;
            const text = cell.paragraphs.map(plainText).filter(Boolean).join("\n");
            if (!HAS_LETTERS.test(text)) continue;
            const pad = 1.5;
            units.push({ page: pageIndex, box: ratio({ x: x0 + pad, y: y + pad, w: Math.max(1, x1 - x0 - 2 * pad), h: Math.max(1, h - 2 * pad) }), text, align: cell.paragraphs[0]?.align, cell: true, ...styleOf(cell.paragraphs) });
          }
          y += h;
        });
      }
    }
  });
  await measureSizes(pdf, units, wanted);
  addRoom(units);
  return { units, notes: built.notes };
}

/** The real font size in each box: the median size of the PDF's own text items inside it. */
async function measureSizes(pdf: PDFDocumentProxy, units: Unit[], wanted: number[]) {
  for (const pageNo of wanted) {
    const mine = units.filter((u) => u.page === pageNo - 1);
    if (!mine.length) continue;
    const page = await pdf.getPage(pageNo);
    const view = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: { x: number; y: number; size: number }[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const [a, b, c, d, e, f] = item.transform as number[];
      const size = Math.hypot(c, d) || Math.hypot(a, b);
      const [x, y] = view.convertToViewportPoint(e + (item.width || 0) / 2, f + size * 0.3);
      items.push({ x: x / view.width, y: y / view.height, size });
    }
    page.cleanup();
    for (const u of mine) {
      const inside = items.filter((i) => i.x >= u.box.x - 0.002 && i.x <= u.box.x + u.box.w + 0.002 && i.y >= u.box.y - 0.004 && i.y <= u.box.y + u.box.h + 0.004).map((i) => i.size).sort((p, q) => p - q);
      if (inside.length) u.size = inside[Math.floor(inside.length / 2)];
    }
  }
}

/**
 * How far each paragraph may grow: right (or left, when right-aligned) up to
 * the next text beside it or the page's text margin, and down to the next text
 * below it. Table cells stay in their cells.
 */
export function addRoom(units: Unit[]) {
  const gap = 0.006;
  for (const u of units) {
    const page = units.filter((v) => v !== u && v.page === u.page);
    if (u.cell) {
      u.room = u.box;
      continue;
    }
    const left = Math.min(u.box.x, ...page.map((v) => v.box.x));
    const marginRight = Math.max(u.box.x + u.box.w, 1 - left);
    const sideBySide = page.filter((v) => v.box.y < u.box.y + u.box.h && v.box.y + v.box.h > u.box.y);
    let x0 = u.box.x;
    let x1 = u.box.x + u.box.w;
    if (u.align === "right") {
      // Neighbours may grow toward each other, so each gets half the gap between them.
      x0 = Math.min(x0, Math.max(left, ...sideBySide.filter((v) => v.box.x + v.box.w <= u.box.x + gap).map((v) => (v.box.x + v.box.w + u.box.x) / 2 + gap)));
    } else if (!u.align) {
      x1 = Math.max(x1, Math.min(marginRight, ...sideBySide.filter((v) => v.box.x >= u.box.x + u.box.w - gap).map((v) => (u.box.x + u.box.w + v.box.x) / 2 - gap)));
    }
    const below = page.filter((v) => v.box.y >= u.box.y + u.box.h - gap && v.box.x < x1 && v.box.x + v.box.w > x0);
    const y1 = Math.max(u.box.y + u.box.h, Math.min(0.96, ...below.map((v) => v.box.y - gap)));
    u.room = { x: x0, y: u.box.y, w: x1 - x0, h: y1 - u.box.y };
  }
}

export type TranslatePdfOptions = {
  deps: ConvertDeps;
  loadFont: (file: string) => Promise<Uint8Array>;
  script: Script;
  /** Translates one batch, keeping order and length. */
  translate: (texts: string[]) => Promise<string[]>;
  onProgress: (ratio: number) => void;
  open: (bytes: Uint8Array) => Promise<PDFDocumentProxy>;
  pages?: number[];
};

export type TranslateResult = { bytes: Uint8Array; units: number; notes: string[] };

const hex = (c?: string) => {
  if (!c || !/^[0-9a-fA-F]{6}$/.test(c)) return rgb(0, 0, 0);
  const n = parseInt(c, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

export async function translatePdf(source: Uint8Array, options: TranslatePdfOptions): Promise<TranslateResult> {
  const pdf = await options.open(source);
  let units: Unit[];
  let notes: string[];
  try {
    ({ units, notes } = await collectUnits(pdf, options.deps, (r) => options.onProgress(r * 0.25), options.pages));
  } finally {
    await pdf.loadingTask.destroy();
  }
  if (units.length === 0) throw new Error("No text was found to translate.");

  const translations: string[] = new Array(units.length);
  const batches = batchTexts(units.map((u) => u.text));
  for (let b = 0; b < batches.length; b++) {
    const ids = batches[b];
    const out = await options.translate(ids.map((i) => units[i].text));
    ids.forEach((id, k) => (translations[id] = out[k]));
    options.onProgress(0.25 + (0.65 * (b + 1)) / batches.length);
  }

  const doc = await PDFDocument.load(source, { updateMetadata: false });
  doc.registerFontkit(fontkit);
  // fontkit's own subsetter garbles some faces, so fonts go in whole; Liberation and Caladea are
  // first cut to the characters used. Devanagari keeps every glyph for its conjuncts.
  const used = new Set([...translations.join(""), ...units.map((u) => u.text).join("")].map((c) => c.codePointAt(0)!));
  const prepare = async (file: string) => {
    const bytes = await options.loadFont(file);
    if (options.script === "devanagari") return bytes;
    const map = unicodeMap(readSfnt(bytes)?.tables.get("cmap"));
    const keep = new Set<number>();
    for (const c of used) {
      const g = map.get(c);
      if (g !== undefined) keep.add(g);
    }
    // fontkit reads the name table when it embeds.
    return zeroUnusedGlyphs(bytes, keep, new Map([...map].filter(([, g]) => keep.has(g))), ["name"]);
  };
  const faces = new Map<string, PDFFont>();
  const face = async (serif: boolean, heavy: boolean) => {
    const files = fontFiles(options.script, serif);
    const file = heavy ? files.bold : files.regular;
    let font = faces.get(file);
    if (!font) {
      font = await doc.embedFont(await prepare(file), { subset: false });
      faces.set(file, font);
    }
    return font;
  };

  const byPage = new Map<number, number[]>();
  units.forEach((u, i) => byPage.set(u.page, [...(byPage.get(u.page) ?? []), i]));
  for (const [index, ids] of byPage) {
    const page = doc.getPage(index);
    const frame = pageFrame(page);
    const removed = await stripTextInRects(doc, page, ids.map((i) => boxToUserRect(frame, units[i].box)));
    // A scan has no glyphs to delete: the words are pixels, so they get a white patch.
    const patch = removed === 0;
    for (const i of ids) drawUnit(page, frame, units[i], translations[i] || units[i].text, await face(!!units[i].serif, units[i].bold), patch);
  }
  options.onProgress(0.97);
  doc.setProducer("iHateUpload");
  const bytes = await doc.save({ useObjectStreams: true });
  options.onProgress(1);
  return { bytes, units: units.length, notes };
}

function drawUnit(
  page: ReturnType<PDFDocument["getPage"]>,
  frame: ReturnType<typeof pageFrame>,
  unit: Unit,
  text: string,
  font: PDFFont,
  patch: boolean,
) {
  const p = boxToPlacement(frame, unit.box);
  const room = boxToPlacement(frame, unit.room ?? unit.box);
  const measure = (s: string, size: number) => font.widthOfTextAtSize(s, size);
  // Fill the box first; use the free space around it before shrinking.
  const inBox = fitText(text, p.width, Math.max(p.height, unit.size * LINE_HEIGHT), unit.size, measure);
  const { size, lines } = inBox.size >= unit.size * 0.92 ? inBox : fitText(text, room.width, Math.max(room.height, unit.size * LINE_HEIGHT), unit.size, measure);
  const a = (p.rotate * Math.PI) / 180;
  const cos = Math.round(Math.cos(a));
  const sin = Math.round(Math.sin(a));
  // Local (u, v) in the box, from its bottom-left as seen, to page space.
  const at = (u: number, v: number) => ({ x: p.x + u * cos - v * sin, y: p.y + u * sin + v * cos });
  if (patch) {
    const o = at(0, 0);
    page.drawRectangle({ x: o.x, y: o.y, width: p.width, height: p.height, color: rgb(1, 1, 1), rotate: degrees(p.rotate) });
  }
  const block = (lines.length * LINE_HEIGHT - (LINE_HEIGHT - 1)) * size;
  // Cells centre their text; paragraphs hang from the top of their box.
  const top = unit.cell ? (p.height + block) / 2 : p.height;
  lines.forEach((line, i) => {
    const w = measure(line, size);
    const u = unit.align === "center" ? (p.width - w) / 2 : unit.align === "right" ? p.width - w : 0;
    const v = top - size * 0.8 - i * size * LINE_HEIGHT;
    // Right and centred text may reach into the room on the left.
    const o = at(u, v);
    page.drawText(line, { x: o.x, y: o.y, size, font, color: hex(unit.color), rotate: degrees(p.rotate) });
  });
}

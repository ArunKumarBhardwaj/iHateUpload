/**
 * Shared PDF output for every "document to PDF" converter. A converter maps its format into
 * blocks (word-to-pdf/model) or straight into positioned drawing commands, and this file embeds
 * fonts and images and draws the commands as real, selectable PDF text.
 */
import { PDFDocument, PDFString, rgb, type PDFImage } from "@cantoo/pdf-lib";

import { FontSet } from "../word-to-pdf/fonts";
import type { Cmd, FontKey, Measurer } from "../word-to-pdf/layout";
import type { Block, Inline } from "../word-to-pdf/model";

export interface EngineOptions {
  /** Returns the bytes of a bundled font file, e.g. "LiberationSans-Regular.ttf". */
  loadFont?: (file: string) => Promise<Uint8Array>;
  /** Converts an image PDF cannot embed (gif, bmp, ...) to PNG bytes. */
  rasterise?: (data: Uint8Array, mime: string) => Promise<Uint8Array | null>;
}

/** One finished page: size in points and top-down drawing commands. */
export interface OutPage {
  width: number;
  height: number;
  cmds: Cmd[];
  /** hex RRGGBB page background */
  bg?: string;
}

export type PageBuilder = (measure: Measurer, lineFactor: (key: FontKey) => number) => OutPage[];

export function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

export function* walkInlines(blocks: Block[]): Generator<{ inl: Inline; list: Inline[]; bold: boolean }> {
  for (const b of blocks) {
    if (b.kind === "para") {
      for (const inl of [...b.inlines]) yield { inl, list: b.inlines, bold: b.heading > 0 };
    } else if (b.kind === "table") {
      for (const row of b.rows) for (const cell of row.cells) yield* walkInlines(cell.blocks);
    }
  }
}

export function defaultLoadFont(file: string): Promise<Uint8Array> {
  return fetch(`/fonts/${file}`).then(async (r) => {
    if (!r.ok) throw new Error(`font ${file}: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  });
}

/** Browser-only: decode gif/bmp/webp/... to PNG through a canvas. */
export async function browserRasterise(data: Uint8Array, mime: string): Promise<Uint8Array | null> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") return null;
  try {
    const bmp = await createImageBitmap(new Blob([toArrayBuffer(data)], { type: mime }));
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

export function hex(c: string | undefined) {
  if (!c || !/^[0-9a-f]{6}$/i.test(c)) return rgb(0, 0, 0);
  return rgb(parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255);
}

/** Embed one image; returns the PDF image and the (possibly re-encoded) bytes, or undefined. */
export async function embedImage(
  doc: PDFDocument,
  data: Uint8Array,
  mime: string,
  rasterise: NonNullable<EngineOptions["rasterise"]>,
): Promise<{ img: PDFImage; bytes: Uint8Array; mime: string } | undefined> {
  try {
    if (mime === "image/png") return { img: await doc.embedPng(data), bytes: data, mime };
    if (mime === "image/jpeg" || mime === "image/jpg") return { img: await doc.embedJpg(data), bytes: data, mime };
    const png = await rasterise(data, mime);
    if (png) return { img: await doc.embedPng(png), bytes: png, mime: "image/png" };
  } catch {
    /* fall through */
  }
  return undefined;
}

/**
 * Embed every picture in the blocks so layout knows its natural size. Pictures that cannot be
 * embedded are removed. `extents` are sizes from the source file, used when one per picture.
 */
export async function embedBlockImages(
  doc: PDFDocument,
  blocks: Block[],
  opts: EngineOptions,
  warnings: string[],
  extents?: { w: number; h: number }[],
): Promise<Map<Uint8Array, PDFImage>> {
  const images = new Map<Uint8Array, PDFImage>();
  const rasterise = opts.rasterise ?? browserRasterise;
  let dropped = 0;
  const pending: Promise<void>[] = [];
  const pictures = [...walkInlines(blocks)].filter((w) => w.inl.kind === "image");
  const use = extents && extents.length === pictures.length ? extents : undefined;
  let picIndex = 0;
  for (const { inl, list } of pictures) {
    if (inl.kind !== "image") continue;
    const extent = use?.[picIndex++];
    pending.push(
      (async () => {
        const e = await embedImage(doc, inl.data, inl.mime, rasterise);
        if (e) {
          images.set(e.bytes, e.img);
          inl.data = e.bytes;
          inl.mime = e.mime;
          const sized = !!extent && extent.w > 0 && extent.h > 0;
          if (sized || !inl.width || !inl.height) {
            inl.width = sized ? extent.w : e.img.width * 0.75;
            inl.height = sized ? extent.h : e.img.height * 0.75;
          }
        } else {
          dropped++;
          list.splice(list.indexOf(inl), 1);
        }
      })(),
    );
  }
  await Promise.all(pending);
  if (dropped) warnings.push(`${dropped} image${dropped === 1 ? "" : "s"} in a format PDF cannot embed were skipped.`);
  return images;
}

/**
 * Lay out with a measuring pass first (to learn which fonts the text needs), load them, then lay
 * out for real and draw. Returns the PDF bytes.
 */
export async function renderPages(
  doc: PDFDocument,
  build: PageBuilder,
  images: Map<Uint8Array, PDFImage>,
  opts: EngineOptions,
  warnings: string[],
  fallbackSize: [number, number] = [595.28, 841.89],
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const fonts = new FontSet(doc);
  const recorded = new Map<string, { text: string; key: FontKey }>();
  build(
    (text, key, size) => {
      recorded.set(`${key.family}|${key.bold}|${key.italic}|${text}`, { text, key });
      return text.length * size * 0.5;
    },
    () => 1.22,
  );
  await fonts.prepare(recorded.values(), opts.loadFont ?? defaultLoadFont);
  const pages = build((text, key, size) => fonts.width(text, key, size), (key) => fonts.lineFactor(key));
  await fonts.ensure(
    pages.flatMap((p) =>
      p.cmds.flatMap((c) =>
        c.t === "text" ? [{ text: c.text, key: { family: c.family, bold: c.bold, italic: c.italic } }] : [],
      ),
    ),
  );
  for (const laid of pages) {
    const page = doc.addPage([laid.width, laid.height]);
    if (laid.bg) page.drawRectangle({ x: 0, y: 0, width: laid.width, height: laid.height, color: hex(laid.bg) });
    for (const c of laid.cmds) drawCmd(page, c, laid.height, doc, fonts, images);
  }
  if (!pages.length) doc.addPage(fallbackSize);
  warnings.push(...fonts.summary());
  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, pageCount: doc.getPageCount() };
}

export function drawCmd(
  page: ReturnType<PDFDocument["addPage"]>,
  c: Cmd,
  H: number,
  doc: PDFDocument,
  fonts: FontSet,
  images: Map<Uint8Array, PDFImage>,
) {
  switch (c.t) {
    case "text": {
      const key = { family: c.family, bold: c.bold, italic: c.italic };
      const color = hex(c.color);
      let x = c.x;
      for (const seg of fonts.segments(c.text, key)) {
        if (!seg.text) continue;
        page.drawText(seg.text, { x, y: H - c.y, size: c.size, font: seg.face.pdfFont(), color });
        x += seg.face.advance(seg.text, c.size);
      }
      const w = x - c.x;
      if (w > 0 && (c.underline || c.strike)) {
        const thickness = Math.max(0.5, c.size * 0.06);
        if (c.underline) {
          const y = H - c.y - c.size * 0.14;
          page.drawLine({ start: { x: c.x, y }, end: { x: c.x + w, y }, thickness, color });
        }
        if (c.strike) {
          const y = H - c.y + c.size * 0.28;
          page.drawLine({ start: { x: c.x, y }, end: { x: c.x + w, y }, thickness, color });
        }
      }
      return;
    }
    case "line":
      page.drawLine({
        start: { x: c.x1, y: H - c.y1 },
        end: { x: c.x2, y: H - c.y2 },
        thickness: c.width,
        color: hex(c.color),
      });
      return;
    case "rect": {
      const o: Parameters<typeof page.drawRectangle>[0] = { x: c.x, y: H - c.y - c.h, width: c.w, height: c.h };
      if (c.fill) o.color = hex(c.fill);
      if (c.stroke) {
        o.borderColor = hex(c.stroke);
        o.borderWidth = c.strokeWidth ?? 1;
      }
      page.drawRectangle(o);
      return;
    }
    case "shape": {
      const H2 = H;
      const opts: Parameters<typeof page.drawSvgPath>[1] = { x: 0, y: H2, scale: 1 };
      if (c.fill) opts.color = hex(c.fill);
      if (c.stroke) {
        opts.borderColor = hex(c.stroke);
        opts.borderWidth = c.strokeWidth ?? 1;
      }
      page.drawSvgPath(c.path, opts);
      return;
    }
    case "image": {
      const img = images.get(c.data);
      if (img) page.drawImage(img, { x: c.x, y: H - c.y - c.h, width: c.w, height: c.h });
      return;
    }
    case "link": {
      const ref = doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [c.x, H - c.y - c.h, c.x + c.w, H - c.y],
          Border: [0, 0, 0],
          A: { Type: "Action", S: "URI", URI: PDFString.of(encodeURI(c.href)) },
        }),
      );
      page.node.addAnnot(ref);
      return;
    }
    case "anchor":
      return;
  }
}

/**
 * Word (.docx) -> PDF, entirely client-side.
 * mammoth reads the docx into semantic HTML (plus private-use markers for the properties it does
 * not expose: colour, size, font, alignment, indents), model.ts turns that into blocks, layout.ts
 * flows them onto pages, and this file draws the result with real, selectable PDF text.
 */
import { PDFDocument, PDFString, rgb, type PDFImage } from "@cantoo/pdf-lib";
import JSZip from "jszip";

import { FontSet, needsUnicode } from "./fonts";
import { layoutDocument, type Cmd } from "./layout";
import {
  htmlToBlocks,
  MARK_CLOSE,
  MARK_OPEN,
  type Block,
  type Inline,
} from "./model";
import { pageSpecFromDocxXml } from "./page";

export interface ConvertOptions {
  /** Returns the bytes of a bundled font file, e.g. "LiberationSans-Regular.ttf". */
  loadFont?: (file: string) => Promise<Uint8Array>;
  /** BCP-47 locale used to choose Letter or A4 when the document does not say. */
  locale?: string;
  /** Converts an image mammoth gave us in a format PDF cannot embed (gif, bmp, ...) to PNG bytes. */
  rasterise?: (data: Uint8Array, mime: string) => Promise<Uint8Array | null>;
}

export interface ConvertResult {
  bytes: Uint8Array;
  pageCount: number;
  warnings: string[];
}

const mark = (k: string, v: string) => `${MARK_OPEN}${k}=${v}${MARK_CLOSE}`;

const STYLE_MAP = [
  "u => u",
  "strike => s",
  "p[style-name='Title'] => h1.title:fresh",
  "p[style-name='Subtitle'] => p.subtitle:fresh",
  "br[type='page'] => hr.pgbrk",
];

function familyOf(font: string | undefined): string | undefined {
  if (!font) return undefined;
  if (/courier|consolas|mono|menlo|lucida console|source code/i.test(font)) return "mono";
  if (/times|georgia|garamond|cambria|palatino|book antiqua|bookman|minion|serif|century|baskerville|constantia/i.test(font) && !/sans/i.test(font)) return "serif";
  return undefined;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function transformElement(el: any): any {
  if (el.children) el = { ...el, children: el.children.map(transformElement) };
  if (el.type === "paragraph") {
    let m = "";
    const a = el.alignment as string | undefined;
    if (a === "center") m += mark("a", "center");
    else if (a === "right" || a === "end") m += mark("a", "right");
    else if (a === "both" || a === "distribute" || a === "justify") m += mark("a", "justify");
    const start = Number(el.indent?.start);
    if (!el.numbering && Number.isFinite(start) && start > 0) m += mark("i", String(start / 20));
    if (m) el = { ...el, children: [{ type: "text", value: m }, ...el.children] };
  } else if (el.type === "run") {
    let m = "";
    let reset = "";
    if (el.fontSize) {
      m += mark("s", String(el.fontSize));
      reset += mark("s", "");
    }
    const fam = familyOf(el.font);
    if (fam) {
      m += mark("f", fam);
      reset += mark("f", "");
    }
    if (m) {
      el = {
        ...el,
        children: [{ type: "text", value: m }, ...el.children, { type: "text", value: reset }],
      };
    }
  }
  return el;
}

/** mammoth ignores run colour, so surface it as markers in sibling runs of the XML. */
function injectColourMarkers(xml: string): string {
  return xml.replace(/<w:r(?=[\s>])[^>]*>[\s\S]*?<\/w:r>/g, (run) => {
    const c = /<w:color\b[^>]*\bw:val="([0-9a-fA-F]{6})"/.exec(run)?.[1];
    if (!c || /^0{6}$/.test(c)) return run;
    const t = (v: string) => `<w:r><w:t>${v}</w:t></w:r>`;
    return t(mark("c", c)) + run + t(mark("c", ""));
  });
}

async function prepareDocx(data: Uint8Array): Promise<{ buffer: ArrayBuffer; documentXml?: string }> {
  try {
    const zip = await JSZip.loadAsync(data);
    const file = zip.file("word/document.xml");
    if (!file) return { buffer: toArrayBuffer(data) };
    const xml = await file.async("string");
    zip.file("word/document.xml", injectColourMarkers(xml));
    const out = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    return { buffer: toArrayBuffer(out), documentXml: xml };
  } catch {
    return { buffer: toArrayBuffer(data) };
  }
}

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function* walkInlines(blocks: Block[]): Generator<{ inl: Inline; list: Inline[]; bold: boolean }> {
  for (const b of blocks) {
    if (b.kind === "para") {
      for (const inl of [...b.inlines]) yield { inl, list: b.inlines, bold: b.heading > 0 };
    } else if (b.kind === "table") {
      for (const row of b.rows) for (const cell of row.cells) yield* walkInlines(cell.blocks);
    }
  }
}

function defaultLoadFont(file: string): Promise<Uint8Array> {
  return fetch(`/fonts/${file}`).then(async (r) => {
    if (!r.ok) throw new Error(`font ${file}: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  });
}

/** Browser-only: decode gif/bmp/webp/... to PNG through a canvas. */
async function browserRasterise(data: Uint8Array, mime: string): Promise<Uint8Array | null> {
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

function hex(c: string | undefined) {
  if (!c || !/^[0-9a-f]{6}$/i.test(c)) return rgb(0, 0, 0);
  return rgb(parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255);
}

export async function convertDocxToPdf(
  input: ArrayBuffer | Uint8Array,
  opts: ConvertOptions = {},
): Promise<ConvertResult> {
  const warnings: string[] = [];
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const locale = opts.locale ?? (typeof navigator !== "undefined" ? navigator.language : undefined);

  const { buffer, documentXml } = await prepareDocx(data);
  const mammoth = (await import("mammoth")).default ?? (await import("mammoth"));
  const result = await mammoth.convertToHtml(
    // the browser build reads arrayBuffer, the node build (tests) reads buffer
    {
      arrayBuffer: buffer,
      ...(typeof Buffer !== "undefined" ? { buffer: Buffer.from(buffer) } : {}),
    },
    { styleMap: STYLE_MAP, transformDocument: transformElement },
  );
  for (const m of result.messages) if (m.type === "error") warnings.push(m.message);
  const blocks = htmlToBlocks(result.value);
  const spec = pageSpecFromDocxXml(documentXml, locale);

  const doc = await PDFDocument.create();
  doc.setProducer("iHateUpload");
  doc.setCreator("iHateUpload");

  // images: embed first so layout knows their natural size
  const images = new Map<Uint8Array, PDFImage>();
  const rasterise = opts.rasterise ?? browserRasterise;
  let dropped = 0;
  const pending: Promise<void>[] = [];
  for (const { inl, list } of walkInlines(blocks)) {
    if (inl.kind !== "image") continue;
    pending.push(
      (async () => {
        let bytes = inl.data;
        let mime = inl.mime;
        let img: PDFImage | undefined;
        try {
          if (mime === "image/png") img = await doc.embedPng(bytes);
          else if (mime === "image/jpeg" || mime === "image/jpg") img = await doc.embedJpg(bytes);
          else {
            const png = await rasterise(bytes, mime);
            if (png) {
              bytes = png;
              mime = "image/png";
              img = await doc.embedPng(png);
            }
          }
        } catch {
          img = undefined;
        }
        if (img) {
          images.set(bytes, img);
          inl.data = bytes;
          inl.mime = mime;
          inl.width = img.width * 0.75;
          inl.height = img.height * 0.75;
        } else {
          dropped++;
          list.splice(list.indexOf(inl), 1);
        }
      })(),
    );
  }
  await Promise.all(pending);
  if (dropped) warnings.push(`${dropped} image${dropped === 1 ? "" : "s"} in a format PDF cannot embed were skipped.`);

  // fonts
  const fonts = new FontSet(doc);
  let uni = false;
  const scan = (bs: Block[]) => {
    for (const b of bs) {
      if (b.kind === "para") {
        if (b.marker && needsUnicode(b.marker.label)) uni = true;
        for (const i of b.inlines) if (i.kind === "text" && needsUnicode(i.text)) uni = true;
      } else if (b.kind === "table") {
        for (const r of b.rows) for (const c of r.cells) scan(c.blocks);
      }
    }
  };
  scan(blocks);
  await fonts.prepare(uni, opts.loadFont ?? defaultLoadFont);

  const pages = layoutDocument(blocks, spec, (text, key, size) => fonts.width(text, key, size));

  await fonts.ensure(
    pages.flatMap((p) =>
      p.cmds.flatMap((c) => (c.t === "text" ? [{ family: c.family, bold: c.bold, italic: c.italic }] : [])),
    ),
  );

  // draw
  for (const laid of pages) {
    const page = doc.addPage([spec.width, spec.height]);
    const H = spec.height;
    for (const c of laid.cmds) drawCmd(page, c, H, doc, fonts, images);
  }
  if (!pages.length) doc.addPage([spec.width, spec.height]);

  warnings.push(...fonts.summary());
  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, pageCount: doc.getPageCount(), warnings };
}

function drawCmd(
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
      const font = fonts.font(key);
      const text = fonts.encodable(c.text);
      if (!text) return;
      const color = hex(c.color);
      page.drawText(text, { x: c.x, y: H - c.y, size: c.size, font, color });
      if (c.underline || c.strike) {
        const w = font.widthOfTextAtSize(text, c.size);
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
    case "rect":
      page.drawRectangle({ x: c.x, y: H - c.y - c.h, width: c.w, height: c.h, color: hex(c.fill) });
      return;
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
  }
}

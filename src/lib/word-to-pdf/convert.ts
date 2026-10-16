/**
 * Word (.docx) -> PDF, entirely client-side.
 * mammoth reads the docx into semantic HTML (plus private-use markers for the properties it does
 * not expose: colour, size, font, alignment, indents), model.ts turns that into blocks, layout.ts
 * flows them onto pages, and this file draws the result with real, selectable PDF text.
 */
import { PDFDocument, PDFString, rgb, type PDFImage } from "@cantoo/pdf-lib";
import JSZip from "jszip";

import { applyDocxInfo } from "./apply-docx";
import { parseDocxInfo, type DocxInfo } from "./docx-info";
import { familyForFont } from "./font-map";
import { FontSet } from "./fonts";
import { layoutDocument, type Cmd, type FontKey } from "./layout";
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
    const fam = familyForFont(el.font);
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

function spacingMarkers(para: string): string {
  const ppr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(para)?.[0];
  const sp = ppr && /<w:spacing\b[^>]*\/?>/.exec(ppr)?.[0];
  if (!sp) return "";
  const get = (n: string) => new RegExp(`\\bw:${n}="(\\d+)"`).exec(sp)?.[1];
  let m = "";
  const before = get("before");
  const after = get("after");
  if (before !== undefined) m += mark("sb", String(Number(before) / 20));
  if (after !== undefined) m += mark("sa", String(Number(after) / 20));
  const line = get("line");
  if (line !== undefined && Number(line) > 0) {
    const rule = /\bw:lineRule="(\w+)"/.exec(sp)?.[1] ?? "auto";
    m += mark("sl", rule === "exact" ? `e:${Number(line) / 20}` : rule === "atLeast" ? `a:${Number(line) / 20}` : `m:${Number(line) / 240}`);
  }
  return m;
}

/** mammoth ignores run colour, so surface it as markers in sibling runs of the XML. */
function injectColourMarkers(xml: string): string {
  const withSpacing = xml.replace(/<w:p(?=[\s>])[^>]*>[\s\S]*?<\/w:p>/g, (para) => {
    const m = spacingMarkers(para);
    if (!m) return para;
    const run = `<w:r><w:t>${m}</w:t></w:r>`;
    const at = para.indexOf("</w:pPr>");
    return at >= 0 ? para.slice(0, at + 8) + run + para.slice(at + 8) : para;
  });
  return withSpacing.replace(/<w:r(?=[\s>])[^>]*>[\s\S]*?<\/w:r>/g, (run) => {
    const c = /<w:color\b[^>]*\bw:val="([0-9a-fA-F]{6})"/.exec(run)?.[1];
    if (!c || /^0{6}$/.test(c)) return run;
    const t = (v: string) => `<w:r><w:t>${v}</w:t></w:r>`;
    return t(mark("c", c)) + run + t(mark("c", ""));
  });
}

async function prepareDocx(
  data: Uint8Array,
): Promise<{ buffer: ArrayBuffer; documentXml?: string; stylesXml?: string; themeXml?: string }> {
  try {
    const zip = await JSZip.loadAsync(data);
    const file = zip.file("word/document.xml");
    if (!file) return { buffer: toArrayBuffer(data) };
    const xml = await file.async("string");
    zip.file("word/document.xml", injectColourMarkers(xml));
    const out = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    return {
      buffer: toArrayBuffer(out),
      documentXml: xml,
      stylesXml: await zip.file("word/styles.xml")?.async("string"),
      themeXml: await zip.file("word/theme/theme1.xml")?.async("string"),
    };
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

  const { buffer, documentXml, stylesXml, themeXml } = await prepareDocx(data);
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
  let info: DocxInfo | undefined;
  if (documentXml) {
    try {
      info = parseDocxInfo({ document: documentXml, styles: stylesXml, theme: themeXml });
      applyDocxInfo(blocks, info);
    } catch {
      info = undefined;
    }
  }
  const spec = pageSpecFromDocxXml(documentXml, locale);

  const doc = await PDFDocument.create();
  doc.setProducer("iHateUpload");
  doc.setCreator("iHateUpload");

  // images: embed first so layout knows their natural size
  const images = new Map<Uint8Array, PDFImage>();
  const rasterise = opts.rasterise ?? browserRasterise;
  let dropped = 0;
  const pending: Promise<void>[] = [];
  const pictures = [...walkInlines(blocks)].filter((w) => w.inl.kind === "image");
  // the docx's own drawing sizes, when every picture lines up with one
  const extents = info && info.images.length === pictures.length ? info.images : undefined;
  let picIndex = 0;
  for (const { inl, list } of pictures) {
    if (inl.kind !== "image") continue;
    const extent = extents?.[picIndex++];
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
          inl.width = extent && extent.w > 0 && extent.h > 0 ? extent.w : img.width * 0.75;
          inl.height = extent && extent.w > 0 && extent.h > 0 ? extent.h : img.height * 0.75;
        } else {
          dropped++;
          list.splice(list.indexOf(inl), 1);
        }
      })(),
    );
  }
  await Promise.all(pending);
  if (dropped) warnings.push(`${dropped} image${dropped === 1 ? "" : "s"} in a format PDF cannot embed were skipped.`);

  // fonts: a recording layout pass finds every word and face, then the real pass measures exactly
  const fonts = new FontSet(doc);
  const recorded = new Map<string, { text: string; key: FontKey }>();
  layoutDocument(blocks, spec, (text, key, size) => {
    recorded.set(`${key.family}|${key.bold}|${key.italic}|${text}`, { text, key });
    return text.length * size * 0.5;
  });
  await fonts.prepare(recorded.values(), opts.loadFont ?? defaultLoadFont);

  const pages = layoutDocument(blocks, spec, (text, key, size) => fonts.width(text, key, size), {
    lineFactor: (key) => fonts.lineFactor(key),
  });
  await fonts.ensure(
    pages.flatMap((p) =>
      p.cmds.flatMap((c) =>
        c.t === "text" ? [{ text: c.text, key: { family: c.family, bold: c.bold, italic: c.italic } }] : [],
      ),
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

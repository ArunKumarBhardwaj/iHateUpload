/**
 * Word (.docx) -> PDF, entirely client-side.
 * mammoth reads the docx into semantic HTML (plus private-use markers for the properties it does
 * not expose: colour, size, font, alignment, indents), model.ts turns that into blocks, layout.ts
 * flows them onto pages, and this file draws the result with real, selectable PDF text.
 */
import { PDFDocument } from "@cantoo/pdf-lib";
import JSZip from "jszip";

import { applyDocxInfo } from "./apply-docx";
import { parseDocxInfo, type DocxInfo } from "./docx-info";
import { familyForFont } from "./font-map";
import { embedBlockImages, renderPages, toArrayBuffer, walkInlines } from "../doc-render/engine";
import { layoutDocument } from "./layout";
import { htmlToBlocks, MARK_CLOSE, MARK_OPEN } from "./model";
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
  const pictures = [...walkInlines(blocks)].filter((w) => w.inl.kind === "image");
  const extents = info && info.images.length === pictures.length ? info.images : undefined;
  const images = await embedBlockImages(doc, blocks, opts, warnings, extents);

  // fonts: a recording layout pass finds every word and face, then the real pass measures exactly
  const out = await renderPages(
    doc,
    (measure, lineFactor) =>
      layoutDocument(blocks, spec, measure, { lineFactor }).map((p) => ({
        width: spec.width,
        height: spec.height,
        cmds: p.cmds,
      })),
    images,
    opts,
    warnings,
    [spec.width, spec.height],
  );
  return { bytes: out.bytes, pageCount: out.pageCount, warnings };
}

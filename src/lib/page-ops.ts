import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
  type PDFDocument,
  type PDFPage,
} from "@cantoo/pdf-lib";

export type FlipMode = "none" | "h" | "v" | "hv";

type Box = { x0: number; y0: number; x1: number; y1: number };
type Matrix = [number, number, number, number, number, number];

/**
 * The content transform for a visual mirror. A page shown turned 90 or 270
 * degrees has its own x axis running up the screen, so left-right becomes y.
 */
export function flipMatrix(mode: FlipMode, rotation: number, box: Box): Matrix {
  const turned = ((rotation % 360) + 360) % 360 % 180 !== 0;
  const visualH = mode === "h" || mode === "hv";
  const visualV = mode === "v" || mode === "hv";
  const flipX = turned ? visualV : visualH;
  const flipY = turned ? visualH : visualV;
  return [
    flipX ? -1 : 1,
    0,
    0,
    flipY ? -1 : 1,
    flipX ? box.x0 + box.x1 : 0,
    flipY ? box.y0 + box.y1 : 0,
  ];
}

const latin1 = new TextDecoder("latin1");

function streamText(stream: PDFStream): string {
  const s = stream as PDFStream & {
    getUnencodedContents?: () => Uint8Array;
  };
  if (stream instanceof PDFRawStream) {
    return latin1.decode(decodePDFRawStream(stream).decode());
  }
  const bytes = s.getUnencodedContents ? s.getUnencodedContents() : s.getContents();
  return latin1.decode(bytes);
}

function contentStreams(page: PDFPage): PDFStream[] {
  const contents = page.node.Contents();
  if (!contents) return [];
  if (contents instanceof PDFStream) return [contents];
  const out: PDFStream[] = [];
  for (let i = 0; i < contents.size(); i++) {
    const s = page.node.context.lookup(contents.get(i));
    if (s instanceof PDFStream) out.push(s);
  }
  return out;
}

/** All the page's content streams as one string. */
export function pageContentText(page: PDFPage): string {
  return contentStreams(page).map(streamText).join("\n");
}

function num(page: PDFPage, ref: unknown): number {
  const v = page.node.context.lookup(ref as never);
  return v instanceof PDFNumber ? v.asNumber() : 0;
}

/** Mirrors one page by wrapping its content in a transform. Text stays text. */
export function flipPage(doc: PDFDocument, page: PDFPage, mode: FlipMode) {
  if (mode === "none") return;
  const crop = page.getCropBox();
  const box: Box = {
    x0: crop.x,
    y0: crop.y,
    x1: crop.x + crop.width,
    y1: crop.y + crop.height,
  };
  const m = flipMatrix(mode, page.getRotation().angle, box);
  const ctx = doc.context;
  const pre = ctx.register(ctx.stream(`q ${m.join(" ")} cm\n`));
  const post = ctx.register(ctx.stream("\nQ\n"));
  const raw = page.node.get(PDFName.of("Contents"));
  const list: unknown[] = [pre];
  if (raw instanceof PDFArray) {
    for (let i = 0; i < raw.size(); i++) list.push(raw.get(i));
  } else if (raw) {
    list.push(raw);
  }
  list.push(post);
  page.node.set(PDFName.of("Contents"), ctx.obj(list as never));

  // Links follow the page. Anything else would draw mirrored, so it goes.
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) return;
  const keep: unknown[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const ref = annots.get(i);
    const dict = ctx.lookup(ref);
    if (!(dict instanceof PDFDict)) continue;
    const subtype = dict.get(PDFName.of("Subtype"));
    const rect = dict.lookupMaybe(PDFName.of("Rect"), PDFArray);
    if (!subtype || subtype.toString() !== "/Link" || !rect) continue;
    const [a, b, c, d] = [0, 1, 2, 3].map((k) => num(page, rect.get(k)));
    const ax = m[0] * a + m[4];
    const cx = m[0] * c + m[4];
    const by = m[3] * b + m[5];
    const dy = m[3] * d + m[5];
    dict.set(
      PDFName.of("Rect"),
      ctx.obj([Math.min(ax, cx), Math.min(by, dy), Math.max(ax, cx), Math.max(by, dy)]),
    );
    keep.push(ref);
  }
  if (keep.length > 0) page.node.set(PDFName.of("Annots"), ctx.obj(keep as never));
  else page.node.delete(PDFName.of("Annots"));
}

/**
 * Drops text blocks drawn in render mode 3, the invisible mode that OCR
 * layers use. Strings are skipped so a literal "ET" inside one is harmless.
 */
export function removeInvisibleTextOps(content: string): {
  content: string;
  removed: number;
} {
  const token =
    /\((?:\\[\s\S]|\((?:\\[\s\S]|[^\\()])*\)|[^\\()])*\)|<[0-9A-Fa-f\s]*>|(?<![\w.])(\d)\s+Tr(?![\w])|(?<![\w/])BT(?![\w])|(?<![\w/])ET(?![\w])|(?<![\w/])q(?![\w])|(?<![\w/])Q(?![\w])/g;
  let mode = 0;
  const modeStack: number[] = [];
  let blockStart = -1;
  let blockInvisible = false;
  const cuts: [number, number][] = [];
  let m: RegExpExecArray | null;
  while ((m = token.exec(content))) {
    const t = m[0];
    if (t[0] === "(" || t[0] === "<") continue;
    if (m[1] !== undefined) {
      mode = Number(m[1]);
      if (blockStart >= 0) blockInvisible = mode === 3;
    } else if (t === "BT") {
      blockStart = m.index;
      blockInvisible = mode === 3;
    } else if (t === "ET") {
      if (blockStart >= 0 && blockInvisible) cuts.push([blockStart, m.index + 2]);
      blockStart = -1;
      blockInvisible = false;
    } else if (t === "q") {
      modeStack.push(mode);
    } else if (t === "Q") {
      mode = modeStack.pop() ?? mode;
    }
  }
  if (cuts.length === 0) return { content, removed: 0 };
  let out = "";
  let at = 0;
  for (const [s, e] of cuts) {
    out += content.slice(at, s);
    at = e;
  }
  out += content.slice(at);
  return { content: out, removed: cuts.length };
}

/** Rewrites the page without its invisible text. Returns how many blocks went. */
export function stripInvisibleText(page: PDFPage): number {
  const streams = contentStreams(page);
  if (streams.length === 0) return 0;
  const joined = streams.map(streamText).join("\n");
  const { content, removed } = removeInvisibleTextOps(joined);
  if (removed === 0) return 0;
  const ctx = page.node.context;
  const bytes = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) bytes[i] = content.charCodeAt(i) & 255;
  page.node.set(PDFName.of("Contents"), ctx.register(ctx.stream(bytes)));
  return removed;
}

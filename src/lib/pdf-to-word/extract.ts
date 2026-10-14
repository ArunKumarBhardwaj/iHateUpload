import type { PDFPageProxy } from "pdfjs-dist";

import { fontFlags } from "./fonts";
import type { Fill, PageImage, PageInput, Rule, TextItem } from "./lines";

type Matrix = [number, number, number, number, number, number];
type Ops = Record<string, number>;

/** Where an image's pixels live, for the caller to fetch when it is actually used. */
export type ImageSource =
  | { kind: "object"; id: string }
  | { kind: "inline"; data: unknown };

export type Extracted = {
  input: PageInput;
  sources: Map<string, ImageSource>;
  /** Non-blank characters in the text layer. */
  chars: number;
  /** Images, masks and inline pictures painted on the page, of any size. */
  paintedImages: number;
  /** Text pieces set at an angle, which the flow cannot hold. */
  skippedRotated: number;
};

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function mul(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

type Point = [number, number];

/** Flat pdf.js path data to subpaths of points, with whether each was closed. */
function subpaths(data: ArrayLike<number>): { points: Point[]; closed: boolean }[] {
  const out: { points: Point[]; closed: boolean }[] = [];
  let current: { points: Point[]; closed: boolean } | null = null;
  for (let i = 0; i < data.length; ) {
    const op = data[i++];
    if (op === 0) {
      current = { points: [[data[i], data[i + 1]]], closed: false };
      out.push(current);
      i += 2;
    } else if (op === 1) {
      if (!current) {
        current = { points: [], closed: false };
        out.push(current);
      }
      current.points.push([data[i], data[i + 1]]);
      i += 2;
    } else if (op === 2) {
      current?.points.push([data[i + 4], data[i + 5]]);
      i += 6;
    } else if (op === 3) {
      current?.points.push([data[i + 2], data[i + 3]]);
      i += 4;
    } else if (op === 4) {
      if (current) current.closed = true;
    } else break;
  }
  return out.filter((p) => p.points.length >= 2);
}

function ruleFrom(a: Point, b: Point): Rule | null {
  const dx = Math.abs(a[0] - b[0]);
  const dy = Math.abs(a[1] - b[1]);
  if (dx <= 0.6 && dy >= 4) {
    return { x0: (a[0] + b[0]) / 2, x1: (a[0] + b[0]) / 2, y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) };
  }
  if (dy <= 0.6 && dx >= 4) {
    return { y0: (a[1] + b[1]) / 2, y1: (a[1] + b[1]) / 2, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]) };
  }
  return null;
}

/** Filled rectangles that are big enough to be a background rather than a ruling line. */
function fillsFromPath(data: ArrayLike<number>, m: Matrix, color: string): Fill[] {
  const out: Fill[] = [];
  for (const sub of subpaths(data)) {
    const pts = sub.points.map(([x, y]) => apply(m, x, y));
    const isBox =
      pts.length === 4 ||
      (pts.length === 5 && Math.hypot(pts[0][0] - pts[4][0], pts[0][1] - pts[4][1]) < 0.6);
    if (!isBox) continue;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    if (box.x1 - box.x0 > 2.5 && box.y1 - box.y0 > 2.5) out.push({ ...box, color });
  }
  return out;
}

const isWhite = (hex: string) => [0, 2, 4].every((i) => parseInt(hex.slice(i, i + 2), 16) >= 250);

function rulesFromPath(
  data: ArrayLike<number>,
  m: Matrix,
  stroke: boolean,
  fill: boolean,
): Rule[] {
  const rules: Rule[] = [];
  for (const sub of subpaths(data)) {
    const pts = sub.points.map(([x, y]) => apply(m, x, y));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    const isBox =
      pts.length === 4 ||
      (pts.length === 5 && Math.hypot(pts[0][0] - pts[4][0], pts[0][1] - pts[4][1]) < 0.6);
    if (fill && !stroke && isBox && Math.min(w, h) <= 2.5 && Math.max(w, h) >= 4) {
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      rules.push(
        w >= h
          ? { x0: Math.min(...xs), x1: Math.max(...xs), y0: cy, y1: cy }
          : { x0: cx, x1: cx, y0: Math.min(...ys), y1: Math.max(...ys) },
      );
      continue;
    }
    if (!stroke) continue;
    for (let i = 1; i < pts.length; i++) {
      const rule = ruleFrom(pts[i - 1], pts[i]);
      if (rule) rules.push(rule);
    }
    if (sub.closed) {
      const rule = ruleFrom(pts[pts.length - 1], pts[0]);
      if (rule) rules.push(rule);
    }
  }
  return rules;
}

const generic = (family: string | undefined, name: string): TextItem["generic"] => {
  const f = `${family ?? ""} ${name}`.toLowerCase();
  if (/mono|courier|consol/.test(f)) return "mono";
  if (/serif/.test(f) && !/sans/.test(f)) return "serif";
  if (/times|georgia|garamond|palatino|minion|book/.test(f) && !/sans/.test(f)) return "serif";
  return "sans";
};

export async function extractPage(
  page: PDFPageProxy,
  OPS: Ops,
  pageNo: number,
): Promise<Extracted> {
  const viewport = page.getViewport({ scale: 1 });
  const vt = viewport.transform as Matrix;
  const width = viewport.width;
  const height = viewport.height;

  // Walking the operators first also loads the fonts into commonObjs.
  const list = await page.getOperatorList();
  const content = await page.getTextContent();

  const rules: Rule[] = [];
  const images: PageImage[] = [];
  const sources = new Map<string, ImageSource>();
  let paintedImages = 0;
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  const fills: Fill[] = [];
  let fillColor = "000000";
  const colorStack: string[] = [];
  let inlineCount = 0;

  const strokeOps = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const fillOps = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);

  const placeImage = (ref: string, source: ImageSource) => {
    const m = mul(vt, ctm);
    const corners = [apply(m, 0, 0), apply(m, 1, 0), apply(m, 0, 1), apply(m, 1, 1)];
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    images.push({
      ref,
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    });
    sources.set(ref, source);
  };

  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as unknown[] | null;
    if (fn === OPS.save) {
      stack.push(ctm);
      colorStack.push(fillColor);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? IDENTITY;
      fillColor = colorStack.pop() ?? fillColor;
    } else if (fn === OPS.setFillRGBColor && args && typeof args[0] === "string") {
      fillColor = (args[0] as string).replace("#", "").toLowerCase();
    }
    else if (fn === OPS.transform && args) ctm = mul(ctm, args as unknown as Matrix);
    else if (fn === OPS.paintFormXObjectBegin && args) {
      stack.push(ctm);
      if (args[0]) ctm = mul(ctm, args[0] as Matrix);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? IDENTITY;
    else if (fn === OPS.constructPath && args) {
      const paint = args[0] as number;
      const stroke = strokeOps.has(paint);
      const fill = fillOps.has(paint);
      if (!stroke && !fill) continue;
      const raw = args[1] as unknown;
      const data = (Array.isArray(raw) ? raw[0] : raw) as ArrayLike<number> | undefined;
      if (data) {
        rules.push(...rulesFromPath(data, mul(vt, ctm), stroke, fill));
        if (fill && /^[0-9a-f]{6}$/.test(fillColor) && !isWhite(fillColor)) {
          fills.push(...fillsFromPath(data, mul(vt, ctm), fillColor));
        }
      }
    } else if (fn === OPS.paintImageXObject && args) {
      paintedImages++;
      placeImage(`${pageNo}:${args[0] as string}`, { kind: "object", id: args[0] as string });
    } else if (fn === OPS.paintInlineImageXObject && args) {
      paintedImages++;
      const ref = `${pageNo}:inline${++inlineCount}`;
      placeImage(ref, { kind: "inline", data: args[0] });
    } else if (fn === OPS.paintImageMaskXObject || fn === OPS.paintImageXObjectRepeat) {
      paintedImages++;
    }
  }

  const fontInfo = new Map<string, { name: string; bold: boolean; italic: boolean; generic: TextItem["generic"] }>();
  const describe = (id: string) => {
    let info = fontInfo.get(id);
    if (info) return info;
    let name = "";
    let bold = false;
    let italic = false;
    let family: string | undefined = content.styles[id]?.fontFamily;
    try {
      if (page.commonObjs.has(id)) {
        const font = page.commonObjs.get(id) as {
          name?: string;
          bold?: boolean;
          italic?: boolean;
          black?: boolean;
          fallbackName?: string;
          isMonospace?: boolean;
          isSerifFont?: boolean;
        };
        name = font.name ?? "";
        bold = font.bold === true || font.black === true;
        italic = font.italic === true;
        family = font.isMonospace ? "monospace" : font.isSerifFont ? "serif" : (font.fallbackName ?? family);
      }
    } catch {
      // Font not loaded: fall back to what the text layer says.
    }
    const flags = fontFlags(name);
    info = {
      name: name || family || "Arial",
      bold: bold || flags.bold,
      italic: italic || flags.italic,
      generic: generic(family, name),
    };
    fontInfo.set(id, info);
    return info;
  };

  const items: TextItem[] = [];
  let chars = 0;
  let skippedRotated = 0;
  for (const raw of content.items) {
    if (!("str" in raw)) continue;
    const text = raw.str;
    if (!text.trim()) continue;
    chars += text.replace(/\s/g, "").length;
    const m = mul(vt, raw.transform as Matrix);
    const size = Math.hypot(m[2], m[3]);
    if (Math.abs(m[1]) > 0.25 * Math.abs(m[0]) || m[0] < 0 || !(size > 0)) {
      skippedRotated++;
      continue;
    }
    const font = describe(raw.fontName);
    items.push({
      str: text,
      x: m[4],
      y: m[5],
      w: raw.width > 0 ? raw.width : text.length * size * 0.5,
      size,
      font: font.name,
      bold: font.bold,
      italic: font.italic,
      generic: font.generic,
    });
  }

  // A picture the size of the page behind live text is a scan's backdrop, not content.
  const kept = images.filter((im) => !(chars >= 20 && im.w * im.h >= width * height * 0.85));
  for (const im of images) if (!kept.includes(im)) sources.delete(im.ref);

  return {
    input: { width, height, items, rules, images: kept, fills },
    sources,
    chars,
    paintedImages,
    skippedRotated,
  };
}

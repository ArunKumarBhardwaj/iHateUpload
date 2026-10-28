/** Document model built from mammoth's HTML. Pure data, no layout. */
import { parseHtml, type HNode } from "./html";

export type Family = "sans" | "serif" | "mono" | "carlito" | "caladea";

export interface LineSpec {
  kind: "mult" | "exact" | "atLeast";
  v: number;
}
export interface Spacing {
  before?: number;
  after?: number;
  line?: LineSpec;
}
/** Properties a docx paragraph style contributes before run-level overrides. */
export interface ParaBase {
  family?: Family;
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
}
export interface TableInfo {
  /** column widths in points */
  grid: number[];
  widthPt?: number;
  /** percent of the text width (100 = full width) */
  widthPct?: number;
  /** null = no borders */
  borders: { color: string; width: number } | null;
  fills: (string | undefined)[][];
  /** cell padding in points, when not the default */
  pad?: { x: number; y: number };
}
export interface Edge {
  color: string;
  width: number;
}
export type Align = "left" | "center" | "right" | "justify";

export interface InlineStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** hex RRGGBB */
  color?: string;
  /** points */
  size?: number;
  family?: Family;
  href?: string;
  script?: "sup" | "sub";
}

export type Inline =
  | { kind: "text"; text: string; style: InlineStyle }
  | { kind: "image"; data: Uint8Array; mime: string; width: number; height: number; /** part of the height below the baseline */ depth?: number; color?: string }
  | { kind: "br" };

export interface Para {
  kind: "para";
  inlines: Inline[];
  align: Align;
  /** 0 = body text, 1..6 = heading levels */
  heading: number;
  title?: boolean;
  /** extra left indent in points (non-list paragraphs) */
  indent: number;
  marker?: { label: string; level: number; base?: number; step?: number };
  spacing?: Spacing;
  base?: ParaBase;
  /** true when `base` and `spacing` came from the docx's own styles */
  docxStyled?: boolean;
  /** preformatted text: spaces are kept and lines are never re-wrapped at spaces */
  pre?: boolean;
  /**
   * keep on one line, as a spreadsheet cell without "wrap text": text a little too wide is set
   * slightly smaller, anything wider is cut at the last whole word that fits
   */
  oneLine?: boolean;
  /** a horizontal rule instead of text */
  rule?: boolean;
  /** vertical bar colour drawn left of the paragraph (block quotes) */
  bar?: string;
  /** shaded and/or outlined box behind the paragraph (code blocks, styled HTML) */
  box?: { bg?: string; border?: { color: string; width: number }; bottomOnly?: boolean };
  /** heading id, so a table of contents can look up its page */
  anchor?: number;
}

export interface Cell {
  blocks: Block[];
  colSpan: number;
  rowSpan: number;
  header: boolean;
  fill?: string;
  /** this cell's own edges (drawn in addition to the table's borders) */
  edges?: { top?: Edge; right?: Edge; bottom?: Edge; left?: Edge };
  /** vertical placement of the content in a row taller than it; top by default */
  valign?: "top" | "middle" | "bottom";
}
export interface Row {
  header: boolean;
  cells: Cell[];
  /** the row is at least this tall, in points */
  minHeight?: number;
  /** the row is exactly minHeight tall, as a spreadsheet row is: content never makes it taller */
  exactHeight?: boolean;
}
export interface TableBlock {
  kind: "table";
  rows: Row[];
  info?: TableInfo;
  /** pictures drawn over the cells (spreadsheets), clipped to the table */
  pictures?: TablePicture[];
}
/** A picture placed by table geometry: x from the table's left edge, y from a row's top. */
export interface TablePicture {
  /** one image inline; emptied when the image can't be embedded */
  inlines: Inline[];
  x: number;
  w: number;
  top: { row: number; dy: number };
  /** where the bottom edge sits, for pictures that stretch with the rows */
  bottom?: { row: number; dy: number };
  /** fixed height in points, when there's no bottom anchor */
  h?: number;
}
export interface PageBreak {
  kind: "pagebreak";
}
export type Block = Para | TableBlock | PageBreak;

// Private-use markers injected by the mammoth transform in convert.ts.
export const MARK_OPEN = "";
export const MARK_CLOSE = "";
const MARK_RE = /([a-z]+)=([^]*)/g;

const SAFE_LINK = /^(https?:|mailto:|tel:)/i;
const BASE: InlineStyle = { bold: false, italic: false, underline: false, strike: false };

const el = (n: HNode): n is Extract<HNode, { tag: string }> => "tag" in n;

function alpha(n: number): string {
  let s = "";
  let v = n;
  while (v > 0) {
    v--;
    s = String.fromCharCode(97 + (v % 26)) + s;
    v = Math.floor(v / 26);
  }
  return s || "a";
}
function roman(n: number): string {
  const map: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let s = "";
  let v = n;
  for (const [k, r] of map) while (v >= k) { s += r; v -= k; }
  return s || "i";
}
export function listLabel(ordered: boolean, level: number, n: number): string {
  if (!ordered) return level % 2 === 0 ? "•" : "–";
  const k = level % 3;
  return `${k === 0 ? n : k === 1 ? alpha(n) : roman(n)}.`;
}

function decodeDataUri(src: string): { data: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(src);
  if (!m || !m[2]) return null;
  try {
    const bin = atob(m[3]);
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    return { data, mime: m[1] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

interface InlineCtx {
  para: Para;
  /** run state driven by markers; persists across text nodes */
  cur: { color?: string; size?: number; family?: Family };
  out: Inline[];
}

function applyMarker(ctx: InlineCtx, key: string, value: string) {
  switch (key) {
    case "a":
      if (["left", "center", "right", "justify"].includes(value)) ctx.para.align = value as Align;
      break;
    case "i": {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) ctx.para.indent = Math.min(n, 240);
      break;
    }
    case "sb":
    case "sa": {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0 && n <= 400) {
        ctx.para.spacing = { ...ctx.para.spacing, [key === "sb" ? "before" : "after"]: n };
      }
      break;
    }
    case "sl": {
      const [k, num] = value.split(":");
      const v = Number(num);
      const kind = k === "m" ? "mult" : k === "e" ? "exact" : k === "a" ? "atLeast" : undefined;
      if (kind && Number.isFinite(v) && v > 0 && v < 1000) ctx.para.spacing = { ...ctx.para.spacing, line: { kind, v } };
      break;
    }
    case "c":
      ctx.cur.color = /^[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : undefined;
      break;
    case "s": {
      const n = Number(value);
      ctx.cur.size = Number.isFinite(n) && n >= 4 && n <= 200 ? n : undefined;
      break;
    }
    case "f":
      ctx.cur.family = ["serif", "mono", "sans", "carlito", "caladea"].includes(value) ? (value as Family) : undefined;
      break;
  }
}

function pushText(ctx: InlineCtx, raw: string, style: InlineStyle) {
  let last = 0;
  const emit = (text: string) => {
    if (!text) return;
    ctx.out.push({
      kind: "text",
      text,
      style: { ...style, color: style.color ?? ctx.cur.color, size: ctx.cur.size, family: ctx.cur.family },
    });
  };
  MARK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARK_RE.exec(raw))) {
    emit(raw.slice(last, m.index));
    applyMarker(ctx, m[1], m[2]);
    last = MARK_RE.lastIndex;
  }
  emit(raw.slice(last));
}

function walkInline(nodes: HNode[], style: InlineStyle, ctx: InlineCtx) {
  for (const n of nodes) {
    if (!el(n)) {
      pushText(ctx, n.text, style);
      continue;
    }
    switch (n.tag) {
      case "br":
        ctx.out.push({ kind: "br" });
        break;
      case "img": {
        const d = decodeDataUri(n.attrs.src ?? "");
        if (d) ctx.out.push({ kind: "image", data: d.data, mime: d.mime, width: 0, height: 0 });
        break;
      }
      case "a": {
        const href = n.attrs.href ?? "";
        if (/^#(footnote|endnote)-ref/i.test(href)) break;
        walkInline(n.children, SAFE_LINK.test(href) ? { ...style, href } : style, ctx);
        break;
      }
      case "strong":
      case "b":
        walkInline(n.children, { ...style, bold: true }, ctx);
        break;
      case "em":
      case "i":
        walkInline(n.children, { ...style, italic: true }, ctx);
        break;
      case "u":
        walkInline(n.children, { ...style, underline: true }, ctx);
        break;
      case "s":
      case "strike":
      case "del":
        walkInline(n.children, { ...style, strike: true }, ctx);
        break;
      case "sup":
        walkInline(n.children, { ...style, script: "sup" }, ctx);
        break;
      case "sub":
        walkInline(n.children, { ...style, script: "sub" }, ctx);
        break;
      case "code":
      case "tt":
        walkInline(n.children, { ...style, family: "mono" }, ctx);
        break;
      default:
        walkInline(n.children, style, ctx);
    }
  }
}

const hasContent = (inl: Inline[]) =>
  inl.some((i) => i.kind === "image" || (i.kind === "text" && /\S/.test(i.text)));

function makePara(nodes: HNode[], base: Partial<Para> = {}, style: InlineStyle = BASE): Para | null {
  const para: Para = { kind: "para", inlines: [], align: "left", heading: 0, indent: 0, ...base };
  const ctx: InlineCtx = { para, cur: {}, out: [] };
  walkInline(nodes, style, ctx);
  // trim leading and trailing breaks
  while (ctx.out[0]?.kind === "br") ctx.out.shift();
  while (ctx.out[ctx.out.length - 1]?.kind === "br") ctx.out.pop();
  para.inlines = ctx.out;
  return hasContent(ctx.out) ? para : null;
}

const INLINE_TAGS = new Set(["a", "strong", "b", "em", "i", "u", "s", "strike", "del", "sup", "sub", "br", "img", "span", "code", "tt"]);
const isInlineNode = (n: HNode) => !el(n) || INLINE_TAGS.has(n.tag);

function listBlocks(list: Extract<HNode, { tag: string }>, level: number): Block[] {
  const ordered = list.tag === "ol";
  const startAttr = Number(list.attrs.start);
  let n = Number.isFinite(startAttr) && startAttr > 0 ? startAttr : 1;
  const out: Block[] = [];
  for (const li of list.children) {
    if (!el(li) || li.tag !== "li") continue;
    const marker = { label: listLabel(ordered, level, n), level };
    n++;
    let placed = false;
    let inlineRun: HNode[] = [];
    const flush = () => {
      if (!inlineRun.length) return;
      const p = makePara(inlineRun, placed ? { marker: { label: "", level } } : { marker });
      if (p) {
        out.push(p);
        placed = true;
      }
      inlineRun = [];
    };
    for (const c of li.children) {
      if (isInlineNode(c)) {
        inlineRun.push(c);
        continue;
      }
      flush();
      if (el(c) && (c.tag === "ul" || c.tag === "ol")) {
        if (!placed) {
          // a list item with no text of its own: still consume the number
          placed = true;
        }
        out.push(...listBlocks(c, level + 1));
      } else {
        for (const b of toBlocks([c])) {
          if (b.kind === "para" && !b.marker) b.marker = placed ? { label: "", level } : marker;
          if (b.kind === "para") placed = true;
          out.push(b);
        }
      }
    }
    flush();
  }
  return out;
}

function tableBlock(t: Extract<HNode, { tag: string }>): TableBlock {
  const rows: Row[] = [];
  const visit = (nodes: HNode[], inHead: boolean) => {
    for (const n of nodes) {
      if (!el(n)) continue;
      if (n.tag === "thead") visit(n.children, true);
      else if (n.tag === "tbody" || n.tag === "tfoot") visit(n.children, inHead);
      else if (n.tag === "tr") {
        const cells: Cell[] = [];
        for (const c of n.children) {
          if (!el(c) || (c.tag !== "td" && c.tag !== "th")) continue;
          const span = (k: string) => Math.max(1, Math.min(50, parseInt(c.attrs[k] ?? "1", 10) || 1));
          cells.push({
            blocks: toBlocks(c.children),
            colSpan: span("colspan"),
            rowSpan: span("rowspan"),
            header: inHead || c.tag === "th",
          });
        }
        if (cells.length) rows.push({ header: inHead, cells });
      }
    }
  };
  visit(t.children, false);
  return { kind: "table", rows };
}

function toBlocks(nodes: HNode[]): Block[] {
  const out: Block[] = [];
  let loose: HNode[] = [];
  const flushLoose = () => {
    if (!loose.length) return;
    const p = makePara(loose);
    if (p) out.push(p);
    loose = [];
  };
  for (const n of nodes) {
    if (isInlineNode(n)) {
      loose.push(n);
      continue;
    }
    flushLoose();
    if (!el(n)) continue;
    const h = /^h([1-6])$/.exec(n.tag);
    if (h) {
      const p = makePara(n.children, {
        heading: Number(h[1]),
        title: n.tag === "h1" && (n.attrs.class ?? "").includes("title"),
      });
      if (p) out.push(p);
    } else if (n.tag === "p") {
      // mammoth puts page breaks inside the paragraph: split the paragraph around them
      let seg: HNode[] = [];
      const cut = () => {
        const p = makePara(seg);
        if (p) out.push(p);
        seg = [];
      };
      for (const c of n.children) {
        if (el(c) && c.tag === "hr" && (c.attrs.class ?? "").includes("pgbrk")) {
          cut();
          out.push({ kind: "pagebreak" });
        } else seg.push(c);
      }
      cut();
    } else if (n.tag === "ul" || n.tag === "ol") {
      out.push(...listBlocks(n, 0));
    } else if (n.tag === "table") {
      const t = tableBlock(n);
      if (t.rows.length) out.push(t);
    } else if (n.tag === "hr") {
      if ((n.attrs.class ?? "").includes("pgbrk")) out.push({ kind: "pagebreak" });
    } else if (n.tag === "blockquote") {
      for (const b of toBlocks(n.children)) {
        if (b.kind === "para") b.indent = Math.max(b.indent, 28);
        out.push(b);
      }
    } else {
      out.push(...toBlocks(n.children));
    }
  }
  flushLoose();
  return out;
}

export function htmlToBlocks(html: string): Block[] {
  return toBlocks(parseHtml(html));
}

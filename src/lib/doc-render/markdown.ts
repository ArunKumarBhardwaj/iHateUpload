/** Markdown -> blocks for the shared layout engine. A small GFM subset parser, no dependencies. */
import type { Align, Block, Family, Inline, InlineStyle, Para, Row, TableBlock } from "../word-to-pdf/model";

export interface MarkdownOptions {
  toc: boolean;
  numberHeadings: boolean;
  font: "sans" | "serif" | "mono";
  fontSize: number;
}

export const MD_DEFAULTS: MarkdownOptions = { toc: false, numberHeadings: false, font: "sans", fontSize: 11 };

const LINK_OK = /^(https?:|mailto:|tel:)/i;
const HEADING_SCALE = [1.85, 1.5, 1.25, 1.1, 1, 0.95];
const QUOTE_BAR = "BFC5CC";
const CODE_BG = "F3F4F6";
const INLINE_CODE_COLOR = "9A3412";

interface Ctx {
  opt: MarkdownOptions;
  family: Family;
  nextId: number;
  headings: { id: number; level: number; text: string; number: string }[];
  counters: number[];
  minLevel: number;
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

const base = (ctx: Ctx, over: Partial<InlineStyle> = {}): InlineStyle => ({
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  size: ctx.opt.fontSize,
  family: ctx.family,
  ...over,
});

const PUNCT = /[\\`*_{}[\]()#+\-.!|~<>"'$%&,/:;=?@^]/;
const BREAK = "\u0001";

/** Inline markdown -> runs. `st` is the style inherited from the enclosing span. */
export function parseInline(src: string, st: InlineStyle, ctx: Ctx, out: Inline[] = []): Inline[] {
  let buf = "";
  const flush = () => {
    if (buf) out.push({ kind: "text", text: buf, style: st });
    buf = "";
  };
  let i = 0;
  const s = src;
  while (i < s.length) {
    const ch = s[i];
    if (ch === BREAK) {
      flush();
      out.push({ kind: "br" });
      i++;
      continue;
    }
    if (ch === "\\" && i + 1 < s.length && PUNCT.test(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      let n = 1;
      while (s[i + n] === "`") n++;
      const fence = "`".repeat(n);
      const end = s.indexOf(fence, i + n);
      if (end > 0) {
        flush();
        const code = s.slice(i + n, end).replace(/\n/g, " ").replace(/^ (.*\S.*) $/, "$1");
        out.push({
          kind: "text",
          text: code,
          style: { ...st, family: "mono", size: st.size ? st.size * 0.9 : undefined, color: st.href ? st.color : INLINE_CODE_COLOR },
        });
        i = end + n;
        continue;
      }
    }
    if (ch === "!" && s[i + 1] === "[") {
      const m = /^!\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/.exec(s.slice(i));
      if (m) {
        flush();
        const d = decodeDataUri(m[2]);
        if (d && /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(d.mime)) {
          out.push({ kind: "image", data: d.data, mime: d.mime, width: 0, height: 0 });
        } else {
          out.push({ kind: "text", text: `[image: ${m[1] || m[2].slice(0, 40)}]`, style: { ...st, italic: true, color: "6B7280" } });
        }
        i += m[0].length;
        continue;
      }
    }
    if (ch === "[") {
      const close = matchBracket(s, i);
      if (close > 0) {
        const m = /^\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/.exec(s.slice(close + 1));
        if (m) {
          flush();
          const href = m[1];
          parseInline(s.slice(i + 1, close), LINK_OK.test(href) ? { ...st, href } : st, ctx, out);
          i = close + 1 + m[0].length;
          continue;
        }
      }
    }
    if (ch === "<") {
      const m = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/.exec(s.slice(i));
      if (m) {
        flush();
        out.push({ kind: "text", text: m[1], style: { ...st, href: m[1] } });
        i += m[0].length;
        continue;
      }
      const tag = /^<\/?[a-zA-Z][^>]*>/.exec(s.slice(i));
      if (tag) {
        i += tag[0].length;
        continue;
      }
    }
    if (ch === "h" && (s.startsWith("http://", i) || s.startsWith("https://", i)) && !st.href) {
      const m = /^https?:\/\/[^\s<>]+[^\s<>.,;:!?)\]'"]/.exec(s.slice(i));
      if (m) {
        flush();
        out.push({ kind: "text", text: m[0], style: { ...st, href: m[0] } });
        i += m[0].length;
        continue;
      }
    }
    if ((ch === "*" || ch === "_" || ch === "~") && s[i + 1] === ch) {
      const delim = ch + ch;
      const end = findClose(s, i + 2, delim);
      if (end > 0 && (ch !== "_" || i === 0 || !/\w/.test(s[i - 1]))) {
        flush();
        parseInline(s.slice(i + 2, end), ch === "~" ? { ...st, strike: true } : { ...st, bold: true }, ctx, out);
        i = end + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && s[i + 1] !== " " && s[i + 1] !== undefined) {
      const intra = ch === "_" && i > 0 && /\w/.test(s[i - 1]);
      const end = intra ? -1 : findClose(s, i + 1, ch);
      if (end > 0) {
        flush();
        parseInline(s.slice(i + 1, end), { ...st, italic: true }, ctx, out);
        i = end + 1;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

function matchBracket(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === "[") depth++;
    else if (s[i] === "]" && --depth === 0) return i;
  }
  return -1;
}

/** Index of the closing delimiter (not preceded by a space, not part of a longer run), or -1. */
function findClose(s: string, from: number, delim: string): number {
  const c = delim[0];
  for (let i = from; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "`") {
      const e = s.indexOf("`", i + 1);
      if (e > 0) i = e;
      continue;
    }
    if (s.startsWith(delim, i) && s[i - 1] !== " " && i > from) {
      if (delim.length === 1 && (s[i + 1] === c || s[i - 1] === c)) {
        // skip over a **bold** run inside *italic*
        if (s[i + 1] === c) {
          const e = s.indexOf(delim + delim, i + 2);
          if (e > 0) {
            i = e + 1;
            continue;
          }
        }
        continue;
      }
      if (c === "_" && /\w/.test(s[i + delim.length] ?? "")) continue;
      return i;
    }
  }
  return -1;
}

function para(ctx: Ctx, text: string, over: Partial<Para> = {}, st: InlineStyle = base(ctx)): Para {
  const inlines = parseInline(text.replace(/( {2,}|\\)\n/g, BREAK).replace(/\n/g, " "), st, ctx);
  return { kind: "para", inlines, align: "left", heading: 0, indent: 0, ...over };
}

const isFence = (l: string) => /^\s{0,3}(`{3,}|~{3,})/.test(l);
const isHr = (l: string) => /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l);
const isHeading = (l: string) => /^\s{0,3}#{1,6}(\s|$)/.test(l);
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const isTableSep = (l: string) => /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(l) && l.includes("-") && (l.includes("|") || false);

function splitRow(l: string): string[] {
  let t = l.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (t[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
}

function startsBlock(l: string, next?: string): boolean {
  return (
    isFence(l) ||
    isHeading(l) ||
    isHr(l) ||
    /^\s{0,3}>/.test(l) ||
    LIST_RE.test(l) ||
    (l.includes("|") && next !== undefined && isTableSep(next))
  );
}

function parseBlocks(lines: string[], ctx: Ctx, quoted: boolean): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const mark = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s{0,3}${mark[0]}{${mark.length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(codeBlock(body, ctx));
      continue;
    }
    if (isHr(line)) {
      out.push({ kind: "para", inlines: [], align: "left", heading: 0, indent: 0, rule: true });
      i++;
      continue;
    }
    const h = /^\s{0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/.exec(line);
    if (h) {
      out.push(headingPara(ctx, h[1].length, h[2] ?? ""));
      i++;
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && (/^\s{0,3}>/.test(lines[i]) || (lines[i].trim() && inner.length && !startsBlock(lines[i])))) {
        inner.push(lines[i].replace(/^\s{0,3}> ?/, ""));
        i++;
      }
      for (const b of parseBlocks(inner, ctx, true)) {
        if (b.kind === "para") {
          b.indent += 18;
          b.bar = QUOTE_BAR;
          for (const inl of b.inlines) if (inl.kind === "text" && !inl.style.href && !inl.style.color) inl.style = { ...inl.style, color: "4B5563" };
        }
        out.push(b);
      }
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c): Align => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left"));
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|") && !startsBlock(lines[i])) body.push(splitRow(lines[i++]));
      out.push(tableBlock(ctx, head, aligns, body));
      continue;
    }
    const li = LIST_RE.exec(line);
    if (li && !isHr(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          // a blank line continues the list only when an indented or list line follows
          const nx = lines[i + 1];
          if (nx !== undefined && (LIST_RE.test(nx) || /^\s{2,}\S/.test(nx))) {
            items.push(l);
            i++;
            continue;
          }
          break;
        }
        if (LIST_RE.test(l) || /^\s{2,}\S/.test(l) || items.length === 0) {
          items.push(l);
          i++;
        } else if (!startsBlock(l)) {
          items.push(l); // lazy continuation
          i++;
        } else break;
      }
      out.push(...listBlocks(items, ctx, 0));
      continue;
    }
    // setext heading or paragraph
    const buf: string[] = [line];
    i++;
    let setext = 0;
    while (i < lines.length && lines[i].trim()) {
      if (/^\s{0,3}=+\s*$/.test(lines[i])) setext = 1;
      else if (/^\s{0,3}-+\s*$/.test(lines[i])) setext = 2;
      if (setext) {
        i++;
        break;
      }
      if (startsBlock(lines[i], lines[i + 1])) break;
      buf.push(lines[i++]);
    }
    const text = buf.map((l) => l.replace(/^\s+/, "")).join("\n").trim();
    if (setext) out.push(headingPara(ctx, setext, text.replace(/\n/g, " ")));
    else if (!/^<!--[\s\S]*-->$/.test(text)) {
      const p = para(ctx, text);
      if (p.inlines.some((x) => x.kind === "image" || (x.kind === "text" && /\S/.test(x.text)))) out.push(p);
    }
  }
  void quoted;
  return out;
}

function headingPara(ctx: Ctx, level: number, raw: string): Para {
  const size = ctx.opt.fontSize * HEADING_SCALE[level - 1];
  const id = ctx.nextId++;
  const plain = raw.replace(/[*_`~]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
  let number = "";
  if (ctx.opt.numberHeadings) {
    ctx.counters[level - 1] = (ctx.counters[level - 1] ?? 0) + 1;
    for (let k = level; k < 6; k++) ctx.counters[k] = 0;
    const parts = ctx.counters.slice(0, level).map((n) => n || 1);
    number = parts.slice(Math.max(0, ctx.minLevel - 1)).join(".") + (level === ctx.minLevel ? "." : "");
  }
  const p = para(ctx, raw, { heading: level, anchor: id, spacing: { before: level === 1 ? size * 0.9 : size * 0.8, after: level <= 2 ? size * 0.4 : size * 0.3 } }, base(ctx, { bold: true, size }));
  if (number) p.inlines.unshift({ kind: "text", text: `${number} `, style: base(ctx, { bold: true, size }) });
  ctx.headings.push({ id, level, text: plain, number });
  return p;
}

function codeBlock(body: string[], ctx: Ctx): Para {
  const size = Math.max(6, ctx.opt.fontSize * 0.82);
  const inlines: Inline[] = [];
  const st = base(ctx, { family: "mono", size, color: "1F2937" });
  body.forEach((l, k) => {
    if (k) inlines.push({ kind: "br" });
    if (l) inlines.push({ kind: "text", text: l, style: st });
  });
  if (!body.length) inlines.push({ kind: "text", text: " ", style: st });
  return {
    kind: "para",
    inlines,
    align: "left",
    heading: 0,
    indent: 10,
    pre: true,
    box: { bg: CODE_BG, border: { color: "D1D5DB", width: 0.5 } },
    base: { size, family: "mono" },
    spacing: { before: 6, after: 10 },
  };
}

interface Item {
  indent: number;
  ordered: boolean;
  start: number;
  lines: string[];
}

function listBlocks(raw: string[], ctx: Ctx, level: number): Block[] {
  const out: Block[] = [];
  const first = LIST_RE.exec(raw[0]);
  if (!first) return out;
  const baseIndent = first[1].replace(/\t/g, "    ").length;
  const items: Item[] = [];
  for (const l of raw) {
    const m = LIST_RE.exec(l);
    const ind = (m ? m[1] : l.match(/^\s*/)?.[0] ?? "").replace(/\t/g, "    ").length;
    if (m && ind <= baseIndent + 1) {
      items.push({ indent: ind, ordered: /\d/.test(m[2]), start: parseInt(m[2], 10) || 1, lines: [m[3]] });
    } else if (items.length) {
      items[items.length - 1].lines.push(l);
    }
  }
  let n = 0;
  let prevOrdered = false;
  for (const item of items) {
    n = item.ordered && prevOrdered ? n + 1 : item.start;
    prevOrdered = item.ordered;
    const label = item.ordered ? `${n}.` : level % 2 === 0 ? "•" : "–";
    let text: string[] = [];
    const nested: string[] = [];
    let inNested = false;
    let task = "";
    for (let k = 0; k < item.lines.length; k++) {
      const l = item.lines[k];
      const nl = LIST_RE.test(l) && k > 0;
      if (nl) inNested = true;
      if (inNested) nested.push(l);
      else if (l.trim() || text.length) text.push(k === 0 ? l : l.trim());
    }
    const t0 = /^\[( |x|X)\]\s+/.exec(text[0] ?? "");
    if (t0) {
      task = t0[1] === " " ? "[ ] " : "[x] ";
      text[0] = text[0].slice(t0[0].length);
    }
    text = text.filter((l, k) => l.trim() || k < text.length - 1);
    const paras = text.join("\n").split(/\n\s*\n/);
    paras.forEach((ptxt, k) => {
      if (!ptxt.trim() && k) return;
      const p = para(ctx, ptxt.trim(), { marker: { label: k === 0 ? label : "", level } });
      if (k === 0 && task) p.inlines.unshift({ kind: "text", text: task, style: base(ctx, { family: "mono" }) });
      if (p.inlines.length || k === 0) out.push(p);
    });
    if (nested.length) {
      // remove the shared indent of the nested block, then recurse
      const minInd = Math.min(...nested.filter((l) => l.trim()).map((l) => l.match(/^\s*/)?.[0].length ?? 0));
      const dedented = nested.map((l) => l.slice(Math.min(minInd, l.match(/^\s*/)?.[0].length ?? 0)));
      out.push(...parseBlocksInList(dedented, ctx, level + 1));
    }
  }
  return out;
}

function parseBlocksInList(lines: string[], ctx: Ctx, level: number): Block[] {
  const out: Block[] = [];
  let group: string[] = [];
  const flush = () => {
    if (group.some((l) => l.trim())) out.push(...listBlocks(group.filter((l) => l.trim()), ctx, level));
    group = [];
  };
  for (const l of lines) group.push(l);
  flush();
  return out;
}

function tableBlock(ctx: Ctx, head: string[], aligns: Align[], body: string[][]): TableBlock {
  const mk = (cells: string[], header: boolean): Row => ({
    header,
    cells: head.map((_, c) => ({
      header,
      colSpan: 1,
      rowSpan: 1,
      blocks: [para(ctx, cells[c] ?? "", { align: aligns[c] ?? "left" }, base(ctx, { size: ctx.opt.fontSize * 0.95 }))],
    })),
  });
  return { kind: "table", rows: [mk(head, true), ...body.map((r) => mk(r, false))] };
}

export interface MarkdownDoc {
  blocks: Block[];
  /** Page numbers for the table of contents come from laid-out pages. */
  refine?: (pages: { cmds: { t: string; id?: number }[] }[]) => boolean;
}

export function markdownToDoc(source: string, options: Partial<MarkdownOptions> = {}): MarkdownDoc {
  const opt = { ...MD_DEFAULTS, ...options };
  const ctx: Ctx = { opt, family: opt.font, nextId: 1, headings: [], counters: [], minLevel: 1 };
  const lines = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "").split("\n");
  // numbering starts at the shallowest heading level used
  const levels = lines.filter((l) => !isFence(l) && isHeading(l)).map((l) => /^\s{0,3}(#+)/.exec(l)?.[1].length ?? 6);
  ctx.minLevel = levels.length ? Math.min(...levels) : 1;
  const blocks = parseBlocks(lines, ctx, false);
  if (!opt.toc || ctx.headings.length === 0) return { blocks };

  const entries = ctx.headings.filter((h) => h.level <= ctx.minLevel + 2);
  const size = opt.fontSize;
  const pageCells: { id: number; inline: Extract<Inline, { kind: "text" }> }[] = [];
  const rows: Row[] = entries.map((h) => {
    const label: Inline = {
      kind: "text",
      text: (h.number ? `${h.number} ` : "") + h.text,
      style: base(ctx, { size, bold: h.level === ctx.minLevel }),
    };
    const pg: Extract<Inline, { kind: "text" }> = { kind: "text", text: "0", style: base(ctx, { size }) };
    pageCells.push({ id: h.id, inline: pg });
    const cell = (inl: Inline, align: Align, indent: number) => ({
      header: false,
      colSpan: 1,
      rowSpan: 1,
      blocks: [{ kind: "para" as const, inlines: [inl], align, heading: 0, indent }],
    });
    return { header: false, cells: [cell(label, "left", Math.max(0, h.level - ctx.minLevel) * 14), cell(pg, "right", 0)] };
  });
  const toc: Block[] = [
    para(ctx, "Contents", { heading: 2, spacing: { before: 4, after: 6 } }, base(ctx, { bold: true, size: size * HEADING_SCALE[1] })),
    { kind: "table", rows, info: { grid: [1000, 40], widthPct: 100, borders: null, fills: [] } },
    { kind: "pagebreak" },
  ];
  const at = blocks[0] && blocks[0].kind === "para" && blocks[0].heading === ctx.minLevel && blocks[0].heading === 1 ? 1 : 0;
  blocks.splice(at, 0, ...toc);
  const refine: MarkdownDoc["refine"] = (pages) => {
    let changed = false;
    const where = new Map<number, number>();
    pages.forEach((p, i) => p.cmds.forEach((c) => c.t === "anchor" && c.id !== undefined && !where.has(c.id) && where.set(c.id, i + 1)));
    for (const { id, inline } of pageCells) {
      const t = String(where.get(id) ?? 0);
      if (inline.text !== t) {
        inline.text = t;
        changed = true;
      }
    }
    return changed;
  };
  return { blocks, refine };
}

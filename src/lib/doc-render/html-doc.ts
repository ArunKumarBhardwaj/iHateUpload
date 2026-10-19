/**
 * HTML -> blocks. Reads the markup with the dependency-free parser, applies the CSS a printed page
 * needs (inline style and <style> rules: colour, background, borders, font, size, alignment, margins)
 * and never runs scripts or fetches anything.
 */
import { parseHtml, type HNode } from "../word-to-pdf/html";
import { listLabel, type Align, type Block, type Cell, type Family, type Inline, type InlineStyle, type Para, type Row, type TableBlock } from "../word-to-pdf/model";

type El = Extract<HNode, { tag: string }>;
const isEl = (n: HNode): n is El => "tag" in n;

export interface HtmlDoc {
  blocks: Block[];
  title?: string;
}

// ---- CSS -------------------------------------------------------------------------------------

const NAMED_COLORS: Record<string, string> = {
  black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00",
  orange: "FFA500", purple: "800080", gray: "808080", grey: "808080", silver: "C0C0C0", maroon: "800000",
  navy: "000080", teal: "008080", lime: "00FF00", aqua: "00FFFF", cyan: "00FFFF", fuchsia: "FF00FF",
  magenta: "FF00FF", olive: "808000", brown: "A52A2A", pink: "FFC0CB", gold: "FFD700", crimson: "DC143C",
  darkblue: "00008B", darkgreen: "006400", darkred: "8B0000", lightgray: "D3D3D3", lightgrey: "D3D3D3",
  lightblue: "ADD8E6", lightgreen: "90EE90", whitesmoke: "F5F5F5", gainsboro: "DCDCDC", dimgray: "696969",
  tomato: "FF6347", coral: "FF7F50", indigo: "4B0082", violet: "EE82EE", salmon: "FA8072", khaki: "F0E68C",
  beige: "F5F5DC", ivory: "FFFFF0", lavender: "E6E6FA", skyblue: "87CEEB", steelblue: "4682B4",
  royalblue: "4169E1", slategray: "708090", darkgray: "A9A9A9", darkgrey: "A9A9A9",
};

export function parseColor(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return m[1].split("").map((c) => c + c).join("").toUpperCase();
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(s);
  if (m) return m[1].toUpperCase();
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return undefined;
    return [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  return NAMED_COLORS[s];
}

const KEYWORD_SIZE: Record<string, number> = {
  "xx-small": 7, "x-small": 7.5, small: 10, medium: 12, large: 14, "x-large": 18, "xx-large": 24,
};

/** A CSS length in points. `em` is relative to `parent` points. */
export function parseLength(v: string | undefined, parent: number): number | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  if (KEYWORD_SIZE[s]) return KEYWORD_SIZE[s];
  if (s === "smaller") return parent * 0.83;
  if (s === "larger") return parent * 1.2;
  const m = /^(-?[\d.]+)(px|pt|em|rem|%|cm|mm|in|pc)?$/.exec(s);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case "px":
    case undefined:
      return n * 0.75;
    case "pt":
      return n;
    case "em":
      return n * parent;
    case "rem":
      return n * 12;
    case "%":
      return (n / 100) * parent;
    case "cm":
      return n * 28.35;
    case "mm":
      return n * 2.835;
    case "in":
      return n * 72;
    case "pc":
      return n * 12;
  }
  return undefined;
}

type Decls = Record<string, string>;

function parseDecls(src: string): Decls {
  const out: Decls = {};
  for (const part of src.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).replace(/!important/i, "").trim();
    if (k && v) out[k] = v;
  }
  return out;
}

interface Rule {
  sel: string[][];
  spec: number;
  order: number;
  decls: Decls;
}

interface Compound {
  tag?: string;
  id?: string;
  classes: string[];
}

function compound(s: string): Compound | null {
  const m = /^([a-z0-9*-]*)((?:[.#][\w-]+)*)$/i.exec(s);
  if (!m) return null;
  const c: Compound = { classes: [] };
  if (m[1] && m[1] !== "*") c.tag = m[1].toLowerCase();
  for (const part of m[2].match(/[.#][\w-]+/g) ?? []) {
    if (part[0] === "#") c.id = part.slice(1);
    else c.classes.push(part.slice(1));
  }
  return c;
}

function parseStylesheet(css: string): Rule[] {
  const rules: Rule[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@[a-z-]+[^{;]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi, "").replace(/@[^;{]+;/g, "");
  let order = 0;
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = parseDecls(m[2]);
    for (const raw of m[1].split(",")) {
      const parts = raw.trim().replace(/\s*>\s*/g, " ").split(/\s+/).filter(Boolean);
      const sel = parts.map((p) => compound(p));
      if (!sel.length || sel.some((c) => !c)) continue; // pseudo-classes, attributes: unsupported, skipped
      const comps = sel as Compound[];
      const spec = comps.reduce((n, c) => n + (c.id ? 100 : 0) + c.classes.length * 10 + (c.tag ? 1 : 0), 0);
      rules.push({ sel: [comps as never], spec, order: order++, decls });
    }
  }
  return rules.sort((a, b) => a.spec - b.spec || a.order - b.order);
}

function matches(c: Compound, el: El): boolean {
  if (c.tag && c.tag !== el.tag) return false;
  if (c.id && el.attrs.id !== c.id) return false;
  if (c.classes.length) {
    const have = (el.attrs.class ?? "").split(/\s+/);
    if (!c.classes.every((k) => have.includes(k))) return false;
  }
  return true;
}

// ---- inherited / computed style --------------------------------------------------------------

interface Inherit {
  size: number;
  color?: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  family: Family;
  align: Align;
  upper: boolean;
  lower: boolean;
  listType?: string;
}

interface Box {
  bg?: string;
  border?: { color: string; width: number };
  bar?: string;
  /** only a rule under the text, from border-bottom alone */
  bottomOnly?: boolean;
}

interface Walk {
  rules: Rule[];
  path: El[];
}

const UA: Record<string, Decls> = {
  h1: { "font-size": "2em", "font-weight": "bold" },
  h2: { "font-size": "1.5em", "font-weight": "bold" },
  h3: { "font-size": "1.17em", "font-weight": "bold" },
  h4: { "font-weight": "bold" },
  h5: { "font-size": "0.83em", "font-weight": "bold" },
  h6: { "font-size": "0.67em", "font-weight": "bold" },
  b: { "font-weight": "bold" },
  strong: { "font-weight": "bold" },
  th: { "font-weight": "bold", "text-align": "center" },
  i: { "font-style": "italic" },
  em: { "font-style": "italic" },
  cite: { "font-style": "italic" },
  u: { "text-decoration": "underline" },
  ins: { "text-decoration": "underline" },
  s: { "text-decoration": "line-through" },
  del: { "text-decoration": "line-through" },
  strike: { "text-decoration": "line-through" },
  small: { "font-size": "0.83em" },
  big: { "font-size": "1.2em" },
  code: { "font-family": "monospace" },
  tt: { "font-family": "monospace" },
  kbd: { "font-family": "monospace" },
  samp: { "font-family": "monospace" },
  pre: { "font-family": "monospace" },
  a: { "text-decoration": "underline" },
};

function computed(el: El, w: Walk): Decls {
  const d: Decls = { ...UA[el.tag] };
  // presentational attributes
  if (el.attrs.align) d["text-align"] = el.attrs.align;
  if (el.attrs.bgcolor) d["background-color"] = el.attrs.bgcolor;
  if (el.attrs.color && el.tag === "font") d.color = el.attrs.color;
  if (el.attrs.size && el.tag === "font") {
    const n = Number(el.attrs.size);
    d["font-size"] = ["", "x-small", "small", "medium", "large", "x-large", "xx-large"][Math.min(6, Math.max(1, n || 3))] ?? "medium";
  }
  const chain = [...w.path, el];
  for (const r of w.rules) {
    const comps = r.sel[0] as unknown as Compound[];
    if (!matches(comps[comps.length - 1], el)) continue;
    // remaining compounds must match ancestors in order
    let ai = chain.length - 2;
    let ok = true;
    for (let k = comps.length - 2; k >= 0 && ok; k--) {
      while (ai >= 0 && !matches(comps[k], chain[ai])) ai--;
      if (ai < 0) ok = false;
      else ai--;
    }
    if (ok) Object.assign(d, r.decls);
  }
  if (el.attrs.style) Object.assign(d, parseDecls(el.attrs.style));
  return d;
}

function familyOf(v: string, fallback: Family): Family {
  const s = v.toLowerCase();
  const first = s.split(",")[0].replace(/["']/g, "").trim();
  if (/mono|courier|consolas|menlo|monaco|code/.test(s.split(",").slice(0, 2).join(","))) return "mono";
  if (/georgia|times|garamond|palatino|cambria|serif/.test(first) && !/sans/.test(first)) return "serif";
  if (/arial|helvetica|verdana|tahoma|calibri|sans|system|segoe|roboto|inter/.test(first)) return "sans";
  return /\bserif\b/.test(s) && !/sans-serif/.test(s) ? "serif" : fallback;
}

function inherit(d: Decls, p: Inherit): Inherit {
  const out = { ...p };
  const size = parseLength(d["font-size"], p.size);
  if (size) out.size = Math.max(4, Math.min(96, size));
  const font = d.font; // shorthand: only pick up a size and family we can recognise
  if (font) {
    const m = /(?:^|\s)([\d.]+(?:px|pt|em|rem))(?:\/[\d.a-z]+)?\s+(.+)$/i.exec(font);
    if (m) {
      const s = parseLength(m[1], p.size);
      if (s) out.size = s;
      out.family = familyOf(m[2], p.family);
    }
    if (/\bbold\b|\b[6-9]00\b/.test(font)) out.bold = true;
    if (/\bitalic\b/.test(font)) out.italic = true;
  }
  const c = parseColor(d.color);
  if (c) out.color = c;
  const fw = d["font-weight"];
  if (fw) out.bold = /^(bold|bolder|[6-9]00)$/.test(fw.toLowerCase());
  const fs = d["font-style"];
  if (fs) out.italic = /italic|oblique/.test(fs);
  const td = d["text-decoration"] ?? d["text-decoration-line"];
  if (td) {
    out.underline = /underline/.test(td);
    out.strike = /line-through/.test(td);
  }
  if (d["font-family"]) out.family = familyOf(d["font-family"], p.family);
  const ta = d["text-align"]?.toLowerCase();
  if (ta === "left" || ta === "right" || ta === "center" || ta === "justify") out.align = ta;
  const tt = d["text-transform"];
  if (tt) {
    out.upper = tt === "uppercase";
    out.lower = tt === "lowercase";
  }
  const lt = d["list-style-type"] ?? (d["list-style"] ? d["list-style"].split(/\s+/)[0] : undefined);
  if (lt) out.listType = lt;
  return out;
}

function parseBorder(v: string | undefined): { color: string; width: number } | undefined {
  if (!v || /^(none|0|hidden)/.test(v.trim())) return undefined;
  if (/\b(none|hidden)\b/.test(v)) return undefined;
  const w = /([\d.]+)(px|pt)/.exec(v);
  const color = parseColor(v.split(/\s+/).find((t) => parseColor(t) !== undefined)) ?? "7F7F7F";
  return { color, width: w ? Math.max(0.25, parseLength(w[0], 12) ?? 0.75) : 0.75 };
}

function boxOf(d: Decls, parent: Box | undefined): Box | undefined {
  const bg = parseColor(d["background-color"] ?? (d.background ? d.background.split(/\s+/).find((t) => parseColor(t)) : undefined));
  const all = parseBorder(d.border);
  const left = parseBorder(d["border-left"]);
  const sided = !!(d["border-top"] || d["border-bottom"] || d["border-right"]);
  const top = parseBorder(d["border-top"]) ?? parseBorder(d["border-bottom"]);
  if (!bg && !all && !left && !top && !sided) return parent;
  const bottomOnly = !all && !left && !d["border-top"] && !d["border-right"] && !!d["border-bottom"];
  return {
    bg: bg ?? parent?.bg,
    border: all ?? top ?? parent?.border,
    bar: !all && left ? left.color : parent?.bar,
    bottomOnly: bottomOnly || undefined,
  };
}

// ---- walker ----------------------------------------------------------------------------------

const SKIP = new Set(["head", "script", "style", "noscript", "template", "title", "meta", "link", "svg", "canvas", "iframe", "object", "embed", "select", "textarea", "button", "input", "form-hidden"]);
const BLOCKISH = new Set(["p", "div", "section", "article", "aside", "header", "footer", "main", "nav", "address", "figure", "figcaption", "details", "summary", "fieldset", "form", "dl", "dt", "dd", "center", "ul", "ol", "li", "table", "pre", "blockquote", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "body", "html"]);

function decodeData(src: string): { data: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(src.trim());
  if (!m || !m[2]) return null;
  try {
    const bin = atob(m[3].replace(/\s+/g, ""));
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    return { data, mime: m[1] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

const LINK_OK = /^(https?:|mailto:|tel:)/i;

class Converter {
  out: Block[] = [];
  constructor(private rules: Rule[]) {}

  style(i: Inherit, extra?: Partial<InlineStyle>): InlineStyle {
    return {
      bold: i.bold,
      italic: i.italic,
      underline: i.underline,
      strike: i.strike,
      color: i.color,
      size: i.size,
      family: i.family,
      ...extra,
    };
  }

  /** Collect inline content of `nodes` into runs. Nested block elements are returned for the caller to emit. */
  inlines(nodes: HNode[], inh: Inherit, path: El[], href?: string, into: Inline[] = []): Inline[] {
    for (const n of nodes) {
      if (!isEl(n)) {
        let t = n.text;
        if (inh.upper) t = t.toUpperCase();
        else if (inh.lower) t = t.toLowerCase();
        if (t) into.push({ kind: "text", text: t, style: this.style(inh, href ? { href } : undefined) });
        continue;
      }
      if (SKIP.has(n.tag)) continue;
      const d = computed(n, { rules: this.rules, path });
      if (/^none$/i.test(d.display ?? "")) continue;
      if (n.tag === "br") {
        into.push({ kind: "br" });
        continue;
      }
      if (n.tag === "img") {
        const src = n.attrs.src ?? "";
        const img = decodeData(src);
        if (img && /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(img.mime)) {
          const w = parseLength(n.attrs.width ?? d.width, 12);
          const h = parseLength(n.attrs.height ?? d.height, 12);
          into.push({ kind: "image", data: img.data, mime: img.mime, width: w && h ? w : 0, height: w && h ? h : 0 });
        } else if (n.attrs.alt) {
          into.push({ kind: "text", text: `[image: ${n.attrs.alt}]`, style: this.style(inh, { italic: true, color: "6B7280" }) });
        }
        continue;
      }
      let child = inherit(d, inh);
      if (n.tag === "a" && !d.color) child = { ...child, color: undefined };
      let h = href;
      if (n.tag === "a" && LINK_OK.test(n.attrs.href ?? "")) h = n.attrs.href;
      const extra: Partial<InlineStyle> = {};
      if (n.tag === "sup") extra.script = "sup";
      if (n.tag === "sub") extra.script = "sub";
      const before = into.length;
      this.inlines(n.children, child, [...path, n], h, into);
      if (extra.script) for (let k = before; k < into.length; k++) {
        const r = into[k];
        if (r.kind === "text") r.style = { ...r.style, ...extra };
      }
    }
    return into;
  }

  para(inl: Inline[], inh: Inherit, d: Decls, box: Box | undefined, over: Partial<Para> = {}): Para | null {
    while (inl[0]?.kind === "br") inl.shift();
    while (inl[inl.length - 1]?.kind === "br") inl.pop();
    if (!inl.some((i) => i.kind === "image" || (i.kind === "text" && /\S/.test(i.text)))) return null;
    const p: Para = { kind: "para", inlines: inl, align: inh.align, heading: 0, indent: 0, ...over };
    const mt = parseLength(d["margin-top"] ?? d.margin?.split(/\s+/)[0], inh.size);
    const mb = parseLength(d["margin-bottom"] ?? (d.margin ? d.margin.split(/\s+/)[d.margin.split(/\s+/).length > 2 ? 2 : 0] : undefined), inh.size);
    if (mt !== undefined || mb !== undefined) p.spacing = { ...p.spacing, ...(mt !== undefined ? { before: Math.max(0, mt) } : {}), ...(mb !== undefined ? { after: Math.max(0, mb) } : {}) };
    const ml = parseLength(d["margin-left"] ?? d["padding-left"], inh.size);
    if (ml && ml > 0) p.indent += Math.min(ml, 200);
    if (box?.bar) {
      p.bar = box.bar;
      p.indent += 12;
    }
    if (box && (box.bg || box.border)) {
      p.box = { bg: box.bg, border: box.border, bottomOnly: box.bottomOnly };
      p.indent += 6;
    }
    return p;
  }

  blocks(nodes: HNode[], inh: Inherit, path: El[], box: Box | undefined, level = 0): Block[] {
    const out: Block[] = [];
    let run: HNode[] = [];
    const flush = () => {
      if (!run.length) return;
      const p = this.para(this.inlines(run, inh, path), inh, {}, box);
      if (p) out.push(p);
      run = [];
    };
    for (const n of nodes) {
      if (!isEl(n)) {
        run.push(n);
        continue;
      }
      if (SKIP.has(n.tag)) continue;
      if (!BLOCKISH.has(n.tag)) {
        const d = computed(n, { rules: this.rules, path });
        if (/^block$/i.test(d.display ?? "")) {
          flush();
          out.push(...this.element(n, inh, path, box, level));
        } else run.push(n);
        continue;
      }
      flush();
      out.push(...this.element(n, inh, path, box, level));
    }
    flush();
    return out;
  }

  element(n: El, parent: Inherit, path: El[], parentBox: Box | undefined, level: number): Block[] {
    const d = computed(n, { rules: this.rules, path });
    if (/^none$/i.test(d.display ?? "")) return [];
    const inh = inherit(d, parent);
    const box = n.tag === "table" ? parentBox : boxOf(d, parentBox);
    const here = [...path, n];
    const pageBreak = /always|page/.test(d["page-break-before"] ?? d["break-before"] ?? "");
    const lead: Block[] = pageBreak ? [{ kind: "pagebreak" }] : [];
    const heading = /^h([1-6])$/.exec(n.tag);
    if (heading) {
      const p = this.para(this.inlines(n.children, inh, here), inh, d, box, { heading: Number(heading[1]) });
      return p ? [...lead, p] : lead;
    }
    switch (n.tag) {
      case "hr":
        return [...lead, { kind: "para", inlines: [], align: "left", heading: 0, indent: 0, rule: true }];
      case "pre": {
        const text = n.children.map(textOf).join("").replace(/^\n/, "").replace(/\s+$/, "");
        const size = Math.min(inh.size, 10);
        const inlines: Inline[] = [];
        text.split("\n").forEach((line, i) => {
          if (i) inlines.push({ kind: "br" });
          if (line) inlines.push({ kind: "text", text: line, style: this.style({ ...inh, family: "mono", size }) });
        });
        if (!inlines.length) return lead;
        return [
          ...lead,
          {
            kind: "para",
            inlines,
            align: "left",
            heading: 0,
            indent: 10,
            pre: true,
            box: { bg: box?.bg ?? "F3F4F6", border: box?.border ?? { color: "D1D5DB", width: 0.5 } },
            spacing: { before: 6, after: 10 },
          },
        ];
      }
      case "ul":
      case "ol":
        return [...lead, ...this.list(n, inh, here, box, level)];
      case "table":
        return [...lead, ...this.table(n, inh, here, d)];
      case "blockquote": {
        const bq = { ...box, bar: box?.bar ?? "BFC5CC" };
        return [...lead, ...this.blocks(n.children, { ...inh, color: inh.color ?? "4B5563" }, here, bq, level)];
      }
      case "dt":
        return [...lead, ...this.blocks(n.children, { ...inh, bold: true }, here, box, level)];
      case "dd": {
        const bs = this.blocks(n.children, inh, here, box, level);
        for (const b of bs) if (b.kind === "para") b.indent += 24;
        return [...lead, ...bs];
      }
      case "li":
        return [...lead, ...this.blocks(n.children, inh, here, box, level)];
      case "p": {
        const bs = this.blocksFromP(n, inh, here, d, box);
        return [...lead, ...bs];
      }
      default: {
        // containers: keep the box/background for every paragraph inside
        const bs = this.blocks(n.children, inh, here, box, level);
        const mt = parseLength(d["margin-top"], inh.size);
        const mb = parseLength(d["margin-bottom"], inh.size);
        const first = bs.find((b): b is Para => b.kind === "para");
        const last = [...bs].reverse().find((b): b is Para => b.kind === "para");
        if (first && mt !== undefined) first.spacing = { ...first.spacing, before: Math.max(first.spacing?.before ?? 0, mt) };
        if (last && mb !== undefined) last.spacing = { ...last.spacing, after: Math.max(last.spacing?.after ?? 0, mb) };
        return [...lead, ...bs];
      }
    }
  }

  blocksFromP(n: El, inh: Inherit, path: El[], d: Decls, box: Box | undefined): Block[] {
    const p = this.para(this.inlines(n.children, inh, path), inh, d, box);
    return p ? [p] : [];
  }

  list(n: El, inh: Inherit, path: El[], box: Box | undefined, level: number): Block[] {
    const ordered = n.tag === "ol";
    const start = Number(n.attrs.start);
    let count = Number.isFinite(start) && n.attrs.start !== undefined ? start : 1;
    const out: Block[] = [];
    for (const li of n.children) {
      if (!isEl(li) || li.tag !== "li") continue;
      const d = computed(li, { rules: this.rules, path });
      if (/^none$/i.test(d.display ?? "")) continue;
      const lin = inherit(d, inh);
      const lt = (lin.listType ?? "").toLowerCase();
      const value = Number(li.attrs.value);
      if (Number.isFinite(value) && li.attrs.value) count = value;
      const label =
        lt === "none"
          ? ""
          : ordered || /decimal|alpha|roman/.test(lt)
            ? /lower-alpha|lower-latin/.test(lt)
              ? `${String.fromCharCode(96 + ((count - 1) % 26) + 1)}.`
              : /upper-alpha|upper-latin/.test(lt)
                ? `${String.fromCharCode(64 + ((count - 1) % 26) + 1)}.`
                : /lower-roman/.test(lt)
                  ? `${listLabel(true, 2, count)}`
                  : /upper-roman/.test(lt)
                    ? `${listLabel(true, 2, count).toUpperCase()}`
                    : `${count}.`
            : lt === "circle" || lt === "square" ? "–" : listLabel(false, level, count);
      count++;
      const here = [...path, li];
      const kids = this.blocks(li.children, lin, here, boxOf(d, box), level + 1);
      let placed = false;
      for (const b of kids) {
        if (b.kind === "para") {
          if (!b.marker) b.marker = { label: placed ? "" : label, level };
          placed = true;
        }
        out.push(b);
      }
      if (!placed && label) {
        // empty item still consumes its number
      }
    }
    return out;
  }

  table(t: El, inh: Inherit, path: El[], d: Decls): Block[] {
    const rows: Row[] = [];
    const attrBorder = Number(t.attrs.border) > 0;
    const tableBorder = parseBorder(d.border) ?? (attrBorder ? { color: "7F7F7F", width: Math.min(2, Number(t.attrs.border) * 0.75) } : undefined);
    let cellBorder: { color: string; width: number } | undefined;
    const weights: number[] = [];
    const visit = (nodes: HNode[], head: boolean, p: El[]) => {
      for (const n of nodes) {
        if (!isEl(n)) continue;
        if (n.tag === "thead") visit(n.children, true, [...p, n]);
        else if (n.tag === "tbody" || n.tag === "tfoot") visit(n.children, head, [...p, n]);
        else if (n.tag === "tr") {
          const trd = computed(n, { rules: this.rules, path: p });
          const trInh = inherit(trd, inh);
          const trBox = boxOf(trd, undefined);
          const cells: Cell[] = [];
          let col = 0;
          for (const c of n.children) {
            if (!isEl(c) || (c.tag !== "td" && c.tag !== "th")) continue;
            const cd = computed(c, { rules: this.rules, path: [...p, n] });
            const cInh = inherit(cd, trInh);
            const cBox = boxOf(cd, trBox);
            cellBorder ??= parseBorder(cd.border);
            const span = (k: string) => Math.max(1, Math.min(50, parseInt(c.attrs[k] ?? "1", 10) || 1));
            const blocks = this.blocks(c.children, cInh, [...p, n, c], undefined);
            const len = Math.max(0, ...blocks.map((b) => (b.kind === "para" ? Math.max(...b.inlines.map((i) => (i.kind === "text" ? Math.min(i.text.length, 60) : 12)), 0) : 10)));
            if (span("colspan") === 1) weights[col] = Math.max(weights[col] ?? 0, len);
            const align = c.attrs.align ? undefined : undefined;
            void align;
            cells.push({ blocks: blocks.length ? blocks : [{ kind: "para", inlines: [], align: cInh.align, heading: 0, indent: 0 }], colSpan: span("colspan"), rowSpan: span("rowspan"), header: c.tag === "th" || head, fill: cBox?.bg });
            col += span("colspan");
          }
          if (cells.length) rows.push({ header: head, cells });
        } else if (n.tag === "caption") {
          // captions print as a paragraph before the table
          const p0 = this.para(this.inlines(n.children, { ...inh, bold: true }, p), { ...inh, bold: true, align: "center" }, {}, undefined);
          if (p0) this.out.push(p0);
        }
      }
    };
    this.out = [];
    visit(t.children, false, path);
    const lead = this.out;
    this.out = [];
    if (!rows.length) return lead;
    const cols = Math.max(1, ...rows.map((r) => r.cells.reduce((s, c) => s + c.colSpan, 0)));
    const grid = Array.from({ length: cols }, (_, i) => Math.max(4, Math.min(50, weights[i] ?? 6)) * inh.size * 0.62 + 16);
    const border = tableBorder ?? cellBorder ?? null;
    const widthCss = d.width ?? t.attrs.width;
    const pct = widthCss && /%$/.test(widthCss) ? parseFloat(widthCss) : undefined;
    const pt = widthCss && !pct ? parseLength(widthCss, 12) : undefined;
    const block: TableBlock = {
      kind: "table",
      rows,
      info: { grid, widthPct: pct, widthPt: pt ?? grid.reduce((a, b) => a + b, 0), borders: border, fills: [] },
    };
    // a header row only repeats across pages when the file says so with <thead>
    return [...lead, block];
  }
}

function textOf(n: HNode): string {
  return isEl(n) ? n.children.map(textOf).join("") : n.text;
}

function collect(nodes: HNode[], tag: string, out: El[] = []): El[] {
  for (const n of nodes) {
    if (!isEl(n)) continue;
    if (n.tag === tag) out.push(n);
    else collect(n.children, tag, out);
  }
  return out;
}

export async function htmlToDoc(html: string): Promise<HtmlDoc> {
  // the parser has no raw-text mode, so lift <style>/<script> bodies out first
  const styles: string[] = [];
  const cleaned = html
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_, css: string) => {
      styles.push(css);
      return "";
    })
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<!doctype[^>]*>/gi, "");
  const tree = parseHtml(cleaned);
  const title = collect(tree, "title")[0];
  const body = collect(tree, "body")[0];
  const root = body ? body.children : tree;
  const rules = parseStylesheet(styles.join("\n"));
  const conv = new Converter(rules);
  const base: Inherit = { size: 12, bold: false, italic: false, underline: false, strike: false, family: "sans", align: "left", upper: false, lower: false };
  let start = base;
  let bodyBox: Box | undefined;
  const bodyPath: El[] = [];
  if (body) {
    const d = computed(body, { rules, path: [] });
    start = inherit(d, base);
    bodyBox = undefined;
    bodyPath.push(body);
  }
  const blocks = conv.blocks(root, start, bodyPath, bodyBox);
  return { blocks, title: title ? textOf(title).trim() : undefined };
}

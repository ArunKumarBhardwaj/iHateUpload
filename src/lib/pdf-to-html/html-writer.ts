/**
 * Writes the shared document model (the one PDF to Word and PDF to PowerPoint
 * use) as HTML. Three shapes:
 *  - reflow: semantic tags (h1-h6, p, ul/ol, table, img, a) in a readable page;
 *  - exact: one positioned page per PDF page, text, tables, pictures and shapes
 *    pinned where they were;
 *  - picture: the page as an image with an invisible, selectable text layer.
 *
 * Nothing from the PDF is trusted: every string goes through esc(), colours
 * and font names are whitelisted, and only http, https, mailto and tel links
 * are written.
 */
import type {
  Block,
  DocModel,
  ExactItem,
  ExactPage,
  ImageBlock,
  MediaFile,
  ParagraphBlock,
  Run,
  Shape,
  TableBlock,
} from "@/lib/pdf-to-word/model";
import { splitAtTabs } from "@/lib/pdf-to-pptx/pptx-writer";

/** What the writer needs from outside: the page's name and how a picture is referred to. */
export type HtmlEnv = {
  name: string;
  /** The src for a picture, or null to leave it out. */
  img: (ref: string) => string | null;
};

const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function esc(text: string): string {
  return text
    .replace(CTRL, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const hexColor = (c?: string) => (c && /^[0-9a-fA-F]{6}$/.test(c) ? `#${c.toLowerCase()}` : undefined);

/** Two decimals at most, no trailing zeros. */
const n = (value: number) => String(Math.round(value * 100) / 100);

function safeUrl(url: string): string | undefined {
  const clean = url.trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(clean) ? clean : undefined;
}

export const anchorId = (name: string) => `a-${name.replace(/[^A-Za-z0-9_-]/g, "_")}`;

function fontStack(font?: string): string | undefined {
  if (!font) return undefined;
  const name = font.replace(/[^\p{L}\p{N} _-]/gu, "").trim();
  if (!name) return undefined;
  const generic = /mono|courier|consolas/i.test(name) ? "monospace" : /times|serif|georgia|garamond|palatino|cambria|book/i.test(name) && !/sans/i.test(name) ? "serif" : "sans-serif";
  return `'${name}',${generic}`;
}

// ---- language and direction --------------------------------------------------

const RTL_CHAR = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/;
const LTR_LETTER = /[A-Za-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

export function isRtl(text: string): boolean {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return true;
    if (LTR_LETTER.test(ch)) return false;
  }
  return false;
}

function scriptLang(text: string): string | undefined {
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[\u3400-\u9fff]/.test(text)) return "zh";
  if (/[\u0590-\u05ff]/.test(text)) return "he";
  if (/[\u0600-\u06ff\u0750-\u077f]/.test(text)) return "ar";
  if (/[\u0900-\u097f]/.test(text)) return "hi";
  if (/[\u0e00-\u0e7f]/.test(text)) return "th";
  if (/[\u0400-\u04ff]/.test(text)) return "ru";
  if (/[\u0370-\u03ff]/.test(text)) return "el";
  return undefined;
}

const plain = (runs: Run[]) => runs.map((r) => (r.tab ? " " : r.text)).join("");

function paragraphLang(p: ParagraphBlock): string | undefined {
  const tagged = p.runs.find((r) => r.lang && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(r.lang))?.lang;
  return tagged ?? scriptLang(plain(p.runs));
}

function documentLang(paragraphs: ParagraphBlock[]): { lang: string; dir: "ltr" | "rtl" } {
  const counts = new Map<string, number>();
  let rtl = 0;
  let total = 0;
  for (const p of paragraphs) {
    const text = plain(p.runs);
    if (!/\p{L}/u.test(text)) continue;
    total++;
    if (isRtl(text)) rtl++;
    const lang = paragraphLang(p) ?? "en";
    counts.set(lang, (counts.get(lang) ?? 0) + text.length);
  }
  const lang = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "en";
  return { lang, dir: total > 0 && rtl * 2 > total ? "rtl" : "ltr" };
}

// ---- inline content ----------------------------------------------------------

type InlineOptions = {
  /** Exact and picture modes carry the PDF's own size and font on every run. */
  exact: boolean;
  anchors: Map<string, string>;
  /** The page's own language; a paragraph in another one says so. */
  docLang?: string;
  /** Headings and table headers are bold already. */
  noBold?: boolean;
};

function runStyle(run: Run, exact: boolean): string {
  const css: string[] = [];
  if (exact) {
    if (run.size) css.push(`font-size:${n(run.size)}pt`);
    const stack = fontStack(run.font);
    if (stack) css.push(`font-family:${stack}`);
    if (run.bold) css.push("font-weight:700");
    if (run.italic) css.push("font-style:italic");
    const deco = [run.underline ? "underline" : "", run.strike ? "line-through" : ""].filter(Boolean).join(" ");
    if (deco) css.push(`text-decoration:${deco}`);
    const hl = hexColor(run.highlight);
    if (hl) css.push(`background:${hl}`);
    if (run.vertAlign) css.push(`vertical-align:${run.vertAlign === "superscript" ? "super" : "sub"}`, "font-size:.7em");
  }
  const color = hexColor(run.color);
  if (color && (exact || color !== "#000000")) css.push(`color:${color}`);
  return css.join(";");
}

function inline(runs: Run[], opts: InlineOptions): string {
  let out = "";
  for (const run of runs) {
    if (run.field) continue;
    if (run.tab) {
      out += "&emsp;";
      continue;
    }
    if (!run.text) continue;
    let html = esc(run.text);
    if (opts.exact) {
      const style = runStyle(run, true);
      if (style) html = `<span style="${style}">${html}</span>`;
    } else {
      if (run.vertAlign === "subscript") html = `<sub>${html}</sub>`;
      if (run.vertAlign === "superscript") html = `<sup>${html}</sup>`;
      if (run.bold && !opts.noBold) html = `<strong>${html}</strong>`;
      if (run.italic) html = `<em>${html}</em>`;
      if (run.strike) html = `<s>${html}</s>`;
      if (run.underline) html = `<u>${html}</u>`;
      const hl = hexColor(run.highlight);
      if (hl) html = `<mark style="background:${hl}">${html}</mark>`;
      const style = runStyle(run, false);
      if (style) html = `<span style="${style}">${html}</span>`;
    }
    const link = run.link;
    if (link) {
      if ("url" in link) {
        const url = safeUrl(link.url);
        if (url) html = `<a href="${esc(url)}" rel="noopener noreferrer">${html}</a>`;
      } else if (opts.anchors.has(link.anchor)) {
        html = `<a href="#${opts.anchors.get(link.anchor)}">${html}</a>`;
      }
    }
    out += html;
  }
  return out;
}

/** Bookmark name → id, so internal links land on an element that carries that id. */
function collectAnchors(paragraphs: Iterable<ParagraphBlock>): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of paragraphs) for (const name of p.bookmarks ?? []) map.set(name, anchorId(name));
  return map;
}

function bookmarkIds(p: ParagraphBlock, opts: InlineOptions): string {
  const first = p.bookmarks?.find((b) => opts.anchors.has(b));
  return first ? ` id="${opts.anchors.get(first)}"` : "";
}

/** Extra anchors on one element: further bookmarks become empty spans inside. */
function extraBookmarks(p: ParagraphBlock, opts: InlineOptions): string {
  const rest = (p.bookmarks ?? []).filter((b) => opts.anchors.has(b)).slice(1);
  return rest.map((b) => `<span id="${opts.anchors.get(b)}"></span>`).join("");
}

// ---- lists -------------------------------------------------------------------

const LIST_TYPE: Record<string, string | undefined> = {
  decimal: undefined,
  lowerLetter: "a",
  upperLetter: "A",
  lowerRoman: "i",
  upperRoman: "I",
};

function markerText(p: ParagraphBlock, counts: Map<string, number>): string {
  const list = p.list;
  if (!list) return "";
  if (list.kind === "bullet") return list.glyph || "•";
  const key = `${list.instance}:${list.level}`;
  const seen = counts.get(key) ?? 0;
  counts.set(key, seen + 1);
  const num = list.start + seen;
  const letters = (v: number, base: number) => {
    let s = "";
    let x = v;
    while (x > 0) {
      s = String.fromCharCode(base + ((x - 1) % 26)) + s;
      x = Math.floor((x - 1) / 26);
    }
    return s;
  };
  const roman = (v: number) => {
    const t: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
    let s = "";
    let x = v;
    for (const [value, sym] of t) while (x >= value) { s += sym; x -= value; }
    return s;
  };
  const body =
    list.kind === "decimal" ? String(num)
    : list.kind === "lowerLetter" ? letters(num, 97)
    : list.kind === "upperLetter" ? letters(num, 65)
    : list.kind === "lowerRoman" ? roman(num)
    : roman(num).toUpperCase();
  return `${body}${list.suffix || "."}`;
}

// ---- tables ------------------------------------------------------------------

type CellInfo = { cell: TableBlock["rows"][number][number]; rowSpan: number; col: number };

function cellLayout(table: TableBlock): (CellInfo | null)[][] {
  const gridCol = (row: TableBlock["rows"][number], index: number) =>
    row.slice(0, index).reduce((sum, c) => sum + Math.max(1, c.colSpan), 0);
  return table.rows.map((row, r) =>
    row.map((cell, i) => {
      if (cell.vMerge === "continue") return null;
      const col = gridCol(row, i);
      let rowSpan = 1;
      if (cell.vMerge === "restart") {
        for (let below = r + 1; below < table.rows.length; below++) {
          const next = table.rows[below];
          const at = next.findIndex((_, k) => gridCol(next, k) === col);
          if (at < 0 || next[at].vMerge !== "continue") break;
          rowSpan++;
        }
      }
      return { cell, rowSpan, col };
    }),
  );
}

function headerRowCount(table: TableBlock): number {
  if (table.headerRows !== undefined) return table.headerRows;
  if (table.rows.length < 2) return 0;
  const first = table.rows[0];
  const bold = first.every((c) => c.paragraphs.length > 0 && c.paragraphs.every((p) => p.runs.some((r) => r.text.trim()) && p.runs.filter((r) => r.text.trim()).every((r) => r.bold)));
  return bold ? 1 : 0;
}

function cellContent(paragraphs: ParagraphBlock[], opts: InlineOptions, counts: Map<string, number>): string {
  const parts = paragraphs.map((p) => {
    const marker = p.list ? `${esc(markerText(p, counts))} ` : "";
    const text = inline(p.runs, opts);
    if (!opts.exact) {
      const dir = isRtl(plain(p.runs)) ? ' dir="rtl"' : "";
      const align = p.align ? ` class="${p.align === "center" ? "c" : "r"}"` : "";
      return dir || align || paragraphs.length > 1 ? { text: marker + text, attrs: `${dir}${align}` } : { text: marker + text, attrs: "" };
    }
    const lh = p.lineRatio ? ` style="line-height:${n(Math.min(3, Math.max(0.8, p.lineRatio * 1.15)))}${p.align ? `;text-align:${p.align === "center" ? "center" : "right"}` : ""}"` : p.align ? ` style="text-align:${p.align === "center" ? "center" : "right"}"` : "";
    return { text: marker + text, attrs: lh };
  });
  if (parts.length === 1 && !parts[0].attrs && !opts.exact) return parts[0].text;
  return parts.map((p) => `<p${p.attrs}>${p.text}</p>`).join("");
}

function tableHtml(table: TableBlock, opts: InlineOptions, pos?: { x: number; y: number }): string {
  const layout = cellLayout(table);
  const headers = headerRowCount(table);
  const counts = new Map<string, number>();
  const exact = opts.exact;
  const border = hexColor(table.borderColor) ?? "#000000";
  const pad = table.padding ?? { top: 2, bottom: 2, left: 4, right: 4 };
  const rows = layout.map((cells, r) => {
    const tag = r < headers ? "th" : "td";
    const html = cells
      .map((info, i) => {
        if (!info) return "";
        const { cell, rowSpan } = info;
        const attrs: string[] = [];
        if (cell.colSpan > 1) attrs.push(`colspan="${cell.colSpan}"`);
        if (rowSpan > 1) attrs.push(`rowspan="${rowSpan}"`);
        const css: string[] = [];
        const shade = hexColor(cell.shade);
        if (shade) css.push(`background:${shade}`);
        if (exact) {
          css.push(`padding:${n(pad.top)}pt ${n(pad.right)}pt ${n(pad.bottom)}pt ${n(pad.left)}pt`);
          css.push(`vertical-align:${cell.vAlign === "center" ? "middle" : "top"}`);
          const b = cell.borders ?? (table.borders ? { top: true, bottom: true, left: true, right: true } : {});
          for (const side of ["top", "right", "bottom", "left"] as const) {
            css.push(`border-${side}:${b[side] ? `.75pt solid ${border}` : "0"}`);
          }
        } else if (!table.borders && cell.borders) {
          // Tables that only draw some rules (row lines, a header rule) keep just those.
          for (const side of ["top", "right", "bottom", "left"] as const) {
            if (cell.borders[side]) css.push(`border-${side}:1px solid #c9c9d1`);
          }
        }
        if (css.length) attrs.push(`style="${css.join(";")}"`);
        void i;
        let content = cellContent(cell.paragraphs, tag === "th" && !exact ? { ...opts, noBold: true } : opts, counts);
        if (exact && table.rowHeights) {
          // A row is never taller than it was on the page: the content sits in a box of that height and overflows rather than pushing the rows below.
          const span = table.rowHeights.slice(r, r + rowSpan).reduce((a, b) => a + b, 0);
          const inner = Math.max(1, span - pad.top - pad.bottom);
          content = `<div class="cc" style="height:${n(inner)}pt;justify-content:${cell.vAlign === "center" ? "center" : "flex-start"}">${content}</div>`;
        }
        return `<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>${content}</${tag}>`;
      })
      .join("");
    const height = exact ? table.rowHeights?.[r] : undefined;
    return `<tr${height ? ` style="height:${n(height)}pt"` : ""}>${html}</tr>`;
  });
  const bodyRows = headers > 0 ? `<thead>${rows.slice(0, headers).join("")}</thead><tbody>${rows.slice(headers).join("")}</tbody>` : `<tbody>${rows.join("")}</tbody>`;
  if (exact) {
    const width = table.colWidths.reduce((a, b) => a + b, 0);
    const cols = table.colWidths.map((w) => `<col style="width:${n(w)}pt">`).join("");
    const style = `${pos ? `left:${n(pos.x)}pt;top:${n(pos.y)}pt;` : ""}width:${n(width)}pt`;
    return `<table class="x" style="${style}"><colgroup>${cols}</colgroup>${bodyRows}</table>`;
  }
  return `<div class="tw"><table${table.borders ? "" : ' class="plain"'}>${bodyRows}</table></div>`;
}

// ---- reflow ------------------------------------------------------------------

const REFLOW_CSS = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#1b1b1f;font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans CJK SC","Noto Sans CJK JP","Hiragana Sans","PingFang SC","Microsoft YaHei",sans-serif;-webkit-text-size-adjust:100%}
main{max-width:46rem;margin:0 auto;padding:2.5rem 1.25rem 4rem;overflow-wrap:break-word}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.8em 0 .55em;font-weight:700}
h1{font-size:2rem}h2{font-size:1.55rem}h3{font-size:1.3rem}h4{font-size:1.12rem}h5,h6{font-size:1rem}
main>:first-child{margin-top:0}
p{margin:.9em 0}
ul,ol{margin:.9em 0;padding-inline-start:1.6em}
li{margin:.25em 0}
li>ul,li>ol{margin:.25em 0}
img{max-width:100%;height:auto;display:block;margin:1.2em auto}
.tw{overflow-x:auto;margin:1.2em 0;max-width:100%}
table{border-collapse:collapse}
td p,th p{margin:0}
td p+p,th p+p{margin-top:.5em}
table:not(.plain) th,table:not(.plain) td{border:1px solid #c9c9d1}
th,td{padding:.4em .7em;text-align:start;vertical-align:top}
th{background:#f3f3f6;font-weight:700}
.c{text-align:center}.r{text-align:end}
a{color:#1a56db}
mark{background:#fff3a3;color:inherit}
@media(prefers-color-scheme:dark){:root{color-scheme:dark}body{background:#16161a;color:#e6e6ea}th{background:#26262d}table:not(.plain) th,table:not(.plain) td{border-color:#44444d}a{color:#8ab4ff}}
@media print{main{max-width:none;padding:0}}
`.trim();

function head(title: string, lang: string, dir: string, props: DocModel["properties"], css: string): string {
  const meta = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="generator" content="iHateUpload PDF to HTML">',
  ];
  if (props?.author) meta.push(`<meta name="author" content="${esc(props.author)}">`);
  if (props?.subject) meta.push(`<meta name="description" content="${esc(props.subject)}">`);
  if (props?.keywords) meta.push(`<meta name="keywords" content="${esc(props.keywords)}">`);
  return `<!doctype html>\n<html lang="${esc(lang)}" dir="${dir}">\n<head>\n${meta.join("\n")}\n<title>${esc(title)}</title>\n<style>\n${css}\n</style>\n</head>`;
}

function pickTitle(model: DocModel, fallback: string, paragraphs: ParagraphBlock[]): string {
  const meta = model.properties?.title?.trim();
  if (meta) return meta;
  const heading = paragraphs.find((p) => p.style && plain(p.runs).trim());
  return heading ? plain(heading.runs).trim().slice(0, 120) : fallback;
}

type OpenList = { tag: "ul" | "ol"; level: number; instance: number; liOpen: boolean };

function reflowBlocks(blocks: Block[], env: HtmlEnv, opts: InlineOptions): string {
  const out: string[] = [];
  const stack: OpenList[] = [];
  const seen = new Map<string, number>();

  const closeTo = (level: number) => {
    while (stack.length && stack[stack.length - 1].level > level) {
      const top = stack.pop()!;
      if (top.liOpen) out[out.length - 1] += "</li>";
      out.push(`</${top.tag}>`);
    }
  };
  const closeAll = () => closeTo(-1);

  for (const block of blocks) {
    if (block.type === "p" && block.list) {
      const { list } = block;
      const top = stack[stack.length - 1];
      if (top && top.level > list.level) closeTo(list.level);
      let cur = stack[stack.length - 1];
      if (cur && cur.level === list.level && cur.instance !== list.instance) {
        closeTo(list.level - 1);
        cur = stack[stack.length - 1];
      }
      if (!cur || cur.level < list.level) {
        const tag = list.kind === "bullet" ? "ul" : "ol";
        const key = `${list.instance}:${list.level}`;
        let attrs = "";
        if (tag === "ol") {
          const start = list.start + (seen.get(key) ?? 0);
          if (start !== 1) attrs += ` start="${start}"`;
          const type = LIST_TYPE[list.kind];
          if (type) attrs += ` type="${type}"`;
        } else if (list.glyph && !["•", "●", "o", "▪", "·"].includes(list.glyph)) {
          const g = list.glyph.replace(/[^\p{L}\p{N}\p{P}\p{S}]/gu, "").replace(/["\\]/g, "").slice(0, 2);
          if (g) attrs += ` style="list-style-type:'${esc(g)} '"`;
        }
        out.push(`<${tag}${attrs}>`);
        stack.push({ tag, level: list.level, instance: list.instance, liOpen: false });
        cur = stack[stack.length - 1];
      } else if (cur.liOpen) {
        out[out.length - 1] += "</li>";
        cur.liOpen = false;
      }
      const key = `${list.instance}:${list.level}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
      const dir = isRtl(plain(block.runs)) ? ' dir="rtl"' : "";
      out.push(`<li${bookmarkIds(block, opts)}${dir}>${extraBookmarks(block, opts)}${inline(block.runs, opts)}`);
      cur.liOpen = true;
      continue;
    }
    closeAll();
    if (block.type === "p") {
      const text = inline(block.runs, block.style ? { ...opts, noBold: true } : opts);
      if (!text.trim() && !block.bookmarks?.length) continue;
      const tag = block.style ? `h${block.style.slice(-1)}` : "p";
      const attrs: string[] = [];
      const id = bookmarkIds(block, opts);
      if (id) attrs.push(id.trim());
      if (isRtl(plain(block.runs))) attrs.push('dir="rtl"');
      const lang = paragraphLang(block);
      if (lang && opts.docLang && lang.split("-")[0] !== opts.docLang.split("-")[0]) attrs.push(`lang="${esc(lang)}"`);
      if (block.align) attrs.push(`class="${block.align === "center" ? "c" : "r"}"`);
      out.push(`<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>${extraBookmarks(block, opts)}${text}</${tag}>`);
    } else if (block.type === "image") {
      const src = env.img((block as ImageBlock).ref);
      if (src) out.push(`<img src="${esc(src)}" alt="" width="${Math.round(block.width)}" height="${Math.round(block.height)}">`);
    } else {
      out.push(tableHtml(block, opts));
    }
  }
  closeAll();
  return out.filter(Boolean).join("\n");
}

function allParagraphs(blocks: Block[]): ParagraphBlock[] {
  return blocks.flatMap((b) => (b.type === "p" ? [b] : b.type === "table" ? b.rows.flatMap((r) => r.flatMap((c) => c.paragraphs)) : []));
}

export function writeReflowHtml(model: DocModel, _media: Record<string, MediaFile>, env: HtmlEnv): string {
  const blocks = model.sections.flatMap((s) => s.blocks);
  const paragraphs = allParagraphs(blocks);
  const { lang, dir } = documentLang(paragraphs);
  const opts: InlineOptions = { exact: false, anchors: collectAnchors(paragraphs), docLang: lang };
  const title = pickTitle(model, env.name, paragraphs);
  return `${head(title, lang, dir, model.properties, REFLOW_CSS)}\n<body>\n<main>\n${reflowBlocks(blocks, env, opts)}\n</main>\n</body>\n</html>\n`;
}

// ---- exact and picture -------------------------------------------------------

const EXACT_CSS = `
:root{color-scheme:light}
*{box-sizing:border-box}
html{background:#d9d9df}
body{margin:0;padding:16px 8px;font-family:Helvetica,Arial,sans-serif}
.pg{position:relative;margin:0 auto 16px;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.25);overflow:hidden;transform-origin:top center}
.pg>*{position:absolute}
.pg svg{left:0;top:0;pointer-events:none;overflow:visible}
.t{margin:0;white-space:nowrap}
.t.w{white-space:normal}
.t p{margin:0}
.m{display:inline-block;white-space:pre}
.pg img{display:block}
table.x .cc{display:flex;flex-direction:column;line-height:1.15}
table.x{position:absolute;border-collapse:collapse;table-layout:fixed;margin:0}
table.x p{margin:0}
.pg a{color:inherit;text-decoration:inherit}
.bg{left:0;top:0;width:100%;height:100%}
.ghost,.ghost *{color:transparent!important;background:transparent!important;text-decoration:none!important;border-color:transparent!important}
.ghost ::selection,.ghost::selection{background:rgba(40,110,255,.35);color:transparent}
@media print{html{background:#fff}body{padding:0}.pg{margin:0;box-shadow:none;break-after:page;zoom:1!important}}
`.trim();

const FIT_SCRIPT = `(function(){var p=[].slice.call(document.querySelectorAll('.pg'));function f(){var w=document.documentElement.clientWidth-16;p.forEach(function(e){var z=Math.min(1,w/(e.getAttribute('data-w')*4/3));e.style.zoom=z<1?z:''})}f();addEventListener('resize',f)})();`;

function shapeSvg(shapes: Shape[], w: number, h: number): string {
  if (!shapes.length) return "";
  const parts = shapes.map((s) => {
    const fill = hexColor(s.fill);
    const stroke = hexColor(s.stroke);
    const attrs = [
      `fill="${fill ?? "none"}"`,
      stroke ? `stroke="${stroke}" stroke-width="${n(Math.max(0.1, s.strokeWidth))}"` : "",
      fill && s.fillAlpha !== undefined && s.fillAlpha < 1 ? `fill-opacity="${n(s.fillAlpha)}"` : "",
      stroke && s.strokeAlpha !== undefined && s.strokeAlpha < 1 ? `stroke-opacity="${n(s.strokeAlpha)}"` : "",
      stroke && s.dash ? `stroke-dasharray="${n(s.strokeWidth * 4)} ${n(s.strokeWidth * 2)}"` : "",
    ].filter(Boolean).join(" ");
    if (s.kind === "rect") return `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" ${attrs}/>`;
    if (s.kind === "ellipse") return `<ellipse cx="${n(s.x + s.w / 2)}" cy="${n(s.y + s.h / 2)}" rx="${n(s.w / 2)}" ry="${n(s.h / 2)}" ${attrs}/>`;
    if (s.kind === "line") {
      const y1 = s.flipV ? s.y + s.h : s.y;
      const y2 = s.flipV ? s.y : s.y + s.h;
      return `<line x1="${n(s.x)}" y1="${n(y1)}" x2="${n(s.x + s.w)}" y2="${n(y2)}" ${attrs}/>`;
    }
    const d = (s.paths ?? [])
      .map((sub) => sub.map((seg) => (seg.op === "Z" ? "Z" : `${seg.op}${seg.pts.map(n).join(" ")}`)).join(""))
      .join("");
    return d ? `<path transform="translate(${n(s.x)} ${n(s.y)})" d="${d}" ${attrs}/>` : "";
  });
  return `<svg width="${n(w)}pt" height="${n(h)}pt" viewBox="0 0 ${n(w)} ${n(h)}" aria-hidden="true">${parts.join("")}</svg>`;
}

function textBox(item: ExactItem, opts: InlineOptions, counts: Map<string, number>, ghost: boolean): string {
  const block = item.block as ParagraphBlock;
  const sizes = block.runs.map((r) => r.size ?? 12);
  const tallest = Math.max(1, ...sizes);
  const single = item.box.h < tallest * 1.6;
  if (single && !block.list && block.runs.some((r) => r.tab)) {
    return splitAtTabs(item, block).map((piece) => textBox(piece, opts, counts, ghost)).join("");
  }
  const { box } = item;
  const css = [`left:${n(box.x)}pt`, `top:${n(box.y)}pt`];
  if (single) {
    css.push(`height:${n(box.h)}pt`, `line-height:${n(box.h)}pt`);
    if (block.align) css.push(`width:${n(box.w + 2)}pt`, `text-align:${block.align === "center" ? "center" : "right"}`);
  } else {
    const pitch = tallest * (block.lineRatio ?? 1) * 1.15;
    const lines = Math.max(1, Math.round(box.h / pitch));
    css.push(`width:${n(box.w + 2)}pt`, `line-height:${n(box.h / lines)}pt`);
    if (block.align) css.push(`text-align:${block.align === "center" ? "center" : "right"}`);
  }
  const rtl = isRtl(plain(block.runs));
  const attrs = [`class="t${single ? "" : " w"}${ghost ? " ghost" : ""}"`, `style="${css.join(";")}"`];
  if (rtl) attrs.push('dir="rtl"');
  const lang = paragraphLang(block);
  if (lang && opts.docLang && lang.split("-")[0] !== opts.docLang.split("-")[0]) attrs.push(`lang="${esc(lang)}"`);
  const id = bookmarkIds(block, opts);
  if (id) attrs.push(id.trim());
  let body = extraBookmarks(block, opts) + inline(block.runs, opts);
  const list = block.list;
  if (list) {
    const marker = markerText(block, counts);
    const ms = `display:inline-block;width:${n(list.hanging)}pt;margin-inline-start:-${n(list.hanging)}pt`;
    const first = block.runs.find((r) => r.text);
    const ind = first ? runStyle({ ...first, underline: false, strike: false, highlight: undefined, vertAlign: undefined }, true) : "";
    body = `<span class="m" style="${ms}${ind ? ";" + ind : ""}">${esc(marker)} </span>${body}`;
    attrs[1] = `style="${css.join(";")};padding-inline-start:${n(list.hanging)}pt"`;
  }
  return `<div ${attrs.join(" ")}>${body}</div>`;
}

function pageHtml(page: ExactPage, index: number, env: HtmlEnv, opts: InlineOptions, mode: "exact" | "picture", bg?: string): string {
  const counts = new Map<string, number>();
  const label = `Page ${index + 1}`;
  const parts: string[] = [];
  if (mode === "picture") {
    if (bg) parts.push(`<img class="bg" src="${esc(bg)}" alt="">`);
  } else {
    parts.push(shapeSvg(page.shapes.filter((s) => s.behind), page.width, page.height));
  }
  for (const item of page.items) {
    if (item.kind === "text") parts.push(textBox(item, opts, counts, mode === "picture"));
    else if (item.kind === "table") {
      const html = tableHtml(item.block as TableBlock, opts, item.box);
      parts.push(mode === "picture" ? html.replace('class="x"', 'class="x ghost"') : html);
    } else if (mode === "exact") {
      const src = env.img((item.block as ImageBlock).ref);
      if (src) {
        const { box } = item;
        parts.push(`<img src="${esc(src)}" alt="" style="left:${n(box.x)}pt;top:${n(box.y)}pt;width:${n(box.w)}pt;height:${n(box.h)}pt">`);
      }
    }
  }
  if (mode === "exact") parts.push(shapeSvg(page.shapes.filter((s) => !s.behind), page.width, page.height));
  return `<section class="pg" id="p${index + 1}" aria-label="${label}" data-w="${n(page.width)}" style="width:${n(page.width)}pt;height:${n(page.height)}pt">${parts.filter(Boolean).join("")}</section>`;
}

export type PictureRefs = Record<number, string>;

/** Exact layout, or (with page pictures) the picture mode's image plus transparent text. */
export function writePagesHtml(
  model: DocModel,
  env: HtmlEnv,
  mode: "exact" | "picture",
  pictures?: (pageIndex: number) => string | null,
): string {
  const pages = model.pages ?? [];
  const paragraphs = pages.flatMap((p) => allParagraphs(p.items.flatMap((it) => (it.kind === "picture" ? [] : [it.block as Block]))));
  const { lang, dir } = documentLang(paragraphs);
  const opts: InlineOptions = { exact: true, anchors: collectAnchors(paragraphs), docLang: lang };
  const title = pickTitle(model, env.name, paragraphs);
  const sizes = new Set(pages.map((p) => `${n(p.width)} ${n(p.height)}`));
  const pageRule = sizes.size === 1 && pages[0] ? `@page{size:${n(pages[0].width)}pt ${n(pages[0].height)}pt;margin:0}` : "";
  const body = pages.map((p, i) => pageHtml(p, i, env, opts, mode, mode === "picture" ? pictures?.(i) ?? undefined : undefined)).join("\n");
  return `${head(title, lang, dir, model.properties, `${EXACT_CSS}\n${pageRule}`)}\n<body>\n${body}\n<script>${FIT_SCRIPT}</script>\n</body>\n</html>\n`;
}

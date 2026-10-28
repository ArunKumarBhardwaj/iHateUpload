/**
 * Cell formatting from an OpenDocument spreadsheet (.ods, or flat .fods), in the same shape as
 * readWorkbookStyles gives for .xlsx: fonts, fills, borders and alignment per cell, rich text runs
 * and page setup. SheetJS reads an .ods file's values and merges but no formatting, and no column
 * widths, row heights or hidden rows and columns, so those are read here too (readOdsGeometry).
 *
 * Styles are small and parsed as a tree; the table body can be huge and is scanned tag by tag.
 * Values are mapped to what the .xlsx reader would give for the same sheet in Excel, so the layout
 * treats both alike (border widths snap to Excel's thin/medium/thick, indents to Excel levels).
 */
import JSZip from "jszip";

import { decodeEntities, parseHtml, type HNode } from "../word-to-pdf/html";
import type { Family } from "../word-to-pdf/model";
import { familyOf, type CellStyle, type Edge, type PageSetup, type Run, type RunStyle, type SheetStyles, type WorkbookStyles } from "./excel-styles";
import { isKrutiDevFont, krutiToUnicode } from "./krutidev";

/** Column widths (Excel width units) and row heights (points) per sheet, which SheetJS doesn't read from .ods. */
export interface OdsSheetGeometry {
  colWidths: (number | undefined)[];
  hiddenCols: boolean[];
  rowHeights: (number | undefined)[];
  hiddenRows: boolean[];
}

type X = Extract<HNode, { tag: string }>;
type Props = Record<string, string>;
const isX = (n: HNode): n is X => "tag" in n;
const kids = (e: X | undefined, tag?: string): X[] => (e?.children ?? []).filter((c): c is X => isX(c) && (!tag || c.tag === tag));
const kid = (e: X | undefined, tag: string): X | undefined => kids(e, tag)[0];
const find = (e: X | undefined, tag: string): X | undefined => {
  if (!e) return undefined;
  for (const c of kids(e)) {
    if (c.tag === tag) return c;
    const hit = find(c, tag);
    if (hit) return hit;
  }
  return undefined;
};
const parseXml = (s: string): X => ({ tag: "#root", attrs: {}, children: parseHtml(s) });

/** A length ("0.74pt", "1.7654in", "2cm") in points. */
function pt(v: string | undefined): number | undefined {
  const m = /^\s*(-?[\d.]+)\s*(pt|in|cm|mm|pc|px)?\s*$/i.exec(v ?? "");
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const per: Record<string, number> = { pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pc: 12, px: 0.75 };
  return n * per[(m[2] ?? "pt").toLowerCase()];
}
const inches = (v: string | undefined) => {
  const p = pt(v);
  return p === undefined ? undefined : Math.round((p / 72) * 1e4) / 1e4;
};
const hex = (v: string | undefined) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v.slice(1).toUpperCase() : undefined);
const yes = (v: string | undefined) => v === "true";

/** The three property sets a cell style carries, flattened through its parents. */
interface Resolved {
  cell: Props;
  para: Props;
  text: Props;
}

interface StyleDef {
  parent?: string;
  props: Record<string, Props>;
  attrs: Props;
}

const SIDES = ["top", "right", "bottom", "left"] as const;

/** fo:border sets all four sides: spread it so a parent's side doesn't outlive a child's fo:border. */
function spreadBorder(p: Props): Props {
  if (!p["fo:border"]) return p;
  const out = { ...p };
  for (const s of SIDES) out[`fo:border-${s}`] = p[`fo:border-${s}`] ?? p["fo:border"];
  delete out["fo:border"];
  return out;
}

function readStyleDefs(root: X | undefined, into: Map<string, StyleDef>): void {
  for (const s of kids(root, "style:style")) {
    const name = s.attrs["style:name"];
    if (!name) continue;
    const props: Record<string, Props> = {};
    for (const p of kids(s)) props[p.tag] = p.attrs;
    const key = `${s.attrs["style:family"]}:${name}`;
    // the first document read wins: content.xml's automatic styles over styles.xml's
    if (!into.has(key)) into.set(key, { parent: s.attrs["style:parent-style-name"], props, attrs: s.attrs });
  }
}

/** Font face names (style:font-name) -> family names. */
function readFontFaces(root: X | undefined, into: Map<string, string>): void {
  for (const f of kids(root, "style:font-face")) {
    const name = f.attrs["style:name"];
    const fam = f.attrs["svg:font-family"]?.replace(/^['"]|['"]$/g, "");
    if (name) into.set(name, fam || name);
  }
}

/** Line widths as Excel's border styles have them, from the widths LibreOffice writes for each. */
function snapWidth(w: number): number {
  if (w < 0.3) return 0.25;
  if (w < 1.2) return 0.5;
  if (w < 2.2) return 1;
  return 1.5;
}

/** Dash patterns in points, thin then medium, as excel-styles uses for Excel's broken borders. */
const DASH: Record<string, [number[], number[]]> = {
  dotted: [[0.75, 0.75], [0.75, 0.75]],
  dashed: [[2.25, 0.75], [6.75, 2.25]],
  "fine-dashed": [[2.25, 0.75], [6.75, 2.25]],
  "dash-dot": [[6, 1.5, 1.5, 1.5], [6.75, 2.25, 2.25, 2.25]],
  "dash-dot-dot": [[6, 1.5, 1.5, 1.5, 1.5, 1.5], [6.75, 2.25, 2.25, 2.25, 2.25, 2.25]],
};

const NAMED_WIDTH: Record<string, number> = { thin: 0.5, medium: 1, thick: 1.5 };

/** A border side: "0.74pt solid #000000" (any order), "none" or "hidden". */
function readEdge(v: string | undefined): Edge | undefined {
  if (!v) return undefined;
  let width: number | undefined;
  let style = "solid";
  let color = "000000";
  for (const tok of v.trim().split(/\s+/)) {
    const t = tok.toLowerCase();
    if (t === "none" || t === "hidden") return undefined;
    if (hex(t)) color = hex(t) as string;
    else if (NAMED_WIDTH[t] !== undefined) width = NAMED_WIDTH[t];
    else if (pt(t) !== undefined) width = pt(t);
    else style = t;
  }
  if (width !== undefined && width <= 0) return undefined;
  const w = width ?? 0.5;
  if (style.startsWith("double")) return { color, width: 1.5, double: true };
  const edge: Edge = { color, width: snapWidth(w) };
  if (DASH[style]) edge.dash = DASH[style][edge.width >= 1 ? 1 : 0];
  return edge;
}

/** Points per Excel indent level, as LibreOffice converts one to the other. */
const INDENT_PT = 8.4;

const ALIGN: Record<string, CellStyle["align"]> = { start: "left", left: "left", end: "right", right: "right", center: "center", justify: "justify" };

/** Everything the reader needs from styles.xml and content.xml's style sections. */
class StyleBook {
  /** automatic styles (content.xml's, then styles.xml's) and common styles, by "family:name" */
  auto = new Map<string, StyleDef>();
  named = new Map<string, StyleDef>();
  faces = new Map<string, string>();
  defaultText: Props = {};
  pageLayouts = new Map<string, X>();
  masters = new Map<string, X>();
  private memo = new Map<string, Resolved>();
  private cellMemo = new Map<string, CellStyle | undefined>();
  baseSize = 10;
  baseFamily: Family = "sans";

  constructor(docs: X[]) {
    for (const d of docs) {
      readFontFaces(find(d, "office:font-face-decls"), this.faces);
      const autos = find(d, "office:automatic-styles");
      readStyleDefs(autos, this.auto);
      for (const pl of kids(autos, "style:page-layout")) if (pl.attrs["style:name"]) this.pageLayouts.set(pl.attrs["style:name"], pl);
      const common = find(d, "office:styles");
      if (common) {
        readStyleDefs(common, this.named);
        const def = kids(common, "style:default-style").find((s) => s.attrs["style:family"] === "table-cell");
        if (def) this.defaultText = kid(def, "style:text-properties")?.attrs ?? {};
      }
      for (const mp of kids(find(d, "office:master-styles"), "style:master-page")) if (mp.attrs["style:name"]) this.masters.set(mp.attrs["style:name"], mp);
    }
    // the "Default" cell style is the workbook's default font, as an .xlsx file's first font is
    const base = this.resolve("Default", true);
    const size = pt(base.text["fo:font-size"]);
    if (size && size > 0) this.baseSize = size;
    const font = this.fontName(base.text);
    this.baseFamily = isKrutiDevFont(font) ? "sans" : familyOf(font);
  }

  def(family: string, name: string, namedOnly = false): StyleDef | undefined {
    return (namedOnly ? undefined : this.auto.get(`${family}:${name}`)) ?? this.named.get(`${family}:${name}`) ?? this.auto.get(`${family}:${name}`);
  }

  /** A table-cell style flattened through its parents, down to the document's default cell text. */
  resolve(name: string, namedOnly = false, depth = 0): Resolved {
    const key = `${namedOnly ? "n" : "a"}:${name}`;
    const hit = this.memo.get(key);
    if (hit) return hit;
    const d = this.def("table-cell", name, namedOnly);
    const parent: Resolved =
      d?.parent && depth < 20 ? this.resolve(d.parent, true, depth + 1) : { cell: {}, para: {}, text: { ...this.defaultText } };
    const own = d?.props ?? {};
    const out: Resolved = {
      cell: { ...parent.cell, ...spreadBorder(own["style:table-cell-properties"] ?? {}) },
      para: { ...parent.para, ...(own["style:paragraph-properties"] ?? {}) },
      text: mergeText(parent.text, own["style:text-properties"] ?? {}),
    };
    this.memo.set(key, out);
    return out;
  }

  fontName(text: Props): string | undefined {
    const n = text["style:font-name"];
    if (n) return this.faces.get(n) ?? n;
    return text["fo:font-family"]?.split(",")[0].trim().replace(/^['"]|['"]$/g, "") || undefined;
  }

  /** The CellStyle a named or automatic cell style stands for, against the default style's font. */
  cellStyle(name: string): CellStyle | undefined {
    if (this.cellMemo.has(name)) return this.cellMemo.get(name);
    const out = toCellStyle(this.resolve(name), this);
    this.cellMemo.set(name, out);
    return out;
  }

  textStyle(name: string): Props | undefined {
    return this.def("text", name)?.props["style:text-properties"];
  }
}

/** Child text properties over the parent's; a percentage font size is relative to the parent's. */
function mergeText(parent: Props, own: Props): Props {
  const out = { ...parent, ...own };
  const sz = own["fo:font-size"];
  if (sz?.endsWith("%")) {
    const base = pt(parent["fo:font-size"]) ?? 10;
    out["fo:font-size"] = `${Math.round(base * Number(sz.slice(0, -1))) / 100}pt`;
  }
  return out;
}

interface Font {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  size?: number;
  color?: string;
  family: Family;
  kruti: boolean;
}

function readFont(text: Props, book: StyleBook): Font {
  const weight = text["fo:font-weight"] ?? "normal";
  const line = (style: string | undefined, type: string | undefined) => (style ? style !== "none" : !!type && type !== "none");
  const name = book.fontName(text);
  const size = pt(text["fo:font-size"]);
  return {
    bold: weight === "bold" || Number(weight) >= 600,
    italic: text["fo:font-style"] === "italic" || text["fo:font-style"] === "oblique",
    underline: line(text["style:text-underline-style"], text["style:text-underline-type"]),
    strike: line(text["style:text-line-through-style"], text["style:text-line-through-type"]),
    size: size && size > 0 ? size : undefined,
    color: yes(text["style:use-window-font-color"]) ? undefined : hex(text["fo:color"]),
    family: isKrutiDevFont(name) ? "sans" : familyOf(name),
    kruti: isKrutiDevFont(name),
  };
}

/** Only what differs from a plain cell, as readXfs does for .xlsx. */
function toCellStyle(r: Resolved, book: StyleBook): CellStyle | undefined {
  const s: CellStyle = {};
  const font = readFont(r.text, book);
  if (font.bold) s.bold = true;
  if (font.italic) s.italic = true;
  if (font.underline) s.underline = true;
  if (font.strike) s.strike = true;
  if (font.size && font.size !== book.baseSize) s.size = font.size;
  if (font.family !== book.baseFamily) s.family = font.family;
  if (font.kruti) s.kruti = true;
  // black is what the PDF uses anyway
  if (font.color && font.color !== "000000") s.color = font.color;
  const fill = hex(r.cell["fo:background-color"]);
  if (fill && fill !== "FFFFFF") s.fill = fill;
  // "value-type" alignment is Excel's General: text left, numbers right
  const ta = r.cell["style:text-align-source"] === "value-type" ? undefined : r.para["fo:text-align"];
  const distributed = r.para["css3t:text-justify"] === "distribute";
  if (ta && ALIGN[ta]) s.align = ALIGN[ta];
  if (yes(r.cell["style:repeat-content"])) {
    s.repeat = true;
    s.align ??= "left";
  }
  const v = r.cell["style:vertical-align"];
  if (v === "top") s.valign = "top";
  else if (v === "middle") s.valign = "middle";
  if (r.cell["fo:wrap-option"] === "wrap") s.wrap = true;
  else if (yes(r.cell["style:shrink-to-fit"])) s.shrink = true;
  const margin = pt(r.para["fo:margin-left"]) ?? 0;
  if (margin > 0.5 && (!s.align || s.align === "left" || s.align === "right" || (s.align === "justify" && distributed)) && !s.repeat) {
    s.indent = Math.max(1, Math.round(margin / INDENT_PT));
  }
  if (r.cell["style:direction"] === "ttb") s.rotate = "stacked";
  else {
    const rot = (((Number.parseFloat(r.cell["style:rotation-angle"] ?? "0") || 0) % 360) + 360) % 360;
    // Excel turns text -90..90 degrees; text turned further reads the same way, upside down
    const deg = rot <= 90 ? rot : rot >= 270 ? rot - 360 : rot - 180;
    if (deg) s.rotate = Math.round(deg);
  }
  const border: NonNullable<CellStyle["border"]> = {};
  for (const side of SIDES) {
    const e = readEdge(r.cell[`fo:border-${side}`]);
    if (e) border[side] = e;
  }
  if (Object.keys(border).length) s.border = border;
  return Object.keys(s).length ? s : undefined;
}

/** OOXML paperSize codes for page sizes in points (short side, long side). */
const PAPERS: [number, number, number][] = [
  [612, 792, 1],
  [612, 1008, 5],
  [841.89, 1190.55, 8],
  [595.28, 841.89, 9],
  [419.53, 595.28, 11],
];

/** Header or footer text as Excel codes: &L/&C/&R regions with &P, &N, &A, &F, &D, &T fields. */
function headerCodes(e: X | undefined): string | undefined {
  if (!e || e.attrs["style:display"] === "false") return undefined;
  const inline = (n: HNode): string => {
    if (!isX(n)) return n.text.replace(/&/g, "&&");
    switch (n.tag) {
      case "text:page-number":
        return "&P";
      case "text:page-count":
        return "&N";
      case "text:sheet-name":
        return "&A";
      case "text:title":
      case "text:file-name":
        return "&F";
      case "text:date":
        return "&D";
      case "text:time":
        return "&T";
      case "text:s":
        return " ".repeat(Math.max(1, Number(n.attrs["text:c"]) || 1));
      case "text:tab":
        return " ";
      case "text:line-break":
        return "\n";
      default:
        return n.children.map(inline).join("");
    }
  };
  const region = (r: X) => kids(r, "text:p").map(inline).join("\n");
  const regions: [string, X | undefined][] = [
    ["&L", kid(e, "style:region-left")],
    ["&C", kid(e, "style:region-center")],
    ["&R", kid(e, "style:region-right")],
  ];
  // a header with no regions is one centred block
  if (!regions.some(([, r]) => r)) regions[1][1] = e;
  const out = regions
    .map(([code, r]) => {
      const t = r ? region(r) : "";
      return t ? code + t : "";
    })
    .join("");
  return out || undefined;
}

/** The page setup of a sheet whose table uses this master page. */
function readPageSetup(book: StyleBook, masterName: string): PageSetup {
  const out: PageSetup = {};
  const master = book.masters.get(masterName) ?? book.masters.get("Default");
  const layout = master ? book.pageLayouts.get(master.attrs["style:page-layout-name"] ?? "") : undefined;
  const p = kid(layout, "style:page-layout-properties")?.attrs ?? {};
  const w = pt(p["fo:page-width"]);
  const h = pt(p["fo:page-height"]);
  if (w && h) {
    out.hasPageSetup = true;
    const [a, b] = [Math.min(w, h), Math.max(w, h)];
    out.paperSize = PAPERS.find(([pw, ph]) => Math.abs(pw - a) < 3 && Math.abs(ph - b) < 3)?.[2];
  }
  if (p["style:print-orientation"] === "landscape" || (w && h && !p["style:print-orientation"] && w > h)) out.landscape = true;
  const scale = Number.parseFloat(p["style:scale-to"] ?? "");
  if (Number.isFinite(scale) && scale > 0) out.scale = Math.round(scale);
  const fx = p["style:scale-to-x"] ?? p["loext:scale-to-x"];
  const fy = p["style:scale-to-y"] ?? p["loext:scale-to-y"];
  const pages = Number(p["style:scale-to-pages"]);
  if (fx !== undefined || fy !== undefined) {
    out.fitToPage = true;
    out.fitToWidth = Number(fx ?? 0) || 0;
    out.fitToHeight = Number(fy ?? 0) || 0;
  } else if (pages > 0) {
    // "fit to N pages" has no Excel equivalent: one page wide, N tall is the usual intent
    out.fitToPage = true;
    out.fitToWidth = 1;
    out.fitToHeight = pages;
  }
  if ((p["style:print"] ?? "").split(/\s+/).includes("grid")) out.gridLines = true;
  const centring = p["style:table-centering"];
  if (centring === "horizontal" || centring === "both") out.centerH = true;

  // an ODF page margin runs to the header; Excel's top margin runs to the body, below the header
  const header = kid(master, "style:header");
  const footer = kid(master, "style:footer");
  const hfHeight = (which: string, shown: boolean) => {
    if (!shown) return 0;
    const hp = kid(kid(layout, which), "style:header-footer-properties")?.attrs ?? {};
    return pt(hp["fo:min-height"] ?? hp["svg:height"]) ?? 0;
  };
  out.header = headerCodes(header);
  out.footer = headerCodes(footer);
  const [l, r, t, b] = ["left", "right", "top", "bottom"].map((s) => pt(p[`fo:margin-${s}`]));
  if (l !== undefined && r !== undefined && t !== undefined && b !== undefined) {
    const hShown = !!header && header.attrs["style:display"] !== "false";
    const fShown = !!footer && footer.attrs["style:display"] !== "false";
    const top = t + hfHeight("style:header-style", hShown);
    const bottom = b + hfHeight("style:footer-style", fShown);
    out.margins = { left: inches(`${l}pt`) as number, right: inches(`${r}pt`) as number, top: inches(`${top}pt`) as number, bottom: inches(`${bottom}pt`) as number };
    if (hShown) out.headerMargin = inches(`${t}pt`);
    if (fShown) out.footerMargin = inches(`${b}pt`);
  }
  return out;
}

// ---- the table body ----

/** A run of identical columns or cells: where it starts and how many it covers. */
interface Span {
  at: number;
  n: number;
}
interface CellRec extends Span {
  style?: string;
  content: boolean;
  runs?: { text: string; style?: string }[];
}
interface RowRec extends Span {
  style?: string;
  defaultCell?: string;
  hidden: boolean;
  cells: CellRec[];
}
interface ColRec extends Span {
  style?: string;
  defaultCell?: string;
  hidden: boolean;
}
interface TableRec {
  name: string;
  style?: string;
  cols: ColRec[];
  rows: RowRec[];
}

const TAG_RE = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w.-]*:[\w.-]+|[a-zA-Z][\w.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+)/g;
const ATTR_RE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function attrsOf(src: string): Props {
  const out: Props = {};
  for (const m of src.matchAll(ATTR_RE)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? "");
  return out;
}

/** Repeat counts are capped: a sheet has at most 2^20 rows and 2^14 columns. */
const count = (v: string | undefined, max: number) => Math.min(max, Math.max(1, Math.floor(Number(v) || 1)));
const MAX_ROWS = 1 << 20;
const MAX_COLS = 1 << 14;

/** Tables, rows and cells from the body, keeping repeated runs as runs. */
function scanTables(body: string): TableRec[] {
  const tables: TableRec[] = [];
  let table: TableRec | undefined;
  let row: RowRec | undefined;
  let cell: CellRec | undefined;
  let r = 0;
  let c = 0;
  let paras = 0;
  // inside a cell: the stack of span styles, and depth inside things whose text isn't the cell's
  const spans: (string | undefined)[] = [];
  let skip = 0;
  let rich = false;
  const addText = (t: string) => {
    if (!cell || skip || !t) return;
    const style = spans[spans.length - 1];
    if (style) rich = true;
    cell.runs ??= [];
    const last = cell.runs[cell.runs.length - 1];
    if (last && last.style === style) last.text += t;
    else cell.runs.push({ text: t, style });
  };
  const endCell = () => {
    if (!cell || !row) return;
    if (cell.runs?.some((x) => x.text)) cell.content = true;
    if (!rich) delete cell.runs;
    row.cells.push(cell);
    c += cell.n;
    cell = undefined;
  };
  for (const m of body.matchAll(TAG_RE)) {
    if (m[4] !== undefined) {
      if (cell && paras) addText(decodeEntities(m[4]));
      continue;
    }
    if (!m[2]) continue;
    const close = m[1] === "/";
    const tag = m[2].toLowerCase();
    const selfClosed = !close && m[3].trimEnd().endsWith("/");
    if (close) {
      if (tag === "table:table") {
        table = undefined;
      } else if (tag === "table:table-row" && table && row) {
        table.rows.push(row);
        r += row.n;
        row = undefined;
      } else if ((tag === "table:table-cell" || tag === "table:covered-table-cell") && cell) {
        endCell();
      } else if (cell) {
        if (tag === "office:annotation" || tag.startsWith("draw:")) skip = Math.max(0, skip - 1);
        else if (tag === "text:span") spans.pop();
      }
      continue;
    }
    const a = attrsOf(m[3]);
    if (tag === "table:table") {
      table = { name: a["table:name"] ?? "", style: a["table:style-name"], cols: [], rows: [] };
      tables.push(table);
      r = 0;
    } else if (!table) {
      continue;
    } else if (tag === "table:table-column") {
      const at = table.cols.reduce((s, x) => s + x.n, 0);
      if (at >= MAX_COLS) continue;
      table.cols.push({
        at,
        n: count(a["table:number-columns-repeated"], MAX_COLS - at),
        style: a["table:style-name"],
        defaultCell: a["table:default-cell-style-name"],
        hidden: a["table:visibility"] === "collapse" || a["table:visibility"] === "filter",
      });
    } else if (tag === "table:table-row") {
      if (r >= MAX_ROWS) continue;
      row = {
        at: r,
        n: count(a["table:number-rows-repeated"], MAX_ROWS - r),
        style: a["table:style-name"],
        defaultCell: a["table:default-cell-style-name"],
        hidden: a["table:visibility"] === "collapse" || a["table:visibility"] === "filter",
        cells: [],
      };
      c = 0;
      if (selfClosed) {
        table.rows.push(row);
        r += row.n;
        row = undefined;
      }
    } else if ((tag === "table:table-cell" || tag === "table:covered-table-cell") && row) {
      if (c >= MAX_COLS) continue;
      cell = { at: c, n: count(a["table:number-columns-repeated"], MAX_COLS - c), style: a["table:style-name"], content: !!a["office:value-type"] };
      spans.length = 0;
      skip = 0;
      rich = false;
      paras = 0;
      if (selfClosed) endCell();
    } else if (cell) {
      if (tag === "office:annotation" || tag.startsWith("draw:")) {
        if (!selfClosed) skip++;
      } else if (skip) {
        continue;
      } else if (tag === "text:p" || tag === "text:h") {
        if (paras++) addText("\n");
      } else if (tag === "text:span" && !selfClosed) {
        spans.push(a["text:style-name"] ?? spans[spans.length - 1]);
      } else if (tag === "text:s") {
        addText(" ".repeat(count(a["text:c"], 1000)));
      } else if (tag === "text:tab") {
        addText("\t");
      } else if (tag === "text:line-break") {
        addText("\n");
      }
    }
  }
  return tables;
}

/** Runs this long are the rest of the sheet, styled or not: they don't extend the used range. */
const TAIL_ROWS = 1000;
const TAIL_COLS = 256;

const encodeCol = (c: number) => {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

interface Parsed {
  styles: WorkbookStyles;
  geometry: Map<string, OdsSheetGeometry>;
}

function readSheet(book: StyleBook, t: TableRec): { sheet: SheetStyles; geo: OdsSheetGeometry } {
  // the used range: cells with content, and styled cells that aren't a run to the sheet's end
  let maxRow = -1;
  let maxCol = -1;
  for (const row of t.rows) {
    for (const cell of row.cells) {
      const styled = !!cell.style && !!book.cellStyle(cell.style) && row.n < TAIL_ROWS && cell.n < TAIL_COLS;
      if (!cell.content && !styled) continue;
      maxRow = Math.max(maxRow, row.at + (cell.content ? row.n : Math.min(row.n, TAIL_ROWS)) - 1);
      maxCol = Math.max(maxCol, cell.at + (cell.content ? cell.n : Math.min(cell.n, TAIL_COLS)) - 1);
    }
  }
  maxRow = Math.min(maxRow, MAX_ROWS - 1);
  // columns given their own width or visibility before the trailing run count too
  const lastCols = t.cols.filter((c) => c.n < TAIL_COLS);
  const geoCols = Math.max(maxCol + 1, ...lastCols.map((c) => c.at + c.n));

  const colDefault: (string | undefined)[] = [];
  const colWidths: (number | undefined)[] = [];
  const hiddenCols: boolean[] = [];
  const colBreaks: number[] = [];
  for (const col of t.cols) {
    if (col.at >= geoCols && col.at > 0) break;
    const props = (col.style && book.def("table-column", col.style)?.props["style:table-column-properties"]) || {};
    const w = pt(props["style:column-width"]);
    if (props["fo:break-before"] === "page" && col.at > 0) colBreaks.push(col.at);
    for (let c = col.at; c < Math.min(col.at + col.n, geoCols); c++) {
      colDefault[c] = col.defaultCell;
      // Excel width units: the layout prints a unit as 5.25pt (columnPt)
      colWidths[c] = w ? Math.round((w / 5.25) * 1e4) / 1e4 : undefined;
      hiddenCols[c] = col.hidden;
    }
  }

  const cells = new Map<string, CellStyle>();
  const runs = new Map<string, Run[]>();
  const rowHeights: (number | undefined)[] = [];
  const hiddenRows: boolean[] = [];
  const rowBreaks: number[] = [];
  for (const row of t.rows) {
    const props = (row.style && book.def("table-row", row.style)?.props["style:table-row-properties"]) || {};
    if (props["fo:break-before"] === "page" && row.at > 0) rowBreaks.push(row.at);
    if (row.at > maxRow) continue;
    const h = pt(props["style:row-height"]);
    const end = Math.min(row.at + row.n, maxRow + 1);
    // the cells of one row record, the same for every row it repeats
    const line: { c: number; style?: CellStyle; runs?: Run[] }[] = [];
    let c = 0;
    const put = (at: number, name: string | undefined, rec?: CellRec) => {
      const style = name ? book.cellStyle(name) : undefined;
      const rich = rec?.runs ? toRuns(book, rec, name) : undefined;
      if (style || rich) line.push({ c: at, style, runs: rich });
    };
    for (const cell of row.cells) {
      for (let k = cell.at; k < Math.min(cell.at + cell.n, maxCol + 1); k++) put(k, cell.style ?? row.defaultCell ?? colDefault[k], cell);
      c = cell.at + cell.n;
    }
    // a row that stops short: the rest takes the row's or columns' default style
    for (let k = c; k <= maxCol; k++) put(k, row.defaultCell ?? colDefault[k]);
    for (let r = row.at; r < end; r++) {
      rowHeights[r] = h;
      hiddenRows[r] = row.hidden;
      for (const x of line) {
        const ref = `${encodeCol(x.c)}${r + 1}`;
        if (x.style) cells.set(ref, x.style);
        if (x.runs) runs.set(ref, x.runs);
      }
    }
  }

  // page setup from the table's master page, and the sheet's direction from its table style
  const tableStyle = t.style ? book.def("table", t.style) : undefined;
  const setup = readPageSetup(book, tableStyle?.attrs["style:master-page-name"] ?? "Default");
  if (tableStyle?.props["style:table-properties"]?.["style:writing-mode"] === "rl-tb") setup.rtl = true;
  if (rowBreaks.length) setup.rowBreaks = rowBreaks;
  if (colBreaks.length) setup.colBreaks = colBreaks;
  // long trailing runs are the rest of the sheet: their width and height are the sheet's defaults
  const lastCol = t.cols[t.cols.length - 1];
  const lastColW = lastCol?.style && lastCol.n >= TAIL_COLS ? pt(book.def("table-column", lastCol.style)?.props["style:table-column-properties"]?.["style:column-width"]) : undefined;
  if (lastColW) setup.defaultColWidth = Math.round((lastColW / 5.25) * 1e4) / 1e4;
  const lastRow = t.rows[t.rows.length - 1];
  const lastRowH = lastRow?.style && lastRow.n >= TAIL_ROWS ? pt(book.def("table-row", lastRow.style)?.props["style:table-row-properties"]?.["style:row-height"]) : undefined;
  if (lastRowH) setup.defaultRowHeight = Math.round(lastRowH * 100) / 100;

  return {
    sheet: { cells, runs, pictures: [], setup },
    geo: { colWidths: colWidths.slice(0, geoCols), hiddenCols: hiddenCols.slice(0, geoCols), rowHeights, hiddenRows },
  };
}

/** A rich-text cell's runs: spans take the cell's font with their own text style over it. */
function toRuns(book: StyleBook, rec: CellRec, cellStyle: string | undefined): Run[] {
  const cellText = book.resolve(cellStyle ?? "Default", !cellStyle).text;
  const cellKruti = isKrutiDevFont(book.fontName(cellText));
  return (rec.runs ?? []).map((x) => {
    const own = x.style ? book.textStyle(x.style) : undefined;
    if (!own) return { text: cellKruti ? krutiToUnicode(x.text) : x.text };
    const f = readFont(mergeText(cellText, own), book);
    const style: RunStyle = { bold: f.bold, italic: f.italic, underline: f.underline, strike: f.strike, size: f.size, color: f.color, family: f.family };
    return { text: f.kruti ? krutiToUnicode(x.text) : x.text, style };
  });
}

/** The style and content XML of an .ods package or a flat .fods document, or null for anything else. */
async function odsParts(data: ArrayBuffer | Uint8Array): Promise<{ styles?: string; content: string } | null> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes);
    } catch {
      return null;
    }
    const mime = (await zip.file("mimetype")?.async("string"))?.trim();
    if (mime !== undefined && !mime.startsWith("application/vnd.oasis.opendocument.spreadsheet")) return null;
    const content = await zip.file("content.xml")?.async("string");
    if (!content || !content.includes("<office:spreadsheet")) return null;
    return { content, styles: await zip.file("styles.xml")?.async("string") };
  }
  // flat XML: everything in one document
  const head = new TextDecoder().decode(bytes.subarray(0, 4096));
  if (!/^\s*(?:﻿)?</.test(head) || !head.includes("office:document")) return null;
  const content = new TextDecoder().decode(bytes);
  return content.includes("<office:spreadsheet") ? { content } : null;
}

async function parseOds(data: ArrayBuffer | Uint8Array): Promise<Parsed | null> {
  try {
    const parts = await odsParts(data);
    if (!parts) return null;
    const bodyAt = parts.content.indexOf("<office:body");
    const head = bodyAt >= 0 ? parts.content.slice(0, bodyAt) : parts.content;
    const docs = [parseXml(head)];
    if (parts.styles) docs.push(parseXml(parts.styles));
    const book = new StyleBook(docs);
    const sheets = new Map<string, SheetStyles>();
    const geometry = new Map<string, OdsSheetGeometry>();
    for (const t of scanTables(bodyAt >= 0 ? parts.content.slice(bodyAt) : "")) {
      const { sheet, geo } = readSheet(book, t);
      sheets.set(t.name, sheet);
      geometry.set(t.name, geo);
    }
    return { styles: { baseSize: book.baseSize, baseFamily: book.baseFamily, sheets }, geometry };
  } catch {
    return null;
  }
}

/** Styles for every sheet of an .ods (or .fods) file, keyed by name. Null when the file isn't one. */
export async function readOdsStyles(data: ArrayBuffer | Uint8Array): Promise<WorkbookStyles | null> {
  return (await parseOds(data))?.styles ?? null;
}

/**
 * Column widths (Excel width units), row heights (points) and hidden columns and rows per sheet,
 * up to the sheet's used range. SheetJS gives no `!cols` or `!rows` for .ods; its `!merges` are fine.
 */
export async function readOdsGeometry(data: ArrayBuffer | Uint8Array): Promise<Map<string, OdsSheetGeometry> | null> {
  return (await parseOds(data))?.geometry ?? null;
}

/** Both at once, parsing the file one time. */
export async function readOds(data: ArrayBuffer | Uint8Array): Promise<Parsed | null> {
  return parseOds(data);
}

/** Give a SheetJS sheet read from .ods the `!cols` and `!rows` the .xlsx reader would have set. */
export function applyOdsGeometry(
  ws: { "!cols"?: { width?: number; hidden?: boolean }[]; "!rows"?: { hpt?: number; hidden?: boolean }[] },
  geo: OdsSheetGeometry,
): void {
  ws["!cols"] = geo.colWidths.map((w, i) => ({ ...(w !== undefined ? { width: w } : {}), ...(geo.hiddenCols[i] ? { hidden: true } : {}) }));
  ws["!rows"] = geo.rowHeights.map((h, i) => ({ ...(h !== undefined ? { hpt: h } : {}), ...(geo.hiddenRows[i] ? { hidden: true } : {}) }));
}

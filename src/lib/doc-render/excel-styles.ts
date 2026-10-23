/**
 * Cell formatting from an .xlsx package: fonts, solid fills and alignment per cell.
 * The community build of SheetJS only reads fills, so styles.xml and each sheet's style
 * indexes are read here directly. Sheet XML is scanned with a regex, not parsed, so large
 * sheets stay fast.
 */
import JSZip from "jszip";

import { parseHtml, type HNode } from "../word-to-pdf/html";
import type { Family } from "../word-to-pdf/model";

export interface CellStyle {
  /** the closest bundled face to the cell's font, when it isn't the workbook's default font */
  family?: Family;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** points */
  size?: number;
  /** hex RRGGBB */
  color?: string;
  /** hex RRGGBB background */
  fill?: string;
  align?: "left" | "center" | "right" | "justify";
  valign?: "top" | "middle" | "bottom";
  /** wrap text: without it Excel keeps text on one line, overflowing or clipped */
  wrap?: boolean;
  border?: { top?: Edge; right?: Edge; bottom?: Edge; left?: Edge };
}

export interface Edge {
  color: string;
  /** points */
  width: number;
}

/** A sheet's print settings, as Excel's Page Layout tab has them. */
export interface PageSetup {
  /** OOXML paperSize code: 1 Letter, 5 Legal, 8 A3, 9 A4, ... */
  paperSize?: number;
  landscape?: boolean;
  /** percent */
  scale?: number;
  /** fit to this many pages wide / tall (0 = no limit); only when fitToPage is on */
  fitToWidth?: number;
  fitToHeight?: number;
  fitToPage?: boolean;
  /** inches */
  margins?: { left: number; right: number; top: number; bottom: number };
  gridLines?: boolean;
  centerH?: boolean;
  /** Excel's default row height and column width (in its width units), when the sheet sets them */
  defaultRowHeight?: number;
  defaultColWidth?: number;
}

export interface SheetStyles {
  cells: Map<string, CellStyle>;
  setup: PageSetup;
}

export interface WorkbookStyles {
  /** the workbook's default font size, which cell sizes are relative to */
  baseSize: number;
  /** the closest bundled face to the workbook's default font */
  baseFamily: Family;
  sheets: Map<string, SheetStyles>;
}

type X = Extract<HNode, { tag: string }>;
const isX = (n: HNode): n is X => "tag" in n;
// the parser lower-cases tag names, so every comparison below is case-insensitive
const local = (tag: string) => tag.replace(/^[\w-]+:/, "").toLowerCase();
const kids = (e: X | undefined, tag?: string): X[] =>
  (e?.children ?? []).filter((c): c is X => isX(c) && (!tag || local(c.tag) === tag.toLowerCase()));
const kid = (e: X | undefined, tag: string): X | undefined => kids(e, tag)[0];
const parseXml = (s: string): X => ({ tag: "#root", attrs: {}, children: parseHtml(s) });
const find = (e: X | undefined, tag: string): X | undefined => {
  if (!e) return undefined;
  for (const c of kids(e)) {
    if (local(c.tag) === tag.toLowerCase()) return c;
    const hit = find(c, tag);
    if (hit) return hit;
  }
  return undefined;
};

/** Excel's legacy 64-colour palette, used by `indexed` colours. */
const INDEXED = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

/** Office default theme, in the order SpreadsheetML theme indexes use (light 1 first). */
const DEFAULT_THEME = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"];

function readTheme(xml: string | undefined): string[] {
  if (!xml) return DEFAULT_THEME;
  const scheme = find(parseXml(xml), "clrScheme");
  if (!scheme) return DEFAULT_THEME;
  const hex = (name: string) => {
    const e = kid(scheme, name);
    const c = kids(e)[0];
    if (!c) return undefined;
    const v = local(c.tag) === "sysclr" ? c.attrs.lastclr : c.attrs.val;
    return v && /^[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : undefined;
  };
  // the scheme lists dk1, lt1, dk2, lt2; SpreadsheetML indexes swap each pair
  const names = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  return names.map((n, i) => hex(n) ?? DEFAULT_THEME[i]);
}

function tint(hex: string, t: number): string {
  if (!t) return hex;
  const ch = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = ch.map((v) => Math.round(t < 0 ? v * (1 + t) : v + (255 - v) * t));
  return out.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function colorOf(e: X | undefined, theme: string[]): string | undefined {
  if (!e || e.attrs.auto === "1" || e.attrs.auto === "true") return undefined;
  let hex: string | undefined;
  const rgb = e.attrs.rgb;
  if (rgb && /^[0-9a-f]{6,8}$/i.test(rgb)) hex = rgb.slice(-6).toUpperCase();
  else if (e.attrs.theme !== undefined) hex = theme[Number(e.attrs.theme)];
  else if (e.attrs.indexed !== undefined) hex = INDEXED[Number(e.attrs.indexed)]; // 64/65 = system colours: none
  if (!hex) return undefined;
  const t = Number(e.attrs.tint ?? 0);
  return tint(hex, Number.isFinite(t) ? t : 0);
}

const flag = (e: X | undefined) => !!e && e.attrs.val !== "0" && e.attrs.val !== "false" && e.attrs.val !== "none";

interface Font {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  size?: number;
  color?: string;
  family: Family;
}

/** Bundled faces with the same metrics as Office's fonts, so columns fit as they do in Excel. */
export function familyOf(name: string | undefined): Family {
  const n = (name ?? "").toLowerCase();
  if (n.startsWith("calibri")) return "carlito";
  if (n.startsWith("cambria")) return "caladea";
  if (/times|georgia|garamond|book antiqua|palatino|serif/.test(n) && !n.includes("sans")) return "serif";
  if (/courier|consolas|mono|lucida console/.test(n)) return "mono";
  return "sans";
}

function readFont(e: X, theme: string[]): Font {
  const sz = Number(kid(e, "sz")?.attrs.val);
  return {
    bold: flag(kid(e, "b")),
    italic: flag(kid(e, "i")),
    underline: flag(kid(e, "u")),
    strike: flag(kid(e, "strike")),
    size: Number.isFinite(sz) && sz > 0 ? sz : undefined,
    color: colorOf(kid(e, "color"), theme),
    family: familyOf(kid(e, "name")?.attrs.val),
  };
}

function readFill(e: X, theme: string[]): string | undefined {
  const p = kid(e, "patternFill");
  if (p) {
    const type = p.attrs.patterntype;
    if (!type || type === "none") return undefined;
    // solid fills put the colour in fgColor; for other patterns fgColor is the dominant ink too
    return colorOf(kid(p, "fgColor"), theme) ?? colorOf(kid(p, "bgColor"), theme);
  }
  const g = kid(e, "gradientFill");
  if (g) return colorOf(kid(kid(g, "stop"), "color"), theme);
  return undefined;
}

const ALIGN: Record<string, CellStyle["align"]> = {
  left: "left",
  right: "right",
  center: "center",
  centerContinuous: "center",
  justify: "justify",
  distributed: "justify",
  fill: "left",
};

/** The style each cellXfs entry stands for, against the workbook's default font. */
function readXfs(xml: string, theme: string[]): { xfs: (CellStyle | undefined)[]; baseSize: number; baseFamily: Family } {
  const root = parseXml(xml);
  const fonts = kids(find(root, "fonts"), "font").map((f) => readFont(f, theme));
  const fills = kids(find(root, "fills"), "fill").map((f) => readFill(f, theme));
  const borders = kids(find(root, "borders"), "border").map((b) => readBorder(b, theme));
  const base = fonts[0];
  const baseSize = base?.size ?? 11;
  const baseFamily = base?.family ?? "sans";
  const xfs = kids(find(root, "cellXfs"), "xf").map((xf): CellStyle | undefined => {
    const s: CellStyle = {};
    const font = fonts[Number(xf.attrs.fontid ?? 0)];
    if (font) {
      if (font.bold) s.bold = true;
      if (font.italic) s.italic = true;
      if (font.underline) s.underline = true;
      if (font.strike) s.strike = true;
      if (font.size && font.size !== baseSize) s.size = font.size;
      if (font.family !== baseFamily) s.family = font.family;
      // black is what the PDF uses anyway
      if (font.color && font.color !== "000000") s.color = font.color;
    }
    const fill = fills[Number(xf.attrs.fillid ?? 0)];
    if (fill && fill !== "FFFFFF") s.fill = fill;
    const al = kid(xf, "alignment");
    const h = al?.attrs.horizontal;
    if (h && ALIGN[h]) s.align = ALIGN[h];
    const v = al?.attrs.vertical;
    if (v === "top") s.valign = "top";
    else if (v === "center" || v === "distributed" || v === "justify") s.valign = "middle";
    if (al?.attrs.wraptext === "1" || al?.attrs.wraptext === "true" || al?.attrs.shrinktofit === "1") s.wrap = true;
    const border = borders[Number(xf.attrs.borderid ?? 0)];
    if (border) s.border = border;
    return Object.keys(s).length ? s : undefined;
  });
  return { xfs, baseSize, baseFamily };
}

/** Line widths in points for Excel's border styles. */
const EDGE_WIDTH: Record<string, number> = {
  hair: 0.25,
  thin: 0.5,
  dotted: 0.5,
  dashed: 0.5,
  dashDot: 0.5,
  dashDotDot: 0.5,
  medium: 1,
  mediumDashed: 1,
  mediumDashDot: 1,
  mediumDashDotDot: 1,
  slantDashDot: 1,
  double: 1.5,
  thick: 1.5,
};

function readBorder(e: X, theme: string[]): CellStyle["border"] {
  const out: NonNullable<CellStyle["border"]> = {};
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const el = kid(e, side) ?? (side === "left" ? kid(e, "start") : side === "right" ? kid(e, "end") : undefined);
    const style = el?.attrs.style;
    if (!el || !style || style === "none") continue;
    out[side] = { width: EDGE_WIDTH[style] ?? 0.5, color: colorOf(kid(el, "color"), theme) ?? "000000" };
  }
  return Object.keys(out).length ? out : undefined;
}

function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `xl/${target}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(p);
  }
  return out.join("/");
}

const num = (v: string | undefined) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
const yes = (v: string | undefined) => v === "1" || v === "true";

/** Page setup elements, read from the sheet XML outside sheetData (which can be huge). */
function readSetup(xml: string): PageSetup {
  const end = xml.lastIndexOf("</sheetData>");
  const head = xml.slice(0, Math.max(0, xml.indexOf("<sheetData")));
  const tail = end >= 0 ? xml.slice(end) : "";
  const tag = (src: string, name: string) => {
    const m = new RegExp(`<(?:[\\w-]+:)?${name}\\b([^>]*?)\\/?>`).exec(src);
    if (!m) return undefined;
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([\w:]+)="([^"]*)"/g)) attrs[a[1].toLowerCase()] = a[2];
    return attrs;
  };
  const out: PageSetup = {};
  const fit = tag(head, "pageSetUpPr");
  if (fit && yes(fit.fittopage)) out.fitToPage = true;
  const fmt = tag(head, "sheetFormatPr");
  out.defaultRowHeight = num(fmt?.defaultrowheight);
  out.defaultColWidth = num(fmt?.defaultcolwidth);
  const ps = tag(tail, "pageSetup");
  if (ps) {
    out.paperSize = num(ps.papersize);
    if (ps.orientation === "landscape") out.landscape = true;
    out.scale = num(ps.scale);
    out.fitToWidth = num(ps.fittowidth);
    out.fitToHeight = num(ps.fittoheight);
  }
  const pm = tag(tail, "pageMargins");
  if (pm) {
    const [l, r, t, b] = [pm.left, pm.right, pm.top, pm.bottom].map(num);
    if (l !== undefined && r !== undefined && t !== undefined && b !== undefined) out.margins = { left: l, right: r, top: t, bottom: b };
  }
  const po = tag(tail, "printOptions");
  if (po) {
    if (yes(po.gridlines)) out.gridLines = true;
    if (yes(po.horizontalcentered)) out.centerH = true;
  }
  return out;
}

const CELL_RE = /<(?:[\w-]+:)?c\s([^>]*?)\/?>/g;
const ATTR_R = /(?:^|\s)r="([A-Z]+\d+)"/;
const ATTR_S = /(?:^|\s)s="(\d+)"/;

/** Styles for every sheet, keyed by name. Returns null when the file isn't an .xlsx package (e.g. .xls, .ods). */
export async function readWorkbookStyles(data: ArrayBuffer | Uint8Array): Promise<WorkbookStyles | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    return null;
  }
  const text = (p: string) => zip.file(p)?.async("string");
  const [wbXml, relsXml, stylesXml] = await Promise.all([text("xl/workbook.xml"), text("xl/_rels/workbook.xml.rels"), text("xl/styles.xml")]);
  if (!wbXml || !relsXml) return null;
  const themePath = Object.keys(zip.files).find((p) => /^xl\/theme\/theme\d*\.xml$/.test(p));
  const theme = readTheme(themePath ? await text(themePath) : undefined);
  const { xfs, baseSize, baseFamily } = stylesXml ? readXfs(stylesXml, theme) : { xfs: [], baseSize: 11, baseFamily: "sans" as Family };

  const rels = new Map<string, string>();
  for (const r of kids(find(parseXml(relsXml), "Relationships"), "Relationship")) {
    if (r.attrs.id && r.attrs.target) rels.set(r.attrs.id, resolveTarget(r.attrs.target));
  }
  const sheets = new Map<string, SheetStyles>();
  for (const s of kids(find(parseXml(wbXml), "sheets"), "sheet")) {
    const part = rels.get(s.attrs["r:id"] ?? "");
    const xml = part ? await text(part) : undefined;
    const cells = new Map<string, CellStyle>();
    if (xml && xfs.length) {
      for (const m of xml.matchAll(CELL_RE)) {
        const r = ATTR_R.exec(m[1])?.[1];
        const si = ATTR_S.exec(m[1])?.[1];
        if (!r || !si) continue;
        const style = xfs[Number(si)];
        if (style) cells.set(r, style);
      }
    }
    sheets.set(s.attrs.name ?? "", { cells, setup: xml ? readSetup(xml) : {} });
  }
  return { baseSize, baseFamily, sheets };
}

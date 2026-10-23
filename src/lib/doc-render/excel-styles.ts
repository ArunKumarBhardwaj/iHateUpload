/**
 * Cell formatting from an .xlsx package: fonts, solid fills and alignment per cell.
 * The community build of SheetJS only reads fills, so styles.xml and each sheet's style
 * indexes are read here directly. Sheet XML is scanned with a regex, not parsed, so large
 * sheets stay fast.
 */
import JSZip from "jszip";

import { parseHtml, type HNode } from "../word-to-pdf/html";

export interface CellStyle {
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
}

export interface WorkbookStyles {
  /** the workbook's default font size, which cell sizes are relative to */
  baseSize: number;
  /** sheet name -> cell reference (e.g. "B4") -> style */
  sheets: Map<string, Map<string, CellStyle>>;
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
function readXfs(xml: string, theme: string[]): { xfs: (CellStyle | undefined)[]; baseSize: number } {
  const root = parseXml(xml);
  const fonts = kids(find(root, "fonts"), "font").map((f) => readFont(f, theme));
  const fills = kids(find(root, "fills"), "fill").map((f) => readFill(f, theme));
  const base = fonts[0];
  const baseSize = base?.size ?? 11;
  const xfs = kids(find(root, "cellXfs"), "xf").map((xf): CellStyle | undefined => {
    const s: CellStyle = {};
    const font = fonts[Number(xf.attrs.fontid ?? 0)];
    if (font) {
      if (font.bold) s.bold = true;
      if (font.italic) s.italic = true;
      if (font.underline) s.underline = true;
      if (font.strike) s.strike = true;
      if (font.size && font.size !== baseSize) s.size = font.size;
      // black is what the PDF uses anyway
      if (font.color && font.color !== "000000") s.color = font.color;
    }
    const fill = fills[Number(xf.attrs.fillid ?? 0)];
    if (fill && fill !== "FFFFFF") s.fill = fill;
    const h = kid(xf, "alignment")?.attrs.horizontal;
    if (h && ALIGN[h]) s.align = ALIGN[h];
    return Object.keys(s).length ? s : undefined;
  });
  return { xfs, baseSize };
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
  const { xfs, baseSize } = stylesXml ? readXfs(stylesXml, theme) : { xfs: [], baseSize: 11 };

  const rels = new Map<string, string>();
  for (const r of kids(find(parseXml(relsXml), "Relationships"), "Relationship")) {
    if (r.attrs.id && r.attrs.target) rels.set(r.attrs.id, resolveTarget(r.attrs.target));
  }
  const sheets = new Map<string, Map<string, CellStyle>>();
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
    sheets.set(s.attrs.name ?? "", cells);
  }
  return { baseSize, sheets };
}

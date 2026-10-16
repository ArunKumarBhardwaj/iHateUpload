/**
 * What mammoth drops but Word documents say: image extents, table grids/widths/shading/borders,
 * and style properties (fonts, sizes, colours, spacing). Reads the docx's own XML parts.
 */
import { familyForFont } from "./font-map";
import { parseHtml, type HNode } from "./html";
import type { Family, LineSpec, ParaBase, Spacing, TableInfo } from "./model";

export interface StyleProps extends ParaBase {
  spacing?: Spacing;
}
export interface StyleSet {
  normal: StyleProps;
  heading: Record<number, StyleProps>;
  title?: StyleProps;
}
export interface DocxInfo {
  /** drawn size of each picture in points, in document order */
  images: { w: number; h: number }[];
  /** every table, outer before nested, in document order */
  tables: TableInfo[];
  styles: StyleSet;
}

type El = Extract<HNode, { tag: string }>;
const isEl = (n: HNode): n is El => "tag" in n;

function find(nodes: HNode[], tag: string, out: El[] = []): El[] {
  for (const n of nodes) {
    if (!isEl(n)) continue;
    if (n.tag === tag) out.push(n);
    find(n.children, tag, out);
  }
  return out;
}
const child = (n: El, tag: string): El | undefined => n.children.find((c): c is El => isEl(c) && c.tag === tag);
const kids = (n: El, tag: string): El[] => n.children.filter((c): c is El => isEl(c) && c.tag === tag);
const num = (v: string | undefined) => (v !== undefined && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : undefined);
const hex = (v: string | undefined) => (v && /^[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : undefined);

// ---- tables ---------------------------------------------------------------------------------

const NO_BORDER = new Set(["nil", "none", ""]);

function tableInfo(tbl: El): TableInfo {
  const pr = child(tbl, "w:tblpr");
  const grid = kids(child(tbl, "w:tblgrid") ?? { tag: "", attrs: {}, children: [] }, "w:gridcol")
    .map((g) => (num(g.attrs["w:w"]) ?? 0) / 20)
    .filter((w) => w > 0);
  const info: TableInfo = { grid, borders: null, fills: [] };

  const w = pr && child(pr, "w:tblw");
  if (w) {
    const type = w.attrs["w:type"];
    const raw = w.attrs["w:w"] ?? "";
    if (type === "pct") info.widthPct = raw.endsWith("%") ? parseFloat(raw) : (num(raw) ?? 0) / 50;
    else if (type === "dxa") info.widthPt = (num(raw) ?? 0) / 20;
    if (info.widthPct !== undefined && !(info.widthPct > 0)) delete info.widthPct;
    if (info.widthPt !== undefined && !(info.widthPt > 0)) delete info.widthPt;
  }

  const borders = pr && child(pr, "w:tblborders");
  if (borders) {
    const sides = borders.children.filter((c): c is El => isEl(c) && !NO_BORDER.has(c.attrs["w:val"] ?? ""));
    if (sides.length) {
      const s = sides[0];
      info.borders = {
        color: hex(s.attrs["w:color"]) ?? "000000",
        width: Math.max(0.25, (num(s.attrs["w:sz"]) ?? 4) / 8),
      };
    }
  } else if (pr && child(pr, "w:tblstyle")) {
    info.borders = { color: "000000", width: 0.5 };
  }

  for (const tr of kids(tbl, "w:tr")) {
    info.fills.push(
      kids(tr, "w:tc").map((tc) => {
        const shd = child(child(tc, "w:tcpr") ?? { tag: "", attrs: {}, children: [] }, "w:shd");
        return hex(shd?.attrs["w:fill"]);
      }),
    );
  }
  return info;
}

function collectTables(nodes: HNode[], out: TableInfo[]) {
  for (const n of nodes) {
    if (!isEl(n)) continue;
    if (n.tag === "w:tbl") out.push(tableInfo(n));
    collectTables(n.children, out);
  }
}

// ---- styles ---------------------------------------------------------------------------------

function merge(a: StyleProps, b: StyleProps): StyleProps {
  const out: StyleProps = { ...a };
  for (const k of ["family", "size", "color", "bold", "italic"] as const) {
    if (b[k] !== undefined) (out as Record<string, unknown>)[k] = b[k];
  }
  if (a.spacing || b.spacing) out.spacing = { ...a.spacing, ...stripUndefined(b.spacing) };
  return out;
}
function stripUndefined<T extends object>(o: T | undefined): T {
  return Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as T;
}

function toggle(n: El | undefined): boolean | undefined {
  if (!n) return undefined;
  const v = n.attrs["w:val"];
  return !(v === "0" || v === "false" || v === "off");
}

function readRPr(rpr: El | undefined, theme: { major?: string; minor?: string }): StyleProps {
  if (!rpr) return {};
  const out: StyleProps = {};
  const fonts = child(rpr, "w:rfonts");
  if (fonts) {
    const theme_ = fonts.attrs["w:asciitheme"] ?? fonts.attrs["w:hansitheme"];
    const name = fonts.attrs["w:ascii"] ?? fonts.attrs["w:hansi"] ?? (theme_ ? (theme_.startsWith("major") ? theme.major : theme.minor) : undefined);
    const fam = familyForFont(name);
    if (fam) out.family = fam;
  }
  const sz = num(child(rpr, "w:sz")?.attrs["w:val"]);
  if (sz && sz > 0) out.size = sz / 2;
  const color = hex(child(rpr, "w:color")?.attrs["w:val"]);
  if (color && color !== "000000") out.color = color;
  const b = toggle(child(rpr, "w:b"));
  if (b !== undefined) out.bold = b;
  const i = toggle(child(rpr, "w:i"));
  if (i !== undefined) out.italic = i;
  return out;
}

function readPPr(ppr: El | undefined): Spacing | undefined {
  const sp = ppr && child(ppr, "w:spacing");
  if (!sp) return undefined;
  const s: Spacing = {};
  const before = num(sp.attrs["w:before"]);
  const after = num(sp.attrs["w:after"]);
  if (before !== undefined) s.before = before / 20;
  if (after !== undefined) s.after = after / 20;
  const line = num(sp.attrs["w:line"]);
  if (line !== undefined && line > 0) {
    const rule = sp.attrs["w:linerule"] ?? "auto";
    const spec: LineSpec =
      rule === "exact" ? { kind: "exact", v: line / 20 } : rule === "atLeast" ? { kind: "atLeast", v: line / 20 } : { kind: "mult", v: line / 240 };
    s.line = spec;
  }
  return Object.keys(s).length ? s : undefined;
}

function readStyles(stylesXml: string | undefined, themeXml: string | undefined): StyleSet {
  const empty: StyleSet = { normal: {}, heading: {} };
  if (!stylesXml) return empty;
  const theme: { major?: string; minor?: string } = {};
  if (themeXml) {
    const t = parseHtml(themeXml);
    theme.major = child(find(t, "a:majorfont")[0] ?? ({ tag: "", attrs: {}, children: [] } as El), "a:latin")?.attrs.typeface;
    theme.minor = child(find(t, "a:minorfont")[0] ?? ({ tag: "", attrs: {}, children: [] } as El), "a:latin")?.attrs.typeface;
  }
  const root = parseHtml(stylesXml);
  const defaults = find(root, "w:docdefaults")[0];
  let base: StyleProps = {};
  if (defaults) {
    const r = child(child(defaults, "w:rprdefault") ?? ({ tag: "", attrs: {}, children: [] } as El), "w:rpr");
    const p = child(child(defaults, "w:ppr" + "default") ?? ({ tag: "", attrs: {}, children: [] } as El), "w:ppr");
    base = { ...readRPr(r, theme) };
    const sp = readPPr(p);
    if (sp) base.spacing = sp;
  }
  // no default font in docDefaults: Word falls back to the theme's body font
  if (!base.family && theme.minor) base.family = familyForFont(theme.minor);
  const own = new Map<string, { name: string; basedOn?: string; props: StyleProps; def: boolean }>();
  for (const st of find(root, "w:style")) {
    if (st.attrs["w:type"] !== "paragraph") continue;
    const id = st.attrs["w:styleid"];
    if (!id) continue;
    const props = readRPr(child(st, "w:rpr"), theme);
    const sp = readPPr(child(st, "w:ppr"));
    if (sp) props.spacing = sp;
    own.set(id, {
      name: (child(st, "w:name")?.attrs["w:val"] ?? "").toLowerCase(),
      basedOn: child(st, "w:basedon")?.attrs["w:val"],
      props,
      def: st.attrs["w:default"] === "1" || st.attrs["w:default"] === "true",
    });
  }
  const resolve = (id: string | undefined, depth = 0): StyleProps => {
    const s = id ? own.get(id) : undefined;
    if (!s || depth > 12) return {};
    return merge(resolve(s.basedOn, depth + 1), s.props);
  };
  const defaultId = [...own.entries()].find(([, v]) => v.def)?.[0];
  const set: StyleSet = { normal: merge(base, resolve(defaultId)), heading: {} };
  for (const [id, s] of own) {
    const m = /^heading ?(\d)$/i.exec(id) ?? /^heading (\d)$/.exec(s.name);
    if (m) set.heading[Number(m[1])] = merge(base, resolve(id));
    else if (id.toLowerCase() === "title" || s.name === "title") set.title = merge(base, resolve(id));
  }
  return set;
}

export function parseDocxInfo(parts: { document: string; styles?: string; theme?: string }): DocxInfo {
  const doc = parseHtml(parts.document);
  const images: { w: number; h: number }[] = [];
  for (const d of find(doc, "w:drawing")) {
    if (!find(d.children, "a:blip").length) continue;
    const ext = find(d.children, "wp:extent")[0];
    const cx = num(ext?.attrs.cx);
    const cy = num(ext?.attrs.cy);
    images.push(cx && cy ? { w: cx / 12700, h: cy / 12700 } : { w: 0, h: 0 });
  }
  const tables: TableInfo[] = [];
  collectTables(doc, tables);
  return { images, tables, styles: readStyles(parts.styles, parts.theme) };
}

export type { Family };

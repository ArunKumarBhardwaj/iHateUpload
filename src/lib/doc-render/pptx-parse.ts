/**
 * PowerPoint (.pptx) -> positioned slide content. Reads the package, resolves layouts, masters and
 * theme colours, and returns per-slide drawing ops in points. No layout of text happens here.
 */
import JSZip from "jszip";

import { parseHtml, type HNode } from "../word-to-pdf/html";
import type { Family } from "../word-to-pdf/model";

export type X = Extract<HNode, { tag: string }>;
const isX = (n: HNode): n is X => "tag" in n;

const kids = (e: X | undefined, tag?: string): X[] =>
  (e?.children ?? []).filter((c): c is X => isX(c) && (!tag || c.tag === tag));
const kid = (e: X | undefined, tag: string): X | undefined => kids(e, tag)[0];
const path = (e: X | undefined, ...tags: string[]): X | undefined => tags.reduce<X | undefined>((cur, t) => kid(cur, t), e);
const num = (v: string | undefined, d = 0) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d);
const EMU = 12700;
const pt = (v: string | undefined, d = 0) => num(v, d) / EMU;
const textOf = (n: HNode): string => (isX(n) ? n.children.map(textOf).join("") : n.text);

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  size?: number;
  color?: string;
  family?: Family;
  href?: string;
  field?: "slidenum";
  br?: boolean;
}
export interface Para {
  runs: Run[];
  align?: "left" | "center" | "right" | "justify";
  level: number;
  bullet?: { kind: "char"; ch: string } | { kind: "num" } | null;
  before?: number;
  after?: number;
  lineMult?: number;
  endSize?: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Op =
  | { k: "shape"; box: Box; geom: string; fill?: string; line?: { color: string; w: number }; adj?: number; flipH?: boolean; flipV?: boolean }
  | { k: "line"; x1: number; y1: number; x2: number; y2: number; color: string; w: number }
  | { k: "text"; box: Box; paras: Para[]; anchor: "t" | "ctr" | "b"; inset: [number, number, number, number]; scale: number; fit?: boolean }
  | { k: "pic"; box: Box; data: Uint8Array; mime: string }
  | { k: "table"; box: Box; cols: number[]; rows: { h: number; cells: { paras: Para[]; fill?: string; span: number }[] }[] };

export interface Slide {
  width: number;
  height: number;
  bg?: string;
  ops: Op[];
  hidden: boolean;
}

interface Theme {
  [name: string]: string;
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", tif: "image/tiff", tiff: "image/tiff" };

function parseXml(s: string): X {
  return { tag: "#root", attrs: {}, children: parseHtml(s) };
}

function hslFromHex(h: string): [number, number, number] {
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const hue = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hue / 6, s, l];
}
function hexFromHsl(h: number, s: number, l: number): string {
  const f = (p: number, q: number, t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  let r = l, g = l, b = l;
  if (s) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = f(p, q, h + 1 / 3);
    g = f(p, q, h);
    b = f(p, q, h - 1 / 3);
  }
  return [r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

const SCHEME_ALIAS: Record<string, string> = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };

function colorOf(holder: X | undefined, theme: Theme, ph?: string): string | undefined {
  const c = kids(holder).find((k) => ["a:srgbclr", "a:schemeclr", "a:sysclr", "a:prstclr"].includes(k.tag));
  if (!c) return undefined;
  let hex: string | undefined;
  if (c.tag === "a:srgbclr") hex = c.attrs.val?.toUpperCase();
  else if (c.tag === "a:sysclr") hex = (c.attrs.lastclr ?? (c.attrs.val === "window" ? "FFFFFF" : "000000")).toUpperCase();
  else if (c.tag === "a:prstclr") hex = c.attrs.val === "white" ? "FFFFFF" : c.attrs.val === "black" ? "000000" : undefined;
  else {
    const v = c.attrs.val ?? "";
    hex = v === "phClr".toLowerCase() || v === "phclr" ? ph : theme[SCHEME_ALIAS[v] ?? v];
  }
  if (!hex || !/^[0-9A-F]{6}$/.test(hex)) return undefined;
  const [h, s0, l0] = hslFromHex(hex);
  let s = s0, l = l0;
  for (const m of kids(c)) {
    const v = num(m.attrs.val, 100000) / 100000;
    if (m.tag === "a:lummod") l *= v;
    else if (m.tag === "a:lumoff") l += v;
    else if (m.tag === "a:satmod") s = Math.min(1, s * v);
    else if (m.tag === "a:shade") l *= v;
    else if (m.tag === "a:tint") l = l + (1 - l) * (1 - v);
  }
  return hexFromHsl(h, s, l);
}

/** The solid colour of a fill holder (spPr, ln, bgPr...), "none" for noFill, undefined when unspecified. */
function fillOf(holder: X | undefined, theme: Theme): string | undefined {
  if (!holder) return undefined;
  if (kid(holder, "a:nofill")) return "none";
  const sf = kid(holder, "a:solidfill");
  if (sf) return colorOf(sf, theme);
  const gf = kid(holder, "a:gradfill");
  if (gf) return colorOf(kid(path(gf, "a:gslst") as X | undefined ?? gf, "a:gs"), theme);
  return undefined;
}

export function familyFor(face: string | undefined): Family | undefined {
  if (!face) return undefined;
  const f = face.toLowerCase();
  if (f.startsWith("+")) return undefined;
  if (/calibri|carlito/.test(f)) return "carlito";
  if (/cambria|caladea/.test(f)) return "caladea";
  if (/courier|consolas|mono|menlo/.test(f)) return "mono";
  if (/times|georgia|garamond|palatino|serif|book antiqua/.test(f) && !/sans/.test(f)) return "serif";
  return "sans";
}

interface PhStyle {
  size?: number;
  color?: string;
  bold?: boolean;
  family?: Family;
  align?: Para["align"];
  bullet?: Para["bullet"];
}

async function readRels(zip: JSZip, file: string): Promise<Map<string, string>> {
  const dir = file.slice(0, file.lastIndexOf("/") + 1);
  const rel = `${dir}_rels/${file.slice(file.lastIndexOf("/") + 1)}.rels`;
  const raw = await zip.file(rel)?.async("string");
  const m = new Map<string, string>();
  if (!raw) return m;
  for (const r of kids(parseXml(raw), undefined).flatMap((x) => kids(x, "relationship"))) {
    const t = r.attrs.target ?? "";
    if (r.attrs.targetmode?.toLowerCase() === "external") m.set(r.attrs.id, t);
    else m.set(r.attrs.id, resolvePath(dir, t));
  }
  return m;
}

function resolvePath(dir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = (dir + target).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(p);
  }
  return out.join("/");
}

function lvlStyle(styles: X | undefined, lvl: number, theme: Theme): PhStyle {
  const p = kid(styles, `a:lvl${lvl + 1}ppr`);
  if (!p) return {};
  const d = kid(p, "a:defrpr");
  const bu = kid(p, "a:buchar");
  return {
    size: d?.attrs.sz ? num(d.attrs.sz) / 100 : undefined,
    color: colorOf(kid(d, "a:solidfill"), theme),
    bold: d?.attrs.b !== undefined ? d.attrs.b === "1" : undefined,
    family: familyFor(kid(d, "a:latin")?.attrs.typeface),
    align: algn(p.attrs.algn),
    bullet: kid(p, "a:bunone") ? null : bu ? { kind: "char", ch: bu.attrs.char ?? "•" } : kid(p, "a:buautonum") ? { kind: "num" } : undefined,
  };
}

function algn(v: string | undefined): Para["align"] | undefined {
  return v === "ctr" ? "center" : v === "r" ? "right" : v === "just" || v === "dist" ? "justify" : v === "l" ? "left" : undefined;
}

interface Master {
  tree: X;
  title: X | undefined;
  body: X | undefined;
  other: X | undefined;
  bg?: string;
  theme: Theme;
}

interface LayoutInfo {
  tree: X;
  master: Master;
  rels: Map<string, string>;
}

function xfrmBox(sp: X | undefined): Box | undefined {
  const x = path(sp, "p:sppr", "a:xfrm") ?? kid(sp, "p:xfrm") ?? path(sp, "a:xfrm");
  const off = kid(x, "a:off");
  const ext = kid(x, "a:ext");
  if (!x || !off || !ext) return undefined;
  return { x: pt(off.attrs.x), y: pt(off.attrs.y), w: pt(ext.attrs.cx), h: pt(ext.attrs.cy) };
}

function phOf(sp: X): { type?: string; idx?: string } | undefined {
  const ph = path(sp, "p:nvsppr", "p:nvpr", "p:ph");
  return ph ? { type: ph.attrs.type, idx: ph.attrs.idx } : undefined;
}

function findPh(tree: X, ph: { type?: string; idx?: string }): X | undefined {
  const tr = kid(kid(kid(tree, "p:sld") ?? kid(tree, "p:sldlayout") ?? kid(tree, "p:sldmaster"), "p:csld"), "p:sptree");
  const sps = kids(tr, "p:sp");
  const same = (o: { type?: string; idx?: string }) =>
    (ph.idx !== undefined && o.idx === ph.idx) || (ph.type !== undefined && o.type === ph.type) || (ph.type === undefined && ph.idx === undefined);
  return sps.find((s) => {
    const p = phOf(s);
    return p && same(p);
  });
}

function titleLike(type: string | undefined) {
  const t = type?.toLowerCase();
  return t === "title" || t === "ctrtitle";
}

export async function parsePptx(data: ArrayBuffer | Uint8Array, warnings: string[]): Promise<Slide[]> {
  const zip = await JSZip.loadAsync(data);
  const text = async (f: string) => zip.file(f)?.async("string");
  const pres = await text("ppt/presentation.xml");
  if (!pres) throw new Error("This file is not a PowerPoint presentation.");
  const presTree = parseXml(pres);
  const root = kid(presTree, "p:presentation");
  const sz = kid(root, "p:sldsz");
  const W = pt(sz?.attrs.cx, 9144000);
  const H = pt(sz?.attrs.cy, 6858000);

  const presRels = await readRels(zip, "ppt/presentation.xml");
  let slideFiles = kids(kid(root, "p:sldidlst"), "p:sldid").map((s) => presRels.get(s.attrs["r:id"] ?? "")).filter((f): f is string => !!f && !!zip.file(f));
  if (!slideFiles.length) {
    slideFiles = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n)).sort((a, b) => Number(a.match(/(\d+)\.xml/)?.[1]) - Number(b.match(/(\d+)\.xml/)?.[1]));
  }
  if (!slideFiles.length) throw new Error("This PowerPoint file has no slides.");

  const themeCache = new Map<string, Theme>();
  const loadTheme = async (file: string | undefined): Promise<Theme> => {
    const key = file ?? "";
    const hit = themeCache.get(key);
    if (hit) return hit;
    const theme: Theme = { dk1: "000000", lt1: "FFFFFF", dk2: "44546A", lt2: "E7E6E6", accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5", accent4: "FFC000", accent5: "5B9BD5", accent6: "70AD47", hlink: "0563C1", folhlink: "954F72" };
    const raw = file ? await text(file) : undefined;
    if (raw) {
      const cs = path(parseXml(raw), "a:theme", "a:themeelements", "a:clrscheme");
      for (const c of kids(cs)) {
        const inner = kids(c)[0];
        const v = inner?.attrs.val && /^[0-9a-f]{6}$/i.test(inner.attrs.val) ? inner.attrs.val : inner?.attrs.lastclr;
        if (v) theme[c.tag.replace("a:", "")] = v.toUpperCase();
      }
    }
    themeCache.set(key, theme);
    return theme;
  };

  const masterCache = new Map<string, Master>();
  const loadMaster = async (file: string): Promise<Master> => {
    const hit = masterCache.get(file);
    if (hit) return hit;
    const rels = await readRels(zip, file);
    const theme = await loadTheme([...rels.values()].find((v) => v.includes("theme/")));
    const tree = parseXml((await text(file)) ?? "");
    const m = kid(tree, "p:sldmaster");
    const tx = kid(m, "p:txstyles");
    const bgPr = path(m, "p:csld", "p:bg", "p:bgpr");
    const bgRef = path(m, "p:csld", "p:bg", "p:bgref");
    const master: Master = {
      tree,
      title: kid(tx, "p:titlestyle"),
      body: kid(tx, "p:bodystyle"),
      other: kid(tx, "p:otherstyle"),
      bg: fillOf(bgPr, theme) ?? colorOf(bgRef, theme),
      theme,
    };
    masterCache.set(file, master);
    return master;
  };
  const layoutCache = new Map<string, LayoutInfo>();
  const loadLayout = async (file: string): Promise<LayoutInfo> => {
    const hit = layoutCache.get(file);
    if (hit) return hit;
    const rels = await readRels(zip, file);
    const mFile = [...rels.values()].find((v) => v.includes("slideMasters/"));
    const info: LayoutInfo = { tree: parseXml((await text(file)) ?? ""), master: await loadMaster(mFile ?? ""), rels };
    layoutCache.set(file, info);
    return info;
  };

  const slides: Slide[] = [];
  let unsupported = 0;
  for (const file of slideFiles) {
    const rels = await readRels(zip, file);
    const tree = parseXml((await text(file)) ?? "");
    const sld = kid(tree, "p:sld");
    const layoutFile = [...rels.values()].find((v) => v.includes("slideLayouts/"));
    const layout = layoutFile ? await loadLayout(layoutFile) : undefined;
    const master = layout?.master ?? (await loadMaster([...masterCache.keys()][0] ?? ""));
    const theme = master.theme;
    const bg =
      fillOf(path(sld, "p:csld", "p:bg", "p:bgpr"), theme) ??
      colorOf(path(sld, "p:csld", "p:bg", "p:bgref"), theme) ??
      fillOf(path(layout?.tree, "p:sldlayout", "p:csld", "p:bg", "p:bgpr"), theme) ??
      master.bg;
    const slide: Slide = { width: W, height: H, bg: bg === "none" ? undefined : bg, ops: [], hidden: sld?.attrs.show === "0" };

    const ctxBase = { zip, theme, master, layout, W, H };
    // decorative shapes of the master and layout draw first, but only when the slide shows them
    const showMaster = sld?.attrs.showmastersp !== "0";
    if (layout && showMaster) {
      if (layout.tree && kid(kid(layout.tree, "p:sldlayout"), "p:csld")) {
        for (const tr of [path(master.tree, "p:sldmaster", "p:csld", "p:sptree"), path(layout.tree, "p:sldlayout", "p:csld", "p:sptree")]) {
          await walkTree(tr, { ...ctxBase, rels: layout.rels, decor: true }, slide, undefined, rels, warnings, () => unsupported++);
        }
      }
    }
    await walkTree(path(sld, "p:csld", "p:sptree"), { ...ctxBase, rels, decor: false, slideTree: tree }, slide, undefined, rels, warnings, () => unsupported++);
    slides.push(slide);
  }
  if (unsupported) warnings.push(`${unsupported} chart, diagram or media object${unsupported === 1 ? "" : "s"} cannot be drawn and ${unsupported === 1 ? "was" : "were"} left out.`);
  return slides;
}

interface WalkCtx extends PartRefsLike {
  zip: JSZip;
  theme: Theme;
  master: Master;
  layout?: LayoutInfo;
  W: number;
  H: number;
  rels: Map<string, string>;
  decor: boolean;
  slideTree?: X;
}
type PartRefsLike = object;

interface Xf {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
}

function applyXf(b: Box, t: Xf | undefined): Box {
  if (!t) return b;
  return { x: t.ox + b.x * t.sx, y: t.oy + b.y * t.sy, w: b.w * t.sx, h: b.h * t.sy };
}

async function walkTree(
  tree: X | undefined,
  ctx: WalkCtx,
  slide: Slide,
  xf: Xf | undefined,
  _slideRels: Map<string, string>,
  warnings: string[],
  skipped: () => void,
): Promise<void> {
  void _slideRels;
  for (const n of kids(tree)) {
    if (n.tag === "p:grpsp") {
      const g = path(n, "p:grpsppr", "a:xfrm");
      const off = kid(g, "a:off"), ext = kid(g, "a:ext"), cho = kid(g, "a:choff"), che = kid(g, "a:chext");
      let inner = xf;
      if (g && off && ext && cho && che) {
        const gb = applyXf({ x: pt(off.attrs.x), y: pt(off.attrs.y), w: pt(ext.attrs.cx), h: pt(ext.attrs.cy) }, xf);
        const cw = pt(che.attrs.cx) || 1, ch = pt(che.attrs.cy) || 1;
        const sx = gb.w / cw, sy = gb.h / ch;
        inner = { ox: gb.x - pt(cho.attrs.x) * sx, oy: gb.y - pt(cho.attrs.y) * sy, sx, sy };
      }
      await walkTree(n, ctx, slide, inner, _slideRels, warnings, skipped);
    } else if (n.tag === "p:sp") await shape(n, ctx, slide, xf);
    else if (n.tag === "p:cxnsp") connector(n, ctx, slide, xf);
    else if (n.tag === "p:pic") await picture(n, ctx, slide, xf);
    else if (n.tag === "p:graphicframe") {
      if (!(await table(n, ctx, slide, xf))) skipped();
    }
  }
}

function connector(n: X, ctx: WalkCtx, slide: Slide, xf: Xf | undefined) {
  const sp = kid(n, "p:sppr");
  const b0 = xfrmBox(n);
  if (!b0) return;
  const b = applyXf(b0, xf);
  const x = path(sp, "a:xfrm");
  const color = fillOf(kid(sp, "a:ln"), ctx.theme) ?? colorOf(path(n, "p:style", "a:lnref"), ctx.theme) ?? "808080";
  const w = pt(kid(sp, "a:ln")?.attrs.w, 9525) || 0.75;
  const fh = x?.attrs.flipv === "1";
  const fl = x?.attrs.fliph === "1";
  slide.ops.push({ k: "line", x1: fl ? b.x + b.w : b.x, y1: fh ? b.y + b.h : b.y, x2: fl ? b.x : b.x + b.w, y2: fh ? b.y : b.y + b.h, color: color === "none" ? "808080" : color, w });
}

async function picture(n: X, ctx: WalkCtx, slide: Slide, xf: Xf | undefined) {
  const box0 = xfrmBox(n);
  const rid = kid(path(n, "p:blipfill"), "a:blip")?.attrs["r:embed"];
  const target = rid ? ctx.rels.get(rid) : undefined;
  if (!box0 || !target) return;
  const bytes = await ctx.zip.file(target)?.async("uint8array");
  const ext = target.split(".").pop()?.toLowerCase() ?? "";
  if (!bytes || !MIME[ext]) return;
  slide.ops.push({ k: "pic", box: applyXf(box0, xf), data: bytes, mime: MIME[ext] });
}

async function table(n: X, ctx: WalkCtx, slide: Slide, xf: Xf | undefined): Promise<boolean> {
  const tbl = path(n, "a:graphic", "a:graphicdata", "a:tbl");
  const x = kid(n, "p:xfrm");
  const off = kid(x, "a:off"), ext = kid(x, "a:ext");
  if (!tbl || !off || !ext) return false;
  const box = applyXf({ x: pt(off.attrs.x), y: pt(off.attrs.y), w: pt(ext.attrs.cx), h: pt(ext.attrs.cy) }, xf);
  const cols = kids(kid(tbl, "a:tblgrid"), "a:gridcol").map((c) => pt(c.attrs.w));
  const first = kid(kid(tbl, "a:tr"), "a:tc");
  void first;
  const rows = kids(tbl, "a:tr").map((r, ri) => ({
    h: pt(r.attrs.h),
    cells: kids(r, "a:tc")
      .filter((c) => c.attrs.hmerge !== "1" && c.attrs.vmerge !== "1")
      .map((c) => {
        const paras = parseParas(kid(c, "a:txbody"), ctx, {});
        const fill = fillOf(kid(c, "a:tcpr"), ctx.theme);
        const hdr = ri === 0 && tbl && kid(kid(tbl, "a:tblpr"), "a:tablestyleid") !== undefined && kid(tbl, "a:tblpr")?.attrs.firstrow === "1";
        if (hdr) for (const p of paras) for (const r of p.runs) r.bold ??= true;
        return { paras, fill: fill === "none" ? undefined : fill, span: num(c.attrs.gridspan, 1) };
      }),
  }));
  slide.ops.push({ k: "table", box, cols, rows });
  return true;
}

function parseParas(body: X | undefined, ctx: WalkCtx, ph: PhStyle & { lst?: X; mstyle?: X }, fontRefColor?: string): Para[] {
  const out: Para[] = [];
  for (const p of kids(body, "a:p")) {
    const pPr = kid(p, "a:ppr");
    const level = num(pPr?.attrs.lvl);
    const defined = (o: PhStyle) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
    // deeper levels take their size, bullet and colour from the master text style
    const mLvl = ph.mstyle && level > 0 ? defined(lvlStyle(ph.mstyle, level, ctx.theme)) : {};
    if (ph.bullet === null) delete (mLvl as PhStyle).bullet;
    const lstLvl = ph.lst ? lvlStyle(ph.lst, level, ctx.theme) : {};
    const inherited: PhStyle = { ...ph, ...mLvl, ...defined(lstLvl) };
    const bu = pPr && (kid(pPr, "a:bunone") ? null : kid(pPr, "a:buchar") ? ({ kind: "char", ch: kid(pPr, "a:buchar")?.attrs.char ?? "•" } as const) : kid(pPr, "a:buautonum") ? ({ kind: "num" } as const) : undefined);
    const para: Para = {
      runs: [],
      level,
      align: algn(pPr?.attrs.algn) ?? inherited.align,
      bullet: bu !== undefined ? bu : inherited.bullet,
    };
    const spc = (tag: string) => {
      const e = kid(pPr, tag);
      const v = kid(e, "a:spcpts")?.attrs.val;
      return v ? num(v) / 100 : undefined;
    };
    para.before = spc("a:spcbef");
    para.after = spc("a:spcaft");
    const ls = kid(kid(pPr, "a:lnspc"), "a:spcpct")?.attrs.val;
    if (ls) para.lineMult = num(ls) / 100000;
    for (const r of kids(p)) {
      if (r.tag === "a:br") {
        para.runs.push({ text: "", br: true });
      } else if (r.tag === "a:r" || r.tag === "a:fld") {
        const rp = kid(r, "a:rpr");
        const t = kids(r, "a:t").map(textOf).join("");
        const link = kid(rp, "a:hlinkclick")?.attrs["r:id"];
        const href = link ? ctx.rels.get(link) : undefined;
        para.runs.push({
          text: t,
          bold: rp?.attrs.b !== undefined ? rp.attrs.b === "1" : inherited.bold,
          italic: rp?.attrs.i === "1" ? true : undefined,
          underline: rp?.attrs.u !== undefined && rp.attrs.u !== "none",
          strike: /^(sng|dbl)Strike$/.test(rp?.attrs.strike ?? ""),
          size: rp?.attrs.sz ? num(rp.attrs.sz) / 100 : inherited.size,
          color: colorOf(kid(rp, "a:solidfill"), ctx.theme) ?? inherited.color ?? fontRefColor,
          family: familyFor(kid(rp, "a:latin")?.attrs.typeface) ?? inherited.family,
          href: href && /^(https?:|mailto:)/i.test(href) ? href : undefined,
          field: r.tag === "a:fld" && /slidenum/i.test(r.attrs.type ?? "") ? "slidenum" : undefined,
        });
      }
    }
    const end = kid(p, "a:endpararpr");
    if (end?.attrs.sz) para.endSize = num(end.attrs.sz) / 100;
    para.runs = para.runs.filter((r, i, a) => r.br || r.text || i < 0 || a.length === 0);
    if (!para.runs.some((r) => r.size) && inherited.size) para.endSize ??= inherited.size;
    out.push(para);
  }
  return out;
}

async function shape(n: X, ctx: WalkCtx, slide: Slide, xf: Xf | undefined) {
  const sp = kid(n, "p:sppr");
  const ph = phOf(n);
  if (ctx.decor && ph) return; // master/layout placeholders are prompts, not content
  let box0 = xfrmBox(n);
  let lst: X | undefined;
  const style: PhStyle = {};
  if (ph) {
    const lyPh = ctx.layout ? findPh(ctx.layout.tree, ph) : undefined;
    const maPh = findPh(ctx.master.tree, { type: titleLike(ph.type) ? "title" : ph.type && ph.type !== "obj" ? ph.type : "body" });
    box0 ??= xfrmBox(lyPh) ?? xfrmBox(maPh);
    const masterStyle = titleLike(ph.type) ? ctx.master.title : ["sldnum", "dt", "ftr"].includes(ph.type ?? "") ? ctx.master.other : ctx.master.body;
    const lv0 = lvlStyle(masterStyle, 0, ctx.theme);
    Object.assign(style, Object.fromEntries(Object.entries(lv0).filter(([, v]) => v !== undefined)));
    lst = kid(kid(lyPh, "p:txbody"), "a:lststyle") ?? kid(kid(maPh, "p:txbody"), "a:lststyle");
    const own = kid(kid(n, "p:txbody"), "a:lststyle");
    if (own) lst = own;
    // bullets: a layout placeholder that says buNone (subtitles, titles) turns them off
    const layoutNone = kid(kid(lst, "a:lvl1ppr"), "a:bunone");
    if (layoutNone) style.bullet = null;
    if (titleLike(ph.type)) style.bullet = null;
    if (["sldnum", "dt", "ftr"].includes(ph.type ?? "")) style.bullet = null;
  }
  if (!box0) return;
  const box = applyXf(box0, xf);
  const geom = kid(sp, "a:prstgeom")?.attrs.prst ?? (kid(sp, "a:custgeom") ? "rect" : "rect");
  const refFill = n.children.length ? colorOf(path(n, "p:style", "a:fillref"), ctx.theme) : undefined;
  const hasFillRefIdx = num(path(n, "p:style", "a:fillref")?.attrs.idx) > 0;
  let fill = fillOf(sp, ctx.theme);
  if (fill === undefined && hasFillRefIdx) fill = refFill;
  const lnEl = kid(sp, "a:ln");
  let lineColor = fillOf(lnEl, ctx.theme);
  if (lineColor === undefined && num(path(n, "p:style", "a:lnref")?.attrs.idx) > 0 && !kid(lnEl, "a:nofill")) lineColor = colorOf(path(n, "p:style", "a:lnref"), ctx.theme);
  const lineW = lnEl?.attrs.w ? pt(lnEl.attrs.w) : 1;
  const adj = num(kid(kid(kid(sp, "a:prstgeom"), "a:avlst"), "a:gd")?.attrs.fmla?.replace("val ", ""), NaN);
  const xr = path(sp, "a:xfrm");
  const hasShape = (fill && fill !== "none") || (lineColor && lineColor !== "none");
  if (hasShape && (!ph || fill || lineColor)) {
    if (geom === "line" || geom === "straightConnector1") {
      slide.ops.push({ k: "line", x1: box.x, y1: box.y, x2: box.x + box.w, y2: box.y + box.h, color: lineColor && lineColor !== "none" ? lineColor : "808080", w: lineW });
    } else {
      slide.ops.push({ k: "shape", box, geom, fill: fill === "none" ? undefined : fill, line: lineColor && lineColor !== "none" ? { color: lineColor, w: lineW } : undefined, adj: Number.isFinite(adj) ? adj : undefined, flipH: xr?.attrs.fliph === "1", flipV: xr?.attrs.flipv === "1" });
    }
  }
  const tb = kid(n, "p:txbody");
  if (!tb || ctx.decor && !tb) return;
  const fontRef = colorOf(path(n, "p:style", "a:fontref"), ctx.theme);
  const paras = parseParas(tb, ctx, { ...style, lst, mstyle: ph ? (titleLike(ph.type) ? ctx.master.title : ctx.master.body) : undefined }, fontRef);
  if (!paras.some((p) => p.runs.some((r) => r.text.trim() || r.field))) return;
  const bp = kid(tb, "a:bodypr");
  const anchor = bp?.attrs.anchor === "ctr" ? "ctr" : bp?.attrs.anchor === "b" ? "b" : "t";
  const ins = (k: string, d: number) => (bp?.attrs[k] !== undefined ? pt(bp.attrs[k]) : d);
  const fs = kid(bp, "a:normautofit")?.attrs.fontscale;
  // default sizes when nothing in the chain says: 18pt like PowerPoint's text box default
  slide.ops.push({
    k: "text",
    box,
    paras,
    anchor,
    inset: [ins("lins", 7.2), ins("tins", 3.6), ins("rins", 7.2), ins("bins", 3.6)],
    scale: fs ? num(fs) / 100000 : 1,
    fit: !!kid(bp, "a:normautofit"),
  });
}

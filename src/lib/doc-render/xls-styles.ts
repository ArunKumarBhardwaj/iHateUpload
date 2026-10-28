/**
 * Cell formatting from a legacy .xls workbook (Excel 97-2003, BIFF8): fonts, fills, borders and
 * alignment per cell, rich text runs and page setup, in the same shape readWorkbookStyles gives
 * for .xlsx. SheetJS reads the cell values; the records it skips are read here directly from the
 * Workbook stream of the compound file.
 */
import type { Family } from "../word-to-pdf/model";
import { familyOf, type CellStyle, type Edge, type PageSetup, type RowInfo, type Run, type RunStyle, type SheetStyles, type WorkbookStyles } from "./excel-styles";
import { isKrutiDevFont, krutiToUnicode } from "./krutidev";
import { legacyFontOf, toUnicode, type LegacyFont } from "./legacy-fonts";

/** BIFF8 record types read here. */
const R = {
  BOF: 0x0809,
  EOF: 0x000a,
  CONTINUE: 0x003c,
  FILEPASS: 0x002f,
  FONT: 0x0031,
  XF: 0x00e0,
  PALETTE: 0x0092,
  BOUNDSHEET8: 0x0085,
  SST: 0x00fc,
  LABELSST: 0x00fd,
  LABEL: 0x0204,
  RK: 0x027e,
  MULRK: 0x00bd,
  NUMBER: 0x0203,
  BLANK: 0x0201,
  MULBLANK: 0x00be,
  FORMULA: 0x0006,
  BOOLERR: 0x0205,
  SETUP: 0x00a1,
  WSBOOL: 0x0081,
  LEFTMARGIN: 0x0026,
  RIGHTMARGIN: 0x0027,
  TOPMARGIN: 0x0028,
  BOTTOMMARGIN: 0x0029,
  HCENTER: 0x0083,
  PRINTGRIDLINES: 0x002b,
  HEADER: 0x0014,
  FOOTER: 0x0015,
  HPAGEBREAKS: 0x001b,
  VPAGEBREAKS: 0x001a,
  DEFAULTROWHEIGHT: 0x0225,
  ROW: 0x0208,
  DEFCOLWIDTH: 0x0055,
  PLS: 0x004d,
} as const;

/** Excel's legacy 64-colour palette; a PALETTE record replaces entries 8..63. */
const DEFAULT_PALETTE = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

/** BIFF border line styles (0 = none), by their SpreadsheetML names. */
const LINE_STYLE = [
  "", "thin", "medium", "dashed", "dotted", "thick", "double", "hair",
  "mediumDashed", "dashDot", "mediumDashDot", "dashDotDot", "mediumDashDotDot", "slantDashDot",
];

/** Line widths in points for Excel's border styles (as in excel-styles). */
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

/** Dash patterns in points for Excel's broken border styles (as in excel-styles). */
const EDGE_DASH: Record<string, number[]> = {
  hair: [0.75, 0.75],
  dotted: [0.75, 0.75],
  dashed: [2.25, 0.75],
  dashDot: [6, 1.5, 1.5, 1.5],
  dashDotDot: [6, 1.5, 1.5, 1.5, 1.5, 1.5],
  mediumDashed: [6.75, 2.25],
  mediumDashDot: [6.75, 2.25, 2.25, 2.25],
  mediumDashDotDot: [6.75, 2.25, 2.25, 2.25, 2.25, 2.25],
  slantDashDot: [7.5, 0.75, 3, 0.75],
};

/** BIFF horizontal alignment codes: general, left, center, right, fill, justify, centre across selection, distributed. */
const ALIGN: (CellStyle["align"] | undefined)[] = [undefined, "left", "center", "right", "left", "justify", "center", "justify"];

interface Rec {
  type: number;
  data: Uint8Array;
  /** the data of the CONTINUE records that follow it */
  more: Uint8Array[];
  /** stream offset of the record header */
  pos: number;
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
  /** another legacy Indian font (AnmolLipi, SutonnyMJ, ...) whose text is converted to Unicode */
  legacy?: LegacyFont;
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Every record of a stream from `start`, with its CONTINUE records folded in. Stops at the EOF closing the substream. */
function records(stream: Uint8Array, start: number): Rec[] {
  const v = view(stream);
  const out: Rec[] = [];
  let depth = 0;
  for (let p = start; p + 4 <= stream.length; ) {
    const type = v.getUint16(p, true);
    const len = v.getUint16(p + 2, true);
    const data = stream.subarray(p + 4, Math.min(stream.length, p + 4 + len));
    if (type === R.CONTINUE && out.length) out[out.length - 1].more.push(data);
    else {
      // embedded charts nest their own BOF..EOF substreams: only the outer level is read
      if (type === R.BOF) depth++;
      if (depth <= 1) out.push({ type, data, more: [], pos: p });
      if (type === R.EOF && --depth <= 0) break;
    }
    p += 4 + len;
  }
  return out;
}

/**
 * Reads across a record and its CONTINUE records. Characters of a string that cross into a
 * CONTINUE record restart with a fresh option byte saying whether they are 8- or 16-bit.
 */
class Reader {
  private seg = 0;
  private off = 0;
  constructor(private segs: Uint8Array[]) {}
  private fit() {
    while (this.seg < this.segs.length && this.off >= this.segs[this.seg].length) {
      this.seg++;
      this.off = 0;
    }
  }
  get done() {
    this.fit();
    return this.seg >= this.segs.length;
  }
  u8(): number {
    this.fit();
    const b = this.segs[this.seg];
    if (!b) throw new RangeError("record ended");
    return b[this.off++];
  }
  u16 = () => this.u8() | (this.u8() << 8);
  u32 = () => (this.u16() | (this.u16() << 16)) >>> 0;
  skip(n: number) {
    for (let i = 0; i < n; i++) this.u8();
  }
  /** `cch` characters, 16-bit when `wide` */
  chars(cch: number, wide: boolean): string {
    let s = "";
    for (let i = 0; i < cch; i++) {
      // at a record boundary mid-string, the option byte is repeated
      if (this.off >= (this.segs[this.seg]?.length ?? 0) && this.seg + 1 < this.segs.length) {
        this.seg++;
        this.off = 0;
        wide = (this.u8() & 1) === 1;
      }
      s += String.fromCharCode(wide ? this.u16() : this.u8());
    }
    return s;
  }
  /** An XLUnicodeRichExtendedString (SST entry, or XLUnicodeString with `short` length) and its formatting runs. */
  string(short = false): { text: string; runs: [number, number][] } {
    const cch = short ? this.u8() : this.u16();
    const flags = this.u8();
    const rich = flags & 0x08 ? this.u16() : 0;
    const ext = flags & 0x04 ? this.u32() : 0;
    const text = this.chars(cch, (flags & 1) === 1);
    const runs: [number, number][] = [];
    for (let i = 0; i < rich; i++) runs.push([this.u16(), this.u16()]);
    if (ext) this.skip(ext);
    return { text, runs };
  }
}

const strOf = (data: Uint8Array, short = false) => new Reader([data]).string(short).text;

function colName(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** A palette index as hex RRGGBB; system and automatic colours (64 and up) are none. */
const colorAt = (palette: string[], icv: number): string | undefined => (icv < 64 ? palette[icv] : undefined);

function readFont(d: Uint8Array, palette: string[]): Font {
  const v = view(d);
  const name = d.length > 14 ? strOf(d.subarray(14), true) : undefined;
  const twips = v.getUint16(0, true);
  return {
    bold: v.getUint16(6, true) >= 700,
    italic: (v.getUint16(2, true) & 0x02) !== 0,
    underline: d[10] !== 0,
    strike: (v.getUint16(2, true) & 0x08) !== 0,
    size: twips > 0 ? twips / 20 : undefined,
    color: colorAt(palette, v.getUint16(4, true)),
    family: isKrutiDevFont(name) || legacyFontOf(name) ? "sans" : familyOf(name),
    kruti: isKrutiDevFont(name),
    legacy: isKrutiDevFont(name) ? undefined : legacyFontOf(name),
  };
}

/** BIFF skips font index 4: indexes above it are one past their place in the font list. */
const fontAt = (fonts: Font[], i: number) => fonts[i >= 4 ? i - 1 : i];

function edge(code: number, icv: number, palette: string[]): Edge | undefined {
  const style = LINE_STYLE[code];
  if (!style) return undefined;
  const e: Edge = { width: EDGE_WIDTH[style] ?? 0.5, color: colorAt(palette, icv) ?? "000000" };
  if (EDGE_DASH[style]) e.dash = EDGE_DASH[style];
  if (style === "double") e.double = true;
  return e;
}

/** The style an XF record stands for, against the workbook's default font, built as excel-styles builds cellXfs. */
function readXf(d: Uint8Array, fonts: Font[], palette: string[], baseSize: number, baseFamily: Family): CellStyle | undefined {
  if (d.length < 20) return undefined;
  const v = view(d);
  const s: CellStyle = {};
  const font = fontAt(fonts, v.getUint16(0, true));
  if (font) {
    if (font.bold) s.bold = true;
    if (font.italic) s.italic = true;
    if (font.underline) s.underline = true;
    if (font.strike) s.strike = true;
    if (font.size && font.size !== baseSize) s.size = font.size;
    if (font.family !== baseFamily) s.family = font.family;
    if (font.kruti) s.kruti = true;
    if (font.legacy) s.legacy = font.legacy;
    // black is what the PDF uses anyway
    if (font.color && font.color !== "000000") s.color = font.color;
  }
  const border1 = v.getUint32(10, true);
  const border2 = v.getUint32(14, true);
  const colours = v.getUint16(18, true);
  // any pattern but none: the foreground colour is the dominant ink
  const pattern = (border2 >>> 26) & 0x3f;
  if (pattern) {
    const fill = colorAt(palette, colours & 0x7f) ?? colorAt(palette, (colours >>> 7) & 0x7f);
    if (fill && fill !== "FFFFFF") s.fill = fill;
  }
  const al = d[6];
  const h = al & 0x07;
  if (ALIGN[h]) s.align = ALIGN[h];
  const vert = (al >>> 4) & 0x07;
  if (vert === 0) s.valign = "top";
  else if (vert === 1 || vert === 3 || vert === 4) s.valign = "middle";
  if (al & 0x08) s.wrap = true;
  else if (d[8] & 0x10) s.shrink = true;
  if (h === 4) s.repeat = true;
  const indent = d[8] & 0x0f;
  if (indent > 0 && (h <= 1 || h === 3 || h === 7)) s.indent = indent;
  const rot = d[7];
  if (rot === 255) s.rotate = "stacked";
  else if (rot > 0 && rot <= 90) s.rotate = rot;
  else if (rot > 90 && rot <= 180) s.rotate = 90 - rot;
  const border: NonNullable<CellStyle["border"]> = {};
  const sides = {
    left: edge(border1 & 0x0f, (border1 >>> 16) & 0x7f, palette),
    right: edge((border1 >>> 4) & 0x0f, (border1 >>> 23) & 0x7f, palette),
    top: edge((border1 >>> 8) & 0x0f, border2 & 0x7f, palette),
    bottom: edge((border1 >>> 12) & 0x0f, (border2 >>> 7) & 0x7f, palette),
  };
  for (const side of ["top", "right", "bottom", "left"] as const) if (sides[side]) border[side] = sides[side];
  if (Object.keys(border).length) s.border = border;
  return Object.keys(s).length ? s : undefined;
}

/** A shared string's runs as excel-styles has them, or null for plain text. Text before the first run uses the cell's font. */
function toRuns(text: string, runs: [number, number][], fonts: Font[]): Run[] | null {
  if (!runs.length) return null;
  const out: Run[] = [];
  if (runs[0][0] > 0) out.push({ text: text.slice(0, runs[0][0]) });
  runs.forEach(([ich, ifnt], i) => {
    const t = text.slice(ich, runs[i + 1]?.[0] ?? text.length);
    if (!t) return;
    const f = fontAt(fonts, ifnt);
    if (!f) return void out.push({ text: t });
    const style: RunStyle = { bold: f.bold, italic: f.italic, underline: f.underline, strike: f.strike, size: f.size, color: f.color, family: f.family };
    out.push({ text: f.kruti ? krutiToUnicode(t) : f.legacy ? toUnicode(f.legacy, t) : t, style });
  });
  return out.length ? out : null;
}

/** Rich text in a cell whose own font is Kruti Dev (or another legacy font): unstyled runs are in it too. */
function convertPlainRuns(runs: Run[], cell: CellStyle | undefined): Run[] {
  if (cell?.kruti) return runs.map((r) => (r.style ? r : { text: krutiToUnicode(r.text) }));
  const legacy = cell?.legacy;
  return legacy ? runs.map((r) => (r.style ? r : { text: toUnicode(legacy, r.text) })) : runs;
}

/** The paper size saved in a printer settings DEVMODE, if it has one. */
function devmodePaper(b: Uint8Array): number | undefined {
  if (b.length < 80) return undefined;
  const v = view(b);
  const DM_PAPERSIZE = 0x2;
  if (!(v.getUint32(72, true) & DM_PAPERSIZE)) return undefined;
  const paper = v.getInt16(78, true);
  return paper > 0 && paper < 256 ? paper : undefined;
}

/** One sheet's substream: cell styles, rich text and page setup. */
function readSheet(recs: Rec[], xfs: (CellStyle | undefined)[], shared: (Run[] | null)[]): SheetStyles {
  const cells = new Map<string, CellStyle>();
  const runs = new Map<string, Run[]>();
  const rows = new Map<number, RowInfo>();
  const setup: PageSetup = {};
  const margins: Partial<NonNullable<PageSetup["margins"]>> = {};
  const put = (row: number, col: number, ixfe: number) => {
    const style = xfs[ixfe];
    if (style) cells.set(colName(col) + (row + 1), style);
    return style;
  };
  const breaks = (d: Uint8Array) => {
    const v = view(d);
    const n = d.length >= 2 ? v.getUint16(0, true) : 0;
    const ids: number[] = [];
    // each break names the first row (or column) of its new page, 0-based
    for (let i = 0; i < n && 2 + i * 6 + 2 <= d.length; i++) ids.push(v.getUint16(2 + i * 6, true));
    return ids.length ? ids : undefined;
  };
  for (const { type, data: d } of recs) {
    const v = view(d);
    const u16 = (o: number) => (d.length >= o + 2 ? v.getUint16(o, true) : 0);
    switch (type) {
      case R.LABELSST: {
        const style = put(u16(0), u16(2), u16(4));
        const rich = d.length >= 10 ? shared[v.getUint32(6, true)] : null;
        if (rich) runs.set(colName(u16(2)) + (u16(0) + 1), convertPlainRuns(rich, style));
        break;
      }
      case R.LABEL:
      case R.RK:
      case R.NUMBER:
      case R.BLANK:
      case R.FORMULA:
      case R.BOOLERR:
        put(u16(0), u16(2), u16(4));
        break;
      case R.MULRK:
      case R.MULBLANK: {
        const step = type === R.MULRK ? 6 : 2;
        const row = u16(0);
        const first = u16(2);
        for (let i = 0, o = 4; o + step + 2 <= d.length; i++, o += step) put(row, first + i, u16(o));
        break;
      }
      case R.SETUP: {
        if (d.length < 34) break;
        setup.hasPageSetup = true;
        const grbit = u16(10);
        // fNoPls: the paper, scale and orientation fields were never set
        if (!(grbit & 0x04)) {
          if (u16(0)) setup.paperSize = u16(0);
          setup.scale = u16(2);
          if (!(grbit & 0x02) && !(grbit & 0x40)) setup.landscape = true;
        }
        setup.fitToWidth = u16(6);
        setup.fitToHeight = u16(8);
        setup.headerMargin = v.getFloat64(16, true);
        setup.footerMargin = v.getFloat64(24, true);
        break;
      }
      case R.WSBOOL:
        if (u16(0) & 0x0100) setup.fitToPage = true;
        break;
      case R.LEFTMARGIN:
      case R.RIGHTMARGIN:
      case R.TOPMARGIN:
      case R.BOTTOMMARGIN: {
        const side = (["left", "right", "top", "bottom"] as const)[type - R.LEFTMARGIN];
        if (d.length >= 8) margins[side] = v.getFloat64(0, true);
        break;
      }
      case R.HCENTER:
        if (u16(0)) setup.centerH = true;
        break;
      case R.PRINTGRIDLINES:
        if (u16(0)) setup.gridLines = true;
        break;
      case R.HEADER:
      case R.FOOTER:
        // an empty record means no header (or footer)
        if (d.length >= 3) setup[type === R.HEADER ? "header" : "footer"] = strOf(d) || undefined;
        break;
      case R.HPAGEBREAKS:
        setup.rowBreaks = breaks(d);
        break;
      case R.VPAGEBREAKS:
        setup.colBreaks = breaks(d);
        break;
      case R.ROW: {
        if (d.length < 16) break;
        // height in twips (bit 15: the default height); flags: 0x20 hidden, 0x40 height set by hand
        const miy = u16(6);
        const grbit = u16(12);
        rows.set(u16(0), { hpt: miy & 0x8000 ? undefined : (miy & 0x7fff) / 20, custom: !!(grbit & 0x40), hidden: !!(grbit & 0x20) });
        break;
      }
      case R.DEFAULTROWHEIGHT:
        if (u16(2)) setup.defaultRowHeight = u16(2) / 20;
        break;
      case R.DEFCOLWIDTH: {
        // characters of the default font's digit (7px at Calibri/Arial 10-11), plus 5px padding, on an 8px grid
        const px = Math.ceil((u16(0) * 7 + 5) / 8) * 8;
        setup.defaultColWidth = Math.trunc((px / 7) * 256) / 256;
        break;
      }
      case R.PLS:
        setup.printerPaper = devmodePaper(d.subarray(2));
        break;
    }
  }
  // Excel's defaults for the margins a sheet doesn't record
  if (Object.keys(margins).length) setup.margins = { left: margins.left ?? 0.75, right: margins.right ?? 0.75, top: margins.top ?? 1, bottom: margins.bottom ?? 1 };
  return { cells, rows, runs, pictures: [], setup };
}

/** Minimal shape of the compound-file reader bundled with SheetJS. */
interface Cfb {
  read(data: Uint8Array, opts?: object): unknown;
  find(cfb: unknown, path: string): { content?: ArrayLike<number> } | null;
}

/** Styles for every sheet of a BIFF8 .xls, keyed by name. Returns null for anything else (xlsx, BIFF5, encrypted, ...). */
export async function readXlsStyles(data: ArrayBuffer | Uint8Array): Promise<WorkbookStyles | null> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (bytes.length < 512 || MAGIC.some((b, i) => bytes[i] !== b)) return null;
  try {
    const CFB = (await import("xlsx")).CFB as Cfb;
    const cfb = CFB.read(bytes, { type: "array" });
    // BIFF5 files name the stream Book, and are turned away by the version check below
    const entry = CFB.find(cfb, "Workbook") ?? CFB.find(cfb, "Book");
    const content = entry?.content;
    if (!content || content.length < 8) return null;
    const stream = content instanceof Uint8Array ? content : Uint8Array.from(content);
    const v = view(stream);
    // BIFF8 opens with BOF version 0x0600 (BIFF5 "Book" streams have 0x0500)
    if (v.getUint16(0, true) !== R.BOF || v.getUint16(4, true) !== 0x0600) return null;

    const globals = records(stream, 0);
    if (globals.some((r) => r.type === R.FILEPASS)) return null;
    const palette = DEFAULT_PALETTE.slice();
    for (const r of globals) {
      if (r.type !== R.PALETTE) continue;
      const pv = view(r.data);
      const n = Math.min(56, pv.getUint16(0, true));
      for (let i = 0; i < n && 2 + i * 4 + 3 <= r.data.length; i++) {
        palette[8 + i] = [0, 1, 2].map((k) => r.data[2 + i * 4 + k].toString(16).padStart(2, "0")).join("").toUpperCase();
      }
    }
    const fonts = globals.filter((r) => r.type === R.FONT).map((r) => readFont(r.data, palette));
    const base = fonts[0];
    const baseSize = base?.size ?? 10;
    const baseFamily = base?.family ?? "sans";
    const xfs = globals.filter((r) => r.type === R.XF).map((r) => readXf(r.data, fonts, palette, baseSize, baseFamily));

    const sstRec = globals.find((r) => r.type === R.SST);
    const shared: (Run[] | null)[] = [];
    if (sstRec) {
      const rd = new Reader([sstRec.data, ...sstRec.more]);
      rd.skip(4);
      const n = rd.u32();
      try {
        for (let i = 0; i < n && !rd.done; i++) {
          const { text, runs } = rd.string();
          shared.push(toRuns(text, runs, fonts));
        }
      } catch {
        // a truncated table: keep the strings read so far
      }
    }

    const sheets = new Map<string, SheetStyles>();
    for (const r of globals) {
      if (r.type !== R.BOUNDSHEET8 || r.data.length < 8) continue;
      const name = strOf(r.data.subarray(6), true);
      const at = view(r.data).getUint32(0, true);
      const sub = at + 4 <= stream.length && v.getUint16(at, true) === R.BOF ? records(stream, at) : [];
      sheets.set(name, readSheet(sub, xfs, shared));
    }
    return { baseSize, baseFamily, sheets };
  } catch {
    return null;
  }
}

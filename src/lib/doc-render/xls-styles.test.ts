import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";

import { readWorkbookStyles } from "./excel-styles";
import { readXlsStyles } from "./xls-styles";

/* ---------- a tiny BIFF8 writer, so every record under test is spelled out ---------- */

const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const u32 = (n: number) => [...u16(n & 0xffff), ...u16((n >>> 16) & 0xffff)];
const f64 = (n: number) => [...new Uint8Array(new Float64Array([n]).buffer)];
const wide = (s: string) => [...s].some((ch) => ch.charCodeAt(0) > 0xff);
const chars = (s: string, w: boolean) => [...s].flatMap((ch) => (w ? u16(ch.charCodeAt(0)) : [ch.charCodeAt(0)]));
/** XLUnicodeString (16-bit length) or ShortXLUnicodeString (8-bit length) */
const str = (s: string, short = false) => [...(short ? [s.length] : u16(s.length)), wide(s) ? 1 : 0, ...chars(s, wide(s))];
const rec = (type: number, data: number[]) => [...u16(type), ...u16(data.length), ...data];

const bof = (dt: number) => rec(0x0809, [...u16(0x0600), ...u16(dt), ...u16(0x0dbb), ...u16(0x07cc), ...u32(0), ...u32(0x0206)]);
const EOF = rec(0x000a, []);

interface FontSpec {
  pt?: number;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  icv?: number;
  name?: string;
}
const font = (f: FontSpec) =>
  rec(0x0031, [
    ...u16((f.pt ?? 10) * 20),
    ...u16((f.italic ? 0x02 : 0) | (f.strike ? 0x08 : 0)),
    ...u16(f.icv ?? 0x7fff),
    ...u16(f.bold ? 700 : 400),
    ...u16(0),
    f.underline ? 1 : 0,
    0,
    0,
    0,
    ...str(f.name ?? "Arial", true),
  ]);

interface XfSpec {
  font?: number;
  h?: number;
  v?: number;
  wrap?: boolean;
  rot?: number;
  indent?: number;
  shrink?: boolean;
  /** line style codes: left, right, top, bottom */
  lines?: [number, number, number, number];
  /** colour indexes: left, right, top, bottom */
  lineColors?: [number, number, number, number];
  pattern?: number;
  fore?: number;
  back?: number;
}
const xf = (x: XfSpec) => {
  const [l, r, t, b] = x.lines ?? [0, 0, 0, 0];
  const [cl, cr, ct, cb] = x.lineColors ?? [8, 8, 8, 8];
  const border1 = (l | (r << 4) | (t << 8) | (b << 12) | (cl << 16) | (cr << 23)) >>> 0;
  const border2 = (ct | (cb << 7) | ((x.pattern ?? 0) << 26)) >>> 0;
  return rec(0x00e0, [
    ...u16(x.font ?? 0),
    ...u16(0),
    ...u16(0x0001),
    (x.h ?? 0) | (x.wrap ? 0x08 : 0) | ((x.v ?? 2) << 4),
    x.rot ?? 0,
    (x.indent ?? 0) | (x.shrink ? 0x10 : 0),
    0,
    ...u32(border1),
    ...u32(border2),
    ...u16((x.fore ?? 64) | ((x.back ?? 65) << 7)),
  ]);
};

/** A cell record carrying an XF index: row, column, XF, then the record's own payload. */
const cell = (type: number, row: number, col: number, ixfe: number, rest: number[] = []) => rec(type, [...u16(row), ...u16(col), ...u16(ixfe), ...rest]);

interface SheetSpec {
  name: string;
  body: number[];
}

/** A Workbook stream: globals (fonts, palette, XFs, SST) then each sheet's substream, wrapped in a compound file. */
async function biff(globals: number[], sheets: SheetSpec[], sst: number[] = []): Promise<Uint8Array> {
  const sheetStreams = sheets.map((s) => [...bof(0x0010), ...s.body, ...EOF]);
  const boundLen = (s: SheetSpec) => 4 + 6 + 2 + s.name.length * (wide(s.name) ? 2 : 1);
  const head = [...bof(0x0005), ...globals];
  const globalsLen = head.length + sheets.reduce((n, s) => n + boundLen(s), 0) + sst.length + EOF.length;
  let at = globalsLen;
  const bounds = sheets.flatMap((s, i) => {
    const r = rec(0x0085, [...u32(at), 0, 0, ...str(s.name, true)]);
    at += sheetStreams[i].length;
    return r;
  });
  const stream = new Uint8Array([...head, ...bounds, ...sst, ...EOF, ...sheetStreams.flat()]);
  const { CFB } = await import("xlsx");
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, "Workbook", stream);
  return new Uint8Array(CFB.write(cfb, { type: "array" }) as ArrayLike<number>);
}

/* ---------- the workbook under test ---------- */

const FONTS = [
  font({ pt: 10, name: "Arial" }), // 0: the default font
  font({ pt: 12, italic: true, icv: 10, name: "Times New Roman" }), // 1: red
  font({ pt: 10, strike: true, name: "Courier New" }), // 2
  font({ pt: 14, name: "Kruti Dev 010" }), // 3
  // index 4 doesn't exist in BIFF: XF font 5 is this one
  font({ pt: 11, bold: true, underline: true, icv: 8, name: "Calibri" }), // 5: palette 8, overridden below
];
/** Excel's default palette (entries 8..63) with entry 8 changed from black to #123456 */
const PALETTE_HEX = [
  "123456", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];
const PALETTE = rec(0x0092, [...u16(56), ...PALETTE_HEX.flatMap((h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(0))]);

const BORDER_NAMES = ["thin", "medium", "dashed", "dotted", "thick", "double", "hair", "mediumDashed", "dashDot", "mediumDashDot", "dashDotDot", "mediumDashDotDot", "slantDashDot"];
const XFS: XfSpec[] = [
  {}, // 0 default
  { font: 1 }, // 1
  { font: 2 }, // 2
  { font: 3 }, // 3
  { font: 5 }, // 4
  { pattern: 1, fore: 13 }, // 5 solid yellow
  { pattern: 1, fore: 9 }, // 6 solid white: no fill
  { pattern: 3, fore: 64, back: 22 }, // 7 pattern with automatic ink: the back colour
  { h: 2, v: 1 }, // 8 centre, middle
  { h: 3, v: 0, indent: 2 }, // 9 right, top, indented
  { h: 5, wrap: true }, // 10 justify, wrap
  { shrink: true }, // 11
  { h: 4 }, // 12 fill
  { h: 6 }, // 13 centre across selection
  { h: 7, v: 4, indent: 1 }, // 14 distributed
  { rot: 45 }, // 15
  { rot: 135 }, // 16
  { rot: 255 }, // 17 stacked
  { h: 2, indent: 3 }, // 18 indent only counts for left/right/distributed
  { wrap: true, shrink: true }, // 19 wrap wins
  ...BORDER_NAMES.map((_, i): XfSpec => ({ lines: [i + 1, i + 1, i + 1, i + 1], lineColors: [10, 64, 12, 8] })), // 20..32
];
const BORDER_XF = 20;

/** A string longer than one record: its characters cross into a CONTINUE that switches to UTF-16. */
const LONG_A = "a".repeat(3000);
const LONG_B = "आज".repeat(5);
function sstRecords(): number[] {
  // string 0: rich, 3000 8-bit chars, then 10 UTF-16 chars in the CONTINUE; a bold run starts at 2998
  const s0head = [...u16(LONG_A.length + LONG_B.length), 0x08, ...u16(2)];
  const s0runs = [...u16(0), ...u16(1), ...u16(2998), ...u16(5)];
  // string 1: rich, read only if string 0 was walked correctly
  const s1text = "Plain Bold vkt";
  const s1 = [...u16(s1text.length), 0x08, ...u16(2), ...chars(s1text, false), ...u16(6), ...u16(5), ...u16(11), ...u16(3)];
  const s2 = str("plain");
  const first = [...u32(4), ...u32(3), ...s0head, ...chars(LONG_A, false)];
  const cont = [0x01, ...chars(LONG_B, true), ...s0runs, ...s1, ...s2];
  return [...rec(0x00fc, first), ...rec(0x003c, cont)];
}

const SHEET1: number[] = [
  ...rec(0x0225, [...u16(0), ...u16(300)]), // DEFAULTROWHEIGHT 15pt
  ...rec(0x0055, u16(8)), // DEFCOLWIDTH
  ...rec(0x0081, u16(0x05c1)), // WSBOOL with fFitToPage
  ...rec(0x001b, [...u16(2), ...u16(20), ...u16(0), ...u16(255), ...u16(40), ...u16(0), ...u16(255)]), // row breaks
  ...rec(0x001a, [...u16(1), ...u16(3), ...u16(0), ...u16(65535)]), // column break
  ...rec(0x0014, str("&CMonthly Report")),
  ...rec(0x0015, str("&RPage &P पृष्ठ")),
  ...rec(0x0083, u16(1)), // HCENTER
  ...rec(0x002b, u16(1)), // PRINTGRIDLINES
  ...rec(0x0026, f64(0.5)),
  ...rec(0x0027, f64(0.4)),
  ...rec(0x0028, f64(1.1)),
  // no bottom margin: Excel's default of 1 inch
  // A4, 100%, fit 1 wide x 0 tall, landscape (fPortrait clear)
  ...rec(0x00a1, [...u16(9), ...u16(100), ...u16(1), ...u16(1), ...u16(0), ...u16(0x0000), ...u16(600), ...u16(600), ...f64(0.3), ...f64(0.25), ...u16(1)]),
  // fonts: A1..A4 as LABELSST/NUMBER/BLANK/RK
  ...cell(0x00fd, 0, 0, 1, u32(2)),
  ...cell(0x0203, 1, 0, 2, f64(1.5)),
  ...cell(0x0201, 2, 0, 3),
  ...cell(0x027e, 3, 0, 4, u32(0x3ff00000)),
  // fills, A20..C20 via MULBLANK
  ...rec(0x00be, [...u16(19), ...u16(0), ...u16(5), ...u16(6), ...u16(7), ...u16(2)]),
  // alignment, A21..L21 via MULRK
  ...rec(0x00bd, [...u16(20), ...u16(0), ...[8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].flatMap((i) => [...u16(i), ...u32(0)]), ...u16(11)]),
  // borders, D1..D13 via LABEL / BOOLERR / FORMULA
  ...BORDER_NAMES.flatMap((_, i) =>
    i % 3 === 0 ? cell(0x0204, i, 3, BORDER_XF + i, str("b")) : i % 3 === 1 ? cell(0x0205, i, 3, BORDER_XF + i, [1, 0]) : cell(0x0006, i, 3, BORDER_XF + i, [...f64(2), ...u16(0), ...u32(0), ...u16(0)]),
  ),
  // rich text: the long string and the one after it
  ...cell(0x00fd, 0, 4, 0, u32(0)),
  ...cell(0x00fd, 1, 4, 0, u32(1)),
  // a default-styled cell gets no entry
  ...cell(0x00fd, 2, 4, 0, u32(2)),
  // an embedded chart substream: its records are not the sheet's
  ...bof(0x0020),
  ...rec(0x0014, str("chart header")),
  ...EOF,
];

const SHEET2: number[] = [
  // portrait legal at 80%, fit 1x1 not switched on
  ...rec(0x00a1, [...u16(5), ...u16(80), ...u16(1), ...u16(1), ...u16(1), ...u16(0x0002), ...u16(600), ...u16(600), ...f64(0.5), ...f64(0.5), ...u16(1)]),
  ...rec(0x0014, []),
  ...cell(0x0203, 0, 0, 1, f64(1)),
];

const SHEET3: number[] = [
  // fNoPls: paper, scale and orientation were never set
  ...rec(0x00a1, [...u16(0), ...u16(0), ...u16(1), ...u16(1), ...u16(1), ...u16(0x0004), ...u16(0), ...u16(0), ...f64(0.5), ...f64(0.5), ...u16(0)]),
];

const workbook = () =>
  biff([...FONTS.flat(), ...PALETTE, ...XFS.flatMap(xf)], [
    { name: "Report", body: SHEET1 },
    { name: "Data Two", body: SHEET2 },
    { name: "हिसाब", body: SHEET3 },
  ], sstRecords());

describe("xls styles: hand-written BIFF8", () => {
  test("sheets by name, base font from font 0", async () => {
    const wb = await readXlsStyles(await workbook());
    expect(wb).not.toBeNull();
    expect([...wb!.sheets.keys()]).toEqual(["Report", "Data Two", "हिसाब"]);
    expect(wb!.baseSize).toBe(10);
    expect(wb!.baseFamily).toBe("sans");
  });

  test("fonts: style, size, colour, family, Kruti Dev and the missing font 4", async () => {
    const cells = (await readXlsStyles(await workbook()))!.sheets.get("Report")!.cells;
    expect(cells.get("A1")).toEqual({ italic: true, size: 12, family: "serif", color: "FF0000" });
    expect(cells.get("A2")).toEqual({ strike: true, family: "mono" });
    expect(cells.get("A3")).toEqual({ size: 14, kruti: true });
    // the PALETTE record changed entry 8 from black
    expect(cells.get("A4")).toEqual({ bold: true, underline: true, size: 11, family: "carlito", color: "123456" });
  });

  test("fills: solid colour, white is none, automatic ink falls back to the back colour", async () => {
    const cells = (await readXlsStyles(await workbook()))!.sheets.get("Report")!.cells;
    expect(cells.get("A20")).toEqual({ fill: "FFFF00" });
    expect(cells.get("B20")).toBeUndefined();
    expect(cells.get("C20")).toEqual({ fill: "C0C0C0" });
  });

  test("alignment: horizontal, vertical, wrap, shrink, indent, rotation", async () => {
    const cells = (await readXlsStyles(await workbook()))!.sheets.get("Report")!.cells;
    const c = (i: number) => cells.get(`${String.fromCharCode(64 + i)}21`);
    expect(c(1)).toEqual({ align: "center", valign: "middle" });
    expect(c(2)).toEqual({ align: "right", valign: "top", indent: 2 });
    expect(c(3)).toEqual({ align: "justify", wrap: true });
    expect(c(4)).toEqual({ shrink: true });
    expect(c(5)).toEqual({ align: "left", repeat: true });
    expect(c(6)).toEqual({ align: "center" });
    expect(c(7)).toEqual({ align: "justify", valign: "middle", indent: 1 });
    expect(c(8)).toEqual({ rotate: 45 });
    expect(c(9)).toEqual({ rotate: -45 });
    expect(c(10)).toEqual({ rotate: "stacked" });
    expect(c(11)).toEqual({ align: "center" });
    expect(c(12)).toEqual({ wrap: true });
  });

  test("borders: every line style, with colours per side", async () => {
    const cells = (await readXlsStyles(await workbook()))!.sheets.get("Report")!.cells;
    const got = BORDER_NAMES.map((_, i) => cells.get(`D${i + 1}`)?.border);
    expect(got.map((b) => b?.top?.width)).toEqual([0.5, 1, 0.5, 0.5, 1.5, 1.5, 0.25, 1, 0.5, 1, 0.5, 1, 1]);
    expect(got[0]).toEqual({
      left: { width: 0.5, color: "FF0000" },
      right: { width: 0.5, color: "000000" }, // system colour: black
      top: { width: 0.5, color: "0000FF" },
      bottom: { width: 0.5, color: "123456" },
    });
    expect(got[5]?.top).toEqual({ width: 1.5, color: "0000FF", double: true });
    expect(got[2]?.top?.dash).toEqual([2.25, 0.75]);
    expect(got[3]?.top?.dash).toEqual([0.75, 0.75]);
    expect(got[6]?.top?.dash).toEqual([0.75, 0.75]);
    expect(got[12]?.top?.dash).toEqual([7.5, 0.75, 3, 0.75]);
    expect(got[4]?.top?.dash).toBeUndefined();
  });

  test("shared strings: a string crossing a CONTINUE, rich runs, Kruti Dev runs converted", async () => {
    const sheet = (await readXlsStyles(await workbook()))!.sheets.get("Report")!;
    const long = sheet.runs.get("E1")!;
    expect(long.map((r) => r.text.length)).toEqual([2998, 12]);
    expect(long[1].text).toBe("aa" + LONG_B);
    expect(long[0].style).toMatchObject({ bold: false, italic: true, size: 12, color: "FF0000", family: "serif" });
    expect(long[1].style).toMatchObject({ bold: true, underline: true, size: 11, color: "123456", family: "carlito" });
    // the Kruti Dev run is converted to Unicode
    expect(sheet.runs.get("E2")).toEqual([
      { text: "Plain " },
      { text: "Bold ", style: { bold: true, italic: false, underline: true, strike: false, size: 11, color: "123456", family: "carlito" } },
      { text: "आज", style: { bold: false, italic: false, underline: false, strike: false, size: 14, color: undefined, family: "sans" } },
    ]);
    // plain strings have no runs, and default-styled cells no style
    expect(sheet.runs.has("E3")).toBe(false);
    expect(sheet.cells.has("E1")).toBe(false);
  });

  test("page setup: landscape A4, fit to width, margins, header and footer, breaks, centring, gridlines", async () => {
    const setup = (await readXlsStyles(await workbook()))!.sheets.get("Report")!.setup;
    expect(setup).toEqual({
      hasPageSetup: true,
      paperSize: 9,
      scale: 100,
      landscape: true,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      headerMargin: 0.3,
      footerMargin: 0.25,
      margins: { left: 0.5, right: 0.4, top: 1.1, bottom: 1 },
      header: "&CMonthly Report",
      footer: "&RPage &P पृष्ठ",
      centerH: true,
      gridLines: true,
      rowBreaks: [20, 40],
      colBreaks: [3],
      defaultRowHeight: 15,
      defaultColWidth: 9.140625,
    });
  });

  test("page setup: portrait, scale, empty header; unset printer fields are left out", async () => {
    const wb = (await readXlsStyles(await workbook()))!;
    expect(wb.sheets.get("Data Two")!.setup).toEqual({ hasPageSetup: true, paperSize: 5, scale: 80, fitToWidth: 1, fitToHeight: 1, headerMargin: 0.5, footerMargin: 0.5 });
    expect(wb.sheets.get("Data Two")!.cells.get("A1")).toEqual({ italic: true, size: 12, family: "serif", color: "FF0000" });
    expect(wb.sheets.get("हिसाब")!.setup).toEqual({ hasPageSetup: true, fitToWidth: 1, fitToHeight: 1, headerMargin: 0.5, footerMargin: 0.5 });
  });

  test("rows: stored height, height set by hand, hidden", async () => {
    // ROW: rw, colMic, colMac, miyRw (twips; bit 15 = default height), 2 reserved words, grbit
    const row = (rw: number, twips: number, grbit: number) => rec(0x0208, [...u16(rw), ...u16(0), ...u16(1), ...u16(twips), ...u16(0), ...u16(0), ...u16(grbit), ...u16(0x0f)]);
    const wb = await readXlsStyles(
      await biff([...FONTS.flat(), ...PALETTE, ...XFS.flatMap(xf)], [{ name: "Rows", body: [...row(0, 600, 0x40), ...row(1, 400, 0), ...row(2, 300, 0x20), ...row(3, 0x8000 | 300, 0)] }]),
    );
    const rows = wb!.sheets.get("Rows")!.rows!;
    expect(rows.get(0)).toEqual({ hpt: 30, custom: true, hidden: false });
    expect(rows.get(1)).toEqual({ hpt: 20, custom: false, hidden: false });
    expect(rows.get(2)).toEqual({ hpt: 15, custom: false, hidden: true });
    expect(rows.get(3)?.hpt).toBeUndefined();
  });

  test("anything but BIFF8 is null, without throwing", async () => {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", "<workbook/>");
    expect(await readXlsStyles(await zip.generateAsync({ type: "uint8array" }))).toBeNull();
    expect(await readXlsStyles(new Uint8Array(0))).toBeNull();
    expect(await readXlsStyles(new TextEncoder().encode("a,b\n1,2\n").buffer as ArrayBuffer)).toBeNull();
    // a compound file without a Workbook stream (e.g. a .doc)
    const { CFB } = await import("xlsx");
    const doc = CFB.utils.cfb_new();
    CFB.utils.cfb_add(doc, "WordDocument", new Uint8Array(600));
    expect(await readXlsStyles(new Uint8Array(CFB.write(doc, { type: "array" }) as ArrayLike<number>))).toBeNull();
    // a BIFF5 workbook
    const biff5 = CFB.utils.cfb_new();
    CFB.utils.cfb_add(biff5, "Book", new Uint8Array([...rec(0x0809, [...u16(0x0500), ...u16(5), 0, 0, 0, 0]), ...EOF]));
    expect(await readXlsStyles(new Uint8Array(CFB.write(biff5, { type: "array" }) as ArrayLike<number>))).toBeNull();
    // a truncated .xls
    expect(await readXlsStyles((await workbook()).subarray(0, 700))).toBeNull();
  });
});

/*
 * fixtures/xls-styles.xls is a synthetic workbook (fonts, fills, every border style, alignments, rich
 * text, a shared string longer than one record, page setup on two sheets) saved as .xls by LibreOffice;
 * fixtures/xls-styles.xlsx is LibreOffice's .xlsx export of that same .xls.
 */
describe("xls styles: a LibreOffice .xls against its .xlsx twin", () => {
  const fixture = (name: string) => new Uint8Array(readFileSync(join(import.meta.dir, "fixtures", name)));

  test("cells, runs and page setup match readWorkbookStyles", async () => {
    const xls = (await readXlsStyles(fixture("xls-styles.xls")))!;
    const xlsx = (await readWorkbookStyles(fixture("xls-styles.xlsx")))!;
    expect(xls.baseSize).toBe(xlsx.baseSize);
    expect(xls.baseFamily).toBe(xlsx.baseFamily);
    expect([...xls.sheets.keys()]).toEqual([...xlsx.sheets.keys()]);
    for (const [name, want] of xlsx.sheets) {
      const got = xls.sheets.get(name)!;
      expect([...got.cells.keys()].sort()).toEqual([...want.cells.keys()].sort());
      for (const [ref, style] of want.cells) {
        // LibreOffice's .xlsx export rounds indents and turns slantDashDot into mediumDashDot; the .xls keeps both
        if (ref === "A17" || ref === "B42" || ref === "C42") continue;
        expect([ref, got.cells.get(ref)]).toEqual([ref, style]);
      }
      expect(got.runs).toEqual(want.runs);
      // LibreOffice writes its own default column width to .xlsx; the .xls has Excel's character count
      const { margins: gm, headerMargin: gh, footerMargin: gf, ...gotSetup } = { ...got.setup, defaultColWidth: undefined };
      const { margins: wm, headerMargin: wh, footerMargin: wf, ...wantSetup } = { ...want.setup, defaultColWidth: undefined };
      expect(gotSetup).toEqual(wantSetup);
      for (const k of ["left", "right", "top", "bottom"] as const) expect(gm?.[k]).toBeCloseTo(wm![k], 6);
      expect(gh).toBeCloseTo(wh!, 6);
      expect(gf).toBeCloseTo(wf!, 6);
    }
    const report = xls.sheets.get("Report")!;
    expect(report.cells.get("A17")).toMatchObject({ align: "left", indent: 3 });
    expect(report.cells.get("B42")?.border?.top?.dash).toEqual([7.5, 0.75, 3, 0.75]);
    expect(report.setup).toMatchObject({ landscape: true, paperSize: 9, fitToPage: true, rowBreaks: [20, 40], colBreaks: [3], centerH: true, gridLines: true });
  });
});

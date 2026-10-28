/**
 * Printing a workbook as Excel does: each sheet's own page setup, headers and footers, manual page
 * breaks, columns that run onto further pages, and the cell options that change what a cell shows
 * (rotation, shrink to fit, fill, indent, broken borders, ### and format colours).
 */
import { describe, expect, test } from "bun:test";
import { PDFDocument, PDFName } from "@cantoo/pdf-lib";
import JSZip from "jszip";

import { formatColor, workbookGrids } from "./excel";
import { sheetPageSpec, sheetToBlocks } from "./excel-layout";
import { readWorkbookStyles } from "./excel-styles";
import { headerFooterCmds } from "./flow";
import { defaultDocOptions } from "./options";
import { convertDoc } from "./process";
import { loadFont, pdfPages } from "./testkit";
import type { Block } from "../word-to-pdf/model";

type TableBlock = Extract<Block, { kind: "table" }>;

const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]-#,##0.00"/><numFmt numFmtId="165" formatCode="0"/></numFmts>
  <fonts count="3">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><name val="Mangal"/></font>
    <font><sz val="14"/><name val="Mangal"/></font>
  </fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="3">
    <border/>
    <border><left style="dashed"/><right style="dotted"/><top style="double"/><bottom style="mediumDashed"/></border>
    <border><bottom style="hair"/></border>
  </borders>
  <cellXfs count="11">
    <xf fontId="0" fillId="0" borderId="0"/>
    <xf fontId="0" fillId="0" borderId="1"/>
    <xf fontId="0" fillId="0" borderId="0" numFmtId="164" applyNumberFormat="1"/>
    <xf fontId="0" fillId="0" borderId="0" numFmtId="165" applyNumberFormat="1"/>
    <xf fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment textRotation="90"/></xf>
    <xf fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment textRotation="255"/></xf>
    <xf fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment shrinkToFit="1"/></xf>
    <xf fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="fill"/></xf>
    <xf fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="left" indent="2"/></xf>
    <xf fontId="1" fillId="0" borderId="0"/>
    <xf fontId="2" fillId="0" borderId="2" applyAlignment="1"><alignment textRotation="135"/></xf>
  </cellXfs>
</styleSheet>`;

const str = (r: string, t: string, s = 0) => `<c r="${r}" s="${s}" t="inlineStr"><is><t>${t}</t></is></c>`;
const num = (r: string, v: number, s = 0) => `<c r="${r}" s="${s}"><v>${v}</v></c>`;

function sheetXml(rows: string, tail = "", cols = "") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData>${tail}</worksheet>`;
}

async function workbook(sheets: { name: string; xml: string }[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const rel = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const rels = (...r: string[]) => `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${r.join("")}</Relationships>`;
  const overrides = sheets
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("");
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  );
  zip.file("_rels/.rels", rels(rel("rId1", "officeDocument", "xl/workbook.xml")));
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    rels(...sheets.map((_, i) => rel(`rId${i + 1}`, "worksheet", `worksheets/sheet${i + 1}.xml`)), rel(`rId${sheets.length + 1}`, "styles", "styles.xml")),
  );
  zip.file("xl/styles.xml", STYLES);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, s.xml));
  return zip.generateAsync({ type: "arraybuffer" });
}

const convert = async (bytes: ArrayBuffer) =>
  convertDoc("book.xlsx", { text: async () => "", bytes: async () => bytes }, defaultDocOptions("excel"), { loadFont });

const pageSizes = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);

async function textItems(bytes: Uint8Array, page = 1) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 }).promise;
  const tc = await (await doc.getPage(page)).getTextContent();
  return tc.items.filter((i) => "str" in i) as { str: string; transform: number[]; width: number }[];
}

const A4 = `<pageSetup paperSize="9" orientation="portrait"/>`;
const A4_LANDSCAPE = `<pageSetup paperSize="9" orientation="landscape"/>`;
const MARGINS = `<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>`;

describe("printing a workbook", () => {
  test("each sheet keeps its own paper and orientation", async () => {
    const bytes = await workbook([
      { name: "Portrait", xml: sheetXml(`<row r="1">${str("A1", "first")}</row>`, MARGINS + A4) },
      { name: "Landscape", xml: sheetXml(`<row r="1">${str("A1", "second")}</row>`, MARGINS + A4_LANDSCAPE) },
    ]);
    const out = await convert(bytes);
    expect(await pageSizes(out.bytes)).toEqual([
      [595, 842],
      [842, 595],
    ]);
  });

  test("headers and footers print with page numbers counted across the workbook", async () => {
    const hf = `<headerFooter><oddHeader>&amp;LSheet &amp;A&amp;RPage &amp;P of &amp;N</oddHeader><oddFooter>&amp;C&amp;"Arial,Bold"&amp;9Confidential</oddFooter></headerFooter>`;
    const bytes = await workbook([
      { name: "One", xml: sheetXml(`<row r="1">${str("A1", "a")}</row>`, MARGINS + A4 + hf) },
      { name: "Two", xml: sheetXml(`<row r="1">${str("A1", "b")}</row>`, MARGINS + A4 + hf) },
    ]);
    const pages = await pdfPages((await convert(bytes)).bytes);
    expect(pages[0]).toContain("Sheet One");
    expect(pages[0]).toContain("Page 1 of 2");
    expect(pages[1]).toContain("Sheet Two");
    expect(pages[1]).toContain("Page 2 of 2");
    expect(pages[1]).toContain("Confidential");
  });

  test("header codes: parts, fields, size and bold", () => {
    const measure = (t: string, _k: unknown, size: number) => t.length * size * 0.5;
    const spec = { width: 600, height: 800, margin: { left: 50, right: 50, top: 50, bottom: 50 } };
    const fields = { page: 3, pages: 7, now: new Date(2026, 9, 28), file: "book", sheet: "Bill" };
    const cmds = headerFooterCmds('&L&F&C&"Arial,Bold Italic"&14&A&R&P/&N && more', 20, true, spec, fields, measure);
    const texts = cmds.flatMap((c) => (c.t === "text" ? [c] : []));
    expect(texts.map((c) => c.text)).toEqual(["book", "Bill", "3/7 & more"]);
    expect(texts[0].x).toBe(50);
    expect(texts[1]).toMatchObject({ size: 14, bold: true, italic: true });
    expect(texts[2].x + measure("3/7 & more", null, 11)).toBe(550);
  });

  test("a manual page break starts a new page", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => `<row r="${i + 1}">${str(`A${i + 1}`, `row ${i + 1}`)}</row>`).join("");
    const bytes = await workbook([{ name: "S", xml: sheetXml(rows, MARGINS + A4 + `<rowBreaks count="1" manualBreakCount="1"><brk id="3" max="16383" man="1"/></rowBreaks>`) }]);
    const pages = await pdfPages((await convert(bytes)).bytes);
    expect(pages.length).toBe(2);
    expect(pages[0]).toContain("row 3");
    expect(pages[1]).toContain("row 4");
  });

  test("a sheet wider than the page prints its further columns on the next pages, rows first", async () => {
    const cols = `<cols><col min="1" max="6" width="30" customWidth="1"/></cols>`;
    const rows = `<row r="1">${["A", "B", "C", "D", "E", "F"].map((c) => str(`${c}1`, `col ${c}`)).join("")}</row>`;
    const bytes = await workbook([{ name: "Wide", xml: sheetXml(rows, MARGINS + A4, cols) }]);
    const { sheets } = await workbookGrids(bytes);
    const g = sheets[0].grid;
    const tables = sheetToBlocks(g, sheetPageSpec(g.sheet?.setup ?? {})).filter((b) => b.kind === "table") as TableBlock[];
    // 30-wide columns are 157.5pt; 3 fit across 523pt of A4
    expect(tables.map((t) => t.info?.grid.length)).toEqual([3, 3]);
    const pages = await pdfPages((await convert(bytes)).bytes);
    expect(pages.length).toBe(2);
    expect(pages[0]).toContain("col C");
    expect(pages[1]).toContain("col D");
  });

  test("fit to one page wide still shrinks onto one page", async () => {
    const cols = `<cols><col min="1" max="6" width="30" customWidth="1"/></cols>`;
    const rows = `<row r="1">${["A", "B", "C", "D", "E", "F"].map((c) => str(`${c}1`, `col ${c}`)).join("")}</row>`;
    const fit = `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`;
    const xml = sheetXml(rows, MARGINS + `<pageSetup paperSize="9" fitToWidth="1" fitToHeight="0"/>`, cols).replace("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">", `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${fit}`);
    const pages = await pdfPages((await convert(await workbook([{ name: "Fit", xml }]))).bytes);
    expect(pages.length).toBe(1);
  });

  test("a sheet centred on the page is moved right", async () => {
    const rows = `<row r="1">${str("A1", "middle")}</row>`;
    const bytes = await workbook([{ name: "C", xml: sheetXml(rows, `<printOptions horizontalCentered="1"/>` + MARGINS + A4) }]);
    const [item] = (await textItems((await convert(bytes)).bytes)).filter((i) => i.str.includes("middle"));
    // a default 64px (48pt) column centred on 595pt A4
    expect(item.transform[4]).toBeCloseTo((595.28 - 48) / 2 + 1.5, 0);
  });
});

describe("what a cell shows", () => {
  test("alignment options are read", async () => {
    const rows = `<row r="1">${str("A1", "up", 4)}${str("B1", "tall", 5)}${str("C1", "small", 6)}${str("D1", "-", 7)}${str("E1", "in", 8)}${str("F1", "down", 10)}</row>`;
    const styles = await readWorkbookStyles(await workbook([{ name: "S", xml: sheetXml(rows) }]));
    const cells = styles?.sheets.get("S")?.cells;
    expect(cells?.get("A1")?.rotate).toBe(90);
    expect(cells?.get("B1")?.rotate).toBe("stacked");
    expect(cells?.get("C1")).toMatchObject({ shrink: true });
    expect(cells?.get("C1")?.wrap).toBeUndefined();
    expect(cells?.get("D1")?.repeat).toBe(true);
    expect(cells?.get("E1")?.indent).toBe(2);
    // 135 is 45 degrees clockwise
    expect(cells?.get("F1")?.rotate).toBe(-45);
  });

  test("broken and double borders keep their style", async () => {
    const rows = `<row r="1">${str("A1", "box", 1)}</row>`;
    const styles = await readWorkbookStyles(await workbook([{ name: "S", xml: sheetXml(rows) }]));
    const b = styles?.sheets.get("S")?.cells.get("A1")?.border;
    expect(b?.left?.dash).toEqual([2.25, 0.75]);
    expect(b?.right?.dash).toEqual([0.75, 0.75]);
    expect(b?.top?.double).toBe(true);
    expect(b?.bottom?.dash).toEqual([6.75, 2.25]);
  });

  test("format colours pick the section for the value", () => {
    expect(formatColor("#,##0.00;[Red]-#,##0.00", -5)).toBe("FF0000");
    expect(formatColor("#,##0.00;[Red]-#,##0.00", 5)).toBeUndefined();
    expect(formatColor("[Blue]0;[Red]0;[Green]0", 0)).toBe("00FF00");
    expect(formatColor('[Color10]0;"[Red]"0', 3)).toBe("008000");
    expect(formatColor("[>=100][Red]0;0", 150)).toBeUndefined();
    expect(formatColor("General", -1)).toBeUndefined();
  });

  test("numbers too wide show ###, General numbers drop decimals first, booleans centre, red negatives", async () => {
    const cols = `<cols><col min="1" max="3" width="6" customWidth="1"/></cols>`;
    const rows = `<row r="1">${num("A1", 123456789012, 3)}${num("B1", 3.14159265, 0)}<c r="C1" t="b"><v>1</v></c></row><row r="2">${num("A2", -5, 2)}</row>`;
    const bytes = await workbook([{ name: "N", xml: sheetXml(rows, MARGINS + A4, cols) }]);
    const { sheets } = await workbookGrids(bytes);
    expect(sheets[0].grid.rows[0][2]).toMatchObject({ text: "TRUE", centred: true });
    expect(sheets[0].grid.rows[1][0]).toMatchObject({ fmtColor: "FF0000" });
    const text = (await pdfPages((await convert(bytes)).bytes)).join(" ");
    expect(text).toMatch(/#####/);
    expect(text).not.toContain("123456789012");
    expect(text).toMatch(/3\.14\d*/);
    expect(text).not.toContain("3.14159265");
  });

  test("rotated, shrunk, filled and indented cells", async () => {
    const cols = `<cols><col min="1" max="5" width="12" customWidth="1"/></cols>`;
    const rows = `<row r="1" ht="60" customHeight="1">${str("A1", "Up", 4)}${str("B1", "Shrink this long text to fit", 6)}${str("C1", "ab", 7)}${str("D1", "in", 8)}${str("E1", "x")}</row>`;
    const out = (await convert(await workbook([{ name: "R", xml: sheetXml(rows, MARGINS + A4, cols) }]))).bytes;
    const items = await textItems(out);
    const at = (s: string) => items.find((i) => i.str === s || i.str.startsWith(s)) as (typeof items)[number];
    // turned 90 degrees anticlockwise: the text matrix is [0 1 -1 0]
    const up = at("Up").transform;
    expect(up[0]).toBeCloseTo(0, 5);
    expect(up[1]).toBeGreaterThan(0);
    // shrunk into its 12-wide (63pt) cell rather than clipped
    const shrink = at("Shrink");
    expect(shrink.str).toContain("fit");
    expect(shrink.width).toBeLessThan(63);
    // "fill" repeats the text across the cell
    expect(at("abab").str.length).toBeGreaterThanOrEqual(8);
    // indent 2 moves the text about six spaces in from the edge
    const left = at("x").transform[4] - 4 * 63;
    expect(at("in").transform[4] - 3 * 63).toBeGreaterThan(left + 8);
  });
});

describe("review fixes", () => {
  test("text running over filled cells keeps every cell's fill", async () => {
    const fill = `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></fills>`;
    const bytes = await workbook([{ name: "S", xml: sheetXml(`<row r="1">${str("A1", "A long banner title that runs across the row", 11)}<c r="B1" s="11"/><c r="C1" s="11"/><c r="D1" s="11"/></row>`, MARGINS + A4) }]);
    const zip = await JSZip.loadAsync(bytes);
    const styles = (await zip.file("xl/styles.xml")!.async("string"))
      .replace(/<fills[\s\S]*?<\/fills>/, fill)
      .replace('<cellXfs count="11">', '<cellXfs count="12">')
      .replace("</cellXfs>", '<xf fontId="0" fillId="2" borderId="0"/></cellXfs>');
    zip.file("xl/styles.xml", styles);
    const { sheets } = await workbookGrids(await zip.generateAsync({ type: "arraybuffer" }));
    const g = sheets[0].grid;
    const [table] = sheetToBlocks(g, sheetPageSpec(g.sheet?.setup ?? {})).filter((b) => b.kind === "table") as TableBlock[];
    const cell = table.rows[0].cells[0];
    expect(cell.colSpan).toBeGreaterThan(1);
    expect(cell.colFills?.slice(0, cell.colSpan).every((f) => f === "FFFF00")).toBe(true);
  });

  test("a right-to-left sheet too wide for the page starts with column A, each band fitting", async () => {
    const cols = `<cols><col min="1" max="2" width="10" customWidth="1"/><col min="3" max="4" width="40" customWidth="1"/></cols>`;
    const rows = `<row r="1">${["A", "B", "C", "D"].map((c) => str(`${c}1`, `col ${c}`)).join("")}</row>`;
    const view = `<sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>`;
    const xml = sheetXml(rows, MARGINS + A4, cols).replace("<cols>", `${view}<cols>`);
    const { sheets } = await workbookGrids(await workbook([{ name: "R", xml }]));
    const g = sheets[0].grid;
    const spec = sheetPageSpec(g.sheet?.setup ?? {});
    const tables = sheetToBlocks(g, spec).filter((b) => b.kind === "table") as TableBlock[];
    const avail = spec.width - spec.margin.left - spec.margin.right;
    for (const t of tables) expect(t.info?.widthPt ?? 0).toBeLessThanOrEqual(avail + 0.01);
    const firstTexts = JSON.stringify(tables[0].rows[0].cells);
    expect(firstTexts).toContain("col A");
  });

  test("a tiny General number in a narrow column goes scientific, never 0", async () => {
    const cols = `<cols><col min="1" max="1" width="5" customWidth="1"/></cols>`;
    const out = (await convert(await workbook([{ name: "N", xml: sheetXml(`<row r="1">${num("A1", 0.000012345)}</row>`, MARGINS + A4, cols) }]))).bytes;
    const text = (await pdfPages(out)).join(" ");
    expect(text).not.toMatch(/(^|\s)0(\s|$)/);
    expect(text).toMatch(/E-0?5|#/);
  });
});

describe("Hindi layout", () => {
  test("a header or footer typed in Kruti Dev prints in Hindi, && as its hyphen", () => {
    const measure = (t: string, _k: unknown, size: number) => t.length * size * 0.5;
    const spec = { width: 600, height: 800, margin: { left: 50, right: 50, top: 50, bottom: 50 } };
    const fields = { page: 2, pages: 5, now: new Date(2026, 9, 28), file: "book", sheet: "S" };
    const texts = headerFooterCmds('&C&"Kruti Dev 010,Bold"&14ykHkkFkhZ lwph o"kZ 2026&&27&R&"Arial"A && B &P', 20, true, spec, fields, measure).flatMap((c) =>
      c.t === "text" ? [c.text] : [],
    );
    expect(texts).toEqual(["लाभार्थी सूची वर्ष 2026-27", "A & B 2"]);
  });

  const wrapped = (row1: string) =>
    sheetXml(
      `${row1.replace("TEXT", "<is><t>उपरोक्त विषयान्तर्गत लेख है कि राज्य के समस्त राजकीय विद्यालयों में शीतकालीन अवकाश रहेगा</t></is>")}<row r="2">${str("A2", "next")}</row>`,
      MARGINS + A4,
      `<cols><col min="1" max="1" width="14" customWidth="1"/></cols>`,
    );
  const gapToRow2 = async (row1: string) => {
    const bytes = await workbook([{ name: "W", xml: wrapped(row1) }]);
    const zip = await JSZip.loadAsync(bytes);
    const styles = (await zip.file("xl/styles.xml")!.async("string")).replace('<cellXfs count="11">', '<cellXfs count="12">').replace("</cellXfs>", '<xf fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment wrapText="1"/></xf></cellXfs>');
    zip.file("xl/styles.xml", styles);
    const items = await textItems(await convert(await zip.generateAsync({ type: "arraybuffer" })).then((o) => o.bytes));
    const next = items.find((i) => i.str === "next") as (typeof items)[number];
    // distance from the page top to row 2's baseline
    return 842 - next.transform[5] - 0.75 * 72;
  };

  test("a row Excel fits to its content grows for wrapped Hindi; a hand-set height stays", async () => {
    const auto = await gapToRow2(`<row r="1" ht="15"><c r="A1" s="11" t="inlineStr">TEXT</c></row>`);
    const fixed = await gapToRow2(`<row r="1" ht="15" customHeight="1"><c r="A1" s="11" t="inlineStr">TEXT</c></row>`);
    expect(fixed).toBeLessThan(15 + 16);
    expect(auto).toBeGreaterThan(fixed + 25);
  });

  test("empty sheets and empty column bands print no pages", async () => {
    const cols = `<cols><col min="1" max="8" width="30" customWidth="1"/></cols>`;
    const bytes = await workbook([
      { name: "Data", xml: sheetXml(`<row r="1">${str("A1", "only column A")}<c r="H1" s="0"/></row>`, MARGINS + A4, cols) },
      { name: "Empty", xml: sheetXml("", MARGINS + A4) },
    ]);
    const pages = await pdfPages((await convert(bytes)).bytes);
    expect(pages.length).toBe(1);
  });
});

describe("fonts", () => {
  test("ligatures are not used, so text after them stays in place", async () => {
    const rows = `<row r="1">${str("A1", "Quantity")}${str("B1", "|")}</row>`;
    const cols = `<cols><col min="1" max="1" width="30" customWidth="1"/></cols>`;
    const items = await textItems((await convert(await workbook([{ name: "L", xml: sheetXml(rows, MARGINS + A4, cols) }]))).bytes);
    const q = items.find((i) => i.str === "Quantity") as (typeof items)[number];
    // Carlito 11pt without the "ti" ligature: Q u a n t i t y
    const fk = (await import("@pdf-lib/fontkit")).default;
    const carlito = fk.create(await loadFont("Carlito-Regular.ttf"));
    const plain = carlito.layout("Quantity", { kern: false, liga: false }).advanceWidth / carlito.unitsPerEm * 11;
    expect(q.width).toBeCloseTo(plain, 1);
  });

  test("bold Hindi is the regular face drawn thicker, not the heavy bold face", async () => {
    const rows = `<row r="1">${str("A1", "प्रमाणित किया", 9)}</row>`;
    const out = (await convert(await workbook([{ name: "H", xml: sheetXml(rows, MARGINS + A4) }]))).bytes;
    const doc = await PDFDocument.load(out);
    const fontNames = doc.context
      .enumerateIndirectObjects()
      .map(([, o]) => String((o as { get?: (k: unknown) => unknown }).get?.(PDFName.of("BaseFont")) ?? ""))
      .filter(Boolean);
    expect(fontNames.some((n) => n.includes("NotoSansDevanagari-Regular"))).toBe(true);
    expect(fontNames.some((n) => n.includes("NotoSansDevanagari-Bold"))).toBe(false);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: out.slice(), useSystemFonts: false, verbosity: 0 }).promise;
    const ops = await (await pdf.getPage(1)).getOperatorList();
    const modes = ops.fnArray.flatMap((fn, i) => (fn === pdfjs.OPS.setTextRenderingMode ? [ops.argsArray[i][0]] : []));
    // fill and stroke
    expect(modes).toContain(2);
  });
});

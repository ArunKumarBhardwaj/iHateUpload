import { describe, expect, test } from "bun:test";
import JSZip from "jszip";

import { quoteLiterals, workbookGrids } from "./excel";
import { sheetPageSpec, sheetScale, sheetToBlocks } from "./excel-layout";
import { readWorkbookStyles } from "./excel-styles";
import { defaultDocOptions } from "./options";
import { convertDoc } from "./process";
import { loadFont, pdfPages } from "./testkit";

const norm = (s: string) => s.replace(/\s+/g, " ");

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="₹#,##0.00"/></numFmts>
  <fonts count="4">
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>
    <font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><i/><u/><sz val="11"/><color rgb="FFC00000"/><name val="Calibri"/></font>
    <font><b val="0"/><sz val="11"/><color theme="4" tint="-0.5"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor theme="4" tint="0.7999816888943144"/></patternFill></fill>
  </fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="164" fontId="3" fillId="3" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf>
  </cellXfs>
</styleSheet>`;

const str = (r: string, s: number, t: string) => `<c r="${r}" s="${s}" t="inlineStr"><is><t>${t}</t></is></c>`;

const SHEET = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:D3"/>
  <cols><col min="1" max="1" width="20" customWidth="1"/><col min="2" max="2" width="9" hidden="1" customWidth="1"/></cols>
  <sheetData>
    <row r="1">${str("A1", 1, "Quarterly Report")}<c r="B1" s="1"/><c r="C1" s="1"/><c r="D1" s="1"/></row>
    <row r="2">${str("A2", 2, "Note")}${str("B2", 0, "secret column")}${str("C2", 4, "Left?")}${str("D2", 0, "x")}</row>
    <row r="3">${str("A3", 0, "Total")}<c r="B3"><v>1</v></c><c r="C3" s="3"><v>1234.5</v></c>${str("D3", 0, "y")}</row>
  </sheetData>
  <mergeCells count="1"><mergeCell ref="A1:D1"/></mergeCells>
</worksheet>`;

async function styledWorkbook(sheet = SHEET, names = ""): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets>${names}</workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file("xl/styles.xml", STYLES);
  zip.file("xl/worksheets/sheet1.xml", sheet);
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("excel cell formatting", () => {
  test("number formats Excel accepts but SheetJS rejects are quoted", () => {
    expect(quoteLiterals("₹#,##0.00")).toBe('"₹"#,##0.00');
    expect(quoteLiterals('"₹"#,##0.00')).toBe('"₹"#,##0.00');
    expect(quoteLiterals("[$₹-4009]#,##0")).toBe("[$₹-4009]#,##0");
  });

  test("reads fonts, fills, theme colours and alignment per cell", async () => {
    const styles = await readWorkbookStyles(await styledWorkbook());
    const cells = styles?.sheets.get("Report")?.cells;
    expect(styles?.baseSize).toBe(11);
    expect(cells?.get("A1")).toEqual({ bold: true, size: 16, color: "FFFFFF", fill: "1F4E78", align: "center" });
    expect(cells?.get("A2")).toEqual({ italic: true, underline: true, color: "C00000" });
    // theme 4 = accent1 (4472C4); a negative tint darkens it, a positive one lightens it
    expect(cells?.get("C3")?.color).toBe("223962");
    expect(cells?.get("C3")?.fill).toBe("DAE3F3");
    expect(cells?.get("C3")?.bold).toBeUndefined();
    expect(cells?.get("C2")).toEqual({ align: "right" });
    expect(cells?.has("D2")).toBe(false);
  });

  test("grids keep merges, widths, styles and drop hidden columns", async () => {
    const { sheets } = await workbookGrids(await styledWorkbook());
    const { grid } = sheets[0];
    expect(grid.styled).toBe(true);
    // column B is hidden, so the A1:D1 merge spans the three visible columns
    expect(grid.rows[0][0]).toMatchObject({ text: "Quarterly Report", colSpan: 3, rowSpan: 1 });
    expect(grid.rows[0][1].covered).toBe(true);
    expect(grid.rows[0][2].covered).toBe(true);
    expect(grid.rows[1].map((c) => c.text)).toEqual(["Note", "Left?", "x"]);
    expect(grid.rows[2][1].text).toBe("₹1,234.50");
    // the file's 20-wide column A (19.17 characters) is kept; the merged title doesn't widen it
    expect(grid.colChars?.[0]).toBeCloseTo(19.17, 1);
  });

  test("the PDF shows the formatted values, the rupee sign and no hidden data", async () => {
    const bytes = await styledWorkbook();
    const out = await convertDoc("report.xlsx", { text: async () => "", bytes: async () => bytes }, defaultDocOptions("excel"), { loadFont });
    const text = norm((await pdfPages(out.bytes)).join(" "));
    expect(text).toContain("Quarterly Report");
    // ₹ is drawn from the currency font, so the extractor sees it as its own text item
    expect(text).toMatch(/₹ ?1,234\.50/);
    expect(text).not.toContain("?1,234");
    expect(text).not.toContain("secret column");
    expect(out.warnings.join(" ")).not.toContain("replaced with '?'");
  });

  test("a workbook without its own formatting keeps the default header and stripes", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a", "b"], [1, 2], [3, 4]]), "Plain");
    const data = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    const { sheets } = await workbookGrids(data);
    expect(sheets[0].grid.styled).toBe(false);
  });
});

const BORDERS = `<borders count="2"><border/><border><left style="medium"><color rgb="FF000000"/></left><right style="thin"/><top style="thin"><color theme="4"/></top><bottom style="thick"/></border></borders>`;
const BORDERED = STYLES.replace('<borders count="1"><border/></borders>', BORDERS).replace(
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf>',
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1"/></xf>',
);

/** A sheet printed in Excel's own layout: page setup, print area, row heights, overflowing text. */
const LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:F4"/>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols><col min="1" max="4" width="10" customWidth="1"/><col min="5" max="5" width="40" customWidth="1"/></cols>
  <sheetData>
    <row r="1" ht="30" customHeight="1">${str("A1", 0, "A long line of text that runs on past its own cell")}<c r="B1" s="4"/></row>
    <row r="2">${str("A2", 0, "Cut off at the next cell")}${str("B2", 0, "Next")}</row>
    <row r="3">${str("A3", 4, "Wrapped in a bordered cell")}${str("C3", 0, "Gap:          wide")}</row>
    <row r="4">${str("A4", 0, "prints")}${str("F4", 0, "outside the print area")}</row>
  </sheetData>
  <printOptions horizontalCentered="1"/>
  <pageMargins left="0.5" right="0.5" top="1" bottom="1" header="0.3" footer="0.3"/>
  <pageSetup paperSize="1" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
const PRINT_AREA = `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">Report!$A$1:$E$4</definedName></definedNames>`;

describe("excel in its own print layout", () => {
  const grid = async () => (await workbookGrids(await styledWorkbook(LAYOUT, PRINT_AREA))).sheets[0].grid;

  test("reads the page setup: paper, orientation, margins, fit to page", async () => {
    const g = await grid();
    const setup = g.sheet?.setup ?? {};
    expect(setup).toMatchObject({ paperSize: 1, landscape: true, fitToPage: true, fitToWidth: 1, fitToHeight: 0, centerH: true });
    const spec = sheetPageSpec(setup);
    expect([spec.width, spec.height]).toEqual([792, 612]);
    expect(spec.margin).toEqual({ left: 36, right: 36, top: 72, bottom: 72 });
    // 4 x 10 + 40 width units = 80 x 5.25pt = 420pt, which fits: fit-to-page never enlarges
    expect(sheetScale(g, spec)).toBe(1);
  });

  test("prints only the print area, with Excel's row heights", async () => {
    const g = await grid();
    expect(g.rows[0].length).toBe(5);
    expect(g.rows.flat().map((c) => c.text)).not.toContain("outside the print area");
    expect(g.sheet?.rowHeights).toEqual([30, 15, 15, 15]);
  });

  test("text overflows into empty cells, cuts off at a filled one, and keeps its spaces", async () => {
    const g = await grid();
    const [table] = sheetToBlocks(g, sheetPageSpec(g.sheet?.setup ?? {})) as Extract<import("../word-to-pdf/model").Block, { kind: "table" }>[];
    const row = (i: number) => table.rows[i].cells;
    // A1 runs over the empty C1 and D1 too
    expect(row(0)[0].colSpan).toBeGreaterThan(1);
    expect(row(0)[0].blocks[0]).toMatchObject({ oneLine: true });
    // A2 can't: B2 has text
    expect(row(1)[0].colSpan).toBe(1);
    expect(row(1)[1].blocks[0]).toMatchObject({ kind: "para" });
    expect(table.rows[0].minHeight).toBe(30);
    // no gridlines unless the sheet prints them
    expect(table.info?.borders).toBeNull();
  });

  test("cell borders, wrap text and vertical alignment come from the cell style", async () => {
    const bytes = await (async () => {
      const zip = await JSZip.loadAsync(await styledWorkbook(LAYOUT, PRINT_AREA));
      zip.file("xl/styles.xml", BORDERED);
      return zip.generateAsync({ type: "arraybuffer" });
    })();
    const styles = await readWorkbookStyles(bytes);
    const a3 = styles?.sheets.get("Report")?.cells.get("A3");
    expect(a3).toMatchObject({ align: "right", valign: "top", wrap: true });
    expect(a3?.border).toEqual({
      left: { width: 1, color: "000000" },
      right: { width: 0.5, color: "000000" },
      top: { width: 0.5, color: "4472C4" },
      bottom: { width: 1.5, color: "000000" },
    });
    const g = (await workbookGrids(bytes)).sheets[0].grid;
    const [table] = sheetToBlocks(g, sheetPageSpec(g.sheet?.setup ?? {})) as Extract<import("../word-to-pdf/model").Block, { kind: "table" }>[];
    const cell = table.rows[2].cells[0];
    expect(cell.edges?.bottom).toEqual({ width: 1.5, color: "000000" });
    expect(cell.valign).toBe("top");
    expect(cell.blocks[0]).toMatchObject({ oneLine: false, align: "right" });
    // cells without a vertical alignment sit at the bottom, as in Excel
    expect(table.rows[1].cells[1].valign).toBe("bottom");
  });

  test("the PDF uses the sheet's paper and keeps runs of spaces", async () => {
    const { PDFDocument } = await import("@cantoo/pdf-lib");
    const bytes = await styledWorkbook(LAYOUT, PRINT_AREA);
    const out = await convertDoc("layout.xlsx", { text: async () => "", bytes: async () => bytes }, defaultDocOptions("excel"), { loadFont });
    const page = (await PDFDocument.load(out.bytes)).getPage(0);
    expect([Math.round(page.getWidth()), Math.round(page.getHeight())]).toEqual([792, 612]);
    const text = norm((await pdfPages(out.bytes)).join(" "));
    // A2 stops where B2 begins, at a whole word
    expect(text).toContain("Next");
    expect(text).not.toContain("next cell");
    // Excel prints no sheet title or page footer of its own
    expect(text).not.toContain("Page 1 of");
    // the ten spaces after "Gap:" are kept: "wide" starts well past one space's width
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: out.bytes.slice(), useSystemFonts: false, verbosity: 0 }).promise;
    const items = (await (await doc.getPage(1)).getTextContent()).items.filter((i) => "str" in i) as { str: string; transform: number[]; width: number }[];
    const gap = items.find((i) => i.str.startsWith("Gap:"));
    expect(gap).toBeDefined();
    const wide = items.find((i) => i.str.trim() === "wide");
    expect(wide).toBeDefined();
    // "Gap:" is about 1.9em and ten spaces about 2.8em more; one collapsed space would put "wide" near 2.2em
    const em = gap?.transform[0] ?? 1;
    const start = (wide?.transform[4] ?? 0) - (gap?.transform[4] ?? 0);
    expect(start / em).toBeGreaterThan(4);
  });
});

describe("hindi text", () => {
  const HINDI = "प्रमाणित किया जाता है कि आंगनवाड़ी (फर्नीचर-वर्तन) क्र॰";

  test("is drawn with the Devanagari font, not replaced with '?'", async () => {
    const sheet = SHEET.replace("Quarterly Report", HINDI);
    const bytes = await styledWorkbook(sheet);
    const out = await convertDoc("hindi.xlsx", { text: async () => "", bytes: async () => bytes }, defaultDocOptions("excel"), { loadFont });
    expect(out.warnings.join(" ")).not.toContain("replaced with '?'");
    const raw = new TextDecoder("latin1").decode(out.bytes);
    expect(raw).toContain("NotoSansDevanagari");
    // the shaped glyphs carry the original text for copy and paste
    const { PDFDocument, PDFRawStream, decodePDFRawStream } = await import("@cantoo/pdf-lib");
    const pdf = await PDFDocument.load(out.bytes);
    const streams = pdf.context.enumerateIndirectObjects().flatMap(([, o]) => (o instanceof PDFRawStream ? [o] : []));
    const content = streams.map((st) => {
      try {
        return new TextDecoder("latin1").decode(decodePDFRawStream(st).decode());
      } catch {
        return "";
      }
    });
    expect(content.some((c) => c.includes("/Span <<") && c.includes("/ActualText"))).toBe(true);
  });
});

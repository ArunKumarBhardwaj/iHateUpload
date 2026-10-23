import { describe, expect, test } from "bun:test";
import JSZip from "jszip";

import { quoteLiterals, workbookGrids } from "./excel";
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

async function styledWorkbook(): Promise<ArrayBuffer> {
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
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file("xl/styles.xml", STYLES);
  zip.file("xl/worksheets/sheet1.xml", SHEET);
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
    const cells = styles?.sheets.get("Report");
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

/**
 * The shape of a real delivery challan: rich-text cells, Hindi typed in Kruti Dev, a merge that
 * spans rows with more rows below it, a logo, a full-page picture Excel doesn't draw, and a page
 * setup without a paper size.
 */
import { describe, expect, test } from "bun:test";
import JSZip from "jszip";

import { workbookGrids } from "./excel";
import { sheetPageSpec, sheetToBlocks } from "./excel-layout";
import { readWorkbookStyles } from "./excel-styles";
import { defaultDocOptions } from "./options";
import { convertDoc } from "./process";
import { loadFont, pdfPages } from "./testkit";
import type { Block } from "../word-to-pdf/model";

// a 2x2 red PNG
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwAAACg0BAyqHB2oAAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0),
);

const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="10"/><name val="Arial"/></font>
    <font><b/><sz val="20"/><color rgb="FF483D3D"/><name val="Arial"/></font>
    <font><b/><i/><sz val="16"/><name val="Kruti Dev 010"/></font>
  </fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="3">
    <border/>
    <border><left style="medium"/><right style="medium"/><top style="medium"/></border>
    <border><left style="medium"/><right style="medium"/><bottom style="medium"/></border>
  </borders>
  <cellXfs count="5">
    <xf fontId="0" fillId="0" borderId="0"/>
    <xf fontId="1" fillId="0" borderId="0"/>
    <xf fontId="2" fillId="0" borderId="0"><alignment horizontal="left" vertical="center"/></xf>
    <xf fontId="0" fillId="0" borderId="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf fontId="0" fillId="0" borderId="2"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
</styleSheet>`;

const SST = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><r><t xml:space="preserve">Alex </t></r><r><rPr><b/><sz val="20"/><color rgb="FF3B87CD"/><rFont val="Arial"/></rPr><t>Industries</t></r></si>
  <si><t>vkt fnukad dks izkIr dh xbZ gSA</t></si>
  <si><t>ITEMS</t></si>
  <si><t>Below</t></si>
  <si><r><rPr><b/><sz val="12"/><rFont val="Kruti Dev 010"/></rPr><t>izekf.kr</t></r><r><rPr><sz val="10"/><rFont val="Arial"/></rPr><t xml:space="preserve"> OK</t></r></si>
</sst>`;

const SHEET = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols><col min="1" max="1" width="10" customWidth="1"/><col min="2" max="2" width="40" customWidth="1"/></cols>
  <sheetData>
    <row r="1" ht="30" customHeight="1"><c r="A1" s="1" t="s"><v>0</v></c></row>
    <row r="2" ht="20" customHeight="1"><c r="A2" s="2" t="s"><v>1</v></c></row>
    <row r="3" ht="20" customHeight="1"><c r="A3" s="3" t="s"><v>2</v></c><c r="B3" s="3"/></row>
    <row r="4" ht="20" customHeight="1"><c r="A4" s="4"/><c r="B4" s="4"/></row>
    <row r="5" ht="20" customHeight="1"><c r="A5" t="s"><v>3</v></c></row>
    <row r="6" ht="20" customHeight="1"><c r="B6" t="s"><v>4</v></c></row>
  </sheetData>
  <mergeCells count="2"><mergeCell ref="A2:B2"/><mergeCell ref="A3:A4"/></mergeCells>
  <pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
  <pageSetup scale="100" orientation="portrait"/>
  <drawing r:id="rId1"/>
</worksheet>`;

const anchor = (body: string, from: string, to: string) =>
  `<xdr:twoCellAnchor><xdr:from>${from}</xdr:from><xdr:to>${to}</xdr:to>${body}<xdr:clientData/></xdr:twoCellAnchor>`;
const at = (col: number, colOff: number, row: number, rowOff: number) =>
  `<xdr:col>${col}</xdr:col><xdr:colOff>${colOff}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${rowOff}</xdr:rowOff>`;
const pic = (id: string, name: string, geom: string, hidden = "") =>
  `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="${name}"${hidden}/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm>${geom}</xdr:spPr></xdr:pic>`;

const DRAWING = `<?xml version="1.0" encoding="UTF-8"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  ${anchor(pic("rId1", "letterhead", `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="0" b="0"/><a:pathLst/></a:custGeom>`), at(0, 0, 0, 0), at(2, 0, 6, 0))}
  ${anchor(pic("rId1", "hidden", `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`, ` hidden="1"`), at(0, 0, 0, 0), at(1, 0, 1, 0))}
  ${anchor(pic("rId1", "logo", `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`), at(1, 127000, 0, 12700), at(1, 508000, 0, 330200))}
</xdr:wsDr>`;

async function challan(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const rel = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const rels = (...r: string[]) => `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${r.join("")}</Relationships>`;
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`,
  );
  zip.file("_rels/.rels", rels(rel("rId1", "officeDocument", "xl/workbook.xml")));
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Challan" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file("xl/_rels/workbook.xml.rels", rels(rel("rId1", "worksheet", "worksheets/sheet1.xml"), rel("rId2", "styles", "styles.xml"), rel("rId3", "sharedStrings", "sharedStrings.xml")));
  zip.file("xl/styles.xml", STYLES);
  zip.file("xl/sharedStrings.xml", SST);
  zip.file("xl/worksheets/sheet1.xml", SHEET);
  zip.file("xl/worksheets/_rels/sheet1.xml.rels", rels(rel("rId1", "drawing", "../drawings/drawing1.xml")));
  zip.file("xl/drawings/drawing1.xml", DRAWING);
  zip.file("xl/drawings/_rels/drawing1.xml.rels", rels(rel("rId1", "image", "../media/image1.png")));
  zip.file("xl/media/image1.png", PNG);
  return zip.generateAsync({ type: "arraybuffer" });
}

type TableBlock = Extract<Block, { kind: "table" }>;

describe("a delivery challan", () => {
  test("rich text keeps each run's colour and size; Kruti Dev runs become Unicode Hindi", async () => {
    const styles = await readWorkbookStyles(await challan());
    const runs = styles?.sheets.get("Challan")?.runs;
    expect(runs?.get("A1")).toEqual([
      { text: "Alex " },
      { text: "Industries", style: { bold: true, italic: false, underline: false, strike: false, size: 20, color: "3B87CD", family: "sans" } },
    ]);
    expect(runs?.get("B6")?.map((r) => r.text)).toEqual(["प्रमाणित", " OK"]);
  });

  test("a cell in a Kruti Dev font is converted too", async () => {
    const { sheets } = await workbookGrids(await challan());
    expect(sheets[0].grid.rows[1][0].text).toBe("आज दिनांक को प्राप्त की गई है।");
  });

  test("only the logo is drawn: the hidden picture and the one with an empty outline are not", async () => {
    const styles = await readWorkbookStyles(await challan());
    const pics = styles?.sheets.get("Challan")?.pictures ?? [];
    expect(pics.length).toBe(1);
    expect(pics[0].from).toEqual({ col: 1, row: 0, dx: 10, dy: 1 });
    expect(pics[0].to).toEqual({ col: 1, row: 0, dx: 40, dy: 26 });
  });

  test("a page setup without a paper size prints on Letter", async () => {
    const { sheets } = await workbookGrids(await challan());
    const spec = sheetPageSpec(sheets[0].grid.sheet?.setup ?? {});
    expect([spec.width, spec.height]).toEqual([612, 792]);
  });

  test("a merge spanning rows takes their full height and outline; the row below starts at column A", async () => {
    const { sheets } = await workbookGrids(await challan());
    const g = sheets[0].grid;
    expect(g.rows[2][0]).toMatchObject({ text: "ITEMS", rowSpan: 2 });
    // the outline comes from the cells along each side: the bottom from A4
    expect(g.rows[2][0].style?.border?.bottom).toEqual({ width: 1, color: "000000" });
    const [table] = sheetToBlocks(g, sheetPageSpec(g.sheet?.setup ?? {})) as TableBlock[];
    expect(table.rows.every((r) => r.exactHeight)).toBe(true);

    const bytes = await challan();
    const out = await convertDoc("challan.xlsx", { text: async () => "", bytes: async () => bytes }, defaultDocOptions("excel"), { loadFont });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: out.bytes.slice(), useSystemFonts: false, verbosity: 0 }).promise;
    const items = (await (await doc.getPage(1)).getTextContent()).items.filter((i) => "str" in i) as { str: string; transform: number[] }[];
    const x = (s: string) => items.find((i) => i.str.includes(s))?.transform[4] ?? -1;
    const y = (s: string) => items.find((i) => i.str.includes(s))?.transform[5] ?? -1;
    // "Below" sits in column A, at the left margin, not pushed to column B
    expect(x("Below")).toBeCloseTo(36 + 1.5, 0);
    // ITEMS is centred vertically in the 40pt merged box (rows 3 and 4), not in row 3 alone
    const top = 792 - 36 - 30 - 20;
    expect(y("ITEMS")).toBeLessThan(top - 20);
    expect(y("ITEMS")).toBeGreaterThan(top - 40);
    const text = (await pdfPages(out.bytes)).join(" ");
    expect(text).toContain("Industries");
    expect(text).not.toContain("vkt fnukad");
  });

  test("the logo is drawn above the cells and clipped to the sheet", async () => {
    const bytes = await challan();
    const { sheets } = await workbookGrids(bytes);
    const g = sheets[0].grid;
    const [table] = sheetToBlocks(g, sheetPageSpec(g.sheet?.setup ?? {})) as TableBlock[];
    expect(table.pictures?.length).toBe(1);
    const p = table.pictures?.[0];
    // column A is 10 units (52.5pt); the logo starts 10pt into column B
    expect(p?.x).toBeCloseTo(62.5, 1);
    expect(p?.w).toBeCloseTo(30, 1);
    expect(p?.top).toEqual({ row: 0, dy: 1 });
    expect(p?.bottom).toEqual({ row: 0, dy: 26 });
    const out = await convertDoc("challan.xlsx", { text: async () => "", bytes: async () => bytes }, defaultDocOptions("excel"), { loadFont });
    const raw = new TextDecoder("latin1").decode(out.bytes);
    expect(raw).toMatch(/\/Subtype \/Image/);
  });
});

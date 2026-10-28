import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";

import { readWorkbookStyles, type CellStyle, type WorkbookStyles } from "./excel-styles";
import { krutiToUnicode } from "./krutidev";
import { applyOdsGeometry, readOds, readOdsGeometry, readOdsStyles } from "./ods-styles";

const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:css3t="http://www.w3.org/TR/css3-text/"',
].join(" ");

const FONTS = `<office:font-face-decls>
  <style:font-face style:name="Liberation Sans" svg:font-family="&apos;Liberation Sans&apos;"/>
  <style:font-face style:name="Arial" svg:font-family="Arial"/>
  <style:font-face style:name="Calibri1" svg:font-family="Calibri"/>
  <style:font-face style:name="Times New Roman" svg:font-family="&apos;Times New Roman&apos;"/>
  <style:font-face style:name="Kruti Dev 010" svg:font-family="&apos;Kruti Dev 010&apos;"/>
</office:font-face-decls>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS}>${FONTS}
<office:styles>
  <style:default-style style:family="table-cell">
    <style:table-cell-properties fo:wrap-option="no-wrap"/>
    <style:text-properties style:font-name="Liberation Sans" fo:font-size="10pt"/>
  </style:default-style>
  <style:style style:name="Default" style:family="table-cell">
    <style:text-properties style:font-name="Arial"/>
  </style:style>
  <style:style style:name="Heading" style:family="table-cell" style:parent-style-name="Default">
    <style:table-cell-properties fo:border="0.74pt solid #808080"/>
    <style:text-properties fo:font-size="150%" fo:font-weight="bold"/>
  </style:style>
</office:styles>
<office:automatic-styles>
  <style:page-layout style:name="Mpm1">
    <style:page-layout-properties fo:page-width="8.5in" fo:page-height="11in" style:print-orientation="portrait"
      fo:margin-top="0.5in" fo:margin-bottom="0.5in" fo:margin-left="0.75in" fo:margin-right="0.75in" style:scale-to-pages="1"/>
    <style:header-style><style:header-footer-properties fo:min-height="0.25in"/></style:header-style>
    <style:footer-style><style:header-footer-properties fo:min-height="0.25in"/></style:footer-style>
  </style:page-layout>
  <style:page-layout style:name="Mpm2">
    <style:page-layout-properties fo:page-width="420mm" fo:page-height="297mm" style:print-orientation="landscape"
      fo:margin-top="1cm" fo:margin-bottom="1cm" fo:margin-left="2cm" fo:margin-right="2cm"
      style:scale-to-X="2" style:scale-to-Y="0" style:print="charts drawings grid objects zero-values" style:table-centering="both"/>
    <style:header-style><style:header-footer-properties fo:min-height="1cm"/></style:header-style>
  </style:page-layout>
</office:automatic-styles>
<office:master-styles>
  <style:master-page style:name="Default" style:page-layout-name="Mpm1">
    <style:header><text:p><text:sheet-name>???</text:sheet-name> &amp; co</text:p></style:header>
    <style:footer><text:p>Page <text:page-number>1</text:page-number><text:s text:c="2"/>of <text:page-count>9</text:page-count></text:p></style:footer>
  </style:master-page>
  <style:master-page style:name="Wide" style:page-layout-name="Mpm2">
    <style:header>
      <style:region-left><text:p><text:title>t</text:title></text:p></style:region-left>
      <style:region-right><text:p><text:date>d</text:date> <text:time>t</text:time></text:p></style:region-right>
    </style:header>
    <style:footer style:display="false"/>
  </style:master-page>
</office:master-styles>
</office:document-styles>`;

const cellStyle = (name: string, cell = "", para = "", text = "", parent = "Default") =>
  `<style:style style:name="${name}" style:family="table-cell" style:parent-style-name="${parent}">` +
  (cell ? `<style:table-cell-properties ${cell}/>` : "") +
  (para ? `<style:paragraph-properties ${para}/>` : "") +
  (text ? `<style:text-properties ${text}/>` : "") +
  `</style:style>`;

const AUTO = [
  `<style:style style:name="co1" style:family="table-column"><style:table-column-properties style:column-width="1.5in"/></style:style>`,
  `<style:style style:name="co2" style:family="table-column"><style:table-column-properties style:column-width="0.75in" fo:break-before="page"/></style:style>`,
  `<style:style style:name="ro1" style:family="table-row"><style:table-row-properties style:row-height="0.3in"/></style:style>`,
  `<style:style style:name="ro2" style:family="table-row"><style:table-row-properties style:row-height="12.8pt" fo:break-before="page"/></style:style>`,
  `<style:style style:name="ta1" style:family="table" style:master-page-name="Default"><style:table-properties table:display="true" style:writing-mode="lr-tb"/></style:style>`,
  `<style:style style:name="ta2" style:family="table" style:master-page-name="Wide"><style:table-properties table:display="true" style:writing-mode="rl-tb"/></style:style>`,
  cellStyle("ceBold", "", "", 'fo:font-weight="bold" fo:font-style="italic" style:text-underline-style="solid" style:text-line-through-style="solid" fo:font-size="14pt" fo:color="#c00000" style:font-name="Calibri1"'),
  cellStyle("ceTimes", 'fo:background-color="#ffff00"', "", 'style:font-name="Times New Roman" fo:color="#000000"'),
  cellStyle("ceWhite", 'fo:background-color="#ffffff"', "", 'style:use-window-font-color="true" fo:color="#ff0000"'),
  cellStyle("ceKruti", "", "", 'style:font-name="Kruti Dev 010" fo:font-size="12pt"'),
  cellStyle("ceBorders", 'fo:border="0.74pt solid #000000" fo:border-bottom="1.76pt dashed #0000ff" fo:border-left="2.49pt double #ff0000" fo:border-right="0.74pt dotted #00ff00"'),
  cellStyle("ceNoTop", 'fo:border-top="none"', "", "", "Heading"),
  cellStyle("ceCenter", 'style:text-align-source="fix" style:vertical-align="middle" fo:wrap-option="wrap"', 'fo:text-align="center"'),
  cellStyle("ceGeneral", 'style:text-align-source="value-type"', 'fo:text-align="end"'),
  cellStyle("ceIndent", 'style:text-align-source="fix" style:vertical-align="top" style:shrink-to-fit="true"', 'fo:text-align="end" fo:margin-left="0.2335in"'),
  cellStyle("ceRot", 'style:rotation-angle="315"', 'fo:text-align="start"'),
  cellStyle("ceRot90", 'style:rotation-angle="90deg"'),
  cellStyle("ceStacked", 'style:direction="ttb"'),
  cellStyle("ceFill", 'style:repeat-content="true"'),
  cellStyle("ceCol", 'fo:background-color="#ddeeff"'),
  `<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold" fo:color="#0000ff"/></style:style>`,
  `<style:style style:name="T2" style:family="text"><style:text-properties style:font-name="Kruti Dev 010"/></style:style>`,
].join("");

const cell = (style: string | undefined, text: string, extra = "") =>
  `<table:table-cell${style ? ` table:style-name="${style}"` : ""} office:value-type="string"${extra}><text:p>${text}</text:p></table:table-cell>`;

const CONTENT = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS}>${FONTS}
<office:automatic-styles>${AUTO}</office:automatic-styles>
<office:body><office:spreadsheet>
<table:table table:name="Data" table:style-name="ta1">
  <table:table-column table:style-name="co1" table:default-cell-style-name="Default"/>
  <table:table-column table:style-name="co1" table:default-cell-style-name="ceCol"/>
  <table:table-column table:style-name="co2" table:visibility="collapse"/>
  <table:table-column table:style-name="co1" table:number-columns-repeated="16381"/>
  <table:table-row table:style-name="ro1">
    ${cell("ceBold", "Bold")}${cell("ceTimes", "Times")}${cell("ceWhite", "White")}
    <table:table-cell table:style-name="Default" table:number-columns-repeated="16381"/>
  </table:table-row>
  <table:table-row table:style-name="ro1">
    ${cell("ceKruti", "vkt")}${cell(undefined, "column default")}<table:table-cell/>
    <table:table-cell table:number-columns-repeated="16381"/>
  </table:table-row>
  <table:table-row table:style-name="ro1" table:number-rows-repeated="2">
    ${cell("ceBorders", "b")}<table:table-cell table:style-name="ceNoTop"/><table:table-cell table:style-name="ceCenter"/>
  </table:table-row>
  <table:table-row table:style-name="ro2">
    ${cell("ceGeneral", "g")}${cell("ceIndent", "i")}${cell("ceRot", "r")}${cell("ceRot90", "r90")}${cell("ceStacked", "s")}${cell("ceFill", "f")}
  </table:table-row>
  <table:table-row table:style-name="ro1" table:visibility="collapse">
    <table:table-cell office:value-type="string"><text:p>Plain <text:span text:style-name="T1">bold<text:s/>blue</text:span> <text:span text:style-name="T2">fnukad</text:span></text:p><text:p>line two</text:p><office:annotation><text:p>a comment</text:p></office:annotation></table:table-cell>
    ${cell(undefined, "x &amp; y", ' table:number-columns-spanned="2"')}<table:covered-table-cell/>
  </table:table-row>
  <table:table-row table:style-name="ro1" table:number-rows-repeated="1048570">
    <table:table-cell table:style-name="ceTimes" table:number-columns-repeated="16384"/>
  </table:table-row>
</table:table>
<table:table table:name="RTL Sheet" table:style-name="ta2">
  <table:table-column table:style-name="co1" table:number-columns-repeated="3"/>
  <table:table-row table:style-name="ro1">${cell("Heading", "Big")}${cell("ceNoTop", "Bigger")}</table:table-row>
</table:table>
</office:spreadsheet></office:body></office:document-content>`;

async function odsFile(content = CONTENT, styles = STYLES, mime = "application/vnd.oasis.opendocument.spreadsheet"): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", mime, { compression: "STORE" });
  zip.file(
    "META-INF/manifest.xml",
    `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
  );
  zip.file("content.xml", content);
  zip.file("styles.xml", styles);
  return zip.generateAsync({ type: "uint8array" });
}

describe("ods cell formatting", () => {
  test("base font comes from the Default cell style", async () => {
    const styles = await readOdsStyles(await odsFile());
    expect(styles?.baseSize).toBe(10);
    expect(styles?.baseFamily).toBe("sans");
    expect([...(styles?.sheets.keys() ?? [])]).toEqual(["Data", "RTL Sheet"]);
  });

  test("reads fonts, colours, families, fills and Kruti Dev", async () => {
    const cells = (await readOdsStyles(await odsFile()))?.sheets.get("Data")?.cells;
    expect(cells?.get("A1")).toEqual({ bold: true, italic: true, underline: true, strike: true, size: 14, family: "carlito", color: "C00000" });
    // black text and white fills are what the PDF prints anyway
    expect(cells?.get("B1")).toEqual({ family: "serif", fill: "FFFF00" });
    // the window font colour wins over fo:color
    expect(cells?.has("C1")).toBe(false);
    expect(cells?.get("A2")).toEqual({ size: 12, kruti: true });
  });

  test("cells without a style take their column's default cell style", async () => {
    const cells = (await readOdsStyles(await odsFile()))?.sheets.get("Data")?.cells;
    expect(cells?.get("B2")).toEqual({ fill: "DDEEFF" });
    // a column default only fills the used range, not a million rows
    expect(cells?.has("B9")).toBe(false);
    expect(cells?.has("A1")).toBe(true);
  });

  test("borders: fo:border with side overrides, dashed, dotted, double, and inherited ones", async () => {
    const cells = (await readOdsStyles(await odsFile()))?.sheets.get("Data")?.cells;
    expect(cells?.get("A3")?.border).toEqual({
      top: { color: "000000", width: 0.5 },
      right: { color: "00FF00", width: 0.5, dash: [0.75, 0.75] },
      bottom: { color: "0000FF", width: 1, dash: [6.75, 2.25] },
      left: { color: "FF0000", width: 1.5, double: true },
    });
    // repeated rows repeat their cells' styles
    expect(cells?.get("A4")).toEqual(cells?.get("A3") as CellStyle);
    // a parent's fo:border, with the child turning one side off; 150% of the base 10pt
    expect(cells?.get("B3")).toEqual({
      bold: true,
      size: 15,
      border: { right: { color: "808080", width: 0.5 }, bottom: { color: "808080", width: 0.5 }, left: { color: "808080", width: 0.5 } },
    });
  });

  test("alignment, wrap, shrink, indent, rotation and fill", async () => {
    const cells = (await readOdsStyles(await odsFile()))?.sheets.get("Data")?.cells;
    expect(cells?.get("C3")).toEqual({ align: "center", valign: "middle", wrap: true });
    // value-type alignment is General: no fixed alignment
    expect(cells?.has("A5")).toBe(false);
    expect(cells?.get("B5")).toEqual({ align: "right", valign: "top", shrink: true, indent: 2 });
    expect(cells?.get("C5")).toEqual({ align: "left", rotate: -45 });
    expect(cells?.get("D5")).toEqual({ rotate: 90 });
    expect(cells?.get("E5")).toEqual({ rotate: "stacked" });
    expect(cells?.get("F5")).toEqual({ align: "left", repeat: true });
  });

  test("rich text runs: spans over the cell's font, Kruti Dev converted, comments skipped", async () => {
    const sheet = (await readOdsStyles(await odsFile()))?.sheets.get("Data");
    const runs = sheet?.runs.get("A6");
    expect(runs?.map((r) => r.text).join("")).toBe("Plain bold blue दिनांक\nline two");
    expect(runs?.[0]).toEqual({ text: "Plain " });
    expect(runs?.[1]).toEqual({ text: "bold blue", style: { bold: true, italic: false, underline: false, strike: false, size: 10, color: "0000FF", family: "sans" } });
    expect(runs?.[3].style?.family).toBe("sans");
    expect(runs?.[3].text).toBe("दिनांक");
    // plain cells have no runs
    expect(sheet?.runs.has("B6")).toBe(false);
  });

  test("in a Kruti Dev cell, plain text and spans that keep the cell's font are converted too", async () => {
    const content = CONTENT.replace('<table:table-cell office:value-type="string"><text:p>Plain', '<table:table-cell table:style-name="ceKruti" office:value-type="string"><text:p>vkt');
    const runs = (await readOdsStyles(await odsFile(content)))?.sheets.get("Data")?.runs.get("A6");
    expect(runs?.[0]).toEqual({ text: "आज " });
    expect(runs?.[1].text).toBe(krutiToUnicode("bold blue"));
    expect(runs?.[1].style).toMatchObject({ bold: true, size: 12, family: "sans" });
  });

  test("a hairline is a thin solid line, as LibreOffice prints it", async () => {
    const content = CONTENT.replace('fo:border="0.74pt solid #000000"', 'fo:border="0.05pt solid #000000"');
    const cells = (await readOdsStyles(await odsFile(content)))?.sheets.get("Data")?.cells;
    expect(cells?.get("A3")?.border?.top).toEqual({ color: "000000", width: 0.25 });
  });

  test("page setup: paper, margins below the header, fit, header and footer codes, breaks", async () => {
    const setup = (await readOdsStyles(await odsFile()))?.sheets.get("Data")?.setup;
    expect(setup).toMatchObject({
      hasPageSetup: true,
      paperSize: 1,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.75, right: 0.75, top: 0.75, bottom: 0.75 },
      headerMargin: 0.5,
      footerMargin: 0.5,
      header: "&C&A && co",
      footer: "&CPage &P  of &N",
      rowBreaks: [4],
      colBreaks: [2],
    });
    expect(setup?.landscape).toBeUndefined();
    expect(setup?.gridLines).toBeUndefined();
    expect(setup?.rtl).toBeUndefined();
    expect(setup?.defaultColWidth).toBeCloseTo(108 / 5.25, 3);
    expect(setup?.defaultRowHeight).toBeCloseTo(21.6, 3);
  });

  test("right-to-left sheet with its own master page: A3 landscape, grid, centring, regions", async () => {
    const sheet = (await readOdsStyles(await odsFile()))?.sheets.get("RTL Sheet");
    expect(sheet?.setup).toMatchObject({
      rtl: true,
      paperSize: 8,
      landscape: true,
      fitToPage: true,
      fitToWidth: 2,
      fitToHeight: 0,
      gridLines: true,
      centerH: true,
      header: "&L&F&R&D &T",
      headerMargin: 0.3937,
    });
    expect(sheet?.setup.footer).toBeUndefined();
    expect(sheet?.setup.margins?.top).toBeCloseTo(0.7874, 3);
    expect(sheet?.cells.get("A1")).toEqual({ bold: true, size: 15, border: expect.any(Object) });
  });

  test("geometry: widths in Excel units, heights in points, hidden rows and columns, capped", async () => {
    const geo = (await readOdsGeometry(await odsFile()))?.get("Data");
    expect(geo?.colWidths.length).toBe(6);
    expect(geo?.colWidths[0]).toBeCloseTo(108 / 5.25, 3);
    expect(geo?.colWidths[2]).toBeCloseTo(54 / 5.25, 3);
    expect(geo?.hiddenCols).toEqual([false, false, true, false, false, false]);
    expect(geo?.rowHeights.length).toBe(6);
    expect(geo?.rowHeights[0]).toBeCloseTo(21.6, 3);
    expect(geo?.rowHeights[4]).toBeCloseTo(12.8, 3);
    expect(geo?.hiddenRows).toEqual([false, false, false, false, false, true]);
    const ws: Parameters<typeof applyOdsGeometry>[0] = {};
    applyOdsGeometry(ws, geo as NonNullable<typeof geo>);
    expect(ws["!cols"]?.[2]).toEqual({ width: geo?.colWidths[2], hidden: true });
    expect(ws["!rows"]?.[5]).toEqual({ hpt: geo?.rowHeights[5], hidden: true });
  });

  test("flat .fods documents read the same", async () => {
    const head = STYLES.replace(/<\/office:document-styles>$/, "").replace(/<office:document-styles [^>]*>/, "").replace(/<\?xml[^>]*>/, "");
    const auto = CONTENT.match(/<office:automatic-styles>([\s\S]*?)<\/office:automatic-styles>/)?.[1] ?? "";
    const body = CONTENT.match(/<office:body>[\s\S]*<\/office:body>/)?.[0] ?? "";
    const fods = `<?xml version="1.0" encoding="UTF-8"?><office:document ${NS} office:mimetype="application/vnd.oasis.opendocument.spreadsheet">${head.replace("</office:automatic-styles>", `${auto}</office:automatic-styles>`)}${body}</office:document>`;
    const styles = await readOdsStyles(new TextEncoder().encode(fods));
    expect(styles?.sheets.get("Data")?.cells.get("A1")?.bold).toBe(true);
    expect(styles?.sheets.get("RTL Sheet")?.setup.rtl).toBe(true);
  });

  test("anything else is null, never an error", async () => {
    const xlsx = readFileSync(join(import.meta.dir, "fixtures", "ods-parity.xlsx"));
    expect(await readOdsStyles(xlsx)).toBeNull();
    expect(await readOdsGeometry(xlsx)).toBeNull();
    expect(await readOdsStyles(new Uint8Array(0))).toBeNull();
    expect(await readOdsStyles(new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9]))).toBeNull();
    expect(await readOdsStyles(new TextEncoder().encode("a,b\n1,2\n").buffer as ArrayBuffer)).toBeNull();
    expect(await readOdsStyles(await odsFile(CONTENT, STYLES, "application/vnd.oasis.opendocument.text"))).toBeNull();
    // broken XML still gives something sensible rather than throwing
    expect(await readOdsStyles(await odsFile(CONTENT.slice(0, CONTENT.indexOf("<table:table-row") + 120), "<broken"))).not.toBeNull();
  });
});

/** A cell's look with the workbook defaults filled in, so files with different base fonts compare. */
const effective = (wb: WorkbookStyles, s: CellStyle | undefined) => ({ ...s, size: s?.size ?? wb.baseSize, family: s?.family ?? wb.baseFamily });

describe("ods parity with the same workbook as xlsx", () => {
  // ods-parity.ods is ods-parity.xlsx (synthetic) converted by LibreOffice 25: soffice --convert-to ods
  const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name));

  test("cells get the same style from either file", async () => {
    const x = await readWorkbookStyles(fixture("ods-parity.xlsx"));
    const o = await readOds(fixture("ods-parity.ods"));
    if (!x || !o) throw new Error("fixtures unreadable");
    for (const name of ["Report", "Urdu RTL"]) {
      const xs = x.sheets.get(name);
      const os = o.styles.sheets.get(name);
      const refs = new Set([...(xs?.cells.keys() ?? []), ...(os?.cells.keys() ?? [])]);
      expect(refs.size).toBeGreaterThan(name === "Report" ? 40 : 0);
      for (const ref of refs) {
        const want = effective(x, xs?.cells.get(ref));
        expect({ ref, ...effective(o.styles, os?.cells.get(ref)) }).toEqual({ ref, ...want });
      }
      expect([...(os?.runs ?? [])]).toEqual([...(xs?.runs ?? [])]);
    }
  });

  test("page setup matches, apart from Excel's font codes and defaults", async () => {
    const x = await readWorkbookStyles(fixture("ods-parity.xlsx"));
    const o = await readOdsStyles(fixture("ods-parity.ods"));
    for (const name of ["Report", "Urdu RTL"]) {
      const xs = x?.sheets.get(name)?.setup ?? {};
      const os = o?.sheets.get(name)?.setup ?? {};
      for (const key of ["paperSize", "landscape", "fitToPage", "fitToWidth", "fitToHeight", "margins", "gridLines", "centerH", "header", "footer", "rowBreaks", "colBreaks", "rtl"] as const) {
        expect({ name, key, v: os[key] }).toEqual({ name, key, v: xs[key] });
      }
    }
    expect(o?.sheets.get("Report")?.setup.headerMargin).toBe(0.3);
    expect(o?.sheets.get("Report")?.setup.footerMargin).toBe(0.25);
  });

  test("geometry: the hidden row and column, and widths close to Excel's", async () => {
    const geo = (await readOdsGeometry(fixture("ods-parity.ods")))?.get("Report");
    expect(geo?.hiddenCols).toEqual([false, false, true]);
    expect(geo?.hiddenRows[3]).toBe(true);
    expect(geo?.hiddenRows.filter(Boolean).length).toBe(1);
    expect(geo?.rowHeights[0]).toBeCloseTo(30, 0);
    // Excel's 24 and 12 width units; LibreOffice measures with its own font, a few percent wider
    expect(geo?.colWidths[0]).toBeGreaterThan(23);
    expect(geo?.colWidths[0]).toBeLessThan(27);
    expect(geo?.colWidths[1]).toBeGreaterThan(11.5);
    expect(geo?.colWidths[1]).toBeLessThan(13.5);
  });
});

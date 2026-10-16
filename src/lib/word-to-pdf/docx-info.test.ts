import { describe, expect, test } from "bun:test";

import { parseDocxInfo } from "./docx-info";
import { familyForFont } from "./font-map";

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

describe("familyForFont", () => {
  test("maps Office fonts to metric-compatible faces", () => {
    expect(familyForFont("Calibri")).toBe("carlito");
    expect(familyForFont("Calibri Light")).toBe("carlito");
    expect(familyForFont("Aptos")).toBe("carlito");
    expect(familyForFont("Cambria")).toBe("caladea");
    expect(familyForFont("Times New Roman")).toBe("serif");
    expect(familyForFont("Arial")).toBe("sans");
    expect(familyForFont("Courier New")).toBe("mono");
    expect(familyForFont("Consolas")).toBe("mono");
  });
});

describe("parseDocxInfo: drawings", () => {
  test("reads image extents in points, in document order", () => {
    const doc = `<w:document ${NS}><w:body><w:p><w:r><w:drawing><wp:inline><wp:extent cx="2743200" cy="1371600"/><a:graphic><a:blip/></a:graphic></wp:inline></w:drawing></w:r></w:p><w:p><w:r><w:drawing><wp:anchor><wp:extent cx="127000" cy="254000"/><a:graphic><a:blip/></a:graphic></wp:anchor></w:drawing></w:r></w:p></w:body></w:document>`;
    const info = parseDocxInfo({ document: doc });
    expect(info.images).toEqual([
      { w: 216, h: 108 },
      { w: 10, h: 20 },
    ]);
  });
});

describe("parseDocxInfo: tables", () => {
  const tbl = (tblPr: string, grid: number[], rows: string[][]) =>
    `<w:tbl><w:tblPr>${tblPr}</w:tblPr><w:tblGrid>${grid.map((g) => `<w:gridCol w:w="${g}"/>`).join("")}</w:tblGrid>${rows
      .map((r) => `<w:tr>${r.map((fill) => `<w:tc><w:tcPr>${fill ? `<w:shd w:val="clear" w:fill="${fill}"/>` : ""}</w:tcPr><w:p/></w:tc>`).join("")}</w:tr>`)
      .join("")}</w:tbl>`;

  test("grid, width, fills and borders", () => {
    const doc = `<w:document ${NS}><w:body>${tbl(
      '<w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="8" w:color="FF0000"/></w:tblBorders>',
      [3000, 6000],
      [["D9E2F3", "D9E2F3"], ["", ""]],
    )}</w:body></w:document>`;
    const [t] = parseDocxInfo({ document: doc }).tables;
    expect(t.grid).toEqual([150, 300]);
    expect(t.widthPct).toBe(100);
    expect(t.borders).toEqual({ color: "FF0000", width: 1 });
    expect(t.fills[0]).toEqual(["D9E2F3", "D9E2F3"]);
    expect(t.fills[1]).toEqual([undefined, undefined]);
  });

  test("absolute width, no borders without tblBorders or tblStyle, nested tables keep order", () => {
    const inner = tbl("", [1000], [[""]]);
    const outerRow = `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr/>${inner}<w:p/></w:tc></w:tr></w:tbl>`;
    const info = parseDocxInfo({ document: `<w:document ${NS}><w:body>${outerRow}</w:body></w:document>` });
    expect(info.tables.length).toBe(2);
    expect(info.tables[0].widthPt).toBe(200);
    expect(info.tables[0].borders).not.toBeNull(); // a table style is assumed to draw a grid
    expect(info.tables[1].borders).toBeNull();
  });
});

describe("parseDocxInfo: styles", () => {
  const styles = `<w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Base"><w:name w:val="Base"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="123456"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Base"/><w:pPr><w:spacing w:before="240" w:after="0"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi"/><w:b/><w:sz w:val="32"/><w:color w:val="2F5496"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Base"/></w:style>
</w:styles>`;
  const theme = `<a:theme xmlns:a="x"><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Cambria"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;

  test("resolves defaults, theme fonts, basedOn chains and spacing", () => {
    const info = parseDocxInfo({ document: `<w:document ${NS}><w:body/></w:document>`, styles, theme });
    const s = info.styles;
    expect(s.normal.family).toBe("carlito");
    expect(s.normal.size).toBe(11);
    expect(s.normal.spacing).toEqual({ after: 8, line: { kind: "mult", v: 259 / 240 } });
    const h1 = s.heading[1];
    expect(h1.family).toBe("caladea");
    expect(h1.size).toBe(16);
    expect(h1.bold).toBe(true);
    expect(h1.color).toBe("2F5496");
    expect(h1.spacing?.before).toBe(12);
    expect(h1.spacing?.after).toBe(0);
    // inherits colour through Base, spacing line from defaults
    expect(s.heading[2].color).toBe("123456");
    expect(s.heading[2].spacing?.line).toEqual({ kind: "mult", v: 259 / 240 });
  });

  test("a document with no styles part still parses", () => {
    const info = parseDocxInfo({ document: `<w:document ${NS}><w:body/></w:document>` });
    expect(info.styles.normal.family).toBeUndefined();
    expect(info.tables).toEqual([]);
  });
});

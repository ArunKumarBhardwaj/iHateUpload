/**
 * Indian workbooks: every Indian script prints in its own font (shaped by HarfBuzz), Urdu runs right
 * to left, rupee formats group by lakh and crore, and conditional formats colour the cells.
 */
import { describe, expect, test } from "bun:test";
import { PDFDocument, PDFName } from "@cantoo/pdf-lib";
import JSZip from "jszip";

import { applyConditional, evaluate, type CellValue } from "./conditional";
import { visualOrder } from "../word-to-pdf/bidi";
import { indianGrouping, lakhGroup, workbookGrids } from "./excel";
import { defaultDocOptions } from "./options";
import { convertDoc } from "./process";
import { loadFont } from "./testkit";
import { hbFont, loadHarfBuzz } from "../word-to-pdf/harfbuzz";

const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="[$₹-4009]#,##0.00"/></numFmts>
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellXfs count="2"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="0" fillId="0" borderId="0" numFmtId="164" applyNumberFormat="1"/></cellXfs>
  <dxfs count="2">
    <dxf><font><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf>
    <dxf><font><b/></font></dxf>
  </dxfs>
</styleSheet>`;

const str = (r: string, t: string) => `<c r="${r}" t="inlineStr"><is><t>${t}</t></is></c>`;
const num = (r: string, v: number, s = 0) => `<c r="${r}" s="${s}"><v>${v}</v></c>`;

async function book(sheetBody: string, extra = "", view = ""): Promise<ArrayBuffer> {
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
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file("xl/styles.xml", STYLES);
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}<cols><col min="1" max="2" width="40" customWidth="1"/></cols><sheetData>${sheetBody}</sheetData>${extra}<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup paperSize="9"/></worksheet>`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

const convert = async (bytes: ArrayBuffer) =>
  convertDoc("book.xlsx", { text: async () => "", bytes: async () => bytes }, defaultDocOptions("excel"), { loadFont });

async function embeddedFonts(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.context
    .enumerateIndirectObjects()
    .map(([, o]) => String((o as { get?: (k: unknown) => unknown }).get?.(PDFName.of("BaseFont")) ?? ""))
    .filter(Boolean);
}

const SAMPLES: [string, string, string][] = [
  ["Hindi", "उत्तर प्रदेश सरकार", "NotoSansDevanagari"],
  ["Bengali", "পশ্চিমবঙ্গ সরকার", "NotoSansBengali"],
  ["Gujarati", "ગુજરાત સરકાર", "NotoSansGujarati"],
  ["Punjabi", "ਪੰਜਾਬ ਸਰਕਾਰ ਸਿੱਖਿਆ ਵਿਭਾਗ", "NotoSansGurmukhi"],
  ["Odia", "ଓଡ଼ିଶା ସରକାର", "NotoSansOriya"],
  ["Tamil", "தமிழ்நாடு அரசு", "NotoSansTamil"],
  ["Telugu", "తెలంగాణ ప్రభుత్వం", "NotoSansTelugu"],
  ["Kannada", "ಕರ್ನಾಟಕ ಸರ್ಕಾರ", "NotoSansKannada"],
  ["Malayalam", "കേരള സർക്കാർ", "NotoSansMalayalam"],
  ["Urdu", "حکومت جموں و کشمیر", "NotoNaskhArabic"],
  ["Santali", "ᱥᱤᱫᱚ ᱢᱩᱨᱢᱩ", "NotoSansOlChiki"],
];

describe("Indian scripts", () => {
  test("every script prints from its own font, nothing replaced by ?", async () => {
    const rows = SAMPLES.map(([, t], i) => `<row r="${i + 1}">${str(`A${i + 1}`, t)}</row>`).join("");
    const out = await convert(await book(rows));
    expect(out.warnings.filter((w) => /replaced/.test(w))).toEqual([]);
    const fonts = await embeddedFonts(out.bytes);
    for (const [label, , font] of SAMPLES) expect({ label, found: fonts.some((f) => f.includes(font)) }).toEqual({ label, found: true });
  });

  test("HarfBuzz shapes the scripts fontkit can't (Telugu, Malayalam, Gurmukhi marks)", async () => {
    const hb = await loadHarfBuzz(loadFont);
    expect(hb).not.toBeNull();
    for (const [file, text] of [
      ["NotoSansTelugu-Regular.ttf", "ప్రభుత్వం"],
      ["NotoSansMalayalam-Regular.ttf", "സർക്കാർ"],
      ["NotoSansGurmukhi-Regular.ttf", "ਸਿੱਖਿਆ"],
    ]) {
      const font = hbFont(hb as NonNullable<typeof hb>, await loadFont(file));
      const run = font.shape(text);
      expect(run.glyphs.length).toBeGreaterThan(0);
      // no .notdef glyphs
      expect(run.glyphs.includes(0)).toBe(false);
      expect(run.width).toBeGreaterThan(0);
    }
  });

  test("Bengali conjuncts shape to fewer glyphs than letters", async () => {
    const hb = await loadHarfBuzz(loadFont);
    const font = hbFont(hb as NonNullable<typeof hb>, await loadFont("NotoSansBengali-Regular.ttf"));
    // ক্ষ is one conjunct glyph
    expect(font.shape("ক্ষ").glyphs.length).toBe(1);
  });

  test("the HarfBuzz wasm in public/fonts is the installed harfbuzzjs build", async () => {
    const { readFileSync } = await import("node:fs");
    const shipped = readFileSync("public/fonts/harfbuzz-1.6.3.wasm");
    const installed = readFileSync("node_modules/harfbuzzjs/dist/harfbuzz.wasm");
    expect(Buffer.compare(shipped, installed)).toBe(0);
  });
});

describe("right to left", () => {
  const seg = (text: string, rtl = false) => ({ text, rtl });
  const order = (segs: { text: string; rtl: boolean }[]) => visualOrder(segs, (s) => s.rtl).map((s) => s.text);

  test("left-to-right text is untouched", () => {
    expect(order([seg("abc "), seg("def")])).toEqual(["abc ", "def"]);
  });

  test("an Urdu line runs right to left around a dash; brackets mirror", () => {
    expect(order([seg("حکومت جموں ", true), seg("— "), seg("محکمہ تعلیم", true)]).join("")).toBe("محکمہ تعلیم — حکومت جموں");
    expect(order([seg("تنخواہ ", true), seg("(₹)")]).join("")).toBe("(₹) تنخواہ");
  });

  test("numbers and English inside Urdu keep their own order, spaces between", () => {
    expect(order([seg("رقم ", true), seg("PAN ABC 123")]).join("")).toBe("PAN ABC 123 رقم");
    expect(order([seg("قیمت ", true), seg("500 "), seg("روپے", true)]).join("")).toBe("روپے 500 قیمت");
  });

  test("Urdu digits print in reading order", async () => {
    const hb = await loadHarfBuzz(loadFont);
    const font = hbFont(hb as NonNullable<typeof hb>, await loadFont("NotoNaskhArabic-Regular.ttf"));
    const one = font.shape("۱").glyphs[0];
    const three = font.shape("۳").glyphs[0];
    const run = font.shape("۱۲۳").glyphs;
    expect([run[0], run[2]]).toEqual([one, three]);
  });

  test("a right-to-left sheet prints column A on the right; Urdu text sits right", async () => {
    const rows = `<row r="1">${str("A1", "نمبر")}${str("B1", "Name")}</row>`;
    const bytes = await book(rows, "", `<sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>`);
    const { sheets } = await workbookGrids(bytes);
    expect(sheets[0].grid.sheet?.setup.rtl).toBe(true);
    const out = await convert(bytes);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: out.bytes.slice(), useSystemFonts: false, verbosity: 0 }).promise;
    const items = (await (await doc.getPage(1)).getTextContent()).items.filter((i) => "str" in i) as { str: string; transform: number[] }[];
    const name = items.find((i) => i.str.includes("Name")) as (typeof items)[number];
    // column B (Name) is now on the left half of the page
    expect(name.transform[4]).toBeLessThan(595 / 2);
  });
});

describe("rupees", () => {
  test("rupee and en-IN formats group by lakh and crore", () => {
    expect(lakhGroup("₹4,567,890.50")).toBe("₹45,67,890.50");
    expect(lakhGroup("-₹12,345,678.00")).toBe("-₹1,23,45,678.00");
    expect(lakhGroup("(1,234,567.89)")).toBe("(12,34,567.89)");
    expect(lakhGroup("12,345")).toBe("12,345");
    expect(indianGrouping("[$₹-4009]#,##0.00")).toBe(true);
    expect(indianGrouping("#,##,##0")).toBe(true);
    expect(indianGrouping('"Rs."#,##0')).toBe(true);
    expect(indianGrouping("#,##0.00")).toBe(false);
    expect(indianGrouping("0.00")).toBe(false);
  });

  test("a rupee cell prints 45,67,890.50", async () => {
    const { sheets } = await workbookGrids(await book(`<row r="1">${num("A1", 4567890.5, 1)}</row>`));
    expect(sheets[0].grid.rows[0][0].text).toBe("₹45,67,890.50");
  });
});

describe("conditional formatting", () => {
  const grid: Record<string, CellValue> = { "0,0": 28, "1,0": 45, "2,0": 91, "0,1": "Fail", "1,1": "Pass", "2,1": "Pass" };
  const get = (r: number, c: number) => grid[`${r},${c}`];
  const env = (r: number, c: number) => ({ r, c, r0: 0, c0: 0, get, today: 46000 });

  test("formulas: references move with the cell, functions and comparisons", () => {
    expect(evaluate("=$B1=\"Fail\"", env(0, 0))).toBe(true);
    expect(evaluate("=$B1=\"Fail\"", env(1, 0))).toBe(false);
    expect(evaluate("=MOD(ROW(),2)=0", env(1, 0))).toBe(true);
    expect(evaluate("=AND(A1>=33,A1<=100)", env(2, 0))).toBe(true);
    expect(evaluate("=A1<33", env(0, 0))).toBe(true);
    expect(evaluate("=COUNTIF($A$1:$A$3,\">=45\")", env(0, 0))).toBe(2);
    expect(evaluate("=AVERAGE($A$1:$A$3)", env(0, 0))).toBeCloseTo(54.67, 1);
    expect(evaluate("=LEFT(B1,2)&\"x\"", env(0, 0))).toBe("Fax");
    // 46000 is 2025-12-09, a Tuesday: WEEKDAY gives 3
    expect(evaluate("=WEEKDAY(TODAY())", env(0, 0))).toBe(3);
    expect(evaluate("=Sheet2!A1>0", env(0, 0))).toBeUndefined();
  });

  test("rules: cellIs, priority, stop if true, colour scale, data bar, duplicates, top N", () => {
    const red = { color: "9C0006", fill: "FFC7CE" };
    const ranges = [{ r0: 0, c0: 0, r1: 2, c1: 0 }];
    const cells = [0, 1, 2].map((r) => ({ r, c: 0 }));
    const res = applyConditional(
      [
        { ranges, rules: [{ type: "cellIs", priority: 1, stopIfTrue: true, operator: "lessThan", formulas: ["33"], style: red }] },
        { ranges, rules: [{ type: "top10", priority: 2, stopIfTrue: false, formulas: [], rank: 1, style: { bold: true } }] },
        { ranges, rules: [{ type: "cellIs", priority: 3, stopIfTrue: false, operator: "greaterThan", formulas: ["0"], style: { italic: true } }] },
      ],
      get,
      cells,
    );
    expect(res.get("0,0")?.style).toEqual(red);
    expect(res.get("2,0")?.style).toEqual({ bold: true, italic: true });
    expect(res.get("1,0")?.style).toEqual({ italic: true });

    const scale = applyConditional(
      [{ ranges, rules: [{ type: "colorScale", priority: 1, stopIfTrue: false, formulas: [], scale: { cfvo: [{ type: "min" }, { type: "max" }], colors: ["FF0000", "00FF00"] } }] }],
      get,
      cells,
    );
    expect(scale.get("0,0")?.style.fill).toBe("FF0000");
    expect(scale.get("2,0")?.style.fill).toBe("00FF00");

    const bars = applyConditional(
      [{ ranges, rules: [{ type: "dataBar", priority: 1, stopIfTrue: false, formulas: [], bar: { cfvo: [{ type: "min" }, { type: "max" }], color: "638EC6" } }] }],
      get,
      cells,
    );
    expect(bars.get("0,0")?.bar?.frac).toBeCloseTo(0.1);
    expect(bars.get("2,0")?.bar?.frac).toBeCloseTo(0.9);

    const dup = applyConditional(
      [{ ranges: [{ r0: 0, c0: 1, r1: 2, c1: 1 }], rules: [{ type: "duplicateValues", priority: 1, stopIfTrue: false, formulas: [], style: { bold: true } }] }],
      get,
      [0, 1, 2].map((r) => ({ r, c: 1 })),
    );
    expect([...dup.keys()].sort()).toEqual(["1,1", "2,1"]);
  });

  test("functions rules use: MEDIAN, LARGE, SMALL, RANK, SUMIF, AVERAGEIF, COUNTIFS, ISODD, dates", () => {
    const g: Record<string, CellValue> = { "0,0": 5, "1,0": 1, "2,0": 9, "3,0": 4 };
    const at = { r: 0, c: 0, r0: 0, c0: 0, get: (r: number, c: number) => g[`${r},${c}`], today: 46000 };
    expect(evaluate("=A1>MEDIAN($A$1:$A$4)", at)).toBe(true);
    expect(evaluate("=MEDIAN($A$1:$A$4)", at)).toBe(4.5);
    expect(evaluate("=LARGE($A$1:$A$4,2)", at)).toBe(5);
    expect(evaluate("=SMALL($A$1:$A$4,1)", at)).toBe(1);
    expect(evaluate("=RANK(A1,$A$1:$A$4)", at)).toBe(2);
    expect(evaluate('=SUMIF($A$1:$A$4,">4")', at)).toBe(14);
    expect(evaluate('=AVERAGEIF($A$1:$A$4,"<5")', at)).toBe(2.5);
    expect(evaluate('=COUNTIFS($A$1:$A$4,">1",$A$1:$A$4,"<9")', at)).toBe(2);
    expect(evaluate("=ISODD(A1)", at)).toBe(true);
    expect(evaluate("=ISEVEN(A4)", at)).toBe(true);
    expect(evaluate("=YEAR(DATE(2026,10,28))", at)).toBe(2026);
    expect(evaluate("=MONTH(DATE(2026,10,28))", at)).toBe(10);
    expect(evaluate('=VALUE("12")+1', at)).toBe(13);
  });

  test("TRUE and FALSE in a rule match boolean cells; a blank counts as 0", () => {
    const g: Record<string, CellValue> = { "0,0": true, "1,0": false };
    const at = (r: number) => ({ r, c: 0, r0: 0, c0: 0, get: (rr: number, cc: number) => g[`${rr},${cc}`], today: 0 });
    expect(evaluate("=A1=TRUE", at(0))).toBe(true);
    expect(evaluate("=A1=TRUE", at(1))).toBe(false);
    const res = applyConditional(
      [{ ranges: [{ r0: 0, c0: 0, r1: 0, c1: 0 }], rules: [{ type: "cellIs", priority: 1, stopIfTrue: false, operator: "lessThan", formulas: ["33"], style: { bold: true } }] }],
      () => undefined,
      [{ r: 0, c: 0 }],
    );
    expect(res.get("0,0")?.style.bold).toBe(true);
  });

  test("a rule on the whole sheet only looks at the used cells", () => {
    let calls = 0;
    const t0 = Date.now();
    applyConditional(
      [{ ranges: [{ r0: 0, c0: 0, r1: 1048575, c1: 16383 }], rules: [{ type: "duplicateValues", priority: 1, stopIfTrue: false, formulas: [], style: { bold: true } }] }],
      () => (calls++, 1),
      [{ r: 0, c: 0 }],
      new Date(),
      { r1: 9, c1: 4 },
    );
    expect(calls).toBeLessThan(200);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  test("a marksheet's fail marks come out red in the PDF grid", async () => {
    const rows = [28, 67, 31].map((v, i) => `<row r="${i + 1}">${num(`A${i + 1}`, v)}</row>`).join("");
    const cf = `<conditionalFormatting sqref="A1:A3"><cfRule type="cellIs" dxfId="0" priority="1" operator="lessThan"><formula>33</formula></cfRule></conditionalFormatting>
      <conditionalFormatting sqref="A1:A3"><cfRule type="expression" dxfId="1" priority="2"><formula>MOD(ROW(),2)=1</formula></cfRule></conditionalFormatting>`;
    const { sheets } = await workbookGrids(await book(rows, cf));
    const col = sheets[0].grid.rows.map((r) => r[0].style);
    expect(col[0]).toMatchObject({ color: "9C0006", fill: "FFC7CE", bold: true });
    expect(col[1]?.fill).toBeUndefined();
    expect(col[2]).toMatchObject({ color: "9C0006", bold: true });
  });
});

describe("OpenDocument", () => {
  test("a merge before other cells in an .ods row doesn't shift them left", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/vnd.oasis.opendocument.spreadsheet");
    zip.file(
      "META-INF/manifest.xml",
      `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
    );
    zip.file(
      "content.xml",
      `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:spreadsheet><table:table table:name="S"><table:table-row><table:table-cell office:value-type="string" table:number-columns-spanned="3" table:number-rows-spanned="1"><text:p>Total</text:p></table:table-cell><table:covered-table-cell table:number-columns-repeated="2"/><table:table-cell office:value-type="float" office:value="45"><text:p>45</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`,
    );
    const { sheets } = await workbookGrids(await zip.generateAsync({ type: "arraybuffer" }));
    const row = sheets[0].grid.rows[0];
    expect(row[0]).toMatchObject({ text: "Total", colSpan: 3 });
    expect(row[3].text).toBe("45");
  });
});

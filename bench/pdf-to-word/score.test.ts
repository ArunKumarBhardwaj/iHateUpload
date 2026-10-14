import { describe, expect, test } from "bun:test";
import JSZip from "jszip";

import { scoreDocx } from "./score";
import type { Truth } from "./types";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';
const para = (text: string, ppr = "", rpr = "") => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

async function docx(body: string, extra: Record<string, string> = {}): Promise<Uint8Array> {
  const z = new JSZip();
  z.file("word/document.xml", `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  z.file(
    "word/styles.xml",
    `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
  );
  z.file("word/numbering.xml", `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`);
  for (const [k, v] of Object.entries(extra)) z.file(k, v);
  return z.generateAsync({ type: "uint8array" });
}
const base = (over: Partial<Truth>): Truth => ({ name: "t", description: "", paragraphs: [], pages: 1, ...over });

describe("text accuracy and reading order", () => {
  const paragraphs = ["alpha beta gamma delta", "epsilon zeta eta theta", "iota kappa lambda mu"];
  test("exact text scores 1 on text and order", async () => {
    const r = await scoreDocx(await docx(paragraphs.map((p) => para(p)).join("")), base({ paragraphs, order: true }));
    expect(r.features.text).toBe(1);
    expect(r.features.order).toBe(1);
  });
  test("missing words lower text accuracy by the character error rate", async () => {
    const r = await scoreDocx(await docx(para("alpha beta gamma delta") + para("epsilon zeta eta theta")), base({ paragraphs }));
    // 12 words = 55 letters + 11 spaces = 66 chars; the 4 missing words cost 17 letters + 4 spaces = 21 edits
    expect(r.features.text).toBeCloseTo(1 - 21 / 66, 2);
  });
  test("reordered paragraphs keep text at 1 but cut reading order", async () => {
    const r = await scoreDocx(await docx([paragraphs[2], paragraphs[1], paragraphs[0]].map((p) => para(p)).join("")), base({ paragraphs, order: true }));
    expect(r.features.text).toBe(1);
    expect(r.features.order).toBeLessThan(0.5);
  });
  test("text in text boxes still counts as text but not as editable", async () => {
    const box = (t: string) => `<w:p><w:r><mc:AlternateContent xmlns:mc="x"><mc:Choice><w:drawing><wps:wsp xmlns:wps="y"><wps:txbx><w:txbxContent>${para(t)}</w:txbxContent></wps:txbx></wps:wsp></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent>${para(t)}</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`;
    const r = await scoreDocx(await docx(paragraphs.map(box).join("")), base({ paragraphs }));
    expect(r.features.text).toBe(1);
    expect(r.features.editability).toBe(0);
  });
});

describe("paragraph breaks", () => {
  const paragraphs = ["Plain intro line here.", "We have another line here.", "Colours end now."];
  test("one docx paragraph per truth paragraph scores 1", async () => {
    const r = await scoreDocx(await docx(paragraphs.map((p) => para(p)).join("")), base({ paragraphs, segmentation: true }));
    expect(r.features.paragraphs).toBe(1);
  });
  test("lines merged into one paragraph cost the segmentation score", async () => {
    const body = para(paragraphs[0] + " " + paragraphs[1]) + para(paragraphs[2]);
    const r = await scoreDocx(await docx(body), base({ paragraphs, segmentation: true }));
    expect(r.features.text).toBe(1);
    expect(r.features.paragraphs).toBeCloseTo(1 / 3, 5);
  });
  test("a paragraph split in two also costs", async () => {
    const body = para("Plain intro") + para("line here.") + para(paragraphs[1]) + para(paragraphs[2]);
    const r = await scoreDocx(await docx(body), base({ paragraphs, segmentation: true }));
    expect(r.features.paragraphs).toBeCloseTo(2 / 4, 5);
  });
  test("is not scored unless the truth asks for it", async () => {
    const r = await scoreDocx(await docx(para(paragraphs.join(" "))), base({ paragraphs }));
    expect(r.features.paragraphs).toBeUndefined();
  });
});

describe("structure", () => {
  test("headings match by text and level; wrong level is half credit", async () => {
    const body = para("Title Here", '<w:pStyle w:val="Heading1"/>') + para("Sub Head", '<w:pStyle w:val="Heading1"/>') + para("body");
    const r = await scoreDocx(await docx(body), base({ paragraphs: [], headings: [{ text: "Title Here", level: 1 }, { text: "Sub Head", level: 2 }] }));
    expect(r.features.headings).toBeCloseTo(0.75, 5);
  });
  test("a heading that is only large bold text scores 0", async () => {
    const r = await scoreDocx(await docx(para("Title Here", "", "<w:b/><w:sz w:val=\"48\"/>")), base({ headings: [{ text: "Title Here", level: 1 }] }));
    expect(r.features.headings).toBe(0);
  });
  test("real lists score 1, typed bullets score a quarter, wrong list type half", async () => {
    const items = ["one thing", "two things"];
    const real = await scoreDocx(await docx(items.map((t) => para(t, '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')).join("")), base({ lists: [{ type: "bullet", items }] }));
    expect(real.features.lists).toBe(1);
    const typed = await scoreDocx(await docx(items.map((t) => para("• " + t)).join("")), base({ lists: [{ type: "bullet", items }] }));
    expect(typed.features.lists).toBe(0.25);
    const wrong = await scoreDocx(await docx(items.map((t) => para(t, '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>')).join("")), base({ lists: [{ type: "bullet", items }] }));
    expect(wrong.features.lists).toBe(0.5);
    const plain = await scoreDocx(await docx(items.map((t) => para(t)).join("")), base({ lists: [{ type: "bullet", items }] }));
    expect(plain.features.lists).toBe(0.25);
    const merged = await scoreDocx(await docx(para(items.join(" "))), base({ lists: [{ type: "bullet", items }] }));
    expect(merged.features.lists).toBe(0);
  });
  test("columns need a section with the right w:cols count", async () => {
    const two = await scoreDocx(await docx(para("x") + '<w:sectPr><w:cols w:num="2"/></w:sectPr>'), base({ columns: 2 }));
    expect(two.features.columns).toBe(1);
    const one = await scoreDocx(await docx(para("x") + "<w:sectPr/>"), base({ columns: 2 }));
    expect(one.features.columns).toBe(0);
  });
});

describe("tables", () => {
  const truth = base({
    tables: [{ rows: [[{ text: "Title", cs: 2, shaded: true }], [{ text: "A", rs: 2 }, { text: "B" }], [{ text: "C" }]] }],
  });
  const cell = (t: string, pr = "") => `<w:tc><w:tcPr>${pr}</w:tcPr>${para(t)}</w:tc>`;
  test("grid, merges and shading all exact", async () => {
    const tbl = `<w:tbl><w:tr>${cell("Title", '<w:gridSpan w:val="2"/><w:shd w:fill="D9E2F3"/>')}</w:tr><w:tr>${cell("A", '<w:vMerge w:val="restart"/>')}${cell("B")}</w:tr><w:tr>${cell("", "<w:vMerge/>")}${cell("C")}</w:tr></w:tbl>`;
    const r = await scoreDocx(await docx(tbl), truth);
    expect(r.detail["tables.grid"]).toBe(1);
    expect(r.detail["tables.merges"]).toBe(1);
    expect(r.detail["tables.shading"]).toBe(1);
    expect(r.features.tables).toBe(1);
  });
  test("same text as loose paragraphs scores 0", async () => {
    const r = await scoreDocx(await docx(["Title", "A", "B", "C"].map((t) => para(t)).join("")), truth);
    expect(r.features.tables).toBe(0);
  });
  test("a table split at page breaks is matched but penalised for the extra tables", async () => {
    const two = base({ tables: [{ rows: [[{ text: "A" }, { text: "B" }], [{ text: "C" }, { text: "D" }]] }] });
    const part = (a: string, b: string) => `<w:tbl><w:tr>${cell(a)}${cell(b)}</w:tr></w:tbl>` + para("");
    const r = await scoreDocx(await docx(part("A", "B") + part("C", "D")), two);
    expect(r.detail["tables.grid"]).toBeCloseTo(0.5, 5);
  });
  test("a table with no merges or shading keeps the grid but loses those parts", async () => {
    const tbl = `<w:tbl><w:tr>${cell("Title")}${cell("")}</w:tr><w:tr>${cell("A")}${cell("B")}</w:tr><w:tr>${cell("")}${cell("C")}</w:tr></w:tbl>`;
    const r = await scoreDocx(await docx(tbl), truth);
    expect(r.detail["tables.merges"]).toBe(0);
    expect(r.detail["tables.shading"]).toBe(0);
    expect(r.detail["tables.grid"]).toBeGreaterThan(0.5);
  });
});

describe("run formatting, links, fonts", () => {
  test("bold, colour and size are read from runs and style defaults", async () => {
    const body = `<w:p><w:r><w:t>plain </w:t></w:r><w:r><w:rPr><w:b/><w:color w:val="C00000"/><w:sz w:val="36"/></w:rPr><w:t>loud words</w:t></w:r></w:p>`;
    const runs = [[{ text: "plain ", size: 11, color: "000000" }, { text: "loud words", b: true, color: "c00000", size: 18 }]];
    const r = await scoreDocx(await docx(body), base({ runs }));
    expect(r.features.runs).toBe(1);
    const flat = await scoreDocx(await docx(para("plain loud words")), base({ runs }));
    expect(flat.features.runs).toBeLessThan(0.5);
  });
  test("superscript and highlight are detected", async () => {
    const body = `<w:p><w:r><w:t>E=mc</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2</w:t></w:r><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t> marked</w:t></w:r></w:p>`;
    const runs = [[{ text: "E=mc", size: 11 }, { text: "2", sup: true }, { text: " marked", hl: true, size: 11 }]];
    expect((await scoreDocx(await docx(body), base({ runs }))).features.runs).toBe(1);
  });
  test("links need the url; matching text gives full credit", async () => {
    const rels = `<Relationships><Relationship Id="rId9" Type="x" Target="https://example.com/a" TargetMode="External"/></Relationships>`;
    const body = `<w:p><w:hyperlink r:id="rId9"><w:r><w:t>click here</w:t></w:r></w:hyperlink></w:p>`;
    const truth = base({ links: [{ url: "https://example.com/a", text: "click here" }] });
    expect((await scoreDocx(await docx(body, { "word/_rels/document.xml.rels": rels }), truth)).features.links).toBe(1);
    expect((await scoreDocx(await docx(para("click here")), truth)).features.links).toBe(0);
  });
  test("fonts: names and embedded files each give half", async () => {
    const run = (f: string) => `<w:p><w:r><w:rPr><w:rFonts w:ascii="${f}"/></w:rPr><w:t>x</w:t></w:r></w:p>`;
    const truth = base({ fonts: ["Georgia"] });
    expect((await scoreDocx(await docx(run("Georgia")), truth)).features.fonts).toBe(0.5);
    expect((await scoreDocx(await docx(run("Georgia"), { "word/fonts/font1.odttf": "x" }), truth)).features.fonts).toBe(1);
    expect((await scoreDocx(await docx(run("Arial")), truth)).features.fonts).toBe(0);
  });
});

describe("images, header/footer, footnotes, forms", () => {
  const pic = `<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><a:blip r:embed="rId5"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  test("images: count and caption order", async () => {
    const truth = base({ images: { count: 2, labels: ["1", "2"] } });
    const good = await scoreDocx(await docx(pic + para("Figure 1 a") + pic + para("Figure 2 b")), truth);
    expect(good.features.images).toBe(1);
    const swapped = await scoreDocx(await docx(pic + para("Figure 2 b") + pic + para("Figure 1 a")), truth);
    expect(swapped.features.images).toBe(0.5 + 0.5 * 0.5);
    const missing = await scoreDocx(await docx(para("Figure 1 a") + para("Figure 2 b")), truth);
    expect(missing.features.images).toBe(0);
  });
  test("header, footer and a PAGE field", async () => {
    const hdr = `<w:hdr ${W}>${para("Quarterly Report")}</w:hdr>`;
    const ftr = `<w:ftr ${W}><w:p><w:r><w:t>Confidential </w:t></w:r><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;
    const truth = base({ header: "Quarterly Report", footer: "Confidential", pageNumbers: true });
    expect((await scoreDocx(await docx(para("body"), { "word/header1.xml": hdr, "word/footer1.xml": ftr }), truth)).features.headerFooter).toBe(1);
    expect((await scoreDocx(await docx(para("Quarterly Report") + para("Confidential 1")), truth)).features.headerFooter).toBe(0);
  });
  test("a tab between footer text and the page number does not glue the words together", async () => {
    const ftr = `<w:ftr ${W}><w:p><w:r><w:t>Confidential</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Page</w:t></w:r></w:p></w:ftr>`;
    const r = await scoreDocx(await docx(para("body"), { "word/footer1.xml": ftr }), base({ footer: "Confidential" }));
    expect(r.features.headerFooter).toBe(1);
  });
  test("real footnotes score 1; plain text at the bottom scores 0", async () => {
    const fn = `<w:footnotes ${W}><w:footnote w:id="0" w:type="separator"/><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Source is the survey.</w:t></w:r></w:p></w:footnote></w:footnotes>`;
    const body = `<w:p><w:r><w:t>claim</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`;
    const truth = base({ paragraphs: ["claim1", "1 Source is the survey."], footnotes: ["Source is the survey."] });
    const r = await scoreDocx(await docx(body, { "word/footnotes.xml": fn }), truth);
    expect(r.features.footnotes).toBe(1);
    expect(r.features.text).toBe(1);
    expect((await scoreDocx(await docx(para("claim1") + para("1 Source is the survey.")), truth)).features.footnotes).toBe(0);
  });
  test("form fields: content controls count by type", async () => {
    const sdt = `<w:sdt><w:sdtPr><w:text/></w:sdtPr><w:sdtContent><w:r><w:t>x</w:t></w:r></w:sdtContent></w:sdt>`;
    const chk = `<w:sdt><w:sdtPr><w14:checkbox/></w:sdtPr><w:sdtContent><w:r><w:t>x</w:t></w:r></w:sdtContent></w:sdt>`;
    const truth = base({ formFields: [{ type: "text", name: "a" }, { type: "checkbox", name: "b" }] });
    expect((await scoreDocx(await docx(`<w:p>${sdt}${chk}</w:p>`), truth)).features.forms).toBe(1);
    expect((await scoreDocx(await docx(`<w:p>${sdt}</w:p>`), truth)).features.forms).toBe(0.5);
    expect((await scoreDocx(await docx(para("Name: ____")), truth)).features.forms).toBe(0);
  });
});

test("the score is deterministic", async () => {
  const bytes = await docx(para("alpha beta") + para("gamma"));
  const t = base({ paragraphs: ["alpha beta", "gamma"], order: true });
  expect(await scoreDocx(bytes, t)).toEqual(await scoreDocx(bytes, t));
});

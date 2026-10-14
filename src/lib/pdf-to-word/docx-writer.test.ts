import { expect, test } from "bun:test";
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";

import { makePng } from "./fixture";
import { writeDocx } from "./docx-writer";
import type { DocModel } from "./model";

const margins = { top: 72, right: 72, bottom: 72, left: 72 };

function model(): DocModel {
  return {
    header: [{ type: "p", runs: [{ text: "Acme" }] }],
    footer: [{ type: "p", runs: [{ text: "Page " }, { text: "", field: "PAGE" }] }],
    notes: [],
    sections: [
      {
        width: 612,
        height: 792,
        margins,
        blocks: [
          { type: "p", style: "Heading1", runs: [{ text: "Title & <more>", bold: true, size: 24, font: "Arial" }] },
          {
            type: "p",
            runs: [
              { text: "Plain " },
              { text: "bold", bold: true },
              { text: "", tab: true },
              { text: "italic", italic: true, color: "ff0000" },
            ],
            spaceBefore: 6,
            lineRatio: 1.2,
            align: "center",
          },
          {
            type: "p",
            runs: [{ text: "One" }],
            list: { instance: 1, kind: "bullet", suffix: "", start: 1, leftIndent: 36, hanging: 18 },
          },
          {
            type: "p",
            runs: [{ text: "Two" }],
            list: { instance: 2, kind: "decimal", suffix: ".", start: 3, leftIndent: 36, hanging: 18 },
          },
          {
            type: "table",
            colWidths: [100, 100],
            borders: true,
            indentLeft: 0,
            rows: [
              [
                { paragraphs: [{ type: "p", runs: [{ text: "a" }] }], colSpan: 1 },
                { paragraphs: [{ type: "p", runs: [{ text: "b" }] }], colSpan: 1, vMerge: "restart" },
              ],
              [
                { paragraphs: [{ type: "p", runs: [{ text: "c" }] }], colSpan: 1 },
                { paragraphs: [{ type: "p", runs: [] }], colSpan: 1, vMerge: "continue" },
              ],
            ],
          },
          { type: "image", ref: "i1", width: 120, height: 80 },
        ],
      },
      {
        width: 400,
        height: 500,
        margins,
        blocks: [{ type: "p", runs: [{ text: "Second page" }] }],
      },
    ],
  };
}

async function open() {
  const png = makePng(4, 4, [255, 0, 0]);
  const bytes = await writeDocx(model(), { i1: { data: png, mime: "image/png" } }, "Report");
  const zip = await JSZip.loadAsync(bytes);
  const read = (name: string) => zip.file(name)!.async("string");
  return { zip, read };
}

test("package has the required parts and relationships", async () => {
  const { zip, read } = await open();
  for (const name of [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
    "word/styles.xml",
    "word/numbering.xml",
    "word/_rels/document.xml.rels",
    "word/header1.xml",
    "word/footer1.xml",
    "word/media/image1.png",
  ]) {
    expect(zip.file(name)).not.toBeNull();
  }
  const types = await read("[Content_Types].xml");
  expect(types).toContain("/word/document.xml");
  expect(types).toContain('Extension="png"');
  expect(types).toContain("/word/numbering.xml");
  const rels = await read("word/_rels/document.xml.rels");
  expect(rels).toContain("media/image1.png");
  expect(rels).toContain("numbering.xml");
  expect(rels).toContain("header1.xml");
});

test("every part is well-formed XML", async () => {
  const { zip } = await open();
  const parser = new DOMParser({
    onError: (level, message) => {
      throw new Error(`${level}: ${message}`);
    },
  });
  for (const name of Object.keys(zip.files).filter((n) => /\.(xml|rels)$/.test(n))) {
    const doc = parser.parseFromString(await zip.file(name)!.async("string"), "application/xml");
    expect(doc.documentElement).not.toBeNull();
  }
});

test("document.xml carries styles, text, escaping, tables, images and sections", async () => {
  const { read } = await open();
  const xml = await read("word/document.xml");
  expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
  expect(xml).toContain("Title &amp; &lt;more&gt;");
  expect(xml).toContain("<w:b/>");
  expect(xml).toContain("<w:i/>");
  expect(xml).toContain('<w:color w:val="FF0000"/>');
  expect(xml).toContain('<w:jc w:val="center"/>');
  expect(xml).toContain("<w:tab/>");
  expect(xml).toContain("<w:tbl>");
  expect(xml).toContain('<w:vMerge w:val="restart"/>');
  expect(xml).toContain("<w:vMerge/>");
  expect(xml).toContain("<wp:inline");
  expect(xml).toContain('cx="1524000"');
  expect(xml.match(/<w:sectPr/g)?.length).toBe(2);
  expect(xml).toContain('<w:pgSz w:w="8000" w:h="10000"/>');
  expect(xml).toContain("<w:headerReference");
  expect(xml.indexOf("Title")).toBeLessThan(xml.indexOf("<w:tbl>"));
  expect(xml.indexOf("<w:tbl>")).toBeLessThan(xml.indexOf("<wp:inline"));
});

test("lists point at numbering definitions with a start value", async () => {
  const { read } = await open();
  const doc = await read("word/document.xml");
  const numbering = await read("word/numbering.xml");
  expect(doc).toContain("<w:numPr>");
  expect(numbering).toContain('w:numFmt w:val="bullet"');
  expect(numbering).toContain('w:numFmt w:val="decimal"');
  expect(numbering).toContain('<w:start w:val="3"/>');
  expect(numbering).toContain('w:lvlText w:val="%1."');
});

test("footer holds a live page field", async () => {
  const { read } = await open();
  const footer = await read("word/footer1.xml");
  expect(footer).toContain("PAGE");
  expect(footer).toContain("Page ");
});

test("styles define the three headings", async () => {
  const { read } = await open();
  const styles = await read("word/styles.xml");
  for (const id of ["Heading1", "Heading2", "Heading3", "Normal"]) {
    expect(styles).toContain(`w:styleId="${id}"`);
  }
});

test("mammoth can read the result back", async () => {
  const bytes = await writeDocx(model(), { i1: { data: makePng(4, 4, [255, 0, 0]), mime: "image/png" } }, "Report");
  const mammoth = await import("mammoth");
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  expect(result.value).toContain("<h1>");
  expect(result.value).toContain("<table>");
  expect(result.value).toContain("<img");
  expect(result.value).toContain("<li>");
});

test("a continuous section with columns writes w:cols and a column break", async () => {
  const margins = { top: 50, right: 50, bottom: 50, left: 50 };
  const p = (t: string, extra: object = {}) => ({ type: "p" as const, runs: [{ text: t }], ...extra });
  const bytes = await writeDocx(
    {
      header: [],
      footer: [],
      notes: [],
      sections: [
        { width: 600, height: 800, margins, blocks: [p("Title")] },
        {
          width: 600,
          height: 800,
          margins,
          start: "continuous",
          columns: { widths: [240, 240], gap: 20 },
          blocks: [p("Left"), p("Right", { columnBreakBefore: true })],
        },
      ],
    },
    {},
    "T",
  );
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  const cols = xml.match(/<w:cols [^>]*>/g) ?? [];
  expect(cols).toEqual(['<w:cols w:num="2" w:space="400" w:equalWidth="1"/>']);
  expect(xml).toContain('<w:type w:val="continuous"/>');
  expect(xml.indexOf('<w:br w:type="column"/>')).toBeGreaterThan(xml.indexOf("Left"));
  expect(xml.indexOf('<w:br w:type="column"/>')).toBeLessThan(xml.indexOf("Right"));
});

test("columns of different widths list each width", async () => {
  const margins = { top: 50, right: 50, bottom: 50, left: 50 };
  const bytes = await writeDocx(
    {
      header: [],
      footer: [],
      notes: [],
      sections: [
        {
          width: 600,
          height: 800,
          margins,
          columns: { widths: [320, 140], gap: 20 },
          blocks: [{ type: "p", runs: [{ text: "x" }] }],
        },
      ],
    },
    {},
    "T",
  );
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  expect(xml).toContain('<w:cols w:num="2" w:space="400" w:equalWidth="0"><w:col w:w="6678" w:space="400"/><w:col w:w="2922"/></w:cols>');
});

test("linked runs become hyperlinks with relationships, and bookmarks mark the targets", async () => {
  const margins = { top: 50, right: 50, bottom: 50, left: 50 };
  const bytes = await writeDocx(
    {
      header: [],
      footer: [],
      notes: [],
      sections: [
        {
          width: 600,
          height: 800,
          margins,
          blocks: [
            {
              type: "p",
              runs: [
                { text: "See " },
                { text: "the docs", link: { url: "https://example.com/a?x=1&y=2" } },
                { text: " or " },
                { text: "section two", link: { anchor: "sec2" } },
              ],
            },
            { type: "p", bookmarks: ["sec2"], runs: [{ text: "Section Two" }] },
          ],
        },
      ],
    },
    {},
    "T",
  );
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
  const rid = /<w:hyperlink r:id="(rId\d+)" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr><w:t xml:space="preserve">the docs<\/w:t>/.exec(xml)?.[1];
  expect(rid).toBeDefined();
  expect(rels).toContain(`Id="${rid}"`);
  expect(rels).toContain('Target="https://example.com/a?x=1&amp;y=2" TargetMode="External"');
  expect(xml).toContain('<w:hyperlink w:anchor="sec2" w:history="1">');
  expect(xml).toMatch(/<w:bookmarkStart w:id="\d+" w:name="sec2"\/><w:r>.*Section Two.*<\/w:r><w:bookmarkEnd w:id="\d+"\/>/);
  expect(await zip.file("word/styles.xml")!.async("string")).toContain('w:styleId="Hyperlink"');
});

test("document properties land in docProps/core.xml", async () => {
  const margins = { top: 50, right: 50, bottom: 50, left: 50 };
  const bytes = await writeDocx(
    {
      header: [],
      footer: [],
      notes: [],
      properties: { title: "Real & Title", author: "Ada", subject: "S", keywords: "a b", created: "2024-03-05T10:20:30Z" },
      sections: [{ width: 600, height: 800, margins, blocks: [{ type: "p", runs: [{ text: "x" }] }] }],
    },
    {},
    "file-name",
  );
  const core = await (await JSZip.loadAsync(bytes)).file("docProps/core.xml")!.async("string");
  expect(core).toContain("<dc:title>Real &amp; Title</dc:title>");
  expect(core).toContain("<dc:creator>Ada</dc:creator>");
  expect(core).toContain("<dc:subject>S</dc:subject>");
  expect(core).toContain("<cp:keywords>a b</cp:keywords>");
  expect(core).toContain('<dcterms:created xsi:type="dcterms:W3CDTF">2024-03-05T10:20:30Z</dcterms:created>');
});

test("header rows of a table are marked to repeat", async () => {
  const margins = { top: 50, right: 50, bottom: 50, left: 50 };
  const cell = (t: string) => ({ paragraphs: [{ type: "p" as const, runs: [{ text: t }] }], colSpan: 1 });
  const bytes = await writeDocx(
    {
      header: [],
      footer: [],
      notes: [],
      sections: [
        {
          width: 600,
          height: 800,
          margins,
          blocks: [{ type: "table", colWidths: [100], borders: true, indentLeft: 0, headerRows: 1, rows: [[cell("H")], [cell("a")]] }],
        },
      ],
    },
    {},
    "T",
  );
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  expect(xml.match(/<w:tblHeader\/>/g)).toHaveLength(1);
  expect(xml.indexOf("<w:tblHeader/>")).toBeLessThan(xml.indexOf(">H<"));
});

test("shaded cells carry a fill", async () => {
  const margins = { top: 50, right: 50, bottom: 50, left: 50 };
  const cell = (t: string, shade?: string) => ({ paragraphs: [{ type: "p" as const, runs: [{ text: t }] }], colSpan: 1, shade });
  const bytes = await writeDocx(
    {
      header: [],
      footer: [],
      notes: [],
      sections: [
        { width: 600, height: 800, margins, blocks: [{ type: "table", colWidths: [100, 100], borders: true, indentLeft: 0, rows: [[cell("H", "D9E2F3"), cell("a")]] }] },
      ],
    },
    {},
    "T",
  );
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  expect(xml.match(/<w:shd /g)).toHaveLength(1);
  expect(xml).toContain('<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>');
});

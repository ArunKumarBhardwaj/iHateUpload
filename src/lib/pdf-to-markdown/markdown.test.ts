import { expect, test } from "bun:test";
import JSZip from "jszip";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import type { ConvertDeps } from "@/lib/pdf-to-word";
import { makeFormattedPdf, makeLinkedPdf, makePng, makeSamplePdf } from "@/lib/pdf-to-word/fixture";
import type { DocModel, ParagraphBlock } from "@/lib/pdf-to-word/model";

import { convertPdfToMarkdown } from "./convert";
import { escapeText, writeMarkdown } from "./markdown-writer";

const FONTS = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`;
const deps: ConvertDeps = {
  OPS: OPS as unknown as Record<string, number>,
  rasterizeImage: async () => ({ data: makePng(6, 4, [10, 120, 200]), mime: "image/png" }),
};

async function convert(data: Uint8Array, output: "md" | "zip" = "md") {
  const pdf = await getDocument({ data, fontExtraProperties: true, standardFontDataUrl: FONTS }).promise;
  const result = await convertPdfToMarkdown(pdf as never, "Sample", { output }, deps, () => {});
  await pdf.loadingTask.destroy();
  return result;
}

test("headings, paragraphs, lists, a table and a picture become Markdown", async () => {
  const { markdown, zipBytes } = await convert(await makeSamplePdf(), "zip");
  expect(markdown).toMatch(/^# Quarterly Report$/m);
  expect(markdown).toMatch(/^# Appendix$/m);
  expect(markdown).toMatch(/^The quick brown fox/m);
  expect(markdown).toMatch(/^- First bullet item\n- Second bullet item$/m);
  expect(markdown).toMatch(/^1\. Open the file\n2\. Press convert$/m);
  expect(markdown).toMatch(/^\| Item \|.*\|$/m);
  expect(markdown).toMatch(/^\| -+ \|/m);
  expect(markdown).toMatch(/^\| Pears \|/m);
  expect(markdown).toMatch(/!\[\]\(images\/image-1\.png\)/);
  const zip = await JSZip.loadAsync(zipBytes!);
  expect(Object.keys(zip.files).sort()).toEqual(["images/", "images/image-1.png", "index.md"].sort());
});

test("a single .md leaves pictures out and says so", async () => {
  const { markdown, notes } = await convert(await makeSamplePdf(), "md");
  expect(markdown).not.toContain("![");
  expect(notes.join(" ")).toMatch(/picture/i);
});

test("web links stay links; bold headings are not double-marked", async () => {
  const { markdown } = await convert(await makeLinkedPdf());
  expect(markdown).toMatch(/\[[^\]]*manual[^\]]*\]\(https:\/\/example\.com\/manual\)/);
  expect(markdown).toMatch(/^#+ Details$/m);
});

test("struck text uses tildes", async () => {
  const { markdown } = await convert(await makeFormattedPdf());
  expect(markdown).toMatch(/~~struck~~/);
});

test("text that looks like Markdown is escaped", () => {
  expect(escapeText("a*b_c [x] <y> `z` \\")).toBe("a\\*b\\_c \\[x\\] \\<y\\> \\`z\\` \\\\");
  const p = (text: string): ParagraphBlock => ({ type: "p", runs: [{ text }] });
  const model: DocModel = {
    sections: [{ blocks: [p("# not a heading"), p("1. not a list"), p("- nor this"), p("plain")] }],
  } as unknown as DocModel;
  const md = writeMarkdown(model, { img: () => null });
  expect(md).toContain("\\# not a heading");
  expect(md).toContain("1\\. not a list");
  expect(md).toContain("\\- nor this");
});

test("bold and italic runs merge and keep spaces outside the markers", () => {
  const model = {
    sections: [{ blocks: [{ type: "p", runs: [{ text: "Make " }, { text: "this ", bold: true }, { text: "bold", bold: true }, { text: " and ", }, { text: "that", italic: true }] }] }],
  } as unknown as DocModel;
  expect(writeMarkdown(model, { img: () => null }).trim()).toBe("Make **this bold** and *that*");
});

test("table cells escape pipes and join lines", () => {
  const cell = (text: string) => ({ paragraphs: [{ type: "p", runs: [{ text }] }], colSpan: 1 });
  const model = {
    sections: [{ blocks: [{ type: "table", colWidths: [50, 50], borders: true, indentLeft: 0, rows: [[cell("A|B"), cell("C")], [{ paragraphs: [{ type: "p", runs: [{ text: "x" }] }, { type: "p", runs: [{ text: "y" }] }], colSpan: 2 }]] }] }],
  } as unknown as DocModel;
  const md = writeMarkdown(model, { img: () => null });
  expect(md).toContain("| A\\|B | C |");
  expect(md).toContain("| x<br>y |  |");
});

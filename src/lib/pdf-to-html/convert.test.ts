import { expect, test } from "bun:test";
import JSZip from "jszip";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";

import { makeFormattedPdf, makeLinkedPdf, makePng, makeSamplePdf, makeShapesPdf } from "@/lib/pdf-to-word/fixture";
import type { ConvertDeps } from "@/lib/pdf-to-word";

import { convertPdfToHtml, type HtmlConvertOptions } from "./convert";
import { writeReflowHtml } from "./html-writer";
import type { DocModel } from "@/lib/pdf-to-word/model";

const FONTS = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`;
const deps: ConvertDeps = {
  OPS: OPS as unknown as Record<string, number>,
  rasterizeImage: async () => ({ data: makePng(6, 4, [10, 120, 200]), mime: "image/png" }),
  renderJpeg: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
};

async function convert(data: Uint8Array, options: Partial<HtmlConvertOptions> = {}) {
  const pdf = await getDocument({ data, fontExtraProperties: true, standardFontDataUrl: FONTS }).promise;
  const progress: number[] = [];
  const result = await convertPdfToHtml(pdf as never, "Sample", { mode: "reflow", output: "html", ...options }, deps, (r) => progress.push(r));
  await pdf.loadingTask.destroy();
  return { result, html: result.html, progress };
}

/** Strip tags, decode the few entities we write, collapse spaces. */
function textOf(html: string): string {
  return html
    .replace(/<(script|style)[^]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

test("reflow: headings, paragraphs, lists, table and picture map to semantic tags", async () => {
  const { html, progress } = await convert(await makeSamplePdf());
  expect(html.startsWith("<!doctype html>")).toBe(true);
  expect(html).toMatch(/<html lang="en" dir="ltr">/);
  expect(html).toContain('<meta charset="utf-8">');
  expect(html).toContain('<meta name="viewport"');
  expect(html).toMatch(/<h1[^>]*>Quarterly Report<\/h1>/);
  expect(html).toMatch(/<h1[^>]*>Appendix<\/h1>/);
  expect(html).toMatch(/<p[^>]*>The quick brown fox/);
  expect(html).toMatch(/<ul>\s*<li>First bullet item<\/li>\s*<li>Second bullet item<\/li>\s*<\/ul>/);
  expect(html).toMatch(/<ol>\s*<li>Open the file<\/li>\s*<li>Press convert<\/li>\s*<\/ol>/);
  expect(html).toContain("<table");
  expect(html).toMatch(/<th[^>]*>Item<\/th>/);
  expect(html).toMatch(/<td[^>]*>Pears<\/td>/);
  expect(html).toMatch(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
  expect(progress.at(-1)).toBe(1);
});

test("reflow: text comes out in reading order", async () => {
  const { html } = await convert(await makeSamplePdf());
  const text = textOf(html);
  const order = ["Quarterly Report", "The quick brown fox", "First bullet item", "Open the file", "Pears", "Closing line", "Appendix", "Text that lives on the second page"];
  const at = order.map((s) => text.indexOf(s));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
});

test("title comes from the first heading when the PDF has no title; metadata title wins when set", async () => {
  const sample = await convert(await makeSamplePdf());
  expect(sample.html).toContain("<title>Quarterly Report</title>");
  const linked = await convert(await makeLinkedPdf());
  expect(linked.html).toMatch(/<title>[^<]+<\/title>/);
  expect(linked.html).toMatch(/<meta name="author" content="[^"]+">/);
});

test("inline formatting: colour, underline, strike, highlight, sub- and superscript", async () => {
  const { html } = await convert(await makeFormattedPdf());
  expect(html).toMatch(/<u>[^<]*underlined[^<]*<\/u>/);
  expect(html).toMatch(/<s>[^<]*struck[^<]*<\/s>/);
  expect(html).toMatch(/<mark[^>]*>[^<]*highlighted/);
  expect(html).toMatch(/<sub>2<\/sub>/);
  expect(html).toContain("<sup>");
  expect(html).toMatch(/style="color:#ff0000"/i);
});

test("links: web links are real anchors with safe rel, internal links point at an id that exists", async () => {
  const { html } = await convert(await makeLinkedPdf());
  expect(html).toMatch(/<a href="https?:\/\/[^"]+" rel="noopener noreferrer">/);
  const internal = [...html.matchAll(/<a href="#([^"]+)"/g)].map((m) => m[1]);
  expect(internal.length).toBeGreaterThan(0);
  for (const id of internal) expect(html).toContain(`id="${id}"`);
});

test("everything from the PDF is escaped: no HTML injection through text", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('<script>alert(1)</script> & <img src=x onerror=alert(2)> "q"', { x: 72, y: 700, size: 12, font });
  const { html } = await convert(await doc.save());
  expect(html).not.toMatch(/<script>alert/);
  expect(html).not.toMatch(/<img src=x/);
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;img src=x onerror=alert(2)&gt;");
  expect(textOf(html)).toContain('<script>alert(1)</script> & <img src=x onerror=alert(2)> "q"');
});

test("writer escapes titles, link targets and unsafe schemes", () => {
  const model: DocModel = {
    properties: { title: '</title><script>x</script>', author: '"><b>' },
    sections: [
      {
        width: 612,
        height: 792,
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        blocks: [
          { type: "p", runs: [{ text: "go", link: { url: 'javascript:alert(1)' } }, { text: "ok", link: { url: 'https://a.test/?q="x"&y=<1>' } }, { text: "d", font: 'Arial"; background:url(x)', color: "red;x" }] },
        ],
      },
    ],
    header: [],
    footer: [],
    notes: [],
  };
  const html = writeReflowHtml(model, {}, { name: "x", img: () => null });
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("javascript:");
  expect(html).toContain("&lt;/title&gt;");
  expect(html).toContain('href="https://a.test/?q=&quot;x&quot;&amp;y=&lt;1&gt;"');
  expect(html).not.toContain("background:url");
  expect(html).not.toContain("red;x");
});

test("exact layout: one positioned page per PDF page with size kept and text placed", async () => {
  const { html } = await convert(await makeSamplePdf(), { mode: "exact" });
  const pages = html.match(/<section class="pg"[^>]*>/g) ?? [];
  expect(pages.length).toBe(2);
  expect(pages[0]).toContain('data-w="612"');
  expect(pages[0]).toContain("width:612pt;height:792pt");
  // The heading sits at the PDF's left margin (72 pt) and at 24 pt.
  expect(html).toMatch(/left:72pt;top:72\.\d+pt[^"]*"[^>]*>(<span[^>]*font-size:24pt[^>]*>)?Quarterly Report/);
  expect(html).toMatch(/font-size:24pt/);
  expect(html).toMatch(/font-weight:700/);
  expect(html).toContain("position:absolute");
  expect(textOf(html)).toContain("Text that lives on the second page");
  expect(html).toMatch(/<img [^>]*src="data:image\/png;base64,/);
  expect(html).toContain("<table");
  // Numbered items keep their own numbers.
  expect(textOf(html)).toMatch(/1\. Open the file/);
  expect(textOf(html)).toMatch(/2\. Press convert/);
});

test("exact layout keeps drawn shapes as SVG", async () => {
  const { html } = await convert(await makeShapesPdf(), { mode: "exact" });
  expect(html).toContain("<svg");
  expect(html).toMatch(/<(rect|ellipse|line|path)\b/);
  expect(textOf(html)).toContain("Diagram Page");
});

test("picture mode: a page image with an invisible, selectable text layer", async () => {
  const { html } = await convert(await makeSamplePdf(), { mode: "picture" });
  expect((html.match(/<section class="pg"/g) ?? []).length).toBe(2);
  expect(html).toMatch(/<img class="bg" src="data:image\/jpeg;base64,/);
  expect(html).toContain("color:transparent");
  expect(textOf(html)).toContain("The quick brown fox");
  expect(textOf(html)).toContain("Pears");
  // The page picture is the only picture: pictures inside the page are part of that image.
  expect((html.match(/<img /g) ?? []).length).toBe(2);
});

test("zip output: index.html refers to files in images/, nothing is inlined", async () => {
  const { result } = await convert(await makeSamplePdf(), { output: "zip" });
  expect(result.files).toBeDefined();
  const zip = await JSZip.loadAsync(result.zipBytes!);
  const index = await zip.file("index.html")!.async("string");
  const names = Object.keys(zip.files).filter((n) => n.startsWith("images/") && !n.endsWith("/"));
  expect(names.length).toBeGreaterThan(0);
  expect(index).not.toContain("data:image");
  for (const n of names) expect(index).toContain(`src="${n}"`);
  expect(result.html).toContain("data:image/png;base64,");
});

test("CJK text stays intact with a language and no radicals", async () => {
  const model: DocModel = {
    sections: [
      {
        width: 612,
        height: 792,
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        blocks: [
          { type: "p", style: "Heading1", runs: [{ text: "地区图书馆通知" }] },
          { type: "p", runs: [{ text: "欢迎来到市中心图书馆。", lang: "zh-CN" }] },
        ],
      },
    ],
    header: [],
    footer: [],
    notes: [],
  };
  const html = writeReflowHtml(model, {}, { name: "x", img: () => null });
  expect(html).toContain('lang="zh');
  expect(html).toContain("<h1>地区图书馆通知</h1>");
  expect(html).toContain("欢迎来到市中心图书馆。");
});

test("right-to-left text sets dir on the paragraph and the page", () => {
  const model: DocModel = {
    sections: [
      {
        width: 612,
        height: 792,
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        blocks: [
          { type: "p", runs: [{ text: "مرحبا بالعالم هذا نص عربي" }] },
          { type: "p", runs: [{ text: "שלום עולם זהו טקסט בעברית" }] },
        ],
      },
    ],
    header: [],
    footer: [],
    notes: [],
  };
  const html = writeReflowHtml(model, {}, { name: "x", img: () => null });
  expect(html).toContain('dir="rtl"');
  expect(html).toMatch(/<html lang="(ar|he)" dir="rtl">/);
});

test("a page range converts only those pages", async () => {
  const { html } = await convert(await makeSamplePdf(), { pages: [2] });
  expect(textOf(html)).toContain("Appendix");
  expect(textOf(html)).not.toContain("Quarterly Report");
});

test("nested and continued lists, tables with spans", () => {
  const item = (text: string, level: number, instance = 1, kind: "bullet" | "decimal" = "bullet") =>
    ({
      type: "p" as const,
      runs: [{ text }],
      list: { instance, level, kind, suffix: ".", start: 1, leftIndent: 20, hanging: 10, glyph: "•" },
    });
  const cell = (text: string, extra = {}) => ({ paragraphs: [{ type: "p" as const, runs: [{ text }] }], colSpan: 1, ...extra });
  const model: DocModel = {
    sections: [
      {
        width: 612,
        height: 792,
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        blocks: [
          item("a", 0),
          item("a1", 1),
          item("b", 0),
          { type: "p", runs: [{ text: "break" }] },
          item("one", 0, 2, "decimal"),
          item("two", 0, 2, "decimal"),
          { type: "p", runs: [{ text: "between" }] },
          item("three", 0, 2, "decimal"),
          {
            type: "table",
            colWidths: [50, 50],
            borders: true,
            indentLeft: 0,
            headerRows: 1,
            rows: [[cell("H", { colSpan: 2 })], [cell("x", { vMerge: "restart" }), cell("y")], [cell("", { vMerge: "continue" }), cell("z")]],
          },
        ],
      },
    ],
    header: [],
    footer: [],
    notes: [],
  };
  const html = writeReflowHtml(model, {}, { name: "x", img: () => null });
  expect(html).toMatch(/<ul>\s*<li>a\s*<ul>\s*<li>a1<\/li>\s*<\/ul>\s*<\/li>\s*<li>b<\/li>\s*<\/ul>/);
  expect(html).toContain('<ol start="3">');
  expect(html).toContain('<th colspan="2">H</th>');
  expect(html).toContain('<td rowspan="2">x</td>');
});

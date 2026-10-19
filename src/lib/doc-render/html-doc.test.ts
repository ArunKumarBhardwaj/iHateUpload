import { describe, expect, test } from "bun:test";
import { PDFDocument } from "@cantoo/pdf-lib";

import { htmlToDoc, parseColor, parseLength } from "./html-doc";
import { defaultDocOptions } from "./options";
import { convertDoc } from "./process";
import { loadFont, pdfPages } from "./testkit";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHhgCAh6X4CYAAAAASUVORK5CYII=",
  "base64",
).toString("base64");

const HTML = `<!doctype html><html><head><title>Doc Title</title>
<style>
 body { font-family: Georgia, serif; }
 .note { background: #fff3cd; border: 1px solid #e0c36a; color: #7a5b00; }
 h1 { color: #1d4ed8; text-align: center }
 td.num { text-align: right; background-color: #eef; }
 @media print { h1 { color: red } }
</style><script>alert("nope")</script></head>
<body>
<h1>Report</h1>
<p>Plain with <b>bold</b>, <i>italic</i>, <span style="color:#d61f3a;font-size:18px">red big</span> and <a href="https://example.com/x">a link</a>.</p>
<div class="note"><p>Boxed note text</p></div>
<ul><li>one</li><li>two<ol><li>deep a</li><li>deep b</li></ol></li></ul>
<ol start="3"><li>three</li><li>four</li></ol>
<table border="1"><thead><tr><th>Name</th><th>Qty</th></tr></thead><tbody><tr><td>Pen</td><td class="num">3</td></tr></tbody></table>
<img src="data:image/png;base64,${PNG}" width="40" height="40"><img src="https://example.com/a.png" alt="remote pic">
<pre>code  line
  indented</pre>
<p style="display:none">hidden words</p>
</body></html>`;

const data = (s: string) => ({ text: async () => s, bytes: async () => new TextEncoder().encode(s).buffer as ArrayBuffer });

describe("css helpers", () => {
  test("colours and lengths", () => {
    expect(parseColor("#abc")).toBe("AABBCC");
    expect(parseColor("rgb(255, 0, 16)")).toBe("FF0010");
    expect(parseColor("navy")).toBe("000080");
    expect(parseLength("16px", 12)).toBe(12);
    expect(parseLength("2em", 10)).toBe(20);
  });
});

describe("html to pdf", () => {
  test("model applies style rules", async () => {
    const doc = await htmlToDoc(HTML);
    expect(doc.title).toBe("Doc Title");
    const h1 = doc.blocks[0];
    expect(h1.kind === "para" && h1.align).toBe("center");
    expect(h1.kind === "para" && h1.inlines[0].kind === "text" && h1.inlines[0].style.color).toBe("1D4ED8");
    const note = doc.blocks.find((b) => b.kind === "para" && b.box?.bg === "FFF3CD");
    expect(note).toBeDefined();
  });

  test("renders text, lists, tables, images and skips scripts and hidden text", async () => {
    const out = await convertDoc("page.html", data(HTML), { ...defaultDocOptions("html"), paper: "letter", landscape: true }, { loadFont });
    const text = (await pdfPages(out.bytes)).join(" ").replace(/\s+/g, " ");
    for (const s of ["Report", "bold", "red big", "Boxed note text", "deep a", "3. three", "4. four", "Name", "Qty", "Pen", "[image: remote pic]", "code line"]) {
      expect(text).toContain(s);
    }
    expect(text).not.toContain("alert");
    expect(text).not.toContain("hidden words");
    expect(text).not.toContain("@media");
    const pdf = await PDFDocument.load(out.bytes);
    expect(Math.round(pdf.getPage(0).getWidth())).toBe(792);
    const raw = Buffer.from(out.bytes).toString("latin1");
    expect(raw).toContain("/Image");
    expect(raw).toContain("Times"); // body font-family: Georgia, serif
  });
});

/**
 * Generates the synthetic PDF corpus and one ground-truth JSON per PDF.
 * Every fixture is described once as data; the HTML (or pdf-lib drawing) and the truth are both
 * produced from that description, so truth never comes from a converter.
 *
 *   bun bench/pdf-to-word/fixtures/gen.ts           make missing fixtures
 *   bun bench/pdf-to-word/fixtures/gen.ts --force   remake all (PDF bytes change: Chrome stamps dates)
 *   bun bench/pdf-to-word/fixtures/gen.ts --long    also make the 100+ page speed fixture (gitignored)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";

import type { Seg, Truth, TruthCell } from "../types";

const DIR = import.meta.dirname;
const write = (path: string, data: string | Uint8Array) => writeFileSync(path, data);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FORCE = process.argv.includes("--force");
const LONG = process.argv.includes("--long");

// ---------- deterministic text ----------
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS =
  "river stone market window garden paper bridge engine silver forest letter harbor candle morning copper valley pocket lantern meadow ribbon thunder compass velvet orchard whisper marble anchor basket feather island jungle kettle ladder mirror needle oyster pepper quartz saddle tunnel umbrella violet wagon yellow zephyr amber breeze cobalt dagger ember falcon glacier hollow ivory jasper kernel lagoon mosaic nectar opal prairie quiver raven summit timber unity vessel willow yonder zenith".split(" ");
function sentence(r: () => number, n: number): string {
  const w: string[] = [];
  for (let i = 0; i < n; i++) w.push(WORDS[Math.floor(r() * WORDS.length)]);
  return w.join(" ");
}
function para(r: () => number, words = 55): string {
  const parts: string[] = [];
  let left = words;
  while (left > 0) {
    const n = Math.min(left, 8 + Math.floor(r() * 8));
    const s = sentence(r, n);
    parts.push(s[0].toUpperCase() + s.slice(1) + ".");
    left -= n;
  }
  return parts.join(" ");
}

// ---------- png ----------
const CRC = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function png(w: number, h: number, px: (x: number, y: number) => [number, number, number]): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function pngDataUrl(seed: number): string {
  const bytes = png(240, 150, (x, y) => [(x * 255 / 240 + seed * 60) % 256, (y * 255 / 150 + seed * 90) % 256, (128 + seed * 70 + ((x >> 4) + (y >> 4)) * 6) % 256]);
  return "data:image/png;base64," + Buffer.from(bytes).toString("base64");
}

// ---------- builder ----------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

class Doc {
  html = "";
  t: Truth;
  constructor(name: string, description: string) {
    this.t = { name, description, paragraphs: [], pages: 1 };
  }
  h(level: 1 | 2 | 3, text: string) {
    this.html += `<h${level}>${esc(text)}</h${level}>`;
    this.t.paragraphs.push(text);
    (this.t.headings ??= []).push({ text, level });
  }
  p(text: string, attrs = "") {
    this.html += `<p ${attrs}>${esc(text)}</p>`;
    this.t.paragraphs.push(text);
  }
  /** Paragraph of formatted segments. Also becomes a truth `runs` entry. */
  rich(segs: Seg[], pStyle = "") {
    const body = segs
      .map((s) => {
        const st: string[] = [];
        if (s.b) st.push("font-weight:700");
        if (s.i) st.push("font-style:italic");
        const deco = [s.u ? "underline" : "", s.s ? "line-through" : ""].filter(Boolean).join(" ");
        if (deco) st.push(`text-decoration:${deco}`);
        if (s.color) st.push(`color:#${s.color}`);
        if (s.size) st.push(`font-size:${s.size}pt`);
        if (s.hl) st.push("background:#ffff00");
        if (s.font) st.push(`font-family:'${s.font}'`);
        let inner = esc(s.text);
        if (s.sup) inner = `<sup>${inner}</sup>`;
        if (s.sub) inner = `<sub>${inner}</sub>`;
        return st.length ? `<span style="${st.join(";")}">${inner}</span>` : inner;
      })
      .join("");
    this.html += `<p style="${pStyle}">${body}</p>`;
    this.t.paragraphs.push(segs.map((s) => s.text).join(""));
    (this.t.runs ??= []).push(
      segs.map((s) => ({ ...s, size: s.sup || s.sub ? undefined : (s.size ?? 12), color: s.color ?? "000000" })),
    );
  }
  list(type: "bullet" | "number", items: (string | { text: string; sub?: string[] })[]) {
    const tag = type === "bullet" ? "ul" : "ol";
    const flat: string[] = [];
    let h = `<${tag}>`;
    for (const it of items) {
      if (typeof it === "string") {
        h += `<li>${esc(it)}</li>`;
        flat.push(it);
      } else {
        flat.push(it.text);
        h += `<li>${esc(it.text)}<ul>${(it.sub ?? []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></li>`;
        flat.push(...(it.sub ?? []));
      }
    }
    this.html += h + `</${tag}>`;
    this.t.paragraphs.push(...flat);
    (this.t.lists ??= []).push({ type, items: flat });
  }
  table(rows: TruthCell[][], css = "", cellCss = "") {
    let h = `<table style="${css}">`;
    for (const row of rows) {
      h += "<tr>";
      for (const c of row) {
        const st = [cellCss, c.shaded ? "background:#d9e2f3" : ""].filter(Boolean).join(";");
        h += `<td${c.cs ? ` colspan="${c.cs}"` : ""}${c.rs ? ` rowspan="${c.rs}"` : ""} style="${st}">${esc(c.text)}</td>`;
        this.t.paragraphs.push(c.text);
      }
      h += "</tr>";
    }
    this.html += h + "</table>";
    (this.t.tables ??= []).push({ rows });
  }
  raw(html: string) {
    this.html += html;
  }
}

const CSS = `@page{size:Letter;margin:0.75in}
*{box-sizing:border-box}
body{font:12pt/1.4 'Times New Roman',serif;margin:0;font-variant-ligatures:none;hyphens:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1{font-size:26pt;margin:0 0 12pt}h2{font-size:18pt;margin:14pt 0 8pt}h3{font-size:14pt;margin:12pt 0 6pt}
p{margin:0 0 9pt}li{margin-bottom:3pt}
table{border-collapse:collapse}td{padding:4pt 8pt}
.ruled td{border:1px solid #000}`;

async function chrome(args: string[]): Promise<void> {
  const prof = mkdtempSync(join(tmpdir(), "p2w-chrome-"));
  const p = spawn(CHROME, ["--headless", "--disable-gpu", "--no-sandbox", `--user-data-dir=${prof}`, "--hide-scrollbars", ...args], { stdio: "ignore" });
  await new Promise((res) => p.on("exit", res));
  rmSync(prof, { recursive: true, force: true });
}

async function writeHtmlPdf(name: string, d: Doc, extraCss = "") {
  const htmlPath = join(tmpdir(), `p2w-${name}.html`);
  write(htmlPath, `<!doctype html><meta charset=utf-8><title>${name}</title><style>${CSS}${extraCss}</style><body>${d.html}</body>`);
  await chrome(["--no-pdf-header-footer", `--print-to-pdf=${join(DIR, name + ".pdf")}`, "file://" + htmlPath]);
  rmSync(htmlPath);
  const pages = (await PDFDocument.load(readFileSync(join(DIR, name + ".pdf")))).getPageCount();
  d.t.pages = pages;
  write(join(DIR, name + ".truth.json"), JSON.stringify(d.t, null, 2) + "\n");
}
async function writeTruth(t: Truth) {
  write(join(DIR, t.name + ".truth.json"), JSON.stringify(t, null, 2) + "\n");
}

// ---------- fixtures ----------
type Make = () => Promise<void>;
const fixtures: Record<string, Make> = {};

fixtures["columns"] = async () => {
  const r = rng(1);
  const d = new Doc("columns", "Two-column article under a full-width title");
  d.h(1, "The Harbor Report");
  d.t.columns = 2;
  d.t.order = true;
  d.t.fonts = ["Georgia"];
  d.raw(`<div style="column-count:2;column-gap:0.4in;font-family:Georgia">`);
  d.h(2, "Morning Tide");
  for (let i = 0; i < 3; i++) d.p(para(r, 60));
  d.h(2, "Evening Market");
  for (let i = 0; i < 3; i++) d.p(para(r, 60));
  d.raw("</div>");
  await writeHtmlPdf("columns", d, "h2{margin-top:0}");
};

fixtures["rich-formatting"] = async () => {
  const d = new Doc("rich-formatting", "Bold/italic/underline/strike/colour/size/sup/sub/highlight and three font families");
  d.t.fonts = ["Georgia", "Courier New", "Arial"];
  d.t.segmentation = true; // every line is its own <p>, so the PDF has no wrapped paragraphs
  d.h(1, "Formatting Showcase");
  d.rich([{ text: "Plain intro and " }, { text: "bold words", b: true }, { text: " then " }, { text: "italic words", i: true }, { text: " then " }, { text: "bold italic", b: true, i: true }, { text: " done." }]);
  d.rich([{ text: "We have " }, { text: "underlined text", u: true }, { text: " and " }, { text: "struck out text", s: true }, { text: " and " }, { text: "both lines", u: true, s: true }, { text: " here." }]);
  d.rich([{ text: "Colours: " }, { text: "red words", color: "c00000" }, { text: " and " }, { text: "blue words", color: "0044cc" }, { text: " and " }, { text: "green words", color: "007a33" }, { text: " end." }]);
  d.rich([{ text: "Sizes: " }, { text: "small", size: 9 }, { text: " normal " }, { text: "large", size: 18 }, { text: " " }, { text: "huge", size: 24 }, { text: " back." }]);
  d.rich([{ text: "Water is H" }, { text: "2", sub: true }, { text: "O and energy is E = mc" }, { text: "2", sup: true }, { text: " plus x" }, { text: "i", sub: true }, { text: " and 10" }, { text: "3", sup: true }, { text: "." }]);
  d.rich([{ text: "Marked: " }, { text: "highlighted phrase", hl: true }, { text: " and " }, { text: "bold highlighted", hl: true, b: true }, { text: " end." }]);
  d.rich([{ text: "Serif line in Georgia for the record.", font: "Georgia" }]);
  d.rich([{ text: "Monospace line in Courier New for code.", font: "Courier New" }]);
  d.rich([{ text: "Sans line in Arial for headlines.", font: "Arial" }]);
  await writeHtmlPdf("rich-formatting", d);
};

fixtures["links"] = async () => {
  const r = rng(3);
  const d = new Doc("links", "External hyperlinks, an internal link, headings");
  d.t.links = [];
  d.h(1, "Link Collection");
  const link = (url: string, text: string, before: string, after: string) => {
    d.html += `<p>${esc(before)}<a href="${url}">${esc(text)}</a>${esc(after)}</p>`;
    d.t.paragraphs.push(before + text + after);
    d.t.links!.push({ url, text });
  };
  link("https://example.com/docs", "read the documentation", "For details please ", " before starting.");
  link("https://example.org/pricing?plan=pro", "pricing page", "See also the ", " for plans.");
  link("https://example.net/a/very/long/path/to/resource", "long resource", "A ", " is linked here.");
  d.p(para(r, 40));
  d.html += `<p><a href="#sec2">Jump to section two</a> for more.</p>`;
  d.t.paragraphs.push("Jump to section two for more.");
  d.t.links.push({ url: "#sec2", text: "Jump to section two" });
  link("mailto:team@example.com", "team@example.com", "Write to ", " anytime.");
  d.html += `<h2 id="sec2">Section Two</h2>`;
  d.t.paragraphs.push("Section Two");
  d.t.headings!.push({ text: "Section Two", level: 2 });
  d.p(para(r, 50));
  await writeHtmlPdf("links", d);
};

fixtures["lists-headings"] = async () => {
  const r = rng(4);
  const d = new Doc("lists-headings", "Three heading levels, bullet, numbered and nested lists");
  d.t.order = true;
  d.h(1, "Planning Guide");
  d.p(para(r, 30));
  d.h(2, "Shopping Items");
  d.list("bullet", ["Copper kettle", "Silver ladder", "Marble anchor", "Velvet ribbon", "Amber lantern"]);
  d.h(2, "Procedure");
  d.list("number", ["Open the harbor gate", "Light the candle", "Check the compass", "Raise the sail", "Close the logbook"]);
  d.h(3, "Nested Notes");
  d.list("bullet", [
    { text: "Forest supplies", sub: ["Timber bundles", "Feather pillows"] },
    { text: "Valley supplies", sub: ["Pepper sacks", "Quartz stones"] },
  ]);
  d.p(para(r, 30));
  await writeHtmlPdf("lists-headings", d);
};

fixtures["table-ruled"] = async () => {
  const d = new Doc("table-ruled", "Ruled table with merged title, shaded header, rowspan and colspan");
  d.t.order = true;
  d.h(1, "Sales Summary");
  d.p("The table below lists regional results.");
  d.table(
    [
      [{ text: "Regional Results", cs: 4, shaded: true }],
      [{ text: "Region", shaded: true }, { text: "Q1", shaded: true }, { text: "Q2", shaded: true }, { text: "Q3", shaded: true }],
      [{ text: "North", rs: 2 }, { text: "120" }, { text: "135" }, { text: "150" }],
      [{ text: "140" }, { text: "155" }, { text: "170" }],
      [{ text: "South" }, { text: "Combined across two quarters", cs: 2 }, { text: "98" }],
      [{ text: "West" }, { text: "75" }, { text: "80" }, { text: "91" }],
    ],
    "width:100%",
  );
  d.p("Figures are in thousands.");
  await writeHtmlPdf("table-ruled", d, "table{} td{border:1px solid #000}");
};

fixtures["table-borderless"] = async () => {
  const d = new Doc("table-borderless", "Aligned columns with no ruling lines");
  d.t.order = true;
  d.h(1, "Price List");
  d.p("Items are aligned in columns without borders.");
  const rows: TruthCell[][] = [["Item", "Weight", "Price"], ["Copper kettle", "2.4 kg", "$45.00"], ["Silver ladder", "5.1 kg", "$120.00"], ["Marble anchor", "9.8 kg", "$310.00"], ["Velvet ribbon", "0.1 kg", "$4.50"], ["Amber lantern", "1.2 kg", "$29.00"]].map((row) => row.map((text) => ({ text })));
  d.table(rows, "width:80%", "padding:3pt 14pt 3pt 0");
  d.p("Prices exclude shipping.");
  await writeHtmlPdf("table-borderless", d);
};

fixtures["table-multipage"] = async () => {
  const r = rng(7);
  const d = new Doc("table-multipage", "One 100-row ruled table that breaks across pages");
  d.t.order = true;
  d.h(1, "Inventory Log");
  const rows: TruthCell[][] = [[{ text: "No", shaded: true }, { text: "Item", shaded: true }, { text: "Value", shaded: true }]];
  for (let i = 1; i < 100; i++) rows.push([{ text: String(i) }, { text: sentence(r, 2) }, { text: String(i * 37 + 11) }]);
  d.table(rows, "width:100%");
  await writeHtmlPdf("table-multipage", d, "td{border:1px solid #000;padding:2pt 8pt}");
};

fixtures["vectors"] = async () => {
  const d = new Doc("vectors", "Four vector shapes: rectangle, circle, triangle, line");
  d.t.order = true;
  d.t.vectors = 4;
  d.h(1, "Diagram Page");
  d.p("The drawing below uses only vector shapes.");
  d.raw(`<svg width="480" height="200" viewBox="0 0 480 200"><rect x="10" y="20" width="120" height="80" fill="#2e75b6" stroke="#1f4e79" stroke-width="3"/><circle cx="220" cy="60" r="45" fill="#c55a11"/><polygon points="320,100 380,20 440,100" fill="#548235"/><line x1="10" y1="160" x2="460" y2="160" stroke="#7030a0" stroke-width="4"/></svg>`);
  d.p("Caption: four shapes drawn as vectors.");
  await writeHtmlPdf("vectors", d);
};

fixtures["images"] = async () => {
  const r = rng(9);
  const d = new Doc("images", "Three raster images: inline, wrapped by text, inline");
  d.t.order = true;
  d.t.images = { count: 3, labels: ["1", "2", "3"] };
  d.h(1, "Photo Notes");
  d.p(para(r, 30));
  d.raw(`<p><img src="${pngDataUrl(0)}" width="240" height="150"></p>`);
  d.p("Figure 1 first inline picture.");
  d.raw(`<figure style="float:left;margin:0 14pt 8pt 0;width:240px"><img src="${pngDataUrl(1)}" width="240" height="150"><figcaption style="font-size:12pt">Figure 2 wrapped picture</figcaption></figure>`);
  d.t.paragraphs.push("Figure 2 wrapped picture");
  d.p(para(r, 90));
  d.raw(`<div style="clear:both"></div><p><img src="${pngDataUrl(2)}" width="240" height="150"></p>`);
  d.p("Figure 3 last inline picture.");
  await writeHtmlPdf("images", d);
};

fixtures["footnotes"] = async () => {
  const r = rng(11);
  const d = new Doc("footnotes", "Superscript references with footnote text at the page bottom");
  d.t.order = true;
  d.t.footnotes = ["Source: the harbor survey of last spring.", "Figures rounded to the nearest unit."];
  d.h(1, "Annual Review");
  const p1 = para(r, 35);
  d.html += `<p>${esc(p1)}<sup>1</sup></p>`;
  d.t.paragraphs.push(p1 + "1");
  const p2 = para(r, 35);
  d.html += `<p>${esc(p2)}<sup>2</sup></p>`;
  d.t.paragraphs.push(p2 + "2");
  d.html += `<div style="position:absolute;left:0;right:0;bottom:0;border-top:1px solid #000;padding-top:4pt;font-size:10pt"><div><sup>1</sup> ${esc(d.t.footnotes[0])}</div><div><sup>2</sup> ${esc(d.t.footnotes[1])}</div></div>`;
  d.t.paragraphs.push("1 " + d.t.footnotes[0], "2 " + d.t.footnotes[1]);
  await writeHtmlPdf("footnotes", d, "body{position:relative;height:9.45in}");
};

fixtures["header-footer"] = async () => {
  const r = rng(13);
  const t: Truth = { name: "header-footer", description: "Four pages with a repeating header, footer text and page numbers (pdf-lib)", paragraphs: [], order: true, headings: [], header: "Quarterly Report - Draft", footer: "Company Confidential", pageNumbers: true, pages: 4 };
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const wrap = (s: string, size: number, width: number) => {
    const lines: string[] = [];
    let cur = "";
    for (const w of s.split(" ")) {
      const next = cur ? cur + " " + w : w;
      if (font.widthOfTextAtSize(next, size) > width) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    return [...lines, cur];
  };
  for (let pg = 1; pg <= 4; pg++) {
    const page = pdf.addPage([612, 792]);
    page.drawText("Quarterly Report - Draft", { x: 72, y: 745, size: 10, font });
    page.drawText("Company Confidential", { x: 72, y: 40, size: 10, font });
    page.drawText(`Page ${pg}`, { x: 480, y: 40, size: 10, font });
    let y = 690;
    if (pg === 1 || pg === 3) {
      const text = pg === 1 ? "Results Overview" : "Outlook";
      page.drawText(text, { x: 72, y, size: pg === 1 ? 24 : 18, font: bold });
      t.paragraphs.push(text);
      t.headings!.push({ text, level: pg === 1 ? 1 : 2 });
      y -= 36;
    }
    for (let i = 0; i < 4; i++) {
      const text = para(r, 70);
      t.paragraphs.push(text);
      for (const line of wrap(text, 11, 468)) {
        page.drawText(line, { x: 72, y, size: 11, font });
        y -= 15;
      }
      y -= 10;
    }
  }
  write(join(DIR, "header-footer.pdf"), await pdf.save());
  await writeTruth(t);
};

fixtures["forms"] = async () => {
  const t: Truth = {
    name: "forms",
    description: "AcroForm with three text fields and one checkbox (pdf-lib)",
    paragraphs: ["Registration Form", "Full name:", "Email:", "Subscribe to newsletter:", "Comments:"],
    order: true,
    headings: [{ text: "Registration Form", level: 1 }],
    formFields: [{ type: "text", name: "fullname" }, { type: "text", name: "email" }, { type: "checkbox", name: "subscribe" }, { type: "text", name: "comments" }],
    pages: 1,
  };
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  const form = pdf.getForm();
  page.drawText("Registration Form", { x: 72, y: 700, size: 24, font: bold });
  const rows: [string, number][] = [["Full name:", 640], ["Email:", 590], ["Subscribe to newsletter:", 540], ["Comments:", 490]];
  for (const [label, y] of rows) page.drawText(label, { x: 72, y, size: 12, font });
  const tf = (name: string, y: number, h = 22) => {
    const f = form.createTextField(name);
    f.addToPage(page, { x: 230, y: y - 6, width: 250, height: h, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  };
  tf("fullname", 640);
  tf("email", 590);
  const cb = form.createCheckBox("subscribe");
  cb.addToPage(page, { x: 230, y: 534, width: 18, height: 18, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  tf("comments", 490, 60);
  write(join(DIR, "forms.pdf"), await pdf.save());
  await writeTruth(t);
};

fixtures["scanned"] = async () => {
  const r = rng(17);
  const d = new Doc("scanned", "Raster-only page (no text layer): text is only in the picture");
  d.t.order = true;
  d.t.scanned = true;
  d.h(1, "Meeting Minutes");
  d.p(para(r, 45));
  d.p(para(r, 45));
  const htmlPath = join(tmpdir(), "p2w-scanned.html");
  const pngPath = join(tmpdir(), "p2w-scanned.png");
  write(htmlPath, `<!doctype html><meta charset=utf-8><style>${CSS}@page{margin:0}body{width:8.5in;height:11in;padding:0.75in;background:#fff}</style><body>${d.html}</body>`);
  await chrome([`--screenshot=${pngPath}`, "--window-size=816,1056", "--force-device-scale-factor=2", "file://" + htmlPath]);
  const pdf = await PDFDocument.create();
  const img = await pdf.embedPng(readFileSync(pngPath));
  const page = pdf.addPage([612, 792]);
  page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  write(join(DIR, "scanned.pdf"), await pdf.save());
  rmSync(htmlPath);
  rmSync(pngPath);
  d.t.pages = 1;
  await writeTruth(d.t);
};

fixtures["long"] = async () => {
  const r = rng(21);
  const d = new Doc("long", "120-page mixed document for speed: headings, paragraphs, lists and tables");
  for (let pg = 1; pg <= 120; pg++) {
    d.raw(`<div style="break-after:page">`);
    d.h(2, `Chapter ${pg} ${sentence(r, 2)}`);
    d.p(para(r, 70));
    if (pg % 3 === 0) d.list("bullet", [sentence(r, 4), sentence(r, 4), sentence(r, 4)]);
    if (pg % 5 === 0) d.table([[{ text: "Key", shaded: true }, { text: "Value", shaded: true }], [{ text: sentence(r, 1) }, { text: String(pg * 13) }], [{ text: sentence(r, 1) }, { text: String(pg * 17) }]], "width:60%");
    d.p(para(r, 70));
    d.p(para(r, 70));
    d.raw("</div>");
  }
  delete d.t.lists; // list/heading/table scoring is covered by the small fixtures; here we time and score text
  delete d.t.headings;
  delete d.t.tables;
  await writeHtmlPdf("long", d, ".ruled td,td{border:1px solid #000}");
};

for (const [name, make] of Object.entries(fixtures)) {
  if (name === "long" && !LONG) continue;
  if (!FORCE && existsSync(join(DIR, name + ".pdf")) && existsSync(join(DIR, name + ".truth.json"))) continue;
  console.log("generating", name);
  await make();
}
console.log("done");

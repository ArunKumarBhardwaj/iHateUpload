/**
 * Generates the realistic synthetic corpus (20 PDFs) and one truth JSON per PDF into ./corpus.
 * Everything is invented: names, numbers, addresses (example.com / example.org URLs only).
 * Producers vary on purpose: headless Chrome (HTML+CSS), pdf-lib (drawn text, AcroForm, annotations),
 * and rasterised pages (scan). Truth is written by this file, never derived from a converter.
 *
 *   bun internal/benchmarks/pdf-to-word/realistic/gen.ts            make missing documents
 *   bun internal/benchmarks/pdf-to-word/realistic/gen.ts --force    remake all (Chrome stamps dates, so bytes change)
 *   bun internal/benchmarks/pdf-to-word/realistic/gen.ts name,name  only these
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { PDFDocument, PDFName, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import sharp from "sharp";

import type { Seg, Truth, TruthCell } from "../types";

export type RealTruth = Truth & {
  /** What the document stands for, for the per-feature report. */
  category: string;
  /** Score text by multiset of non-space characters (CJK has no word spaces; RTL extraction order varies). */
  charMode?: boolean;
  /** Sticky-note / comment texts the document carries as PDF annotations. */
  comments?: string[];
};

const DIR = import.meta.dirname;
const OUT = join(DIR, "corpus");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FORCE = process.argv.includes("--force");
const ONLY = process.argv.slice(2).find((a) => !a.startsWith("--"))?.split(",");
mkdirSync(OUT, { recursive: true });

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
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(px(x, y), y * (w * 3 + 1) + 1 + x * 3);
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
/** A smooth "photo-like" picture: gradient + soft blobs, so it looks like an image, not a flat swatch. */
function picUrl(seed: number, w = 320, h = 200): string {
  const bytes = png(w, h, (x, y) => {
    const d1 = Math.hypot(x - w * 0.3, y - h * 0.4);
    const d2 = Math.hypot(x - w * 0.75, y - h * 0.65);
    const k = Math.max(0, 1 - d1 / (h * 0.55)) * 90 + Math.max(0, 1 - d2 / (h * 0.45)) * 70;
    return [(x * 140) / w + 60 + seed * 37 + k * 0.4, (y * 140) / h + 50 + seed * 53 + k * 0.7, 140 + seed * 29 + k * 0.3 - (y * 60) / h].map((v) => Math.max(0, Math.min(255, Math.round(v % 256)))) as [number, number, number];
  });
  return "data:image/png;base64," + Buffer.from(bytes).toString("base64");
}
function logoUrl(): string {
  const bytes = png(120, 120, (x, y) => {
    const d = Math.hypot(x - 60, y - 60);
    if (d < 52 && d > 36) return [20, 90, 160];
    if (d <= 36 && Math.abs(x - 60) + Math.abs(y - 60) < 40) return [240, 140, 20];
    return [255, 255, 255];
  });
  return "data:image/png;base64," + Buffer.from(bytes).toString("base64");
}

// ---------- builder ----------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

class Doc {
  html = "";
  t: RealTruth;
  constructor(name: string, category: string, description: string) {
    this.t = { name, category, description, paragraphs: [], pages: 1 };
  }
  h(level: 1 | 2 | 3, text: string, style = "") {
    this.html += `<h${level} style="${style}">${esc(text)}</h${level}>`;
    this.t.paragraphs.push(text);
    (this.t.headings ??= []).push({ text, level });
  }
  p(text: string, style = "", cls = "") {
    this.html += `<p class="${cls}" style="${style}">${esc(text)}</p>`;
    this.t.paragraphs.push(text);
  }
  /** Paragraph of formatted segments; also a truth `runs` entry (size left unchecked). */
  rich(segs: Seg[], style = "") {
    const body = segs
      .map((s) => {
        const st: string[] = [];
        if (s.b) st.push("font-weight:700");
        if (s.i) st.push("font-style:italic");
        if (s.u) st.push("text-decoration:underline");
        if (s.color) st.push(`color:#${s.color}`);
        let inner = esc(s.text);
        if (s.sup) inner = `<sup>${inner}</sup>`;
        return st.length ? `<span style="${st.join(";")}">${inner}</span>` : inner;
      })
      .join("");
    this.html += `<p style="${style}">${body}</p>`;
    this.t.paragraphs.push(segs.map((s) => s.text).join(""));
    (this.t.runs ??= []).push(segs.map((s) => ({ ...s, color: s.color ?? "000000" })));
  }
  list(type: "bullet" | "number", items: string[], style = "") {
    const tag = type === "bullet" ? "ul" : "ol";
    this.html += `<${tag} style="${style}">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</${tag}>`;
    this.t.paragraphs.push(...items);
    (this.t.lists ??= []).push({ type, items });
  }
  table(rows: TruthCell[][], css = "", cellCss = "", headerCss = "background:#d9e2f3;font-weight:700") {
    let h = `<table style="${css}">`;
    for (const row of rows) {
      h += "<tr>";
      for (const c of row) {
        const st = [cellCss, c.shaded ? headerCss : ""].filter(Boolean).join(";");
        h += `<td${c.cs ? ` colspan="${c.cs}"` : ""}${c.rs ? ` rowspan="${c.rs}"` : ""} style="${st}">${esc(c.text)}</td>`;
        if (c.text) this.t.paragraphs.push(c.text);
      }
      h += "</tr>";
    }
    this.html += h + "</table>";
    (this.t.tables ??= []).push({ rows });
  }
  raw(html: string) {
    this.html += html;
  }
  /** Text that is in the document but not produced through a helper above. */
  say(...texts: string[]) {
    this.t.paragraphs.push(...texts);
  }
}

const BASE_CSS = `@page{size:Letter;margin:0.75in}
*{box-sizing:border-box}
body{font:11pt/1.4 Arial,Helvetica,sans-serif;margin:0;color:#111;font-variant-ligatures:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1{font-size:24pt;margin:0 0 10pt}h2{font-size:15pt;margin:14pt 0 6pt}h3{font-size:12pt;margin:10pt 0 4pt}
p{margin:0 0 8pt}li{margin-bottom:3pt}
table{border-collapse:collapse}td{padding:4pt 8pt;vertical-align:top}`;

async function chrome(args: string[]): Promise<void> {
  const prof = mkdtempSync(join(tmpdir(), "p2w-real-"));
  const p = spawn(CHROME, ["--headless", "--disable-gpu", "--no-sandbox", `--user-data-dir=${prof}`, "--hide-scrollbars", ...args], { stdio: "ignore" });
  await new Promise((res) => p.on("exit", res));
  rmSync(prof, { recursive: true, force: true });
}
async function htmlToPdf(d: Doc, extraCss = "", base = BASE_CSS): Promise<Uint8Array> {
  const htmlPath = join(tmpdir(), `p2w-real-${d.t.name}.html`);
  const outPath = join(tmpdir(), `p2w-real-${d.t.name}.pdf`);
  writeFileSync(htmlPath, `<!doctype html><meta charset=utf-8><title>${d.t.name}</title><style>${base}${extraCss}</style><body>${d.html}</body>`);
  await chrome(["--no-pdf-header-footer", `--print-to-pdf=${outPath}`, "file://" + htmlPath]);
  const bytes = new Uint8Array(readFileSync(outPath));
  rmSync(htmlPath);
  rmSync(outPath);
  return bytes;
}
async function finish(t: RealTruth, bytes: Uint8Array) {
  t.pages = (await PDFDocument.load(bytes)).getPageCount();
  writeFileSync(join(OUT, t.name + ".pdf"), bytes);
  writeFileSync(join(OUT, t.name + ".truth.json"), JSON.stringify(t, null, 2) + "\n");
}
async function chromePdf(d: Doc, extraCss = "") {
  await finish(d.t, await htmlToPdf(d, extraCss));
}
/** Stamp a running header / footer / "Page x of y" on a Chrome PDF with pdf-lib (Chrome cannot count pages in fixed boxes). */
async function stamp(bytes: Uint8Array, header: string, footer: string, pageOf = true): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  pages.forEach((pg, i) => {
    const { width } = pg.getSize();
    pg.drawText(header, { x: 54, y: pg.getHeight() - 36, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
    pg.drawText(footer, { x: 54, y: 30, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
    const label = pageOf ? `Page ${i + 1} of ${pages.length}` : `Page ${i + 1}`;
    pg.drawText(label, { x: width - 54 - font.widthOfTextAtSize(label, 9), y: 30, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
  });
  return pdf.save();
}

type Make = () => Promise<void>;
const docs: Record<string, Make> = {};

// 1 ---------------------------------------------------------------------------------------------
docs["invoice"] = async () => {
  const d = new Doc("invoice", "invoice", "Invoice with logo image, shaded line-item table and totals");
  d.t.order = true;
  d.t.fonts = ["Arial"];
  d.t.images = { count: 1, labels: [] };
  d.raw(`<div style="display:flex;justify-content:space-between;align-items:flex-start"><div style="display:flex;gap:12pt;align-items:center"><img src="${logoUrl()}" width=64 height=64><div>`);
  d.p("Brightwater Supply Co.", "font-size:16pt;font-weight:700;margin:0");
  d.p("418 Alder Street, Portland, OR 97205", "margin:0;color:#555");
  d.raw(`</div></div><div style="text-align:right">`);
  d.h(1, "INVOICE", "margin:0;color:#1f4e79");
  d.p("Invoice no. 2047-0193", "margin:0");
  d.raw("</div></div><hr style='margin:14pt 0;border:0;border-top:2px solid #1f4e79'>");
  d.p("Bill to: Fernhill Bakery LLC, 92 Quarry Road, Salem, OR 97301", "margin:0 0 4pt");
  d.p("Issue date: 3 March 2026", "margin:0 0 2pt");
  d.p("Due date: 2 April 2026", "margin:0 0 14pt");
  const items: [string, number, number][] = [["Stainless mixing bowl, 12 qt", 6, 38.5], ["Parchment sheets, box of 500", 10, 21.75], ["Digital kitchen scale", 3, 54], ["Silicone spatula set", 12, 9.9], ["Delivery and handling", 1, 45]];
  const H = (text: string): TruthCell => ({ text, shaded: true });
  const rows: TruthCell[][] = [[H("Description"), H("Qty"), H("Unit price"), H("Amount")]];
  let sub = 0;
  for (const [n, q, u] of items) {
    rows.push([{ text: n }, { text: String(q) }, { text: "$" + money(u) }, { text: "$" + money(q * u) }]);
    sub += q * u;
  }
  const tax = Math.round(sub * 0.0825 * 100) / 100;
  rows.push([{ text: "Subtotal", cs: 3 }, { text: "$" + money(sub) }]);
  rows.push([{ text: "Sales tax (8.25%)", cs: 3 }, { text: "$" + money(tax) }]);
  rows.push([{ text: "Total due", cs: 3 }, { text: "$" + money(sub + tax) }]);
  d.table(rows, "width:100%", "border-bottom:1px solid #bbb");
  d.p("Payment terms: net 30. Please quote the invoice number on your transfer. Thank you for your business.", "margin-top:18pt;color:#333");
  await chromePdf(d, "td:nth-child(n+2){text-align:right}");
};

// 2 ---------------------------------------------------------------------------------------------
docs["bank-statement"] = async () => {
  const r = rng(2);
  const d = new Doc("bank-statement", "statement", "Multi-page transaction table with running header, footer and page x of y");
  d.t.order = true;
  d.t.header = "Northwind Credit Union - Statement of Account";
  d.t.footer = "Account ending 4471 - Confidential";
  d.t.pageNumbers = true;
  d.t.fonts = ["Arial"];
  d.h(1, "Statement of Account");
  d.p("Account holder: Marguerite Ellison", "margin:0");
  d.p("Statement period: 1 June 2026 to 30 June 2026", "margin:0 0 10pt");
  const H = (text: string): TruthCell => ({ text, shaded: true });
  const rows: TruthCell[][] = [[H("Date"), H("Description"), H("Debit"), H("Credit"), H("Balance")]];
  const merchants = ["Greenleaf Grocers", "Metro Transit pass", "Coastline Electric", "Payroll deposit", "Harbor Pharmacy", "Oakridge Cafe", "Pinecrest Insurance", "Transfer from savings", "Lumen Internet", "Riverside Books"];
  let bal = 4210.55;
  for (let i = 0; i < 64; i++) {
    const day = 1 + Math.floor((i * 29) / 64);
    const m = merchants[Math.floor(r() * merchants.length)];
    const credit = m === "Payroll deposit" || m === "Transfer from savings";
    const amt = credit ? 800 + Math.floor(r() * 1800) + 0.0 : 6 + Math.floor(r() * 18000) / 100;
    bal += credit ? amt : -amt;
    rows.push([{ text: `06/${String(day).padStart(2, "0")}/2026` }, { text: m }, { text: credit ? "" : money(amt) }, { text: credit ? money(amt) : "" }, { text: money(bal) }]);
  }
  d.table(rows, "width:100%;font-size:9pt", "border-bottom:1px solid #ddd;padding:3pt 6pt");
  d.p("Closing balance " + money(bal), "margin-top:12pt;font-weight:700");
  const bytes = await stamp(await htmlToPdf(d, "@page{margin:0.9in 0.75in}td:nth-child(n+3){text-align:right}tr{break-inside:avoid}"), d.t.header!, d.t.footer!);
  await finish(d.t, bytes);
};

// 3 ---------------------------------------------------------------------------------------------
docs["research-paper"] = async () => {
  const r = rng(3);
  const d = new Doc("research-paper", "paper", "Two-column paper: abstract, footnotes, figure with caption, equations as text, references");
  d.t.order = true;
  d.t.columns = 2;
  d.t.fonts = ["Times New Roman"];
  d.t.images = { count: 1, labels: ["1"] };
  d.t.footnotes = ["Corresponding author, Department of Applied Ecology, Lindqvist Institute.", "All sampling sites were permitted under licence ER-2291."];
  const css = `body{font:10pt/1.3 'Times New Roman',serif}h1{font-size:19pt;text-align:center}h2{font-size:11pt;margin:10pt 0 4pt}p{text-align:justify;margin:0 0 6pt}.cols{column-count:2;column-gap:0.3in}.fn{position:fixed;left:0;right:0;bottom:0;border-top:1px solid #000;padding-top:3pt;font-size:8pt}`;
  d.h(1, "Seasonal Drift of Estuarine Salinity Under Variable Discharge");
  d.p("Ingrid Lindqvist1, Tomas Brandt and Aiko Hasegawa", "text-align:center;margin-bottom:10pt");
  d.rich([{ text: "Abstract. ", b: true }, { text: "We measure salinity at nine stations over eleven months and relate drift to river discharge. " + para(r, 40) }], "font-size:9pt;margin:0 0.4in 10pt");
  d.raw(`<div class="cols">`);
  const secs = ["1 Introduction", "2 Methods", "3 Results"];
  for (const s of secs) {
    d.h(2, s);
    d.p(para(r, 70));
    d.p(para(r, 70));
    if (s === "2 Methods") {
      d.p("S(t) = S0 + k Q(t)^-0.5 (1)", "text-align:center;font-style:italic");
      d.p(para(r, 40));
    }
    if (s === "3 Results") {
      d.raw(`<div style="break-inside:avoid;margin:6pt 0"><img src="${picUrl(2, 300, 170)}" style="width:100%">`);
      d.p("Figure 1: Mean salinity by station across the sampling period.", "font-size:8.5pt;text-align:center");
      d.raw("</div>");
    }
  }
  d.h(2, "References");
  d.list("number", ["Marsh, D. (2019). Tidal mixing in narrow channels. Journal of Coastal Studies, 41, 112-130.", "Okafor, N. and Weiss, P. (2021). Discharge variability and salt wedges. Estuarine Letters, 8, 45-61.", "Sato, K. (2022). A practical guide to conductivity sensors. Field Methods Review, 15, 201-219."], "font-size:9pt;padding-left:16pt");
  d.raw("</div>");
  d.raw(`<div class="fn"><div><sup>1</sup> ${esc(d.t.footnotes[0])}</div><div><sup>2</sup> ${esc(d.t.footnotes[1])}</div></div>`);
  d.say("1 " + d.t.footnotes[0], "2 " + d.t.footnotes[1]);
  await chromePdf(d, css);
};

// 4 ---------------------------------------------------------------------------------------------
docs["cv"] = async () => {
  const d = new Doc("cv", "cv", "Sidebar CV with icons and links");
  d.t.fonts = ["Arial"];
  d.t.links = [
    { url: "https://example.com/priya-raman", text: "example.com/priya-raman" },
    { url: "https://example.org/in/priyaraman", text: "example.org/in/priyaraman" },
  ];
  const icon = (p: string) => `<svg width=12 height=12 viewBox="0 0 12 12" style="margin-right:6pt"><circle cx=6 cy=6 r=5 fill="none" stroke="#fff" stroke-width=1.5/><path d="${p}" stroke="#fff" fill="none" stroke-width=1.5/></svg>`;
  d.raw(`<div style="display:flex;min-height:9.4in"><div style="width:2.3in;background:#243b53;color:#fff;padding:20pt 14pt;font-size:9.5pt;margin:-0.75in 0 -0.75in -0.75in;padding-top:0.9in;padding-left:0.75in;width:3in"><div>`);
  d.say("Contact", "priya.raman@example.com", "+1 555 0142", "Austin, Texas");
  d.raw(`<h3 style="color:#9fb3c8;text-transform:uppercase;font-size:9pt">Contact</h3><p>${icon("M3 6h6")}priya.raman@example.com</p><p>${icon("M6 3v6")}+1 555 0142</p><p>${icon("M3 3l6 6")}Austin, Texas</p>`);
  d.raw(`<p><a style="color:#9fd3ff" href="https://example.com/priya-raman">example.com/priya-raman</a></p><p><a style="color:#9fd3ff" href="https://example.org/in/priyaraman">example.org/in/priyaraman</a></p>`);
  d.say("example.com/priya-raman", "example.org/in/priyaraman", "Skills", "Python", "SQL and data modelling", "Dashboards", "Stakeholder workshops");
  d.raw(`<h3 style="color:#9fb3c8;text-transform:uppercase;font-size:9pt;margin-top:18pt">Skills</h3><p>Python</p><p>SQL and data modelling</p><p>Dashboards</p><p>Stakeholder workshops</p>`);
  d.raw(`</div></div><div style="flex:1;padding:0 0 0 22pt">`);
  d.h(1, "Priya Raman", "margin-bottom:0");
  d.p("Senior Data Analyst", "font-size:13pt;color:#486581");
  d.h(2, "Experience");
  d.h(3, "Lead Analyst, Copperline Logistics (2022 to 2026)");
  d.list("bullet", ["Cut weekly reporting time from two days to three hours with a shared data model.", "Led a four-person team that forecast regional demand within 6 percent.", "Introduced quarterly review sessions with operations managers."]);
  d.h(3, "Analyst, Tidewater Retail (2018 to 2022)");
  d.list("bullet", ["Built the first store-level margin dashboard used by 40 managers.", "Automated month-end reconciliation across three ledgers."]);
  d.h(2, "Education");
  d.p("B.S. Statistics, University of Northfield, 2018");
  d.raw("</div></div>");
  await chromePdf(d);
};

// 5 ---------------------------------------------------------------------------------------------
docs["gov-form"] = async () => {
  const d = new Doc("gov-form", "form", "Government-style form: labelled boxes and drawn checkboxes (no AcroForm)");
  d.t.order = true;
  d.t.fonts = ["Arial"];
  d.h(1, "Application for Temporary Use of Public Land", "font-size:18pt");
  d.p("Form PL-204 (Rev. 03/2026). Print clearly in black ink. Fields marked * are required.", "font-size:9pt;color:#444");
  const S = (text: string): TruthCell => ({ text, shaded: true, cs: 2 });
  const rows: TruthCell[][] = [
    [S("Section 1. Applicant")],
    [{ text: "1a. Full legal name *" }, { text: "" }],
    [{ text: "1b. Mailing address *" }, { text: "" }],
    [{ text: "1c. Daytime telephone" }, { text: "" }],
    [S("Section 2. Proposed use")],
    [{ text: "2a. Parcel number *" }, { text: "" }],
    [{ text: "2b. Start date *" }, { text: "" }],
    [{ text: "2c. Description of activity *" }, { text: "" }],
  ];
  d.table(rows, "width:100%;margin-top:10pt", "border:1.2px solid #000;padding:8pt");
  d.say("Type of applicant", "Individual", "Business", "Non-profit organisation");
  d.raw(`<h3 style="margin-top:14pt">Type of applicant</h3><div style="display:flex;gap:24pt">`);
  for (const l of ["Individual", "Business", "Non-profit organisation"]) d.raw(`<div style="display:flex;align-items:center;gap:6pt"><span style="display:inline-block;width:12pt;height:12pt;border:1.2px solid #000"></span>${l}</div>`);
  d.raw("</div>");
  d.p("I declare that the information given is true and complete. Signature of applicant and date:", "margin-top:18pt");
  d.raw(`<div style="border-bottom:1px solid #000;height:30pt;width:60%"></div>`);
  await chromePdf(d, "td:first-child{width:2.4in}td{height:26pt}");
};

// 6 ---------------------------------------------------------------------------------------------
docs["gov-form-acro"] = async () => {
  const t: RealTruth = {
    name: "gov-form-acro",
    category: "form",
    description: "Fillable AcroForm (pdf-lib) with text fields and checkboxes",
    paragraphs: ["Vehicle Registration Renewal", "Registered owner", "Licence plate", "Odometer reading", "Mailing address", "Insurance verified", "Emissions test passed", "Change of address"],
    order: true,
    headings: [{ text: "Vehicle Registration Renewal", level: 1 }],
    formFields: [{ type: "text", name: "owner" }, { type: "text", name: "plate" }, { type: "text", name: "odometer" }, { type: "text", name: "address" }, { type: "checkbox", name: "insurance" }, { type: "checkbox", name: "emissions" }, { type: "checkbox", name: "coa" }],
    pages: 1,
  };
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  const form = pdf.getForm();
  page.drawRectangle({ x: 0, y: 730, width: 612, height: 62, color: rgb(0.12, 0.3, 0.5) });
  page.drawText("Vehicle Registration Renewal", { x: 54, y: 752, size: 22, font: bold, color: rgb(1, 1, 1) });
  const fields: [string, string, number][] = [["Registered owner", "owner", 670], ["Licence plate", "plate", 620], ["Odometer reading", "odometer", 570], ["Mailing address", "address", 520]];
  for (const [label, name, y] of fields) {
    page.drawText(label, { x: 54, y: y + 6, size: 11, font });
    form.createTextField(name).addToPage(page, { x: 200, y, width: 300, height: 22, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1 });
  }
  const boxes: [string, string, number][] = [["Insurance verified", "insurance", 460], ["Emissions test passed", "emissions", 430], ["Change of address", "coa", 400]];
  for (const [label, name, y] of boxes) {
    page.drawText(label, { x: 80, y: y + 4, size: 11, font });
    form.createCheckBox(name).addToPage(page, { x: 54, y, width: 16, height: 16, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1 });
  }
  await finish(t, await pdf.save());
};

// 7 ---------------------------------------------------------------------------------------------
docs["slides"] = async () => {
  const d = new Doc("slides", "slides", "Landscape slides: big titles, bullets, shape diagram");
  d.t.order = true;
  d.t.fonts = ["Arial"];
  const css = `@page{size:13.333in 7.5in;margin:0}body{font:20pt Arial}.s{width:13.333in;height:7.5in;padding:0.8in 1in;break-after:page;overflow:hidden}.s h1{font-size:44pt;margin:0 0 26pt}.s li{font-size:24pt;margin-bottom:14pt}`;
  d.raw(`<div class="s" style="background:#0b3d5c;color:#fff;display:flex;flex-direction:column;justify-content:center">`);
  d.h(1, "Q3 Product Review", "font-size:60pt");
  d.p("Meridian Labs - Platform Team", "font-size:24pt;color:#9fd3ff");
  d.raw("</div>");
  d.raw(`<div class="s">`);
  d.h(1, "What shipped this quarter");
  d.list("bullet", ["Faster onboarding flow, median setup time down to four minutes", "Offline mode for the mobile app", "Audit log export for enterprise admins"]);
  d.raw("</div>");
  d.raw(`<div class="s">`);
  d.h(1, "How a request flows");
  d.raw(`<svg width="1000" height="200" viewBox="0 0 1000 200"><rect x="10" y="50" width="220" height="100" rx="12" fill="#2e75b6"/><rect x="390" y="50" width="220" height="100" rx="12" fill="#548235"/><rect x="770" y="50" width="220" height="100" rx="12" fill="#c55a11"/><path d="M230 100H390M610 100H770" stroke="#333" stroke-width="5"/><circle cx="500" cy="170" r="14" fill="#7030a0"/></svg>`);
  d.say("Client", "Gateway", "Worker");
  d.raw(`<div style="display:flex;justify-content:space-between;width:1000px;font-size:22pt;margin-top:-100px;position:relative;top:-70px;padding:0 70px"><span>Client</span><span>Gateway</span><span>Worker</span></div>`);
  d.raw("</div>");
  await chromePdf(d, css);
};

// 8 ---------------------------------------------------------------------------------------------
docs["letter"] = async () => {
  const r = rng(8);
  const d = new Doc("letter", "letter", "Business letter with sender block, date, recipient, bold subject and signature");
  d.t.order = true;
  d.t.fonts = ["Georgia"];
  const css = "body{font:12pt/1.45 Georgia,serif}p{margin:0 0 10pt}";
  d.p("Halvorsen & Pike Architects", "font-weight:700;font-size:15pt;margin:0");
  d.p("1200 Mill Race Lane, Suite 4, Madison, WI 53703", "margin:0 0 22pt;color:#555");
  d.p("14 September 2026", "margin-bottom:16pt");
  d.p("Ms. Odalys Moreno", "margin:0");
  d.p("Director of Facilities, Eastgate School District", "margin:0");
  d.p("77 Cedar Court, Madison, WI 53704", "margin-bottom:16pt");
  d.rich([{ text: "Re: Proposal for the library roof replacement", b: true }], "margin-bottom:12pt");
  d.p("Dear Ms. Moreno,");
  for (let i = 0; i < 4; i++) d.p(para(r, 62), "text-align:justify");
  d.p("Sincerely,", "margin-top:14pt");
  d.p("Jonas Halvorsen", "margin-top:30pt;font-style:italic");
  d.p("Principal Architect", "margin:0");
  await chromePdf(d, css);
};

// 9 ---------------------------------------------------------------------------------------------
docs["newsletter"] = async () => {
  const r = rng(9);
  const d = new Doc("newsletter", "newsletter", "Three-column newsletter with pull quote and two images");
  d.t.columns = 3;
  d.t.fonts = ["Georgia"];
  d.t.images = { count: 2, labels: [] };
  const css = "body{font:9.5pt/1.35 Georgia,serif}h1{font-size:34pt;text-align:center;border-bottom:3px double #000;padding-bottom:6pt}h2{font-size:12pt;margin:8pt 0 3pt}.c{column-count:3;column-gap:0.25in}.q{font-size:15pt;font-style:italic;border-top:2px solid #b00;border-bottom:2px solid #b00;padding:6pt 0;margin:8pt 0;break-inside:avoid}figure{margin:6pt 0;break-inside:avoid}figcaption{font-size:8pt;color:#555}p{text-align:justify}";
  d.h(1, "The Maple Street Courier");
  d.p("Volume 12 - Autumn edition - A neighbourhood publication", "text-align:center;font-size:9pt;color:#555");
  d.raw(`<div class="c">`);
  d.h(2, "Orchard day returns");
  d.p(para(r, 70));
  d.raw(`<figure><img src="${picUrl(1, 260, 160)}" style="width:100%">`);
  d.p("Volunteers sorting apples at last year's event.", "font-size:8pt;color:#555;margin:0");
  d.raw("</figure>");
  d.p(para(r, 60));
  d.raw(`<div class="q">`);
  d.say("Every harvest begins with someone willing to carry the first crate.");
  d.raw("Every harvest begins with someone willing to carry the first crate.</div>");
  d.h(2, "Library hours change");
  d.p(para(r, 80));
  d.h(2, "Road works update");
  d.p(para(r, 75));
  d.raw(`<figure><img src="${picUrl(3, 260, 160)}" style="width:100%">`);
  d.p("The new crossing on Elm Avenue.", "font-size:8pt;color:#555;margin:0");
  d.raw("</figure>");
  d.h(2, "Garden club notes");
  d.p(para(r, 80));
  d.p(para(r, 60));
  d.raw("</div>");
  await chromePdf(d, css);
};

// 10 --------------------------------------------------------------------------------------------
docs["receipt"] = async () => {
  const d = new Doc("receipt", "receipt", "Narrow thermal-style receipt in monospace");
  d.t.order = true;
  d.t.fonts = ["Courier New"];
  const css = "@page{size:80mm 190mm;margin:5mm}body{font:9pt/1.35 'Courier New',monospace}.l{display:flex;justify-content:space-between}hr{border:0;border-top:1px dashed #000}";
  d.p("GREEN APRON MARKET", "text-align:center;font-weight:700;font-size:11pt;margin:0");
  d.p("55 Linden Ave, Ithaca NY", "text-align:center;margin:0");
  d.p("Tel 555-0176   03/14/2026 10:42", "text-align:center;margin:0 0 6pt");
  d.raw("<hr>");
  const items: [string, string][] = [["Oat milk 1L", "3.49"], ["Sourdough loaf", "5.25"], ["Free-range eggs 12", "4.80"], ["Bananas 1.2kg", "1.56"], ["Olive oil 500ml", "9.99"], ["Dark chocolate", "3.20"]];
  for (const [n, p] of items) {
    d.raw(`<div class="l"><span>${esc(n)}</span><span>${p}</span></div>`);
    d.say(`${n} ${p}`);
  }
  d.raw("<hr>");
  for (const [n, p] of [["SUBTOTAL", "28.29"], ["TAX 4%", "1.13"], ["TOTAL", "29.42"], ["VISA ****8841", "29.42"]] as const) {
    d.raw(`<div class="l"><span>${n}</span><span>${p}</span></div>`);
    d.say(`${n} ${p}`);
  }
  d.raw("<hr>");
  d.p("THANK YOU FOR SHOPPING WITH US", "text-align:center;margin:6pt 0 0");
  await chromePdf(d, css);
};

// 11 --------------------------------------------------------------------------------------------
docs["report-chart"] = async () => {
  const r = rng(11);
  const d = new Doc("report-chart", "report", "Report with a vector bar chart and caption");
  d.t.order = true;
  d.t.fonts = ["Arial"];
  d.h(1, "Regional Sales Review");
  d.p(para(r, 70));
  d.h(2, "Quarterly revenue");
  const vals = [42, 58, 51, 73];
  const bars = vals.map((v, i) => `<rect x="${70 + i * 90}" y="${200 - v * 2.2}" width="56" height="${v * 2.2}" fill="${["#2e75b6", "#548235", "#c55a11", "#7030a0"][i]}"/><text x="${98 + i * 90}" y="220" font-size="12" text-anchor="middle" font-family="Arial">Q${i + 1}</text><text x="${98 + i * 90}" y="${192 - v * 2.2}" font-size="12" text-anchor="middle" font-family="Arial">${v}</text>`).join("");
  d.raw(`<svg width="440" height="240" viewBox="0 0 440 240" style="display:block;margin:6pt auto"><line x1="55" y1="20" x2="55" y2="200" stroke="#333"/><line x1="55" y1="200" x2="430" y2="200" stroke="#333"/><text x="12" y="30" font-size="11" font-family="Arial">Sales (k)</text>${bars}</svg>`);
  d.say("Sales (k)", "Q1 42 Q2 58 Q3 51 Q4 73");
  d.p("Figure 1: Revenue by quarter, in thousands of dollars.", "text-align:center;font-size:9pt;color:#555");
  d.p(para(r, 70));
  d.p(para(r, 55));
  await chromePdf(d);
};

// 12 --------------------------------------------------------------------------------------------
docs["latex-cff"] = async () => {
  const r = rng(12);
  const d = new Doc("latex-cff", "typeset", "LaTeX-like page set in Source Serif 4 (OFL, OTF/CFF outlines) so a CFF font gets embedded");
  d.t.order = true;
  d.t.fonts = ["SourceSerif4"];
  const font = (f: string, w: number) => `@font-face{font-family:'Source Serif 4';font-weight:${w};src:url(data:font/otf;base64,${readFileSync(join(DIR, "assets", f)).toString("base64")})}`;
  const css = `${font("SourceSerif4-Regular.otf", 400)}${font("SourceSerif4-Semibold.otf", 700)}body{font:11pt/1.38 'Source Serif 4',serif}@page{margin:1in 1.15in}h1{font-size:20pt;text-align:center;margin:0}h2{font-size:13pt}p{text-align:justify;hyphens:auto;margin:0 0 7pt}`;
  d.h(1, "On the Stability of Iterated Averaging");
  d.p("Mirela Vasquez and Daniel Okoye", "text-align:center;margin:8pt 0 16pt");
  d.rich([{ text: "Abstract. ", b: true }, { text: "We study repeated local averaging on a ring of agents and bound the rate at which disagreement vanishes. " + para(r, 30) }], "margin:0 0.4in 12pt;font-size:10pt");
  d.h(2, "1 Introduction");
  d.p(para(r, 85));
  d.p(para(r, 75));
  d.h(2, "2 Main result");
  d.rich([{ text: "Theorem 1. ", b: true }, { text: "For every n at least 3, the spectral gap satisfies gap(n) >= 1 - cos(2*pi/n)." }]);
  d.p("x(t+1) = W x(t), with W = (I + P) / 2 (2)", "text-align:center;font-style:italic");
  d.p(para(r, 85));
  d.p(para(r, 60));
  await chromePdf(d, css);
};

// 13 --------------------------------------------------------------------------------------------
docs["scanned-letter"] = async () => {
  const r = rng(13);
  const d = new Doc("scanned-letter", "scan", "Two rasterised letter pages, slight skew, JPEG: text exists only in the picture");
  d.t.scanned = true;
  d.t.order = true;
  const pagesHtml: string[] = [];
  const mk = (build: (p: Doc) => void) => {
    const p = new Doc("tmp", "", "");
    build(p);
    d.t.paragraphs.push(...p.t.paragraphs);
    pagesHtml.push(p.html);
  };
  mk((p) => {
    p.p("Calloway Water Authority", "font-weight:700;font-size:15pt;margin:0");
    p.p("Customer Services, 8 Reservoir Road", "margin:0 0 20pt");
    p.p("Notice of scheduled maintenance", "font-weight:700");
    p.p("Dear customer,");
    p.p(para(r, 70));
    p.p(para(r, 60));
  });
  mk((p) => {
    p.p(para(r, 70));
    p.p(para(r, 55));
    p.p("Yours faithfully,", "margin-top:14pt");
    p.p("Customer Services Team");
  });
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pagesHtml.length; i++) {
    const htmlPath = join(tmpdir(), `p2w-real-scan${i}.html`);
    const pngPath = join(tmpdir(), `p2w-real-scan${i}.png`);
    writeFileSync(htmlPath, `<!doctype html><meta charset=utf-8><style>${BASE_CSS}@page{margin:0}body{font:12pt/1.45 'Times New Roman',serif;width:8.5in;height:11in;padding:1in;background:#fdfcf8}</style><body>${pagesHtml[i]}</body>`);
    await chrome([`--screenshot=${pngPath}`, "--window-size=816,1056", "--force-device-scale-factor=2", "file://" + htmlPath]);
    const jpg = await sharp(readFileSync(pngPath)).rotate(i === 0 ? 1.1 : -0.8, { background: "#e9e7e1" }).resize(1250).greyscale().blur(0.5).jpeg({ quality: 62 }).toBuffer();
    const img = await pdf.embedJpg(jpg);
    const page = pdf.addPage([612, 792]);
    page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
    rmSync(htmlPath);
    rmSync(pngPath);
  }
  await finish(d.t, await pdf.save());
};

// 14 --------------------------------------------------------------------------------------------
docs["rtl"] = async () => {
  const d = new Doc("rtl", "rtl", "Arabic and Hebrew paragraphs under an English heading");
  d.t.charMode = true;
  d.h(1, "Multilingual notice");
  d.p("مرحبا بكم في مكتبة المدينة المركزية. تفتح المكتبة أبوابها من الأحد إلى الخميس، من الساعة التاسعة صباحا حتى الخامسة مساء. يرجى إحضار بطاقة العضوية عند الاستعارة.", "direction:rtl;text-align:right;font-size:14pt;line-height:1.8");
  d.p("ברוכים הבאים לספרייה המרכזית של העיר. הספרייה פתוחה בימים ראשון עד חמישי, בין השעות תשע בבוקר עד חמש אחר הצהריים. נא להביא כרטיס חבר בעת ההשאלה.", "direction:rtl;text-align:right;font-size:14pt;line-height:1.8");
  d.p("English summary: the central library is open Sunday to Thursday, nine to five.");
  await chromePdf(d);
};

// 15 --------------------------------------------------------------------------------------------
docs["cjk"] = async () => {
  const d = new Doc("cjk", "cjk", "Simplified Chinese and Japanese paragraphs");
  d.t.charMode = true;
  d.h(1, "地区图书馆通知");
  d.p("欢迎来到市中心图书馆。图书馆每周一至周六上午九点开放，下午六点关闭。借阅图书时请出示读者证，逾期归还需要缴纳少量滞纳金。", "font-size:13pt;line-height:1.8");
  d.p("図書館からのお知らせです。開館時間は月曜日から土曜日の午前九時から午後六時までです。本を借りるときは、利用者カードをご提示ください。", "font-size:13pt;line-height:1.8");
  d.p("Library notice in English: open Monday to Saturday, nine to six.");
  await chromePdf(d, "body{font-family:'PingFang SC','Hiragino Sans',Arial,sans-serif}");
};

// 16 --------------------------------------------------------------------------------------------
docs["annotations"] = async () => {
  const body = ["Project Brief: Community Garden", "The garden will occupy the vacant lot beside the library.", "Beds will be built from reclaimed timber donated by local mills.", "Volunteers meet on the first Saturday of each month.", "The budget request is 4,800 dollars for soil, seeds and tools."];
  const comments = ["Check with the council about water access.", "Can we confirm the timber donor list by May?"];
  const t: RealTruth = { name: "annotations", category: "annotated", description: "Text page with sticky notes and a highlight (PDF annotations)", paragraphs: body, order: true, headings: [{ text: body[0], level: 1 }], comments, fonts: ["Helvetica"], pages: 1 };
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  page.drawText(body[0], { x: 72, y: 700, size: 22, font: bold });
  const ys = [650, 625, 600, 575];
  body.slice(1).forEach((line, i) => page.drawText(line, { x: 72, y: ys[i], size: 12, font }));
  const ctx = pdf.context;
  const annot = (o: Record<string, unknown>) => ctx.register(ctx.obj(o as never));
  const refs = [
    annot({ Type: "Annot", Subtype: "Text", Rect: [420, 640, 440, 660], Contents: PDFString.of(comments[0]), T: PDFString.of("Reviewer A"), Name: PDFName.of("Comment"), C: [1, 0.9, 0] }),
    annot({ Type: "Annot", Subtype: "Highlight", Rect: [72, 596, 400, 614], QuadPoints: [72, 614, 400, 614, 72, 596, 400, 596], C: [1, 1, 0], Contents: PDFString.of(comments[1]), T: PDFString.of("Reviewer B") }),
  ];
  page.node.set(PDFName.of("Annots"), ctx.obj(refs));
  await finish(t, await pdf.save());
};

// 17 --------------------------------------------------------------------------------------------
docs["spreadsheet"] = async () => {
  const r = rng(17);
  const d = new Doc("spreadsheet", "spreadsheet", "Wide, table-heavy landscape export with gridlines");
  d.t.fonts = ["Arial"];
  const H = (text: string): TruthCell => ({ text, shaded: true });
  const regions = ["North", "South", "East", "West", "Central"];
  const rows: TruthCell[][] = [["Region", "Rep", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Total"].map(H)];
  const reps = ["A. Nolan", "B. Sato", "C. Mbeki", "D. Alvarez", "E. Kowalski", "F. Hart", "G. Ivanova", "H. Chen"];
  let k = 0;
  for (const reg of regions)
    for (let i = 0; i < 6; i++) {
      const v = Array.from({ length: 6 }, () => 800 + Math.floor(r() * 9000));
      rows.push([reg, reps[(k++ + i) % reps.length], ...v.map(String), String(v.reduce((a, b) => a + b, 0))].map((text) => ({ text })));
    }
  d.h(1, "Sales by representative, H1 2026", "font-size:16pt");
  d.table(rows, "width:100%;font-size:8.5pt", "border:1px solid #888;padding:3pt 6pt");
  await chromePdf(d, "@page{size:Letter landscape;margin:0.6in}td:nth-child(n+3){text-align:right}");
};

// 18 --------------------------------------------------------------------------------------------
docs["contract"] = async () => {
  const r = rng(18);
  const d = new Doc("contract", "contract", "Numbered clauses, nested numbered list, bold defined terms, running footer");
  d.t.order = true;
  d.t.footer = "Service Agreement - Confidential";
  d.t.pageNumbers = true;
  d.t.fonts = ["Times New Roman"];
  const css = "body{font:11pt/1.45 'Times New Roman',serif}h1{text-align:center;font-size:17pt}p{text-align:justify}@page{margin:1in}";
  d.h(1, "SERVICE AGREEMENT");
  d.rich([{ text: "This Agreement is made between " }, { text: "Larkspur Analytics Ltd", b: true }, { text: " (the " }, { text: "Provider", b: true }, { text: ") and " }, { text: "Stonebridge Dental Group", b: true }, { text: " (the " }, { text: "Client", b: true }, { text: ")." }]);
  for (const [i, title] of ["Definitions", "Services", "Fees and payment", "Confidentiality", "Term and termination"].entries()) {
    d.h(2, `${i + 1}. ${title}`);
    d.p(para(r, 55));
    if (i === 1) d.list("number", ["Monthly data quality report delivered by the fifth working day.", "Quarterly review meeting with the Client's practice managers.", "Email support during business hours with a one-day response target."], "list-style:lower-alpha");
  }
  d.p(para(r, 40), "margin-top:12pt");
  const bytes = await htmlToPdf(d, css);
  // footer only (no header): stamp with an empty header string.
  await finish(d.t, await stamp(bytes, "", d.t.footer!, false));
};

// 19 --------------------------------------------------------------------------------------------
docs["brochure"] = async () => {
  const r = rng(19);
  const d = new Doc("brochure", "brochure", "Marketing brochure: hero image, headings, bullet list, borderless price table");
  d.t.fonts = ["Georgia"];
  d.t.images = { count: 1, labels: [] };
  const css = "body{font:11pt/1.45 Georgia,serif}h1{font-size:30pt;color:#7a2e0e}h2{font-size:16pt;color:#7a2e0e}";
  d.raw(`<img src="${picUrl(4, 640, 220)}" style="width:100%;height:2.2in;object-fit:cover;margin-bottom:12pt">`);
  d.h(1, "Cedar Hollow Retreat");
  d.p(para(r, 50), "font-style:italic");
  d.h(2, "What is included");
  d.list("bullet", ["Private cabin with woodstove and lake view", "Breakfast baskets delivered each morning", "Guided sunrise hike on Saturdays", "Canoe and paddle hire"]);
  d.h(2, "Seasonal rates");
  d.table([[{ text: "Spring (Apr - Jun)" }, { text: "$180 per night" }], [{ text: "Summer (Jul - Aug)" }, { text: "$240 per night" }], [{ text: "Autumn (Sep - Nov)" }, { text: "$200 per night" }], [{ text: "Winter (Dec - Mar)" }, { text: "$150 per night" }]], "width:70%", "padding:3pt 10pt");
  d.p("Book at example.com/cedarhollow or call 555-0139.", "margin-top:14pt;font-weight:700");
  await chromePdf(d, css);
};

// 20 --------------------------------------------------------------------------------------------
docs["memo-pdflib"] = async () => {
  const r = rng(20);
  const t: RealTruth = { name: "memo-pdflib", category: "memo", description: "Memo drawn with pdf-lib standard fonts: heading, wrapped paragraphs, drawn-bullet list", paragraphs: [], order: true, headings: [], lists: [], fonts: ["Helvetica", "Times-Roman"], pages: 1 };
  const pdf = await PDFDocument.create();
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const page: PDFPage = pdf.addPage([612, 792]);
  const wrap = (s: string, f: PDFFont, size: number, width: number) => {
    const lines: string[] = [];
    let cur = "";
    for (const w of s.split(" ")) {
      const next = cur ? cur + " " + w : w;
      if (f.widthOfTextAtSize(next, size) > width) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    return [...lines, cur];
  };
  let y = 710;
  page.drawText("MEMORANDUM", { x: 72, y, size: 24, font: sansB });
  t.paragraphs.push("MEMORANDUM");
  t.headings!.push({ text: "MEMORANDUM", level: 1 });
  y -= 30;
  for (const [k, v] of [["To:", "All field staff"], ["From:", "Operations"], ["Date:", "9 October 2026"]]) {
    page.drawText(k, { x: 72, y, size: 11, font: sansB });
    page.drawText(v, { x: 120, y, size: 11, font: sans });
    t.paragraphs.push(`${k} ${v}`);
    y -= 16;
  }
  y -= 14;
  const body = para(r, 70);
  t.paragraphs.push(body);
  for (const l of wrap(body, serif, 12, 468)) {
    page.drawText(l, { x: 72, y, size: 12, font: serif });
    y -= 16;
  }
  y -= 10;
  page.drawText("Action items", { x: 72, y, size: 15, font: sansB });
  t.paragraphs.push("Action items");
  t.headings!.push({ text: "Action items", level: 2 });
  y -= 24;
  const items = ["Return all loaner radios to the depot by Friday", "Submit mileage logs through the new portal", "Complete the winter safety module"];
  for (const it of items) {
    page.drawText("•", { x: 80, y, size: 12, font: serif });
    page.drawText(it, { x: 98, y, size: 12, font: serif });
    y -= 18;
  }
  t.paragraphs.push(...items);
  t.lists!.push({ type: "bullet", items });
  await finish(t, await pdf.save());
};

for (const [name, make] of Object.entries(docs)) {
  if (ONLY && !ONLY.includes(name)) continue;
  if (!FORCE && !ONLY && existsSync(join(OUT, name + ".pdf")) && existsSync(join(OUT, name + ".truth.json"))) continue;
  console.log("generating", name);
  await make();
}
console.log("done");

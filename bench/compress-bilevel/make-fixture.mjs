// Builds a synthetic scanned-style PDF (no personal documents): text rendered to 300 DPI grayscale page images.
// Usage: bun bench/compress-bilevel/make-fixture.mjs [outDir]  -> scan.pdf (+ scan-truth.json with the text per page)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { PDFDocument } from "@cantoo/pdf-lib";

const out = process.argv[2] ?? "bench/compress-bilevel/out";
mkdirSync(out, { recursive: true });
const W = 2550;
const H = 3300;

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const WORDS = (
  "the of and to in is that for it as was with be by on not he this are or his from at which but have an had they you were their one all we can her has there been if more when will would who so no " +
  "agreement section party shall tenant landlord premises payment monthly notice written deposit amount period lease term property " +
  "report quarterly revenue increased customers regional manager review summary appendix schedule invoice account balance"
).split(" ");
const sentence = () => {
  const n = 8 + Math.floor(rnd() * 8);
  const w = Array.from({ length: n }, () => WORDS[Math.floor(rnd() * WORDS.length)]);
  w[0] = w[0][0].toUpperCase() + w[0].slice(1);
  return w.join(" ") + ".";
};
function wrap(text, max) {
  const lines = [];
  let cur = "";
  for (const w of text.split(" ")) {
    if ((cur + " " + w).length > max) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function textPage(title, { lines = 52, fontSize = 44, top = 260, left = 260, maxChars = 62 } = {}) {
  const all = [];
  while (all.length < lines) {
    const p = Array.from({ length: 3 + Math.floor(rnd() * 3) }, sentence).join(" ");
    all.push(...wrap(p, maxChars), "");
  }
  const body = all.slice(0, lines);
  const svgLines = body
    .map((l, i) => `<text x="${left}" y="${top + 100 + i * 56}" font-size="${fontSize}" font-family="Times New Roman, Times, serif" fill="#111">${esc(l)}</text>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#fff"/><text x="${left}" y="${top}" font-size="64" font-weight="bold" font-family="Helvetica, Arial, sans-serif" fill="#000">${esc(title)}</text>${svgLines}</svg>`;
  return { svg, text: [title, ...body.filter(Boolean)].join("\n") };
}

const gray = (svg) => sharp(Buffer.from(svg)).removeAlpha().greyscale().raw().toBuffer();

/** Scanner-ish: paper tint with noise, ink not quite black, optional light-grey speckles. */
function scanify(buf, { paper = 252, jitter = 2, speckle = 0, speckleLevel = 215 } = {}) {
  const o = Buffer.from(buf);
  for (let i = 0; i < o.length; i++) {
    const p = paper + (rnd() - 0.5) * 2 * jitter;
    const ink = 25 + rnd() * 20;
    o[i] = Math.max(0, Math.min(255, Math.round(ink + (p - ink) * (o[i] / 255))));
  }
  for (let k = 0; k < speckle; k++) {
    const x = Math.floor(rnd() * W);
    const y = Math.floor(rnd() * H);
    const r = 1 + Math.floor(rnd() * 3);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r && x + dx >= 0 && x + dx < W && y + dy >= 0 && y + dy < H) {
          const idx = (y + dy) * W + x + dx;
          o[idx] = Math.min(o[idx], speckleLevel - Math.floor(rnd() * 25));
        }
      }
  }
  return o;
}
const blur = (buf) => sharp(buf, { raw: { width: W, height: H, channels: 1 } }).blur(0.8).toColourspace("b-w").raw().toBuffer();

function photoRegion(buf, x0, y0, w, h) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = x / w;
      const ny = y / h;
      const v =
        120 + 70 * Math.sin(nx * 6) * Math.cos(ny * 5) + 40 * Math.sin((nx + ny) * 14) + (rnd() - 0.5) * 30 +
        60 * Math.exp(-(((nx - 0.6) ** 2 + (ny - 0.4) ** 2) / 0.04));
      buf[(y0 + y) * W + x0 + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
}
/** 1-bit packed, 1 = white, rows padded to whole bytes. */
function toOneBit(buf, thr = 140) {
  const rb = Math.ceil(W / 8);
  const o = Buffer.alloc(rb * H, 0);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (buf[y * W + x] >= thr) o[y * rb + (x >> 3)] |= 0x80 >> (x & 7);
  return o;
}

const pages = [];
const truth = [];
const add = (kind, buf, text) => {
  pages.push({ kind, buf });
  truth.push(text);
};
const t1 = textPage("Residential Lease Agreement");
add("gray", await blur(scanify(await gray(t1.svg))), t1.text);
const t2 = textPage("Quarterly Operations Report", { fontSize: 38, lines: 58, maxChars: 74 });
add("gray", await blur(scanify(await gray(t2.svg), { paper: 246, jitter: 4 })), t2.text);
const t3 = textPage("Field Inspection Photos", { lines: 22 });
const g3 = await blur(scanify(await gray(t3.svg)));
photoRegion(g3, 260, 1500, 2030, 1400);
add("gray", g3, t3.text);
const t4 = textPage("Archived Correspondence", { lines: 50 });
add("gray", await blur(scanify(await gray(t4.svg), { paper: 250, jitter: 3, speckle: 900 })), t4.text);
const t5 = textPage("Certificate of Completion", { lines: 40, fontSize: 52, maxChars: 52 });
add("bilevel", toOneBit(await blur(scanify(await gray(t5.svg)))), t5.text);

const doc = await PDFDocument.create();
for (const p of pages) {
  const page = doc.addPage([612, 792]);
  const stream = doc.context.flateStream(p.buf, {
    Type: "XObject",
    Subtype: "Image",
    Width: W,
    Height: H,
    ColorSpace: "DeviceGray",
    BitsPerComponent: p.kind === "bilevel" ? 1 : 8,
  });
  const ref = doc.context.register(stream);
  page.node.Resources().set(doc.context.obj("XObject"), doc.context.obj({ Im0: ref }));
  page.node.addContentStream(doc.context.register(doc.context.flateStream(Buffer.from("q 612 0 0 792 0 0 cm /Im0 Do Q"))));
}
writeFileSync(join(out, "scan.pdf"), await doc.save());
writeFileSync(join(out, "scan-truth.json"), JSON.stringify(truth, null, 1));
console.log("wrote", join(out, "scan.pdf"));

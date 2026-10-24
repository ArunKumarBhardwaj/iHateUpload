// Builds combined PDFs from synthetic documents, with the page where each one starts written down,
// so Smart split can be scored. Bundles mix the shared corpus with three invoices from one supplier
// (same letterhead, told apart only by number and page count) and blank separator sheets.
// Each bundle also gets a "-scan" twin: every page a 150 dpi JPEG, no text layer, as a scanner makes it.
// Usage: node internal/benchmarks/smart-split/gen.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";

const here = new URL("./", import.meta.url).pathname;
const corpus = new URL("../pdf-to-word/realistic/corpus/", import.meta.url).pathname;
const fx = here + "fx/";
rmSync(fx, { recursive: true, force: true });
mkdirSync(fx + "docs", { recursive: true });

// Three invoices from one supplier. A: 2 pages, "Page 1 of 2". B: 1 page. C: 2 pages, no page numbers,
// page 2 headed "Invoice HP-1003 (continued)".
async function supplierInvoice(no, rows, pages, numbered) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const per = Math.ceil(rows.length / pages);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([612, 792]);
    page.drawRectangle({ x: 50, y: 735, width: 30, height: 30, color: rgb(0.1, 0.35, 0.6) });
    page.drawText("Harbor & Pine Office Supply", { x: 90, y: 750, size: 14, font: bold });
    page.drawText("22 Wharf Lane, Bristol BS1 4RR", { x: 90, y: 736, size: 9, font });
    if (p === 0) {
      page.drawText("INVOICE", { x: 50, y: 690, size: 22, font: bold });
      page.drawText(`Invoice No: ${no}`, { x: 50, y: 665, size: 11, font });
      page.drawText(`Bill to: Quayside Dental Practice`, { x: 50, y: 650, size: 11, font });
    } else page.drawText(`Invoice ${no} (continued)`, { x: 50, y: 690, size: 12, font: bold });
    let y = p === 0 ? 615 : 660;
    page.drawText("Item", { x: 50, y, size: 10, font: bold });
    page.drawText("Amount", { x: 480, y, size: 10, font: bold });
    for (const [item, amount] of rows.slice(p * per, (p + 1) * per)) {
      y -= 18;
      page.drawText(item, { x: 50, y, size: 10, font });
      page.drawText(amount, { x: 480, y, size: 10, font });
    }
    if (p === pages - 1) page.drawText("Total due within 30 days of the invoice date.", { x: 50, y: y - 40, size: 10, font });
    if (numbered) page.drawText(`Page ${p + 1} of ${pages}`, { x: 500, y: 40, size: 9, font });
    page.drawText("Harbor & Pine Office Supply - VAT GB 284 1182 07", { x: 50, y: 40, size: 8, font });
  }
  return doc.save();
}
const rows = (n, seed) => Array.from({ length: n }, (_, i) => [`Item ${seed}-${i + 1}: printer paper, toner and folders`, `£${(12.5 + ((i * 7 + seed) % 40)).toFixed(2)}`]);
writeFileSync(fx + "docs/hp-a.pdf", await supplierInvoice("HP-1001", rows(40, 1), 2, true));
writeFileSync(fx + "docs/hp-b.pdf", await supplierInvoice("HP-1002", rows(12, 2), 1, true));
writeFileSync(fx + "docs/hp-c.pdf", await supplierInvoice("HP-1003", rows(40, 3), 2, false));

const BUNDLES = {
  "office-mix": ["invoice", "letter", "contract", "receipt", "bank-statement"],
  "reports": ["memo-pdflib", "cv", "newsletter", "report-chart", "research-paper"],
  "same-supplier": ["hp-a", "hp-b", "hp-c", "letter"],
  "forms-and-slides": ["scanned-letter", "gov-form", "spreadsheet", "slides", "brochure"],
  "with-separators": ["contract", "BLANK", "bank-statement", "BLANK", "invoice", "BLANK", "cv"],
  "assorted": ["latex-cff", "annotations", "letter", "hp-b", "memo-pdflib", "receipt"],
};
// Second tuning set: drawn after a first round of tuning, then used to tune further.
const POOL = ["invoice", "letter", "contract", "receipt", "bank-statement", "memo-pdflib", "cv", "newsletter", "report-chart",
  "research-paper", "scanned-letter", "gov-form", "gov-form-acro", "spreadsheet", "slides", "brochure", "latex-cff", "annotations",
  "cjk", "rtl", "hp-a", "hp-b", "hp-c"];
let seed = 20261024;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
for (let b = 1; b <= 8; b++) {
  const pick = [...POOL].sort(() => rand() - 0.5).slice(0, 4 + Math.floor(rand() * 4));
  BUNDLES[`heldout-${b}`] = pick;
}
// Fresh: drawn after all tuning (the heldout-* set above was used for tuning too). Report these as the honest score.
seed = 4242;
for (let b = 1; b <= 10; b++) {
  const pick = [...POOL].sort(() => rand() - 0.5).slice(0, 4 + Math.floor(rand() * 4));
  if (b % 3 === 0) pick.splice(2, 0, "BLANK");
  BUNDLES[`fresh-${b}`] = pick;
}
const source = (name) => readFileSync(name.startsWith("hp-") ? `${fx}docs/${name}.pdf` : `${corpus}${name}.pdf`);
const truth = {};
for (const [bundle, parts] of Object.entries(BUNDLES)) {
  const out = await PDFDocument.create();
  const starts = [];
  const blanks = [];
  const docs = [];
  for (const part of parts) {
    if (part === "BLANK") {
      blanks.push(out.getPageCount());
      out.addPage([612, 792]);
      continue;
    }
    const src = await PDFDocument.load(source(part), { ignoreEncryption: true });
    starts.push(out.getPageCount());
    docs.push(part);
    for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
  }
  writeFileSync(`${fx}${bundle}.pdf`, await out.save());
  truth[bundle] = { pages: out.getPageCount(), starts, blanks, docs };

  // The scanned twin.
  const tmp = `${fx}tmp-${bundle}/`;
  mkdirSync(tmp, { recursive: true });
  execFileSync("swift", [here + "render-jpg.swift", `${fx}${bundle}.pdf`, tmp]);
  const scan = await PDFDocument.create();
  const sizes = out.getPages().map((p) => p.getSize());
  for (const [i, file] of readdirSync(tmp).sort().entries()) {
    const img = await scan.embedJpg(readFileSync(tmp + file));
    const { width, height } = sizes[i];
    scan.addPage([width, height]).drawImage(img, { x: 0, y: 0, width, height });
  }
  writeFileSync(`${fx}${bundle}-scan.pdf`, await scan.save());
  truth[`${bundle}-scan`] = truth[bundle];
  rmSync(tmp, { recursive: true });
  console.log(bundle, truth[bundle].pages, "pages, starts", starts.join(","));
}
writeFileSync(fx + "truth.json", JSON.stringify(truth, null, 1));

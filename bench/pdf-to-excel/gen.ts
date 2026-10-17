// Two extra synthetic documents with ground truth, for what the shared corpus does not cover:
//  ledger  one ruled table with a merged group header, IDs with leading zeros, negatives, percents, dates
//  orders  two tables on a page, the second (no rules) continuing on page 2 under a repeated header
// Usage: bun bench/pdf-to-excel/gen.ts   (writes ./corpus)
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";

import { makeLedgerPdf } from "../../src/lib/pdf-to-excel/testing";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "corpus");
mkdirSync(OUT, { recursive: true });

const cell = (text: string, extra: object = {}) => ({ text, ...extra });

// ledger: same document the unit tests use
writeFileSync(join(OUT, "ledger.pdf"), await makeLedgerPdf());
const ledgerRows = [
  [cell(""), cell(""), cell("Q1 results", { cs: 4 })],
  ["Code", "Region", "Units", "Revenue", "Change", "Date"].map((t) => cell(t)),
  ["00123", "North", "1,200", "$45,000.50", "12.5%", "2026-03-03"].map((t) => cell(t)),
  ["00456", "South", "(300)", "($1,200.00)", "-3.2%", "2026-03-04"].map((t) => cell(t)),
  ["00789", "East", "980", "$12,300.00", "4.8%", "2026-03-05"].map((t) => cell(t)),
];
writeFileSync(join(OUT, "ledger.truth.json"), JSON.stringify({ name: "ledger", tables: [{ rows: ledgerRows }] }, null, 1));

// orders
const doc = await PDFDocument.create();
const regular = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const ink = rgb(0, 0, 0);
const p1 = doc.addPage([612, 792]);
p1.drawText("Q1 Orders", { x: 54, y: 730, size: 18, font: bold });
const t1 = [
  ["SKU", "Product", "Qty", "Price"],
  ["0042", "Hex bolt M8", "120", "$0.35"],
  ["0107", "Washer 8mm", "800", "$0.04"],
  ["0233", "Anchor kit", "15", "$12.90"],
];
const xs1 = [54, 134, 314, 384, 464];
t1.forEach((row, r) => {
  const y = 700 - r * 22;
  p1.drawLine({ start: { x: xs1[0], y: y + 6 }, end: { x: xs1[4], y: y + 6 }, thickness: 0.8, color: ink });
  row.forEach((text, c) => p1.drawText(text, { x: xs1[c] + 4, y: y - 10, size: 11, font: r === 0 ? bold : regular }));
});
p1.drawLine({ start: { x: xs1[0], y: 700 - 4 * 22 + 6 }, end: { x: xs1[4], y: 700 - 4 * 22 + 6 }, thickness: 0.8, color: ink });
for (const x of xs1) p1.drawLine({ start: { x, y: 706 }, end: { x, y: 700 - 4 * 22 + 6 }, thickness: 0.8, color: ink });

p1.drawText("Open Invoices", { x: 54, y: 560, size: 18, font: bold });
const head = ["Invoice", "Customer", "Due", "Amount"];
const invoices = Array.from({ length: 36 }, (_, i) => [
  `INV-${1000 + i}`,
  ["Fernhill Bakery", "Quarry Cafe", "Alder Books", "Harbor Co"][i % 4],
  `2026-04-${String(1 + (i % 28)).padStart(2, "0")}`,
  `$${(120 + i * 37.5).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
]);
const colX = [54, 150, 330, 464];
const draw = (page: ReturnType<PDFDocument["addPage"]>, rows: string[][], y0: number, header: boolean) => {
  rows.forEach((row, r) => {
    const y = y0 - r * 18;
    row.forEach((text, c) => {
      const w = regular.widthOfTextAtSize(text, 10);
      const x = c === 3 ? colX[3] + 70 - w : colX[c];
      page.drawText(text, { x, y, size: 10, font: header && r === 0 ? bold : regular });
    });
  });
};
const firstPage = 21;
draw(p1, [head, ...invoices.slice(0, firstPage)], 535, true);
const p2 = doc.addPage([612, 792]);
draw(p2, [head, ...invoices.slice(firstPage)], 740, true);
writeFileSync(join(OUT, "orders.pdf"), await doc.save());
writeFileSync(
  join(OUT, "orders.truth.json"),
  JSON.stringify(
    {
      name: "orders",
      tables: [
        { rows: t1.map((row) => row.map((t) => cell(t))) },
        { rows: [head, ...invoices].map((row) => row.map((t) => cell(t))) },
      ],
    },
    null,
    1,
  ),
);
// parts: small type and letters and digits that scanners confuse (q/g, 0/O, 1/l, 5/S, 8/B)
const pd = await PDFDocument.create();
const pr = await pd.embedFont(StandardFonts.Helvetica);
const pb = await pd.embedFont(StandardFonts.HelveticaBold);
const pp = pd.addPage([612, 792]);
pp.drawText("Spare Parts", { x: 54, y: 730, size: 14, font: pb });
const partsRows = [
  ["Part", "Size", "Qty", "Price"],
  ["Oil filter", "12 qt", "1,508", "$1,058.05"],
  ["Hose clamp", "5 gal", "80", "$88.50"],
  ["Gasket kit", "16 oz", "505", "$5.55"],
  ["Brake fluid", "2 qt", "1,100", "$180.15"],
  ["Coolant", "10 gal", "65", "$1,615.00"],
  ["Grease tube", "8 oz", "3,005", "$2.95"],
  ["Wiper blade", "20 in", "118", "$16.80"],
  ["Spark plug", "1 lb", "950", "$8.05"],
];
const px = [54, 170, 290, 360];
partsRows.forEach((row, r) =>
  row.forEach((text, c) => {
    const font = r === 0 ? pb : pr;
    const w = font.widthOfTextAtSize(text, 8);
    pp.drawText(text, { x: c >= 2 ? px[c] + 60 - w : px[c], y: 700 - r * 13, size: 8, font });
  }),
);
writeFileSync(join(OUT, "parts.pdf"), await pd.save());
writeFileSync(join(OUT, "parts.truth.json"), JSON.stringify({ name: "parts", tables: [{ rows: partsRows.map((row) => row.map((t) => cell(t))) }] }, null, 1));

// Scanned versions: each page of a PDF rasterised at a modest resolution and put back as a picture (needs macOS swift).
const realistic = join(dirname(fileURLToPath(import.meta.url)), "../pdf-to-word/realistic");
async function scan(source: string, name: string, width: number, truth: string) {
  const tmp = join(OUT, ".scan");
  rmSync(tmp, { recursive: true, force: true });
  const run = spawnSync("swift", [join(realistic, "pdf2png.swift"), source, tmp, String(width)]);
  if (run.status !== 0) return console.log(`skipped ${name} (swift not available)`);
  const out = await PDFDocument.create();
  const pages = Number(/pages=(\d+)/.exec(String(run.stdout))?.[1] ?? 1);
  for (let i = 1; i <= pages; i++) {
    const img = await out.embedPng(readFileSync(join(tmp, `p${i}.png`)));
    out.addPage([612, 792]).drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  }
  writeFileSync(join(OUT, `${name}.pdf`), await out.save());
  copyFileSync(truth, join(OUT, `${name}.truth.json`));
  rmSync(tmp, { recursive: true, force: true });
}
await scan(join(realistic, "corpus/invoice.pdf"), "scan-invoice", 1700, join(realistic, "corpus/invoice.truth.json"));
await scan(join(OUT, "parts.pdf"), "scan-parts", 1100, join(OUT, "parts.truth.json"));
await scan(join(OUT, "orders.pdf"), "scan-orders", 1250, join(OUT, "orders.truth.json"));
console.log("wrote", OUT);

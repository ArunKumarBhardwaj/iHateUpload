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
// scan-invoice: the shared corpus invoice rasterised, so its table exists only as a picture (needs macOS swift)
{
  const corpus = join(dirname(fileURLToPath(import.meta.url)), "../pdf-to-word/realistic");
  const tmp = join(OUT, ".scan");
  const run = spawnSync("swift", [join(corpus, "pdf2png.swift"), join(corpus, "corpus/invoice.pdf"), tmp, "1700"]);
  if (run.status === 0) {
    const scan = await PDFDocument.create();
    const img = await scan.embedPng(readFileSync(join(tmp, "p1.png")));
    const page = scan.addPage([612, 792]);
    page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
    writeFileSync(join(OUT, "scan-invoice.pdf"), await scan.save());
    copyFileSync(join(corpus, "corpus/invoice.truth.json"), join(OUT, "scan-invoice.truth.json"));
    rmSync(tmp, { recursive: true, force: true });
  } else console.log("skipped scan-invoice (swift not available)");
}
console.log("wrote", OUT);

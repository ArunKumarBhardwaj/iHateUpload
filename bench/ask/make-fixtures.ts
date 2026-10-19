// Synthetic PDFs for the Ask PDF checks: bun bench/ask/make-fixtures.ts <outDir>
import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";

const out = process.argv[2] ?? "bench/ask/out";
mkdirSync(out, { recursive: true });
const docs: Record<string, string[][]> = {
  "invoice.pdf": [
    ["Invoice 4821", "Total due: 1290 dollars", "Payable within thirty days."],
    ["Page two", "Late fee: 5 percent per month."],
  ],
  "meeting.pdf": [["Meeting notes", "Tuesday afternoon, blue room.", "Action: Priya sends the budget."]],
  "scan-only.pdf": [[]],
};
for (const [name, pages] of Object.entries(docs)) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    lines.forEach((l, i) => page.drawText(l, { x: 60, y: 760 - i * 28, size: 16, font }));
  }
  writeFileSync(`${out}/${name}`, await doc.save());
}
console.log("wrote", Object.keys(docs).join(", "));

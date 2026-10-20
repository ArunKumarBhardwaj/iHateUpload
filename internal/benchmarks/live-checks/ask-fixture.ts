// A synthetic PDF with facts that cannot be guessed, for the live Ask PDF check.
import { writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const page = doc.addPage([595, 842]);
const lines = [
  "Project brief (synthetic test document)",
  "The project codename is BLUE HERON.",
  "The approved budget is 7,340 euros.",
  "The final deadline is 14 March 2027.",
  "The project lead is the fictional engineer Tamsin Ortolan.",
];
lines.forEach((l, i) => page.drawText(l, { x: 60, y: 760 - i * 28, size: i ? 13 : 18, font }));
writeFileSync(new URL("./fx/brief.pdf", import.meta.url).pathname, await doc.save());

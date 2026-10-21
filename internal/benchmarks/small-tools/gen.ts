// Synthetic fixtures: A (4 pages: fronts), B (4 pages: backs, in reverse like a duplex scan), C (2 pages).
// Each page carries its own label as selectable text, so order can be checked by extracting text.
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { mkdirSync, writeFileSync } from "node:fs";

const out = new URL("./fx/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

async function make(label: string, pages: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([300, 200]);
    p.drawText(`${label}${i}`, { x: 40, y: 100, size: 36, font });
  }
  return doc.save();
}

writeFileSync(out + "fronts.pdf", await make("F", 4));
// Back sides scanned in reverse order: B4 B3 B2 B1.
const backs = await PDFDocument.create();
const font = await backs.embedFont(StandardFonts.Helvetica);
for (const n of [4, 3, 2, 1]) backs.addPage([300, 200]).drawText(`B${n}`, { x: 40, y: 100, size: 36, font });
writeFileSync(out + "backs.pdf", await backs.save());
writeFileSync(out + "short.pdf", await make("S", 2));
console.log("fixtures in", out);

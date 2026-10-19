// Synthetic fixtures for the page tools. Usage: bun bench/page-tools/gen-fixtures.ts <outdir>
import { writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb, degrees } from "@cantoo/pdf-lib";
import { writeFileSync } from "node:fs";

const dir = process.argv[2] ?? "bench/page-tools/out";
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const sizes: [number, number][] = [
  [595, 842],
  [595, 842],
  [842, 595],
  [612, 792],
  [595, 842],
  [595, 842],
];
sizes.forEach(([w, h], i) => {
  const p = doc.addPage([w, h]);
  p.drawRectangle({
    x: 30,
    y: 30,
    width: w - 60,
    height: h - 60,
    borderColor: rgb(0.8, 0.1, 0.1),
    borderWidth: 3,
  });
  p.drawRectangle({ x: 60, y: h - 200, width: 150, height: 100, color: rgb(0.1, 0.3, 0.8) });
  p.drawText(`Page ${i + 1} synthetic text`, { x: 60, y: h - 80, size: 28, font });
});
doc.getPage(1).setRotation(degrees(90));
writeFileSync(`${dir}/six.pdf`, await doc.save());

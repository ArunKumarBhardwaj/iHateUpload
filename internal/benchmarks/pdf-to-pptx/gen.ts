// Synthetic slide-style PDF for the PDF to PowerPoint benchmark. Usage: bun internal/benchmarks/pdf-to-pptx/gen.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { makePng, makeSamplePdf } from "../../../src/lib/pdf-to-word/fixture";

const fx = new URL("./fx/", import.meta.url).pathname;
mkdirSync(fx, { recursive: true });

const doc = await PDFDocument.create();
const sans = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const W = 960, H = 540;
const navy = rgb(0.12, 0.2, 0.38), accent = rgb(0.85, 0.33, 0.18), grey = rgb(0.35, 0.35, 0.4);

// 1. Title slide
let p = doc.addPage([W, H]);
p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: navy });
p.drawRectangle({ x: 0, y: 200, width: W, height: 6, color: accent });
p.drawText("Northwind Field Survey", { x: 80, y: 300, size: 44, font: bold, color: rgb(1, 1, 1) });
p.drawText("Quarterly results, synthetic data", { x: 80, y: 250, size: 22, font: sans, color: rgb(0.85, 0.88, 0.95) });

// 2. Bullets with a picture
p = doc.addPage([W, H]);
p.drawText("What we found", { x: 60, y: 460, size: 32, font: bold, color: navy });
const bullets = ["Coverage grew in every region", "Response time fell by a third", "Two sites need new sensors", "Budget stayed inside the plan", "Next survey starts in March"];
bullets.forEach((b, i) => {
  p.drawCircle({ x: 72, y: 396 - i * 44, size: 4, color: accent });
  p.drawText(b, { x: 88, y: 390 - i * 44, size: 20, font: sans, color: grey });
});
const png = await doc.embedPng(makePng(64, 48, [60, 140, 200]));
p.drawImage(png, { x: 600, y: 160, width: 300, height: 225 });
p.drawText("Figure 1: site map (placeholder)", { x: 600, y: 140, size: 12, font: sans, color: grey });

// 3. Bar chart drawn as vectors
p = doc.addPage([W, H]);
p.drawText("Readings per region", { x: 60, y: 460, size: 32, font: bold, color: navy });
p.drawLine({ start: { x: 120, y: 100 }, end: { x: 860, y: 100 }, thickness: 2, color: grey });
p.drawLine({ start: { x: 120, y: 100 }, end: { x: 120, y: 400 }, thickness: 2, color: grey });
[["North", 240], ["East", 180], ["South", 290], ["West", 130]].forEach(([label, h], i) => {
  const x = 170 + i * 170;
  p.drawRectangle({ x, y: 100, width: 100, height: h as number, color: i % 2 ? accent : navy });
  p.drawText(String(label), { x: x + 22, y: 76, size: 16, font: sans, color: grey });
  p.drawText(String(h), { x: x + 32, y: 108 + (h as number), size: 16, font: bold, color: grey });
});

// 4. Table
p = doc.addPage([W, H]);
p.drawText("Sites at a glance", { x: 60, y: 460, size: 32, font: bold, color: navy });
const rows = [["Site", "Region", "Sensors", "Uptime"], ["Alder", "North", "12", "99.1%"], ["Birch", "East", "8", "97.4%"], ["Cedar", "South", "15", "98.8%"], ["Dogwood", "West", "6", "95.2%"]];
const cw = [220, 200, 160, 160], rh = 44, x0 = 60, y0 = 400;
rows.forEach((row, r) => {
  let x = x0;
  row.forEach((cell, c) => {
    const y = y0 - r * rh;
    if (r === 0) p.drawRectangle({ x, y: y - rh, width: cw[c], height: rh, color: navy });
    p.drawRectangle({ x, y: y - rh, width: cw[c], height: rh, borderColor: grey, borderWidth: 1 });
    p.drawText(cell, { x: x + 12, y: y - 28, size: 18, font: r === 0 ? bold : sans, color: r === 0 ? rgb(1, 1, 1) : grey });
    x += cw[c];
  });
});
writeFileSync(fx + "deck.pdf", await doc.save());
writeFileSync(fx + "report.pdf", await makeSamplePdf());
console.log("wrote", fx);

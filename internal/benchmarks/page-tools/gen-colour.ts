// Synthetic colourful fixture for invert/flatten: text, vector fills, a gradient picture, a form field and a link.
// Usage: bun internal/benchmarks/page-tools/gen-colour.ts <outdir>   (writes colour.pdf and form.pdf)
import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import sharp from "sharp";

const dir = process.argv[2] ?? "internal/benchmarks/page-tools/out";
mkdirSync(dir, { recursive: true });

async function gradient() {
  const w = 240;
  const h = 160;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      raw[i] = Math.round((x / w) * 255);
      raw[i + 1] = Math.round((y / h) * 255);
      raw[i + 2] = 180;
    }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const image = await doc.embedPng(await gradient());
for (let n = 1; n <= 2; n++) {
  const p = doc.addPage([612, 792]);
  p.drawText(`Colour page ${n} selectable heading`, { x: 50, y: 730, size: 24, font: bold });
  p.drawText("The quick brown fox jumps over the lazy dog.", { x: 50, y: 700, size: 14, font });
  p.drawText("Red text sample", { x: 50, y: 670, size: 14, font, color: rgb(0.8, 0.1, 0.1) });
  p.drawRectangle({ x: 50, y: 520, width: 160, height: 100, color: rgb(0.1, 0.3, 0.8) });
  p.drawRectangle({ x: 230, y: 520, width: 160, height: 100, color: rgb(0.9, 0.7, 0.1) });
  p.drawRectangle({ x: 410, y: 520, width: 150, height: 100, color: rgb(0.1, 0.6, 0.3) });
  p.drawImage(image, { x: 50, y: 300, width: 360, height: 240 });
  p.drawText("Caption under the picture", { x: 50, y: 280, size: 12, font });
}
writeFileSync(`${dir}/colour.pdf`, await doc.save());

const f = await PDFDocument.create();
const ff = await f.embedFont(StandardFonts.Helvetica);
const fp = f.addPage([400, 300]);
fp.drawText("Form to flatten", { x: 30, y: 260, size: 18, font: ff });
const form = f.getForm();
const tf = form.createTextField("name");
tf.setText("Ada Lovelace");
tf.addToPage(fp, { x: 30, y: 200, width: 200, height: 24, font: ff });
const cb = form.createCheckBox("agree");
cb.check();
cb.addToPage(fp, { x: 30, y: 160, width: 18, height: 18 });
f.setTitle("Secret title");
f.setAuthor("Synthetic Author");
f.setSubject("Synthetic subject");
writeFileSync(`${dir}/form.pdf`, await f.save());

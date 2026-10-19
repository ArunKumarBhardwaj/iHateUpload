// Synthetic fixtures for wave 2 group A. Run: bun internal/benchmarks/wave2-a/fixtures.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import sharp from "sharp";

const out = new URL("./fx/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const noise = (w: number, h: number) => {
  const b = Buffer.alloc(w * h * 3);
  for (let i = 0; i < b.length; i++) b[i] = (i * 31 + ((i / 7) | 0)) % 256;
  return b;
};

// photos.pdf: 2 big JPEGs + 1 tiny icon + 1 alpha PNG
const jpg = await sharp(noise(800, 600), { raw: { width: 800, height: 600, channels: 3 } })
  .jpeg({ quality: 85 })
  .toBuffer();
const icon = await sharp(noise(16, 16), { raw: { width: 16, height: 16, channels: 3 } })
  .png()
  .toBuffer();
const rgba = Buffer.alloc(120 * 90 * 4);
for (let p = 0; p < 120 * 90; p++) {
  rgba[p * 4] = 220;
  rgba[p * 4 + 1] = 40;
  rgba[p * 4 + 2] = 60;
  rgba[p * 4 + 3] = (p % 120) * 2;
}
const alpha = await sharp(rgba, { raw: { width: 120, height: 90, channels: 4 } }).png().toBuffer();
writeFileSync(out + "photo.jpg", jpg);
{
  const d = await PDFDocument.create();
  const a = d.addPage([612, 792]);
  const b = d.addPage([612, 792]);
  const j = await d.embedJpg(jpg);
  a.drawImage(j, { x: 20, y: 400, width: 400, height: 300 });
  b.drawImage(j, { x: 20, y: 400, width: 200, height: 150 });
  a.drawImage(await d.embedPng(icon), { x: 500, y: 700, width: 16, height: 16 });
  b.drawImage(await d.embedPng(alpha), { x: 20, y: 100, width: 120, height: 90 });
  writeFileSync(out + "photos.pdf", await d.save());
}
{
  const d = await PDFDocument.create();
  const p = d.addPage([400, 300]);
  p.drawText("No pictures here", { x: 20, y: 200, font: await d.embedFont(StandardFonts.Helvetica) });
  writeFileSync(out + "noimages.pdf", await d.save());
}

// locked PDFs
async function locked(name: string, user: string, owner: string, restrict: boolean) {
  const d = await PDFDocument.create();
  const p = d.addPage([400, 300]);
  p.drawText("Confidential quarterly numbers", { x: 20, y: 200, size: 14, font: await d.embedFont(StandardFonts.Helvetica) });
  d.encrypt({
    userPassword: user,
    ownerPassword: owner,
    permissions: restrict ? { printing: false, copying: false, modifying: false } : {},
  });
  writeFileSync(out + name, await d.save());
}
await locked("user-locked.pdf", "open-sesame", "boss", false);
await locked("owner-only.pdf", "", "boss", true);

// plain 3-page text PDF for protect / header-footer / extract-text
{
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const p = d.addPage([612, 792]);
    p.drawText(`Body text on page ${i}`, { x: 72, y: 700, size: 18, font: f });
    p.drawText("second line of the paragraph", { x: 72, y: 670, size: 12, font: f });
  }
  writeFileSync(out + "plain.pdf", await d.save());
}

// scan.pdf: a page that is only a picture of text
{
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="400"><rect width="100%" height="100%" fill="white"/><text x="40" y="150" font-family="Helvetica, Arial" font-size="80" fill="black">SCANNED INVOICE 4821</text><text x="40" y="280" font-family="Helvetica, Arial" font-size="60" fill="black">Total due 99 dollars</text></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  writeFileSync(out + "scan.png", png);
  const d = await PDFDocument.create();
  const p = d.addPage([500, 200]);
  p.drawImage(await d.embedPng(png), { x: 0, y: 0, width: 500, height: 200 });
  writeFileSync(out + "scan.pdf", await d.save());
}
console.log("fixtures in", out);

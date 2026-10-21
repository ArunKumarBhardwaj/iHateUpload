// Synthetic corpus for the workflow benchmark: 20 PDFs (3 pages, text + a photo-like image) and 20 JPG images.
// Usage: bun internal/benchmarks/workflows/gen.ts [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import sharp from "sharp";

const out = process.argv[2] ?? "corpus";
mkdirSync(join(out, "pdf"), { recursive: true });
mkdirSync(join(out, "img"), { recursive: true });

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

/** Smooth gradients plus noise, so JPEG recompression has something to save. */
async function photo(w: number, h: number, n: number) {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      raw[i] = (128 + 100 * Math.sin((x + n * 13) / 40)) | 0;
      raw[i + 1] = (128 + 100 * Math.cos((y + n * 7) / 55)) | 0;
      raw[i + 2] = ((x + y + n * 31) % 256) ^ ((rnd() * 40) | 0);
    }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } });
}

for (let n = 1; n <= 20; n++) {
  const id = String(n).padStart(2, "0");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const jpg = await (await photo(900, 700, n)).jpeg({ quality: 92 }).toBuffer();
  const img = await doc.embedJpg(jpg);
  for (let p = 1; p <= 3; p++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Synthetic document ${id}, page ${p}`, { x: 50, y: 790, size: 20, font });
    page.drawText(`workflow-bench-doc-${id}-p${p}`, { x: 50, y: 760, size: 12, font });
    page.drawImage(img, { x: 50, y: 300, width: 495, height: 385 });
  }
  writeFileSync(join(out, "pdf", `doc-${id}.pdf`), await doc.save());
  const small = await (await photo(1600, 1200, n + 50)).jpeg({ quality: 90 }).toBuffer();
  writeFileSync(join(out, "img", `photo-${id}.jpg`), small);
}
console.log("wrote corpus to", out);

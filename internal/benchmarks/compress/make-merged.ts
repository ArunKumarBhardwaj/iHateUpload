// Two files only pdf-lib makes the way real apps do. Run after make-images.py.
//  merged.pdf   12 one-page letters, each with the full Liberation Sans font and a logo, merged into one:
//               every font and logo is in the file 12 times, as after "merge PDF" on most sites
//  trimmed.pdf  photos.pdf with three of its four pages deleted in pdf-lib: the deleted pages'
//               photos are still in the file, unreferenced
// Usage: bun internal/benchmarks/compress/make-merged.ts
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "@cantoo/pdf-lib";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "corpus");
const FONT = readFileSync("node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf");
const BOLD = readFileSync("node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf");

// A 600x200 logo with a soft gradient, as PNG.
function logoPng(): Uint8Array {
  const w = 600;
  const h = 200;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const inside = (x - 100) ** 2 + (y - 100) ** 2 < 80 ** 2;
      raw[o] = inside ? 230 : 255 - (x * 40) / w;
      raw[o + 1] = inside ? 90 : 255 - (y * 30) / h;
      raw[o + 2] = inside ? 40 : 250;
    }
  }
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const logo = logoPng();
const merged = await PDFDocument.create();
for (let i = 0; i < 12; i++) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(FONT, { subset: false });
  const bold = await doc.embedFont(BOLD, { subset: false });
  const image = await doc.embedPng(logo);
  const page = doc.addPage([595, 842]);
  page.drawImage(image, { x: 40, y: 760, width: 150, height: 50 });
  page.drawText(`Letter ${i + 1}`, { x: 56, y: 720, size: 18, font: bold });
  for (let k = 0; k < 30; k++) {
    page.drawText(`Line ${k + 1}: this paragraph is set in Liberation Sans so the font travels with the file.`, {
      x: 56,
      y: 690 - k * 18,
      size: 10,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
  }
  const one = await PDFDocument.load(await doc.save());
  const [copied] = await merged.copyPages(one, [0]);
  merged.addPage(copied);
}
writeFileSync(join(OUT, "merged.pdf"), await merged.save());
console.log("merged.pdf", (await merged.save()).length);

const photos = await PDFDocument.load(readFileSync(join(OUT, "photos.pdf")));
photos.removePage(3);
photos.removePage(2);
photos.removePage(1);
const trimmed = await photos.save();
writeFileSync(join(OUT, "trimmed.pdf"), trimmed);
console.log("trimmed.pdf", trimmed.length);

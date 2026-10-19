// Renders synthetic "photos" of a text page: bun bench/scan/make-fixture.ts <outDir>
import { mkdirSync } from "node:fs";
import sharp from "sharp";

import { cameraQuad, photographSheet } from "../../src/lib/scan/fixtures";

const out = process.argv[2] ?? "bench/scan/out";
mkdirSync(out, { recursive: true });

const W = 1240;
const H = 1754;
const lines = [
  "Synthetic scan text line",
  "Invoice 4821 total due 1290 dollars",
  "The quick brown fox jumps over the lazy dog",
  "Receipts are stored in the blue folder",
  "Meeting notes from Tuesday afternoon",
  "Please remit payment within thirty days",
];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<rect width="100%" height="100%" fill="#fff"/>
${lines
  .map(
    (l, i) =>
      `<text x="110" y="${220 + i * 170}" font-family="Helvetica, Arial, sans-serif" font-size="${i === 0 ? 84 : 50}" fill="#111">${l}</text>`,
  )
  .join("\n")}
</svg>`;
const raw = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const sheet = { data: new Uint8ClampedArray(raw.data), width: raw.info.width, height: raw.info.height };
await sharp(Buffer.from(raw.data), { raw: { width: W, height: H, channels: 4 } }).png().toFile(`${out}/flat.png`);

const cases: [string, Parameters<typeof cameraQuad>[2], "desk" | "dark"][] = [
  ["page-1.jpg", { yaw: 0.4, pitch: 0.3, roll: 0.08, dist: 270, focal: 1000, width: 1600, height: 2000 }, "desk"],
  ["page-2.jpg", { yaw: -0.3, pitch: 0.2, roll: -0.1, dist: 265, focal: 1000, width: 1600, height: 2000 }, "dark"],
];
for (const [name, cam, background] of cases) {
  const quad = cameraQuad(210, 297, cam);
  const photo = photographSheet(sheet, quad, { width: cam.width, height: cam.height, background, noise: 8, shade: 0.2 });
  await sharp(Buffer.from(photo.data), { raw: { width: photo.width, height: photo.height, channels: 4 } })
    .jpeg({ quality: 88 })
    .toFile(`${out}/${name}`);
  console.log(name, JSON.stringify(quad.map((p) => [Math.round(p.x), Math.round(p.y)])));
}

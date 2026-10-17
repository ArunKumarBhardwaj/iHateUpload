import { expect, test } from "bun:test";
import { PDFDocument } from "@cantoo/pdf-lib";
import sharp from "sharp";

import { filterBySize, scanPdfImages } from "./pdf-images";

async function fixture() {
  const noise = Buffer.alloc(120 * 80 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 37) % 251;
  const jpg = await sharp(noise, { raw: { width: 120, height: 80, channels: 3 } })
    .jpeg({ quality: 80 })
    .toBuffer();
  const rgba = Buffer.alloc(30 * 20 * 4);
  for (let p = 0; p < 600; p++) {
    rgba[p * 4] = 200;
    rgba[p * 4 + 1] = 10;
    rgba[p * 4 + 2] = 30;
    rgba[p * 4 + 3] = p % 2 ? 255 : 100;
  }
  const png = await sharp(rgba, { raw: { width: 30, height: 20, channels: 4 } })
    .png()
    .toBuffer();
  const doc = await PDFDocument.create();
  const a = doc.addPage([300, 300]);
  const b = doc.addPage([300, 300]);
  const jimg = await doc.embedJpg(jpg);
  const pimg = await doc.embedPng(png);
  a.drawImage(jimg, { x: 0, y: 0, width: 120, height: 80 });
  a.drawImage(pimg, { x: 0, y: 100, width: 30, height: 20 });
  b.drawImage(jimg, { x: 0, y: 0, width: 60, height: 40 });
  return { pdf: await doc.save(), jpg };
}

test("JPEG streams come out byte-for-byte, PNGs decode with alpha", async () => {
  const { pdf, jpg } = await fixture();
  const scan = await scanPdfImages(pdf);
  expect(scan.images.length).toBe(2);
  const j = scan.images.find((i) => i.format === "jpg")!;
  expect(Buffer.compare(Buffer.from(j.bytes), jpg)).toBe(0);
  expect(j.pages).toEqual([1, 2]);
  const p = scan.images.find((i) => i.format === "png")!;
  const raw = await sharp(Buffer.from(p.bytes)).raw().toBuffer({ resolveWithObject: true });
  expect(raw.info.width).toBe(30);
  expect(raw.info.channels).toBe(4);
  expect(raw.data[0]).toBe(200);
  expect(raw.data[3]).toBe(100);
  expect(raw.data[7]).toBe(255);
});

test("no images scans empty and fast; size filter works", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const scan = await scanPdfImages(await doc.save());
  expect(scan.images).toEqual([]);
  expect(filterBySize([{ width: 20, height: 900 }, { width: 100, height: 100 }], 64).length).toBe(1);
});

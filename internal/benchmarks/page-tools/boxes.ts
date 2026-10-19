// Prints page size, rotation, crop box of each page. Usage: bun internal/benchmarks/page-tools/boxes.ts <pdf>
import { readFileSync } from "node:fs";
import { PDFDocument } from "@cantoo/pdf-lib";
const d = await PDFDocument.load(readFileSync(process.argv[2]));
d.getPages().forEach((p, i) => {
  const c = p.getCropBox();
  console.log(i + 1, "rot", p.getRotation().angle, "media", p.getSize().width.toFixed(1), p.getSize().height.toFixed(1), "crop", [c.x, c.y, c.width, c.height].map((n) => n.toFixed(1)).join(","));
});

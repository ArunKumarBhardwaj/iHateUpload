// Side-by-side image of the PDF render (left) and a converted page (right). Usage: bun compare.ts <doc> <side> <page> <out.png> [--fx]
import { join } from "node:path";
import sharp from "sharp";

const [doc, side, page, out] = process.argv.slice(2);
const res = join(import.meta.dirname, process.argv.includes("--fx") ? "results-fx" : "results");
const a = await sharp(join(res, ".render", doc, `p${page}.png`)).flatten({ background: "#fff" }).png().toBuffer({ resolveWithObject: true });
const b = await sharp(join(res, side, `${doc}.p${page}.png`)).resize({ width: a.info.width, height: a.info.height, fit: "fill" }).flatten({ background: "#fff" }).png().toBuffer();
await sharp({ create: { width: a.info.width * 2 + 10, height: a.info.height, channels: 3, background: "#888" } })
  .composite([{ input: a.data, left: 0, top: 0 }, { input: b, left: a.info.width + 10, top: 0 }])
  .png()
  .toFile(out);

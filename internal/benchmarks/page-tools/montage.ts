// Tiles the top-left of several same-size PNGs side by side. Usage: bun internal/benchmarks/page-tools/montage.ts out.png w h in1.png in2.png ...
import sharp from "sharp";
const [out, w, h, ...ins] = process.argv.slice(2);
const W = Number(w), H = Number(h);
const tiles = await Promise.all(ins.map((f) => sharp(f).extract({ left: 8, top: 8, width: W, height: H }).toBuffer()));
await sharp({ create: { width: (W + 5) * ins.length + 5, height: H + 10, channels: 3, background: "#888" } })
  .composite(tiles.map((input, i) => ({ input, left: 5 + i * (W + 5), top: 5 })))
  .png().toFile(out);

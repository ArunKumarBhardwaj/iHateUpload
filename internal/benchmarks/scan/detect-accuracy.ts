// Corner accuracy of detectDocument on the synthetic photos: bun internal/benchmarks/scan/detect-accuracy.ts <fxDir>
import sharp from "sharp";

import { detectDocument } from "../../../src/lib/scan/detect";
import { downscale } from "../../../src/lib/scan/geometry";

const dir = process.argv[2];
const truth: Record<string, number[][]> = {
  "page-1.jpg": [[469, 380], [1379, 353], [1103, 1568], [497, 1338]],
  "page-2.jpg": [[239, 372], [1130, 382], [1149, 1390], [483, 1593]],
};
for (const [name, quad] of Object.entries(truth)) {
  const raw = await sharp(`${dir}/${name}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const full = { data: new Uint8ClampedArray(raw.data), width: raw.info.width, height: raw.info.height };
  const img = downscale(full, 900);
  const k = full.width / img.width;
  const found = detectDocument(img);
  const errs = found.found ? found.quad.map((p, i) => Math.hypot(p.x * k - quad[i][0], p.y * k - quad[i][1])) : [];
  // Signed distance of each found corner from truth toward the page centre, in photo px.
  const cx = quad.reduce((n, p) => n + p[0], 0) / 4;
  const cy = quad.reduce((n, p) => n + p[1], 0) / 4;
  const inward = found.found
    ? found.quad.map((p, i) => {
        const dx = cx - quad[i][0], dy = cy - quad[i][1], d = Math.hypot(dx, dy);
        return ((p.x * k - quad[i][0]) * dx + (p.y * k - quad[i][1]) * dy) / d;
      })
    : [];
  console.log(name, found.found, "err px", errs.map((e) => e.toFixed(1)).join(","), "inward px", inward.map((e) => e.toFixed(1)).join(","));
}

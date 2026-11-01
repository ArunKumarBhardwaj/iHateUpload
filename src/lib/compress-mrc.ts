/**
 * Mixed raster content for colour scans of documents, as DjVu and the best scan compressors do it.
 * One scanned page becomes three layers:
 *   mask        which pixels are ink, 1-bit JBIG2 at full scan resolution, so text stays sharp
 *   foreground  the colour of that ink, a tiny low-resolution JPEG (black text, a blue signature,
 *               a red stamp each keep their colour)
 *   background  the paper with the ink lifted out, a low-resolution JPEG of almost flat colour
 * Drawn as background, then foreground through the mask. Pure: pixels in, layer bytes out.
 */
import { binarize, shrinkLuma } from "@/lib/bilevel";
import type { ImageCodec, Pixels } from "@/lib/compress-engine";
import { encodeJbig2Best } from "@/lib/jbig2";

export type MrcLayers = {
  mask: { bytes: Uint8Array; width: number; height: number };
  fg: { bytes: Uint8Array; width: number; height: number; gray: boolean };
  bg: { bytes: Uint8Array; width: number; height: number; gray: boolean };
};

export type MrcPlan = {
  /** Mask size; the scan's own size or smaller. */
  maskWidth: number;
  maskHeight: number;
  /** Background pixels per mask pixel along each side, e.g. 4 for 300 dpi text over 75 dpi paper. */
  bgScale: number;
  /** Foreground pixels per mask pixel, coarser still: ink colour changes slowly. */
  fgScale: number;
  bgQuality: number;
  fgQuality: number;
  matchLetters: boolean;
};

/** Darkest channel: coloured ink (red stamps, blue pens) is dark in one channel even when its luma is not. */
function inkness(pixels: Pixels): Uint8Array {
  const n = pixels.width * pixels.height;
  const out = new Uint8Array(n);
  const d = pixels.data;
  for (let p = 0, o = 0; p < n; p++, o += 4) {
    const r = d[o];
    const g = d[o + 1];
    const b = d[o + 2];
    out[p] = r < g ? (r < b ? r : b) : g < b ? g : b;
  }
  return out;
}

/** Grows the ink by one pixel, so the paper average never picks up an antialiased edge. */
function dilate(ink: Uint8Array, w: number, h: number): Uint8Array {
  const out = ink.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue;
      if (x > 0) out[y * w + x - 1] = 1;
      if (x < w - 1) out[y * w + x + 1] = 1;
      if (y > 0) out[(y - 1) * w + x] = 1;
      if (y < h - 1) out[(y + 1) * w + x] = 1;
    }
  }
  return out;
}

/**
 * Box-averages source pixels into cells of a smaller grid, counting only pixels whose mask value
 * matches want. Cells with none are filled from their neighbours afterwards, so the JPEG sees
 * smooth colour everywhere.
 */
function layer(src: Pixels, mask: Uint8Array, mw: number, mh: number, cw: number, ch: number, want: 0 | 1): Pixels {
  const sum = new Float64Array(cw * ch * 3);
  const cnt = new Uint32Array(cw * ch);
  const weight = new Float64Array(cw * ch);
  const sx = src.width / mw;
  const sy = src.height / mh;
  const cx = cw / mw;
  const cy = ch / mh;
  for (let my = 0; my < mh; my++) {
    const syi = Math.min(src.height - 1, Math.floor((my + 0.5) * sy));
    const c0 = Math.min(ch - 1, Math.floor(my * cy)) * cw;
    for (let mx = 0; mx < mw; mx++) {
      if (mask[my * mw + mx] !== want) continue;
      const o = (syi * src.width + Math.min(src.width - 1, Math.floor((mx + 0.5) * sx))) * 4;
      const c = c0 + Math.min(cw - 1, Math.floor(mx * cx));
      const r = src.data[o];
      const g = src.data[o + 1];
      const b = src.data[o + 2];
      // Ink colour leans on the darkest pixels; antialiased edges would wash it out.
      const k = want ? 256 - Math.min(r, g, b) : 1;
      const wgt = want ? (k * k) / 65536 : 1;
      sum[c * 3] += r * wgt;
      sum[c * 3 + 1] += g * wgt;
      sum[c * 3 + 2] += b * wgt;
      weight[c] += wgt;
      cnt[c]++;
    }
  }
  const data = new Uint8ClampedArray(cw * ch * 4);
  const filled = new Uint8Array(cw * ch);
  let any = false;
  for (let c = 0; c < cw * ch; c++) {
    data[c * 4 + 3] = 255;
    if (!cnt[c]) continue;
    data[c * 4] = sum[c * 3] / weight[c];
    data[c * 4 + 1] = sum[c * 3 + 1] / weight[c];
    data[c * 4 + 2] = sum[c * 3 + 2] / weight[c];
    filled[c] = 1;
    any = true;
  }
  if (!any) data.fill(want ? 0 : 255);
  // Spread known colour into the holes, ring by ring.
  for (let pass = 0; any && pass < Math.max(cw, ch); pass++) {
    let holes = 0;
    const next = filled.slice();
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const c = y * cw + x;
        if (filled[c]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let k = 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const n = ny * cw + nx;
          if (!filled[n]) continue;
          r += data[n * 4];
          g += data[n * 4 + 1];
          b += data[n * 4 + 2];
          k++;
        }
        if (!k) {
          holes++;
          continue;
        }
        data[c * 4] = r / k;
        data[c * 4 + 1] = g / k;
        data[c * 4 + 2] = b / k;
        next[c] = 1;
      }
    }
    filled.set(next);
    if (!holes) break;
  }
  return { data, width: cw, height: ch };
}

/** Splits a scanned page into the three layers, or null when it is not text on paper. */
export async function splitScan(src: Pixels, plan: MrcPlan, codec: ImageCodec): Promise<MrcLayers | null> {
  const { maskWidth: mw, maskHeight: mh } = plan;
  const dark = shrinkLuma(inkness(src), src.width, src.height, mw, mh);
  const result = binarize(dark, mw, mh);
  // Photos and shaded art are not two-tone; they stay one JPEG.
  if (!result.bilevel) return null;
  const ink = result.ink;
  const bw = Math.max(1, Math.round(mw / plan.bgScale));
  const bh = Math.max(1, Math.round(mh / plan.bgScale));
  const fw = Math.max(1, Math.round(mw / plan.fgScale));
  const fh = Math.max(1, Math.round(mh / plan.fgScale));
  const bg = layer(src, dilate(ink, mw, mh), mw, mh, bw, bh, 0);
  const fg = layer(src, ink, mw, mh, fw, fh, 1);
  const gray = (p: Pixels) => {
    for (let o = 0; o < p.data.length; o += 4) {
      if (Math.abs(p.data[o] - p.data[o + 1]) > 6 || Math.abs(p.data[o + 1] - p.data[o + 2]) > 6) return false;
    }
    return true;
  };
  const fgGray = gray(fg);
  const bgGray = gray(bg);
  return {
    mask: { bytes: encodeJbig2Best(ink, mw, mh, plan.matchLetters), width: mw, height: mh },
    fg: { bytes: await codec.encodeJpeg(fg, plan.fgQuality, fgGray), width: fw, height: fh, gray: fgGray },
    bg: { bytes: await codec.encodeJpeg(bg, plan.bgQuality, bgGray), width: bw, height: bh, gray: bgGray },
  };
}

export const mrcBytes = (l: MrcLayers) => l.mask.bytes.length + l.fg.bytes.length + l.bg.bytes.length + 420;

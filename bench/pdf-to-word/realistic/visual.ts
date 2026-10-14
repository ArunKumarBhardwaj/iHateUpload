/** Visual similarity between two page images. Pure functions on greyscale buffers; image decoding lives in the runner. */

export type Grey = { w: number; h: number; data: Float64Array };

/** Box-filter downscale to w x h (area average). */
export function resizeGrey(src: Grey, w: number, h: number): Grey {
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = (y * src.h) / h;
    const y1 = ((y + 1) * src.h) / h;
    for (let x = 0; x < w; x++) {
      const x0 = (x * src.w) / w;
      const x1 = ((x + 1) * src.w) / w;
      let sum = 0;
      let area = 0;
      for (let yy = Math.floor(y0); yy < Math.min(src.h, Math.ceil(y1)); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.min(src.w, Math.ceil(x1)); xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          sum += src.data[yy * src.w + xx] * wx * wy;
          area += wx * wy;
        }
      }
      out[y * w + x] = area ? sum / area : 255;
    }
  }
  return { w, h, data: out };
}

/** Mean SSIM over non-overlapping 8x8 windows (values 0..255). Equal-size inputs. */
export function ssim(a: Grey, b: Grey, inkOnly = false): number {
  if (a.w !== b.w || a.h !== b.h) throw new Error("ssim needs equal sizes");
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const N = 8;
  let total = 0;
  let n = 0;
  for (let y0 = 0; y0 + N <= a.h; y0 += N) {
    for (let x0 = 0; x0 + N <= a.w; x0 += N) {
      let ma = 0;
      let mb = 0;
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          ma += a.data[(y0 + y) * a.w + x0 + x];
          mb += b.data[(y0 + y) * a.w + x0 + x];
        }
      ma /= N * N;
      mb /= N * N;
      let va = 0;
      let vb = 0;
      let cov = 0;
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const da = a.data[(y0 + y) * a.w + x0 + x] - ma;
          const db = b.data[(y0 + y) * a.w + x0 + x] - mb;
          va += da * da;
          vb += db * db;
          cov += da * db;
        }
      va /= N * N - 1;
      vb /= N * N - 1;
      cov /= N * N - 1;
      // Whitespace windows match trivially; with inkOnly they are skipped so an empty page cannot score well.
      if (inkOnly && ma < 1.5 && mb < 1.5) continue;
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      n++;
    }
  }
  return n ? total / n : inkOnly ? 0 : 1;
}

/** Blur so that a text line shifted by a pixel or two still overlaps (a Word re-flow never matches to the pixel). */
export function blur(g: Grey, radius: number): Grey {
  const pass = (src: Float64Array, horizontal: boolean) => {
    const out = new Float64Array(src.length);
    for (let y = 0; y < g.h; y++)
      for (let x = 0; x < g.w; x++) {
        let s = 0;
        let c = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          if (xx < 0 || yy < 0 || xx >= g.w || yy >= g.h) continue;
          s += src[yy * g.w + xx];
          c++;
        }
        out[y * g.w + x] = s / c;
      }
    return out;
  };
  return { w: g.w, h: g.h, data: pass(pass(g.data, true), false) };
}

/** Ink map: 255 where the page is dark, 0 on paper. Compared after blur so it measures where the ink sits. */
export function ink(g: Grey): Grey {
  return { w: g.w, h: g.h, data: g.data.map((v) => Math.max(0, 255 - v)) };
}

/** Two scales: 200 px wide with blur 2 (line and block placement) and 100 px wide with blur 1 (coarse layout, tolerant of reflow). */
const SCALES: { w: number; blur: number }[] = [
  { w: 200, blur: 2 },
  { w: 100, blur: 1 },
];

/**
 * Page similarity in 0..1. Both pages are scaled to the same size (the original's aspect; a converted page with
 * a different aspect is stretched to it and loses score through the content mismatch).
 * Score = mean over SCALES of SSIM of blurred ink maps, over windows where either page has ink, so layout position
 * and density count, not font hinting or the white margins.
 */
export function pageSimilarity(original: Grey, converted: Grey): number {
  const scores = SCALES.map(({ w, blur: r }) => {
    const h = Math.max(8, Math.round((w * original.h) / original.w));
    const prep = (g: Grey) => blur(ink(resizeGrey(g, w, h)), r);
    const a = prep(original);
    const b = prep(converted);
    if (a.data.every((v) => v < 1.5) && b.data.every((v) => v < 1.5)) return 1; // two blank pages
    return ssim(a, b, true);
  });
  return Math.max(0, Math.min(1, scores.reduce((x, y) => x + y, 0) / scores.length));
}

/** Document visual score: mean over the original's pages; a missing converted page scores 0, extra pages are ignored here. */
export function documentSimilarity(original: Grey[], converted: Grey[]): { score: number; pages: number[]; pageDelta: number } {
  const pages = original.map((o, i) => (converted[i] ? pageSimilarity(o, converted[i]) : 0));
  return { score: pages.length ? pages.reduce((a, b) => a + b, 0) / pages.length : 0, pages, pageDelta: converted.length - original.length };
}

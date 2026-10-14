import type { Bullet, Line } from "./lines";

const GLYPH: Record<Bullet["kind"], string> = { disc: "•", circle: "◦", square: "▪" };

/** Give each line that starts right after a drawn bullet shape the bullet as its leading character. */
export function applyBullets(lines: Line[], bullets: Bullet[] | undefined): void {
  if (!bullets?.length) return;
  for (const bullet of bullets) {
    const mid = (bullet.y0 + bullet.y1) / 2;
    let best: Line | null = null;
    for (const line of lines) {
      if (mid < line.top - 2 || mid > line.bottom + 2) continue;
      const gap = line.x0 - bullet.x1;
      if (gap < -1 || gap > Math.max(30, 3 * line.size)) continue;
      if (!best || line.x0 < best.x0) best = line;
    }
    if (!best || best.frags.length === 0) continue;
    const first = best.frags[0];
    best.frags.unshift({ ...first, text: `${GLYPH[bullet.kind]} `, x0: bullet.x0, x1: best.x0, tabBefore: undefined, link: undefined });
    best.x0 = bullet.x0;
  }
}

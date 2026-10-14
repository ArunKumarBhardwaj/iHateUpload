import type { Frag, Line, PageLink } from "./lines";

/** Where along a piece of text an x position falls, as a character index. */
function charAt(frag: Frag, x: number): number {
  const span = Math.max(1e-6, frag.x1 - frag.x0);
  const at = Math.round(((x - frag.x0) / span) * frag.text.length);
  return Math.min(frag.text.length, Math.max(0, at));
}

/** Link rectangles end at word edges, but character widths are only estimated, so slide to the nearest edge. */
function snap(text: string, at: number, isEdge: (i: number) => boolean): number {
  for (let d = 0; d <= 2; d++) {
    for (const i of [at - d, at + d]) if (i >= 0 && i <= text.length && isEdge(i)) return i;
  }
  return at;
}

function split(frag: Frag, link: PageLink): Frag[] {
  if (frag.link) return [frag];
  const { text } = frag;
  let a = snap(text, charAt(frag, link.x0), (i) => i === 0 || (text[i - 1] === " " && text[i] !== " "));
  let b = snap(text, charAt(frag, link.x1), (i) => i === text.length || (text[i] === " " && text[i - 1] !== " "));
  while (a < b && text[a] === " ") a++;
  while (b > a && text[b - 1] === " ") b--;
  if (b <= a) return [frag];
  const target = link.url !== undefined ? { url: link.url } : link.anchor ? { anchor: link.anchor.name } : undefined;
  if (!target) return [frag];
  const per = (frag.x1 - frag.x0) / Math.max(1, text.length);
  const piece = (from: number, to: number, extra: Partial<Frag> = {}): Frag => ({
    ...frag,
    ...extra,
    text: text.slice(from, to),
    x0: frag.x0 + per * from,
    x1: frag.x0 + per * to,
    tabBefore: from === 0 ? frag.tabBefore : undefined,
  });
  const out: Frag[] = [];
  if (a > 0) out.push(piece(0, a));
  out.push(piece(a, b, { link: target }));
  if (b < text.length) out.push(piece(b, text.length));
  return out;
}

/** Mark the pieces of text that sit under a link rectangle. Splits pieces where a link starts or ends. */
export function applyLinks(lines: Line[], links: PageLink[] | undefined): void {
  if (!links?.length) return;
  for (const link of links) {
    for (const line of lines) {
      if (line.baseline < link.top - 1 || line.baseline > link.bottom + 1) continue;
      if (line.x1 < link.x0 || line.x0 > link.x1) continue;
      line.frags = line.frags.flatMap((frag) =>
        frag.x1 <= link.x0 || frag.x0 >= link.x1 ? [frag] : split(frag, link),
      );
    }
  }
}

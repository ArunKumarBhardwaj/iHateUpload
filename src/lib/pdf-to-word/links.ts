import type { Frag, Line, PageLink } from "./lines";

/** Rough relative widths of letters in a proportional font, to place a cut inside a piece of text. */
function weight(ch: string): number {
  if ("iljtfI.,:;'|!".includes(ch)) return 0.45;
  if (ch === " ") return 0.5;
  if ("r()-J".includes(ch)) return 0.65;
  if ("mwMW@%".includes(ch)) return 1.45;
  if (/[A-Z]/.test(ch)) return 1.15;
  return 1;
}

/** Character index whose edge is closest to x, preferring word edges when one is near. */
function indexAt(frag: Frag, x: number, isEdge: (i: number) => boolean): number {
  const { text } = frag;
  const edges: number[] = [0];
  for (const ch of text) edges.push(edges[edges.length - 1] + weight(ch));
  const unit = Math.max(1e-6, (frag.x1 - frag.x0) / edges[edges.length - 1]);
  const target = (x - frag.x0) / unit;
  let best = 0;
  let bestEdge = -1;
  let bestAny = Infinity;
  let any = 0;
  edges.forEach((at, i) => {
    const d = Math.abs(at - target);
    if (d < bestAny) {
      bestAny = d;
      any = i;
    }
    if (isEdge(i) && (bestEdge < 0 || d < best)) {
      best = d;
      bestEdge = i;
    }
  });
  return bestEdge >= 0 && best <= 3 ? bestEdge : any;
}

function split(frag: Frag, link: PageLink): Frag[] {
  if (frag.link) return [frag];
  const { text } = frag;
  let a = indexAt(frag, link.x0, (i) => i === 0 || (/[\s(\["'“‘]/.test(text[i - 1]) && text[i] !== " "));
  let b = indexAt(frag, link.x1, (i) => i === text.length || (/[\s.,;:!?)\]"'”’]/.test(text[i]) && text[i - 1] !== " "));
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

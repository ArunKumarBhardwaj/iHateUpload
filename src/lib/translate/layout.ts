/** Lays a translation into the box the original text used. */

export type Measure = (text: string, size: number) => number;

const LINE = 1.15;
/** Smallest size, as a share of the original, before the text may run past the box. */
const MIN_SHARE = 0.6;

function wrap(text: string, width: number, size: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next, size) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * The largest size, from the original down to half of it, at which the text
 * wraps inside the box. A box that held one line stays one line when it can.
 */
export function fitText(text: string, width: number, height: number, size: number, measure: Measure) {
  const floor = Math.max(4, size * MIN_SHARE);
  for (let s = size; s >= floor; s = Math.round((s - Math.max(0.25, s * 0.05)) * 100) / 100) {
    const lines = wrap(text, width, s, measure);
    // The last line needs no leading below it.
    const fits = (lines.length * LINE - (LINE - 1)) * s <= height + 0.5 && lines.every((l) => measure(l, s) <= width + 0.5);
    if (fits) return { size: s, lines };
  }
  return { size: floor, lines: wrap(text, width, floor, measure) };
}

export const LINE_HEIGHT = LINE;

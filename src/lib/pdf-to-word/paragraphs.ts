import { wordFont } from "./fonts";
import { lineText, markerCandidates, type Frag, type Line, type Marker } from "./lines";
import type { ParagraphBlock, Run } from "./model";

export type Stats = {
  bodySize: number;
  /** Baseline-to-baseline distance of body text, in multiples of its size. */
  pitchRatio: number;
  /** Distinct heading sizes, largest first. */
  headingSizes: number[];
  bodyBold: boolean;
  /** Characters the figures came from. */
  chars: number;
};

export type ParaMeta = {
  firstBaseline: number;
  lastBaseline: number;
  firstTop: number;
  lastBottom: number;
  size: number;
  pitch: number | null;
  colL: number;
  colR: number;
  marker: (Marker & { markerX: number; textX: number }) | null;
};

export type BuiltPara = { block: ParagraphBlock; meta: ParaMeta };

/** Lines that share a row of the page become one line, pieces joined by tabs. */
export function mergeRows(lines: Line[]): Line[] {
  const out: Line[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev && prev.row === line.row && Math.abs(prev.baseline - line.baseline) < 0.5 * line.size) {
      // A modest gap is just stretched word spacing; only a real jump becomes a tab.
      const wide = line.x0 - prev.x1 >= 3.5 * line.size;
      const before = prev.frags.map((f, i) =>
        !wide && i === prev.frags.length - 1 && !/\s$/.test(f.text) ? { ...f, text: f.text + " " } : f,
      );
      const frags = [
        ...before,
        ...line.frags.map((f, i) => (i === 0 && wide ? { ...f, tabBefore: true } : f)),
      ];
      out[out.length - 1] = {
        ...prev,
        frags,
        x0: Math.min(prev.x0, line.x0),
        x1: Math.max(prev.x1, line.x1),
        top: Math.min(prev.top, line.top),
        bottom: Math.max(prev.bottom, line.bottom),
        size: Math.max(prev.size, line.size),
      };
    } else out.push(line);
  }
  return out;
}

const SENTENCE_END = /[.!?:;]["')\]”’]?\s*$/;
const allBold = (line: Line) => line.frags.every((f) => f.bold || !f.text.trim());

function stripChars(frags: Frag[], count: number): Frag[] {
  const out: Frag[] = [];
  let left = count;
  for (const frag of frags) {
    if (left <= 0) {
      out.push(frag);
    } else if (frag.text.length <= left) {
      left -= frag.text.length;
    } else {
      const share = left / frag.text.length;
      out.push({
        ...frag,
        text: frag.text.slice(left),
        x0: frag.x0 + (frag.x1 - frag.x0) * share,
      });
      left = 0;
    }
  }
  return out;
}

/**
 * The marker each line starts with. Uncertain ones ("a.", "iv.") only count when the nearest
 * marked line before or after counts on from them in the same style.
 */
function resolveMarkers(lines: Line[]): Map<Line, Marker> {
  const cands = lines.map((l) => markerCandidates(lineText(l)));
  const out = new Map<Line, Marker>();
  const near = (from: number, step: number): number | null => {
    for (let k = from + step, seen = 0; k >= 0 && k < lines.length && seen < 6; k += step, seen++) {
      if (cands[k].length) return k;
    }
    return null;
  };
  lines.forEach((line, i) => {
    const list = cands[i];
    if (!list.length) return;
    if (!list[0].ambiguous) {
      out.set(line, list[0].marker);
      return;
    }
    const neighbours = [near(i, -1), near(i, 1)].filter((k): k is number => k !== null);
    for (const { marker } of list) {
      const agrees = neighbours.some((k) =>
        cands[k].some(
          (c) =>
            c.marker.kind === marker.kind &&
            c.marker.suffix === marker.suffix &&
            Math.abs(c.marker.start - marker.start) === 1 &&
            Math.abs(lines[k].x0 - line.x0) <= 6,
        ),
      );
      if (agrees) {
        out.set(line, marker);
        return;
      }
    }
  });
  return out;
}

function markerOf(line: Line, markers: Map<Line, Marker>): (Marker & { markerX: number; textX: number }) | null {
  const marker = markers.get(line);
  if (!marker) return null;
  const rest = stripChars(line.frags, marker.length);
  const textX = rest.length ? rest[0].x0 : line.x0 + 14;
  return { ...marker, markerX: line.x0, textX };
}

type Acc = {
  lines: Line[];
  marker: ReturnType<typeof markerOf>;
};

function pitchOf(acc: Acc): number | null {
  if (acc.lines.length < 2) return null;
  const diffs: number[] = [];
  for (let i = 1; i < acc.lines.length; i++) {
    diffs.push(acc.lines[i].baseline - acc.lines[i - 1].baseline);
  }
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

function continues(acc: Acc, cur: Line, stats: Stats, lists: boolean, markers: Map<Line, Marker>): boolean {
  const prev = acc.lines[acc.lines.length - 1];
  if (Math.abs(cur.size - prev.size) > 0.15 * prev.size) return false;
  if (lists && markers.has(cur)) return false;
  const pitch = cur.baseline - prev.baseline;
  if (pitch < 0.5 * prev.size) return false;
  const known = pitchOf(acc);
  const limit = known !== null ? known * 1.25 + 1 : stats.pitchRatio * prev.size * 1.22 + 1;
  if (pitch > limit) return false;
  if (acc.lines.length === 1 && allBold(prev) && !allBold(cur)) return false;

  const bodyLeft = acc.marker
    ? acc.marker.textX
    : acc.lines.length >= 2
      ? acc.lines[1].x0
      : prev.x0;
  const delta = cur.x0 - bodyLeft;
  if (delta > 0.9 * prev.size) return false;
  const width = Math.max(1, prev.colR - prev.colL);
  if (delta < -1.5 * prev.size) {
    const wrapped = prev.x1 >= prev.colR - 0.25 * width;
    if (!(acc.lines.length === 1 && !acc.marker && wrapped)) return false;
  }
  if (prev.x1 < prev.colR - 0.25 * width && SENTENCE_END.test(lineText(prev))) return false;
  return true;
}

function toRuns(lines: Line[], marker: Acc["marker"]): Run[] {
  const runs: Run[] = [];
  let lastKey = "";
  let first = true;
  lines.forEach((line, lineIndex) => {
    const frags = lineIndex === 0 && marker ? stripChars(line.frags, marker.length) : line.frags;
    frags.forEach((frag, i) => {
      if (frag.tabBefore) {
        runs.push({ text: "", tab: true });
        lastKey = "";
      }
      let text = frag.text;
      if (first) {
        text = text.replace(/^\s+/, "");
        if (!text) return;
        first = false;
      } else if (i === 0 && lineIndex > 0) {
        const prev = runs[runs.length - 1];
        const hyphenated = prev && /\w-$/.test(prev.text) && /^[a-z]/.test(text);
        if (prev && !prev.tab && !hyphenated && !/\s$/.test(prev.text) && !/^\s/.test(text)) prev.text += " ";
      }
      // Smaller text sitting off the line's baseline is super- or subscript. Word shrinks it
      // itself, so the run keeps the size of the text around it.
      const shift = frag.y === undefined ? 0 : frag.y - line.baseline;
      const raised = frag.size < 0.95 * line.size && Math.abs(shift) >= 0.15 * line.size;
      const vertAlign = raised ? (shift < 0 ? ("superscript" as const) : ("subscript" as const)) : undefined;
      const run: Run = {
        text,
        bold: frag.bold || undefined,
        italic: frag.italic || undefined,
        underline: frag.underline || undefined,
        strike: frag.strike || undefined,
        highlight: frag.highlight,
        vertAlign,
        size: Math.round((vertAlign ? line.size : frag.size) * 2) / 2,
        font: wordFont(frag.font, frag.generic),
        color: frag.color,
        link: frag.link,
      };
      const key = `${run.bold}|${run.italic}|${run.size}|${run.font}|${run.color}|${run.underline}|${run.strike}|${run.highlight}|${run.vertAlign}|${JSON.stringify(run.link)}`;
      const prev = runs[runs.length - 1];
      if (prev && !prev.tab && !prev.field && key === lastKey) prev.text += text;
      else runs.push(run);
      lastKey = key;
    });
  });
  const last = runs[runs.length - 1];
  if (last && !last.tab) last.text = last.text.replace(/\s+$/, "");
  return runs.filter((r) => r.tab || r.field || r.text.length > 0);
}

function dominantSize(lines: Line[]): number {
  const weight = new Map<number, number>();
  for (const line of lines) {
    for (const f of line.frags) {
      const key = Math.round(f.size * 2) / 2;
      weight.set(key, (weight.get(key) ?? 0) + f.text.trim().length);
    }
  }
  let best = lines[0].size;
  let top = -1;
  for (const [size, w] of weight) {
    if (w > top) {
      top = w;
      best = size;
    }
  }
  return best;
}

export type BuildOptions = { lists: boolean; headings: boolean };

export function buildParagraphs(
  ordered: Line[],
  stats: Stats,
  options: BuildOptions,
): BuiltPara[] {
  const accs: Acc[] = [];
  let acc: Acc | null = null;
  const rows = mergeRows(ordered);
  const markers = options.lists ? resolveMarkers(rows) : new Map<Line, Marker>();
  for (const line of rows) {
    if (acc && continues(acc, line, stats, options.lists, markers)) acc.lines.push(line);
    else {
      acc = { lines: [line], marker: options.lists ? markerOf(line, markers) : null };
      accs.push(acc);
    }
  }
  return accs.map((a) => finish(a, stats, options)).filter((p): p is BuiltPara => p !== null);
}

function finish(acc: Acc, stats: Stats, options: BuildOptions): BuiltPara | null {
  const { lines, marker } = acc;
  const runs = toRuns(lines, marker);
  if (!runs.length) return null;
  const first = lines[0];
  const last = lines[lines.length - 1];
  const size = dominantSize(lines);
  const colL = first.colL;
  const colR = first.colR;
  const width = Math.max(1, colR - colL);
  const text = runs.map((r) => r.text).join("");

  const block: ParagraphBlock = { type: "p", runs };

  if (options.headings && !marker && lines.length <= 3 && text.length <= 200) {
    const sizeIdx = stats.headingSizes.findIndex((s) => Math.abs(s - size) <= 0.6);
    if (size >= stats.bodySize * 1.15 && sizeIdx >= 0) {
      block.style = (["Heading1", "Heading2", "Heading3"] as const)[Math.min(sizeIdx, 2)];
    } else if (
      !stats.bodyBold &&
      size >= stats.bodySize * 0.95 &&
      lines.every(allBold) &&
      text.length <= 100 &&
      !/[.,;]$/.test(text)
    ) {
      block.style = (["Heading1", "Heading2", "Heading3"] as const)[
        Math.min(2, stats.headingSizes.length)
      ];
    }
  }

  const centred = lines.every((l) => {
    const mid = (l.x0 + l.x1) / 2;
    return (
      Math.abs(mid - (colL + colR) / 2) <= 0.02 * width + 2 &&
      l.x0 - colL > 0.08 * width &&
      colR - l.x1 > 0.08 * width
    );
  });
  const rightAligned = lines.every((l) => Math.abs(l.x1 - colR) <= 3 && l.x0 - colL > 0.25 * width);
  if (centred) block.align = "center";
  else if (rightAligned) block.align = "right";
  else if (!marker) {
    const bodyLeft = lines.length >= 2 ? lines[1].x0 : first.x0;
    const indent = bodyLeft - colL;
    if (indent > Math.max(6, 0.8 * size)) block.indentLeft = indent;
    if (lines.length >= 2) {
      const firstDelta = first.x0 - bodyLeft;
      if (Math.abs(firstDelta) > Math.max(5, 0.6 * size)) block.firstLine = firstDelta;
    }
  }

  const tabs = new Set<number>();
  for (const l of lines) {
    for (const f of l.frags) if (f.tabBefore) tabs.add(Math.round(f.x0 - colL));
  }
  if (tabs.size) {
    block.tabs = [...tabs].sort((a, b) => a - b).map((pos) => ({ pos, kind: "left" as const }));
  }

  return {
    block,
    meta: {
      firstBaseline: first.baseline,
      lastBaseline: last.baseline,
      firstTop: first.top,
      lastBottom: last.bottom,
      size,
      pitch: pitchOf(acc),
      colL,
      colR,
      marker,
    },
  };
}

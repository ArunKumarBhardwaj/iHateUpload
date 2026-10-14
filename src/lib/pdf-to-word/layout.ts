import { buildLines, lineText, type Line, type PageInput } from "./lines";
import type { Block, DocModel, ListInfo, ParagraphBlock, Run, Section, TableBlock } from "./model";
import { imageEl, lineEl, readingOrder, tableEl, type El } from "./order";
import {
  buildParagraphs,
  mergeRows,
  type BuiltPara,
  type Stats,
} from "./paragraphs";
import { detectBorderlessTables, detectRuledTables, type TableEl } from "./tables";

export type { PageInput, Rule, TextItem, PageImage } from "./lines";

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

type PageWork = {
  input: PageInput;
  lines: Line[];
  ordered: El[];
  colL: number;
  colR: number;
};

type Furniture = { band: "header" | "footer"; rows: Line[][]; pageIndex: number };

const norm = (text: string) => text.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();

/** Pull out rows that repeat at the same height on most pages. */
function takeFurniture(pages: PageInput[], lines: Line[][]): { furniture: Furniture[]; kept: Line[][] } {
  if (pages.length < 2) return { furniture: [], kept: lines };
  type Entry = { band: "header" | "footer"; key: string; pageIndex: number; row: number };
  const entries: Entry[] = [];
  const rowText = new Map<string, string>();
  lines.forEach((pageLines, pageIndex) => {
    const rows = new Map<number, Line[]>();
    for (const l of pageLines) (rows.get(l.row) ?? rows.set(l.row, []).get(l.row)!).push(l);
    const height = pages[pageIndex].height;
    for (const [row, parts] of rows) {
      const y = parts[0].baseline;
      const band = y < height * 0.12 ? "header" : y > height * 0.88 ? "footer" : null;
      if (!band) continue;
      const text = parts
        .sort((a, b) => a.x0 - b.x0)
        .map(lineText)
        .join(" ");
      const key = `${band}|${Math.round(y / 4)}|${norm(text)}`;
      rowText.set(`${pageIndex}:${row}`, key);
      entries.push({ band, key, pageIndex, row });
    }
  });
  const pagesPerKey = new Map<string, Set<number>>();
  for (const e of entries) (pagesPerKey.get(e.key) ?? pagesPerKey.set(e.key, new Set()).get(e.key)!).add(e.pageIndex);
  const need = Math.max(2, Math.ceil(pages.length * 0.6));
  const repeating = new Set([...pagesPerKey].filter(([, set]) => set.size >= need).map(([k]) => k));
  if (!repeating.size) return { furniture: [], kept: lines };

  const furniture: Furniture[] = [];
  const seen = new Set<string>();
  const kept = lines.map((pageLines, pageIndex) => {
    const out: Line[] = [];
    const taken = new Map<number, Line[]>();
    for (const l of pageLines) {
      const key = rowText.get(`${pageIndex}:${l.row}`);
      if (key && repeating.has(key)) (taken.get(l.row) ?? taken.set(l.row, []).get(l.row)!).push(l);
      else out.push(l);
    }
    for (const parts of taken.values()) {
      const key = rowText.get(`${pageIndex}:${parts[0].row}`)!;
      if (seen.has(key)) continue;
      seen.add(key);
      furniture.push({
        band: key.startsWith("header") ? "header" : "footer",
        rows: [parts.sort((a, b) => a.x0 - b.x0)],
        pageIndex,
      });
    }
    return out;
  });
  return { furniture, kept };
}

function withFields(runs: Run[], pageNo: number, total: number): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    if (run.tab || run.field) {
      out.push(run);
      continue;
    }
    for (const part of run.text.split(/(\d+)/)) {
      if (!part) continue;
      if (part === String(pageNo)) out.push({ ...run, text: "", field: "PAGE" });
      else if (part === String(total) && total > 1) out.push({ ...run, text: "", field: "NUMPAGES" });
      else out.push({ ...run, text: part });
    }
  }
  return out;
}

function furnitureParagraph(
  f: Furniture,
  total: number,
  colL: number,
  colR: number,
  stats: Stats,
): ParagraphBlock | null {
  const [merged] = mergeRows(f.rows[0].map((l) => ({ ...l, colL, colR })));
  if (!merged) return null;
  const built = buildParagraphs([{ ...merged, colL, colR }], stats, { lists: false, headings: false })[0];
  if (!built) return null;
  const block = built.block;
  block.runs = withFields(block.runs, f.pageIndex + 1, total);
  const segs: { x0: number; x1: number }[] = [];
  for (const frag of merged.frags) {
    if (frag.tabBefore || !segs.length) segs.push({ x0: frag.x0, x1: frag.x1 });
    else segs[segs.length - 1].x1 = frag.x1;
  }
  if (segs.length > 1) {
    const mid = (colL + colR) / 2;
    block.tabs = segs.slice(1).map((s) => {
      if (Math.abs(s.x1 - colR) <= 6) return { pos: colR - colL, kind: "right" as const };
      if (Math.abs((s.x0 + s.x1) / 2 - mid) <= 8) return { pos: mid - colL, kind: "center" as const };
      return { pos: s.x0 - colL, kind: "left" as const };
    });
  }
  return block;
}

function computeStats(pages: PageWork[]): Stats {
  const chars = new Map<number, number>();
  const boldChars = new Map<number, number>();
  let total = 0;
  const key = (s: number) => Math.round(s * 2) / 2;
  for (const p of pages) {
    const lines = [
      ...p.lines,
      ...p.ordered.flatMap((e) => (e.kind === "table" ? e.table.cells.flatMap((c) => c.lines) : [])),
    ];
    for (const l of lines) {
      for (const f of l.frags) {
        const n = f.text.trim().length;
        if (!n) continue;
        chars.set(key(f.size), (chars.get(key(f.size)) ?? 0) + n);
        if (f.bold) boldChars.set(key(f.size), (boldChars.get(key(f.size)) ?? 0) + n);
        total += n;
      }
    }
  }
  let bodySize = 11;
  let best = -1;
  for (const [s, n] of chars) {
    if (n > best) {
      best = n;
      bodySize = s;
    }
  }
  const big = [...chars]
    .filter(([s, n]) => s >= bodySize * 1.15 && n / Math.max(1, total) < 0.3)
    .map(([s]) => s)
    .sort((a, b) => b - a);
  const headingSizes: number[] = [];
  for (const s of big) if (!headingSizes.length || headingSizes[headingSizes.length - 1] - s > 0.6) headingSizes.push(s);

  const buckets = new Map<number, number>();
  for (const p of pages) {
    const lines = p.ordered.filter((e) => e.kind === "line").map((e) => (e as { line: Line }).line);
    const rows = mergeRows(lines);
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      if (Math.abs(a.size - b.size) > 0.5 || Math.abs(a.size - bodySize) > 0.5) continue;
      if (Math.abs(a.x0 - b.x0) > 3 * a.size) continue;
      const ratio = (b.baseline - a.baseline) / a.size;
      if (ratio < 0.95 || ratio > 2.6) continue;
      const bucket = Math.round(ratio * 20) / 20;
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
  }
  let pitchRatio = 1.2;
  let top = 0;
  for (const [ratio, n] of buckets) {
    if (n > top || (n === top && ratio < pitchRatio)) {
      top = n;
      pitchRatio = ratio;
    }
  }
  const bodyBold = (boldChars.get(key(bodySize)) ?? 0) / Math.max(1, chars.get(key(bodySize)) ?? 1) > 0.5;
  return { bodySize, pitchRatio, headingSizes, bodyBold, chars: total };
}

function tableBlock(table: TableEl, stats: Stats, left: number): TableBlock {
  const rows = table.ys.length - 1;
  const cols = table.xs.length - 1;
  const out: TableBlock["rows"] = [];
  for (let r = 0; r < rows; r++) {
    const row: TableBlock["rows"][number] = [];
    let c = 0;
    while (c < cols) {
      const cell = table.cells.find(
        (k) => k.row <= r && r < k.row + k.rowSpan && k.col <= c && c < k.col + k.colSpan,
      );
      if (!cell) {
        row.push({ paragraphs: [{ type: "p", runs: [] }], colSpan: 1 });
        c++;
        continue;
      }
      if (cell.row === r) {
        const lines = [...cell.lines].sort((a, b) => a.baseline - b.baseline || a.x0 - b.x0);
        const paragraphs = buildParagraphs(lines, stats, { lists: false, headings: false }).map(
          (p) => p.block,
        );
        row.push({
          paragraphs: paragraphs.length ? paragraphs : [{ type: "p", runs: [] }],
          colSpan: cell.colSpan,
          vMerge: cell.rowSpan > 1 ? "restart" : undefined,
        });
      } else {
        row.push({ paragraphs: [{ type: "p", runs: [] }], colSpan: cell.colSpan, vMerge: "continue" });
      }
      c += cell.colSpan;
    }
    out.push(row);
  }
  return {
    type: "table",
    colWidths: table.xs.slice(1).map((x, i) => x - table.xs[i]),
    rows: out,
    borders: table.borders,
    indentLeft: Math.max(0, table.x0 - left),
  };
}

type ListState = { key: string; markerX: number; instance: number };

export function layoutDocument(inputs: PageInput[]): DocModel {
  const lineSets = inputs.map((p) => buildLines(p.items));
  const { furniture, kept } = takeFurniture(inputs, lineSets);

  // Margins shared by the pages: where text usually starts and ends.
  const spans = kept
    .filter((l) => l.length)
    .map((l) => ({ min: Math.min(...l.map((x) => x.x0)), max: Math.max(...l.map((x) => x.x1)) }));
  const docLeft = median(spans.map((s) => s.min));
  const docRight = median(spans.map((s) => s.max));

  const works: PageWork[] = inputs.map((input, index) => {
    const raw = kept[index];
    const pageMin = raw.length ? Math.min(...raw.map((l) => l.x0)) : docLeft;
    const pageMax = raw.length ? Math.max(...raw.map((l) => l.x1)) : docRight;
    const colL = raw.length ? Math.min(docLeft || pageMin, pageMin) : 72;
    const colR = raw.length ? Math.max(docRight || pageMax, pageMax) : input.width - 72;
    const ruled = detectRuledTables(raw, input.rules);
    const loose = detectBorderlessTables(ruled.rest);
    const tables: TableEl[] = [...ruled.tables, ...loose.tables];
    const pageArea = input.width * input.height;
    const images = input.images.filter(
      (im) => !(im.w * im.h >= pageArea * 0.85 && raw.length > 0) && im.w > 3 && im.h > 3,
    );
    for (const l of loose.rest) {
      l.colL = colL;
      l.colR = colR;
    }
    const els: El[] = [...loose.rest.map(lineEl), ...tables.map(tableEl), ...images.map(imageEl)];
    return {
      input,
      lines: loose.rest,
      ordered: readingOrder(els, colL, colR),
      colL,
      colR,
    };
  });

  const docStats = computeStats(works);
  // A page set in a very different size (a scan read by OCR, say) is judged on its own.
  const pageStats = works.map((work) => {
    const own = computeStats([work]);
    return own.chars >= 80 && Math.abs(own.bodySize - docStats.bodySize) > 0.15 * docStats.bodySize
      ? own
      : docStats;
  });
  const stats = docStats;

  const notes: string[] = [];
  const header: ParagraphBlock[] = [];
  const footer: ParagraphBlock[] = [];
  const furnitureTops = { header: 0, footer: 0 };
  for (const f of furniture) {
    const work = works[f.pageIndex];
    const block = furnitureParagraph(f, inputs.length, work.colL, work.colR, stats);
    if (!block) continue;
    (f.band === "header" ? header : footer).push(block);
    const line = f.rows[0][0];
    if (f.band === "header") furnitureTops.header = furnitureTops.header || line.top;
    else furnitureTops.footer = Math.max(furnitureTops.footer, inputs[f.pageIndex].height - line.bottom);
  }

  let instance = 0;
  let active: ListState[] = [];

  const sections: Section[] = works.map((work, workIndex) => {
    const { input } = work;
    const stats = pageStats[workIndex];
    const blocks: Block[] = [];
    let pending: Line[] = [];
    let prevPara: BuiltPara | null = null;
    let prevBottom: number | null = null;
    let top = Infinity;
    let bottom = -Infinity;

    const flush = () => {
      if (!pending.length) return;
      const paras = buildParagraphs(pending, stats, { lists: true, headings: true });
      pending = [];
      for (const para of paras) {
        const { block, meta } = para;
        top = Math.min(top, meta.firstTop);
        bottom = Math.max(bottom, meta.lastBottom);

        if (meta.marker) {
          const key = `${meta.marker.kind}|${meta.marker.suffix}`;
          active = active.filter((a) => a.markerX <= meta.marker!.markerX + 1);
          let state = active.find((a) => a.key === key && Math.abs(a.markerX - meta.marker!.markerX) <= 4);
          let isNew = false;
          if (!state) {
            state = { key, markerX: meta.marker.markerX, instance: ++instance };
            active.push(state);
            isNew = true;
          }
          const leftIndent = Math.max(12, meta.marker.textX - meta.colL);
          const info: ListInfo = {
            instance: state.instance,
            kind: meta.marker.kind,
            suffix: meta.marker.suffix,
            start: isNew ? meta.marker.start : 1,
            leftIndent,
            hanging: Math.min(leftIndent, Math.max(10, meta.marker.textX - meta.marker.markerX)),
          };
          block.list = info;
        } else {
          active = [];
        }

        if (prevPara && meta.firstBaseline > prevPara.meta.lastBaseline && blocks[blocks.length - 1] === prevPara.block) {
          const expected = meta.pitch ?? stats.pitchRatio * meta.size;
          const gap = meta.firstBaseline - prevPara.meta.lastBaseline - expected;
          if (gap > 1.5) block.spaceBefore = Math.round(gap * 10) / 10;
        } else if (prevBottom !== null && meta.firstTop - prevBottom > 1.5) {
          block.spaceBefore = Math.round((meta.firstTop - prevBottom) * 10) / 10;
        }
        const ratio = (meta.pitch ?? stats.pitchRatio * meta.size) / (1.15 * meta.size);
        if (Math.abs(ratio - 1) > 0.06) block.lineRatio = Math.round(Math.min(3, Math.max(0.7, ratio)) * 100) / 100;
        blocks.push(block);
        prevPara = para;
        prevBottom = null;
      }
    };

    for (const el of work.ordered) {
      if (el.kind === "line") {
        pending.push(el.line);
        continue;
      }
      flush();
      active = [];
      top = Math.min(top, el.top);
      bottom = Math.max(bottom, el.bottom);
      const spaceBefore = prevBottom !== null && el.top - prevBottom > 1.5 ? el.top - prevBottom : undefined;
      if (el.kind === "table") {
        blocks.push(tableBlock(el.table, stats, work.colL));
      } else {
        const maxW = Math.max(40, work.colR - work.colL);
        const scale = Math.min(1, maxW / el.image.w);
        blocks.push({
          type: "image",
          ref: el.image.ref,
          width: el.image.w * scale,
          height: el.image.h * scale,
          indentLeft: Math.max(0, el.image.x - work.colL) > 6 ? el.image.x - work.colL : undefined,
          spaceBefore,
        });
      }
      prevPara = null;
      prevBottom = el.bottom;
    }
    flush();

    const hasContent = Number.isFinite(top);
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const margins = {
      left: clamp(work.colL, 18, input.width * 0.4),
      right: clamp(input.width - work.colR, 18, input.width * 0.4),
      top: hasContent ? clamp(top, 18, input.height * 0.4) : 72,
      bottom: hasContent ? clamp(input.height - bottom - 14, 28, input.height * 0.4) : 72,
    };
    return {
      width: input.width,
      height: input.height,
      margins,
      blocks,
      headerDistance: furnitureTops.header ? Math.max(12, furnitureTops.header - 6) : undefined,
      footerDistance: furnitureTops.footer ? Math.max(12, furnitureTops.footer - 6) : undefined,
    };
  });

  return { sections, header, footer, notes };
}

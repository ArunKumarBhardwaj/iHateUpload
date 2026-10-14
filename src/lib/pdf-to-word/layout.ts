import type { OutlineEntry } from "./annotations";
import { applyBullets } from "./bullets";
import { applyLinks } from "./links";
import { buildLines, lineText, type Fill, type Line, type PageInput } from "./lines";
import type { Block, DocModel, ListInfo, ParagraphBlock, Run, Section, TableBlock } from "./model";
import { imageEl, lineEl, readingOrder, tableEl, type El, type Region } from "./order";
import {
  buildParagraphs,
  mergeRows,
  type BuiltPara,
  type Stats,
} from "./paragraphs";
import { detectBorderlessTables, detectRuledTables, type GridCell, type TableEl } from "./tables";

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

/** The colour painted over most of a cell, if any. The last one painted wins. */
function shadeOf(cell: GridCell, fills: Fill[]): string | undefined {
  const area = (cell.x1 - cell.x0) * (cell.y1 - cell.y0);
  if (!(area > 0)) return undefined;
  for (let i = fills.length - 1; i >= 0; i--) {
    const f = fills[i];
    const w = Math.min(f.x1, cell.x1) - Math.max(f.x0, cell.x0);
    const h = Math.min(f.y1, cell.y1) - Math.max(f.y0, cell.y0);
    if (w > 0 && h > 0 && (w * h) / area >= 0.7) return f.color.toUpperCase();
  }
  return undefined;
}

function tableBlock(table: TableEl, stats: Stats, left: number, fills: Fill[] = []): TableBlock {
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
          shade: shadeOf(cell, fills),
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

/** Column widths from where each column starts, and the gap from the narrowest space between them. */
function columnSpec(region: Region, colL: number, colR: number): NonNullable<Section["columns"]> {
  const { boxes } = region;
  let gap = Infinity;
  for (let i = 1; i < boxes.length; i++) gap = Math.min(gap, boxes[i].x0 - boxes[i - 1].x1);
  gap = Math.max(12, Math.round(gap * 10) / 10);
  const starts = boxes.map((b, i) => (i === 0 ? colL : b.x0));
  const widths = starts.map((x, i) => Math.max(24, (i < starts.length - 1 ? starts[i + 1] - gap : colR) - x));
  return { widths, gap };
}

const cellText = (c: TableBlock["rows"][number][number]) =>
  c.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join(" ").trim();
const rowText = (row: TableBlock["rows"][number]) => row.map(cellText).join("\u0001");

/** The table that closes one page and the one that opens the next are the same table when their grids agree. */
function continuesTable(a: PageWork, b: PageWork, prev: Section, next: Section): boolean {
  const last = a.ordered[a.ordered.length - 1];
  const first = b.ordered[0];
  if (last?.kind !== "table" || first?.kind !== "table") return false;
  if (last.bottom < a.input.height * 0.7 || first.top > b.input.height * 0.3) return false;
  if (prev.columns || next.columns || next.start === "continuous") return false;
  if (prev.width !== next.width || prev.height !== next.height) return false;
  const t1 = prev.blocks[prev.blocks.length - 1];
  const t2 = next.blocks[0];
  if (t1?.type !== "table" || t2?.type !== "table") return false;
  return (
    t1.colWidths.length === t2.colWidths.length &&
    t1.borders === t2.borders &&
    Math.abs(t1.indentLeft - t2.indentLeft) <= 4 &&
    t1.colWidths.every((w, i) => Math.abs(w - t2.colWidths[i]) <= 3)
  );
}

/** Move the next page's table rows (and whatever follows) onto the previous page's table. */
function joinTables(prev: Section, next: Section) {
  const t1 = prev.blocks[prev.blocks.length - 1] as TableBlock;
  const t2 = next.blocks[0] as TableBlock;
  const repeated = t1.rows.length > 1 && t2.rows.length > 0 && rowText(t1.rows[0]) === rowText(t2.rows[0]);
  if (repeated && rowText(t1.rows[0]).replace(/\u0001/g, "").length > 0) {
    t1.headerRows = Math.max(t1.headerRows ?? 0, 1);
    t1.rows.push(...t2.rows.slice(1));
  } else t1.rows.push(...t2.rows);
  prev.blocks.push(...next.blocks.slice(1));
}

/** Put a bookmark on the paragraph each internal link points at: the first one at or below its height. */
function placeBookmarks(inputs: PageInput[], placed: { block: ParagraphBlock; top: number; bottom: number }[][]) {
  const seen = new Set<string>();
  for (const input of inputs) {
    for (const link of input.links ?? []) {
      const anchor = link.anchor;
      if (!anchor || seen.has(anchor.name)) continue;
      seen.add(anchor.name);
      const onPage = placed[anchor.page];
      if (!onPage?.length) continue;
      const below = onPage.filter((p) => p.bottom >= anchor.y - 2).sort((a, b) => a.top - b.top)[0];
      const target = below ?? [...onPage].sort((a, b) => b.top - a.top)[0];
      (target.block.bookmarks ??= []).push(anchor.name);
    }
  }
}

const plain = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const blockText = (b: ParagraphBlock) => plain(b.runs.map((r) => r.text).join(""));

/** The outline is the author's own list of headings, so its entries set the heading levels. */
function applyOutline(outline: OutlineEntry[], placed: { block: ParagraphBlock; top: number; bottom: number }[][]) {
  for (const entry of outline) {
    const onPage = placed[entry.anchor.page];
    const want = plain(entry.title);
    if (!onPage?.length || want.length < 2) continue;
    const near = onPage.filter((p) => p.bottom >= entry.anchor.y - 2).sort((a, b) => a.top - b.top);
    const matches = (p: { block: ParagraphBlock }) => {
      const got = blockText(p.block);
      return got.length > 0 && (got === want || got.startsWith(want) || want.startsWith(got));
    };
    const hit = near.find(matches) ?? onPage.find(matches);
    if (!hit || hit.block.list) continue;
    const levels = ["Heading1", "Heading2", "Heading3", "Heading4", "Heading5", "Heading6"] as const;
    hit.block.style = levels[Math.min(entry.level, 5)];
  }
}

type ListState = { key: string; markerX: number; instance: number; level: number };

export type LayoutOptions = {
  /** The PDF's own outline: its entries name headings and their depth. */
  outline?: OutlineEntry[];
};

export function layoutDocument(inputs: PageInput[], options: LayoutOptions = {}): DocModel {
  const lineSets = inputs.map((p) => {
    const lines = buildLines(p.items);
    applyBullets(lines, p.bullets);
    applyLinks(lines, p.links);
    return lines;
  });
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
  // Every paragraph placed on a page with its top, so link and outline targets can find theirs.
  const placed: { block: ParagraphBlock; top: number; bottom: number }[][] = works.map(() => []);

  const pageSections: Section[][] = works.map((work, workIndex) => {
    const { input } = work;
    const stats = pageStats[workIndex];
    let blocks: Block[] = [];
    // A page is cut into pieces wherever the number of text columns changes.
    const pieces: { blocks: Block[]; region?: Region }[] = [{ blocks }];
    let region: Region | undefined;
    let columnBreak = false;
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
        placed[workIndex].push({ block, top: meta.firstTop, bottom: meta.lastBottom });

        if (meta.marker) {
          const m = meta.marker;
          const key = `${m.kind}|${m.suffix}|${m.glyph ?? ""}`;
          // Markers further right than the one before are a deeper level of that list.
          active = active.filter((a) => a.markerX <= m.markerX + 4);
          let state = active.find((a) => Math.abs(a.markerX - m.markerX) <= 4);
          let isNew = false;
          if (state && state.key !== key) {
            active = active.filter((a) => a.markerX < state!.markerX - 4);
            state = undefined;
          }
          if (!state) {
            const parent = active[active.length - 1];
            state = {
              key,
              markerX: m.markerX,
              instance: parent ? parent.instance : ++instance,
              level: parent ? parent.level + 1 : 0,
            };
            active.push(state);
            isNew = true;
          }
          const leftIndent = Math.max(12, m.textX - meta.colL);
          const info: ListInfo = {
            instance: state.instance,
            level: Math.min(8, state.level),
            kind: m.kind,
            glyph: m.glyph,
            suffix: m.suffix,
            start: isNew ? m.start : 1,
            leftIndent,
            hanging: Math.min(leftIndent, Math.max(10, m.textX - m.markerX)),
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
        if (columnBreak) {
          block.columnBreakBefore = true;
          columnBreak = false;
        }
        blocks.push(block);
        prevPara = para;
        prevBottom = null;
      }
    };

    for (const el of work.ordered) {
      if (el.region?.id !== region?.id) {
        flush();
        active = [];
        prevPara = null;
        if (blocks.length) {
          blocks = [];
          pieces.push({ blocks, region: el.region });
        } else pieces[pieces.length - 1].region = el.region;
        columnBreak = false;
      } else if (el.region && region && el.region.index !== region.index) {
        flush();
        active = [];
        columnBreak = true;
      }
      region = el.region;
      if (el.kind === "line") {
        pending.push(el.line);
        continue;
      }
      flush();
      active = [];
      if (columnBreak) {
        blocks.push({ type: "p", runs: [], columnBreakBefore: true });
        columnBreak = false;
      }
      top = Math.min(top, el.top);
      bottom = Math.max(bottom, el.bottom);
      const spaceBefore = prevBottom !== null && el.top - prevBottom > 1.5 ? el.top - prevBottom : undefined;
      if (el.kind === "table") {
        blocks.push(tableBlock(el.table, stats, work.colL, input.fills));
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
    // Text rarely reaches the right or bottom margin (ragged lines, short pages), so where it
    // ends overstates those margins. Cap them by the left/top ones so Word has room to reflow.
    const left = clamp(work.colL, 18, input.width * 0.4);
    const topMargin = hasContent ? clamp(top, 18, input.height * 0.4) : 72;
    const margins = {
      left,
      right: clamp(input.width - work.colR, 18, Math.max(left * 1.5, 36)),
      top: topMargin,
      bottom: hasContent ? clamp(input.height - bottom - 14, 28, Math.max(topMargin, 36)) : 72,
    };
    return pieces.map((piece, i): Section => ({
      width: input.width,
      height: input.height,
      margins,
      blocks: piece.blocks,
      start: i > 0 ? "continuous" : undefined,
      columns: piece.region ? columnSpec(piece.region, work.colL, work.colR) : undefined,
      headerDistance: furnitureTops.header ? Math.max(12, furnitureTops.header - 6) : undefined,
      footerDistance: furnitureTops.footer ? Math.max(12, furnitureTops.footer - 6) : undefined,
    }));
  });

  const sections: Section[] = [];
  pageSections.forEach((secs, w) => {
    const prev = sections[sections.length - 1];
    if (w > 0 && prev && continuesTable(works[w - 1], works[w], prev, secs[0])) {
      joinTables(prev, secs[0]);
      sections.push(...secs.slice(1));
    } else sections.push(...secs);
  });
  placeBookmarks(inputs, placed);
  applyOutline(options.outline ?? [], placed);
  return { sections, header, footer, notes };
}

import { loadPdfJs } from "@/lib/pdfjs";

/** One output file: zero-based inclusive page span plus a name without ".pdf". */
export type SplitPart = { name: string; start: number; end: number };

export type OutlineItem = { title: string; page: number; depth: number };

export type TextSplitOptions = {
  phrase: string;
  regex: boolean;
  matchCase: boolean;
  wholeWord: boolean;
};

export type TextPlan =
  | { ok: true; parts: SplitPart[] }
  | { ok: false; error: string };

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const NAME_MAX = 80;
const FRONT = "Front matter";

/** A bookmark title as a file name that every OS accepts. */
export function sanitizeFileName(title: string, max = NAME_MAX): string {
  let name = title
     
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .trim()
    .replace(/^[.\s-]+/, "")
    .replace(/[.\s-]+$/, "");
  if (name.length > max) name = name.slice(0, max).trim();
  if (!name) return "untitled";
  if (RESERVED.test(name)) return `${name}-`;
  return name;
}

function pad(count: number) {
  return Math.max(2, String(count).length);
}

function numbered(base: string, index: number, count: number, label: string) {
  return `${base}-${String(index + 1).padStart(pad(count), "0")}-${label}`;
}

/** Turns the start pages of each part into spans that cover the whole file. */
function spansFromStarts(
  starts: { page: number; label: string }[],
  pageCount: number,
  base: string,
): SplitPart[] {
  const cuts = [...starts];
  if (cuts.length === 0 || cuts[0].page > 0) {
    cuts.unshift({ page: 0, label: FRONT });
  }
  return cuts.map((cut, index) => ({
    name: numbered(base, index, cuts.length, cut.label),
    start: cut.page,
    end: (cuts[index + 1]?.page ?? pageCount) - 1,
  }));
}

/**
 * Bookmarks down to `depth` (1 = top level), one per page, in page order.
 * `off` lists indexes into that list the user switched off; their pages fold
 * into the part before. Pages ahead of the first bookmark become front matter.
 */
export function bookmarkCandidates(items: OutlineItem[], depth: number) {
  const seen = new Set<number>();
  const picked: OutlineItem[] = [];
  items
    .filter((item) => item.depth <= depth)
    .map((item, order) => ({ item, order }))
    .sort((a, b) => a.item.page - b.item.page || a.order - b.order)
    .forEach(({ item }) => {
      if (seen.has(item.page)) return;
      seen.add(item.page);
      picked.push(item);
    });
  return picked;
}

export function planByBookmarks(
  items: OutlineItem[],
  pageCount: number,
  depth: number,
  base: string,
  off: number[],
): SplitPart[] {
  const skip = new Set(off);
  const starts = bookmarkCandidates(items, depth)
    .filter((_, index) => !skip.has(index))
    .filter((item) => item.page >= 0 && item.page < pageCount)
    .map((item) => ({ page: item.page, label: sanitizeFileName(item.title) }));
  return spansFromStarts(starts, pageCount, base);
}

function textMatcher(options: TextSplitOptions): RegExp | string {
  const phrase = options.phrase.trim();
  if (!phrase) return "Type the text to split before.";
  let source: string;
  if (options.regex) {
    source = phrase;
  } else {
    source = phrase
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
  }
  if (options.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(source, `u${options.matchCase ? "" : "i"}m`);
  } catch {
    return "That is not a valid pattern.";
  }
}

/** Split before every page whose text matches; match text titles each file. */
export function planByText(
  pageTexts: string[],
  options: TextSplitOptions,
  base: string,
): TextPlan {
  const matcher = textMatcher(options);
  if (typeof matcher === "string") return { ok: false, error: matcher };
  const starts: { page: number; label: string }[] = [];
  pageTexts.forEach((text, page) => {
    const hit = matcher.exec(text);
    if (!hit) return;
    const label = sanitizeFileName(hit[0].replace(/\s+/g, " "), 40);
    starts.push({ page, label: hit[0].trim() ? label : "part" });
  });
  if (starts.length === 0) {
    const hasText = pageTexts.some((text) => text.trim().length > 0);
    return {
      ok: false,
      error: hasText
        ? `No page contains “${options.phrase.trim()}”.`
        : "This PDF has no selectable text. Run OCR PDF first if it is a scan.",
    };
  }
  return { ok: true, parts: spansFromStarts(starts, pageTexts.length, base) };
}

export function partNote(part: SplitPart) {
  return part.start === part.end
    ? `Page ${part.start + 1}`
    : `Pages ${part.start + 1}-${part.end + 1}`;
}

type TextItem = { str: string; transform: number[]; width: number; height: number };

/** One page's text: lines top to bottom, words rejoined by their gaps. */
export function pageTextFromItems(items: unknown[]): string {
  const lines: { y: number; text: string; end: number }[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object" || !("str" in raw)) continue;
    const item = raw as TextItem;
    if (typeof item.str !== "string" || item.str === "") continue;
    const x = Number(item.transform?.[4]) || 0;
    const y = Number(item.transform?.[5]) || 0;
    const size = Number(item.height) || 10;
    const line = lines.find((entry) => Math.abs(entry.y - y) <= size * 0.4);
    if (line) {
      const gap = x - line.end;
      const needsSpace =
        gap > size * 0.15 && !line.text.endsWith(" ") && !item.str.startsWith(" ");
      line.text += (needsSpace ? " " : "") + item.str;
      line.end = Math.max(line.end, x + (Number(item.width) || 0));
    } else {
      lines.push({ y, text: item.str, end: x + (Number(item.width) || 0) });
    }
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => line.text.trim())
    .join("\n");
}

export async function readPageTexts(data: Uint8Array): Promise<string[]> {
  const { getDocument } = await loadPdfJs();
  const doc = await getDocument({ data: data.slice() }).promise;
  try {
    const out: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      out.push(pageTextFromItems((await page.getTextContent()).items));
      page.cleanup();
    }
    return out;
  } finally {
    await doc.loadingTask.destroy();
  }
}

type RawOutline = { title?: string; dest?: unknown; items?: RawOutline[] };

/** Every bookmark with the page it jumps to, depth first; unresolved ones are skipped. */
export async function readOutline(data: Uint8Array): Promise<OutlineItem[]> {
  const { getDocument } = await loadPdfJs();
  const doc = await getDocument({ data: data.slice() }).promise;
  try {
    const tree = (await doc.getOutline()) as RawOutline[] | null;
    if (!tree) return [];
    const out: OutlineItem[] = [];
    const pageOf = async (dest: unknown): Promise<number | null> => {
      try {
        const resolved =
          typeof dest === "string" ? await doc.getDestination(dest) : dest;
        if (!Array.isArray(resolved) || resolved.length === 0) return null;
        const target = resolved[0];
        if (typeof target === "number") return target;
        if (target && typeof target === "object") {
          return await doc.getPageIndex(target as never);
        }
      } catch {
        // A broken destination just drops that bookmark.
      }
      return null;
    };
    const walk = async (nodes: RawOutline[], depth: number) => {
      for (const node of nodes) {
        const page = node.dest ? await pageOf(node.dest) : null;
        if (page !== null) {
          out.push({ title: (node.title ?? "").trim() || "untitled", page, depth });
        }
        if (node.items?.length) await walk(node.items, depth + 1);
      }
    };
    await walk(tree, 1);
    return out;
  } finally {
    await doc.loadingTask.destroy();
  }
}

export function outlineDepth(items: OutlineItem[]) {
  return items.reduce((max, item) => Math.max(max, item.depth), 0);
}

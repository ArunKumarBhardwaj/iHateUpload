import {
  parsePageRange,
  parseRangeGroups,
  type ToolOptions,
} from "@/lib/tool-options";

type SplitOptions = Extract<ToolOptions, { kind: "split" }>;

/** One output file of a page-number split: its zero-based pages and file name. */
export type SplitGroup = { pages: number[]; name: string };

export type SplitGroupPlan =
  | { ok: true; groups: SplitGroup[]; merged: boolean }
  | { ok: false; error: string };

/** Modes whose files follow from page numbers alone, so they can be previewed at once. */
export function isPageNumberMode(mode: SplitOptions["mode"]): boolean {
  return (
    mode === "pages" ||
    mode === "ranges" ||
    mode === "fixed" ||
    mode === "half" ||
    mode === "select"
  );
}

function span(pages: number[]) {
  const first = pages[0] + 1;
  const last = pages[pages.length - 1] + 1;
  return first === last ? `${first}` : `${first}-${last}`;
}

/**
 * The files a page-number split makes, in order. The workbench preview and the
 * processor both read this, so what the grid shows is what downloads.
 */
export function planSplitGroups(
  options: SplitOptions,
  count: number,
  base: string,
): SplitGroupPlan {
  if (count < 1) return { ok: false, error: "This PDF has no pages." };
  const all = Array.from({ length: count }, (_, i) => i);
  const merge = options.merge ?? false;

  switch (options.mode) {
    case "pages":
      return {
        ok: true,
        merged: false,
        groups: all.map((i) => ({ pages: [i], name: `${base}-page-${i + 1}.pdf` })),
      };
    case "half": {
      if (count < 2) return { ok: false, error: "Splitting in half needs at least 2 pages." };
      const mid = Math.ceil(count / 2);
      return {
        ok: true,
        merged: false,
        groups: [
          { pages: all.slice(0, mid), name: `${base}-part-1.pdf` },
          { pages: all.slice(mid), name: `${base}-part-2.pdf` },
        ],
      };
    }
    case "fixed": {
      const n = Math.floor(options.everyN ?? 2);
      if (!(n >= 1)) return { ok: false, error: "Enter how many pages each file should have." };
      const groups: SplitGroup[] = [];
      for (let start = 0; start < count; start += n) {
        const pages = all.slice(start, start + n);
        groups.push({ pages, name: `${base}-pages-${span(pages)}.pdf` });
      }
      return { ok: true, merged: false, groups };
    }
    case "ranges": {
      const parts = parseRangeGroups(options.ranges, count);
      if (parts.length === 0) {
        return {
          ok: false,
          error: options.ranges.trim()
            ? `No pages between 1 and ${count} in those ranges.`
            : "Add a range, like 1-3.",
        };
      }
      if (merge) {
        return {
          ok: true,
          merged: true,
          groups: [{ pages: parts.flat(), name: `${base}-ranges.pdf` }],
        };
      }
      return {
        ok: true,
        merged: false,
        groups: parts.map((pages) => ({ pages, name: `${base}-pages-${span(pages)}.pdf` })),
      };
    }
    case "select": {
      const pages = parsePageRange(options.pick ?? "", count);
      if (pages.length === 0) {
        return {
          ok: false,
          error: (options.pick ?? "").trim()
            ? `No pages between 1 and ${count} in "${(options.pick ?? "").trim()}".`
            : "Click the pages to extract, or type them like 2, 5-7.",
        };
      }
      if (merge) {
        return {
          ok: true,
          merged: true,
          groups: [{ pages, name: `${base}-extracted.pdf` }],
        };
      }
      return {
        ok: true,
        merged: false,
        groups: pages.map((i) => ({ pages: [i], name: `${base}-page-${i + 1}.pdf` })),
      };
    }
    default:
      return { ok: false, error: "This split mode is planned from the PDF's content." };
  }
}

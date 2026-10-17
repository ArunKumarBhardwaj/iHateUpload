import { resolvePageRange } from "@/lib/tool-options";

export type StampContext = {
  pages: number;
  date: string;
  time: string;
  filename: string;
};

export function expandStamp(template: string, page: number, ctx: StampContext) {
  return template
    .replaceAll("{pages}", String(ctx.pages))
    .replaceAll("{page}", String(page))
    .replaceAll("{date}", ctx.date)
    .replaceAll("{time}", ctx.time)
    .replaceAll("{filename}", ctx.filename);
}

export type StampLayoutInput = {
  left: string;
  center: string;
  right: string;
  band: "header" | "footer" | "both";
  fontSize: number;
  margin: number;
};

export type PlacedStamp = {
  text: string;
  /** Left edge, PDF points. */
  x: number;
  /** Baseline, PDF points from the bottom. */
  y: number;
};

/** Where each non-empty piece sits. Strings are already expanded. */
export function placeStamps(
  input: StampLayoutInput,
  pageWidth: number,
  pageHeight: number,
  widthOf: (text: string) => number,
): PlacedStamp[] {
  const rows: number[] = [];
  if (input.band !== "footer") rows.push(pageHeight - input.margin - input.fontSize);
  if (input.band !== "header") rows.push(input.margin);
  const out: PlacedStamp[] = [];
  for (const y of rows) {
    if (input.left.trim()) out.push({ text: input.left, x: input.margin, y });
    if (input.center.trim()) {
      out.push({ text: input.center, x: (pageWidth - widthOf(input.center)) / 2, y });
    }
    if (input.right.trim()) {
      out.push({
        text: input.right,
        x: pageWidth - input.margin - widthOf(input.right),
        y,
      });
    }
  }
  return out;
}

/** Zero-based pages that get a stamp. */
export function stampedPages(
  range: string,
  skipFirst: boolean,
  pageCount: number,
): Set<number> {
  const pages = new Set(resolvePageRange(range, pageCount));
  if (skipFirst) pages.delete(0);
  return pages;
}

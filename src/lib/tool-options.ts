import type { ToolDefinition } from "@/lib/tools";

export type CompressLevel = "light" | "medium" | "heavy";

export type ToolOptions =
  | { kind: "none" }
  | { kind: "password"; password: string }
  | { kind: "password-confirm"; password: string }
  | { kind: "rotate"; degrees: 90 | 180 | 270 }
  | { kind: "organize"; pageOrder: number[] }
  | { kind: "resize"; maxEdge: number }
  | { kind: "compress"; level: CompressLevel }
  | { kind: "extract"; range: string; pageCount: number };

export const RESIZE_PRESETS = [1920, 1280, 800, 640] as const;
export const RESIZE_MIN = 16;
export const RESIZE_MAX = 10000;

export const COMPRESS_LEVELS: {
  id: CompressLevel;
  title: string;
  result: string;
  use: string;
  recommended?: boolean;
}[] = [
  {
    id: "light",
    title: "Light",
    result: "Keeps text selectable",
    use: "Contracts, forms, anything you still need to copy",
    recommended: true,
  },
  {
    id: "medium",
    title: "Medium",
    result: "Smaller for email",
    use: "Scans and photo-heavy PDFs",
  },
  {
    id: "heavy",
    title: "Smallest",
    result: "Maximum shrink",
    use: "When size matters more than sharpness",
  },
];

/**
 * `1-3, 7` → zero-based indices in document order. Empty or out of range
 * tokens are ignored; the result is empty when nothing valid remains.
 */
export function parsePageRange(range: string, pageCount: number): number[] {
  if (pageCount < 1) return [];
  const trimmed = range.trim().toLowerCase();
  if (trimmed === "all") {
    return Array.from({ length: pageCount }, (_, index) => index);
  }

  const seen = new Set<number>();
  const pages: number[] = [];
  for (const part of trimmed.split(/[,;\s]+/)) {
    if (!part) continue;
    const bounds = part.split("-").map((bit) => Number(bit));
    if (bounds.some((n) => !Number.isInteger(n))) continue;
    const start = Math.min(bounds[0], bounds[bounds.length - 1]);
    const end = Math.max(bounds[0], bounds[bounds.length - 1]);
    if (start < 1 || end > pageCount) continue;
    for (let page = start; page <= end; page++) {
      const index = page - 1;
      if (seen.has(index)) continue;
      seen.add(index);
      pages.push(index);
    }
  }
  return pages.sort((a, b) => a - b);
}

/**
 * Options carry their own kind, so `tool.ui` is only read here. Everything
 * downstream switches on the options themselves and cannot drift from the tool.
 */
export function initialOptions(ui: ToolDefinition["ui"]): ToolOptions {
  switch (ui) {
    case "none":
      return { kind: "none" };
    case "password":
      return { kind: "password", password: "" };
    case "password-confirm":
      return { kind: "password-confirm", password: "" };
    case "rotate":
      return { kind: "rotate", degrees: 90 };
    case "organize":
      return { kind: "organize", pageOrder: [] };
    case "resize":
      return { kind: "resize", maxEdge: 1280 };
    case "compress":
      return { kind: "compress", level: "light" };
    case "extract":
      return { kind: "extract", range: "", pageCount: 0 };
  }
}

/**
 * Whether the options are complete enough to run. `confirmPassword` is the
 * retyped value from the form; only `password-confirm` reads it.
 */
export function optionsReady(
  options: ToolOptions,
  confirmPassword: string,
): boolean {
  switch (options.kind) {
    case "none":
    case "rotate":
    case "compress":
      return true;
    case "password":
      return options.password.trim().length > 0;
    case "password-confirm":
      return (
        options.password.trim().length > 0 &&
        options.password === confirmPassword
      );
    case "organize":
      return options.pageOrder.length >= 1;
    case "resize":
      return (
        Number.isFinite(options.maxEdge) &&
        options.maxEdge >= RESIZE_MIN &&
        options.maxEdge <= RESIZE_MAX
      );
    case "extract":
      return parsePageRange(options.range, options.pageCount).length >= 1;
  }
}

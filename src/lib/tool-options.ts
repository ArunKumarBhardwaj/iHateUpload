import type { ToolDefinition } from "@/lib/tools";

export type CompressLevel = "light" | "medium" | "heavy";

export type SignMode = "draw" | "type" | "image";

export type RatioBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Ratios of the page box. Origin is top-left in the UI; processors flip Y. */
export type PageBox = RatioBox & {
  pageIndex: number;
};

export type AnnotatePosition =
  | "center"
  | "diagonal"
  | "header"
  | "footer"
  | "tl"
  | "tr"
  | "bl"
  | "br";

export type ToolOptions =
  | { kind: "none" }
  | { kind: "password"; password: string }
  | { kind: "password-confirm"; password: string }
  | { kind: "rotate"; degrees: 90 | 180 | 270 }
  | { kind: "organize"; pageOrder: number[] }
  | { kind: "resize"; maxEdge: number }
  | { kind: "compress"; level: CompressLevel }
  | { kind: "extract"; range: string; pageCount: number }
  | { kind: "sign"; mode: SignMode; text: string; dataUrl: string; box: PageBox }
  | { kind: "edit"; text: string; box: PageBox }
  | { kind: "crop"; box: PageBox }
  | { kind: "redact"; boxes: PageBox[] }
  | { kind: "compare"; pageIndex: number }
  | {
      kind: "header-footer";
      left: string;
      center: string;
      right: string;
      band: "header" | "footer" | "both";
    }
  | { kind: "insert-blank"; afterPage: number }
  | { kind: "invert"; mode: "invert" | "grayscale" }
  | { kind: "nup"; n: 2 | 4 | 9 }
  | { kind: "page-size"; size: "a4" | "letter"; fit: "fit" | "letterbox" }
  | {
      kind: "annotate";
      variant: "watermark" | "numbers";
      text: string;
      opacity: number;
      rotation: number;
      position: AnnotatePosition;
    }
  | { kind: "ocr"; language: string }
  | { kind: "ask"; question: string }
  | { kind: "scan" }
  | { kind: "image-crop"; box: RatioBox }
  | {
      kind: "image-turn";
      degrees: 0 | 90 | 180 | 270;
      flipH: boolean;
      flipV: boolean;
    }
  | { kind: "target-kb"; maxKb: number };

export const DEFAULT_PAGE_BOX: PageBox = {
  pageIndex: 0,
  x: 0.62,
  y: 0.72,
  w: 0.32,
  h: 0.16,
};

export const DEFAULT_RATIO_BOX: RatioBox = {
  x: 0.08,
  y: 0.08,
  w: 0.84,
  h: 0.84,
};

export const DEFAULT_CROP_BOX: PageBox = {
  pageIndex: 0,
  ...DEFAULT_RATIO_BOX,
};

export const DEFAULT_EDIT_BOX: PageBox = {
  pageIndex: 0,
  x: 0.12,
  y: 0.18,
  w: 0.55,
  h: 0.08,
};

export const ANNOTATE_POSITIONS: {
  id: AnnotatePosition;
  title: string;
}[] = [
  { id: "diagonal", title: "Diagonal" },
  { id: "center", title: "Center" },
  { id: "header", title: "Header" },
  { id: "footer", title: "Footer" },
  { id: "tl", title: "Top left" },
  { id: "tr", title: "Top right" },
  { id: "bl", title: "Bottom left" },
  { id: "br", title: "Bottom right" },
];

export function pageBoxToPdf(
  box: PageBox,
  pageWidth: number,
  pageHeight: number,
) {
  return {
    x: pageWidth * box.x,
    y: pageHeight * (1 - box.y - box.h),
    width: pageWidth * box.w,
    height: pageHeight * box.h,
  };
}

export const OCR_LANGUAGES = [
  { id: "eng", title: "English" },
  { id: "spa", title: "Spanish" },
  { id: "fra", title: "French" },
  { id: "deu", title: "German" },
  { id: "hin", title: "Hindi" },
] as const;

export const RESIZE_PRESETS = [1920, 1280, 800, 640] as const;
export const RESIZE_MIN = 16;
export const RESIZE_MAX = 10000;

export const TARGET_KB_PRESETS = [50, 100, 200, 500, 1024] as const;
export const TARGET_KB_MIN = 20;
export const TARGET_KB_MAX = 8192;

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
    case "sign":
      return {
        kind: "sign",
        mode: "draw",
        text: "",
        dataUrl: "",
        box: { ...DEFAULT_PAGE_BOX },
      };
    case "edit":
      return {
        kind: "edit",
        text: "",
        box: { ...DEFAULT_EDIT_BOX },
      };
    case "crop":
      return { kind: "crop", box: { ...DEFAULT_CROP_BOX } };
    case "redact":
      return { kind: "redact", boxes: [] };
    case "compare":
      return { kind: "compare", pageIndex: 0 };
    case "header-footer":
      return {
        kind: "header-footer",
        left: "",
        center: "{page} / {pages}",
        right: "",
        band: "both",
      };
    case "insert-blank":
      return { kind: "insert-blank", afterPage: 1 };
    case "invert":
      return { kind: "invert", mode: "invert" };
    case "nup":
      return { kind: "nup", n: 2 };
    case "page-size":
      return { kind: "page-size", size: "a4", fit: "letterbox" };
    case "watermark":
      return {
        kind: "annotate",
        variant: "watermark",
        text: "CONFIDENTIAL",
        opacity: 0.28,
        rotation: -32,
        position: "diagonal",
      };
    case "page-numbers":
      return {
        kind: "annotate",
        variant: "numbers",
        text: "",
        opacity: 0.9,
        rotation: 0,
        position: "footer",
      };
    case "ocr":
      return { kind: "ocr", language: "eng" };
    case "ask":
      return { kind: "ask", question: "" };
    case "scan":
      return { kind: "scan" };
    case "image-crop":
      return { kind: "image-crop", box: { ...DEFAULT_RATIO_BOX } };
    case "image-turn":
      return { kind: "image-turn", degrees: 90, flipH: false, flipV: false };
    case "target-kb":
      return { kind: "target-kb", maxKb: 200 };
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
    case "crop":
    case "ocr":
    case "compare":
    case "invert":
    case "nup":
    case "page-size":
    case "scan":
      return true;
    case "image-turn":
      return options.degrees !== 0 || options.flipH || options.flipV;
    case "image-crop":
      return options.box.w > 0.04 && options.box.h > 0.04;
    case "target-kb":
      return (
        Number.isFinite(options.maxKb) &&
        options.maxKb >= TARGET_KB_MIN &&
        options.maxKb <= TARGET_KB_MAX
      );
    case "insert-blank":
      return Number.isInteger(options.afterPage) && options.afterPage >= 0;
    case "header-footer":
      return (
        options.left.trim().length > 0 ||
        options.center.trim().length > 0 ||
        options.right.trim().length > 0
      );
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
    case "sign": {
      const ink =
        options.mode === "type"
          ? options.text.trim().length > 0
          : options.dataUrl.startsWith("data:");
      return ink && options.box.w > 0.04 && options.box.h > 0.04;
    }
    case "edit":
      return options.text.trim().length > 0 && options.box.w > 0.04 && options.box.h > 0.04;
    case "redact":
      return options.boxes.some((box) => box.w > 0.04 && box.h > 0.04);
    case "annotate":
      return options.variant === "numbers" || options.text.trim().length > 0;
    case "ask":
      return options.question.trim().length > 0;
  }
}

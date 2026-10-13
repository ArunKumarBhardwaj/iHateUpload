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

export type EditMarkKind = "text" | "image" | "highlight" | "rect";

type EditMarkBase = PageBox & {
  id: string;
};

export type EditMark =
  | (EditMarkBase & {
      kind: "text";
      text: string;
      /** Fraction of page height. */
      fontSize: number;
      color: string;
      /** White-out the original glyphs, then draw this text. */
      cover: boolean;
    })
  | (EditMarkBase & { kind: "image"; dataUrl: string })
  | (EditMarkBase & { kind: "highlight"; color: string })
  | (EditMarkBase & { kind: "rect"; color: string; fill: boolean });

export type AnnotatePosition =
  | "center"
  | "diagonal"
  | "header"
  | "footer"
  | "tl"
  | "tr"
  | "bl"
  | "br";

export type SplitMode = "pages" | "ranges" | "half" | "size";

export type PdfImageDpi = 72 | 144 | 300;

export type NumberFormat = "n" | "page" | "n-of" | "page-of" | "roman";

export type NumberSize = "small" | "medium" | "large";

export type ToolOptions =
  | { kind: "none" }
  | { kind: "password"; password: string }
  | { kind: "password-confirm"; password: string }
  | {
      kind: "rotate";
      degrees: 90 | 180 | 270;
      /** Empty or "all" turns every page. */
      range: string;
    }
  | { kind: "split"; mode: SplitMode; ranges: string; maxMb: number }
  | {
      kind: "pdf-image";
      /** 144 is the long-standing 2x default. */
      dpi: PdfImageDpi;
      /** Empty or "all" converts every page. */
      range: string;
    }
  | { kind: "organize"; pageOrder: number[] }
  | { kind: "resize"; maxEdge: number }
  | { kind: "compress"; level: CompressLevel; targetKb: number | null }
  | { kind: "extract"; range: string; pageCount: number }
  | { kind: "sign"; mode: SignMode; text: string; dataUrl: string; box: PageBox }
  | { kind: "edit"; marks: EditMark[] }
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
      /** The next four only shape page numbers. */
      numberFormat: NumberFormat;
      startAt: number;
      skipFirst: boolean;
      numberSize: NumberSize;
    }
  | { kind: "ocr"; language: string; output: OcrOutput; skipTextPages: boolean }
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
  w: 0.34,
  h: 0.038,
};

export const EDIT_FONT_SM = 0.018;
export const EDIT_FONT_MD = 0.028;
export const EDIT_FONT_LG = 0.044;

export const EDIT_INK = [
  "#14161c",
  "#d61f3a",
  "#0f766e",
  "#1d4ed8",
  "#ffffff",
] as const;

export const EDIT_HIGHLIGHT = [
  "#f5d76e",
  "#86efac",
  "#7dd3fc",
  "#f9a8d4",
] as const;

export function newEditId() {
  return crypto.randomUUID();
}

export function newTextMark(
  pageIndex: number,
  x = DEFAULT_EDIT_BOX.x,
  y = DEFAULT_EDIT_BOX.y,
  extra?: {
    w?: number;
    h?: number;
    text?: string;
    fontSize?: number;
    cover?: boolean;
  },
): EditMark {
  return {
    id: newEditId(),
    kind: "text",
    pageIndex,
    x,
    y,
    w: extra?.w ?? DEFAULT_EDIT_BOX.w,
    h: extra?.h ?? DEFAULT_EDIT_BOX.h,
    text: extra?.text ?? "",
    fontSize: extra?.fontSize ?? EDIT_FONT_MD,
    color: EDIT_INK[0],
    cover: extra?.cover ?? false,
  };
}

export function newImageMark(
  pageIndex: number,
  dataUrl: string,
): EditMark {
  return {
    id: newEditId(),
    kind: "image",
    pageIndex,
    x: 0.14,
    y: 0.16,
    w: 0.32,
    h: 0.22,
    dataUrl,
  };
}

export function newHighlightMark(box: PageBox, color = EDIT_HIGHLIGHT[0]): EditMark {
  return { id: newEditId(), kind: "highlight", color, ...box };
}

export function newRectMark(box: PageBox, color = EDIT_INK[0]): EditMark {
  return { id: newEditId(), kind: "rect", color, fill: false, ...box };
}

export function editMarkReady(mark: EditMark): boolean {
  if (mark.kind === "text") {
    if (mark.w <= 0.02 || mark.h <= 0.012) return false;
    return mark.cover || mark.text.trim().length > 0;
  }
  if (mark.w <= 0.04 || mark.h <= 0.04) return false;
  if (mark.kind === "image") return mark.dataUrl.startsWith("data:");
  return true;
}

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

export type OcrOutput = "pdf" | "text" | "both";

export const OCR_LANGUAGES = [
  { id: "eng", title: "English" },
  { id: "hin", title: "Hindi" },
  { id: "eng+hin", title: "English + Hindi" },
  { id: "spa", title: "Spanish" },
  { id: "fra", title: "French" },
  { id: "deu", title: "German" },
  { id: "por", title: "Portuguese" },
  { id: "ita", title: "Italian" },
  { id: "ara", title: "Arabic" },
  { id: "ben", title: "Bengali" },
  { id: "chi_sim", title: "Chinese" },
] as const;

export const OCR_OUTPUTS: { id: OcrOutput; title: string }[] = [
  { id: "pdf", title: "Searchable PDF" },
  { id: "text", title: "Text file" },
  { id: "both", title: "PDF + text" },
];

export const RESIZE_PRESETS = [1920, 1280, 800, 640] as const;
export const RESIZE_MIN = 16;
export const RESIZE_MAX = 10000;

export const TARGET_KB_PRESETS = [50, 100, 200, 500, 1024] as const;
export const TARGET_KB_MIN = 20;
export const TARGET_KB_MAX = 8192;

export const PDF_TARGET_KB_PRESETS = [200, 500, 1024, 2048, 5120] as const;
export const PDF_TARGET_KB_MAX = 102400;

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
    result: "Print-sharp images",
    use: "Contracts, CVs, anything you might print",
    recommended: true,
  },
  {
    id: "medium",
    title: "Medium",
    result: "Smaller for email",
    use: "Photo-heavy PDFs and scans",
  },
  {
    id: "heavy",
    title: "Smallest",
    result: "Maximum shrink",
    use: "Upload portals with tight limits",
  },
];

/**
 * `1-3, 7, 9-` → zero-based indices in document order. A trailing dash runs to
 * the last page. Empty or out of range tokens are ignored; the result is empty
 * when nothing valid remains.
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
    const openEnded = /^\d+-$/.test(part);
    const bounds = (openEnded ? `${part}${pageCount}` : part)
      .split("-")
      .map((bit) => Number(bit));
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

/** Blank or "all" is every page; anything else must name at least one page. */
export function resolvePageRange(range: string, pageCount: number): number[] {
  const pages = parsePageRange(range.trim() === "" ? "all" : range, pageCount);
  if (pages.length === 0) {
    throw new Error(`Enter pages between 1 and ${pageCount}, like 1-3, 7.`);
  }
  return pages;
}

/**
 * `1-3, 4-6, 7-` → one list of zero-based indices per comma part, in the order
 * typed. Parts with nothing valid in them are dropped.
 */
export function parseRangeGroups(range: string, pageCount: number): number[][] {
  return range
    .split(/[,;]+/)
    .map((part) => parsePageRange(part, pageCount))
    .filter((group) => group.length > 0);
}

export const SPLIT_MODES: { id: SplitMode; title: string }[] = [
  { id: "pages", title: "Every page" },
  { id: "ranges", title: "By ranges" },
  { id: "half", title: "In half" },
  { id: "size", title: "By size" },
];

export const PDF_IMAGE_DPIS: { id: PdfImageDpi; title: string }[] = [
  { id: 72, title: "72 DPI" },
  { id: 144, title: "Standard" },
  { id: 300, title: "300 DPI" },
];

export const NUMBER_FORMATS: { id: NumberFormat; title: string }[] = [
  { id: "n-of", title: "1 / N" },
  { id: "n", title: "1" },
  { id: "page", title: "Page 1" },
  { id: "page-of", title: "Page 1 of N" },
  { id: "roman", title: "i" },
];

export const NUMBER_SIZES: { id: NumberSize; title: string; points: number }[] = [
  { id: "small", title: "Small", points: 9 },
  { id: "medium", title: "Medium", points: 11 },
  { id: "large", title: "Large", points: 14 },
];

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
      return { kind: "rotate", degrees: 90, range: "" };
    case "split":
      return { kind: "split", mode: "pages", ranges: "", maxMb: 5 };
    case "pdf-image":
      return { kind: "pdf-image", dpi: 144, range: "" };
    case "organize":
      return { kind: "organize", pageOrder: [] };
    case "resize":
      return { kind: "resize", maxEdge: 1280 };
    case "compress":
      return { kind: "compress", level: "light", targetKb: null };
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
      return { kind: "edit", marks: [] };
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
        numberFormat: "n-of",
        startAt: 1,
        skipFirst: false,
        numberSize: "medium",
      };
    case "page-numbers":
      return {
        kind: "annotate",
        variant: "numbers",
        text: "",
        opacity: 0.9,
        rotation: 0,
        position: "footer",
        numberFormat: "n-of",
        startAt: 1,
        skipFirst: false,
        numberSize: "medium",
      };
    case "ocr":
      return {
        kind: "ocr",
        language: "eng",
        output: "pdf",
        skipTextPages: true,
      };
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
    case "compress":
      return (
        options.targetKb === null ||
        (options.targetKb >= TARGET_KB_MIN &&
          options.targetKb <= PDF_TARGET_KB_MAX)
      );
    case "none":
    case "crop":
    case "ocr":
    case "compare":
    case "invert":
    case "nup":
    case "page-size":
    case "scan":
    case "rotate":
    case "pdf-image":
      return true;
    case "split":
      return options.mode === "ranges"
        ? options.ranges.trim().length > 0
        : options.mode === "size"
          ? Number.isFinite(options.maxMb) && options.maxMb > 0
          : true;
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
      return options.marks.some(editMarkReady);
    case "redact":
      return options.boxes.some((box) => box.w > 0.04 && box.h > 0.04);
    case "annotate":
      return options.variant === "numbers"
        ? Number.isInteger(options.startAt) && options.startAt >= 0
        : options.text.trim().length > 0;
    case "ask":
      return options.question.trim().length > 0;
  }
}

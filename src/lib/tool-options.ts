import { batesReady } from "@/lib/bates";
import type { ScanFilter, ScanPageEdit, ScanPageSize } from "@/lib/scan/types";
import type { FlipMode } from "@/lib/page-ops";
import type { InvertEngine, InvertMode, OrganizeEntry } from "@/lib/page-tools/types";
import { DEFAULT_FLATTEN, DEFAULT_STRIP, type FlattenSettings } from "@/lib/page-tools/flatten";
import { DEFAULT_RESIZE, type ResizeSettings } from "@/lib/page-tools/resize";
import { DEFAULT_NUP, type NupSettings } from "@/lib/page-tools/nup";
import { RESERVED_INFO_KEYS } from "@/lib/pdf-meta";
import type { PiiCategory } from "@/lib/pii-detect";
import type { DocConvertOptions } from "@/lib/doc-render/options";
import { defaultDocOptions } from "@/lib/doc-render/options";
import type { ToolDefinition } from "@/lib/tools";

export type CompressLevel = "light" | "medium" | "heavy";

/** One signature, initials, or stamp on a page. Text stamps stay real PDF text. */
export type SignPlacement = PageBox & {
  id: string;
  /** PNG of the signature. Empty for text stamps. */
  dataUrl?: string;
  /** Date or other typed stamp, drawn as vector text. */
  text?: string;
  color?: string;
};

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

export type RedactFinding = PageBox & {
  id: string;
  category: PiiCategory;
  /** What was matched, shown in the review list only. */
  text: string;
  accepted: boolean;
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

export type SplitMode =
  | "pages"
  | "ranges"
  | "half"
  | "size"
  | "bookmarks"
  | "text";

export type PdfImageDpi = 72 | 150 | 300 | 600;

export type PdfImageFormat = "jpg" | "png";

export type JpegQuality = "small" | "balanced" | "best";

/** Editable text flows like Word; exact pins every block in a text box (still editable); picture keeps each page as an image. */
export type PdfToWordMode = "editable" | "exact" | "picture";

export type PdfToExcelLayout = "tables" | "pages" | "one";

export type NumberFormat = "n" | "page" | "n-of" | "page-of" | "roman";

export type NumberSize = "small" | "medium" | "large";

export type WatermarkSize = "small" | "medium" | "large" | "fit";

export type WatermarkLayout = "single" | "tiled";

export type ToolOptions =
  | { kind: "none" }
  | ({ kind: "convert-doc" } & DocConvertOptions)
  | { kind: "password"; password: string }
  | { kind: "password-confirm"; password: string }
  | {
      kind: "protect";
      password: string;
      /** Empty: derived (same as the open password, or random when anything is locked). */
      ownerPassword: string;
      allowPrint: boolean;
      allowCopy: boolean;
      allowEdit: boolean;
      allowAnnotate: boolean;
    }
  | {
      kind: "unlock";
      password: string;
      /** What the file itself said when it was loaded; "unknown" until probed. */
      lock: "unknown" | "open" | "restricted" | "password";
    }
  | {
      kind: "extract-images";
      /** Hide pictures whose shorter side is under this many pixels. */
      minEdge: number;
      /** Ids the person unticked. */
      excluded: string[];
    }
  | { kind: "extract-text"; ocr: boolean; language: string }
  | {
      kind: "rotate";
      /** 0 only flips. */
      degrees: 0 | 90 | 180 | 270;
      /** Mirrors the pages after the turn. Text stays vector. */
      flip: FlipMode;
      /** Empty or "all" turns every page. */
      range: string;
      /** Extra clockwise turn for single pages (zero-based), on top of `degrees`. */
      perPage: Record<number, 0 | 90 | 180 | 270>;
    }
  | {
      kind: "split";
      mode: SplitMode;
      ranges: string;
      maxMb: number;
      /** Bookmarks mode: 1 cuts at top-level items only. */
      bookmarkDepth: number;
      /** Bookmarks mode: indexes (at this depth) the user switched off. */
      bookmarkOff: number[];
      /** Text mode: start a new file at every page that matches. */
      phrase: string;
      regex: boolean;
      matchCase: boolean;
      wholeWord: boolean;
    }
  | {
      kind: "pdf-image";
      /** Older sessions may still hold 144; any number renders. */
      dpi: PdfImageDpi;
      format: PdfImageFormat;
      /** Only shapes JPG output. */
      quality: JpegQuality;
      /** Empty or "all" converts every page. */
      range: string;
    }
  | { kind: "pdf-to-word"; mode: PdfToWordMode; language: string; embedFonts: boolean }
  | {
      kind: "pdf-to-excel";
      layout: PdfToExcelLayout;
      /** Excel workbook, or one CSV per sheet. */
      format: "xlsx" | "csv";
      /** Put the text outside the tables on a "Text" sheet. */
      includeText: boolean;
      /** Numbers and dates become real cells. */
      typed: boolean;
      /** Fills, borders and bold from the PDF. */
      formatting: boolean;
      /** Freeze the header and add a filter. */
      freezeFilter: boolean;
      /** Join a table that runs over pages. */
      joinPages: boolean;
      language: string;
      /** Empty or "all" reads every page. */
      range: string;
    }
  | { kind: "organize"; entries: OrganizeEntry[] }
  | { kind: "resize"; maxEdge: number }
  | { kind: "compress"; level: CompressLevel; targetKb: number | null }
  | { kind: "extract"; range: string; pageCount: number }
  | { kind: "sign"; placements: SignPlacement[] }
  | { kind: "edit"; marks: EditMark[] }
  | {
      kind: "crop";
      /** Shared box, ratios of the page as shown. */
      box: PageBox;
      /** Own box per page, used when `applyAll` is off. */
      perPage: Record<number, RatioBox>;
      applyAll: boolean;
    }
  | {
      kind: "redact";
      /** Boxes drawn by hand. */
      boxes: PageBox[];
      /** What the scan found. Only the accepted ones are burned out. */
      findings: RedactFinding[];
      /** Words or /regex/ lines the scan also looks for. */
      custom: string;
      /** Clear title, author and the rest from the result. */
      stripMeta: boolean;
      /** Drop invisible text layers from pages left as they are. */
      removeHidden: boolean;
    }
  | { kind: "compare"; pageIndex: number }
  | {
      kind: "header-footer";
      left: string;
      center: string;
      right: string;
      band: "header" | "footer" | "both";
      fontSize: number;
      color: string;
      bold: boolean;
      /** Points in from the page edge. */
      margin: number;
      /** Empty or "all" stamps every page. */
      range: string;
      skipFirst: boolean;
    }
  | { kind: "insert-blank"; afterPage: number }
  | ({ kind: "flatten" } & FlattenSettings)
  | { kind: "invert"; mode: InvertMode; engine: InvertEngine; dpi: number; keepHues: boolean }
  | ({ kind: "nup" } & NupSettings)
  | ({ kind: "page-size" } & ResizeSettings)
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
      /** Bates numbering: PREFIX + padded counter + SUFFIX, running on across every file. */
      bates: boolean;
      batesPrefix: string;
      batesSuffix: string;
      batesDigits: number;
      /** Points; Bates only. */
      batesSize: number;
      /** Points in from the page edge; Bates only. */
      margin: number;
      /** White box behind the number so it reads on dark artwork. */
      batesPlate: boolean;
      /** The next five only shape watermarks. */
      size: WatermarkSize;
      color: string;
      layout: WatermarkLayout;
      /** Empty or "all" stamps every page. */
      range: string;
    }
  | {
      kind: "metadata";
      /** Id of the file these fields were read from; "" until they are. */
      sourceId: string;
      title: string;
      author: string;
      subject: string;
      keywords: string;
      creator: string;
      producer: string;
      /** `YYYY-MM-DDTHH:mm`, local time; "" removes the date. */
      created: string;
      modified: string;
      custom: { key: string; value: string }[];
      xmp: "update" | "remove";
    }
  | { kind: "ocr"; language: string; output: OcrOutput; skipTextPages: boolean }
  | { kind: "ask"; question: string }
  | {
      kind: "scan";
      filter: ScanFilter;
      brightness: number;
      contrast: number;
      pageSize: ScanPageSize;
      searchable: boolean;
      language: string;
      /** Per photo, by file id. */
      pages: Record<string, ScanPageEdit>;
    }
  | { kind: "image-crop"; box: RatioBox }
  | {
      kind: "image-turn";
      degrees: 0 | 90 | 180 | 270;
      flipH: boolean;
      flipV: boolean;
    }
  | { kind: "target-kb"; maxKb: number };

const BATES_DEFAULTS = {
  bates: false,
  batesPrefix: "ABC",
  batesSuffix: "",
  batesDigits: 6,
  batesSize: 9,
  margin: 28,
  batesPlate: false,
};

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

/** The whole page: a fresh crop starts with zero margins. */
export const DEFAULT_CROP_BOX: PageBox = {
  pageIndex: 0,
  x: 0,
  y: 0,
  w: 1,
  h: 1,
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

export function signPlacementReady(p: SignPlacement): boolean {
  if (p.w <= 0.02 || p.h <= 0.01) return false;
  return Boolean(p.text?.trim()) || Boolean(p.dataUrl?.startsWith("data:"));
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
  { id: "bookmarks", title: "By bookmarks" },
  { id: "text", title: "By text" },
];

export const PDF_IMAGE_DPIS: { id: PdfImageDpi; title: string }[] = [
  { id: 72, title: "72 DPI" },
  { id: 150, title: "150 DPI" },
  { id: 300, title: "300 DPI" },
  { id: 600, title: "600 DPI" },
];

export const WATERMARK_SIZES: { id: WatermarkSize; title: string }[] = [
  { id: "small", title: "Small" },
  { id: "medium", title: "Medium" },
  { id: "large", title: "Large" },
  { id: "fit", title: "Fit page" },
];

export const WATERMARK_COLORS = [
  "#6b7280",
  "#14161c",
  "#d61f3a",
  "#1d4ed8",
  "#0f766e",
] as const;

export const WATERMARK_ROTATIONS = [0, 45, -45] as const;

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
    case "md-to-pdf":
      return { kind: "convert-doc", ...defaultDocOptions("markdown") };
    case "excel-to-pdf":
      return { kind: "convert-doc", ...defaultDocOptions("excel") };
    case "csv-to-pdf":
      return { kind: "convert-doc", ...defaultDocOptions("csv") };
    case "html-to-pdf":
      return { kind: "convert-doc", ...defaultDocOptions("html") };
    case "pptx-to-pdf":
      return { kind: "convert-doc", ...defaultDocOptions("pptx") };
    case "password":
      return { kind: "password", password: "" };
    case "password-confirm":
      return { kind: "password-confirm", password: "" };
    case "rotate":
      return { kind: "rotate", degrees: 0, flip: "none", range: "", perPage: {} };
    case "split":
      return {
        kind: "split",
        mode: "pages",
        ranges: "",
        maxMb: 5,
        bookmarkDepth: 1,
        bookmarkOff: [],
        phrase: "",
        regex: false,
        matchCase: false,
        wholeWord: false,
      };
    case "pdf-image":
      return {
        kind: "pdf-image",
        dpi: 150,
        range: "",
        format: "jpg",
        quality: "balanced",
      };
    case "pdf-png":
      return {
        kind: "pdf-image",
        dpi: 150,
        range: "",
        format: "png",
        quality: "balanced",
      };
    case "pdf-to-word":
      return { kind: "pdf-to-word", mode: "editable", language: "eng", embedFonts: true };
    case "pdf-to-excel":
      return {
        kind: "pdf-to-excel",
        layout: "tables",
        format: "xlsx",
        includeText: true,
        typed: true,
        formatting: true,
        freezeFilter: true,
        joinPages: true,
        language: "eng",
        range: "",
      };
    case "organize":
      return { kind: "organize", entries: [] };
    case "resize":
      return { kind: "resize", maxEdge: 1280 };
    case "compress":
      return { kind: "compress", level: "light", targetKb: null };
    case "extract":
      return { kind: "extract", range: "", pageCount: 0 };
    case "sign":
      return { kind: "sign", placements: [] };
    case "edit":
      return { kind: "edit", marks: [] };
    case "crop":
      return {
        kind: "crop",
        box: { ...DEFAULT_CROP_BOX },
        perPage: {},
        applyAll: true,
      };
    case "redact":
      return {
        kind: "redact",
        boxes: [],
        findings: [],
        custom: "",
        stripMeta: true,
        removeHidden: true,
      };
    case "compare":
      return { kind: "compare", pageIndex: 0 };
    case "header-footer":
      return {
        kind: "header-footer",
        left: "",
        center: "{page} / {pages}",
        right: "",
        band: "both",
        fontSize: 10,
        color: "#333338",
        bold: false,
        margin: 24,
        range: "",
        skipFirst: false,
      };
    case "protect":
      return {
        kind: "protect",
        password: "",
        ownerPassword: "",
        allowPrint: true,
        allowCopy: true,
        allowEdit: true,
        allowAnnotate: true,
      };
    case "unlock":
      return { kind: "unlock", password: "", lock: "unknown" };
    case "extract-images":
      return { kind: "extract-images", minEdge: 0, excluded: [] };
    case "extract-text":
      return { kind: "extract-text", ocr: true, language: "eng" };
    case "insert-blank":
      return { kind: "insert-blank", afterPage: 1 };
    case "invert":
      return { kind: "invert", mode: "invert", engine: "vector", dpi: 150, keepHues: true };
    case "nup":
      return { kind: "nup", ...DEFAULT_NUP };
    case "flatten":
      return { kind: "flatten", ...DEFAULT_FLATTEN, strip: { ...DEFAULT_STRIP } };
    case "page-size":
      return { kind: "page-size", ...DEFAULT_RESIZE };
    case "watermark":
      return {
        kind: "annotate",
        variant: "watermark",
        text: "CONFIDENTIAL",
        opacity: 0.3,
        rotation: -45,
        position: "center",
        numberFormat: "n-of",
        startAt: 1,
        skipFirst: false,
        numberSize: "medium",
        ...BATES_DEFAULTS,
        size: "medium",
        color: WATERMARK_COLORS[0],
        layout: "single",
        range: "",
      };
    case "bates-numbering":
      return {
        kind: "annotate",
        variant: "numbers",
        text: "",
        opacity: 1,
        rotation: 0,
        position: "br",
        numberFormat: "n",
        startAt: 1,
        skipFirst: false,
        numberSize: "medium",
        ...BATES_DEFAULTS,
        bates: true,
        size: "medium",
        color: "#14161c",
        layout: "single",
        range: "",
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
        ...BATES_DEFAULTS,
        size: "medium",
        color: WATERMARK_COLORS[0],
        layout: "single",
        range: "",
      };
    case "metadata":
      return {
        kind: "metadata",
        sourceId: "",
        title: "",
        author: "",
        subject: "",
        keywords: "",
        creator: "",
        producer: "",
        created: "",
        modified: "",
        custom: [],
        xmp: "update",
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
      return {
        kind: "scan",
        filter: "document",
        brightness: 0,
        contrast: 0,
        pageSize: "a4",
        searchable: false,
        language: "eng",
        pages: {},
      };
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
    case "convert-doc":
    case "crop":
    case "ocr":
    case "compare":
    case "invert":
    case "page-size":
    case "scan":
    case "pdf-image":
    case "pdf-to-word":
    case "pdf-to-excel":
      return true;
    case "flatten":
      return (
        options.mode === "form" ||
        (Number.isFinite(options.dpi) && options.dpi >= 96 && options.dpi <= 400)
      );
    case "nup":
      return (
        options.cols >= 1 &&
        options.rows >= 1 &&
        options.cols * options.rows >= 2
      );
    case "rotate":
      return (
        options.degrees !== 0 ||
        options.flip !== "none" ||
        Object.values(options.perPage ?? {}).some((turn) => turn !== 0)
      );
    case "split":
      return options.mode === "ranges"
        ? options.ranges.trim().length > 0
        : options.mode === "size"
          ? Number.isFinite(options.maxMb) && options.maxMb > 0
          : options.mode === "text"
            ? options.phrase.trim().length > 0
            : true;
    case "metadata": {
      const keys = options.custom
        .map((entry) => entry.key.trim())
        .filter(Boolean);
      return (
        options.sourceId !== "" &&
        new Set(keys).size === keys.length &&
        keys.every((key) => !RESERVED_INFO_KEYS.has(key))
      );
    }
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
    case "unlock":
      return options.lock === "restricted" || options.password.length > 0;
    case "protect":
      return (
        options.password === confirmPassword &&
        (options.password.length > 0 ||
          !(
            options.allowPrint &&
            options.allowCopy &&
            options.allowEdit &&
            options.allowAnnotate
          ))
      );
    case "extract-images":
    case "extract-text":
      return true;
    case "password-confirm":
      return (
        options.password.trim().length > 0 &&
        options.password === confirmPassword
      );
    case "organize":
      return options.entries.some((entry) => entry.src >= 0);
    case "resize":
      return (
        Number.isFinite(options.maxEdge) &&
        options.maxEdge >= RESIZE_MIN &&
        options.maxEdge <= RESIZE_MAX
      );
    case "extract":
      return parsePageRange(options.range, options.pageCount).length >= 1;
    case "sign":
      return options.placements.some(signPlacementReady);
    case "edit":
      return options.marks.some(editMarkReady);
    case "redact":
      return (
        options.boxes.some((box) => box.w > 0.04 && box.h > 0.04) ||
        options.findings.some((f) => f.accepted)
      );
    case "annotate":
      return options.variant === "numbers"
        ? options.bates
          ? batesReady(options)
          : Number.isInteger(options.startAt) && options.startAt >= 0
        : options.text.trim().length > 0;
    case "ask":
      return options.question.trim().length > 0;
  }
}

export type SlotKind = "photo" | "signature" | "thumb" | "declaration";

/** One image a form asks for, with the rules its portal checks. */
export type SlotSpec = {
  kind: SlotKind;
  label: string;
  /** The pixel size we produce. Always inside `pixels` when that is set. */
  width: number;
  height: number;
  minKb: number;
  maxKb: number;
  /** Pixel bounds the notice states; left out when the notice gives none. No max means "or more". */
  pixels?: { minWidth: number; maxWidth?: number; minHeight: number; maxHeight?: number };
  /** Print density written into the JPEG header. */
  dpi?: number;
  /** When the notice gives a floor ("100 DPI or more") rather than an exact density. */
  minDpi?: number;
  /** Short rules to show next to the slot, quoted from the notice in plain words. */
  rules?: string[];
};

export type ExamSpec = {
  /** URL slug for the landing page, e.g. "ssc". */
  slug: string;
  /** Short name people search for, e.g. "SSC". */
  name: string;
  /** Who sets the rules, e.g. "Staff Selection Commission". */
  body: string;
  /** Exams this covers, for the page intro. */
  covers: string;
  slots: SlotSpec[];
  /** Things the form does that this tool does not cover, e.g. a live photo. */
  notes?: string[];
  source: { url: string; title: string; date: string };
  /** When we last checked the rules against the source (YYYY-MM-DD). */
  checked: string;
};

export type CropFraming = {
  /** 1 = the largest crop that fits; 2 = half as wide. */
  zoom: number;
  /** Where the crop sits across the free space, 0 (left/top) to 1 (right/bottom). */
  x: number;
  y: number;
};

export type Rect = { x: number; y: number; width: number; height: number };

export type Pt = { x: number; y: number };
/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];

export type RGBAImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type ScanFilter = "original" | "document" | "bw" | "gray" | "photo";
export type ScanPageSize = "a4" | "letter" | "original";
export type ScanRotation = 0 | 90 | 180 | 270;

/** What the person set for one captured page. Corners are 0..1 of the photo. */
export type ScanPageEdit = {
  corners: Quad | null;
  rotate: ScanRotation;
  /** True once auto-detect has run for this page. */
  detected: boolean;
};

export const SCAN_FILTERS: { id: ScanFilter; title: string }[] = [
  { id: "original", title: "Original" },
  { id: "document", title: "Document" },
  { id: "bw", title: "B&W" },
  { id: "gray", title: "Grayscale" },
  { id: "photo", title: "Photo" },
];

export const SCAN_PAGE_SIZES: { id: ScanPageSize; title: string }[] = [
  { id: "a4", title: "A4" },
  { id: "letter", title: "Letter" },
  { id: "original", title: "Original" },
];

export const SCAN_LANGUAGES = [
  { id: "eng", title: "English" },
  { id: "spa", title: "Spanish" },
  { id: "fra", title: "French" },
  { id: "deu", title: "German" },
  { id: "ita", title: "Italian" },
  { id: "por", title: "Portuguese" },
  { id: "nld", title: "Dutch" },
  { id: "pol", title: "Polish" },
  { id: "tur", title: "Turkish" },
  { id: "swe", title: "Swedish" },
  { id: "rus", title: "Russian" },
  { id: "ukr", title: "Ukrainian" },
  { id: "ara", title: "Arabic" },
  { id: "hin", title: "Hindi" },
  { id: "ben", title: "Bengali" },
  { id: "chi_sim", title: "Chinese (Simplified)" },
  { id: "chi_tra", title: "Chinese (Traditional)" },
  { id: "jpn", title: "Japanese" },
  { id: "kor", title: "Korean" },
  { id: "vie", title: "Vietnamese" },
] as const;

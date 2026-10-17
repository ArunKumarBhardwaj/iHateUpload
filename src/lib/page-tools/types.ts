/** Option shapes for the page tools. Kept apart so lib code and UI share them without cycles. */

export type RatioRect = { x: number; y: number; w: number; h: number };

export type OrganizeEntry = {
  id: string;
  /** Zero-based source page, or -1 for a blank page. */
  src: number;
  /** Extra clockwise turn on top of the page's own /Rotate. */
  turn: 0 | 90 | 180 | 270;
};

export type PaperId =
  | "a4"
  | "letter"
  | "legal"
  | "a3"
  | "a5"
  | "tabloid"
  | "custom";

export type SizeUnit = "mm" | "in" | "pt";

export type NupOrientation = "auto" | "portrait" | "landscape";

export type NupPaper = "a4" | "letter" | "legal" | "a3";

export type InvertMode = "dark" | "invert" | "sepia" | "grayscale";

export type InvertEngine = "vector" | "raster";

export type FlattenMode = "form" | "full";

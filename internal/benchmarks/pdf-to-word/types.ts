/** Ground truth for one synthetic fixture. Written by fixtures/gen.ts, never derived from a converter. */
export type Seg = {
  text: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  sup?: boolean;
  sub?: boolean;
  hl?: boolean;
  /** Hex without #, lower case. Omitted means black. */
  color?: string;
  /** Points. Omitted means "do not check". */
  size?: number;
  font?: string;
};

export type TruthCell = { text: string; rs?: number; cs?: number; shaded?: boolean };
export type TruthTable = { rows: TruthCell[][] };

export type Truth = {
  name: string;
  description: string;
  /** Body text in reading order, one entry per paragraph/list item/cell. Headers, footers excluded. */
  paragraphs: string[];
  /** Score paragraph segmentation: every entry of `paragraphs` is its own paragraph in the PDF (no wrapped lines to merge or split). */
  segmentation?: boolean;
  /** Score reading order for this fixture. */
  order?: boolean;
  headings?: { text: string; level: number }[];
  lists?: { type: "bullet" | "number"; items: string[] }[];
  tables?: TruthTable[];
  /** Paragraphs split into formatted segments. */
  runs?: Seg[][];
  images?: { count: number; labels: string[] };
  /** Count of drawn vector shapes (rect, circle, polygon, line). */
  vectors?: number;
  links?: { url: string; text: string }[];
  columns?: number;
  fonts?: string[];
  header?: string;
  footer?: string;
  pageNumbers?: boolean;
  footnotes?: string[];
  formFields?: { type: "text" | "checkbox"; name: string }[];
  scanned?: boolean;
  pages: number;
};

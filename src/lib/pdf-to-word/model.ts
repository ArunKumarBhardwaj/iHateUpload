/** What the layout step hands the writer. Lengths are PDF points unless a name says otherwise. */

export type Run = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** Font size in points. */
  size?: number;
  font?: string;
  /** Hex, no hash. */
  color?: string;
  tab?: boolean;
  /** A live page-number field instead of text. */
  field?: "PAGE" | "NUMPAGES";
};

export type ListInfo = {
  /** Same instance means the same running list. */
  instance: number;
  kind: "bullet" | "decimal" | "lowerLetter" | "upperLetter";
  /** "." or ")" for numbered kinds. */
  suffix: string;
  /** First number shown, for numbered kinds. */
  start: number;
  /** Where the text starts and how far the marker hangs, in points. */
  leftIndent: number;
  hanging: number;
};

export type ParagraphBlock = {
  type: "p";
  runs: Run[];
  style?: "Heading1" | "Heading2" | "Heading3";
  align?: "center" | "right";
  indentLeft?: number;
  firstLine?: number;
  spaceBefore?: number;
  /** Line pitch as a ratio of the font's own single spacing. */
  lineRatio?: number;
  tabs?: { pos: number; kind: "left" | "center" | "right" }[];
  list?: ListInfo;
};

export type ImageBlock = {
  type: "image";
  ref: string;
  width: number;
  height: number;
  indentLeft?: number;
  spaceBefore?: number;
};

export type TableCell = {
  paragraphs: ParagraphBlock[];
  colSpan: number;
  vMerge?: "restart" | "continue";
};

export type TableBlock = {
  type: "table";
  colWidths: number[];
  rows: TableCell[][];
  borders: boolean;
  indentLeft: number;
};

export type Block = ParagraphBlock | ImageBlock | TableBlock;

export type Section = {
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
  blocks: Block[];
  /** Distance from the page edge to the header and footer text. */
  headerDistance?: number;
  footerDistance?: number;
};

export type DocModel = {
  sections: Section[];
  header: ParagraphBlock[];
  footer: ParagraphBlock[];
  /** Plain-language notes for the person, e.g. pages that were skipped. */
  notes: string[];
};

export type MediaFile = { data: Uint8Array; mime: "image/png" | "image/jpeg" };

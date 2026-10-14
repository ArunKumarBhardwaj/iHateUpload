/** What the layout step hands the writer. Lengths are PDF points unless a name says otherwise. */

/** Where a link goes: an address on the web, or a bookmark in this document. */
export type LinkTarget = { url: string } | { anchor: string };

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
  link?: LinkTarget;
  /** A live page-number field instead of text. */
  field?: "PAGE" | "NUMPAGES";
};

export type ListInfo = {
  /** Same instance means the same running list. */
  instance: number;
  /** Nesting depth, 0 for the outermost items. Levels of one instance share a numbering. */
  level: number;
  kind: "bullet" | "decimal" | "lowerLetter" | "upperLetter" | "lowerRoman" | "upperRoman";
  /** The character a bullet is shown with. */
  glyph?: string;
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
  style?: "Heading1" | "Heading2" | "Heading3" | "Heading4" | "Heading5" | "Heading6";
  align?: "center" | "right";
  indentLeft?: number;
  firstLine?: number;
  spaceBefore?: number;
  /** Line pitch as a ratio of the font's own single spacing. */
  lineRatio?: number;
  tabs?: { pos: number; kind: "left" | "center" | "right" }[];
  list?: ListInfo;
  /** Bookmarks that start at this paragraph, so internal links can land here. */
  bookmarks?: string[];
  /** Starts in the next column of a multi-column section. */
  columnBreakBefore?: boolean;
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
  /** Background colour as hex, no hash. */
  shade?: string;
};

export type TableBlock = {
  type: "table";
  colWidths: number[];
  rows: TableCell[][];
  borders: boolean;
  indentLeft: number;
  /** Leading rows that repeat at the top of each page the table runs over. */
  headerRows?: number;
};

export type Block = ParagraphBlock | ImageBlock | TableBlock;

export type Section = {
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
  blocks: Block[];
  /** How this section starts: a new page (the default) or on the same page as the one before. */
  start?: "nextPage" | "continuous";
  /** Text columns, in points: widths left to right and the gap between neighbours. */
  columns?: { widths: number[]; gap: number };
  /** Distance from the page edge to the header and footer text. */
  headerDistance?: number;
  footerDistance?: number;
};

/** Title, author and the like, from the PDF's own information. Dates are ISO 8601. */
export type DocProperties = {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  created?: string;
  modified?: string;
};

export type DocModel = {
  properties?: DocProperties;
  sections: Section[];
  header: ParagraphBlock[];
  footer: ParagraphBlock[];
  /** Plain-language notes for the person, e.g. pages that were skipped. */
  notes: string[];
};

export type MediaFile = { data: Uint8Array; mime: "image/png" | "image/jpeg" };

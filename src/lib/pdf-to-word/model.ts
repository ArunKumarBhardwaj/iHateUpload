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
  /** Font for East Asian characters, and the language they are in (w:lang eastAsia). */
  eastAsia?: string;
  lang?: string;
  /** Hex, no hash. */
  color?: string;
  underline?: boolean;
  strike?: boolean;
  vertAlign?: "superscript" | "subscript";
  /** Background colour behind the text as hex, no hash. */
  highlight?: string;
  tab?: boolean;
  link?: LinkTarget;
  /** A live page-number field instead of text. */
  field?: "PAGE" | "NUMPAGES";
};

/** A drawn shape pinned to the page. Positions and sizes are points from the top left of the page. */
export type Shape = {
  kind: "rect" | "ellipse" | "line" | "path";
  x: number;
  y: number;
  w: number;
  h: number;
  /** A line that runs from bottom left to top right. */
  flipV?: boolean;
  /** For "path": subpaths with points relative to the shape's own top left. */
  paths?: { op: "M" | "L" | "C" | "Z"; pts: number[] }[][];
  fill?: string;
  stroke?: string;
  strokeWidth: number;
  fillAlpha?: number;
  strokeAlpha?: number;
  dash?: boolean;
  /** Sits behind the text rather than over it. */
  behind: boolean;
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
  /** Drawings pinned to the page, anchored at this paragraph. */
  shapes?: Shape[];
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
  /** Text sits in the middle of the cell rather than at its top. */
  vAlign?: "center";
  /** Rules on this cell's edges, for tables that do not draw every edge. */
  borders?: { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean };
};

export type TableBlock = {
  type: "table";
  colWidths: number[];
  rows: TableCell[][];
  borders: boolean;
  indentLeft: number;
  /** Leading rows that repeat at the top of each page the table runs over. */
  headerRows?: number;
  /** Hex colour of the rules, no hash; black when missing. */
  borderColor?: string;
  /** Each row's height on the page in points; rows grow past it if their text needs more. */
  rowHeights?: number[];
  /** Space between a cell's edge and its text, in points. */
  padding?: { top: number; bottom: number; left: number; right: number };
  /** Gap above the table in points, since a table has no space-before of its own. */
  spaceBefore?: number;
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

/** A font file to carry in the document, already named for the family its runs use. */
export type FontFile = { family: string; bold: boolean; italic: boolean; data: Uint8Array };

/** One block of an exact-layout page and the box it occupies on the page, in points from the top left. */
export type ExactItem = {
  kind: "text" | "table" | "picture";
  box: { x: number; y: number; w: number; h: number };
  block: ParagraphBlock | TableBlock | ImageBlock;
};

/** A page whose blocks are each pinned in place rather than flowing. */
export type ExactPage = { width: number; height: number; shapes: Shape[]; items: ExactItem[] };

export type DocModel = {
  properties?: DocProperties;
  sections: Section[];
  /** Exact layout: when present these pages are written instead of the sections. */
  pages?: ExactPage[];
  header: ParagraphBlock[];
  footer: ParagraphBlock[];
  /** Fonts to embed (optional). */
  fonts?: FontFile[];
  /** Plain-language notes for the person, e.g. pages that were skipped. */
  notes: string[];
};

export type MediaFile = { data: Uint8Array; mime: "image/png" | "image/jpeg" };

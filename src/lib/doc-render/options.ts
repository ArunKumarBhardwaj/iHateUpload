/** Options shared by the Markdown, Excel, CSV and HTML to PDF converters. */
export type DocSource = "markdown" | "excel" | "csv" | "html" | "pptx";
export type DocPaper = "a4" | "letter" | "legal" | "a3";
export type DocMargin = "narrow" | "normal" | "wide";
export interface CsvSort {
  col: number;
  dir: "asc" | "desc";
}
export type DocFont = "sans" | "serif" | "mono";

export interface DocConvertOptions {
  src: DocSource;
  paper: DocPaper;
  landscape: boolean;
  margin: DocMargin;
  /** Markdown only */
  font: DocFont;
  fontSize: number;
  toc: boolean;
  numberHeadings: boolean;
  /** Markdown: line height as a multiple of the normal one */
  lineSpacing: number;
  /** Markdown: draw $...$ and $$...$$ as LaTeX math */
  math: boolean;
  /** Excel: sheet names to keep; empty = every sheet */
  sheets: string[];
  /** Excel and CSV: print the file or sheet name above the table */
  title: boolean;
  /** Excel and CSV: page footer with the name and page numbers */
  footer: boolean;
  /** Excel: shrink the text so every column fits the page width, or keep the size and wrap */
  fit: "shrink" | "wrap";
  /**
   * Excel: print each sheet as it is set up in Excel (print area, paper, scale, margins, its own
   * fonts, borders, widths and row heights), or as a clean table with the options above
   */
  excelLayout: "workbook" | "table";
  /** Excel and CSV: shade every other row */
  zebra: boolean;
  /** CSV: sort by this column before printing */
  csvSort: CsvSort | null;
  /** CSV: keep only rows that contain this text */
  csvFilter: string;
  /** CSV: columns (0-based) left out of the PDF */
  csvHidden: number[];
  /** PowerPoint: also print slides marked hidden */
  hiddenSlides: boolean;
}

export const MARGIN_PT: Record<DocMargin, number> = { narrow: 36, normal: 54, wide: 80 };

export function defaultDocOptions(src: DocSource): DocConvertOptions {
  const table = src === "excel" || src === "csv";
  return {
    src,
    paper: "a4",
    landscape: table,
    margin: table ? "narrow" : "normal",
    font: "sans",
    fontSize: 11,
    toc: false,
    numberHeadings: false,
    lineSpacing: 1,
    math: true,
    sheets: [],
    // Excel's own print has neither; the clean table layout turns them on
    title: src !== "excel",
    footer: src !== "excel",
    fit: "shrink",
    excelLayout: "workbook",
    zebra: true,
    csvSort: null,
    csvFilter: "",
    csvHidden: [],
    hiddenSlides: false,
  };
}

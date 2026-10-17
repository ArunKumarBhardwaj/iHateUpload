import JSZip from "jszip";

/** A small OOXML spreadsheet writer: typed cells, a few styles, merges, widths and a frozen header. */

export type CellStyle = {
  bold?: boolean;
  italic?: boolean;
  /** Hex, no hash. */
  fill?: string;
  color?: string;
  align?: "left" | "center" | "right";
  wrap?: boolean;
  border?: { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean };
  /** Hex colour of the rules, no hash. */
  borderColor?: string;
};

/** A string is text; a number is a number, shown as `fmt` when one is given (dates are serial numbers). */
export type XCell = { v: string | number; fmt?: string; style?: CellStyle } | null;

export type Merge = { r0: number; c0: number; r1: number; c1: number };

export type Sheet = {
  name: string;
  rows: XCell[][];
  merges?: Merge[];
  /** Character widths, one per column. */
  colWidths?: number[];
  freeze?: { rows: number };
};

export type Workbook = { title?: string; sheets: Sheet[] };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "");

export function colName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
const ref = (r: number, c: number) => `${colName(c)}${r + 1}`;

/** Excel's rules: at most 31 characters, none of []:*?/\, and no two names alike in any case. */
export function safeSheetName(name: string, used: Set<string>): string {
  let base = name
    .replace(/[[\]:*?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^'+|'+$/g, "");
  if (!base) base = "Sheet";
  base = base.slice(0, 31).trim();
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    const suffix = ` ${n}`;
    candidate = base.slice(0, 31 - suffix.length).trim() + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

class Styles {
  private fonts: string[] = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
  private fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  private borders: string[] = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
  private numFmts: string[] = [];
  private xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private cache = new Map<string, number>();

  private slot(list: string[], xml: string): number {
    const at = list.indexOf(xml);
    if (at >= 0) return at;
    list.push(xml);
    return list.length - 1;
  }

  index(style: CellStyle | undefined, fmt: string | undefined): number {
    if (!style && !fmt) return 0;
    const key = JSON.stringify([style, fmt]);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const s = style ?? {};
    let fontId = 0;
    if (s.bold || s.italic || s.color) {
      fontId = this.slot(
        this.fonts,
        `<font>${s.bold ? "<b/>" : ""}${s.italic ? "<i/>" : ""}<sz val="11"/>${s.color ? `<color rgb="FF${s.color}"/>` : ""}<name val="Calibri"/><family val="2"/></font>`,
      );
    }
    const fillId = s.fill
      ? this.slot(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill}"/><bgColor indexed="64"/></patternFill></fill>`)
      : 0;
    let borderId = 0;
    if (s.border && (s.border.top || s.border.bottom || s.border.left || s.border.right)) {
      const side = (name: string, on?: boolean) =>
        on ? `<${name} style="thin"><color rgb="FF${s.borderColor ?? "000000"}"/></${name}>` : `<${name}/>`;
      borderId = this.slot(
        this.borders,
        `<border>${side("left", s.border.left)}${side("right", s.border.right)}${side("top", s.border.top)}${side("bottom", s.border.bottom)}<diagonal/></border>`,
      );
    }
    let numFmtId = 0;
    if (fmt && fmt !== "General") {
      const at = this.slot(this.numFmts, fmt);
      numFmtId = 164 + at;
    }
    const align =
      s.align || s.wrap
        ? `<alignment${s.align ? ` horizontal="${s.align}"` : ""}${s.wrap ? ' wrapText="1" vertical="top"' : ""}/>`
        : "";
    const xf =
      `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
      `${numFmtId ? ' applyNumberFormat="1"' : ""}${fontId ? ' applyFont="1"' : ""}${fillId ? ' applyFill="1"' : ""}` +
      `${borderId ? ' applyBorder="1"' : ""}${align ? ' applyAlignment="1">' + align + "</xf>" : "/>"}`;
    this.xfs.push(xf);
    this.cache.set(key, this.xfs.length - 1);
    return this.xfs.length - 1;
  }

  xml(): string {
    const fmts = this.numFmts.length
      ? `<numFmts count="${this.numFmts.length}">${this.numFmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join("")}</numFmts>`
      : "";
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${fmts}` +
      `<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join("")}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join("")}</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
    );
  }
}

export async function writeXlsx(book: Workbook): Promise<Uint8Array> {
  const styles = new Styles();
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const shared = (s: string) => {
    let at = stringIndex.get(s);
    if (at === undefined) {
      at = strings.length;
      strings.push(s);
      stringIndex.set(s, at);
    }
    return at;
  };

  const used = new Set<string>();
  const names = book.sheets.map((s) => safeSheetName(s.name, used));
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${book.sheets
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  );
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(clean(book.title ?? ""))}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created></cp:coreProperties>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
      .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${book.sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join("")}<Relationship Id="rId${book.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${book.sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
  );

  book.sheets.forEach((sheet, i) => {
    const width = Math.max(1, ...sheet.rows.map((r) => r.length));
    const cols = sheet.colWidths?.length
      ? `<cols>${sheet.colWidths
          .map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${Math.round(w * 100) / 100}" customWidth="1"/>`)
          .join("")}</cols>`
      : "";
    const rows = sheet.rows
      .map((row, r) => {
        const cells = row
          .map((cell, c) => {
            if (!cell) return "";
            const s = styles.index(cell.style, cell.fmt);
            const attr = s ? ` s="${s}"` : "";
            if (typeof cell.v === "number") {
              if (!Number.isFinite(cell.v)) return "";
              return `<c r="${ref(r, c)}"${attr}><v>${cell.v}</v></c>`;
            }
            const text = clean(cell.v);
            if (text === "") return attr ? `<c r="${ref(r, c)}"${attr}/>` : "";
            return `<c r="${ref(r, c)}"${attr} t="s"><v>${shared(text)}</v></c>`;
          })
          .join("");
        return cells ? `<row r="${r + 1}">${cells}</row>` : "";
      })
      .join("");
    const pane = sheet.freeze?.rows
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.freeze.rows}" topLeftCell="A${sheet.freeze.rows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sheet.freeze.rows + 1}" sqref="A${sheet.freeze.rows + 1}"/></sheetView></sheetViews>`
      : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
    const merges = sheet.merges?.length
      ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${ref(m.r0, m.c0)}:${ref(m.r1, m.c1)}"/>`).join("")}</mergeCells>`
      : "";
    zip.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${ref(Math.max(0, sheet.rows.length - 1), width - 1)}"/>${pane}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${merges}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`,
    );
  });

  zip.file("xl/styles.xml", styles.xml());
  zip.file(
    "xl/sharedStrings.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings
      .map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`)
      .join("")}</sst>`,
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

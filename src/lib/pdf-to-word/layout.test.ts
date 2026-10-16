import { expect, test } from "bun:test";

import { layoutDocument, type PageInput, type Rule, type TextItem } from "./layout";
import type { Block, ParagraphBlock, TableBlock } from "./model";

function item(
  str: string,
  x: number,
  y: number,
  size = 11,
  extra: Partial<TextItem> = {},
): TextItem {
  return {
    str,
    x,
    y,
    w: str.length * size * 0.5,
    size,
    font: "Arial",
    bold: false,
    italic: false,
    generic: "sans",
    ...extra,
  };
}

function page(items: TextItem[], rules: Rule[] = [], extra: Partial<PageInput> = {}): PageInput {
  return { width: 612, height: 792, items, rules, images: [], ...extra };
}

function blocks(pages: PageInput[]): Block[] {
  return layoutDocument(pages).sections.flatMap((section) => section.blocks);
}

function text(block: Block): string {
  return block.type === "p" ? block.runs.map((run) => run.text).join("") : "";
}

const paragraphs = (all: Block[]) => all.filter((b): b is ParagraphBlock => b.type === "p");

/** A body of filler so the "usual" font size is 11. */
function filler(top: number): TextItem[] {
  return [0, 1, 2].map((i) => item("Plain body text that is long enough to count.", 72, top + i * 14));
}

test("wrapped lines merge, a clear gap starts a new paragraph", () => {
  const all = blocks([
    page([
      item("The quick brown fox jumps over", 72, 100),
      item("the lazy dog and keeps running.", 72, 114),
      item("Second paragraph starts here", 72, 142),
      item("and wraps too.", 72, 156),
    ]),
  ]);
  expect(paragraphs(all).map(text)).toEqual([
    "The quick brown fox jumps over the lazy dog and keeps running.",
    "Second paragraph starts here and wraps too.",
  ]);
  expect(paragraphs(all)[1].spaceBefore).toBeGreaterThan(5);
});

test("a first-line indent does not split a paragraph", () => {
  const all = blocks([
    page([
      item("An indented first line that runs all the way", 90, 100),
      item("across the page to the very right edge here.", 72, 114),
      item("Third line wraps and ends here.", 72, 128),
    ]),
  ]);
  expect(paragraphs(all)).toHaveLength(1);
  expect(paragraphs(all)[0].firstLine).toBeGreaterThan(10);
});

test("larger type becomes headings, ranked by size", () => {
  const all = paragraphs(
    blocks([
      page([
        item("Big Title", 72, 80, 24, { bold: true }),
        item("Section", 72, 130, 16, { bold: true }),
        ...filler(160),
        item("Another big one", 72, 260, 24, { bold: true }),
      ]),
    ]),
  );
  expect(all.map((p) => p.style)).toEqual(["Heading1", "Heading2", undefined, "Heading1"]);
});

test("bold and italic come from the font flags", () => {
  const [p] = paragraphs(
    blocks([
      page([
        item("plain ", 72, 100),
        item("strong", 72 + 33, 100, 11, { bold: true }),
        item(" slanted", 72 + 33 + 33, 100, 11, { italic: true }),
      ]),
    ]),
  );
  expect(p.runs.map((r) => [r.text.trim(), !!r.bold, !!r.italic])).toEqual([
    ["plain", false, false],
    ["strong", true, false],
    ["slanted", false, true],
  ]);
});

test("bullets and numbers become real lists", () => {
  const all = paragraphs(
    blocks([
      page([
        item("•", 80, 100),
        item("First bullet", 98, 100),
        item("•", 80, 118),
        item("Second bullet", 98, 118),
        item("1.", 80, 160),
        item("Open the file", 98, 160),
        item("2.", 80, 178),
        item("Press convert", 98, 178),
      ]),
    ]),
  );
  expect(all.map(text)).toEqual(["First bullet", "Second bullet", "Open the file", "Press convert"]);
  expect(all[0].list?.kind).toBe("bullet");
  expect(all[0].list?.instance).toBe(all[1].list?.instance);
  expect(all[2].list?.kind).toBe("decimal");
  expect(all[2].list?.start).toBe(1);
  expect(all[2].list?.instance).toBe(all[3].list?.instance);
  expect(all[2].list?.instance).not.toBe(all[0].list?.instance);
});

test("a list item that wraps stays one paragraph", () => {
  const all = paragraphs(
    blocks([
      page([
        item("-", 80, 100),
        item("An item long enough to wrap onto", 98, 100),
        item("a second line of its own", 98, 114),
        item("-", 80, 132),
        item("Short one", 98, 132),
      ]),
    ]),
  );
  expect(all.map(text)).toEqual([
    "An item long enough to wrap onto a second line of its own",
    "Short one",
  ]);
});

test("two columns read left column first", () => {
  const items: TextItem[] = [];
  for (let i = 0; i < 5; i++) {
    items.push(item(`Left line ${i + 1} of the first column`, 72, 100 + i * 14));
    items.push(item(`Right line ${i + 1} of the second column`, 330, 100 + i * 14));
  }
  const out = paragraphs(blocks([page(items)])).map(text);
  expect(out).toHaveLength(2);
  expect(out[0].startsWith("Left line 1")).toBe(true);
  expect(out[0].endsWith("first column")).toBe(true);
  expect(out[1].startsWith("Right line 1")).toBe(true);
});

test("a full-width title stays above two columns", () => {
  const items: TextItem[] = [item("A Title Across The Page Width For Sure Yes Indeed", 72, 80, 20, { bold: true })];
  for (let i = 0; i < 4; i++) {
    items.push(item(`Left ${i} text in first column here`, 72, 130 + i * 14));
    items.push(item(`Right ${i} text in second column here`, 330, 130 + i * 14));
  }
  const out = paragraphs(blocks([page(items)])).map(text);
  expect(out[0]).toContain("A Title");
  expect(out[1].startsWith("Left 0")).toBe(true);
  expect(out[2].startsWith("Right 0")).toBe(true);
});

function grid(left: number, top: number, cols: number[], rows: number[]): Rule[] {
  const xs = cols.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1] + w], [left]);
  const ys = rows.reduce<number[]>((acc, h) => [...acc, acc[acc.length - 1] + h], [top]);
  return [
    ...ys.map((y) => ({ x0: left, x1: xs[xs.length - 1], y0: y, y1: y })),
    ...xs.map((x) => ({ x0: x, x1: x, y0: top, y1: ys[ys.length - 1] })),
  ];
}

test("ruled grid becomes a table with its cell text", () => {
  const rules = grid(72, 200, [120, 120, 120], [24, 24, 24]);
  const cells = [
    ["Item", "Qty", "Price"],
    ["Apples", "3", "4.50"],
    ["Pears", "7", "9.10"],
  ];
  const items = [item("Before the table", 72, 150)];
  cells.forEach((row, r) =>
    row.forEach((t, c) => items.push(item(t, 72 + c * 120 + 8, 200 + r * 24 + 16))),
  );
  items.push(item("After the table", 72, 320));
  const all = blocks([page(items, rules)]);
  expect(all.map((b) => b.type)).toEqual(["p", "table", "p"]);
  const table = all[1] as TableBlock;
  expect(table.borders).toBe(true);
  expect(table.colWidths).toEqual([120, 120, 120]);
  expect(table.rows).toHaveLength(3);
  expect(table.rows.map((row) => row.map((cell) => cell.paragraphs.map(text).join("")))).toEqual(cells);
});

test("a missing inner rule merges cells across", () => {
  const rules = grid(72, 200, [100, 100, 100], [24, 24]).filter(
    // drop the second vertical line inside the first row only
    (r) => !(r.x0 === 172 && r.x1 === 172),
  );
  rules.push({ x0: 172, x1: 172, y0: 224, y1: 248 });
  const items = [item("Wide header", 80, 216), item("a", 80, 240), item("b", 180, 240), item("c", 280, 240)];
  const table = blocks([page(items, rules)]).find((b) => b.type === "table") as TableBlock;
  expect(table.rows[0].map((c) => c.colSpan)).toEqual([2, 1]);
  expect(table.rows[1]).toHaveLength(3);
});

test("clearly aligned columns without lines become a borderless table", () => {
  const rows = [
    ["Name", "Role", "City"],
    ["Ana", "Chef", "Lima"],
    ["Bo", "Baker", "Oslo"],
    ["Cy", "Cook", "Rome"],
  ];
  const items: TextItem[] = [item("Staff directory", 72, 100)];
  rows.forEach((row, r) =>
    row.forEach((t, c) => items.push(item(t, 72 + c * 150, 140 + r * 16))),
  );
  const all = blocks([page(items)]);
  const table = all.find((b) => b.type === "table") as TableBlock;
  expect(table).toBeDefined();
  expect(table.borders).toBe(false);
  expect(table.rows.map((row) => row.map((cell) => cell.paragraphs.map(text).join("")))).toEqual(rows);
});

test("prose in two lines per row is not mistaken for a table", () => {
  const items = [
    item("Just a normal line of text here", 72, 100),
    item("and another normal line follows", 72, 114),
    item("and a third normal line closes", 72, 128),
  ];
  expect(blocks([page(items)]).some((b) => b.type === "table")).toBe(false);
});

test("repeated footers move to the footer with a live page number", () => {
  const pages = [1, 2, 3].map((n) =>
    page([
      item(`Content of page ${n} is here`, 72, 100),
      item("Acme Corp confidential", 72, 760),
      item(String(n), 300, 775),
    ]),
  );
  const doc = layoutDocument(pages);
  expect(doc.footer.map((p) => p.runs.map((r) => r.field ?? r.text).join(""))).toContain("PAGE");
  const body = doc.sections.flatMap((s) => s.blocks).map(text);
  expect(body.some((t) => t.includes("confidential"))).toBe(false);
  expect(body).toHaveLength(3);
});

test("each page becomes a section with its own size", () => {
  const doc = layoutDocument([
    page([item("One", 72, 100)]),
    page([item("Two", 50, 90)], [], { width: 400, height: 500 }),
  ]);
  expect(doc.sections).toHaveLength(2);
  expect(doc.sections[1].width).toBe(400);
  expect(doc.sections[0].margins.left).toBeCloseTo(72, 0);
});

test("images stay in reading order between paragraphs", () => {
  const doc = layoutDocument([
    page([item("Above the picture", 72, 100), item("Below the picture", 72, 400)], [], {
      images: [{ ref: "i1", x: 72, y: 200, w: 120, h: 80 }],
    }),
  ]);
  expect(doc.sections[0].blocks.map((b) => b.type)).toEqual(["p", "image", "p"]);
});

test("a page set in a different size is judged on its own, not as headings", () => {
  const first = page([...filler(100), ...filler(160), ...filler(220)]);
  const second = page(
    [0, 1, 2, 3].map((i) =>
      item("Scanned body words that run along one line", 72, 100 + i * 22, 14.4),
    ),
  );
  const out = paragraphs(blocks([first, second]));
  const scanned = out.filter((p) => text(p).startsWith("Scanned"));
  expect(scanned).toHaveLength(1);
  expect(scanned[0].style).toBeUndefined();
});

test("a sparse column of right-aligned dates stays with its own line", () => {
  const items: TextItem[] = [];
  ["First job title", "Second job title", "Third job title", "Fourth job title"].forEach((t, i) => {
    items.push(item(t, 72, 100 + i * 120));
    items.push(item(`0${i + 1}/2024`, 480, 100 + i * 120));
    items.push(item("A line of body text under the title that runs along.", 72, 114 + i * 120));
  });
  const out = paragraphs(blocks([page(items)])).map(text);
  expect(out[0]).toContain("First job title");
  expect(out[0]).toContain("01/2024");
});

test("a hyphen at a line end joins the next word without a gap", () => {
  const [p] = paragraphs(
    blocks([page([item("a real-", 72, 100), item("time system that wraps", 72, 114)])]),
  );
  expect(text(p)).toBe("a real-time system that wraps");
});

test("stretched word spacing in a justified line is not turned into a tab", () => {
  const [p] = paragraphs(
    blocks([page([item("Configured Sanity.io", 72, 100), item("CMS for content", 72 + 120, 100)])]),
  );
  expect(p.runs.some((r) => r.tab)).toBe(false);
  expect(text(p)).toBe("Configured Sanity.io CMS for content");
});

test("a short page keeps normal margins so Word has room to reflow", () => {
  // One short line near the top-left: where the text ends is not where the page's margin is.
  const [section] = layoutDocument([page([item("Text that lives on the second page.", 72, 72)])]).sections;
  expect(section.margins.bottom).toBeLessThanOrEqual(section.margins.top + 1);
  expect(section.margins.right).toBeLessThanOrEqual(section.margins.left * 1.5 + 1);
});

test("two columns under a full-width title become a continuous section with w:cols", () => {
  const items: TextItem[] = [item("A Title Across The Page Width For Sure Yes Indeed", 72, 80, 20, { bold: true })];
  for (let i = 0; i < 4; i++) {
    items.push(item(`Left ${i} text in first column here`, 72, 130 + i * 14));
    items.push(item(`Right ${i} text in second column here`, 330, 130 + i * 14));
  }
  const doc = layoutDocument([page(items)]);
  expect(doc.sections).toHaveLength(2);
  const [head, body] = doc.sections;
  expect(head.columns).toBeUndefined();
  expect(head.blocks.map(text)).toEqual(["A Title Across The Page Width For Sure Yes Indeed"]);
  expect(body.start).toBe("continuous");
  expect(body.columns?.widths).toHaveLength(2);
  expect(body.columns!.gap).toBeGreaterThan(10);
  // The right column starts with a column break, and the left one does not.
  const paras = paragraphs(body.blocks);
  expect(paras).toHaveLength(2);
  expect(paras[0].columnBreakBefore).toBeUndefined();
  expect(paras[1].columnBreakBefore).toBe(true);
  expect(text(paras[1]).startsWith("Right 0")).toBe(true);
});

test("a single-column page gets no columns", () => {
  const doc = layoutDocument([page([...filler(100)])]);
  expect(doc.sections).toHaveLength(1);
  expect(doc.sections[0].columns).toBeUndefined();
});

test("a short title above the columns sits in its own full-width section", () => {
  const items: TextItem[] = [item("Short Title", 72, 80, 20, { bold: true })];
  for (let i = 0; i < 4; i++) {
    items.push(item(`Left ${i} text in first column here`, 72, 130 + i * 14));
    items.push(item(`Right ${i} text in second column here`, 330, 130 + i * 14));
  }
  const doc = layoutDocument([page(items)]);
  expect(doc.sections.map((s) => s.columns?.widths.length)).toEqual([undefined, 2]);
  expect(doc.sections[0].blocks.map(text)).toEqual(["Short Title"]);
  expect(paragraphs(doc.sections[1].blocks).map((b) => b.columnBreakBefore)).toEqual([undefined, true]);
});

test("text under a link rectangle becomes a linked run", () => {
  const line = "For details please read the documentation before starting.";
  const doc = layoutDocument([
    page([item(line, 72, 100), ...filler(130)], [], {
      links: [{ x0: 176.5, x1: 297.5, top: 91, bottom: 103, url: "https://example.com/docs" }],
    }),
  ]);
  const [p] = paragraphs(doc.sections[0].blocks);
  expect(p.runs.map((r) => [r.text, r.link])).toEqual([
    ["For details please ", undefined],
    ["read the documentation", { url: "https://example.com/docs" }],
    [" before starting.", undefined],
  ]);
});

test("an internal link gets a bookmark on the paragraph at its destination", () => {
  const anchor = { name: "sec2", page: 0, y: 398 };
  const doc = layoutDocument([
    page(
      [
        item("Jump to section two for more.", 72, 100),
        ...filler(130),
        item("Section Two", 72, 410, 18, { bold: true }),
        item("Quartz nectar feather ladder needle tunnel jasper opal breeze anchor.", 72, 440),
      ],
      [],
      { links: [{ x0: 72, x1: 160, top: 91, bottom: 103, anchor }] },
    ),
  ]);
  const paras = paragraphs(doc.sections[0].blocks);
  const target = paras.find((p) => text(p) === "Section Two")!;
  expect(target.bookmarks).toEqual(["sec2"]);
  expect(paras.filter((p) => p.bookmarks).length).toBe(1);
  expect(paras[0].runs[0].link).toEqual({ anchor: "sec2" });
});

test("the PDF outline sets heading levels, even for text set at body size", () => {
  const doc = layoutDocument(
    [
      page([
        ...filler(100),
        item("Background", 72, 200),
        item("Details of the work done are described in the next lines of body text.", 72, 230),
      ]),
    ],
    { outline: [{ title: "Background", level: 1, anchor: { name: "bg", page: 0, y: 190 } }] },
  );
  const paras = paragraphs(doc.sections[0].blocks);
  expect(paras.find((p) => text(p) === "Background")?.style).toBe("Heading2");
  expect(paras.filter((p) => p.style).length).toBe(1);
});

/** A ruled table of 3 columns whose rows start at `top`, each row holding the given texts. */
function ruledTable(top: number, rows: string[][]): { items: TextItem[]; rules: Rule[] } {
  const rules = grid(72, top, [120, 120, 120], rows.map(() => 24));
  const items: TextItem[] = [];
  rows.forEach((row, r) => row.forEach((t, c) => items.push(item(t, 72 + c * 120 + 8, top + r * 24 + 16))));
  return { items, rules };
}

const cellTexts = (t: TableBlock) => t.rows.map((row) => row.map((c) => c.paragraphs.map(text).join("")));

test("a table that carries on at the top of the next page becomes one table", () => {
  const first = ruledTable(560, [["No", "Item", "Value"], ["1", "river", "48"], ["2", "dagger", "85"], ["3", "falcon", "12"], ["4", "orchard", "63"], ["5", "ladder", "70"], ["6", "willow", "21"]]);
  const second = ruledTable(60, [["7", "ribbon", "34"], ["8", "zenith", "56"], ["9", "meadow", "90"]]);
  const closing = item("The log ends here with a closing remark.", 72, 160);
  const doc = layoutDocument([page(first.items, first.rules), page([...second.items, closing], second.rules)]);
  const tables = doc.sections.flatMap((s) => s.blocks).filter((b): b is TableBlock => b.type === "table");
  expect(tables).toHaveLength(1);
  expect(cellTexts(tables[0]).map((r) => r[0])).toEqual(["No", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  expect(tables[0].headerRows).toBeUndefined();
  // The closing remark follows the table in the same section instead of starting a new page.
  expect(doc.sections).toHaveLength(1);
  expect(doc.sections[0].blocks.map((b) => b.type)).toEqual(["table", "p"]);
});

test("a repeated header row is dropped and marked as the header", () => {
  const head = ["No", "Item", "Value"];
  const first = ruledTable(560, [head, ["1", "river", "48"], ["2", "dagger", "85"], ["3", "falcon", "12"], ["4", "orchard", "63"], ["5", "ladder", "70"], ["6", "willow", "21"]]);
  const second = ruledTable(60, [head, ["7", "ribbon", "34"], ["8", "zenith", "56"]]);
  const doc = layoutDocument([page(first.items, first.rules), page(second.items, second.rules)]);
  const [table] = doc.sections.flatMap((s) => s.blocks).filter((b): b is TableBlock => b.type === "table");
  expect(table.headerRows).toBe(1);
  expect(cellTexts(table).map((r) => r[0])).toEqual(["No", "1", "2", "3", "4", "5", "6", "7", "8"]);
});

test("tables with different columns on consecutive pages stay separate", () => {
  const first = ruledTable(560, [["a", "b", "c"], ["1", "river", "48"], ["2", "dagger", "85"], ["3", "falcon", "12"], ["4", "orchard", "63"], ["5", "ladder", "70"], ["6", "willow", "21"]]);
  const rules = grid(72, 60, [200, 200], [24, 24]);
  const items = [item("x", 80, 76), item("y", 280, 76), item("z", 80, 100), item("w", 280, 100)];
  const doc = layoutDocument([page(first.items, first.rules), page(items, rules)]);
  expect(doc.sections.flatMap((s) => s.blocks).filter((b) => b.type === "table")).toHaveLength(2);
});

test("a coloured fill behind a table cell becomes its shading", () => {
  const { items, rules } = ruledTable(100, [["No", "Item", "Value"], ["1", "river", "48"]]);
  const fills = [
    { x0: 72, x1: 192, y0: 100, y1: 124, color: "d9e2f3" },
    { x0: 192, x1: 312, y0: 100, y1: 124, color: "d9e2f3" },
  ];
  const [table] = blocks([page(items, rules, { fills })]).filter((b): b is TableBlock => b.type === "table");
  expect(table.rows[0].map((c) => c.shade)).toEqual(["D9E2F3", "D9E2F3", undefined]);
  expect(table.rows[1].map((c) => c.shade)).toEqual([undefined, undefined, undefined]);
});

/** Items for a bulleted list as Chrome prints it: the bullet is a drawn dot, not text. */
function dotted(top: number, texts: string[], x = 84) {
  const items = texts.map((t, i) => item(t, x, top + i * 20));
  const bullets = texts.map((_, i) => ({ x0: x - 14, x1: x - 9, y0: top + i * 20 - 8, y1: top + i * 20 - 3, kind: "disc" as const }));
  return { items, bullets };
}

test("drawn bullet dots turn single-line items into one list paragraph each", () => {
  const { items, bullets } = dotted(200, ["Copper kettle", "Silver ladder", "Marble anchor"]);
  const all = paragraphs(blocks([page([...filler(100), ...items], [], { bullets })]));
  const list = all.filter((p) => p.list);
  expect(list.map(text)).toEqual(["Copper kettle", "Silver ladder", "Marble anchor"]);
  expect(new Set(list.map((p) => p.list!.instance)).size).toBe(1);
  expect(list[0].list!.kind).toBe("bullet");
  expect(list[0].list!.glyph).toBe("•");
});

/** Rows of "marker  text" at the given x, the way a word processor prints a list. */
function marked(top: number, markers: string[], texts: string[], x = 80): TextItem[] {
  return markers.flatMap((m, i) => [item(m, x, top + i * 18), item(texts[i], x + 30, top + i * 18)]);
}
const listOf = (items: TextItem[]) => paragraphs(blocks([page([...filler(60), ...items])])).filter((p) => p.list);

test("1) and a. markers make numbered and lettered lists that keep their suffix", () => {
  const paren = listOf(marked(200, ["1)", "2)", "3)"], ["Alpha item", "Beta item", "Gamma item"]));
  expect(paren.map(text)).toEqual(["Alpha item", "Beta item", "Gamma item"]);
  expect(paren[0].list).toMatchObject({ kind: "decimal", suffix: ")" });

  const dotted = listOf(marked(200, ["a.", "b.", "c."], ["Alpha item", "Beta item", "Gamma item"]));
  expect(dotted.map(text)).toEqual(["Alpha item", "Beta item", "Gamma item"]);
  expect(dotted[0].list).toMatchObject({ kind: "lowerLetter", suffix: "." });

  const upper = listOf(marked(200, ["A.", "B."], ["Alpha item", "Beta item"]));
  expect(upper[0].list).toMatchObject({ kind: "upperLetter", suffix: "." });
});

test("roman numerals make roman lists, including a first item of i.", () => {
  const roman = listOf(marked(200, ["i.", "ii.", "iii.", "iv."], ["One", "Two", "Three", "Four"]));
  expect(roman.map(text)).toEqual(["One", "Two", "Three", "Four"]);
  expect(roman[0].list).toMatchObject({ kind: "lowerRoman", suffix: ".", start: 1 });
  expect(new Set(roman.map((p) => p.list!.instance)).size).toBe(1);
});

test("a lone initial or letter is not a list", () => {
  const all = paragraphs(blocks([page([...filler(60), item("J. Smith wrote the first report on this.", 72, 200), item("a. then something else entirely", 72, 260)])]));
  expect(all.filter((p) => p.list)).toHaveLength(0);
  expect(all.map(text)).toContain("J. Smith wrote the first report on this.");
});

test("bullet characters keep their look: dot, circle, square, dash, star", () => {
  for (const glyph of ["•", "◦", "▪", "-", "*"]) {
    const list = listOf(marked(200, [glyph, glyph], ["Alpha item", "Beta item"]));
    expect(list).toHaveLength(2);
    expect(list[0].list).toMatchObject({ kind: "bullet", glyph });
  }
});

// ---- Run formatting: colour, underline, strike, highlight, super/subscript ----

const runsOf = (all: Block[]) => paragraphs(all).flatMap((p) => p.runs);

test("text colour from the page reaches the run", () => {
  const all = blocks([
    page([item("Plain ", 72, 100, 12), item("red words", 108, 100, 12, { color: "c00000" })]),
  ]);
  const runs = runsOf(all);
  expect(runs.map((r) => [r.text, r.color])).toEqual([
    ["Plain ", undefined],
    ["red words", "c00000"],
  ]);
});

test("a thin line just under the baseline is an underline, not a table rule", () => {
  const rules: Rule[] = [{ x0: 108, x1: 168, y0: 101.2, y1: 101.2 }];
  const all = blocks([page([item("Plain ", 72, 100, 12), item("underlined", 108, 100, 12, { w: 60 })], rules)]);
  expect(all.every((b) => b.type === "p")).toBe(true);
  expect(runsOf(all).map((r) => [r.text, !!r.underline])).toEqual([
    ["Plain ", false],
    ["underlined", true],
  ]);
});

test("a thin line through the middle of the x-height is a strikethrough", () => {
  const rules: Rule[] = [{ x0: 108, x1: 168, y0: 96.6, y1: 96.6 }];
  const all = blocks([page([item("Plain ", 72, 100, 12), item("struck out", 108, 100, 12, { w: 60 })], rules)]);
  const runs = runsOf(all);
  expect(runs[1]).toMatchObject({ text: "struck out", strike: true });
  expect(runs[1].underline).toBeFalsy();
  expect(runs[0].strike).toBeFalsy();
});

test("a line that covers only part of a text piece splits it at the line's ends", () => {
  // 10 characters at 6pt each; the underline covers characters 4 to 8.
  const rules: Rule[] = [{ x0: 96, x1: 120, y0: 101.2, y1: 101.2 }];
  const all = blocks([page([item("abcdeghkno", 72, 100, 12)], rules)]);
  expect(runsOf(all).map((r) => [r.text, !!r.underline])).toEqual([
    ["abcd", false],
    ["eghk", true],
    ["no", false],
  ]);
});

test("a ruling line far from the text is left for tables and shapes", () => {
  const rules: Rule[] = [{ x0: 72, x1: 400, y0: 112, y1: 112 }];
  const all = blocks([page([item("Heading text here", 72, 100, 12)], rules)]);
  expect(runsOf(all).every((r) => !r.underline && !r.strike)).toBe(true);
});

test("a filled box behind a phrase is a highlight with its exact colour", () => {
  const fills = [{ x0: 108, x1: 168, y0: 90, y1: 103.5, color: "ffff00" }];
  const all = blocks([
    page([item("Marked ", 72, 100, 12, { w: 36 }), item("highlighted", 108, 100, 12, { w: 60 })], [], { fills }),
  ]);
  expect(runsOf(all).map((r) => [r.text, r.highlight])).toEqual([
    ["Marked ", undefined],
    ["highlighted", "FFFF00"],
  ]);
});

test("a shaded table cell is shading, not a highlight on its text", () => {
  const rules: Rule[] = [
    { x0: 72, x1: 272, y0: 80, y1: 80 }, { x0: 72, x1: 272, y0: 120, y1: 120 }, { x0: 72, x1: 272, y0: 160, y1: 160 },
    { x0: 72, x1: 72, y0: 80, y1: 160 }, { x0: 172, x1: 172, y0: 80, y1: 160 }, { x0: 272, x1: 272, y0: 80, y1: 160 },
  ];
  const fills = [{ x0: 72, x1: 172, y0: 80, y1: 120, color: "d9e2f3" }];
  const all = blocks([
    page(
      [item("alpha", 80, 104, 12), item("beta", 180, 104, 12), item("gamma", 80, 144, 12), item("delta", 180, 144, 12)],
      rules,
      { fills },
    ),
  ]);
  const table = all.find((b): b is TableBlock => b.type === "table")!;
  expect(table.rows[0][0].shade).toBe("D9E2F3");
  expect(table.rows[0][0].paragraphs[0].runs[0].highlight).toBeUndefined();
});

test("smaller text raised above the baseline is superscript, lowered is subscript", () => {
  const all = blocks([
    page([
      item("E = mc", 72, 100, 12),
      item("2", 102, 95.3, 10),
      item(" and H", 108, 100, 12),
      item("2", 138, 103.2, 10),
      item("O", 144, 100, 12),
    ]),
  ]);
  const runs = runsOf(all);
  expect(runs.map((r) => [r.text, r.vertAlign])).toEqual([
    ["E = mc", undefined],
    ["2", "superscript"],
    [" and H", undefined],
    ["2", "subscript"],
    ["O", undefined],
  ]);
  // Word shrinks super/subscript itself, so the run keeps the line's own size.
  expect(runs[1].size).toBe(12);
});

test("text at another size on the same baseline is not raised or lowered", () => {
  const runs = runsOf(blocks([page([item("big ", 72, 100, 18), item("small", 120, 100, 9)])]));
  expect(runs.every((r) => !r.vertAlign)).toBe(true);
});

// ---- Vector shapes ----

import type { PathShape } from "./lines";

function boxPath(x0: number, y0: number, x1: number, y1: number, extra: Partial<PathShape> = {}): PathShape {
  return {
    segs: [
      { op: "M", pts: [x0, y0] },
      { op: "L", pts: [x1, y0] },
      { op: "L", pts: [x1, y1] },
      { op: "L", pts: [x0, y1] },
      { op: "Z", pts: [] },
    ],
    width: 1,
    behind: true,
    ...extra,
  };
}

/** A circle the way PDF writes it: four cubic curves. */
function circlePath(cx: number, cy: number, r: number, extra: Partial<PathShape> = {}): PathShape {
  const k = 0.5523 * r;
  return {
    segs: [
      { op: "M", pts: [cx + r, cy] },
      { op: "C", pts: [cx + r, cy + k, cx + k, cy + r, cx, cy + r] },
      { op: "C", pts: [cx - k, cy + r, cx - r, cy + k, cx - r, cy] },
      { op: "C", pts: [cx - r, cy - k, cx - k, cy - r, cx, cy - r] },
      { op: "C", pts: [cx + k, cy - r, cx + r, cy - k, cx + r, cy] },
      { op: "Z", pts: [] },
    ],
    width: 1,
    behind: true,
    ...extra,
  };
}

const shapesOf = (pages: PageInput[]) =>
  layoutDocument(pages)
    .sections.flatMap((s) => s.blocks)
    .flatMap((b) => (b.type === "p" ? (b.shapes ?? []) : []));

test("drawn rectangle, circle, triangle and line become shapes on the page's first paragraph", () => {
  const triangle: PathShape = {
    segs: [
      { op: "M", pts: [320, 100] },
      { op: "L", pts: [380, 20] },
      { op: "L", pts: [440, 100] },
      { op: "Z", pts: [] },
    ],
    fill: "548235",
    width: 1,
    behind: true,
  };
  const line: PathShape = {
    segs: [
      { op: "M", pts: [10, 160] },
      { op: "L", pts: [460, 160] },
    ],
    stroke: "7030a0",
    width: 4,
    behind: true,
  };
  const all = shapesOf([
    page([item("Diagram", 72, 60, 12)], [], {
      shapes: [
        boxPath(10, 20, 130, 100, { fill: "2e75b6", stroke: "1f4e79", width: 3 }),
        circlePath(220, 60, 45, { fill: "c55a11" }),
        triangle,
        line,
      ],
    }),
  ]);
  expect(all.map((s) => s.kind)).toEqual(["rect", "ellipse", "path", "line"]);
  expect(all[0]).toMatchObject({ x: 10, y: 20, w: 120, h: 80, fill: "2E75B6", stroke: "1F4E79", strokeWidth: 3 });
  expect(all[1]).toMatchObject({ x: 175, y: 15, w: 90, h: 90, fill: "C55A11" });
  expect(all[1].stroke).toBeUndefined();
  expect(all[2]).toMatchObject({ x: 320, y: 20, w: 120, h: 80, fill: "548235" });
  expect(all[2].paths?.[0][1].pts).toEqual([60, 0]);
  expect(all[3]).toMatchObject({ x: 10, y: 160, w: 450, h: 0, stroke: "7030A0", strokeWidth: 4 });
});

test("a line drawn from bottom left to top right is flipped, not re-pointed", () => {
  const up: PathShape = {
    segs: [{ op: "M", pts: [10, 100] }, { op: "L", pts: [60, 50] }],
    stroke: "000000",
    width: 1,
    behind: false,
  };
  const [shape] = shapesOf([page([item("x", 72, 300)], [], { shapes: [up] })]);
  expect(shape).toMatchObject({ kind: "line", x: 10, y: 50, w: 50, h: 50, flipV: true, behind: false });
});

test("a page with only a drawing still carries it, on an empty paragraph", () => {
  const model = layoutDocument([page([], [], { shapes: [circlePath(100, 100, 20, { fill: "ff0000" })] })]);
  const first = model.sections[0].blocks[0];
  expect(first.type === "p" && first.shapes?.length).toBe(1);
});

test("table borders and cell shading are not shapes", () => {
  const rules: Rule[] = [
    { x0: 72, x1: 272, y0: 80, y1: 80 }, { x0: 72, x1: 272, y0: 120, y1: 120 }, { x0: 72, x1: 272, y0: 160, y1: 160 },
    { x0: 72, x1: 72, y0: 80, y1: 160 }, { x0: 172, x1: 172, y0: 80, y1: 160 }, { x0: 272, x1: 272, y0: 80, y1: 160 },
  ];
  const fills = [{ x0: 72, x1: 172, y0: 80, y1: 120, color: "d9e2f3" }];
  const shapes = [
    boxPath(72, 80, 172, 120, { fill: "d9e2f3" }),
    boxPath(72, 80, 272, 160, { stroke: "000000" }),
    boxPath(400, 300, 480, 340, { fill: "ff0000" }),
  ];
  const got = shapesOf([
    page(
      [item("alpha", 80, 104, 12), item("beta", 180, 104, 12), item("gamma", 80, 144, 12), item("delta", 180, 144, 12)],
      rules,
      { fills, shapes },
    ),
  ]);
  expect(got.map((s) => s.fill ?? s.stroke)).toEqual(["FF0000"]);
});

test("lines used as underline or highlight are not drawn a second time", () => {
  const under: PathShape = {
    segs: [{ op: "M", pts: [108, 101.2] }, { op: "L", pts: [168, 101.2] }],
    stroke: "000000",
    width: 0.8,
    behind: true,
  };
  const mark = boxPath(200, 90, 260, 103.5, { fill: "ffff00" });
  const rules: Rule[] = [{ x0: 108, x1: 168, y0: 101.2, y1: 101.2 }];
  const fills = [{ x0: 200, x1: 260, y0: 90, y1: 103.5, color: "ffff00" }];
  const got = shapesOf([
    page([item("Plain ", 72, 100, 12), item("underlined", 108, 100, 12, { w: 60 }), item("marked", 200, 100, 12, { w: 60 })], rules, {
      fills,
      shapes: [under, mark],
    }),
  ]);
  expect(got).toEqual([]);
});

test("a drawn bullet that became a list marker is not a shape", () => {
  const dot = circlePath(66, 96.5, 2.5, { fill: "000000" });
  const got = shapesOf([
    page([item("Copper kettle", 72, 100, 12), item("Silver ladder", 72, 120, 12)], [], {
      bullets: [{ x0: 63.5, x1: 68.5, y0: 94, y1: 99, kind: "disc" }],
      shapes: [dot],
    }),
  ]);
  expect(got).toEqual([]);
});

test("white fills, page backgrounds and swarms of tiny paths are left out", () => {
  const white = boxPath(10, 10, 100, 100, { fill: "ffffff" });
  const background = boxPath(0, 0, 612, 792, { fill: "f0f0f0" });
  const swarm = Array.from({ length: 400 }, (_, i) => boxPath(10 + (i % 20) * 5, 200 + Math.floor(i / 20) * 5, 13 + (i % 20) * 5, 203 + Math.floor(i / 20) * 5, { fill: "000000" }));
  expect(shapesOf([page([item("x", 72, 300)], [], { shapes: [white, background] })])).toEqual([]);
  const model = layoutDocument([page([item("x", 72, 300)], [], { shapes: swarm })]);
  expect(model.sections.flatMap((s) => s.blocks).flatMap((b) => (b.type === "p" ? (b.shapes ?? []) : []))).toEqual([]);
  expect(model.notes.join(" ")).toMatch(/drawn|shape|graphic/i);
});

test("an underline a little longer than its text (a link's trailing space) is still an underline", () => {
  const rules: Rule[] = [{ x0: 108, x1: 174, y0: 101.2, y1: 101.2 }];
  const runs = runsOf(blocks([page([item("Plain ", 72, 100, 12, { w: 30 }), item("linked text", 108, 100, 12, { w: 60 })], rules)]));
  expect(runs.find((r) => r.text === "linked text")?.underline).toBe(true);
});

test("single-line paragraphs with a paragraph gap stay separate paragraphs", () => {
  // Each line is its own paragraph (pitch 25 on 12 pt text); no line is a wrapped one.
  const lines = ["Plain intro and bold words then italic done.", "We have underlined text and struck out text.", "Colours: red words and blue words end.", "Sizes: small normal large back."];
  const all = blocks([page(lines.map((s, i) => item(s, 54, 100 + i * 25, 12)))]);
  expect(paragraphs(all).map(text)).toEqual(lines);
});

test("a change of font family between lines ends the paragraph", () => {
  const all = blocks([
    page([
      ...filler(60),
      item("Serif line in Georgia for the record.", 72, 140, 11, { font: "Georgia", generic: "serif" }),
      item("Monospace line in Courier New for code.", 72, 154, 11, { font: "CourierNewPSMT", generic: "mono" }),
    ]),
  ]);
  const texts = paragraphs(all).map(text);
  expect(texts).toContain("Serif line in Georgia for the record.");
  expect(texts).toContain("Monospace line in Courier New for code.");
});

test("a line that ends well short of the column ends its paragraph when the next word would have fitted", () => {
  const all = blocks([
    page([
      item("A long first line that runs almost all the way across the column of text here", 72, 100),
      item("Short line without a stop", 72, 114),
      item("Another paragraph begins right away", 72, 128),
    ]),
  ]);
  expect(paragraphs(all).map(text)).toEqual([
    "A long first line that runs almost all the way across the column of text here Short line without a stop",
    "Another paragraph begins right away",
  ]);
});

test("a wrapped paragraph whose last line is short still merges its lines", () => {
  const all = blocks([
    page([
      item("The quick brown fox jumps over the lazy dog and keeps running far away", 72, 100),
      item("across the field and past the old mill by the river bank today and on", 72, 114),
      item("to the sea", 72, 128),
    ]),
  ]);
  expect(paragraphs(all).length).toBe(1);
});

test("CJK text is set in an East Asian font even when the PDF font looks monospaced", () => {
  const [zh, ja, ko, latin] = paragraphs(
    blocks([
      page([
        item("欢迎来到图书馆", 72, 100, 11, { font: "Courier", generic: "mono" }),
        item("図書館からのお知らせです", 72, 200, 11, { font: "Courier", generic: "mono" }),
        item("도서관에 오신 것을 환영합니다", 72, 300, 11, { font: "Courier", generic: "mono" }),
        item("plain latin text", 72, 400, 11, { font: "Courier", generic: "mono" }),
      ]),
    ]),
  );
  expect([zh.runs[0].eastAsia, zh.runs[0].lang]).toEqual(["Microsoft YaHei", "zh-CN"]);
  expect([ja.runs[0].eastAsia, ja.runs[0].lang]).toEqual(["Yu Gothic", "ja-JP"]);
  expect([ko.runs[0].eastAsia, ko.runs[0].lang]).toEqual(["Malgun Gothic", "ko-KR"]);
  // The Latin face is no longer the monospaced guess for a run that is all CJK.
  expect(zh.runs[0].font).toBe("Microsoft YaHei");
  expect(latin.runs[0].font).toBe("Courier New");
  expect(latin.runs[0].eastAsia).toBeUndefined();
});

test("a CJK PDF font family is kept for East Asian text", () => {
  const [p] = paragraphs(blocks([page([item("市立図書館", 72, 100, 11, { font: "ABCDEF+MS-Mincho", generic: "mono" })])]));
  expect(p.runs[0].eastAsia).toBe("MS Mincho");
});

test("exact layout hands the writer one page with a box for every paragraph, table and picture", () => {
  const lines = [
    item("Heading Here", 72, 80, 20),
    item("The quick brown fox jumps over", 72, 120),
    item("the lazy dog and keeps running.", 72, 134),
    item("Short note", 300, 300),
  ];
  const model = layoutDocument(
    [page(lines, [], { images: [{ ref: "im1", x: 50, y: 400, w: 120, h: 80 }] })],
    { exact: true },
  );
  expect(model.sections).toHaveLength(0);
  expect(model.pages).toHaveLength(1);
  const [pg] = model.pages!;
  expect(pg.width).toBe(612);
  const texts = pg.items.filter((i) => i.kind === "text");
  const fox = texts.find((i) => i.block.type === "p" && i.block.runs[0].text.startsWith("The quick"))!;
  expect(fox.box.x).toBeCloseTo(72, 0);
  expect(fox.box.y).toBeGreaterThan(100);
  expect(fox.box.y).toBeLessThan(121);
  expect(fox.box.w).toBeGreaterThan(100);
  expect(fox.box.h).toBeGreaterThan(20); // two lines
  const note = texts.find((i) => i.block.type === "p" && i.block.runs[0].text === "Short note")!;
  expect(note.box.x).toBeCloseTo(300, 0);
  const pic = pg.items.find((i) => i.kind === "picture")!;
  expect(pic.box).toEqual({ x: 50, y: 400, w: 120, h: 80 });
});

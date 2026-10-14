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

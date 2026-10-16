import { describe, expect, test } from "bun:test";

import { layoutDocument, type Cmd, type Measurer } from "./layout";
import type { Block, InlineStyle, Para } from "./model";

// 0.5em per character: easy to reason about.
const measure: Measurer = (text, _key, size) => text.length * size * 0.5;
const PAGE = { width: 400, height: 500, margin: { top: 50, right: 50, bottom: 50, left: 50 } };

const plain: InlineStyle = { bold: false, italic: false, underline: false, strike: false };

function para(text: string, over: Partial<Para> = {}, style: Partial<InlineStyle> = {}): Para {
  return {
    kind: "para",
    inlines: [{ kind: "text", text, style: { ...plain, ...style } }],
    align: "left",
    heading: 0,
    indent: 0,
    ...over,
  };
}

const texts = (cmds: Cmd[]) => cmds.filter((c): c is Extract<Cmd, { t: "text" }> => c.t === "text");

describe("layoutDocument", () => {
  test("wraps long text inside the margins", () => {
    const pages = layoutDocument([para("word ".repeat(120))], PAGE, measure);
    const t = texts(pages[0].cmds);
    expect(t.length).toBeGreaterThan(3);
    for (const c of t) {
      expect(c.x).toBeGreaterThanOrEqual(50 - 0.01);
      expect(c.x + measure(c.text, c, c.size)).toBeLessThanOrEqual(350 + 0.01);
    }
  });

  test("starts a new page when content overflows", () => {
    const blocks = Array.from({ length: 80 }, (_, i) => para(`Line number ${i}`));
    const pages = layoutDocument(blocks, PAGE, measure);
    expect(pages.length).toBeGreaterThan(1);
    for (const pg of pages) for (const c of texts(pg.cmds)) expect(c.y).toBeLessThanOrEqual(450 + 0.01);
  });

  test("explicit page break starts a new page and never adds a blank first page", () => {
    const pages = layoutDocument(
      [para("one"), { kind: "pagebreak" }, para("two"), { kind: "pagebreak" }],
      PAGE,
      measure,
    );
    expect(pages.length).toBe(2);
    expect(texts(pages[1].cmds)[0].text).toBe("two");
  });

  test("headings are bigger and bold", () => {
    const pages = layoutDocument(
      [para("Title", { heading: 1 }), para("body text")],
      PAGE,
      measure,
    );
    const [h, b] = texts(pages[0].cmds);
    expect(h.size).toBeGreaterThan(b.size * 1.5);
    expect(h.bold).toBe(true);
    expect(b.bold).toBe(false);
  });

  test("a heading is not stranded at the bottom of a page", () => {
    const fill = Array.from({ length: 29 }, (_, i) => para(`Filler ${i}`));
    const pages = layoutDocument([...fill, para("Late heading", { heading: 2 }), para("after")], PAGE, measure);
    const last = pages[pages.length - 1];
    const firstOnLast = texts(last.cmds)[0];
    expect(pages.length).toBe(2);
    expect(firstOnLast.text).toBe("Late heading");
  });

  test("bold, italic, underline, strike and colour reach the output", () => {
    const pages = layoutDocument(
      [
        {
          ...para("x"),
          inlines: [
            { kind: "text", text: "bold ", style: { ...plain, bold: true } },
            { kind: "text", text: "ital ", style: { ...plain, italic: true } },
            { kind: "text", text: "und ", style: { ...plain, underline: true } },
            { kind: "text", text: "strk ", style: { ...plain, strike: true } },
            { kind: "text", text: "red", style: { ...plain, color: "FF0000" } },
          ],
        },
      ],
      PAGE,
      measure,
    );
    const t = texts(pages[0].cmds);
    expect(t.some((c) => c.bold)).toBe(true);
    expect(t.some((c) => c.italic)).toBe(true);
    expect(t.some((c) => c.underline)).toBe(true);
    expect(t.some((c) => c.strike)).toBe(true);
    expect(t.some((c) => c.color === "FF0000")).toBe(true);
  });

  test("same-style words on a line are one text run (selectable as a sentence)", () => {
    const pages = layoutDocument([para("hello brave new world")], PAGE, measure);
    expect(texts(pages[0].cmds).map((c) => c.text)).toEqual(["hello brave new world"]);
  });

  test("center and right alignment move the line", () => {
    const [left] = texts(layoutDocument([para("hi")], PAGE, measure)[0].cmds);
    const [center] = texts(layoutDocument([para("hi", { align: "center" })], PAGE, measure)[0].cmds);
    const [right] = texts(layoutDocument([para("hi", { align: "right" })], PAGE, measure)[0].cmds);
    expect(left.x).toBe(50);
    expect(center.x).toBeGreaterThan(left.x + 50);
    expect(right.x + measure("hi", right, right.size)).toBeCloseTo(350, 3);
  });

  test("justified lines fill the width except the last", () => {
    const pages = layoutDocument([para("aa bb cc dd ee ff gg hh ii jj kk ll mm nn oo pp qq rr ss tt uu vv", { align: "justify" })], PAGE, measure);
    const lines = new Map<number, Cmd[]>();
    for (const c of texts(pages[0].cmds)) lines.set(c.y, [...(lines.get(c.y) ?? []), c]);
    const ys = [...lines.keys()].sort((a, b) => a - b);
    expect(ys.length).toBeGreaterThan(1);
    const first = lines.get(ys[0]) as Extract<Cmd, { t: "text" }>[];
    const lastWord = first[first.length - 1];
    expect(lastWord.x + measure(lastWord.text, lastWord, lastWord.size)).toBeCloseTo(350, 1);
  });

  test("list items draw a marker left of indented text, nested deeper", () => {
    const pages = layoutDocument(
      [
        para("one", { marker: { label: "•", level: 0 } }),
        para("two", { marker: { label: "–", level: 1 } }),
        para("three", { marker: { label: "2.", level: 0 } }),
      ],
      PAGE,
      measure,
    );
    const t = texts(pages[0].cmds);
    const byText = (s: string) => t.find((c) => c.text === s)!;
    expect(byText("•").x).toBeLessThan(byText("one").x);
    expect(byText("one").x).toBeGreaterThan(50);
    expect(byText("two").x).toBeGreaterThan(byText("one").x);
    expect(byText("2.").x).toBeLessThan(byText("three").x);
    expect(byText("one").y).toBe(byText("•").y);
  });

  test("tables draw borders, wrap long cells, and keep columns apart", () => {
    const cell = (text: string, header = false) => ({
      blocks: [para(text)],
      colSpan: 1,
      rowSpan: 1,
      header,
    });
    const block: Block = {
      kind: "table",
      rows: [
        { header: true, cells: [cell("Region", true), cell("Notes", true)] },
        {
          header: false,
          cells: [cell("North"), cell("a very long note that must wrap inside its cell because it is long ".repeat(3))],
        },
      ],
    };
    const pages = layoutDocument([block], PAGE, measure);
    const cmds = pages[0].cmds;
    expect(cmds.filter((c) => c.t === "line").length).toBeGreaterThanOrEqual(6);
    const t = texts(cmds);
    const north = t.find((c) => c.text === "North")!;
    const notes = t.filter((c) => c.y > north.y - 1 && c.x > north.x + 10);
    expect(notes.length).toBeGreaterThan(2);
    for (const c of t) expect(c.x + measure(c.text, c, c.size)).toBeLessThanOrEqual(350 + 0.01);
    expect(cmds.some((c) => c.t === "rect")).toBe(true); // header shading
  });

  test("a table taller than a page continues on the next page", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      header: i === 0,
      cells: [{ blocks: [para(`row ${i}`)], colSpan: 1, rowSpan: 1, header: i === 0 }],
    }));
    const pages = layoutDocument([{ kind: "table", rows }], PAGE, measure);
    expect(pages.length).toBeGreaterThan(1);
    // header row repeats at the top of continuation pages
    expect(texts(pages[1].cmds).some((c) => c.text === "row 0")).toBe(true);
  });

  test("images scale down to fit the content width", () => {
    const data = new Uint8Array([1]);
    const pages = layoutDocument(
      [{ ...para("x"), inlines: [{ kind: "image", data, mime: "image/png", width: 1200, height: 600 }] }],
      PAGE,
      measure,
    );
    const img = pages[0].cmds.find((c) => c.t === "image") as Extract<Cmd, { t: "image" }>;
    expect(img.w).toBeLessThanOrEqual(300.01);
    expect(img.h / img.w).toBeCloseTo(0.5, 3);
  });

  test("links produce clickable rectangles over the text", () => {
    const pages = layoutDocument(
      [para("see the docs here", {}, { href: "https://example.com" })],
      PAGE,
      measure,
    );
    const l = pages[0].cmds.find((c) => c.t === "link") as Extract<Cmd, { t: "link" }>;
    expect(l.href).toBe("https://example.com");
    expect(l.w).toBeGreaterThan(50);
    // links look like links
    const t = texts(pages[0].cmds)[0];
    expect(t.underline).toBe(true);
    expect(t.color).toBeDefined();
  });

  test("a single word wider than the line is broken rather than overflowing", () => {
    const pages = layoutDocument([para("x".repeat(200))], PAGE, measure);
    for (const c of texts(pages[0].cmds)) expect(c.x + measure(c.text, c, c.size)).toBeLessThanOrEqual(350.01);
  });
});

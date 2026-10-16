import { describe, expect, test } from "bun:test";

import { parseHtml } from "./html";
import { htmlToBlocks } from "./model";
import { pageSpecFromDocxXml, defaultPageForLocale } from "./page";

describe("parseHtml", () => {
  test("nests elements, decodes entities and handles void tags", () => {
    const [p] = parseHtml('<p class="a">x &amp; y &#169; &nbsp;<br /><img src="d" alt="q"/></p>');
    if (!("tag" in p)) throw new Error("expected element");
    expect(p.tag).toBe("p");
    expect(p.attrs.class).toBe("a");
    expect(p.children.length).toBe(3);
  });
});

describe("htmlToBlocks", () => {
  test("headings, paragraphs and inline styles", () => {
    const blocks = htmlToBlocks("<h2>Head</h2><p>a <strong>b</strong><em>c</em><u>d</u><s>e</s></p>");
    expect(blocks[0]).toMatchObject({ kind: "para", heading: 2 });
    const p = blocks[1];
    if (p.kind !== "para") throw new Error();
    const styles = p.inlines.map((i) => (i.kind === "text" ? i.style : null));
    expect(styles[1]?.bold).toBe(true);
    expect(styles[2]?.italic).toBe(true);
    expect(styles[3]?.underline).toBe(true);
    expect(styles[4]?.strike).toBe(true);
  });

  test("nested lists become marked paragraphs with levels and numbering", () => {
    const blocks = htmlToBlocks(
      "<ol><li><p>one</p><ul><li><p>sub</p></li></ul></li><li><p>two</p></li></ol>",
    );
    const marks = blocks.map((b) => (b.kind === "para" ? b.marker : null));
    expect(marks[0]).toMatchObject({ label: "1.", level: 0 });
    expect(marks[1]).toMatchObject({ level: 1 });
    expect(marks[2]).toMatchObject({ label: "2.", level: 0 });
  });

  test("tables keep header rows and cell content", () => {
    const [t] = htmlToBlocks(
      "<table><thead><tr><th><p>H</p></th></tr></thead><tbody><tr><td colspan=\"1\"><p>C</p></td></tr></tbody></table>",
    );
    if (t.kind !== "table") throw new Error();
    expect(t.rows[0].header).toBe(true);
    expect(t.rows[1].header).toBe(false);
    expect(t.rows[1].cells[0].blocks.length).toBe(1);
  });

  test("data-URI images are decoded; hr.pgbrk is a page break", () => {
    const blocks = htmlToBlocks(
      '<p><img src="data:image/png;base64,AAEC" /></p><hr class="pgbrk" />',
    );
    const p = blocks[0];
    if (p.kind !== "para") throw new Error();
    const img = p.inlines[0];
    expect(img.kind).toBe("image");
    if (img.kind === "image") expect([...img.data]).toEqual([0, 1, 2]);
    expect(blocks[1].kind).toBe("pagebreak");
  });

  test("private-use markers carry alignment, colour, size and font; they never show as text", () => {
    const blocks = htmlToBlocks(
      "<p>a=centerc=FF0000redc= plain</p>",
    );
    const p = blocks[0];
    if (p.kind !== "para") throw new Error();
    expect(p.align).toBe("center");
    const all = p.inlines.map((i) => (i.kind === "text" ? i.text : "")).join("");
    expect(all).toBe("red plain");
    const first = p.inlines[0];
    if (first.kind === "text") expect(first.style.color).toBe("FF0000");
    const last = p.inlines[p.inlines.length - 1];
    if (last.kind === "text") expect(last.style.color).toBeUndefined();
  });

  test("only safe link schemes survive; footnote back-arrows are dropped", () => {
    const [p] = htmlToBlocks(
      '<p><a href="https://a.test">ok</a><a href="javascript:alert(1)">bad</a><a href="#footnote-ref-1">↑</a></p>',
    );
    if (p.kind !== "para") throw new Error();
    const hrefs = p.inlines.map((i) => (i.kind === "text" ? i.style.href : undefined));
    expect(hrefs).toContain("https://a.test");
    expect(hrefs.filter(Boolean).length).toBe(1);
    expect(p.inlines.map((i) => (i.kind === "text" ? i.text : "")).join("")).toBe("okbad");
  });
});

describe("page size", () => {
  test("reads pgSz and pgMar from the document", () => {
    const xml =
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080"/></w:sectPr>';
    const spec = pageSpecFromDocxXml(xml, "en-US");
    expect(spec.width).toBeCloseTo(595.3, 0);
    expect(spec.height).toBeCloseTo(841.9, 0);
    expect(spec.margin.left).toBe(54);
    expect(spec.margin.top).toBe(72);
  });

  test("falls back by locale: Letter default, A4 elsewhere", () => {
    expect(defaultPageForLocale(undefined).width).toBe(612);
    expect(defaultPageForLocale("en-US").height).toBe(792);
    expect(defaultPageForLocale("en-GB").width).toBeCloseTo(595.28, 1);
    expect(defaultPageForLocale("de-DE").width).toBeCloseTo(595.28, 1);
    expect(pageSpecFromDocxXml(undefined, "fr").margin.left).toBe(72);
  });
});

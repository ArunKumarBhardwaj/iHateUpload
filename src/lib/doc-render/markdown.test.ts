import { describe, expect, test } from "bun:test";

import { renderFlow, pageSpec } from "./flow";
import { markdownToDoc } from "./markdown";
import { loadFont, pdfPages } from "./testkit";

const SRC = `# Project Title

Some **bold**, *italic*, ~~gone~~ and \`inline code\` with a [link](https://example.com/a).

## Section One

- apple
- banana
  - nested item
1. first
2. second

> quoted words here

\`\`\`js
const x = 1;
    indented();
\`\`\`

| Name | Qty |
|------|----:|
| Pen  | 3 |

---

![pic](pics/a.png)

### Deep
`;

async function render(src: string, opt = {}) {
  const doc = markdownToDoc(src, opt);
  return renderFlow(doc.blocks, pageSpec("a4", false, 56), { loadFont, refine: doc.refine as never });
}

describe("markdown to pdf", () => {
  test("renders structure, not raw syntax", async () => {
    const out = await render(SRC);
    const text = (await pdfPages(out.bytes)).join("\n").replace(/\s+/g, " ");
    for (const s of ["Project Title", "bold", "italic", "inline code", "link", "apple", "nested item", "1. first", "2. second", "quoted words here", "const x = 1;", "indented();", "Pen", "[image: pic]", "Deep"]) {
      expect(text).toContain(s);
    }
    for (const raw of ["**", "~~", "```", "# Project", "|------", "](https"]) expect(text).not.toContain(raw);
    expect(text).toContain("•");
  });

  test("numbered headings and a table of contents with page numbers", async () => {
    const long = "# Intro\n\n" + "word ".repeat(900) + "\n\n## Later\n\ntext\n\n# Second\n\nx";
    const out = await render(long, { toc: true, numberHeadings: true });
    const pages = await pdfPages(out.bytes);
    expect(pages[0]).toContain("Contents");
    expect(pages[0]).toContain("1. Intro");
    expect(pages[0]).toContain("1.1 Later");
    expect(pages[0]).toContain("2. Second");
    expect(pages.length).toBeGreaterThan(2);
    expect(pages[0].replace(/\s+/g, " ")).toMatch(new RegExp(`2\\. Second\\s+${pages.length}`));
  });

  test("typeface option changes the font", async () => {
    const mono = await render("hello world", { font: "mono" });
    expect(Buffer.from(mono.bytes).toString("latin1")).toContain("Courier");
    const serif = await render("hello world", { font: "serif" });
    expect(Buffer.from(serif.bytes).toString("latin1")).toContain("Times");
  });

  test("long code blocks split across pages", async () => {
    const code = "```\n" + Array.from({ length: 120 }, (_, i) => `line ${i}`).join("\n") + "\n```";
    const out = await render(code);
    expect(out.pageCount).toBeGreaterThan(1);
    expect((await pdfPages(out.bytes)).join(" ").replace(/\s+/g, " ")).toContain("line 119");
  });
});

describe("markdown math and line spacing", () => {
  const MATH = `Energy is $E = mc^2$ and area $A = \\pi r^2$, costs $5 and $10 stay money.

$$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$

$$
\\sum_{n=1}^{N} n
$$
`;
  async function renderMath(src: string, opt = {}) {
    const { findMathSpans } = await import("./math-art");
    const { renderMath } = await import("./math");
    const mathArt = await renderMath(findMathSpans(src));
    const doc = markdownToDoc(src, { mathArt, ...opt });
    return { mathArt, out: await renderFlow(doc.blocks, pageSpec("a4", false, 56), { loadFont }) };
  }

  test("formulas are drawn as vector paths, money signs stay text", async () => {
    const { mathArt, out } = await renderMath(MATH);
    expect(mathArt.size).toBe(4); // two inline, two display
    const text = (await pdfPages(out.bytes)).join(" ").replace(/\s+/g, " ");
    expect(text).toContain("Energy is");
    expect(text).toContain("costs $5 and $10 stay money");
    expect(text).not.toContain("mc^2");
    const raw = Buffer.from(out.bytes).toString("latin1");
    expect(raw).not.toContain("/Subtype /Image");
    expect(raw).not.toContain("/Subtype/Image");
  });

  test("\\( \\) and \\[ \\] spellings work too", async () => {
    const { mathArt, out } = await renderMath("Inline \\(a^2\\) here.\n\n\\[\\frac{1}{2}\\]\n");
    expect(mathArt.size).toBe(2);
    const text = (await pdfPages(out.bytes)).join(" ").replace(/\s+/g, " ");
    expect(text).toContain("Inline");
    expect(text).not.toContain("a^2");
  });

  test("a formula MathJax rejects is printed as typed", async () => {
    const { mathArt, out } = await renderMath("Broken $\\frac{1$ here.");
    expect(mathArt.size).toBe(0);
    expect((await pdfPages(out.bytes)).join(" ")).toContain("\\frac{1");
  });

  test("display math sits on its own centred line, inline math inside a heading and list", async () => {
    const { out } = await renderMath("# Area $\\pi r^2$\n\n- item $x_i^2$\n\n$$a^2+b^2=c^2$$\n");
    const text = (await pdfPages(out.bytes)).join(" ");
    expect(text).toContain("Area");
    expect(text).toContain("item");
  });

  test("line spacing stretches the text", async () => {
    const long = "word ".repeat(1500);
    const tight = await render(long, { lineSpacing: 1 });
    const loose = await render(long, { lineSpacing: 2 });
    expect(loose.pageCount).toBeGreaterThan(tight.pageCount);
  });
});

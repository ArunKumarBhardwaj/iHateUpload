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

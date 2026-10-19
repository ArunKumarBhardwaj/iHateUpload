import { expect, test } from "bun:test";
import { PDFDocument } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { placeStamps, stampedPages } from "./header-footer";
import { processHeaderFooter } from "./extra-processors";
import { initialOptions } from "./tool-options";

test("range and skip-first pick the pages", () => {
  expect([...stampedPages("", false, 4)]).toEqual([0, 1, 2, 3]);
  expect([...stampedPages("", true, 4)]).toEqual([1, 2, 3]);
  expect([...stampedPages("2-3", false, 4)]).toEqual([1, 2]);
  expect([...stampedPages("1-2", true, 4)]).toEqual([1]);
});

test("margin and size place left, centre and right", () => {
  const placed = placeStamps(
    { left: "L", center: "C", right: "R", band: "footer", fontSize: 12, margin: 40 },
    600,
    800,
    (t) => t.length * 10,
  );
  expect(placed).toEqual([
    { text: "L", x: 40, y: 40 },
    { text: "C", x: 295, y: 40 },
    { text: "R", x: 550, y: 40 },
  ]);
  const header = placeStamps(
    { left: "L", center: "", right: "", band: "header", fontSize: 12, margin: 40 },
    600,
    800,
    () => 0,
  );
  expect(header[0].y).toBe(800 - 40 - 12);
});

test("processor stamps only the chosen pages with the chosen size", async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([400, 500]);
  const file = new File([await doc.save()], "doc.pdf", { type: "application/pdf" });
  const [result] = await processHeaderFooter(
    [{ id: "a", name: "doc.pdf", size: file.size, file }],
    () => {},
    {
      ...initialOptions("header-footer"),
      center: "P{page}",
      band: "footer",
      fontSize: 20,
      bold: true,
      color: "#ff0000",
      skipFirst: true,
      range: "1-2",
    } as never,
  );
  const pdf = await getDocument({
    data: new Uint8Array(await result.blob.arrayBuffer()),
  }).promise;
  const texts: string[] = [];
  let height = 0;
  for (let n = 1; n <= 3; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const items = content.items as { str: string; height: number }[];
    texts.push(items.map((i) => i.str).join(""));
    if (items[0]) height = items[0].height;
  }
  expect(texts).toEqual(["", "P2", ""]);
  expect(Math.round(height)).toBeGreaterThanOrEqual(19);
});

import { expect, test } from "bun:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { batesLabel, batesPlacement, batesPreview } from "./bates";
import type { FileItem } from "./job";
import { processAnnotatePdf } from "./extra-processors";
import { textPdf } from "./pdf-fixtures";
import { initialOptions, optionsReady } from "./tool-options";

async function item(pages: number, name: string): Promise<FileItem> {
  const bytes = await textPdf(
    Array.from({ length: pages }, (_, i) => `${name} body ${i + 1}`),
  );
  const file = new File([bytes], name, { type: "application/pdf" });
  return { id: name, name, size: file.size, file };
}

type Stamp = { text: string; x: number; y: number; height: number };

/** The last text item on every page, which is where the stamp goes. */
async function stamps(blob: Blob): Promise<Stamp[]> {
  const pdf = await getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    verbosity: 0,
  }).promise;
  const out: Stamp[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const items = (content.items as {
      str: string;
      transform: number[];
      height: number;
    }[]).filter((i) => i.str.trim() && !i.str.includes("body"));
    const last = items[items.length - 1];
    out.push(
      last
        ? { text: last.str, x: last.transform[4], y: last.transform[5], height: last.height }
        : { text: "", x: 0, y: 0, height: 0 },
    );
  }
  return out;
}

const bates = (files: FileItem[], patch: Record<string, unknown>) =>
  processAnnotatePdf(files, () => {}, {
    ...initialOptions("page-numbers"),
    bates: true,
    ...patch,
  } as never);

test("bates labels are prefix, zero-padded number, suffix", () => {
  const o = { batesPrefix: "ABC", batesSuffix: "-X", batesDigits: 6 };
  expect(batesLabel(o, 1)).toBe("ABC000001-X");
  expect(batesLabel(o, 1234567)).toBe("ABC1234567-X");
  expect(batesLabel({ ...o, batesDigits: 3, batesSuffix: "" }, 7)).toBe("ABC007");
});

test("bates stamps real selectable text, ABC000001 up", async () => {
  const [result] = await bates([await item(3, "one.pdf")], { batesPrefix: "ABC" });
  const got = await stamps(result.blob);
  expect(got.map((s) => s.text)).toEqual(["ABC000001", "ABC000002", "ABC000003"]);
  expect(got[0].height).toBe(9);
  expect(result.name).toBe("one-bates.pdf");
  expect(result.note).toBe("ABC000001 to ABC000003");
});

test("numbering runs on across files in the order given", async () => {
  const results = await bates([await item(3, "one.pdf"), await item(2, "two.pdf")], {
    batesPrefix: "CASE-",
    batesSuffix: "-CONF",
    batesDigits: 4,
    startAt: 10,
  });
  expect((await stamps(results[0].blob)).map((s) => s.text)).toEqual([
    "CASE-0010-CONF", "CASE-0011-CONF", "CASE-0012-CONF",
  ]);
  expect((await stamps(results[1].blob)).map((s) => s.text)).toEqual([
    "CASE-0013-CONF", "CASE-0014-CONF",
  ]);
  const swapped = await bates([await item(2, "two.pdf"), await item(3, "one.pdf")], {});
  expect((await stamps(swapped[1].blob))[0].text).toBe("ABC000003");
});

test("page range limits stamps in each file and only stamped pages count", async () => {
  const results = await bates([await item(4, "a.pdf"), await item(4, "b.pdf")], {
    range: "2-3",
  });
  expect((await stamps(results[0].blob)).map((s) => s.text)).toEqual(["", "ABC000001", "ABC000002", ""]);
  expect((await stamps(results[1].blob)).map((s) => s.text)).toEqual(["", "ABC000003", "ABC000004", ""]);
});

test("skip first page of each file leaves covers unnumbered and unspent", async () => {
  const results = await bates([await item(2, "a.pdf"), await item(2, "b.pdf")], {
    skipFirst: true,
  });
  expect((await stamps(results[0].blob)).map((s) => s.text)).toEqual(["", "ABC000001"]);
  expect((await stamps(results[1].blob)).map((s) => s.text)).toEqual(["", "ABC000002"]);
});

test("a range that misses a file names the file", async () => {
  await expect(
    bates([await item(1, "short.pdf")], { range: "5" }),
  ).rejects.toThrow(/short\.pdf/);
});

test("font size and position are honoured", async () => {
  const big = await bates([await item(1, "a.pdf")], { batesSize: 20, position: "tr" });
  const [s] = await stamps(big[0].blob);
  expect(s.height).toBe(20);
  // Top right: right edge sits one margin in, baseline one margin plus a line down.
  expect(Math.round(s.y)).toBe(500 - 28 - 20);
  expect(s.x).toBeGreaterThan(200);

  const bl = await bates([await item(1, "a.pdf")], { position: "bl", margin: 40 });
  const [b] = await stamps(bl[0].blob);
  expect(Math.round(b.x)).toBe(40);
  expect(Math.round(b.y)).toBe(40);
});

test("placement keeps the stamp inside the page for every position", () => {
  for (const position of ["header", "footer", "tl", "tr", "bl", "br"] as const) {
    const p = batesPlacement(position, 400, 500, 80, 9, 28);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + 80).toBeLessThanOrEqual(400);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y + 9).toBeLessThanOrEqual(500);
  }
});

test("a white plate keeps the number selectable", async () => {
  const [result] = await bates([await item(1, "a.pdf")], { batesPlate: true });
  expect((await stamps(result.blob))[0].text).toBe("ABC000001");
});

test("preview reports first and last number across files", () => {
  expect(
    batesPreview({ ...initialOptions("page-numbers"), bates: true } as never, [3, 2]),
  ).toEqual({ first: "ABC000001", last: "ABC000005", pages: 5 });
  expect(
    batesPreview(
      { ...initialOptions("page-numbers"), bates: true, skipFirst: true, startAt: 7 } as never,
      [3, 2],
    ),
  ).toEqual({ first: "ABC000007", last: "ABC000009", pages: 3 });
});

test("bates options need sane digits, size and start", () => {
  const base = { ...initialOptions("page-numbers"), bates: true } as never;
  expect(optionsReady(base, "")).toBe(true);
  expect(optionsReady({ ...(base as object), batesDigits: 0 } as never, "")).toBe(false);
  expect(optionsReady({ ...(base as object), batesSize: 2 } as never, "")).toBe(false);
  expect(optionsReady({ ...(base as object), startAt: -1 } as never, "")).toBe(false);
});

test("plain page numbers honour the page range too", async () => {
  const [result] = await processAnnotatePdf(
    [await item(3, "a.pdf")],
    () => {},
    { ...initialOptions("page-numbers"), numberFormat: "n", range: "2-" } as never,
  );
  expect((await stamps(result.blob)).map((s) => s.text)).toEqual(["", "2", "3"]);
});

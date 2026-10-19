// Synthetic fixtures for the split / Bates / metadata head-to-head. Usage: bun internal/benchmarks/pdf-tools/gen-fixtures.ts <outDir>
import { writeFileSync } from "node:fs";

import { PDFDocument, PDFHexString, PDFName } from "@cantoo/pdf-lib";

import { SAMPLE_XMP, textPdf } from "../../../src/lib/pdf-fixtures";
import { infoDict, setXmpPacket } from "../../../src/lib/pdf-meta";

const out = process.argv[2] ?? "internal/benchmarks/pdf-tools/fixtures";

const texts = Array.from({ length: 12 }, (_, i) =>
  i === 0
    ? "Annual Report\nPreface text"
    : i === 4
      ? "CHAPTER Two begins here"
      : i === 8
        ? "Chapter Three: the end\nbody"
        : `Body page ${i + 1}\nlorem ipsum ${i}`,
);
const outline = [
  {
    title: "Intro / Overview: Part?",
    page: 0,
    children: [
      { title: "Background", page: 1 },
      { title: "Scope", page: 2 },
    ],
  },
  {
    title: "Chapter Two",
    page: 4,
    children: [
      {
        title: "Detail A",
        page: 5,
        children: [{ title: "Deep", page: 6 }],
      },
      { title: "Detail B", page: 7 },
    ],
  },
  { title: "Chapter Three", page: 8 },
];
writeFileSync(`${out}/bookmarks.pdf`, await textPdf(texts, outline));
writeFileSync(
  `${out}/bates1.pdf`,
  await textPdf(Array.from({ length: 3 }, (_, i) => `Doc one page ${i + 1}`)),
);
writeFileSync(
  `${out}/bates2.pdf`,
  await textPdf(Array.from({ length: 2 }, (_, i) => `Doc two page ${i + 1}`)),
);

const meta = await PDFDocument.create();
meta.addPage([300, 300]);
meta.addPage([300, 300]);
meta.setTitle("Quarterly Plan");
meta.setAuthor("Test Author");
meta.setSubject("Synthetic");
meta.setKeywords(["alpha", "beta"]);
meta.setCreator("Fixture Maker");
meta.setProducer("Fixture Producer");
meta.setCreationDate(new Date("2020-01-02T03:04:05Z"));
meta.setModificationDate(new Date("2021-06-07T08:09:10Z"));
infoDict(meta).set(PDFName.of("Department"), PDFHexString.fromText("Finance"));
writeFileSync(`${out}/meta.pdf`, await meta.save());

setXmpPacket(meta, SAMPLE_XMP);
writeFileSync(`${out}/meta-xmp.pdf`, await meta.save());

// 300 pages, 30 chapters of 10 pages: a long file for the speed comparison.
const bigTexts = Array.from({ length: 300 }, (_, i) =>
  i % 10 === 0 ? `Chapter ${i / 10 + 1} opens here\nbody ${i + 1}` : `Body page ${i + 1}\nlorem ipsum dolor ${i}`,
);
const bigOutline = Array.from({ length: 30 }, (_, c) => ({ title: `Chapter ${c + 1}`, page: c * 10 }));
writeFileSync(`${out}/big.pdf`, await textPdf(bigTexts, bigOutline));

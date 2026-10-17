import { expect, test } from "bun:test";
import { PDFDocument, PDFHexString, PDFName } from "@cantoo/pdf-lib";

import type { FileItem } from "./job";
import { processEditMetadata, processStripMetadata } from "./extra-processors";
import {
  formatMetaDate,
  infoDict,
  loadForMetadata,
  parseXmpValues,
  patchXmp,
  readMetadata,
  setXmpPacket,
} from "./pdf-meta";
import { SAMPLE_XMP as XMP } from "./pdf-fixtures";
import { initialOptions, optionsReady } from "./tool-options";

async function makeDoc(opts: { xmp?: boolean } = {}) {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  doc.setTitle("Quarterly Plan");
  doc.setAuthor("Test Author");
  doc.setSubject("Synthetic & fake");
  doc.setKeywords(["alpha", "beta"]);
  doc.setCreator("Fixture Maker");
  doc.setProducer("Fixture Producer");
  doc.setCreationDate(new Date("2020-01-02T03:04:05Z"));
  doc.setModificationDate(new Date("2021-06-07T08:09:10Z"));
  infoDict(doc).set(PDFName.of("Department"), PDFHexString.fromText("Finance"));
  if (opts.xmp) setXmpPacket(doc, XMP);
  return doc.save();
}

async function metaItem(opts: { xmp?: boolean } = {}): Promise<FileItem> {
  const file = new File([await makeDoc(opts)], "meta.pdf", { type: "application/pdf" });
  return { id: "m", name: "meta.pdf", size: file.size, file };
}

async function current(item: FileItem) {
  return readMetadata(await loadForMetadata(await item.file.arrayBuffer()));
}

/** Options as the panel would hold them right after loading the file. */
async function loaded(item: FileItem, patch: Record<string, unknown> = {}) {
  const meta = await current(item);
  return {
    ...initialOptions("metadata"),
    sourceId: item.id,
    title: meta.title,
    author: meta.author,
    subject: meta.subject,
    keywords: meta.keywords,
    creator: meta.creator,
    producer: meta.producer,
    created: meta.created,
    modified: meta.modified,
    custom: meta.custom,
    ...patch,
  };
}

async function edit(item: FileItem, patch: Record<string, unknown>) {
  const [result] = await processEditMetadata([item], () => {}, (await loaded(item, patch)) as never);
  const doc = await loadForMetadata(await result.blob.arrayBuffer());
  return { result, doc, meta: readMetadata(doc) };
}

test("reading shows Info fields, dates and custom keys", async () => {
  const meta = await current(await metaItem());
  expect(meta.title).toBe("Quarterly Plan");
  expect(meta.author).toBe("Test Author");
  expect(meta.subject).toBe("Synthetic & fake");
  expect(meta.keywords).toBe("alpha beta");
  expect(meta.creator).toBe("Fixture Maker");
  expect(meta.producer).toBe("Fixture Producer");
  expect(meta.created).toBe(formatMetaDate(new Date("2020-01-02T03:04:05Z")));
  expect(meta.modified).toBe(formatMetaDate(new Date("2021-06-07T08:09:10Z")));
  expect(meta.custom).toEqual([{ key: "Department", value: "Finance" }]);
  expect(meta.xmp).toBeNull();
});

test("loading and saving adds no producer or dates of its own", async () => {
  const bare = await PDFDocument.create({ updateMetadata: false });
  bare.addPage();
  const doc = await loadForMetadata(await bare.save());
  const out = readMetadata(await loadForMetadata(await doc.save()));
  expect(out.producer).toBe("");
  expect(out.created).toBe("");
  expect(out.modified).toBe("");
});

test("editing one field leaves every other field byte-for-byte alone", async () => {
  const item = await metaItem();
  const { meta } = await edit(item, { title: "Renamed" });
  expect(meta.title).toBe("Renamed");
  expect(meta.author).toBe("Test Author");
  expect(meta.producer).toBe("Fixture Producer");
  expect(meta.created).toBe(formatMetaDate(new Date("2020-01-02T03:04:05Z")));
  expect(meta.custom).toEqual([{ key: "Department", value: "Finance" }]);
});

test("any field can be cleared", async () => {
  const { meta, doc } = await edit(await metaItem(), {
    author: "",
    keywords: "",
    created: "",
    modified: "",
  });
  expect(meta.author).toBe("");
  expect(meta.keywords).toBe("");
  expect(meta.created).toBe("");
  expect(meta.modified).toBe("");
  expect(infoDict(doc).get(PDFName.of("Author"))).toBeUndefined();
  expect(infoDict(doc).get(PDFName.of("CreationDate"))).toBeUndefined();
});

test("dates can be edited and unicode survives", async () => {
  const { meta } = await edit(await metaItem(), {
    created: "2019-12-31T23:59",
    title: "Prüfbericht — 検査",
  });
  expect(meta.created).toBe("2019-12-31T23:59");
  expect(meta.title).toBe("Prüfbericht — 検査");
});

test("custom keys can be added, changed and deleted", async () => {
  const item = await metaItem();
  const added = await edit(item, {
    custom: [
      { key: "Department", value: "Legal" },
      { key: "CaseNo", value: "42-B" },
    ],
  });
  expect(added.meta.custom).toEqual([
    { key: "CaseNo", value: "42-B" },
    { key: "Department", value: "Legal" },
  ]);
  const removed = await edit(item, { custom: [] });
  expect(removed.meta.custom).toEqual([]);
});

test("custom keys cannot shadow the standard ones or repeat", async () => {
  const item = await metaItem();
  const ready = async (custom: unknown) =>
    optionsReady((await loaded(item, { custom })) as never, "");
  expect(await ready([{ key: "Title", value: "x" }])).toBe(false);
  expect(await ready([{ key: "A", value: "1" }, { key: "A", value: "2" }])).toBe(false);
  expect(await ready([{ key: "A", value: "1" }])).toBe(true);
  expect(optionsReady(initialOptions("metadata"), "")).toBe(false);
});

test("XMP is read and shown", async () => {
  const meta = await current(await metaItem({ xmp: true }));
  expect(meta.xmp).toContain("<dc:title>");
  const values = parseXmpValues(meta.xmp!);
  expect(values.title).toBe("Quarterly Plan");
  expect(values.author).toBe("Test Author");
  expect(values.subject).toBe("Synthetic & fake");
  expect(values.keywords).toBe("alpha, beta");
  expect(values.producer).toBe("Fixture Producer");
  expect(values.creator).toBe("Fixture Maker");
});

test("editing updates the Info dictionary and the XMP packet together", async () => {
  const { meta } = await edit(await metaItem({ xmp: true }), {
    title: "New <Title> & more",
    author: "",
    keywords: "x, y",
    producer: "Acme 2",
    modified: "2024-05-06T07:08",
  });
  expect(meta.title).toBe("New <Title> & more");
  const xmp = parseXmpValues(meta.xmp!);
  expect(xmp.title).toBe("New <Title> & more");
  expect(xmp.author).toBe("");
  expect(meta.xmp).not.toContain("dc:creator");
  expect(xmp.keywords).toBe("x, y");
  expect(xmp.producer).toBe("Acme 2");
  expect(new Date(xmp.modified).getTime()).toBe(new Date("2024-05-06T07:08").getTime());
  // Untouched fields and foreign XMP properties stay.
  expect(xmp.subject).toBe("Synthetic & fake");
  expect(xmp.creator).toBe("Fixture Maker");
  expect(meta.xmp).toContain('acme:Secret="keep me"');
  expect(meta.xmp?.startsWith("<?xpacket")).toBe(true);
});

test("a field the XMP lacks is added to it", async () => {
  const bare = XMP.replace(/<pdf:Keywords>.*<\/pdf:Keywords>\n/, "");
  const patched = patchXmp(bare, { keywords: "new" });
  expect(parseXmpValues(patched).keywords).toBe("new");
  const attrOnly = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" pdf:Producer="Old"/></rdf:RDF></x:xmpmeta>`;
  const out = patchXmp(attrOnly, { producer: "New", title: "T" });
  const values = parseXmpValues(out);
  expect(values.producer).toBe("New");
  expect(values.title).toBe("T");
  expect(out).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"');
});

test("removing XMP deletes the packet and leaves Info edits in place", async () => {
  const { meta, doc } = await edit(await metaItem({ xmp: true }), { xmp: "remove", title: "Solo" });
  expect(meta.xmp).toBeNull();
  expect(doc.catalog.get(PDFName.of("Metadata"))).toBeUndefined();
  expect(meta.title).toBe("Solo");
});

test("a PDF without XMP does not gain one", async () => {
  const { meta } = await edit(await metaItem(), { title: "Plain" });
  expect(meta.xmp).toBeNull();
});

test("editing keeps the pages and does not add producer or dates of its own", async () => {
  const { result, doc } = await edit(await metaItem(), { title: "Same" });
  expect(doc.getPageCount()).toBe(1);
  expect(readMetadata(doc).producer).toBe("Fixture Producer");
  expect(result.name).toBe("meta-metadata.pdf");
});

test("strip everything wipes Info, custom keys, dates and XMP", async () => {
  const item = await metaItem({ xmp: true });
  const [result] = await processStripMetadata([item], () => {});
  const doc = await loadForMetadata(await result.blob.arrayBuffer());
  const meta = readMetadata(doc);
  expect(meta.title + meta.author + meta.subject + meta.keywords + meta.creator + meta.producer).toBe("");
  expect(meta.created).toBe("");
  expect(meta.modified).toBe("");
  expect(meta.custom).toEqual([]);
  expect(meta.xmp).toBeNull();
  expect(doc.getPageCount()).toBe(1);
});

test("the editor's strip path (all fields empty, XMP removed) matches the strip tool", async () => {
  const item = await metaItem({ xmp: true });
  const { meta } = await edit(item, {
    title: "", author: "", subject: "", keywords: "", creator: "", producer: "",
    created: "", modified: "", custom: [], xmp: "remove",
  });
  expect(meta.custom).toEqual([]);
  expect(meta.xmp).toBeNull();
  expect(meta.title).toBe("");
});

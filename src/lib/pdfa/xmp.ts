import { PDFDocument, PDFHexString, PDFName, PDFString } from "@cantoo/pdf-lib";

import { infoDict, setXmpPacket } from "@/lib/pdf-meta";

export type PdfAPart = 1 | 2 | 3;

const escapeXml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
    // XML 1.0 has no place for most control characters.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

const two = (n: number) => String(n).padStart(2, "0");

/** Both forms in UTC, so the Info dictionary and the XMP name the same instant. */
function xmpDate(d: Date) {
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}T${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}Z`;
}

function pdfDate(d: Date) {
  return `D:${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}Z`;
}

function infoText(doc: PDFDocument, key: string): string {
  const value = infoDict(doc).lookup(PDFName.of(key));
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : "";
}

const textObject = (value: string) =>
  /^[\x20-\x7e]*$/.test(value) ? PDFString.of(value) : PDFHexString.fromText(value);

/**
 * Rewrites the Info dictionary and the catalog XMP so they say the same thing
 * and name the PDF/A part. Custom XMP is not carried over: unknown schemas would
 * need extension schema declarations to stay valid. Custom Info keys stay.
 */
export function writePdfAMetadata(doc: PDFDocument, part: PdfAPart, now: Date) {
  const info = infoDict(doc);
  const fields = {
    title: infoText(doc, "Title"),
    author: infoText(doc, "Author"),
    subject: infoText(doc, "Subject"),
    keywords: infoText(doc, "Keywords"),
    creator: infoText(doc, "Creator"),
  };
  const createdRaw = doc.getCreationDate();
  const created = createdRaw && !Number.isNaN(createdRaw.getTime()) ? createdRaw : now;
  const producer = "iHateUpload";

  for (const key of ["Trapped", "CreationDate", "ModDate"]) info.delete(PDFName.of(key));
  const set = (key: string, value: string) => {
    if (value) info.set(PDFName.of(key), textObject(value));
    else info.delete(PDFName.of(key));
  };
  set("Title", fields.title);
  set("Author", fields.author);
  set("Subject", fields.subject);
  set("Keywords", fields.keywords);
  set("Creator", fields.creator);
  info.set(PDFName.of("Producer"), PDFString.of(producer));
  info.set(PDFName.of("CreationDate"), PDFString.of(pdfDate(created)));
  info.set(PDFName.of("ModDate"), PDFString.of(pdfDate(now)));

  const alt = (v: string) =>
    `<rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(v)}</rdf:li></rdf:Alt>`;
  const lines = [
    `<dc:format>application/pdf</dc:format>`,
    fields.title && `<dc:title>${alt(fields.title)}</dc:title>`,
    fields.author && `<dc:creator><rdf:Seq><rdf:li>${escapeXml(fields.author)}</rdf:li></rdf:Seq></dc:creator>`,
    fields.subject && `<dc:description>${alt(fields.subject)}</dc:description>`,
    fields.keywords && `<pdf:Keywords>${escapeXml(fields.keywords)}</pdf:Keywords>`,
    `<pdf:Producer>${producer}</pdf:Producer>`,
    fields.creator && `<xmp:CreatorTool>${escapeXml(fields.creator)}</xmp:CreatorTool>`,
    `<xmp:CreateDate>${xmpDate(created)}</xmp:CreateDate>`,
    `<xmp:ModifyDate>${xmpDate(now)}</xmp:ModifyDate>`,
    `<xmp:MetadataDate>${xmpDate(now)}</xmp:MetadataDate>`,
    `<pdfaid:part>${part}</pdfaid:part>`,
    `<pdfaid:conformance>B</pdfaid:conformance>`,
  ].filter(Boolean);
  const xml = [
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>`,
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">`,
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">`,
    `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">`,
    ...lines,
    `</rdf:Description>`,
    `</rdf:RDF>`,
    `</x:xmpmeta>`,
    // Room for a later in-place edit, as the XMP spec suggests.
    ...Array.from({ length: 5 }, () => " ".repeat(99)),
    `<?xpacket end="w"?>`,
  ].join("\n");
  setXmpPacket(doc, xml);
}

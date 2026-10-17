import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFStream,
  PDFString,
  decodePDFRawStream,
} from "@cantoo/pdf-lib";

export function stripPdfMetadata(doc: PDFDocument) {
  doc.setTitle("");
  doc.setAuthor("");
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setProducer("iHateUpload");
  doc.setCreator("iHateUpload");
}

// --- the metadata editor ----------------------------------------------------

export type MetaEntry = { key: string; value: string };

export type MetaFields = {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  /** Local time, `YYYY-MM-DDTHH:mm` (what a datetime-local input holds); "" is none. */
  created: string;
  modified: string;
};

export type PdfMetadata = MetaFields & {
  custom: MetaEntry[];
  /** The raw XMP packet, or null when the PDF has none. */
  xmp: string | null;
};

export const META_TEXT_KEYS = [
  "title",
  "author",
  "subject",
  "keywords",
  "creator",
  "producer",
] as const;

const INFO_KEYS: Record<keyof MetaFields, string> = {
  title: "Title",
  author: "Author",
  subject: "Subject",
  keywords: "Keywords",
  creator: "Creator",
  producer: "Producer",
  created: "CreationDate",
  modified: "ModDate",
};

/** Keys the form owns; anything else in the Info dictionary is a custom entry. */
export const RESERVED_INFO_KEYS = new Set(Object.values(INFO_KEYS));

/** pdf-lib rewrites Producer and ModDate on load unless told not to. */
export function loadForMetadata(bytes: ArrayBuffer | Uint8Array) {
  return PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
}

/** pdf-lib types `getInfoDict` as private; it is the documented way to reach /Info. */
export function infoDict(doc: PDFDocument) {
  return (doc as unknown as { getInfoDict(): PDFDict }).getInfoDict();
}

function two(n: number) {
  return String(n).padStart(2, "0");
}

export function formatMetaDate(date: Date) {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

function infoText(doc: PDFDocument, key: string): string {
  const value = infoDict(doc).lookup(PDFName.of(key));
  if (value instanceof PDFString || value instanceof PDFHexString) {
    return value.decodeText();
  }
  return "";
}

function infoDate(doc: PDFDocument, key: "CreationDate" | "ModDate") {
  const date = key === "CreationDate" ? doc.getCreationDate() : doc.getModificationDate();
  return date && !Number.isNaN(date.getTime()) ? formatMetaDate(date) : "";
}

export function readXmp(doc: PDFDocument): string | null {
  const stream = doc.catalog.lookup(PDFName.of("Metadata"));
  try {
    if (stream instanceof PDFRawStream) {
      return new TextDecoder().decode(decodePDFRawStream(stream).decode());
    }
    if (stream instanceof PDFStream) {
      return new TextDecoder().decode(stream.getContents());
    }
  } catch {
    // An XMP stream with a filter we cannot undo is treated as opaque.
  }
  return null;
}

export function readMetadata(doc: PDFDocument): PdfMetadata {
  const custom: MetaEntry[] = [];
  for (const [name, raw] of infoDict(doc).entries()) {
    const key = name.decodeText();
    if (RESERVED_INFO_KEYS.has(key)) continue;
    const value = doc.context.lookup(raw);
    if (value instanceof PDFString || value instanceof PDFHexString) {
      custom.push({ key, value: value.decodeText() });
    }
  }
  custom.sort((a, b) => a.key.localeCompare(b.key));
  return {
    title: infoText(doc, "Title"),
    author: infoText(doc, "Author"),
    subject: infoText(doc, "Subject"),
    keywords: infoText(doc, "Keywords"),
    creator: infoText(doc, "Creator"),
    producer: infoText(doc, "Producer"),
    created: infoDate(doc, "CreationDate"),
    modified: infoDate(doc, "ModDate"),
    custom,
    xmp: readXmp(doc),
  };
}

function textObject(value: string) {
   
  return /^[\x20-\x7e]*$/.test(value)
    ? PDFString.of(value)
    : PDFHexString.fromText(value);
}

export function setXmpPacket(doc: PDFDocument, xml: string | null) {
  if (xml === null) {
    doc.catalog.delete(PDFName.of("Metadata"));
    return;
  }
  const stream = doc.context.stream(new TextEncoder().encode(xml), {
    Type: "Metadata",
    Subtype: "XML",
  });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(stream));
}

// --- XMP ---------------------------------------------------------------------

type XmpProp = { ns: "dc" | "pdf" | "xmp"; name: string; shape: "alt" | "seq" | "plain" };

const XMP_PROPS: Record<keyof MetaFields, XmpProp> = {
  title: { ns: "dc", name: "title", shape: "alt" },
  author: { ns: "dc", name: "creator", shape: "seq" },
  subject: { ns: "dc", name: "description", shape: "alt" },
  keywords: { ns: "pdf", name: "Keywords", shape: "plain" },
  producer: { ns: "pdf", name: "Producer", shape: "plain" },
  creator: { ns: "xmp", name: "CreatorTool", shape: "plain" },
  created: { ns: "xmp", name: "CreateDate", shape: "plain" },
  modified: { ns: "xmp", name: "ModifyDate", shape: "plain" },
};

const XMP_NS = {
  dc: "http://purl.org/dc/elements/1.1/",
  pdf: "http://ns.adobe.com/pdf/1.3/",
  xmp: "http://ns.adobe.com/xap/1.0/",
};

const escapeXml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const unescapeXml = (text: string) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const tag = (prop: XmpProp) => `${prop.ns}:${prop.name}`;

function xmpElement(prop: XmpProp, value: string) {
  const text = escapeXml(value);
  const name = tag(prop);
  if (prop.shape === "alt") {
    return `<${name}><rdf:Alt><rdf:li xml:lang="x-default">${text}</rdf:li></rdf:Alt></${name}>`;
  }
  if (prop.shape === "seq") {
    return `<${name}><rdf:Seq><rdf:li>${text}</rdf:li></rdf:Seq></${name}>`;
  }
  return `<${name}>${text}</${name}>`;
}

function propMatchers(prop: XmpProp) {
  const name = tag(prop);
  return {
    selfClosing: new RegExp(`<${name}(?:\\s[^>]*?)?/>`),
    element: new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`),
    attribute: new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`),
  };
}

/** What the XMP packet currently says for each field the form knows. */
export function parseXmpValues(xml: string): MetaFields {
  const out = {} as MetaFields;
  for (const key of Object.keys(XMP_PROPS) as (keyof MetaFields)[]) {
    const { element, attribute } = propMatchers(XMP_PROPS[key]);
    const el = element.exec(xml);
    if (el) {
      const li = /<rdf:li\b[^>]*>([\s\S]*?)<\/rdf:li>/.exec(el[1]);
      out[key] = unescapeXml((li ? li[1] : el[1].replace(/<[^>]+>/g, "")).trim());
      continue;
    }
    const attr = attribute.exec(xml);
    out[key] = attr ? unescapeXml(attr[1] ?? attr[2] ?? "") : "";
  }
  return out;
}

/**
 * Rewrites only the properties named in `values` (empty string removes one) and
 * leaves every other part of the packet, foreign namespaces included, as it was.
 */
export function patchXmp(xml: string, values: Partial<MetaFields>): string {
  let out = xml;
  for (const key of Object.keys(values) as (keyof MetaFields)[]) {
    const value = values[key];
    if (value === undefined) continue;
    const prop = XMP_PROPS[key];
    const { selfClosing, element, attribute } = propMatchers(prop);
    out = out.replace(selfClosing, "").replace(element, "").replace(attribute, "");
    if (value === "") continue;

    const open = /<rdf:Description\b([^>]*?)(\/?)>/.exec(out);
    if (!open) continue;
    const declare = out.includes(`xmlns:${prop.ns}=`)
      ? ""
      : ` xmlns:${prop.ns}="${XMP_NS[prop.ns]}"`;
    const el = xmpElement(prop, value);
    if (open[2] === "/") {
      out =
        out.slice(0, open.index) +
        `<rdf:Description${open[1].replace(/\s+$/, "")}${declare}>${el}</rdf:Description>` +
        out.slice(open.index + open[0].length);
    } else {
      const close = out.indexOf("</rdf:Description>", open.index);
      if (close < 0) continue;
      const head = `<rdf:Description${open[1]}${declare}>`;
      out =
        out.slice(0, open.index) +
        head +
        out.slice(open.index + open[0].length, close) +
        el +
        out.slice(close);
    }
  }
  return out;
}

// --- apply / wipe ------------------------------------------------------------

export type MetaEdit = MetaFields & {
  custom: MetaEntry[];
  /** `update` keeps an existing XMP packet in agreement; `remove` drops it. */
  xmp: "update" | "remove";
};

function parseLocalDate(text: string, label: string) {
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is not a valid date.`);
  return date;
}

/**
 * Makes the Info dictionary say `edit`. Fields equal to what the file already
 * holds are not touched, so dates keep their seconds and zone. An existing XMP
 * packet gets the same changes.
 */
export function applyMetadata(doc: PDFDocument, edit: MetaEdit) {
  const before = readMetadata(doc);
  const info = infoDict(doc);
  const xmpChanges: Partial<MetaFields> = {};

  for (const key of META_TEXT_KEYS) {
    const next = edit[key];
    if (next === before[key]) continue;
    const name = PDFName.of(INFO_KEYS[key]);
    if (next === "") info.delete(name);
    else info.set(name, textObject(next));
    xmpChanges[key] = next;
  }

  for (const key of ["created", "modified"] as const) {
    const next = edit[key];
    if (next === before[key]) continue;
    const name = PDFName.of(INFO_KEYS[key]);
    if (next === "") {
      info.delete(name);
      xmpChanges[key] = "";
      continue;
    }
    const date = parseLocalDate(next, key === "created" ? "Created" : "Modified");
    if (key === "created") doc.setCreationDate(date);
    else doc.setModificationDate(date);
    xmpChanges[key] = date.toISOString();
  }

  const wanted = new Map<string, string>();
  for (const entry of edit.custom) {
    const key = entry.key.trim();
    if (key) wanted.set(key, entry.value);
  }
  for (const entry of before.custom) {
    if (!wanted.has(entry.key)) info.delete(PDFName.of(entry.key));
  }
  for (const [key, value] of wanted) {
    if (RESERVED_INFO_KEYS.has(key)) {
      throw new Error(`“${key}” is a standard field. Use its box above.`);
    }
    const had = before.custom.find((entry) => entry.key === key);
    if (!had || had.value !== value) info.set(PDFName.of(key), textObject(value));
  }

  if (edit.xmp === "remove") {
    setXmpPacket(doc, null);
  } else if (before.xmp !== null && Object.keys(xmpChanges).length > 0) {
    setXmpPacket(doc, patchXmp(before.xmp, xmpChanges));
  }
}

/** Empties the Info dictionary and drops every XMP packet and private-data blob. */
export function wipePdfMetadata(doc: PDFDocument) {
  const info = infoDict(doc);
  for (const key of info.keys()) info.delete(key);
  setXmpPacket(doc, null);
  doc.catalog.delete(PDFName.of("PieceInfo"));
  for (const page of doc.getPages()) {
    page.node.delete(PDFName.of("Metadata"));
    page.node.delete(PDFName.of("PieceInfo"));
  }
}

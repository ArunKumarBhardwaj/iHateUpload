/**
 * Repair PDF: try several independent rebuilds and keep the one that gets the
 * most pages and content back.
 *
 *  1. Re-save with pdf-lib. Its parser reads objects in file order and ignores
 *     a broken cross-reference table. Keeps bookmarks, forms and metadata.
 *  2. Salvage: parse every object we can find, collect the page objects that
 *     survived and build a new page tree and catalog around them. For files
 *     whose catalog is destroyed or whose page tree points at cut-off pages.
 *  3. Rebuild with pdf.js, whose own reconstruction handles damaged object and
 *     cross-reference streams, then write a fresh file with extractPages.
 *
 * Every candidate is re-opened with pdf.js and scored; the original is
 * diagnosed so the report can say what was wrong.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFInvalidObject,
  PDFParser,
  PDFRawStream,
  PDFRef,
  PDFWriter,
  decodePDFRawStream,
  type PDFContext,
} from "@cantoo/pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";

export type RepairMethod = "resave" | "salvage" | "pdfjs";

export type RepairReport = {
  /** Plain-language findings about the original file. */
  problems: string[];
  method: RepairMethod;
  /** Pages pdf.js could see in the original; null when it could not open it at all. */
  pagesBefore: number | null;
  pagesAfter: number;
  /** Pages whose content was cut off or missing and were left out. */
  droppedPages: number;
  /** Nothing was wrong; the file was only rewritten. */
  healthy: boolean;
};

export type RepairResult = { bytes: Uint8Array; report: RepairReport };

/** Opens bytes with pdf.js. Injected so tests run in bun and the page uses loadPdfJs(). */
export type OpenPdf = (bytes: Uint8Array) => Promise<PDFDocumentProxy>;

const latin1 = (bytes: Uint8Array) => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
};

/** What is visibly wrong with the bytes, in words a person understands. */
export function diagnose(bytes: Uint8Array): string[] {
  const s = latin1(bytes);
  const problems: string[] = [];
  const header = s.indexOf("%PDF-");
  if (header < 0) problems.push("The file has no PDF header.");
  else if (header > 0) problems.push(`There are ${header} bytes of junk before the PDF starts.`);
  if (s.lastIndexOf("%%EOF") < 0) problems.push("The end of the file is missing (the download or copy was probably cut short).");

  const startMatch = /startxref\s+(\d+)/g;
  let last: RegExpExecArray | null = null;
  for (let m = startMatch.exec(s); m; m = startMatch.exec(s)) last = m;
  if (!last) {
    problems.push("The pointer to the cross-reference table is missing.");
  } else {
    const at = Number(last[1]) + Math.max(0, header);
    const there = s.slice(at, at + 40);
    if (!/^\s*(xref|\d+\s+\d+\s+obj)/.test(there)) problems.push("The pointer to the cross-reference table is wrong.");
  }

  // Classic xref tables: check that entries point at their objects.
  const xrefAt = s.lastIndexOf("\nxref");
  if (xrefAt >= 0) {
    const table = s.slice(xrefAt, s.indexOf("trailer", xrefAt) >>> 0);
    let bad = 0;
    let checked = 0;
    const section = /(\d+) (\d+)\s*\n((?:\d{10} \d{5} [nf]\s*\n?)+)/g;
    for (let m = section.exec(table); m; m = section.exec(table)) {
      const first = Number(m[1]);
      m[3].trim().split(/\s*\n/).forEach((entry, i) => {
        const [off, , kind] = entry.trim().split(" ");
        if (kind !== "n" || checked > 400) return;
        checked++;
        const pos = Number(off) + Math.max(0, header);
        if (!new RegExp(`^\\s*${first + i}\\s+\\d+\\s+obj`).test(s.slice(pos, pos + 30))) bad++;
      });
    }
    if (bad > 0) problems.push(`${bad} of ${checked} cross-reference entries point to the wrong place.`);
  } else if (!/\/Type\s*\/XRef/.test(s)) {
    problems.push("The cross-reference table is missing.");
  }
  if (!/\/Type\s*\/Catalog/.test(s)) problems.push("The document catalog (the file's table of contents) is missing.");

  // Streams whose /Length disagrees with where "endstream" really is.
  const streamRe = /\/Length\s+(\d+)(?![\d\s]*R)[^]*?>>\s*stream\r?\n/g;
  let wrongLength = 0;
  for (let m = streamRe.exec(s); m && wrongLength < 50; m = streamRe.exec(s)) {
    if (m[0].length > 600) continue; // matched across objects; not a simple stream header
    const dataStart = m.index + m[0].length;
    const declared = Number(m[1]);
    const after = s.slice(dataStart + declared, dataStart + declared + 12);
    if (!/^[\s\0]*endstream/.test(after)) wrongLength++;
  }
  if (wrongLength > 0) problems.push(`${wrongLength} data stream${wrongLength === 1 ? " has" : "s have"} the wrong length.`);
  return problems;
}

/** 1-based numbers of pages whose content streams do not decompress. */
async function damagedPages(bytes: Uint8Array): Promise<number[]> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
    if (doc.isEncrypted) return [];
    const out: number[] = [];
    doc.getPages().forEach((page, index) => {
      const raw = page.node.get(PDFName.of("Contents"));
      const refs = raw instanceof PDFArray ? raw.asArray() : raw ? [raw] : [];
      for (const ref of refs) {
        const stream = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
        if (!(stream instanceof PDFRawStream)) continue;
        try {
          const data = decodePDFRawStream(stream).decode();
          // A stream of zeros decompresses to nothing useful either.
          if (data.length > 0 && data.every((b) => b === 0)) throw new Error("zeros");
        } catch {
          out.push(index + 1);
          break;
        }
      }
    });
    return out;
  } catch {
    return [];
  }
}

/** Strip anything before the header so every parser starts in the right place. */
function fromHeader(bytes: Uint8Array) {
  const head = latin1(bytes.subarray(0, Math.min(bytes.length, 1 << 20)));
  const at = head.indexOf("%PDF-");
  return at > 0 ? bytes.subarray(at) : bytes;
}

/**
 * Objects that must not be copied into the new file: garbage the parser could
 * not read, and the old file's cross-reference and object-stream containers
 * (their contents are already unpacked, and a damaged one breaks the output).
 */
function dropJunk(context: PDFContext) {
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    const type = obj instanceof PDFDict || obj instanceof PDFRawStream ? (obj instanceof PDFRawStream ? obj.dict : obj).get(PDFName.of("Type")) : undefined;
    if (obj instanceof PDFInvalidObject || type === PDFName.of("XRef") || type === PDFName.of("ObjStm")) context.delete(ref);
  }
}

async function resave(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
  if (doc.isEncrypted) throw new Error("encrypted");
  dropJunk(doc.context);
  return doc.save({ useObjectStreams: false, addDefaultPage: false });
}

const INHERITED = ["Resources", "MediaBox", "CropBox", "Rotate"] as const;

function isType(obj: unknown, type: string): obj is PDFDict {
  return obj instanceof PDFDict && obj.get(PDFName.of("Type")) === PDFName.of(type);
}

/** Page refs in page-tree order, then any orphans by object number. */
function orderedPages(context: PDFContext): { refs: PDFRef[]; dropped: number } {
  const pages = new Map<PDFRef, PDFDict>();
  const trees: PDFDict[] = [];
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (isType(obj, "Page")) pages.set(ref, obj);
    else if (isType(obj, "Pages")) trees.push(obj);
  }
  const order: PDFRef[] = [];
  const seen = new Set<PDFRef>();
  let dropped = 0;
  const walk = (node: PDFDict, depth: number) => {
    const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
    if (!kids || depth > 50) return;
    for (let i = 0; i < kids.size(); i++) {
      const ref = kids.get(i);
      if (!(ref instanceof PDFRef) || seen.has(ref)) continue;
      seen.add(ref);
      const kid = context.lookup(ref);
      if (isType(kid, "Pages")) walk(kid, depth + 1);
      else if (pages.has(ref)) order.push(ref);
      else dropped++; // listed in the tree but the object is gone
    }
  };
  // Roots of the old tree: page-tree nodes whose parent is missing or is not a tree node.
  for (const tree of trees) {
    const parent = tree.get(PDFName.of("Parent"));
    if (!(parent instanceof PDFRef) || !isType(context.lookup(parent), "Pages")) walk(tree, 0);
  }
  const orphans = [...pages.keys()].filter((ref) => !seen.has(ref)).sort((a, b) => a.objectNumber - b.objectNumber);
  return { refs: [...order, ...orphans], dropped };
}

/** True when the page lists content streams and none of them survived. */
function contentLost(context: PDFContext, page: PDFDict): boolean {
  const raw = page.get(PDFName.of("Contents"));
  if (!raw) return false;
  const refs = raw instanceof PDFArray ? raw.asArray() : [raw];
  return refs.every((ref) => ref instanceof PDFRef && context.lookup(ref) === undefined);
}

async function salvage(bytes: Uint8Array): Promise<{ bytes: Uint8Array; dropped: number }> {
  const context = await PDFParser.forBytesWithOptions(bytes, 1000, false).parseDocument();
  if (context.trailerInfo.Encrypt) throw new Error("encrypted");
  dropJunk(context);
  const { refs, dropped: missing } = orderedPages(context);
  let dropped = missing;
  const kept: PDFRef[] = [];
  const boxes: string[] = [];
  for (const ref of refs) {
    const page = context.lookup(ref) as PDFDict;
    if (contentLost(context, page)) {
      dropped++;
      continue;
    }
    // Pull inherited attributes down from the old tree, which is about to be replaced.
    for (const key of INHERITED) {
      if (page.get(PDFName.of(key))) continue;
      let parent = page.get(PDFName.of("Parent"));
      for (let depth = 0; parent instanceof PDFRef && depth < 50; depth++) {
        const node = context.lookup(parent);
        if (!(node instanceof PDFDict)) break;
        const value = node.get(PDFName.of(key));
        if (value) {
          page.set(PDFName.of(key), value);
          break;
        }
        parent = node.get(PDFName.of("Parent"));
      }
    }
    const box = page.lookupMaybe(PDFName.of("MediaBox"), PDFArray);
    if (box) boxes.push(box.toString());
    kept.push(ref);
  }
  if (kept.length === 0) throw new Error("no pages survived");
  // A page that lost its size takes the most common size of the others, else US Letter.
  const common = boxes.sort((a, b) => boxes.filter((x) => x === b).length - boxes.filter((x) => x === a).length)[0];
  const pagesRef = context.nextRef();
  for (const ref of kept) {
    const page = context.lookup(ref) as PDFDict;
    page.set(PDFName.of("Parent"), pagesRef);
    if (!page.get(PDFName.of("MediaBox"))) {
      const fallback = common ? common.slice(1, -1).trim().split(/\s+/).map(Number) : [0, 0, 612, 792];
      page.set(PDFName.of("MediaBox"), context.obj(fallback));
    }
    if (!page.get(PDFName.of("Resources"))) page.set(PDFName.of("Resources"), context.obj({}));
  }
  context.assign(pagesRef, context.obj({ Type: "Pages", Kids: kept, Count: PDFNumber.of(kept.length) }));

  // Keep what a surviving catalog still has that is worth keeping.
  const catalog = context.obj({ Type: "Catalog", Pages: pagesRef });
  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (!isType(obj, "Catalog")) continue;
    for (const key of ["Outlines", "AcroForm", "Lang", "PageLabels", "ViewerPreferences", "Names"]) {
      const value = obj.get(PDFName.of(key));
      if (value) catalog.set(PDFName.of(key), value);
    }
    break;
  }
  context.trailerInfo.Root = context.register(catalog);
  if (context.trailerInfo.Info instanceof PDFRef && !context.lookup(context.trailerInfo.Info)) {
    context.trailerInfo.Info = undefined;
  }
  const rebuilt = await PDFWriter.forContext(context, 1000).serializeToBuffer();
  // Round-trip through a full load so the result is a clean, freshly indexed file.
  const doc = await PDFDocument.load(rebuilt, { updateMetadata: false });
  return { bytes: await doc.save({ useObjectStreams: false, addDefaultPage: false }), dropped };
}

async function viaPdfjs(bytes: Uint8Array, open: OpenPdf): Promise<Uint8Array> {
  const doc = await open(bytes.slice());
  try {
    const out = await doc.extractPages([{ document: null }]);
    if (!out || out.length === 0) throw new Error("pdf.js wrote nothing");
    return out;
  } finally {
    await doc.loadingTask.destroy();
  }
}

type Score = { pages: number; readable: number; text: number; ops: number };

/** How much a viewer can show: pages, characters of text, and drawing operations. */
async function measure(bytes: Uint8Array, open: OpenPdf): Promise<Score | null> {
  let doc: PDFDocumentProxy;
  try {
    doc = await open(bytes.slice());
  } catch {
    return null;
  }
  try {
    const score: Score = { pages: doc.numPages, readable: 0, text: 0, ops: 0 };
    for (let n = 1; n <= doc.numPages; n++) {
      try {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        score.text += content.items.reduce((sum, item) => sum + ("str" in item ? item.str.length : 0), 0);
        score.ops += (await page.getOperatorList()).fnArray.length;
        score.readable++;
        page.cleanup();
      } catch {
        // A page that cannot be read counts as empty.
      }
    }
    return score;
  } catch {
    return null;
  } finally {
    await doc.loadingTask.destroy();
  }
}

/**
 * Positive when `a` is the better rebuild. A file with any page a reader cannot
 * open loses to one where every page opens; then more readable pages, more text,
 * and clearly more drawing win. Small differences count as a tie, which the
 * earlier route (the one that keeps more structure) then wins.
 */
const better = (a: Score, b: Score) => {
  const whole = Number(a.readable === a.pages) - Number(b.readable === b.pages);
  if (whole) return whole;
  if (a.readable !== b.readable) return a.readable - b.readable;
  if (Math.abs(a.text - b.text) > Math.max(2, 0.01 * Math.max(a.text, b.text))) return a.text - b.text;
  if (Math.abs(a.ops - b.ops) > 0.02 * Math.max(a.ops, b.ops)) return a.ops - b.ops;
  return 0;
};

export async function repairPdf(
  input: Uint8Array,
  open: OpenPdf,
  onProgress: (ratio: number) => void = () => {},
): Promise<RepairResult> {
  const problems = diagnose(input);
  const bytes = fromHeader(input);
  const before = await measure(bytes, open);
  if (before === null) problems.push("Standard PDF readers cannot open it as it is.");
  else if (before.readable < before.pages) problems.push(`${before.pages - before.readable} of ${before.pages} pages cannot be opened.`);
  const damaged = await damagedPages(bytes);
  if (damaged.length > 0) {
    const list = damaged.length > 5 ? `${damaged.slice(0, 5).join(", ")} and ${damaged.length - 5} more` : damaged.join(", ");
    problems.unshift(`The content of page${damaged.length === 1 ? "" : "s"} ${list} is damaged and cannot be drawn.`);
  }
  if (problems.length === 0) {
    // Damage hidden inside compressed objects or cross-reference streams.
    try {
      await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: true, updateMetadata: false });
    } catch {
      problems.push("Some objects inside the file are damaged.");
    }
  }
  onProgress(0.15);

  const candidates: Array<{ method: RepairMethod; bytes: Uint8Array; dropped: number; score: Score }> = [];
  const attempts: Array<[RepairMethod, () => Promise<{ bytes: Uint8Array; dropped: number }>]> = [
    ["resave", async () => ({ bytes: await resave(bytes), dropped: 0 })],
    ["salvage", () => salvage(bytes)],
    ["pdfjs", async () => ({ bytes: await viaPdfjs(bytes, open), dropped: 0 })],
  ];
  for (let i = 0; i < attempts.length; i++) {
    const [method, run] = attempts[i];
    try {
      const out = await run();
      const score = await measure(out.bytes, open);
      // A candidate must also load in pdf-lib, which is stricter about structure.
      // pdf.js draws text with a stand-in font when the real one is gone; other readers draw nothing.
      if (score && method === "pdfjs" && score.text > 0 && !/\/Font\b/.test(latin1(out.bytes))) score.text = 0;
      if (score && score.readable > 0) {
        await PDFDocument.load(out.bytes, { updateMetadata: false, throwOnInvalidObject: true });
        candidates.push({ method, bytes: out.bytes, dropped: out.dropped, score });
      }
    } catch {
      // This route could not rebuild the file; the others may.
    }
    onProgress(0.15 + (0.8 * (i + 1)) / attempts.length);
  }
  if (candidates.length === 0) {
    throw new Error("This file is too damaged to rebuild: no readable pages were found in it.");
  }
  // Best content wins; on a tie the earlier route wins, because it keeps the most structure.
  let best = candidates[0];
  for (const c of candidates.slice(1)) if (better(c.score, best.score) > 0) best = c;
  if (best.score.text < (before?.text ?? 0)) problems.push("Some text could not be recovered.");
  const healthy = problems.length === 0;
  onProgress(1);
  return {
    bytes: best.bytes,
    report: {
      problems,
      method: best.method,
      pagesBefore: before?.pages ?? null,
      pagesAfter: best.score.pages,
      droppedPages: best.method === "salvage" ? best.dropped : 0,
      healthy,
    },
  };
}

/** One line for the result card. */
export function reportLine(report: RepairReport): string {
  if (report.healthy) return `No damage found. Rewrote all ${report.pagesAfter} pages with a fresh index.`;
  const what =
    report.method === "salvage"
      ? "Rebuilt the page list from the pages that survived"
      : report.method === "pdfjs"
        ? "Rebuilt the file from what a reader could still see"
        : "Rebuilt the cross-reference table";
  const lost = report.droppedPages > 0 ? ` ${report.droppedPages} cut-off page${report.droppedPages === 1 ? " was" : "s were"} left out.` : "";
  return `${report.problems[0]} ${what}: ${report.pagesAfter} page${report.pagesAfter === 1 ? "" : "s"} recovered.${lost}`;
}

import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  type PDFDocument,
} from "@cantoo/pdf-lib";

/** a b c d e f, the six numbers of a PDF transform. */
type Matrix = [number, number, number, number, number, number];

/** Largest size an image is drawn at anywhere in the document, in points. */
export type Placement = { widthPt: number; heightPt: number };

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const MAX_FORM_DEPTH = 8;

/** `m × ctm`, the order `cm` and form matrices concatenate in. */
function concat(m: Matrix, ctm: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const [A, B, C, D, E, F] = ctm;
  return [
    a * A + b * C,
    a * B + b * D,
    c * A + d * C,
    c * B + d * D,
    e * A + f * C + E,
    e * B + f * D + F,
  ];
}

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

type Token =
  | { type: "number"; value: number }
  | { type: "name"; value: string }
  | { type: "op"; value: string }
  | { type: "other" };

/**
 * Just enough of a content-stream lexer to follow `q`, `Q`, `cm`, and `Do`.
 * Strings, arrays, and dictionaries become opaque tokens; inline images are
 * skipped whole so their bytes never read as operators.
 */
function* tokens(bytes: Uint8Array): Generator<Token> {
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const ch = bytes[i];
    if (WHITESPACE.has(ch)) {
      i++;
      continue;
    }
    if (ch === 0x25) {
      while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
      continue;
    }
    if (ch === 0x28) {
      let depth = 0;
      for (; i < n; i++) {
        const c = bytes[i];
        if (c === 0x5c) i++;
        else if (c === 0x28) depth++;
        else if (c === 0x29 && --depth === 0) break;
      }
      i++;
      yield { type: "other" };
      continue;
    }
    if (ch === 0x3c) {
      if (bytes[i + 1] === 0x3c) {
        i += 2;
        yield { type: "other" };
        continue;
      }
      while (i < n && bytes[i] !== 0x3e) i++;
      i++;
      yield { type: "other" };
      continue;
    }
    if (ch === 0x3e || ch === 0x5b || ch === 0x5d || ch === 0x7b || ch === 0x7d) {
      i += ch === 0x3e && bytes[i + 1] === 0x3e ? 2 : 1;
      yield { type: "other" };
      continue;
    }
    const start = i;
    i++;
    while (i < n && !WHITESPACE.has(bytes[i]) && !DELIMITERS.has(bytes[i])) i++;
    const word = String.fromCharCode(...bytes.subarray(start, i));
    if (ch === 0x2f) {
      yield { type: "name", value: word.slice(1) };
    } else if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      yield { type: "number", value: Number(word) };
    } else if (word === "ID") {
      // Inline image data runs until whitespace, EI, whitespace.
      i++;
      while (i < n) {
        if (
          bytes[i] === 0x45 &&
          bytes[i + 1] === 0x49 &&
          WHITESPACE.has(bytes[i - 1]) &&
          (i + 2 >= n || WHITESPACE.has(bytes[i + 2]))
        ) {
          i += 2;
          break;
        }
        i++;
      }
      yield { type: "other" };
    } else {
      yield { type: "op", value: word };
    }
  }
}

function streamBytes(doc: PDFDocument, contents: unknown): Uint8Array[] {
  const resolved =
    contents instanceof PDFRef ? doc.context.lookup(contents) : contents;
  if (resolved instanceof PDFRawStream) {
    try {
      return [decodePDFRawStream(resolved).decode()];
    } catch {
      return [];
    }
  }
  if (resolved instanceof PDFArray) {
    return resolved.asArray().flatMap((item) => streamBytes(doc, item));
  }
  return [];
}

function readMatrix(doc: PDFDocument, dict: PDFDict): Matrix {
  const raw = dict.lookup(PDFName.of("Matrix"));
  if (!(raw instanceof PDFArray) || raw.size() !== 6) return IDENTITY;
  const values = raw.asArray().map((item) => {
    const value = item instanceof PDFRef ? doc.context.lookup(item) : item;
    return value instanceof PDFNumber ? value.asNumber() : NaN;
  });
  return values.some(Number.isNaN) ? IDENTITY : (values as Matrix);
}

function record(
  placements: Map<string, Placement>,
  ref: PDFRef,
  ctm: Matrix,
) {
  const widthPt = Math.hypot(ctm[0], ctm[1]);
  const heightPt = Math.hypot(ctm[2], ctm[3]);
  const key = ref.toString();
  const prev = placements.get(key);
  placements.set(key, {
    widthPt: Math.max(prev?.widthPt ?? 0, widthPt),
    heightPt: Math.max(prev?.heightPt ?? 0, heightPt),
  });
}

function walk(
  doc: PDFDocument,
  chunks: Uint8Array[],
  resources: PDFDict | undefined,
  start: Matrix,
  placements: Map<string, Placement>,
  depth: number,
) {
  const xobjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  const stack: Matrix[] = [];
  let ctm = start;
  let operands: Token[] = [];

  for (const chunk of chunks) {
    for (const token of tokens(chunk)) {
      if (token.type !== "op") {
        operands.push(token);
        continue;
      }
      if (token.value === "q") {
        stack.push(ctm);
      } else if (token.value === "Q") {
        ctm = stack.pop() ?? start;
      } else if (token.value === "cm") {
        const nums = operands.slice(-6);
        if (nums.length === 6 && nums.every((t) => t.type === "number")) {
          const m = nums.map((t) => (t as { value: number }).value) as Matrix;
          ctm = concat(m, ctm);
        }
      } else if (token.value === "Do") {
        const name = operands.at(-1);
        if (name?.type === "name" && xobjects) {
          const ref = xobjects.get(PDFName.of(name.value));
          const target = ref instanceof PDFRef ? doc.context.lookup(ref) : null;
          if (ref instanceof PDFRef && target instanceof PDFRawStream) {
            const subtype = target.dict.get(PDFName.of("Subtype"));
            if (subtype === PDFName.of("Image")) {
              record(placements, ref, ctm);
            } else if (
              subtype === PDFName.of("Form") &&
              depth < MAX_FORM_DEPTH
            ) {
              const formResources =
                target.dict.lookupMaybe(PDFName.of("Resources"), PDFDict) ??
                resources;
              walk(
                doc,
                streamBytes(doc, target),
                formResources,
                concat(readMatrix(doc, target.dict), ctm),
                placements,
                depth + 1,
              );
            }
          }
        }
      }
      operands = [];
    }
  }
}

/**
 * Maps each image XObject ref ("12 0 R") to the largest size any page draws
 * it at. Images that only appear in annotations, patterns, or soft masks are
 * absent, so callers leave them untouched.
 */
export function scanImagePlacements(doc: PDFDocument): Map<string, Placement> {
  const placements = new Map<string, Placement>();
  for (const page of doc.getPages()) {
    walk(
      doc,
      streamBytes(doc, page.node.Contents()),
      page.node.Resources(),
      IDENTITY,
      placements,
      0,
    );
  }
  return placements;
}

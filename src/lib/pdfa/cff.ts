import { CFF_STANDARD_STRINGS } from "./cff-strings";

/**
 * Just enough of a bare CFF font to know each glyph's name and advance width,
 * so the Widths written into a PDF match the program exactly.
 */

type Index = { items: Uint8Array[]; end: number };

function readIndex(data: Uint8Array, at: number): Index {
  const count = (data[at] << 8) | data[at + 1];
  if (count === 0) return { items: [], end: at + 2 };
  const size = data[at + 2];
  const offset = (i: number) => {
    let v = 0;
    for (let k = 0; k < size; k++) v = (v << 8) | data[at + 3 + i * size + k];
    return v;
  };
  const base = at + 3 + (count + 1) * size - 1;
  const items: Uint8Array[] = [];
  for (let i = 0; i < count; i++) items.push(data.subarray(base + offset(i), base + offset(i + 1)));
  return { items, end: base + offset(count) };
}

/** Operator -> operands of a Top or Private DICT. Two-byte operators are 1200 + second byte. */
function readDict(data: Uint8Array): Map<number, number[]> {
  const out = new Map<number, number[]>();
  let stack: number[] = [];
  for (let i = 0; i < data.length; ) {
    const b = data[i];
    if (b <= 21) {
      const op = b === 12 ? 1200 + data[i + 1] : b;
      i += b === 12 ? 2 : 1;
      out.set(op, stack);
      stack = [];
    } else if (b === 28) {
      stack.push(((data[i + 1] << 24) | (data[i + 2] << 16)) >> 16);
      i += 3;
    } else if (b === 29) {
      stack.push((data[i + 1] << 24) | (data[i + 2] << 16) | (data[i + 3] << 8) | data[i + 4]);
      i += 5;
    } else if (b === 30) {
      // Real number: nibbles until 0xf.
      let s = "";
      const map = "0123456789.EE?-";
      for (i++; i < data.length; i++) {
        const hi = data[i] >> 4;
        const lo = data[i] & 15;
        if (hi === 15) break;
        s += hi === 12 ? "E-" : map[hi];
        if (lo === 15) break;
        s += lo === 12 ? "E-" : map[lo];
      }
      i++;
      stack.push(Number(s) || 0);
    } else if (b >= 32 && b <= 246) {
      stack.push(b - 139);
      i++;
    } else if (b >= 247 && b <= 250) {
      stack.push((b - 247) * 256 + data[i + 1] + 108);
      i += 2;
    } else if (b >= 251 && b <= 254) {
      stack.push(-(b - 251) * 256 - data[i + 1] - 108);
      i += 2;
    } else i++;
  }
  return out;
}

const bias = (subrs: Uint8Array[]) => (subrs.length < 1240 ? 107 : subrs.length < 33900 ? 1131 : 32768);

/**
 * The advance in a Type 2 charstring: the first operand when the first
 * stack-clearing operator has one too many. Subroutines are followed, since
 * fonts often keep their hints in them.
 */
function charstringWidth(cs: Uint8Array, local: Uint8Array[], global: Uint8Array[]): number | null | "default" {
  const stack: number[] = [];
  let depth = 0;
  const run = (code: Uint8Array): number | null | "default" | undefined => {
    if (++depth > 10) return null;
    for (let i = 0; i < code.length; ) {
      const b = code[i];
      if (b === 28) {
        stack.push(((code[i + 1] << 24) | (code[i + 2] << 16)) >> 16);
        i += 3;
      } else if (b >= 32 && b <= 246) {
        stack.push(b - 139);
        i++;
      } else if (b >= 247 && b <= 250) {
        stack.push((b - 247) * 256 + code[i + 1] + 108);
        i += 2;
      } else if (b >= 251 && b <= 254) {
        stack.push(-(b - 251) * 256 - code[i + 1] - 108);
        i += 2;
      } else if (b === 255) {
        stack.push(((code[i + 1] << 24) | (code[i + 2] << 16) | (code[i + 3] << 8) | code[i + 4]) / 65536);
        i += 5;
      } else if (b === 10 || b === 29) {
        const subrs = b === 10 ? local : global;
        const sub = subrs[(stack.pop() ?? 0) + bias(subrs)];
        if (!sub) return null;
        const found = run(sub);
        depth--;
        if (found !== undefined) return found;
        i++;
      } else if (b === 11) {
        return undefined;
      } else {
        const odd = stack.length % 2 === 1;
        switch (b) {
          case 1: case 3: case 18: case 23: case 19: case 20:
            return odd ? stack[0] : "default";
          case 21:
            return stack.length > 2 ? stack[0] : "default";
          case 22: case 4:
            return stack.length > 1 ? stack[0] : "default";
          case 14:
            return stack.length === 1 || stack.length === 5 ? stack[0] : "default";
          default:
            return null;
        }
      }
    }
    return undefined;
  };
  return run(cs) ?? "default";
}

/** Glyph name -> advance width (in 1/1000 em for the usual 1000-unit fonts), or null if this is not a name-keyed CFF. */
export function cffWidths(data: Uint8Array): Map<string, number> | null {
  return parse(data)?.widths ?? null;
}

/** Every glyph name in a name-keyed CFF, .notdef left out. */
export function cffGlyphNames(data: Uint8Array): string[] | null {
  const font = parse(data);
  return font ? font.names.filter((n) => n !== ".notdef") : null;
}

function parse(data: Uint8Array): { names: string[]; widths: Map<string, number> } | null {
  if (data.length < 4 || data[0] !== 1) return null;
  const names = readIndex(data, data[2]);
  const top = readIndex(data, names.end);
  const strings = readIndex(data, top.end);
  if (!top.items.length) return null;
  const dict = readDict(top.items[0]);
  if (dict.has(1230)) return null; // CID-keyed (ROS)
  const charStringsAt = dict.get(17)?.[0];
  const charsetAt = dict.get(15)?.[0] ?? 0;
  const [privSize, privAt] = dict.get(18) ?? [0, 0];
  if (!charStringsAt) return null;
  const priv = readDict(data.subarray(privAt, privAt + privSize));
  const subrsAt = priv.get(19)?.[0];
  const local = subrsAt ? readIndex(data, privAt + subrsAt).items : [];
  const global = readIndex(data, strings.end).items;
  const defaultWidth = priv.get(20)?.[0] ?? 0;
  const nominalWidth = priv.get(21)?.[0] ?? 0;
  const matrix = dict.get(1207);
  const scale = matrix ? matrix[0] * 1000 : 1;
  const glyphs = readIndex(data, charStringsAt).items;

  const sid = (s: number) =>
    s < CFF_STANDARD_STRINGS.length ? CFF_STANDARD_STRINGS[s] : new TextDecoder("latin1").decode(strings.items[s - CFF_STANDARD_STRINGS.length] ?? new Uint8Array());
  const nameOf: string[] = [".notdef"];
  if (charsetAt > 2) {
    const format = data[charsetAt];
    let at = charsetAt + 1;
    while (nameOf.length < glyphs.length) {
      const first = (data[at] << 8) | data[at + 1];
      if (format === 0) {
        nameOf.push(sid(first));
        at += 2;
        continue;
      }
      const left = format === 1 ? data[at + 2] : (data[at + 2] << 8) | data[at + 3];
      at += format === 1 ? 3 : 4;
      for (let k = 0; k <= left && nameOf.length < glyphs.length; k++) nameOf.push(sid(first + k));
    }
  } else if (charsetAt === 0) {
    for (let g = 1; g < glyphs.length; g++) nameOf.push(CFF_STANDARD_STRINGS[g]);
  } else return null;

  const widths = new Map<string, number>();
  glyphs.forEach((cs, g) => {
    const w = charstringWidth(cs, local, global);
    if (w === null) return;
    widths.set(nameOf[g], Math.round((w === "default" ? defaultWidth : nominalWidth + w) * scale));
  });
  return { names: nameOf, widths };
}

/** Glyph names in a Type 1 (PFA/PFB-style) program, from its decrypted CharStrings. */
export function type1GlyphNames(data: Uint8Array, cleartextLength: number): string[] | null {
  let enc = data.subarray(cleartextLength);
  const head = new TextDecoder("latin1").decode(enc.subarray(0, 4));
  if (/^[0-9a-fA-F\s]{4}$/.test(head)) {
    // Hex form of the encrypted part.
    const hex = new TextDecoder("latin1").decode(enc).replace(/[^0-9a-fA-F]/g, "");
    enc = Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
  }
  let r = 55665;
  const plain = new Uint8Array(enc.length);
  for (let i = 0; i < enc.length; i++) {
    plain[i] = enc[i] ^ (r >> 8);
    r = ((enc[i] + r) * 52845 + 22719) & 0xffff;
  }
  const text = new TextDecoder("latin1").decode(plain);
  const start = text.indexOf("/CharStrings");
  if (start < 0) return null;
  const names: string[] = [];
  const re = /\/([^\s{}\[\]()<>/%]+)\s+(\d+)\s+(RD|-\|)\s/g;
  re.lastIndex = start + 12;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1] !== ".notdef") names.push(m[1]);
    re.lastIndex = m.index + m[0].length + Number(m[2]);
  }
  return names;
}

// --- subsetting -------------------------------------------------------------------

const ACCENTS = ["acute", "grave", "circumflex", "dieresis", "tilde", "ring", "cedilla", "caron", "macron", "breve", "dotaccent", "ogonek", "hungarumlaut"];

/**
 * Accented glyphs in these fonts may be built from a base letter and an accent
 * (Type 1 "seac"), so keeping "eacute" also keeps "e" and "acute".
 */
export function withAccentParts(names: Iterable<string>): Set<string> {
  const out = new Set(names);
  for (const name of [...out]) {
    for (const accent of ACCENTS) {
      if (name.length > accent.length && name.endsWith(accent)) {
        out.add(name.slice(0, -accent.length));
        out.add(accent);
      }
    }
    if (name === "Oslash" || name === "oslash") out.add(name[0]);
  }
  return out;
}

type DictEntry = { op: number; raw: Uint8Array };

function rawDict(data: Uint8Array): DictEntry[] {
  const out: DictEntry[] = [];
  let start = 0;
  for (let i = 0; i < data.length; ) {
    const b = data[i];
    if (b <= 21) {
      const op = b === 12 ? 1200 + data[i + 1] : b;
      out.push({ op, raw: data.subarray(start, i) });
      i += b === 12 ? 2 : 1;
      start = i;
    } else if (b === 28) i += 3;
    else if (b === 29) i += 5;
    else if (b === 30) {
      i++;
      while (i < data.length && (data[i] & 15) !== 15 && data[i] >> 4 !== 15) i++;
      i++;
    } else if (b >= 247 && b <= 254) i += 2;
    else i++;
  }
  return out;
}

const int5 = (v: number) => [29, (v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

function writeDict(entries: DictEntry[]): number[] {
  const out: number[] = [];
  for (const { op, raw } of entries) {
    out.push(...raw);
    if (op >= 1200) out.push(12, op - 1200);
    else out.push(op);
  }
  return out;
}

function writeIndex(items: Uint8Array[]): number[] {
  if (!items.length) return [0, 0];
  const out = [items.length >> 8, items.length & 255, 4];
  let offset = 1;
  const offsets = [offset];
  for (const item of items) offsets.push((offset += item.length));
  for (const o of offsets) out.push(...int5(o).slice(1));
  for (const item of items) out.push(...item);
  return out;
}

/**
 * A name-keyed CFF with only the glyphs in `keep` (and .notdef). Subroutines
 * stay as they are, so every kept charstring still runs; the built-in encoding
 * becomes Standard, since the PDF names glyphs through its own Encoding.
 */
export function cffSubset(data: Uint8Array, keep: Set<string>): Uint8Array | null {
  if (data.length < 4 || data[0] !== 1) return null;
  const names = readIndex(data, data[2]);
  const top = readIndex(data, names.end);
  const strings = readIndex(data, top.end);
  const globals = readIndex(data, strings.end);
  if (top.items.length !== 1) return null;
  const parsed = readDict(top.items[0]);
  if (parsed.has(1230)) return null;
  const font = parse(data);
  const charStringsAt = parsed.get(17)?.[0];
  const [privSize, privAt] = parsed.get(18) ?? [0, 0];
  if (!font || !charStringsAt) return null;
  const glyphs = readIndex(data, charStringsAt).items;

  const sids = new Map<string, number>();
  CFF_STANDARD_STRINGS.forEach((s, i) => sids.set(s, i));
  strings.items.forEach((s, i) => {
    const name = new TextDecoder("latin1").decode(s);
    if (!sids.has(name)) sids.set(name, CFF_STANDARD_STRINGS.length + i);
  });
  const kept = font.names.map((n, g) => [n, g] as const).filter(([n, g]) => g === 0 || keep.has(n));

  const charset = [0];
  for (const [n] of kept.slice(1)) {
    const sid = sids.get(n) ?? 0;
    charset.push(sid >> 8, sid & 255);
  }
  const charStrings = writeIndex(kept.map(([, g]) => glyphs[g]));

  const privEntries = rawDict(data.subarray(privAt, privAt + privSize));
  const subrsAt = readDict(data.subarray(privAt, privAt + privSize)).get(19)?.[0];
  const local = subrsAt ? data.subarray(privAt + subrsAt, readIndex(data, privAt + subrsAt).end) : null;
  const privOut = privEntries.filter((e) => e.op !== 19);
  if (local) privOut.push({ op: 19, raw: Uint8Array.from(int5(0)) });
  let privBytes = writeDict(privOut);
  if (local) privBytes = writeDict([...privOut.slice(0, -1), { op: 19, raw: Uint8Array.from(int5(privBytes.length)) }]);

  // Offsets depend on the Top DICT's size, which is fixed because every offset is a 5-byte int.
  const topEntries = rawDict(top.items[0]).filter((e) => e.op !== 15 && e.op !== 16 && e.op !== 17 && e.op !== 18);
  const placeholder = [...topEntries, { op: 15, raw: Uint8Array.from(int5(0)) }, { op: 17, raw: Uint8Array.from(int5(0)) }, { op: 18, raw: Uint8Array.from([...int5(0), ...int5(0)]) }];
  const topLength = writeIndex([Uint8Array.from(writeDict(placeholder))]).length;
  const head = [...data.subarray(0, data[2])];
  const nameIndex = [...data.subarray(data[2], names.end)];
  const stringIndex = [...data.subarray(top.end, strings.end)];
  const globalIndex = [...data.subarray(strings.end, globals.end)];
  const charsetAt = head.length + nameIndex.length + topLength + stringIndex.length + globalIndex.length;
  const charStringsOut = charsetAt + charset.length;
  const privOutAt = charStringsOut + charStrings.length;
  const topDict = writeDict([
    ...topEntries,
    { op: 15, raw: Uint8Array.from(int5(charsetAt)) },
    { op: 17, raw: Uint8Array.from(int5(charStringsOut)) },
    { op: 18, raw: Uint8Array.from([...int5(privBytes.length), ...int5(privOutAt)]) },
  ]);
  return Uint8Array.from([
    ...head,
    ...nameIndex,
    ...writeIndex([Uint8Array.from(topDict)]),
    ...stringIndex,
    ...globalIndex,
    ...charset,
    ...charStrings,
    ...privBytes,
    ...(local ?? []),
  ]);
}

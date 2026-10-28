/**
 * Legacy "remapped" Indian fonts -> Unicode (other than Kruti Dev / DevLys, see krutidev.ts).
 *
 * Like Kruti Dev, these fonts store an Indian script as Latin / Windows-1252 bytes and draw Indian
 * letters for them, so a sheet stores "pMjwb srkwr" for "ਪੰਜਾਬ ਸਰਕਾਰ". Any other font prints the
 * Latin letters. This turns such text into real Unicode.
 *
 * Supported:
 *  - AnmolLipi / GurbaniAkhar / Joy / Asees (Gurmukhi; they share one keyboard-shaped encoding);
 *  - SutonnyMJ and the other Bijoy "...MJ" fonts (Bengali).
 *
 * The tables are written from the keyboard layouts themselves (not copied from any converter).
 * Entries we were not sure of are left out on purpose: an unknown byte stays visibly Latin rather
 * than turning into a plausible but wrong letter. Chanakya, Shivaji and Tamil Bamini are not
 * recognised for the same reason (see legacyFontOf).
 *
 * Two things are typed out of logical order and are reordered here:
 *  - the pre-base vowel signs (Gurmukhi ਿ; Bengali ি ে ৈ) are typed before the letter cluster
 *    they follow;
 *  - the Bengali reph (র্, "©") is typed after the cluster it precedes.
 * Both are moved by whole conjunct clusters (e.g. ਮ੍ਰਿ, প্রে), never across a space.
 */

export type LegacyFont = "anmol-lipi" | "sutonny-mj";

/** The legacy encoding a font family name uses, if we can convert it. Not Kruti Dev / DevLys. */
export function legacyFontOf(name: string | undefined): LegacyFont | undefined {
  if (!name) return undefined;
  const n = name.trim();
  // "AnmolUni", "Raavi", "SolaimanLipi" etc. are already Unicode and must not match
  if (/anmol\s*lipi|gurbani\s*akhar|^asees|^joy\b/i.test(n)) return "anmol-lipi";
  if (/sutonny\s*o?\s*mj|bijoy/i.test(n) || /[a-z]\s*MJ$/.test(n)) return "sutonny-mj";
  return undefined;
}

const DIGITS = (zero: number): [string, string][] =>
  Array.from({ length: 10 }, (_, d) => [String(d), String.fromCharCode(zero + d)]);

/**
 * AnmolLipi / GurbaniAkhar. Left out (not sure of them): the rarer subjoined letters on
 * Latin-1 keys (੍ਚ ੍ਟ ੍ਤ ੍ਨ ੍ਯ), yakash ੵ, and the separate "<" / ">" halves of ੴ.
 */
const GURMUKHI: [string, string][] = [
  ["<>", "ੴ"],
  ["a", "ੳ"], ["A", "ਅ"], ["e", "ੲ"], ["s", "ਸ"], ["h", "ਹ"],
  ["k", "ਕ"], ["K", "ਖ"], ["g", "ਗ"], ["G", "ਘ"], ["|", "ਙ"],
  ["c", "ਚ"], ["C", "ਛ"], ["j", "ਜ"], ["J", "ਝ"], ["\\", "ਞ"],
  ["t", "ਟ"], ["T", "ਠ"], ["f", "ਡ"], ["F", "ਢ"], ["x", "ਣ"],
  ["q", "ਤ"], ["Q", "ਥ"], ["d", "ਦ"], ["D", "ਧ"], ["n", "ਨ"],
  ["p", "ਪ"], ["P", "ਫ"], ["b", "ਬ"], ["B", "ਭ"], ["m", "ਮ"],
  ["X", "ਯ"], ["r", "ਰ"], ["l", "ਲ"], ["v", "ਵ"], ["V", "ੜ"],
  ["S", "ਸ਼"], ["^", "ਖ਼"], ["Z", "ਗ਼"], ["z", "ਜ਼"], ["&", "ਫ਼"], ["L", "ਲ਼"], ["æ", "਼"],
  ["w", "ਾ"], ["i", "ਿ"], ["I", "ੀ"], ["u", "ੁ"], ["ü", "ੁ"], ["U", "ੂ"], ["¨", "ੂ"],
  ["y", "ੇ"], ["Y", "ੈ"], ["o", "ੋ"], ["O", "ੌ"], ["E", "ਓ"],
  ["M", "ੰ"], ["N", "ਂ"], ["W", "ਾਂ"], ["`", "ੱ"], ["~", "ੱ"],
  ["H", "੍ਹ"], ["R", "੍ਰ"], ["Í", "੍ਵ"],
  ["[", "।"], ["]", "॥"],
  ...DIGITS(0x0a66),
];

/**
 * SutonnyMJ (Bijoy). "©" (reph) is kept as a marker for placeReph. Left out (not sure of them):
 * the hasanta key, ba-phala, the quote glyphs, and most of the ligature bytes (ঙ্ক, চ্ছ, ষ্ট, ...);
 * only the very common ones (ন্ স্ ত্র ত্ত ক্ষ জ্ঞ, ্য ্র) are mapped.
 */
const BENGALI: [string, string][] = [
  ["A", "অ"], ["B", "ই"], ["C", "ঈ"], ["D", "উ"], ["E", "ঊ"], ["F", "ঋ"], ["G", "এ"], ["H", "ঐ"], ["I", "ও"], ["J", "ঔ"],
  ["K", "ক"], ["L", "খ"], ["M", "গ"], ["N", "ঘ"], ["O", "ঙ"], ["P", "চ"], ["Q", "ছ"], ["R", "জ"], ["S", "ঝ"], ["T", "ঞ"],
  ["U", "ট"], ["V", "ঠ"], ["W", "ড"], ["X", "ঢ"], ["Y", "ণ"], ["Z", "ত"], ["_", "থ"], ["’", "থ"], ["`", "দ"], ["a", "ধ"],
  ["b", "ন"], ["c", "প"], ["d", "ফ"], ["e", "ব"], ["f", "ভ"], ["g", "ম"], ["h", "য"], ["i", "র"], ["j", "ল"], ["k", "শ"],
  ["l", "ষ"], ["m", "স"], ["n", "হ"], ["o", "ড়"], ["p", "ঢ়"], ["q", "য়"], ["r", "ৎ"], ["s", "ং"], ["t", "ঃ"], ["u", "ঁ"],
  ["v", "া"], ["w", "ি"], ["x", "ী"], ["y", "ু"], ["z", "ু"], ["~", "ূ"], ["„", "ৃ"], ["…", "ৃ"],
  ["‡", "ে"], ["†", "ে"], ["ˆ", "ৈ"], ["Š", "ৗ"],
  ["¨", "্য"], ["Ö", "্র"], ["ª", "্র"],
  ["š", "ন্"], ["¯", "স্"], ["¿", "ত্র"], ["Ë", "ত্ত"], ["ÿ", "ক্ষ"], ["¶", "ক্ষ"], ["Á", "জ্ঞ"],
  ["|", "।"],
  ...DIGITS(0x09e6),
];

interface Script {
  pairs: [string, string][];
  isConsonant: (c: string | undefined) => boolean;
  /** dependent vowel signs and the marks that follow them */
  isMark: (c: string | undefined) => boolean;
  nukta: string;
  halant: string;
  /** vowel signs drawn (and so typed) before their cluster */
  prebase: string;
  /** the reph: the marker byte (typed after its cluster) and what it stands for */
  reph?: { marker: string; text: string };
  /** vowel carrier + sign -> independent vowel */
  compose: [string, string][];
}

const SCRIPTS: Record<LegacyFont, Script> = {
  "anmol-lipi": {
    pairs: GURMUKHI,
    // ੲ is a carrier, but ਿ is typed before it too ("ie" = ਇ)
    isConsonant: (c) => !!c && /[\u0a15-\u0a39\u0a59-\u0a5e\u0a72]/.test(c),
    isMark: (c) => !!c && /[\u0a3e-\u0a4c\u0a02\u0a70\u0a71]/.test(c),
    nukta: "਼",
    halant: "੍",
    prebase: "ਿ",
    compose: [["ੲਿ", "ਇ"], ["ੲੀ", "ਈ"], ["ੲੇ", "ਏ"], ["ੳੁ", "ਉ"], ["ੳੂ", "ਊ"], ["ੳੋ", "ਓ"], ["ਅਾ", "ਆ"], ["ਅੈ", "ਐ"], ["ਅੌ", "ਔ"]],
  },
  "sutonny-mj": {
    pairs: BENGALI,
    isConsonant: (c) => !!c && /[\u0995-\u09b9\u09dc-\u09df]/.test(c),
    isMark: (c) => !!c && /[\u09be-\u09cc\u0981-\u0983\u09d7]/.test(c),
    nukta: "়",
    halant: "্",
    prebase: "িেৈ",
    reph: { marker: "©", text: "র্" },
    compose: [["অা", "আ"]],
  },
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const matchers = new Map<LegacyFont, { re: RegExp; map: Map<string, string> }>();

/** One left-to-right pass, longest key first, so an output is never re-mapped. */
function matcher(font: LegacyFont) {
  let m = matchers.get(font);
  if (!m) {
    const map = new Map(SCRIPTS[font].pairs);
    const keys = [...map.keys()].sort((a, b) => b.length - a.length).map(escape);
    m = { re: new RegExp(keys.join("|"), "g"), map };
    matchers.set(font, m);
  }
  return m;
}

/** End (exclusive) of the consonant cluster starting at i: C (nukta)? ( halant C (nukta)? )* */
function clusterEnd(sc: Script, s: string[], i: number): number {
  let j = i;
  if (!sc.isConsonant(s[j])) return i;
  j++;
  if (s[j] === sc.nukta) j++;
  while (s[j] === sc.halant && sc.isConsonant(s[j + 1])) {
    j += 2;
    if (s[j] === sc.nukta) j++;
  }
  return j;
}

/** Start of the consonant cluster that ends (exclusive) at end. */
function clusterStart(sc: Script, s: string[], end: number): number {
  let i = end - 1;
  if (s[i] === sc.nukta) i--;
  if (!sc.isConsonant(s[i])) return end;
  for (;;) {
    if (s[i - 1] !== sc.halant) break;
    let c = i - 2;
    if (s[c] === sc.nukta) c--;
    if (!sc.isConsonant(s[c])) break;
    i = c;
  }
  return i;
}

/** pre-base sign + cluster -> cluster + sign */
function placePrebase(sc: Script, text: string): string {
  const s = Array.from(text);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    if (!sc.prebase.includes(s[i])) {
      out.push(s[i]);
      continue;
    }
    const end = clusterEnd(sc, s, i + 1);
    if (end === i + 1) {
      out.push(s[i]); // nothing to attach to (space, digit, end): keep it where it was
      continue;
    }
    out.push(...s.slice(i + 1, end), s[i]);
    i = end - 1;
  }
  return out.join("");
}

/** cluster + signs + reph marker -> র্ + cluster + signs */
function placeReph(text: string, sc: Script, { marker, text: reph }: { marker: string; text: string }): string {
  const s = Array.from(text);
  const r = Array.from(reph);
  for (let z = s.indexOf(marker); z !== -1; z = s.indexOf(marker)) {
    let k = z;
    while (k > 0 && sc.isMark(s[k - 1])) k--;
    const start = clusterStart(sc, s, k);
    s.splice(z, 1);
    s.splice(start < k ? start : z, 0, ...r); // nothing to attach to: keep it where it was
  }
  return s.join("");
}

export function toUnicode(font: LegacyFont, text: string): string {
  if (!text) return text;
  const sc = SCRIPTS[font];
  const { re, map } = matcher(font);
  let s = text.replace(re, (k) => map.get(k) ?? k);
  s = placePrebase(sc, s);
  if (sc.reph) s = placeReph(s, sc, sc.reph);
  for (const [from, to] of sc.compose) if (s.includes(from)) s = s.split(from).join(to);
  // ে + া / ে + ৗ compose to ো / ৌ here; ਸ਼ ড় etc. become base + nukta (their canonical form)
  return s.normalize("NFC");
}

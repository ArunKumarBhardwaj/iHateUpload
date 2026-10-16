/** East Asian text: undo the radical code points PDFs map glyphs to, and pick fonts and languages Word can use. */

// Kangxi radicals and the radicals supplement, CJK compatibility ideographs (and their supplement).
const ODD_IDEOGRAPH = /[⺀-⿟豈-﫿\u{2F800}-\u{2FA1F}]/gu;

/**
 * Many CJK fonts map a glyph to the Kangxi radical or a compatibility ideograph instead of the
 * unified ideograph (U+2F00 for U+4E00). They look the same but search, copy and spell-check
 * differently. Only these blocks are touched, so ligatures, half-width kana and other scripts stay put.
 */
export function normalizeCjk(text: string): string {
  return text.replace(ODD_IDEOGRAPH, (c) => {
    const n = c.normalize("NFKC");
    return [...n].length === 1 ? n : c;
  });
}

const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const HAN = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2FA1F}]/u;
const EAST_ASIAN = /[ᄀ-ᇿ⺀-⿟　-ヿ㄰-㆏ㇰ-ㇿ㐀-䶿一-鿿가-힯豈-﫿ｦ-ﾟ\u{20000}-\u{2FA1F}]/u;

export type EastAsiaScript = "zh" | "ja" | "ko";

export const hasEastAsian = (text: string): boolean => EAST_ASIAN.test(text);

/** Share of the non-space characters that are East Asian. */
export function eastAsianShare(text: string): number {
  const chars = [...text.replace(/\s/g, "")];
  if (!chars.length) return 0;
  return chars.filter((c) => EAST_ASIAN.test(c)).length / chars.length;
}

/** Kana means Japanese, hangul means Korean, Han alone is taken as Simplified Chinese. */
export function eastAsiaScript(text: string): EastAsiaScript | undefined {
  if (KANA.test(text)) return "ja";
  if (HANGUL.test(text)) return "ko";
  if (HAN.test(text)) return "zh";
  return undefined;
}

export const FALLBACK_FONT: Record<EastAsiaScript, string> = {
  zh: "Microsoft YaHei",
  ja: "Yu Gothic",
  ko: "Malgun Gothic",
};

export const LANG: Record<EastAsiaScript, string> = { zh: "zh-CN", ja: "ja-JP", ko: "ko-KR" };

const CJK_FAMILIES: [RegExp, string][] = [
  [/simsun|songti|stsong/, "SimSun"],
  [/simhei|heiti/, "SimHei"],
  [/yahei/, "Microsoft YaHei"],
  [/kaiti|stkaiti/, "KaiTi"],
  [/fangsong/, "FangSong"],
  [/pmingliu|mingliu/, "PMingLiU"],
  [/msmincho/, "MS Mincho"],
  [/msgothic|mspgothic/, "MS Gothic"],
  [/yumincho/, "Yu Mincho"],
  [/yugothic/, "Yu Gothic"],
  [/meiryo/, "Meiryo"],
  [/malgun/, "Malgun Gothic"],
  [/batang/, "Batang"],
  [/gulim/, "Gulim"],
  [/dotum/, "Dotum"],
];

/** The East Asian font to ask Word for: the PDF's own family when it is a known CJK one, else a standard one for the script. */
export function eastAsiaFont(pdfFont: string, script: EastAsiaScript): string {
  const key = pdfFont.replace(/^[A-Z]{6}\+/, "").toLowerCase().replace(/[^a-z]/g, "");
  for (const [re, family] of CJK_FAMILIES) if (re.test(key)) return family;
  return FALLBACK_FONT[script];
}

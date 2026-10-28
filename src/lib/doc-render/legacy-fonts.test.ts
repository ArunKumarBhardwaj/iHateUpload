import { describe, expect, test } from "bun:test";

import { legacyFontOf, toUnicode } from "./legacy-fonts";

const nfc = (s: string) => s.normalize("NFC");
const gur = (s: string) => toUnicode("anmol-lipi", s);
const ben = (s: string) => toUnicode("sutonny-mj", s);

describe("AnmolLipi / GurbaniAkhar to unicode", () => {
  test("government headings", () => {
    expect(gur("pMjwb srkwr")).toBe("ਪੰਜਾਬ ਸਰਕਾਰ");
    expect(gur("is`iKAw ivBwg")).toBe("ਸਿੱਖਿਆ ਵਿਭਾਗ");
    expect(gur("pRmwixq kIqw jWdw hY [")).toBe("ਪ੍ਰਮਾਣਿਤ ਕੀਤਾ ਜਾਂਦਾ ਹੈ ।");
    expect(gur("izlHw AMimRqsr")).toBe(nfc("ਜ਼ਿਲ੍ਹਾ ਅੰਮ੍ਰਿਤਸਰ"));
  });

  test("ਿ goes after the whole cluster, never across a space", () => {
    expect(gur("AMimRqsr")).toBe("ਅੰਮ੍ਰਿਤਸਰ");
    expect(gur("iSkwieq")).toBe(nfc("ਸ਼ਿਕਾਇਤ"));
    expect(gur("i k")).toBe("ਿ ਕ");
  });

  test("vowel carriers compose to independent vowels", () => {
    expect(gur("ieh aunHW dI AOrq hY")).toBe("ਇਹ ਉਨ੍ਹਾਂ ਦੀ ਔਰਤ ਹੈ");
    expect(gur("eId eyk AYsw aUT Awp E")).toBe("ਈਦ ਏਕ ਐਸਾ ਊਠ ਆਪ ਓ");
  });

  test("nukta letters, addak, digits, danda", () => {
    expect(gur("^ws ZrIb Pwrm &rk")).toBe(nfc("ਖ਼ਾਸ ਗ਼ਰੀਬ ਫਾਰਮ ਫ਼ਰਕ"));
    expect(gur("p`kw")).toBe("ਪੱਕਾ");
    expect(gur("2024 ]")).toBe("੨੦੨੪ ॥");
    expect(gur("<> siqnwmu")).toBe("ੴ ਸਤਿਨਾਮੁ");
  });

  test("typical sentences leave no Latin letters", () => {
    const out = gur("pMjwb srkwr, is`iKAw ivBwg, izlHw luiDAwxw. pRmwixq kIqw jWdw hY ik ieh ivAkqI swfy dPqr ivc kMm krdw hY [");
    expect(out).not.toMatch(/[A-Za-z]/);
    expect(out).toBe(out.normalize("NFC"));
  });
});

describe("SutonnyMJ (Bijoy) to unicode", () => {
  test("government headings", () => {
    expect(ben("MYcÖRvZš¿x evsjv‡`k miKvi")).toBe("গণপ্রজাতন্ত্রী বাংলাদেশ সরকার");
    expect(ben("wkÿv gš¿Yvjq")).toBe(nfc("শিক্ষা মন্ত্রণালয়"));
    expect(ben("cÖwkÿY")).toBe("প্রশিক্ষণ");
  });

  test("pre-base ি ে ৈ go after the whole cluster; ে + া / ৗ compose", () => {
    expect(ben("‡cÖm")).toBe("প্রেস");
    expect(ben("‡jvK")).toBe("লোক");
    expect(ben("‡MŠi")).toBe("গৌর");
    expect(ben("ˆZwi")).toBe("তৈরি");
    expect(ben("weÁvb")).toBe("বিজ্ঞান");
    expect(ben("w K")).toBe("ি ক");
  });

  test("reph (©) goes before its cluster", () => {
    expect(ben("Kg©KZ©v")).toBe("কর্মকর্তা");
    expect(ben("c~e©")).toBe("পূর্ব");
    expect(ben("wbe©vPb")).toBe("নির্বাচন");
  });

  test("phala, conjuncts, nukta letters, digits, danda", () => {
    expect(ben("e¨vsK")).toBe("ব্যাংক");
    expect(ben("Ae¯’v DËi")).toBe("অবস্থা উত্তর");
    expect(ben("Avgvi ‡`k")).toBe("আমার দেশ");
    expect(ben("evwo 2024|")).toBe(nfc("বাড়ি ২০২৪।"));
  });

  test("typical sentences leave no Latin letters", () => {
    const out = ben("MYcÖRvZš¿x evsjv‡`k miKvi, wkÿv gš¿Yvjq| Kg©KZ©v‡`i cÖwkÿY ‡`Iqv n‡e|");
    expect(out).not.toMatch(/[A-Za-z]/);
    expect(out).toBe(out.normalize("NFC"));
  });
});

describe("font names", () => {
  test("recognised", () => {
    for (const n of ["AnmolLipi", "Anmol Lipi", "AnmolLipi Bold", "GurbaniAkhar", "Gurbani Akhar Heavy", "Asees", "Joy"]) {
      expect(legacyFontOf(n)).toBe("anmol-lipi");
    }
    for (const n of ["SutonnyMJ", "SutonnyOMJ", "Sutonny MJ", "SulekhaMJ", "Bijoy Ekushey"]) {
      expect(legacyFontOf(n)).toBe("sutonny-mj");
    }
  });

  test("unicode fonts, Kruti Dev and unsupported encodings are not claimed", () => {
    for (const n of ["AnmolUni", "Raavi", "SolaimanLipi", "Kruti Dev 010", "DevLys 010", "Arial", "Joystix", "Chanakya", "Shivaji01", "Bamini", undefined]) {
      expect(legacyFontOf(n)).toBeUndefined();
    }
  });
});

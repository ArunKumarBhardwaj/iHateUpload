import { describe, expect, test } from "bun:test";

import { isKrutiDevFont, krutiToUnicode } from "./krutidev";

describe("kruti dev to unicode", () => {
  test("the challan lines", () => {
    expect(krutiToUnicode(" izekf.kr  fd;k  tkrk gS fd çh Ldwy vkbVe dh ek=k ---")).toBe(" प्रमाणित  किया  जाता है कि प्री स्कूल आइटम की मात्रा ...");
    expect(krutiToUnicode("vkt fnukad ---dks izkIr dh xbZ gSA ftldk vadu LVkWd")).toBe("आज दिनांक ...को प्राप्त की गई है। जिसका अंकन स्टॉक");
    expect(krutiToUnicode('jftLVj ds i`"B dzekad---ij fd;k x;k gSaA')).toBe("रजिस्टर के पृष्ठ क्रमांक...पर किया गया हैं।");
  });

  test("ि goes after the whole conjunct it belongs to", () => {
    expect(krutiToUnicode("fLFkfr")).toBe("स्थिति");
    expect(krutiToUnicode("fo|ky;")).toBe("विद्यालय");
    expect(krutiToUnicode("f'k{kk")).toBe("शिक्षा");
    expect(krutiToUnicode("fpark")).toBe("चिंता");
  });

  test("the reph (Z) goes before the cluster and its matras", () => {
    expect(krutiToUnicode("dk;kZy;")).toBe("कार्यालय");
    expect(krutiToUnicode("/keZ")).toBe("धर्म");
    expect(krutiToUnicode("iwfrZ")).toBe("पूर्ति");
    expect(krutiToUnicode("dRrZO;")).toBe("कर्त्तव्य");
    expect(krutiToUnicode("loZJs\"B")).toBe("सर्वश्रेष्ठ");
  });

  test("punctuation and digits", () => {
    expect(krutiToUnicode("¼v½ ,oa ¼c½A")).toBe("(अ) एवं (ब)।");
    expect(krutiToUnicode("å ƒ „")).toBe("० १ २");
  });

  test("font names", () => {
    expect(isKrutiDevFont("Kruti Dev 010")).toBe(true);
    expect(isKrutiDevFont("KrutiDev 011")).toBe(true);
    expect(isKrutiDevFont("DevLys 010")).toBe(true);
    expect(isKrutiDevFont("Arial")).toBe(false);
    expect(isKrutiDevFont(undefined)).toBe(false);
  });
});

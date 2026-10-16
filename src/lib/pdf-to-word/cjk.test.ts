import { expect, test } from "bun:test";

import { eastAsiaScript, normalizeCjk } from "./cjk";

test("Kangxi radicals and compatibility ideographs become unified ideographs", () => {
  expect(normalizeCjk("⼀⼼⾄")).toBe("一心至");
  expect(normalizeCjk("豈")).toBe("豈");
  expect(normalizeCjk("⺀")).toBe("⺀"); // no decomposition: left alone
});

test("other scripts are left exactly as they are", () => {
  const s = "ﬁnance ﬂow ① ½ שלום مرحبا 한국어 ｶﾀｶﾅ 図書館 é";
  expect(normalizeCjk(s)).toBe(s);
});

test("script is detected by kana, hangul and Han", () => {
  expect(eastAsiaScript("欢迎")).toBe("zh");
  expect(eastAsiaScript("開館時間はです")).toBe("ja");
  expect(eastAsiaScript("한국어")).toBe("ko");
  expect(eastAsiaScript("hello")).toBeUndefined();
});

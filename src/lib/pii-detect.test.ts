import { expect, test } from "bun:test";

import {
  detectPii,
  iban97,
  luhn,
  spansToPageText,
  matchBoxes,
  verhoeff,
  verhoeffCheckDigit,
  type PiiCategory,
} from "./pii-detect";

const found = (text: string, category?: PiiCategory) =>
  detectPii(text)
    .filter((m) => !category || m.category === category)
    .map((m) => [m.category, m.text]);

test("verhoeff matches the published example and rejects a flipped digit", () => {
  expect(verhoeffCheckDigit("236")).toBe(3);
  expect(verhoeff("2363")).toBe(true);
  expect(verhoeff("2364")).toBe(false);
});

test("luhn and iban checksums", () => {
  expect(luhn("4111111111111111")).toBe(true);
  expect(luhn("4111111111111112")).toBe(false);
  expect(iban97("GB82WEST12345698765432")).toBe(true);
  expect(iban97("GB82WEST12345698765433")).toBe(false);
});

test("emails", () => {
  expect(found("Write to john.doe+x@example.com now.", "email")).toEqual([
    ["email", "john.doe+x@example.com"],
  ]);
  expect(found("no at sign here, user@ and @host", "email")).toEqual([]);
});

test("cards need Luhn and 13-19 digits", () => {
  expect(found("Card 4111 1111 1111 1111 exp", "card")).toEqual([
    ["card", "4111 1111 1111 1111"],
  ]);
  expect(found("Card 4111-1111-1111-1111", "card").length).toBe(1);
  expect(found("Amex 378282246310005", "card").length).toBe(1);
  expect(found("Card 4111 1111 1111 1112", "card")).toEqual([]);
});

test("aadhaar needs Verhoeff and a first digit of 2-9", () => {
  const body = "23412345678";
  const good = body + verhoeffCheckDigit(body);
  const spaced = `${good.slice(0, 4)} ${good.slice(4, 8)} ${good.slice(8)}`;
  expect(found(`Aadhaar ${spaced}`, "aadhaar")).toEqual([["aadhaar", spaced]]);
  expect(found(`UID ${good}`, "aadhaar").length).toBe(1);
  // Same shape, wrong check digit.
  const bad = body + ((verhoeffCheckDigit(body) + 1) % 10);
  expect(found(`UID ${bad}`, "aadhaar")).toEqual([]);
  // Leading 0 or 1 is never an Aadhaar even with a valid check digit.
  for (const lead of ["0", "1"]) {
    const b = lead + "2341234567";
    expect(found(`UID ${b}${verhoeffCheckDigit(b)}`, "aadhaar")).toEqual([]);
  }
});

test("random 12-digit numbers that fail Verhoeff do not match", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  let hits = 0;
  let valid = 0;
  for (let i = 0; i < 400; i++) {
    let s = String(2 + (rnd() % 8));
    for (let j = 0; j < 11; j++) s += String(rnd() % 10);
    const ok = verhoeff(s);
    if (ok) valid++;
    if (!ok && found(`ref ${s}`, "aadhaar").length) hits++;
  }
  expect(hits).toBe(0);
  expect(valid).toBeGreaterThan(10);
});

test("PAN and IFSC formats", () => {
  expect(found("PAN ABCPE1234F ok", "pan")).toEqual([["pan", "ABCPE1234F"]]);
  expect(found("PAN ABCXE1234F", "pan")).toEqual([]); // bad holder type
  expect(found("ABCPE12345F", "pan")).toEqual([]);
  expect(found("IFSC HDFC0001234.", "ifsc")).toEqual([["ifsc", "HDFC0001234"]]);
  expect(found("HDFC1001234", "ifsc")).toEqual([]);
});

test("bank accounts only near a banking keyword", () => {
  expect(found("A/c No: 123456789012", "account")).toEqual([
    ["account", "123456789012"],
  ]);
  expect(found("Account number 00112233445", "account").length).toBe(1);
  expect(found("Order 123456789012 shipped", "account")).toEqual([]);
});

test("IBAN with mod-97", () => {
  expect(found("IBAN GB82 WEST 1234 5698 7654 32 Bank", "iban")).toEqual([
    ["iban", "GB82 WEST 1234 5698 7654 32"],
  ]);
  expect(found("DE89370400440532013000", "iban").length).toBe(1);
  expect(found("GB82 WEST 1234 5698 7654 33", "iban")).toEqual([]);
});

test("US SSN skips reserved prefixes", () => {
  expect(found("SSN 219-09-9999.", "ssn")).toEqual([["ssn", "219-09-9999"]]);
  expect(
    found("000-12-3456 666-12-3456 900-12-3456 123-00-4567 123-45-0000", "ssn"),
  ).toEqual([]);
});

test("dates of birth need a keyword", () => {
  expect(found("DOB: 14/03/1990", "dob")).toEqual([["dob", "14/03/1990"]]);
  expect(found("Date of Birth 1990-03-14", "dob").length).toBe(1);
  expect(found("D.O.B. 14 March 1990", "dob").length).toBe(1);
  expect(found("Invoice date 14/03/1990", "dob")).toEqual([]);
});

test("phones, Indian and international", () => {
  expect(found("Call +91 98765 43210", "phone")).toEqual([
    ["phone", "+91 98765 43210"],
  ]);
  expect(found("Call 98765-43210", "phone").length).toBe(1);
  expect(found("Call +1 (555) 010-0199", "phone").length).toBe(1);
  expect(found("Call 555-010-0199", "phone").length).toBe(1);
  expect(found("Call +44 20 7946 0958", "phone").length).toBe(1);
  expect(found("Total 12345 units", "phone")).toEqual([]);
  expect(found("Date 2024-01-15", "phone")).toEqual([]);
});

test("a card is not also reported as a phone or Aadhaar", () => {
  expect(found("4111 1111 1111 1111")).toEqual([["card", "4111 1111 1111 1111"]]);
});

test("custom words and regex", () => {
  const m = detectPii("Project Falcon and ID-4471, falcon again", {
    custom: "falcon\n/ID-\\d+/",
  });
  expect(m.map((x) => x.text)).toEqual(["Falcon", "ID-4471", "falcon"]);
  expect(detectPii("x", { custom: "/([/" })).toEqual([]);
});

test("categories can be switched off", () => {
  const only = detectPii("a@example.com 219-09-9999", {
    categories: new Set<PiiCategory>(["ssn"]),
  });
  expect(only.map((m) => m.category)).toEqual(["ssn"]);
});

test("match boxes follow the spans they cover", () => {
  const spans = [
    { text: "Email:", x: 0.1, y: 0.1, w: 0.12, h: 0.02 },
    { text: "a@example.com", x: 0.24, y: 0.1, w: 0.26, h: 0.02 },
    { text: "next line", x: 0.1, y: 0.2, w: 0.18, h: 0.02 },
  ];
  const page = spansToPageText(spans);
  expect(page.text).toBe("Email: a@example.com\nnext line");
  const [m] = detectPii(page.text);
  const boxes = matchBoxes(page, m);
  expect(boxes.length).toBe(1);
  expect(boxes[0].x).toBeLessThan(0.24);
  expect(boxes[0].x + boxes[0].w).toBeGreaterThan(0.5);
  expect(boxes[0].y).toBeLessThanOrEqual(0.1);
});

test("a match split across OCR words becomes one box", () => {
  const words = ["4111", "1111", "1111", "1111"].map((t, i) => ({
    text: t,
    x: 0.1 + i * 0.1,
    y: 0.3,
    w: 0.08,
    h: 0.02,
  }));
  const page = spansToPageText(words);
  const ms = detectPii(page.text);
  expect(ms[0].category).toBe("card");
  const boxes = matchBoxes(page, ms[0]);
  expect(boxes.length).toBe(1);
  expect(boxes[0].w).toBeGreaterThan(0.38);
});

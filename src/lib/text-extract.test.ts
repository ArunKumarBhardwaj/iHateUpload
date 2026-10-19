import { expect, test } from "bun:test";

import { joinPages, pageSeparator } from "./text-extract";

test("pages join with the page separators and no length cap", () => {
  const long = "x".repeat(200_000);
  const text = joinPages(["one", long, ""]);
  expect(text.startsWith(`${pageSeparator(1)}\none`)).toBe(true);
  expect(text).toContain(`${pageSeparator(3)}`);
  expect(text.length).toBeGreaterThan(200_000);
});

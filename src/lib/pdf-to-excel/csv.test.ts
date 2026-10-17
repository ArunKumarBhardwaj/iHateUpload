import { expect, test } from "bun:test";

import { sheetToCsv } from "./csv";

test("CSV carries values, ISO dates and percents, and quotes what needs it", () => {
  const csv = sheetToCsv({
    rows: [
      [{ v: "Item" }, { v: "Date" }, { v: "Share" }, { v: "Amount" }],
      [{ v: 'Bowl, "large"' }, { v: 46084, fmt: "mm/dd/yyyy" }, { v: 0.125, fmt: "0.0%" }, { v: -1200.5, fmt: '"$"#,##0.00' }],
      [],
      [{ v: "Total" }, null, null, { v: 1 }],
    ],
  });
  expect(csv).toBe(`﻿Item,Date,Share,Amount\r\n"Bowl, ""large""",2026-03-03,12.5%,-1200.5\r\n\r\nTotal,,,1\r\n`);
});

import type { Sheet, XCell } from "./xlsx-writer";

const isDateFmt = (fmt?: string) => !!fmt && /[ymd]/i.test(fmt.replace(/"[^"]*"|\\./g, ""));

function shown(cell: XCell): string {
  if (!cell) return "";
  if (typeof cell.v === "string") return cell.v;
  if (isDateFmt(cell.fmt)) return new Date(Math.round((cell.v - 25569) * 86400000)).toISOString().slice(0, 10);
  if (cell.fmt && /%/.test(cell.fmt)) return `${Math.round(cell.v * 1e8) / 1e6}%`;
  return String(cell.v);
}

const quote = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** One sheet as CSV: dates as yyyy-mm-dd, numbers plain, a byte order mark so Excel reads the UTF-8. */
export function sheetToCsv(sheet: Pick<Sheet, "rows">): string {
  const lines = sheet.rows.map((row) => row.map((c) => quote(shown(c))).join(",").replace(/,+$/, ""));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Scores a converted workbook against a synthetic statement's truth. Used by tests and the bench. */
import type * as XLSXType from "xlsx";

import { excelSerial } from "./cells";
import type { BankTruth } from "./bank-fixtures";

const squash = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const near = (a: unknown, b: number) => (b === 0 ? a === undefined || a === "" || a === 0 || a === null : typeof a === "number" && Math.abs(a - b) < 0.005);

/** XLSX is passed in so this file never pulls the library into a browser bundle. */
export function scoreStatement(wb: XLSXType.WorkBook, truth: BankTruth, XLSX: typeof XLSXType) {
  let best = { found: 0, exact: 0, extra: 0, sheet: "", misses: [] as string[] };
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, blankrows: false, defval: "" });
    const head = (rows[0] ?? []).map((h) => String(h).toLowerCase());
    const find = (re: RegExp) => head.findIndex((h) => re.test(h));
    const cDate = find(/date|dt/);
    const cNar = find(/narration|description|particulars|remarks/);
    const cRef = find(/ref|chq|cheque/);
    const cDr = find(/withdrawal|debit/);
    const cCr = find(/deposit|credit/);
    const cBal = find(/balance/);
    if (cDate < 0 || cBal < 0) continue;
    const body = rows.slice(1).filter((r) => typeof r[cDate] === "number");
    let found = 0;
    let exact = 0;
    const misses: string[] = [];
    let k = 0;
    for (const t of truth.txns) {
      const serial = excelSerial(...t.date);
      let hit = -1;
      for (let j = k; j < Math.min(body.length, k + 4); j++) if (body[j][cDate] === serial && near(body[j][cBal], t.balance)) { hit = j; break; }
      if (hit < 0) { misses.push(`missing ${t.date.join("-")} ${t.balance}`); continue; }
      k = hit + 1;
      found++;
      const r = body[hit];
      const ok =
        near(r[cDr], t.debit) && near(r[cCr], t.credit) &&
        (cNar < 0 || squash(r[cNar]) === squash(t.narration)) &&
        (cRef < 0 || !t.ref || squash(r[cRef]) === squash(t.ref));
      if (ok) exact++;
      else misses.push(JSON.stringify({ got: r, want: t }));
    }
    if (found > best.found || (found === best.found && exact > best.exact)) best = { found, exact, extra: body.length - found, sheet: name, misses };
  }
  return best;
}

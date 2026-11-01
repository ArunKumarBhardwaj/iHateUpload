/**
 * Synthetic bank statements for tests and the bench. Every name, account and amount is made up.
 * The layouts follow how Indian banks print statements, because those are the ones that broke:
 *
 *  hdfc   no rules, one Courier narration wrapped every 28 characters (mid-word), dd/mm/yy dates,
 *         header repeated on every page, account block on top and a summary table at the end
 *  sbi    full grid, "1 Apr 2024" dates, Indian digit grouping (1,23,456.00), wrapped description
 *         and reference cells, a two-line header cell
 *  icici  full grid, cells centred vertically, headers wrapped over three lines, a serial column
 *  kotak  no rules, one Amount column with Dr/Cr after it, "Cr" after balances, an opening
 *         balance row, header only on the first page, "01-Apr-24" dates
 *  coop   a text dump: one Courier string per row padded with spaces, dd-mm-yyyy dates
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";

export type BankStyle = "hdfc" | "sbi" | "icici" | "kotak" | "coop";
export const BANK_STYLES: BankStyle[] = ["hdfc", "sbi", "icici", "kotak", "coop"];

export type TruthTxn = {
  /** y, m, d */
  date: [number, number, number];
  narration: string;
  ref: string;
  debit: number;
  credit: number;
  balance: number;
};

export type BankTruth = { style: BankStyle; opening: number; txns: TruthTxn[]; pages: number };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const PAYEES = [
  ["UPI", "SWIGGY LIMITED", "swiggy@axisbank", "Payment for order"],
  ["UPI", "ZOMATO PRIVATE LIMITED", "zomato.payu@hdfcbank", "Food order"],
  ["UPI", "RAHUL KUMAR SHARMA", "rahulks92@okicici", "Rent share May"],
  ["NEFT", "ACME TECHNOLOGIES PVT LTD", "HDFC0000123", "SALARY"],
  ["IMPS", "PRIYA NAIR", "SBIN0004567", "Tuition fees"],
  ["POS", "AMAZON PAY INDIA PRIVATE", "AMAZON", "Online purchase"],
  ["ATM", "CASH WDL MG ROAD BENGALURU", "S1AW001234", "Cash"],
  ["ACH", "ICICI PRU LIFE INSURANCE", "ICIC7021", "Premium"],
  ["UPI", "BHARAT PETROLEUM KORAMANGALA", "bpcl.9876@sbi", "Fuel"],
  ["NEFT", "GREENFIELD HOUSING SOCIETY", "UTIB0001122", "Maintenance"],
];

const pad2 = (n: number) => String(n).padStart(2, "0");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 1,23,456.78 */
export function indianGroup(n: number): string {
  const [whole, frac] = Math.abs(n).toFixed(2).split(".");
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${n < 0 ? "-" : ""}${rest ? `${rest},${last3}` : last3}.${frac}`;
}
/** 123,456.78 */
export const westernGroup = (n: number) =>
  `${n < 0 ? "-" : ""}${Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

export function makeTransactions(seed: number, count: number, opening: number): TruthTxn[] {
  const rand = rng(seed);
  const txns: TruthTxn[] = [];
  let balance = opening;
  let day = 1;
  let month = 4;
  for (let i = 0; i < count; i++) {
    if (rand() < 0.45) day++;
    if (day > 30) {
      day = 1;
      month++;
    }
    const [kind, who, handle, note] = PAYEES[Math.floor(rand() * PAYEES.length)];
    const id = String(400000000000 + Math.floor(rand() * 99999999999));
    const salary = note === "SALARY";
    const credit = salary || (rand() < 0.2 && kind !== "ATM" && kind !== "POS");
    const amount = salary
      ? 85000 + Math.round(rand() * 40000)
      : Math.round((credit ? 500 + rand() * 25000 : 40 + rand() * (rand() < 0.15 ? 150000 : 6000)) * 100) / 100;
    const narration =
      kind === "UPI"
        ? `UPI/${id}/${who}/${handle}/${note}`
        : kind === "NEFT" || kind === "IMPS"
          ? `${kind}-${handle}${id.slice(0, 8)}-${who}-${note.toUpperCase()}`
          : kind === "ATM"
            ? `ATM WDL-${who}-${handle}`
            : kind === "ACH"
              ? `ACH D- ${who}-${handle}${id.slice(-5)}`
              : `POS ${id.slice(0, 4)}XXXXXXXX${id.slice(-4)} ${who}`;
    balance = Math.round((balance + (credit ? amount : -amount)) * 100) / 100;
    txns.push({
      date: [2024, month, day],
      narration,
      ref: kind === "ATM" ? "" : kind === "ACH" ? `${id.slice(0, 6)}` : `0000${id}`.slice(-16),
      debit: credit ? 0 : amount,
      credit: credit ? amount : 0,
      balance,
    });
  }
  return txns;
}

/** Breaks text into lines no wider than width. byChars cuts every n characters, mid-word, the way some core-banking systems print. */
function wrap(text: string, font: PDFFont, size: number, width: number, byChars?: number): string[] {
  if (byChars) {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += byChars) out.push(text.slice(i, i + byChars));
    return out;
  }
  const out: string[] = [];
  let line = "";
  // Break after spaces, slashes and hyphens; a token too long for a line is cut.
  const tokens = text.match(/[^\s/-]+[\s/-]*|[\s/-]+/g) ?? [text];
  for (const token of tokens) {
    const next = line + token;
    if (font.widthOfTextAtSize(next.trimEnd(), size) <= width) {
      line = next;
      continue;
    }
    if (line) out.push(line.trimEnd());
    line = token;
    while (font.widthOfTextAtSize(line.trimEnd(), size) > width) {
      let k = line.length;
      while (k > 1 && font.widthOfTextAtSize(line.slice(0, k), size) > width) k--;
      out.push(line.slice(0, k));
      line = line.slice(k);
    }
  }
  if (line.trim()) out.push(line.trimEnd());
  return out;
}

type Ctx = { doc: PDFDocument; reg: PDFFont; bold: PDFFont; mono: PDFFont };
const ink = rgb(0, 0, 0);

function right(page: PDFPage, text: string, xRight: number, y: number, size: number, font: PDFFont) {
  page.drawText(text, { x: xRight - font.widthOfTextAtSize(text, size), y, size, font });
}

function accountBlock(page: PDFPage, ctx: Ctx, top: number, bank: string) {
  page.drawText(bank, { x: 40, y: top, size: 14, font: ctx.bold });
  const lines = [
    "Account Holder : MS ANANYA RAO",
    "Address : 14 LAKE VIEW ROAD, INDIRANAGAR, BENGALURU 560038",
    "Account No : 50100123456789        IFSC : DEMO0001234",
    "Statement From : 01/04/2024 To : 30/06/2024",
  ];
  lines.forEach((l, i) => page.drawText(l, { x: 40, y: top - 20 - i * 12, size: 8, font: ctx.reg }));
  return top - 20 - lines.length * 12 - 10;
}

const ddmmyy = (d: TruthTxn["date"]) => `${pad2(d[2])}/${pad2(d[1])}/${String(d[0]).slice(2)}`;
const ddmmyyyy = (d: TruthTxn["date"], sep = "/") => `${pad2(d[2])}${sep}${pad2(d[1])}${sep}${d[0]}`;
const dMonYyyy = (d: TruthTxn["date"]) => `${d[2]} ${MON[d[1] - 1]} ${d[0]}`;
const ddMonYy = (d: TruthTxn["date"]) => `${pad2(d[2])}-${MON[d[1] - 1]}-${String(d[0]).slice(2)}`;

/** No rules; narration in Courier cut every 28 characters; header in a box on each page. */
async function hdfc(ctx: Ctx, txns: TruthTxn[], opening: number) {
  const { doc, reg, bold, mono } = ctx;
  const size = 7;
  const cols = [
    { label: "Date", x: 30, w: 38 },
    { label: "Narration", x: 70, w: 150 },
    { label: "Chq./Ref.No.", x: 222, w: 78 },
    { label: "Value Dt", x: 302, w: 38 },
    { label: "Withdrawal Amt.", x: 342, w: 72, right: true },
    { label: "Deposit Amt.", x: 416, w: 72, right: true },
    { label: "Closing Balance", x: 490, w: 76, right: true },
  ];
  let page = doc.addPage([595, 842]);
  let y = accountBlock(page, ctx, 800, "DEMO BANK LTD");
  let pageNo = 1;
  const header = () => {
    page.drawText(`Page No .: ${pageNo}`, { x: 480, y: 815, size: 8, font: reg });
    page.drawRectangle({ x: 28, y: y - 4, width: 540, height: 14, borderColor: ink, borderWidth: 0.6 });
    for (const c of cols) {
      if (c.right) right(page, c.label, c.x + c.w, y, size, bold);
      else page.drawText(c.label, { x: c.x, y, size, font: bold });
    }
    y -= 16;
  };
  header();
  for (const t of txns) {
    const lines = wrap(t.narration, mono, size, 150, 28);
    if (y - lines.length * 9 < 60) {
      page = doc.addPage([595, 842]);
      pageNo++;
      y = 790;
      header();
    }
    page.drawText(ddmmyy(t.date), { x: 30, y, size, font: reg });
    lines.forEach((l, i) => page.drawText(l, { x: 70, y: y - i * 9, size, font: mono }));
    page.drawText(t.ref, { x: 222, y, size, font: reg });
    page.drawText(ddmmyy(t.date), { x: 302, y, size, font: reg });
    if (t.debit) right(page, westernGroup(t.debit), 414, y, size, reg);
    if (t.credit) right(page, westernGroup(t.credit), 488, y, size, reg);
    right(page, westernGroup(t.balance), 566, y, size, reg);
    y -= lines.length * 9 + 3;
  }
  y -= 16;
  page.drawText("STATEMENT SUMMARY :-", { x: 30, y, size: 8, font: bold });
  y -= 14;
  const sumCols = ["Opening Balance", "Dr Count", "Cr Count", "Debits", "Credits", "Closing Bal"];
  const debits = txns.reduce((a, t) => a + t.debit, 0);
  const credits = txns.reduce((a, t) => a + t.credit, 0);
  const vals = [
    westernGroup(opening),
    String(txns.filter((t) => t.debit).length),
    String(txns.filter((t) => t.credit).length),
    westernGroup(debits),
    westernGroup(credits),
    westernGroup(txns[txns.length - 1].balance),
  ];
  sumCols.forEach((c, i) => {
    page.drawText(c, { x: 30 + i * 90, y, size, font: bold });
    page.drawText(vals[i], { x: 30 + i * 90, y: y - 11, size, font: reg });
  });
  page.drawText("Generated On: 01-Jul-2024 This is a computer generated statement.", { x: 30, y: 40, size: 6, font: reg });
}

type GridCol = { label: string[]; w: number; right?: boolean };

/** Full grid with optional vertical centring and a fill behind the header. */
async function ruled(
  ctx: Ctx,
  txns: TruthTxn[],
  cols: GridCol[],
  cellsOf: (t: TruthTxn, i: number) => string[],
  opts: { center: boolean; size: number; title: string; above?: string },
) {
  const { doc, reg, bold } = ctx;
  const size = opts.size;
  const lead = size * 1.25;
  const x0 = 28;
  const xs = cols.reduce<number[]>((acc, c) => [...acc, acc[acc.length - 1] + c.w], [x0]);
  let page = doc.addPage([595, 842]);
  let y = accountBlock(page, ctx, 800, opts.title);
  if (opts.above) {
    page.drawText(opts.above, { x: 40, y, size: 8, font: bold });
    y -= 14;
  }
  const hline = (yy: number) => page.drawLine({ start: { x: xs[0], y: yy }, end: { x: xs[xs.length - 1], y: yy }, thickness: 0.5, color: ink });
  const vlines = (top: number, bottom: number) =>
    xs.forEach((x) => page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, thickness: 0.5, color: ink }));
  const drawRow = (cells: string[][], font: PDFFont, fill?: boolean) => {
    const n = Math.max(...cells.map((c) => c.length));
    const h = n * lead + 6;
    if (fill) page.drawRectangle({ x: xs[0], y: y - h, width: xs[xs.length - 1] - xs[0], height: h, color: rgb(0.86, 0.9, 0.96) });
    hline(y);
    cells.forEach((lines, c) => {
      const offset = opts.center ? ((n - lines.length) * lead) / 2 : 0;
      lines.forEach((l, k) => {
        const yy = y - 3 - size - offset - k * lead;
        if (cols[c].right && !fill) right(page, l, xs[c + 1] - 3, yy, size, font);
        else page.drawText(l, { x: xs[c] + 3, y: yy, size, font });
      });
    });
    vlines(y, y - h);
    y -= h;
    hline(y);
  };
  const header = () => drawRow(cols.map((c) => c.label), bold, true);
  header();
  txns.forEach((t, i) => {
    const cells = cellsOf(t, i).map((text, c) => (text ? wrap(text, reg, size, cols[c].w - 6) : []));
    const h = Math.max(1, ...cells.map((c) => c.length)) * lead + 6;
    if (y - h < 50) {
      page = doc.addPage([595, 842]);
      y = 800;
      header();
    }
    drawRow(cells, reg);
  });
}

async function sbi(ctx: Ctx, txns: TruthTxn[], opening: number) {
  const cols: GridCol[] = [
    { label: ["Txn Date"], w: 52 },
    { label: ["Value", "Date"], w: 52 },
    { label: ["Description"], w: 150 },
    { label: ["Ref No./Cheque", "No."], w: 90 },
    { label: ["Debit"], w: 62, right: true },
    { label: ["Credit"], w: 62, right: true },
    { label: ["Balance"], w: 70, right: true },
  ];
  await ruled(
    ctx,
    txns,
    cols,
    (t) => [
      dMonYyyy(t.date),
      dMonYyyy(t.date),
      t.narration,
      t.ref,
      t.debit ? indianGroup(t.debit) : "",
      t.credit ? indianGroup(t.credit) : "",
      indianGroup(t.balance),
    ],
    { center: false, size: 7, title: "DEMO STATE BANK", above: `Balance as on 1 Apr 2024 : ${indianGroup(opening)}` },
  );
}

async function icici(ctx: Ctx, txns: TruthTxn[]) {
  const cols: GridCol[] = [
    { label: ["S No."], w: 28 },
    { label: ["Value", "Date"], w: 50 },
    { label: ["Transaction", "Date"], w: 50 },
    { label: ["Cheque", "Number"], w: 60 },
    { label: ["Transaction Remarks"], w: 140 },
    { label: ["Withdrawal", "Amount", "(INR )"], w: 64, right: true },
    { label: ["Deposit", "Amount", "(INR )"], w: 64, right: true },
    { label: ["Balance", "(INR )"], w: 70, right: true },
  ];
  await ruled(
    ctx,
    txns,
    cols,
    (t, i) => [
      String(i + 1),
      ddmmyyyy(t.date),
      ddmmyyyy(t.date),
      t.ref ? t.ref.slice(-8) : "-",
      t.narration,
      westernGroup(t.debit),
      westernGroup(t.credit),
      westernGroup(t.balance),
    ],
    { center: true, size: 7, title: "DEMO PRIVATE BANK" },
  );
}

/** No rules; one Amount column followed by Dr/Cr; balance carries Cr; header only on page one. */
async function kotak(ctx: Ctx, txns: TruthTxn[], opening: number) {
  const { doc, reg, bold } = ctx;
  const size = 7.5;
  let page = doc.addPage([595, 842]);
  let y = accountBlock(page, ctx, 800, "DEMO MAHINDRA BANK");
  const heads: [string, number, boolean?][] = [
    ["Date", 32],
    ["Narration", 82],
    ["Chq/Ref No", 290],
    ["Amount", 440, true],
    ["Dr / Cr", 452],
    ["Balance", 560, true],
  ];
  for (const [label, x, r] of heads) {
    if (r) right(page, label, x, y, size, bold);
    else page.drawText(label, { x, y, size, font: bold });
  }
  page.drawLine({ start: { x: 30, y: y - 4 }, end: { x: 565, y: y - 4 }, thickness: 0.7, color: ink });
  y -= 18;
  page.drawText("OPENING BALANCE", { x: 82, y, size, font: reg });
  right(page, `${westernGroup(opening)}(Cr)`, 560, y, size, reg);
  y -= 14;
  for (const t of txns) {
    const lines = wrap(t.narration, reg, size, 195);
    if (y - lines.length * 9.5 < 60) {
      page.drawText(`Page ${doc.getPageCount()}`, { x: 280, y: 30, size: 7, font: reg });
      page = doc.addPage([595, 842]);
      y = 800;
    }
    page.drawText(ddMonYy(t.date), { x: 32, y, size, font: reg });
    lines.forEach((l, i) => page.drawText(l, { x: 82, y: y - i * 9.5, size, font: reg }));
    if (t.ref) page.drawText(t.ref, { x: 290, y, size, font: reg });
    right(page, westernGroup(t.debit || t.credit), 440, y, size, reg);
    page.drawText(t.debit ? "Dr" : "Cr", { x: 452, y, size, font: reg });
    right(page, `${westernGroup(t.balance)}(Cr)`, 560, y, size, reg);
    y -= lines.length * 9.5 + 4.5;
  }
  page.drawText(`Page ${doc.getPageCount()}`, { x: 280, y: 30, size: 7, font: reg });
}

/** A fixed-width text report: each row is one string padded with spaces. */
async function coop(ctx: Ctx, txns: TruthTxn[], opening: number) {
  const { doc, mono } = ctx;
  const size = 7;
  const padR = (s: string, n: number) => s.slice(0, n).padEnd(n);
  const padL = (s: string, n: number) => s.slice(0, n).padStart(n);
  const row = (a: string, b: string, c: string, d: string, e: string, f: string) =>
    `${padR(a, 11)} ${padR(b, 40)} ${padR(c, 12)} ${padL(d, 13)} ${padL(e, 13)} ${padL(f, 14)}`;
  let page = doc.addPage([595, 842]);
  let y = 800;
  let n = 1;
  const header = () => {
    page.drawText("DEMO CO-OPERATIVE BANK LTD                         ACCOUNT STATEMENT", { x: 30, y, size, font: mono });
    y -= 10;
    page.drawText(`A/C NO: 001234567890   NAME: ANANYA RAO               PAGE ${n}`, { x: 30, y, size, font: mono });
    y -= 14;
    page.drawText("-".repeat(108), { x: 30, y, size, font: mono });
    y -= 10;
    page.drawText(row("DATE", "PARTICULARS", "CHQ.NO.", "DEBIT", "CREDIT", "BALANCE"), { x: 30, y, size, font: mono });
    y -= 10;
    page.drawText("-".repeat(108), { x: 30, y, size, font: mono });
    y -= 12;
  };
  header();
  page.drawText(row("", "BALANCE B/F", "", "", "", indianGroup(opening)), { x: 30, y, size, font: mono });
  y -= 10;
  for (const t of txns) {
    if (y < 60) {
      page = doc.addPage([595, 842]);
      n++;
      y = 800;
      header();
    }
    const text = row(
      ddmmyyyy(t.date, "-"),
      t.narration.slice(0, 40),
      t.ref.slice(-6),
      t.debit ? indianGroup(t.debit) : "",
      t.credit ? indianGroup(t.credit) : "",
      indianGroup(t.balance),
    );
    page.drawText(text, { x: 30, y, size, font: mono });
    y -= 10;
  }
}

export const STYLE_SEEDS: Record<BankStyle, number> = { hdfc: 11, sbi: 22, icici: 33, kotak: 44, coop: 55 };

export async function makeBankStatement(style: BankStyle, count = 70): Promise<{ bytes: Uint8Array; truth: BankTruth }> {
  const doc = await PDFDocument.create();
  const ctx: Ctx = {
    doc,
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  const opening = 48250.75;
  let txns = makeTransactions(STYLE_SEEDS[style], count, opening);
  if (style === "coop") txns = txns.map((t) => ({ ...t, narration: t.narration.slice(0, 40).trimEnd(), ref: t.ref.slice(-6) }));
  if (style === "icici") txns = txns.map((t) => ({ ...t, ref: t.ref ? t.ref.slice(-8) : "-" }));
  if (style === "sbi") txns = txns.map((t) => ({ ...t, narration: t.narration.replace(/\//g, " / "), ref: t.ref ? `TRANSFER FROM ${t.ref}` : "" }));
  if (style === "hdfc") await hdfc(ctx, txns, opening);
  if (style === "sbi") await sbi(ctx, txns, opening);
  if (style === "icici") await icici(ctx, txns);
  if (style === "kotak") await kotak(ctx, txns, opening);
  if (style === "coop") await coop(ctx, txns, opening);
  return { bytes: await doc.save(), truth: { style, opening, txns, pages: doc.getPageCount() } };
}

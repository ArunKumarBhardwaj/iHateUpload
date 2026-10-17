// Synthetic fixture: every value below is fake or a published test number.
// Usage: bun bench/redact/make-fixture.ts <outDir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";

import { verhoeffCheckDigit } from "../../src/lib/pii-detect";

const aad = (body: string) => {
  const d = body + verhoeffCheckDigit(body);
  return `${d.slice(0, 4)} ${d.slice(4, 8)} ${d.slice(8)}`;
};

/** What is planted, per type. The runner scores both tools against this. */
export const PLANTED: Record<string, string[]> = {
  email: ["jane.roe@example.com", "sales@example.org"],
  phone: ["+91 98765 43210", "+1 (555) 010-0199", "+44 20 7946 0958"],
  card: ["4111 1111 1111 1111", "5555 5555 5555 4444"],
  aadhaar: [aad("23456789012".slice(0, 11)), aad("98765432101".slice(0, 11))],
  pan: ["ABCPE1234F", "XYZPK9876L"],
  ifsc: ["HDFC0001234"],
  account: ["123456789012"],
  iban: ["GB82 WEST 1234 5698 7654 32"],
  ssn: ["219-09-9999"],
  dob: ["14/03/1990"],
};

export const DECOYS = ["384915027364", "INV-2024-0042", "2024-01-15", "Order 55512"];

const lines: [string, string][] = [
  ["Name", "Jane Roe (synthetic test person)"],
  ["Email", PLANTED.email[0]],
  ["Phone", PLANTED.phone[0]],
  ["Card", PLANTED.card[0]],
  ["Aadhaar", PLANTED.aadhaar[0]],
  ["PAN", PLANTED.pan[0]],
  ["IFSC", PLANTED.ifsc[0]],
  ["A/c No", PLANTED.account[0]],
  ["IBAN", PLANTED.iban[0]],
  ["SSN", PLANTED.ssn[0]],
  ["DOB", PLANTED.dob[0]],
  ["Reference", DECOYS[0]],
  ["Invoice", DECOYS[1]],
];
const page2: [string, string][] = [
  ["Sales", PLANTED.email[1]],
  ["Call", PLANTED.phone[1]],
  ["Office", PLANTED.phone[2]],
  ["Backup card", PLANTED.card[1]],
  ["Spouse Aadhaar", PLANTED.aadhaar[1]],
  ["Spouse PAN", PLANTED.pan[1]],
  ["Issued", DECOYS[2]],
  ["Note", DECOYS[3]],
];

const out = process.argv[2] ?? ".";
mkdirSync(out, { recursive: true });
const doc = await PDFDocument.create();
doc.setTitle("Confidential - Jane Roe");
doc.setAuthor("Jane Roe");
doc.setSubject("Synthetic KYC form");
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const draw = (
  page: ReturnType<typeof doc.addPage>,
  rows: [string, string][],
  title: string,
) => {
  page.drawText(title, { x: 50, y: 740, size: 20, font: bold, color: rgb(0, 0, 0) });
  rows.forEach(([k, v], i) => {
    page.drawText(`${k}:`, { x: 50, y: 700 - i * 34, size: 13, font: bold });
    page.drawText(v, { x: 170, y: 700 - i * 34, size: 13, font });
  });
};
draw(doc.addPage([612, 792]), lines, "KYC Application (synthetic)");
const p2 = doc.addPage([612, 792]);
draw(p2, page2, "Annex (synthetic)");
// An invisible OCR-style layer: render mode 3 text on page 2.
const ghost = `BT 3 Tr /${font.name} 10 Tf 50 100 Td (HIDDENSECRET hidden.person@example.com) Tj ET`;
if (process.argv[3] !== "plain") p2.node.addContentStream(doc.context.register(doc.context.stream(ghost)));
writeFileSync(join(out, process.argv[3] === "plain" ? "kyc-plain.pdf" : "kyc-synthetic.pdf"), await doc.save());
writeFileSync(join(out, "planted.json"), JSON.stringify({ PLANTED, DECOYS }, null, 2));
console.log("wrote", out);

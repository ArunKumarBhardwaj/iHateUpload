// Builds an image-only PDF (a "scan") of the synthetic values, to exercise OCR.
// Usage: node internal/benchmarks/redact/make-scan.mjs <fixtureDir>
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";

const fx = process.argv[2];
const { PLANTED } = JSON.parse(readFileSync(join(fx, "planted.json"), "utf8"));
const npx = join(homedir(), ".npm/_npx");
let pw;
for (const d of readdirSync(npx)) {
  const p = join(npx, d, "node_modules/playwright-core/index.mjs");
  if (existsSync(p)) pw = p;
}
const { chromium } = await import(pw);
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const page = await browser.newPage();
const rows = [
  ["Email", PLANTED.email[0]],
  ["Phone", PLANTED.phone[0]],
  ["Card", PLANTED.card[0]],
  ["Aadhaar", PLANTED.aadhaar[0]],
  ["PAN", PLANTED.pan[0]],
  ["IFSC", PLANTED.ifsc[0]],
  ["SSN", PLANTED.ssn[0]],
  ["DOB", PLANTED.dob[0]],
];
const dataUrl = await page.evaluate((rows) => {
  const c = document.createElement("canvas");
  c.width = 1224;
  c.height = 1584;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#000";
  g.font = "bold 44px Helvetica, Arial";
  g.fillText("Scanned ID Card (synthetic)", 100, 140);
  g.font = "34px Helvetica, Arial";
  rows.forEach(([k, v], i) => g.fillText(`${k}: ${v}`, 100, 280 + i * 90));
  return c.toDataURL("image/png");
}, rows);
await browser.close();
const doc = await PDFDocument.create();
const img = await doc.embedPng(Buffer.from(dataUrl.split(",")[1], "base64"));
doc.addPage([612, 792]).drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
writeFileSync(join(fx, "kyc-scan.pdf"), await doc.save());
console.log("wrote kyc-scan.pdf");

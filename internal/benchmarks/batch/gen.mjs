// Synthetic batches for the six tools that now take many files. No personal documents.
// Usage: node internal/benchmarks/batch/gen.mjs   -> internal/benchmarks/batch/fx/
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const fx = new URL("./fx/", import.meta.url).pathname;
mkdirSync(fx + "dup", { recursive: true });

async function textPdf(name, pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pages.forEach((lines) => {
    const page = doc.addPage([595, 842]);
    lines.forEach((line, i) => page.drawText(line, { x: 60, y: 760 - i * 28, size: 14, font }));
  });
  writeFileSync(fx + name, await doc.save());
}

await textPdf("text-a.pdf", [["Invoice A page 1", "Contact alice.example@example.com"], ["Invoice A page 2", "Call +1 415 555 0134"]]);
await textPdf("text-b.pdf", [["Letter B page 1", "Write to bob.sample@example.org"], ["Letter B page 2"], ["Letter B page 3", "bob.sample@example.org again"]]);
await textPdf("dup/text-a.pdf", [["Second file also named text-a", "Reach carol.test@example.net"]]);

const locked = await PDFDocument.create();
locked.addPage([595, 842]).drawText("Locked page", { x: 60, y: 760, size: 14, font: await locked.embedFont(StandardFonts.Helvetica) });
locked.encrypt({ userPassword: "synthetic-pass", ownerPassword: "synthetic-owner" });
writeFileSync(fx + "locked.pdf", await locked.save());

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
for (const [name, words] of [["scan-1.pdf", "Quarterly archive minutes approved unanimously"], ["scan-2.pdf", "Budget committee meets every Thursday morning"]]) {
  await page.setContent(`<body style="margin:0;background:#fff"><p style="font:56px Georgia;padding:120px;line-height:1.5">${words}</p></body>`);
  const jpeg = await page.screenshot({ type: "jpeg", quality: 85 });
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(jpeg);
  doc.addPage([595, 842]).drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  writeFileSync(fx + name, await doc.save());
}
await page.setViewportSize({ width: 400, height: 300 });
const pics = [];
for (const colour of ["#e5322d", "#1d4e89", "#18975a"]) {
  await page.setContent(`<body style="margin:0;background:${colour}"><p style="font:40px sans-serif;color:#fff;padding:30px">${colour}</p></body>`);
  pics.push(await page.screenshot({ type: "jpeg", quality: 80 }));
}
await browser.close();
for (const [name, set] of [["pics-1.pdf", pics.slice(0, 2)], ["pics-2.pdf", pics.slice(2)]]) {
  const doc = await PDFDocument.create();
  for (const bytes of set) {
    const image = await doc.embedJpg(bytes);
    doc.addPage([595, 842]).drawImage(image, { x: 100, y: 400, width: 400, height: 300 });
  }
  writeFileSync(fx + name, await doc.save());
}
console.log("written to", fx);

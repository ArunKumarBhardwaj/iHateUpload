// Two more realistic fixtures made by real apps from synthetic HTML:
// Chrome's print to PDF (embedded TrueType subsets, transparency groups, CJK) and LibreOffice (plain and already PDF/A-2b).
// Usage: node internal/benchmarks/pdfa/gen-apps.mjs   (LibreOffice must be allowed outside the sandbox)
import { createRequire } from "node:module";
import { readdirSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const fx = new URL("./fx/", import.meta.url).pathname;
mkdirSync(fx, { recursive: true });

const rows = Array.from({ length: 8 }, (_, i) => `<tr><td>Item ${i + 1}</td><td>${(i * 137) % 900 + 100}.00</td><td>${["Open", "Closed", "Pending"][i % 3]}</td></tr>`).join("");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Synthetic annual report</title>
<style>
body{font-family:"Helvetica Neue",Arial,sans-serif;margin:40px;color:#222}
h1{font-family:Georgia,serif;color:#1d4e89}
.card{background:rgba(29,78,137,.12);border:1px solid rgba(29,78,137,.4);padding:12px;border-radius:8px}
.shadow{box-shadow:0 4px 12px rgba(0,0,0,.35);padding:10px;margin:20px 0}
table{border-collapse:collapse;width:100%}td{border:1px solid #bbb;padding:4px}
.jp{font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN",sans-serif}
</style></head><body>
<h1>Synthetic annual report 2026</h1>
<p class="card">This report is generated for testing only. Totals are made up. Café, naïve, Größe, “quotes”.</p>
<div class="shadow">A box with a soft shadow, which Chrome draws with transparency.</div>
<svg width="300" height="120"><defs><linearGradient id="g"><stop offset="0" stop-color="#e5322d"/><stop offset="1" stop-color="#f2a516" stop-opacity=".4"/></linearGradient></defs><rect width="300" height="120" fill="url(#g)"/><circle cx="60" cy="60" r="40" fill="#1d4e89" fill-opacity=".6"/></svg>
<p class="jp">日本語のテキストも含みます。</p>
<table>${rows}</table>
<p><a href="https://example.com/report">Read online</a></p>
</body></html>`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });
writeFileSync(fx + "chrome-report.pdf", await page.pdf({ format: "A4", printBackground: true }));
await browser.close();

const work = join(tmpdir(), "pdfa-lo");
mkdirSync(work, { recursive: true });
writeFileSync(join(work, "office-letter.html"), html.replace(/<svg[\s\S]*?<\/svg>/, "").replace("Synthetic annual report 2026", "Synthetic office letter"));
const soffice = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
const profile = `-env:UserInstallation=file://${join(work, "profile")}`;
execFileSync(soffice, [profile, "--headless", "--convert-to", "pdf:writer_web_pdf_Export", "--outdir", work, join(work, "office-letter.html")], { stdio: "ignore" });
renameSync(join(work, "office-letter.pdf"), fx + "office-letter.pdf");
execFileSync(soffice, [profile, "--headless", "--convert-to", 'pdf:writer_web_pdf_Export:{"SelectPdfVersion":{"type":"long","value":"2"}}', "--outdir", work, join(work, "office-letter.html")], { stdio: "ignore" });
renameSync(join(work, "office-letter.pdf"), fx + "already-pdfa2b.pdf");
console.log("written chrome-report, office-letter, already-pdfa2b");

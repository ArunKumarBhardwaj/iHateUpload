// Opens every converted .html in Chrome and records what a reader would see: text lines, headings, lists, tables, links, pictures,
// whether the text is selectable, and (for page-layout outputs) one screenshot per page element.
// Usage: node extract.mjs [--fx]      -> results[-fx]/<side>/<doc>.x.json and <doc>.p<N>.png
import { createRequire } from "node:module";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const RES = join(HERE, process.argv.includes("--fx") ? "results-fx" : "results");
const PAGE_SEL = { "ours-exact": ".pg", "ours-picture": ".pg", "rival-positioned": ".page" };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
for (const side of readdirSync(RES).filter((s) => !s.includes("."))) {
  for (const f of readdirSync(join(RES, side)).filter((x) => x.endsWith(".html"))) {
    const name = f.slice(0, -5);
    const page = await ctx.newPage();
    await page.goto("file://" + join(RES, side, f));
    await page.waitForTimeout(300);
    const info = await page.evaluate(() => {
      const txt = (e) => (e.textContent || "").replace(/\s+/g, " ").trim();
      return {
        title: document.title,
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        lines: document.body.innerText.split("\n").map((s) => s.trim()).filter(Boolean),
        headings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => ({ level: Number(h.tagName[1]), text: txt(h) })),
        lists: [...document.querySelectorAll("ul,ol")].map((l) => ({ type: l.tagName === "OL" ? "number" : "bullet", items: [...l.children].map(txt) })),
        tables: [...document.querySelectorAll("table")].map((t) => [...t.rows].map((r) => [...r.cells].map(txt))),
        links: [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.getAttribute("href"), text: txt(a) })),
        imgs: [...document.images].map((i) => ({ w: i.naturalWidth, h: i.naturalHeight, data: i.src.startsWith("data:") })),
        scripts: document.scripts.length,
        // Selection check: select everything and read back what the browser would copy.
        selected: (() => { getSelection().selectAllChildren(document.body); const s = getSelection().toString().replace(/\s+/g, " ").trim(); getSelection().removeAllRanges(); return s.length; })(),
        htmlBytes: document.documentElement.outerHTML.length,
      };
    });
    const sel = PAGE_SEL[side];
    const shots = [];
    if (sel) {
      const els = await page.locator(sel).all();
      for (let i = 0; i < els.length; i++) {
        const p = join(RES, side, `${name}.p${i + 1}.png`);
        await els[i].screenshot({ path: p });
        shots.push(p);
      }
    }
    writeFileSync(join(RES, side, name + ".x.json"), JSON.stringify({ ...info, shots }));
    console.log(side, name, info.lines.length, "lines", info.headings.length, "h", info.tables.length, "tables", shots.length, "shots");
    await page.close();
  }
}
await browser.close();

// A synthetic 120-page annual report, long enough (> 100k characters) that Summarize PDF reads it in parts.
// Each chapter states one figure, so the merged summary can be checked for figures from all over the file.
import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";

const out = new URL("./fx/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const REGIONS = ["North", "South", "East", "West", "Central", "Coastal"];
const filler =
  "The regional team reviewed supplier contracts, staffing plans and delivery times during the quarter. " +
  "Meetings with customers confirmed demand for the new service tier, and the operations group finished moving " +
  "the warehouse systems to the shared platform. Training for new staff continued on the agreed schedule. ";
for (let n = 1; n <= 120; n++) {
  const page = doc.addPage([612, 792]);
  const chapter = Math.ceil(n / 20);
  const region = REGIONS[chapter - 1];
  let y = 740;
  if (n % 20 === 1) {
    page.drawText(`Chapter ${chapter}: ${region} region`, { x: 60, y, size: 18, font: bold });
    y -= 30;
    page.drawText(`Revenue in the ${region} region reached $${(1.2 + chapter * 0.7).toFixed(1)} million, up ${4 + chapter * 3}% on last year.`, { x: 60, y, size: 11, font });
    y -= 24;
  }
  const words = (filler.repeat(5)).split(" ");
  let line = "";
  for (const w of words) {
    if (font.widthOfTextAtSize(line + " " + w, 11) > 490) {
      page.drawText(line, { x: 60, y, size: 11, font });
      y -= 15;
      line = w;
      if (y < 80) break;
    } else line = line ? `${line} ${w}` : w;
  }
  page.drawText(`Annual report 2025 - page ${n}`, { x: 60, y: 40, size: 9, font });
}
writeFileSync(out + "annual-report-120p.pdf", await doc.save());
console.log("wrote", out + "annual-report-120p.pdf");

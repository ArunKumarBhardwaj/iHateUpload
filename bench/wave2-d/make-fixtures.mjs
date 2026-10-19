// Synthetic fixtures for Edit PDF. Run: bun bench/wave2-d/make-fixtures.mjs
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = (n) => join(HERE, "fx", n);

// invoice.pdf: 2 pages, standard fonts, Acme Corp appears on both pages.
{
  const doc = await PDFDocument.create();
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText("INVOICE 1042", { x: 60, y: 720, size: 26, font: bold });
  p1.drawText("Bill to: Acme Corp", { x: 60, y: 670, size: 14, font: sans });
  p1.drawText("Amount due 1200 USD", { x: 360, y: 670, size: 14, font: sans });
  p1.drawText("Thank you for your business, Acme Corp. Payment is due in 30 days.", { x: 60, y: 600, size: 12, font: times });
  p1.drawText("Contact sales@example.test for questions.", { x: 60, y: 580, size: 12, font: times, color: rgb(0.1, 0.2, 0.7) });
  const p2 = doc.addPage([612, 792]);
  p2.drawText("Terms", { x: 60, y: 720, size: 20, font: bold });
  p2.drawText("Acme Corp agrees to the terms. Acme Corp may cancel.", { x: 60, y: 680, size: 12, font: times });
  p2.drawText("Footer line that must survive", { x: 60, y: 100, size: 12, font: sans });
  writeFileSync(fx("invoice.pdf"), await doc.save());
}
// invoice-type0.pdf: embedded (CID) font, same words.
{
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync(join(HERE, "../../public/fonts/LiberationSans-Regular.ttf")), { subset: false });
  const p = doc.addPage([612, 792]);
  p.drawText("Bill to: Acme Corp", { x: 60, y: 670, size: 14, font });
  p.drawText("Amount due 1200 USD", { x: 360, y: 670, size: 14, font });
  p.drawText("Keep this line as it is", { x: 60, y: 600, size: 14, font });
  writeFileSync(fx("invoice-type0.pdf"), await doc.save());
}
console.log("ok");

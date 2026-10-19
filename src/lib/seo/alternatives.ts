import type { ToolId } from "@/lib/tools";

/**
 * "Alternative to" comparison content. Every row here must be backed by a row
 * in docs/vs-ihatepdf.md with the same verdict and date; update both together.
 */
export type Verdict = "better" | "equal" | "gap";

export type CompareRow = {
  /** URL segment under /alternatives/ihatepdf/ (only rows with a page). */
  slug?: string;
  tool?: ToolId;
  feature: string;
  ours: string;
  theirs: string;
  verdict: Verdict;
  /** What we measured or checked, in plain words. */
  evidence: string;
  checked: string;
};

export const RIVAL = {
  slug: "ihatepdf",
  name: "ihatepdf.cv",
  /** Shown on every comparison page. */
  summary:
    "ihatepdf.cv is the closest alternative to iHateUpload: it also processes files in your browser instead of uploading them. We compared the two tool by tool with synthetic test files. This page lists where we are ahead, where we are even, and where they are ahead.",
};

export const COMPARE_ROWS: CompareRow[] = [
  // Platform
  {
    feature: "Files processed in the browser",
    ours: "Yes, every tool except Ask PDF (whose extracted text goes to Google Gemini)",
    theirs: "Yes",
    verdict: "equal",
    evidence: "Network capture of a compress run on both sites: no file upload on either.",
    checked: "2026-10-12",
  },
  {
    feature: "Session recording on tool pages",
    ours: "None; page-view analytics only",
    theirs: "Microsoft Clarity session recorder active during a compress run",
    verdict: "better",
    evidence: "Browser storage capture during a compress run.",
    checked: "2026-10-12",
  },
  {
    feature: "PDF libraries",
    ours: "pdf.js 6.2 and maintained pdf-lib fork, bundled with the site",
    theirs: "pdf.js 3.11 and pdf-lib 1.17.1 loaded from public CDNs without integrity checks",
    verdict: "better",
    evidence: "Teardown of both sites' scripts.",
    checked: "2026-10-12",
  },
  {
    feature: "Page speed (Lighthouse, mobile)",
    ours: "Home 98, tool pages 85–100",
    theirs: "Home 93, Compress 81",
    verdict: "better",
    evidence: "Lighthouse 12 runs on both sites.",
    checked: "2026-10-13",
  },
  {
    feature: "Accessibility (Lighthouse)",
    ours: "100 on home and tool pages",
    theirs: "93–95",
    verdict: "better",
    evidence: "Lighthouse 12 runs on both sites.",
    checked: "2026-10-13",
  },
  {
    feature: "Works offline",
    ours: "Yes, a service worker caches the code and codecs",
    theirs: "Yes, a service worker",
    verdict: "equal",
    evidence: "Both service workers read.",
    checked: "2026-10-12",
  },
  // Tools
  {
    slug: "compress-pdf",
    tool: "compress-pdf",
    feature: "Compress PDF",
    ours: "Images resampled to the size they are drawn (MozJPEG), quality guided by PSNR, text kept; target size 100 KB–5 MB",
    theirs: "Several codecs per image, font subsetting, JBIG2 for 1-bit scans; levels and target size",
    verdict: "better",
    evidence: "10.5 MB photo PDF at medium: ours 94.3 KB, theirs 95 KB, both keep text. A 12.6 MB synthetic 5-page scan: Light 391 KB vs 793 KB, Medium 101 KB vs 295 KB, smallest 48 KB with 98.1% OCR accuracy vs 75 KB with 34.5%; 2.4–2.9 s vs 19–30 s.",
    checked: "2026-10-17",
  },
  {
    slug: "pdf-to-word",
    tool: "pdf-to-word",
    feature: "PDF to Word",
    ours: "Editable mode with tables, lists, shapes, images, links and embedded fonts; exact-look mode with editable text boxes; CJK fonts; slide backgrounds kept",
    theirs: "Editable and Exact modes; also turns PDF comments into Word comments, which we do not",
    verdict: "better",
    evidence: "Realistic test corpus, editable mode: structure 0.90 vs 0.80, visual 0.52 vs 0.34. Exact vs Exact: visual 0.80 vs 0.66. 120 pages in 0.42 s vs 0.78 s.",
    checked: "2026-10-17",
  },
  {
    slug: "pdf-to-excel",
    tool: "pdf-to-excel",
    feature: "PDF to Excel",
    ours: "Typed cells, merged headers, tables joined across pages, OCR for scans, editable preview grid, text sheet when no table is found",
    theirs: "Typed cells and an editable preview; nothing exported when no table is found",
    verdict: "better",
    evidence: "9 synthetic documents: cells 100% vs 98% correct, hardest scan 97% vs 83%, faster on every document.",
    checked: "2026-10-17",
  },
  {
    slug: "edit-pdf",
    tool: "edit-pdf",
    feature: "Edit PDF text",
    ours: "Old glyphs removed from the file when you edit a line; find and replace across all pages; OCR for scans",
    theirs: "Find and replace on the current page only; the old text stays in the file; no OCR",
    verdict: "better",
    evidence: "Synthetic invoice: after editing, the old string was gone from our output's text but still present in theirs; our replace-all reached page 2, theirs did not.",
    checked: "2026-10-19",
  },
  {
    slug: "redact-pdf",
    tool: "redact-pdf",
    feature: "Redact PDF",
    ours: "Manual boxes plus an automatic finder for 11 kinds of personal data, checksum-validated, with OCR for scans; pixels burned out",
    theirs: "Automatic finder for Indian IDs, email, bank and dates; no cards, phones, IBAN or SSN; no OCR",
    verdict: "better",
    evidence: "Head-to-head on synthetic documents with planted personal data.",
    checked: "2026-10-17",
  },
  {
    slug: "scan-to-pdf",
    tool: "scan-to-pdf",
    feature: "Scan to PDF",
    ours: "Corners found automatically with drag handles, perspective fix, filters, searchable OCR text layer on by default",
    theirs: "Corner crop, filters, OCR text layer in 20 languages",
    verdict: "better",
    evidence: "Two synthetic photos of a tilted page with default settings: ours found the corners and straightened the page, theirs did not crop; Document filter 246 KB vs 355 KB; our OCR text clean, theirs garbled.",
    checked: "2026-10-19",
  },
  {
    slug: "powerpoint-to-pdf",
    tool: "pptx-to-pdf",
    feature: "PowerPoint to PDF",
    ours: "One page per slide with masters, shapes, pictures, tables and bullets; text selectable",
    theirs: "Hi-Fi mode (text not selectable) or Vector mode",
    verdict: "better",
    evidence: "Synthetic 3-slide deck: ours 54 KB, all text selectable and all shapes drawn; their preview dropped the master title and bullets and showed the picture as a grey box.",
    checked: "2026-10-19",
  },
  {
    slug: "split-pdf",
    tool: "split-pdf",
    feature: "Split PDF",
    ours: "By pages, ranges, in half, by size, by bookmarks and by text (regex, case, whole word), with a parts preview",
    theirs: "By bookmarks and by text (case, whole word)",
    verdict: "better",
    evidence: "Same parts on synthetic files; split by text on 300 pages 255 ms vs 1184 ms (on tiny files theirs was faster, ~60 ms vs ~150 ms).",
    checked: "2026-10-17",
  },
  {
    slug: "protect-pdf",
    tool: "protect-pdf",
    feature: "Protect PDF",
    ours: "AES-256 with permission choices (print, copy, edit, annotate), separate owner password, restrict-only mode",
    theirs: "AES-256, everything allowed, no permission choices",
    verdict: "better",
    evidence: "Ours checked on synthetic files; theirs from a feature check of their live tool.",
    checked: "2026-10-17",
  },
  {
    slug: "crop-pdf",
    tool: "crop-pdf",
    feature: "Crop PDF and page size",
    ours: "Per-page or all-pages crop with 8 drag handles, margins in mm or %; page size presets and custom, keeps orientation",
    theirs: "Per-page crop with 4 sliders, 6 paper sizes and custom; their A3 turned a landscape page portrait",
    verdict: "better",
    evidence: "Synthetic six-page PDF: our crop boxes exact on the chosen pages, others untouched; 52 ms vs 189 ms.",
    checked: "2026-10-19",
  },
  {
    slug: "flatten-pdf",
    tool: "flatten-pdf",
    feature: "Flatten PDF",
    ours: "Form flatten that keeps text, full raster flatten 96–400 DPI, strip annotations, forms, metadata, JavaScript or attachments without rasterising",
    theirs: "Standard flatten keeps metadata; strip options rasterise the page",
    verdict: "better",
    evidence: "Synthetic form: our form flatten 3.3 KB with text kept and no fields left.",
    checked: "2026-10-19",
  },
  {
    slug: "compare-pdfs",
    tool: "compare-pdfs",
    feature: "Compare PDFs",
    ours: "Exact line-by-line diff that flags changed lines",
    theirs: "Side-by-side synced viewers; an AI summary that downloads about 100 MB; no diff",
    verdict: "better",
    evidence: "Both run against the live sites on synthetic files.",
    checked: "2026-10-17",
  },
  {
    slug: "extract-text",
    tool: "extract-text",
    feature: "Extract text from PDF",
    ours: "Keeps line breaks and CJK spacing; OCR for scans and images; copy button and preview",
    theirs: "Collapses lines and adds spaces inside CJK text; OCR toggle",
    verdict: "better",
    evidence: "Ours checked on synthetic files; their line and CJK handling from a head-to-head check of their live tool.",
    checked: "2026-10-17",
  },
  {
    slug: "pdf-metadata",
    tool: "edit-metadata",
    feature: "PDF metadata",
    ours: "Edit every Info field, dates, custom keys and XMP kept in step; strip removes custom keys, dates and XMP",
    theirs: "Edit Info fields and dates; custom keys hidden; stale XMP left behind",
    verdict: "better",
    evidence: "Synthetic PDF with custom keys and XMP; outputs inspected.",
    checked: "2026-10-17",
  },
  {
    slug: "organize-pdf",
    tool: "organize-pdf",
    feature: "Organize and rotate pages",
    ours: "Drag and drop plus keyboard reorder, per-page rotate, duplicate, insert blank, delete; rotate tool with page range and mirror",
    theirs: "Drag and drop, rotate, delete; rotate tool without page range or mirror",
    verdict: "better",
    evidence: "Synthetic six-page PDF with mixed sizes and rotations; output order and rotation checked by render.",
    checked: "2026-10-19",
  },
  {
    slug: "bates-numbering",
    tool: "bates-numbering",
    feature: "Page numbers and Bates numbering",
    ours: "Bates with prefix, suffix, digits, positions, across files, page range, preview and a production log CSV",
    theirs: "Page numbers; Bates without page range",
    verdict: "better",
    evidence: "Same Bates output across 2 synthetic files; 358 ms vs 402 ms on 300 pages.",
    checked: "2026-10-17",
  },
  // Even
  {
    tool: "merge-pdf",
    feature: "Merge PDF",
    ours: "Pages, order and links kept",
    theirs: "Same",
    verdict: "equal",
    evidence: "Same output on synthetic files; ours 0.10 s vs 0.20 s.",
    checked: "2026-10-17",
  },
  {
    tool: "pdf-to-jpg",
    feature: "PDF to JPG / PNG",
    ours: "72–600 DPI, quality choice, JPG or PNG, page ranges, ZIP",
    theirs: "Up to 600 DPI, quality slider, PNG toggle",
    verdict: "equal",
    evidence: "Same options compared.",
    checked: "2026-10-17",
  },
  {
    tool: "word-to-pdf",
    feature: "Word to PDF",
    ours: "Same look on the test file; faster (~0.07 s vs ~0.8 s)",
    theirs: "Same look; smaller files (108 KB vs 226 KB)",
    verdict: "equal",
    evidence: "Same synthetic .docx rendered side by side.",
    checked: "2026-10-17",
  },
  {
    tool: "ocr-pdf",
    feature: "OCR PDF",
    ours: "Tesseract 7, 11 languages, skips pages that already have text",
    theirs: "Tesseract 5, about 22 languages, auto-detect, page range",
    verdict: "equal",
    evidence: "42 of 42 words read by both on a synthetic scan.",
    checked: "2026-10-17",
  },
  {
    tool: "watermark-pdf",
    feature: "Watermark PDF",
    ours: "Opacity, size, angle, colour, tiling, page range, live preview",
    theirs: "Same, without page range",
    verdict: "equal",
    evidence: "Feature check on both sites.",
    checked: "2026-10-17",
  },
  {
    tool: "ask-pdf",
    feature: "Chat with PDF",
    ours: "Multi-turn, up to 10 PDFs; through our server without a key, or your own Gemini key straight from the browser",
    theirs: "Your own Gemini key, multi-turn, up to 10 PDFs",
    verdict: "equal",
    evidence: "Feature check; no live side-by-side.",
    checked: "2026-10-19",
  },
  // Their lead
  {
    feature: "PDF to PowerPoint, Repair PDF, Fill PDF form",
    ours: "Not available yet",
    theirs: "Available",
    verdict: "gap",
    evidence: "Their sitemap.",
    checked: "2026-10-17",
  },
  {
    feature: "Saved multi-step workflows and batch",
    ours: "One-step \"Continue with\" only",
    theirs: "Chain steps and run them once",
    verdict: "gap",
    evidence: "Teardown of their scripts.",
    checked: "2026-10-12",
  },
  {
    feature: "On-device AI (speech-to-text, text-to-speech, summaries)",
    ours: "None",
    theirs: "Whisper, Kokoro TTS and DistilBART in the browser",
    verdict: "gap",
    evidence: "Teardown of their scripts.",
    checked: "2026-10-12",
  },
  {
    feature: "Recent files and starred tools",
    ours: "No",
    theirs: "Yes, stored locally",
    verdict: "gap",
    evidence: "Browser storage capture.",
    checked: "2026-10-12",
  },
  {
    feature: "Comments when converting PDF to Word",
    ours: "No",
    theirs: "Yes, 7 annotation types",
    verdict: "gap",
    evidence: "Teardown of their converter.",
    checked: "2026-10-17",
  },
];

/** Tools only we have (their sitemap has none of these, checked 2026-10-17). */
export const ONLY_OURS: ToolId[] = [
  "compress-image",
  "compress-to-size",
  "resize-image",
  "crop-image",
  "rotate-image",
  "heic-to-jpg",
  "webp-to-jpg",
  "png-to-jpg",
  "jpg-to-png",
  "jpg-to-webp",
  "reverse-pages",
  "delete-blank",
  "insert-blank",
];

export function comparePages(): CompareRow[] {
  return COMPARE_ROWS.filter((row) => row.slug);
}

export function getComparePage(slug: string): CompareRow | undefined {
  return COMPARE_ROWS.find((row) => row.slug === slug);
}

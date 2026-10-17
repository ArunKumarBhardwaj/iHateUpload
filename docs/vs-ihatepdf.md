# iHateUpload vs ihatepdf.cv

One place to see where we beat our main rival, where we tie, and where we still lose — so nobody has to re-read the code or redo the teardown to answer "are we better at X?".

ihatepdf.cv is the rival that matters most: like us it processes files in the browser, nothing uploaded. Server-based sites (iLovePDF, Smallpdf, PDF24) are a different contest.

## Legend

| Mark | Meaning |
|---|---|
| ✅ | We are better, and it was measured or checked (see Evidence) |
| 🟰 | Equal, measured or checked |
| ⚠️ | They are better, measured or checked |
| ➕ | Only we have it |
| ❌ | Only they have it (gap) |
| ❔ | Both have it, not compared head-to-head yet |

**Rules for editing this file**
- A ✅, 🟰 or ⚠️ needs evidence: a benchmark, a test, or a dated check of their site. No evidence means ❔.
- Put the date (YYYY-MM-DD) on every check. Their site changes; anything older than ~3 months should be re-checked before we quote it.
- When we ship or measure something, update the row in the same commit.
- Their tool list comes from `https://www.ihatepdf.cv/sitemap.xml` (last pulled 2026-10-17: 68 tool pages).

## Summary (2026-10-17)

| | Count |
|---|---|
| ✅ We are better (measured) | 17 rows |
| 🟰 Equal (measured) | 11 rows |
| ⚠️ They are better | 20 rows |
| ❔ Shared, not compared yet | 1 rows |
| ➕ Only we have | 15 tools (section 3) |
| ❌ Only they have | 19 gap rows (section 4) + 4 platform/feature gaps (sections 1–2) |

Biggest wins: Compress PDF, PDF to Word (editable), page speed, accessibility, privacy hygiene, all image tools.
Biggest gaps: PDF to Excel / PowerPoint, Repair, Fill form, workflows, Ask PDF privacy, SEO pages.

---

## 1. Platform and trust

| Feature | Ours | ihatepdf.cv | Verdict | Evidence |
|---|---|---|---|---|
| Files processed in the browser, never uploaded | Yes (all tools except Ask PDF text) | Yes (REA network capture of Compress: only their workers loaded) | 🟰 | REA capture, 2026-10-12 |
| Session recording / heavy analytics on tool pages | None (Vercel Analytics page views only) | Microsoft Clarity session recorder (`_cltk` key during a compress run) | ✅ | REA storage capture, 2026-10-12 |
| PDF libraries | pdf.js 6.2 and maintained `@cantoo/pdf-lib`, bundled | pdf.js 3.11.174 and pdf-lib 1.17.1 loaded from public CDNs, no SRI | ✅ | Bundle teardown, 2026-10-12 |
| Works offline | Yes (service worker caches code and WASM codecs) | Yes (service worker) | 🟰 | Both service workers read, 2026-10-12 |
| Page speed (Lighthouse mobile) | Home 98, tool page 85–100 | Home 93, Compress 81 | ✅ | Lighthouse 12, 2026-10-12 / 2026-10-13 |
| Accessibility (Lighthouse) | 100 on home and tool pages | 93–95 | ✅ | Lighthouse 12, 2026-10-13 |
| Best practices (Lighthouse) | 96–100 | 79 | ✅ | Lighthouse 12, 2026-10-12 |
| Server-rendered pages (content without JS) | Yes (Next.js) | No, client-rendered SPA with a separate hidden SEO block | ✅ | HTML fetch, 2026-10-12 |
| Ask / chat with PDF privacy | Extracted text goes to Gemini through our server (disclosed on /privacy) | User's own Gemini key, called from the browser; on-device DistilBART summariser | ⚠️ | Bundle teardown, 2026-10-12 |
| On-device AI (speech-to-text, text-to-speech, summaries) | None | Whisper, Kokoro TTS, DistilBART via transformers.js | ❌ | Bundle teardown, 2026-10-12 |
| Homepage: drop a file, get matching tools | Yes | No ("open a tool first") | ➕ | Our `home-drop.tsx`; their homepage text, 2026-10-12 |
| Search with Cmd/Ctrl+K | Yes | Yes | 🟰 | Both sites, 2026-10-13 |
| Recent files / starred tools | No | Yes (IndexedDB, localStorage) | ❌ | REA storage capture, 2026-10-12 |
| Saved multi-step workflows / batch | No (one-step "Continue with" only) | Yes ("Chain steps, run once", batch panel) | ❌ | Bundle teardown, 2026-10-12 |
| Install as app / share target | Manifest, no share target | Manifest with share target (POST handler looks broken) | ❔ | Manifest read, 2026-10-12 |
| SEO surface | ~55 URLs, per-tool HowTo JSON-LD | ~190 URLs, 113 blog posts, alternative-to pages, FAQ JSON-LD, compress-to-N-KB pages | ⚠️ | Sitemaps, 2026-10-12 |

## 2. Shared tools

| Tool | Ours | Theirs | Verdict | Evidence |
|---|---|---|---|---|
| Compress PDF | Resamples images to drawn size (MozJPEG + Rust Lanczos3) in a worker, PSNR-guided quality, keeps text; target size 200 KB–5 MB | Multi-codec per image, font subsetting, JBIG2 for scans; levels + target size | ✅ | 10.5 MB photo PDF, medium: ours 94.3 KB, theirs 95 KB, both keep text; our Light 283 KB. 2026-10-12 |
| Compress scanned pages | Two-tone scans → 1-bit JBIG2 (block-adaptive threshold; letter dictionary at Medium/Smallest, exact generic region at Light), photos and colour kept on JPEG | JBIG2 only for already-1-bit pages, JPEG otherwise | ✅ | 12.6 MB synthetic 5-page scan: Light 391 KB vs 793 KB, Medium 101 KB vs 295 KB, Smallest 48 KB @98.1% OCR vs Heavy 75 KB @34.5% OCR; 2.4–2.9 s vs 19–30 s. bench/compress-bilevel, 2026-10-17 |
| PDF to Word (editable) | Tables, lists, shapes, images, links, embedded TrueType fonts, CJK fonts | Editable + Exact modes | ✅ | Realistic corpus: struct 0.90 vs 0.80, visual 0.52 vs 0.34; simple corpus 0.96 vs 0.94; 120 pages 0.42 s vs 0.78 s. 2026-10-17 |
| PDF to Word (exact look, still editable) | Text box per block, shapes behind, pictures placed; text editable in boxes | Text box per block | ✅ | Realistic corpus Exact vs Exact: visual 0.80 vs 0.66, struct 0.67 vs 0.60 (invoice 0.97 vs 0.59, spreadsheet 0.94 vs 0.44, slides 0.94 vs 0.55). Known weak: cjk, gov-form-acro, scanned letter. 2026-10-17 |
| PDF to Word: CJK text | Unified ideographs, East Asian fonts and language tags | Keeps Kangxi radicals; font by regex | ✅ | cjk.pdf: 0 radicals in ours; teardown of theirs. 2026-10-17 |
| PDF to Word: slide / cover backgrounds | Kept behind text | Lost in both modes | ✅ | slides.pdf visual 0.40 vs 0.26, 2026-10-17 |
| PDF to Word: comments from annotations | No | Yes (7 annotation types, highlights as shading) | ❌ | Teardown, 2026-10-17 |
| PDF to Excel: cell accuracy and typed numbers | Typed cells, merged headers, fills, tables joined over pages, OCR | Same feature set plus an editable preview before export | 🟰 | `bun bench/pdf-to-excel/scoreboard.ts`: 8 synthetic docs, cells 99% vs 100%, typed 100% vs 99%; ours wins the 3-page bank statement (100% vs 98%: their last two rows become a second table). Ours loses one OCR letter on the scanned invoice (97% vs 100%). 2026-10-17 |
| PDF to Excel: no-table PDFs and sheet names | Text sheet always filled, sheets named from the heading above | Nothing exported when no table is found; sheets named "Table 1 (p1)" | ✅ | report-chart.pdf: ours Text sheet, theirs no output. 2026-10-17 |
| PDF to Excel: preview and cell edits before export | No | Yes (click a cell to correct) | ❌ | Teardown, 2026-10-17 |
| Merge PDF | Yes | Yes | 🟰 | Same pages, order and links; both drop bookmarks; ours 0.10 s vs 0.20 s. head-to-head, synthetic files, `.scratch/head-to-head-2026-10-17.md`, 2026-10-17 |
| Split PDF | Pages, ranges, in half, by size, by bookmarks (depth, per-bookmark toggles, front matter) and by text (regex, match case, whole word, named by match); parts preview before running | By bookmarks (toggles, preview) and by text (case, whole word) | ✅ | Same parts on synthetic files; ours has more options; text split 255 ms vs 1184 ms on 300 pages (tiny files: ours ~150 ms vs ~60 ms). bench/pdf-tools/h2h.mjs, 2026-10-17 |
| PDF to JPG / PNG | 72 / 150 / 300 / 600 DPI (true 600 on desktop: Letter = 5100×6600), JPG quality Smaller/Balanced/Best, JPG or PNG, page ranges, ZIP | Up to 600 DPI, quality slider, PNG toggle | 🟰 | Same options; ours 600 DPI page in ~0.6 s, 1.36 MB. `.scratch/head-to-head-2026-10-17.md` + lead check, 2026-10-17 |
| Images to PDF (JPG, PNG, HEIC) | Image to PDF, PNG to PDF, HEIC to PDF | Images to PDF (no HEIC) | 🟰 | Same page sizing and size (841 vs 840 KB); neither has options. head-to-head, synthetic files, `.scratch/head-to-head-2026-10-17.md`, 2026-10-17 |
| Protect PDF | AES-256; but writes /P -3904 (blocks print/copy/edit) | AES-256, all allowed, strength meter, show password | ⚠️ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| Unlock PDF | Needs the user password; leaves the old encrypted revision in the file | Also lifts owner-only restrictions without a password | ⚠️ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| Rotate / flip PDF | One angle + page range; mirror (branch) | Thumbnails, per-page left/right/180 | ⚠️ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| Organize pages | Arrow buttons | Drag and drop + per-page rotate | ⚠️ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| Sign PDF | Draw/type/stamp, no page picker | Multi-page viewer, ink colour, photo, undo, resize | ⚠️ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| Edit PDF text | Click a line to edit; OCR for scans | Font, size, B/I, colour, align, find-replace, undo; no OCR | ⚠️ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| Crop / page size | One crop box; A4/Letter, fit/letterbox | Per-page crop, sliders, 6 paper sizes + custom, scale to fit | ⚠️ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| Redact PDF | Manual boxes + automatic PII finder (11 types, checksum-validated, OCR for scans, per-item review), pixels burned out | Automatic finder: Aadhaar (no checksum), PAN, IFSC, email, bank, DOB; no cards, phones, IBAN, SSN; no OCR | ✅ | bench/redact head-to-head, 2026-10-17 |
| Compare PDFs | Exact line diff, flags changed lines | Synced viewers; "AI" downloads ~100 MB for a summary, no diff | ✅ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| Extract text | Keeps line breaks and CJK spacing; scanned pages come out empty | Collapses lines; OCR toggle | 🟰 | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| Extract images | Re-encodes JPEG as PNG (~8× larger) | Keeps originals; thumbnails, size filter, per-image download | ⚠️ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| Headers and footers | Prints `{filename}` literally | Expands tokens; colour, size, margin, range, skip first, preview | ⚠️ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| Page numbers / Bates | Formats, ranges, Bates (prefix, suffix, digits, positions, across files, skip first page, page range, live preview, production log CSV) | Page numbers; Bates without page range | ✅ | Same Bates output across 2 files; Bates 358 ms vs 402 ms on 300 pages. bench/pdf-tools/h2h.mjs, 2026-10-17 |
| Watermark | Opacity, size, angle, colour, single or tiled, page range, live preview; text stays selectable | Opacity, size, angle, colour, tiling, live preview | 🟰 | Feature parity; page range is ours only. `.scratch/head-to-head-2026-10-17.md` + lead check, 2026-10-17 |
| Pages per sheet (N-up) | 2/4/9, Letter portrait | 2/4/6/9/16/custom, paper, orientation, margin, gap, border, order | ⚠️ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| Invert / grayscale | Raster only, text lost | Dark, invert, sepia, grayscale; text-preserving mode; DPI | ⚠️ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| Flatten PDF | Form flatten | Same + raster full flatten (96–400 DPI), strip options | ⚠️ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| OCR PDF | Tesseract 7, 11 languages, skips pages that already have text, .txt output | Tesseract 5, ~22 languages, auto-detect, page range | 🟰 | 42/42 words both, ~2.4 s vs 2.6 s. head-to-head, synthetic files, `.scratch/head-to-head-2026-10-17.md`, 2026-10-17 |
| Metadata | Edit all Info fields, dates, custom keys and XMP (kept in step), Copy from another PDF, Revert; Strip wipes custom keys, dates and XMP | Edit Info fields and dates; custom keys hidden; leaves stale XMP | ✅ | bench/pdf-tools h2h metadata-xmp, 2026-10-17 |
| Word to PDF | Follows the docx: theme fonts (Calibri→Carlito, Cambria→Caladea), heading colours, spacing, table width/grid/shading, image size; lists, links, page breaks; selectable text; ~0.07 s | Same fidelity on the test file, selectable text; ~0.8 s; smaller files | 🟰 | Same synthetic docx rendered side by side: same line breaks, colours, table and image. Ours faster, theirs smaller (108 KB vs 226 KB, we embed fonts whole). Lead check, 2026-10-17 |
| Excel to PDF | Drops sheets after the first | All sheets, picker, titles, numbers aligned | ⚠️ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| PowerPoint to PDF | Text only (selectable), loses fills/bold/size | Keeps layout (raster, text not selectable) | ⚠️ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| Markdown to PDF | Prints raw markdown syntax | Rendered, TOC, math, typeface, margins | ⚠️ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| CSV to PDF | No repeated header row | Repeated header, title, edit/sort/style | ⚠️ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| HTML to PDF | Plain text, no CSS | Keeps CSS (raster), page size, orientation | ⚠️ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| Scan to PDF (camera) | No text layer | Corner crop, filters, brightness/contrast, OCR text layer (20 languages) | ⚠️ | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |
| Ask / chat with PDF | Preset prompts, one question, no key; tool page wrongly says "Nothing is uploaded" | BYO Gemini key, multi-turn, up to 10 PDFs | 🟰 | vs production; `.scratch/head-to-head-wave2.md`, 2026-10-17 |

## 3. Only we have

| Tool / feature | Evidence |
|---|---|
| Compress Image (JPG, PNG, WebP) | Their sitemap has no image tools, 2026-10-17 |
| Compress Image to Size (50 KB–8 MB) | same |
| Resize Image | same |
| Crop Image, Rotate Image | same |
| HEIC to JPG | same |
| WebP to JPG, PNG to JPG, JPG to PNG, JPG to WebP | same |
| Reverse Pages | not in their sitemap |
| Delete Blank Pages | not in their sitemap |
| Insert Blank Pages | not in their sitemap |
| Extract Pages (as its own tool) | they do it inside Split |
| Drop-a-file tool suggester on the homepage | section 1 |

## 4. Only they have (our gap list)

Priority is our guess at value for a privacy-first PDF site; "skip" means off-brand.

| Tool | Priority | Notes |
|---|---|---|
| PDF to PowerPoint | High | Reuse text boxes from Exact layout |
| Repair PDF | High | Rebuild broken xref; qpdf-wasm is an option |
| Fill PDF form | High | AcroForm fields with pdf-lib |
| PDF to HTML | Medium | |
| Workflows (chain steps) + batch | Medium | Extend "Continue with" |
| Recent files / starred | Low | Local-only storage |
| PDF to EPUB, eBook to PDF | Low | |
| PDF to ZIP | Low | |
| Alternate & mix pages | Low | |
| Create PDF (blank editor) | Low | |
| Summarize PDF (on-device) | Low | transformers.js |
| PDF to audio, Audio to PDF | Low | Kokoro TTS / Whisper on-device |
| Fingerprint PDF, Thumbmark | Skip | |
| Handwriting tools (3) | Skip | |
| LaTeX resume | Skip | |
| GST invoice, GST filing prep, POS billing | Skip | India-specific business tools |
| P2P share, Collaborative whiteboard | Skip | |
| Compress-to-100 KB / 200 KB / 2 MB landing pages | High (SEO) | Our compress already supports targets |

## 5. How to re-check

```bash
# Their current tool list
curl -s https://www.ihatepdf.cv/sitemap.xml | grep -o '<loc>[^<]*' | sed 's#<loc>https://www.ihatepdf.cv##' | grep -v '^/blog' | sort
```

```bash
# PDF to Word head-to-head (dev server on :43127, Node 24 via nvm)
bun run bench:pdf2word && bun run bench:pdf2word:real
```

- Compress: drop the same synthetic PDF into both sites' compress tool at matching levels; compare size and whether text is still selectable.
- Reverse engineering: REA (`npx rea-agents@latest`, Node 24) against an isolated Chrome profile; method notes in `.scratch/pdf-to-word/rea-findings.md`.
- Use synthetic test files only, never personal documents.

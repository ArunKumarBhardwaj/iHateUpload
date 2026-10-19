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

## Summary (2026-10-19)

| | Count |
|---|---|
| ✅ We are better (measured) | 29 rows |
| 🟰 Equal (measured) | 22 rows |
| ⚠️ They are better | 0 rows |
| ❔ Shared, not compared yet | 1 rows |
| ➕ Only we have | 15 tools (section 3) |
| ❌ Only they have | 17 gap rows (section 4) + 4 platform/feature gaps (sections 1–2) |

Biggest wins: Compress PDF, PDF to Word (editable), page speed, accessibility, privacy hygiene, all image tools.
Biggest gaps: PDF to PowerPoint, Repair, Fill form, workflows, on-device AI, blog content (113 posts vs none).

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
| Ask / chat with PDF privacy | Choice: extracted text via our server to Gemini, or own key straight from the browser to Google (our server never sees text or key); copy says so on the page, footer and /privacy | User's own Gemini key, called from the browser; on-device DistilBART summariser | 🟰 | Code review of src/lib/ask/gemini.ts (key in x-goog-api-key header to generativelanguage.googleapis.com only), 2026-10-19 |
| On-device AI (speech-to-text, text-to-speech, summaries) | None | Whisper, Kokoro TTS, DistilBART via transformers.js | ❌ | Bundle teardown, 2026-10-12 |
| Homepage: drop a file, get matching tools | Yes | No ("open a tool first") | ➕ | Our `home-drop.tsx`; their homepage text, 2026-10-12 |
| Search with Cmd/Ctrl+K | Yes | Yes | 🟰 | Both sites, 2026-10-13 |
| Recent files / starred tools | No | Yes (IndexedDB, localStorage) | ❌ | REA storage capture, 2026-10-12 |
| Saved multi-step workflows / batch | No (one-step "Continue with" only) | Yes ("Chain steps, run once", batch panel) | ❌ | Bundle teardown, 2026-10-12 |
| Install as app / share target | Manifest, no share target | Manifest with share target (POST handler looks broken) | ❔ | Manifest read, 2026-10-12 |
| SEO surface | 80 URLs: 54 tool pages, 5 compress-to-size pages (100 KB, 200 KB, 500 KB, 1 MB, 2 MB, target preset), 18 comparison pages (vs ihatepdf.cv overall + 16 per tool, each with dated evidence and their wins listed); FAQ, HowTo and Breadcrumb JSON-LD; no blog | 190 URLs, of which 113 blog posts and 77 other pages (3 compress-to pages: 100 KB, 200 KB, 2 MB; 3 alternative-to pages); FAQ JSON-LD | 🟰 | Their sitemap.xml pulled 2026-10-19. Ours: all 80 sitemap URLs 200, FAQPage JSON-LD on 59 pages matches visible text, canonicals match (scratch ld-check script); Lighthouse 12 SEO 100 on /compress-pdf-to-100kb, /tools/compress-pdf, /tools/ask-pdf, /alternatives/ihatepdf, /alternatives/ihatepdf/pdf-to-word, 2026-10-19. Non-blog pages 80 vs 77; their 113 blog posts are the gap left |

## 2. Shared tools

| Tool | Ours | Theirs | Verdict | Evidence |
|---|---|---|---|---|
| Compress PDF | Resamples images to drawn size (MozJPEG + Rust Lanczos3) in a worker, PSNR-guided quality, keeps text; target size 100 KB–5 MB | Multi-codec per image, font subsetting, JBIG2 for scans; levels + target size | ✅ | 10.5 MB photo PDF, medium: ours 94.3 KB, theirs 95 KB, both keep text; our Light 283 KB. 2026-10-12 |
| Compress scanned pages | Two-tone scans → 1-bit JBIG2 (block-adaptive threshold; letter dictionary at Medium/Smallest, exact generic region at Light), photos and colour kept on JPEG | JBIG2 only for already-1-bit pages, JPEG otherwise | ✅ | 12.6 MB synthetic 5-page scan: Light 391 KB vs 793 KB, Medium 101 KB vs 295 KB, Smallest 48 KB @98.1% OCR vs Heavy 75 KB @34.5% OCR; 2.4–2.9 s vs 19–30 s. internal/benchmarks/compress-bilevel, 2026-10-17 |
| PDF to Word (editable) | Tables, lists, shapes, images, links, embedded TrueType fonts, CJK fonts | Editable + Exact modes | ✅ | Realistic corpus: struct 0.90 vs 0.80, visual 0.52 vs 0.34; simple corpus 0.96 vs 0.94; 120 pages 0.42 s vs 0.78 s. 2026-10-17 |
| PDF to Word (exact look, still editable) | Text box per block, shapes behind, pictures placed; text editable in boxes | Text box per block | ✅ | Realistic corpus Exact vs Exact: visual 0.80 vs 0.66, struct 0.67 vs 0.60 (invoice 0.97 vs 0.59, spreadsheet 0.94 vs 0.44, slides 0.94 vs 0.55). Known weak: cjk, gov-form-acro, scanned letter. 2026-10-17 |
| PDF to Word: CJK text | Unified ideographs, East Asian fonts and language tags | Keeps Kangxi radicals; font by regex | ✅ | cjk.pdf: 0 radicals in ours; teardown of theirs. 2026-10-17 |
| PDF to Word: slide / cover backgrounds | Kept behind text | Lost in both modes | ✅ | slides.pdf visual 0.40 vs 0.26, 2026-10-17 |
| PDF to Word: comments from annotations | No | Yes (7 annotation types, highlights as shading) | ❌ | Teardown, 2026-10-17 |
| PDF to Excel: cell accuracy and typed numbers | Typed cells, merged headers, fills, tables joined over pages, row-wise OCR with column-aware fixes | Typed cells, editable preview | ✅ | Synthetic corpus (9 docs): cells 100% vs 98%, hardest scan 97% vs 83%, faster on every doc (scan invoice 2.0 s vs 4.5 s). internal/benchmarks/pdf-to-excel, 2026-10-17 |
| PDF to Excel: no-table PDFs and sheet names | Text sheet always filled, sheets named from the heading above | Nothing exported when no table is found; sheets named "Table 1 (p1)" | ✅ | report-chart.pdf: ours Text sheet, theirs no output. 2026-10-17 |
| PDF to Excel: preview and cell edits before export | Editable grid: cells, sheet names, header rows, delete row/column, column types with inferred-type badges and untyped-cell warnings | Click a cell to correct | ✅ | Branch, browser-checked, 2026-10-17 |
| Merge PDF | Yes | Yes | 🟰 | Same pages, order and links; both drop bookmarks; ours 0.10 s vs 0.20 s. head-to-head, synthetic files, head-to-head notes 2026-10-17, 2026-10-17 |
| Split PDF | Pages, ranges, in half, by size, by bookmarks (depth, per-bookmark toggles, front matter) and by text (regex, match case, whole word, named by match); parts preview before running | By bookmarks (toggles, preview) and by text (case, whole word) | ✅ | Same parts on synthetic files; ours has more options; text split 255 ms vs 1184 ms on 300 pages (tiny files: ours ~150 ms vs ~60 ms). internal/benchmarks/pdf-tools/h2h.mjs, 2026-10-17 |
| PDF to JPG / PNG | 72 / 150 / 300 / 600 DPI (true 600 on desktop: Letter = 5100×6600), JPG quality Smaller/Balanced/Best, JPG or PNG, page ranges, ZIP | Up to 600 DPI, quality slider, PNG toggle | 🟰 | Same options; ours 600 DPI page in ~0.6 s, 1.36 MB. head-to-head notes 2026-10-17 + lead check, 2026-10-17 |
| Images to PDF (JPG, PNG, HEIC) | Image to PDF, PNG to PDF, HEIC to PDF | Images to PDF (no HEIC) | 🟰 | Same page sizing and size (841 vs 840 KB); neither has options. head-to-head, synthetic files, head-to-head notes 2026-10-17, 2026-10-17 |
| Protect PDF | AES-256, all allowed by default (/P -4), permission checkboxes (print, copy, edit, annotate/forms), separate owner password, restrict-only mode, show/hide, strength meter | AES-256, all allowed, strength meter, show password; no permission choices | ✅ | branch wave2-a, browser-proved on synthetic files (internal/benchmarks/wave2-a); rival features from head-to-head notes, wave 2, 2026-10-17 |
| Unlock PDF | Full rewrite (zero /Encrypt bytes left), detects owner-only PDFs and lifts restrictions in one click, show/hide | Lifts owner-only restrictions without a password | 🟰 | branch wave2-a, browser-proved on synthetic files (internal/benchmarks/wave2-a); rival features from head-to-head notes, wave 2, 2026-10-17 |
| Rotate / flip PDF | Thumbnail grid: per-page left/right/180, select-and-turn, rotate all, reset; page range; mirror | Same grid actions; no page range, no mirror | ✅ | Synthetic six.pdf (mixed sizes/rotations) driven in our page, renders checked; rival run same file. internal/benchmarks/page-tools (drive.mjs, steps/rotate.mjs), 2026-10-19 |
| Organize pages | Drag and drop + Alt+Arrow keyboard reorder, per-page rotate, duplicate, insert blank, delete, multi-select | Drag and drop, rotate, delete | ✅ | Synthetic six.pdf, output order/rotation checked by render; internal/benchmarks/page-tools steps, 2026-10-19 |
| Sign PDF | Any page via page strip, ink colour and width, draw/type/photo with background removal, date stamps, multiple placements, undo/redo | Multi-page viewer, ink colour, photo, undo, resize, zoom | 🟰 | merged from wave2 branches, agent browser-proved + lead render check; rival features from head-to-head notes, wave 2; no fresh side-by-side, 2026-10-17 |
| Edit PDF text | Click a line to edit, old glyphs removed from the content stream (standard, TrueType, Type0, TJ kerning, rotated pages); font family, size, B/I, colour, align, add text box, undo/redo; find & replace across all pages (match case, whole word, count, next/prev, one/all); OCR for scans | Font ("Original"), size, B/I, colour, align, undo/redo; find & replace on the current page only; old text stays in the file; no OCR | ✅ | Synthetic invoice.pdf: after edit, old string gone from our extracted text but still in theirs ("Bill to: Acme Corp"); our replace-all hit page 2, theirs did not. Lead re-extracted all outputs. internal/benchmarks/wave2-d, 2026-10-19 |
| Crop / page size | Per-page or all-pages crop, 8 drag handles, margins in mm or %, untouched pages kept; page size A3/A4/A5/Letter/Legal/Tabloid + custom (mm/in/pt), fit/fill/stretch, keeps orientation, vector | Per-page crop, 4 sliders, 6 paper sizes + custom, scale to fit; their A3 forced a landscape page to portrait | ✅ | six.pdf: lead re-ran per-page crop, crop boxes exact (p1 top 40 mm, p3 left 100 mm, others untouched); 52 ms vs 189 ms. internal/benchmarks/page-tools, 2026-10-19 |
| Redact PDF | Manual boxes + automatic PII finder (11 types, checksum-validated, OCR for scans, per-item review), pixels burned out | Automatic finder: Aadhaar (no checksum), PAN, IFSC, email, bank, DOB; no cards, phones, IBAN, SSN; no OCR | ✅ | internal/benchmarks/redact head-to-head, 2026-10-17 |
| Compare PDFs | Exact line diff, flags changed lines | Synced viewers; "AI" downloads ~100 MB for a summary, no diff | ✅ | vs production; head-to-head notes, wave 2, 2026-10-17 |
| Extract text | Keeps line breaks and CJK spacing; OCR for scanned pages (language picker) and image input; copy button and preview | Collapses lines, spaces inside CJK; OCR toggle | ✅ | branch wave2-a, browser-proved on synthetic files (internal/benchmarks/wave2-a); rival features from head-to-head notes, wave 2, 2026-10-17 |
| Extract images | Original JPEG/JP2 bytes kept (byte-identical), thumbnail grid with size/format, min-size filter, select, per-image or ZIP; no-image PDFs fail in ~35 ms | Keeps originals; thumbnails, size filter, sort, per-image download | 🟰 | branch wave2-a, browser-proved on synthetic files (internal/benchmarks/wave2-a); rival features from head-to-head notes, wave 2, 2026-10-17 |
| Headers and footers | {page} {pages} {date} {time} {filename}; size, colour, bold, margin, page range, skip first, live preview; text stays vector | Same tokens and options, live preview | 🟰 | branch wave2-a, browser-proved on synthetic files (internal/benchmarks/wave2-a); rival features from head-to-head notes, wave 2, 2026-10-17 |
| Page numbers / Bates | Formats, ranges, Bates (prefix, suffix, digits, positions, across files, skip first page, page range, live preview, production log CSV) | Page numbers; Bates without page range | ✅ | Same Bates output across 2 files; Bates 358 ms vs 402 ms on 300 pages. internal/benchmarks/pdf-tools/h2h.mjs, 2026-10-17 |
| Watermark | Opacity, size, angle, colour, single or tiled, page range, live preview; text stays selectable | Opacity, size, angle, colour, tiling, live preview | 🟰 | Feature parity; page range is ours only. head-to-head notes 2026-10-17 + lead check, 2026-10-17 |
| Pages per sheet (N-up) | 2/4/6/9/16/custom, A4/Letter/Legal/A3, orientation, margin, gap, border, fill order; pages stay vector | 2/4/6/9/16/custom, paper, orientation, margin, gap, border, order | 🟰 | merged from wave2 branches, agent browser-proved + lead render check; rival features from head-to-head notes, wave 2; no fresh side-by-side, 2026-10-17 |
| Invert / grayscale | Dark (optional hue keep), invert, sepia, grayscale; text-keeping mode (blend overlays, text selectable, pictures recoloured) or raster with DPI; before/after preview | Dark, invert, sepia, grayscale; text-preserving mode (pictures not recoloured); raster | 🟰 | colour.pdf: text-keeping 84 KB vs 83 KB, raster 129 KB vs 136 KB; ours recolours pictures, dark+hue keep is 3x larger and red text turns cyan in plain dark. internal/benchmarks/page-tools, 2026-10-19 |
| Flatten PDF | Form flatten; full raster flatten 96–400 DPI; strip annotations, forms, metadata, JavaScript, attachments (also without rasterising) | Standard (keeps metadata), full raster, strip + flatten (rasterises) | ✅ | form.pdf: form flatten 3.3 KB, text kept, 0 fields; raster 8 KB @96, 38 KB @300 vs their full 18.7 KB. internal/benchmarks/page-tools, 2026-10-19 |
| OCR PDF | Tesseract 7, 11 languages, skips pages that already have text, .txt output | Tesseract 5, ~22 languages, auto-detect, page range | 🟰 | 42/42 words both, ~2.4 s vs 2.6 s. head-to-head, synthetic files, head-to-head notes 2026-10-17, 2026-10-17 |
| Metadata | Edit all Info fields, dates, custom keys and XMP (kept in step), Copy from another PDF, Revert; Strip wipes custom keys, dates and XMP | Edit Info fields and dates; custom keys hidden; leaves stale XMP | ✅ | internal/benchmarks/pdf-tools h2h metadata-xmp, 2026-10-17 |
| Word to PDF | Follows the docx: theme fonts (Calibri→Carlito, Cambria→Caladea), heading colours, spacing, table width/grid/shading, image size; lists, links, page breaks; selectable text; ~0.07 s | Same fidelity on the test file, selectable text; ~0.8 s; smaller files | 🟰 | Same synthetic docx rendered side by side: same line breaks, colours, table and image. Ours faster, theirs smaller (108 KB vs 226 KB, we embed fonts whole). Lead check, 2026-10-17 |
| Excel to PDF | All or chosen sheets, sheet titles, number formats right-aligned, repeated header row, fit to width, orientation, footer; text selectable | All sheets, picker, titles, numbers aligned | 🟰 | merged from wave2 branches, agent browser-proved + lead render check; rival features from head-to-head notes, wave 2; no fresh side-by-side, 2026-10-17 |
| PowerPoint to PDF | One page per slide at slide size: master/layout placeholders, shapes (rect, round rect, ellipse, line), fills, outlines, backgrounds, pictures, tables, bullets, bold/italic/colour/alignment; text selectable; hidden-slides option | Hi-Fi raster (text not selectable) or Vector mode, grid preview | ✅ | Synthetic 3-slide deck: ours 54 KB, 159 ms, all text selectable, all shapes/picture/master title drawn; their preview dropped the master title and bullets and showed the picture as a grey box. internal/benchmarks/wave2-b (prove.mjs, rival.mjs), 2026-10-19 |
| Markdown to PDF | Real GFM rendering, TOC, numbered headings, typeface, size, margins, line spacing, LaTeX math ($, $$, \\(, \\[) as vector paths (MathJax SVG); "$5" stays text | Same plus live editor and per-side margins; KaTeX-style math | 🟰 | Synthetic math.md: ours 23 KB, 1 page, 257 ms, math rendered; their preview typesets the same equations. Ours vector from a file, theirs has a live editor. internal/benchmarks/wave2-b, 2026-10-19 |
| CSV to PDF | Repeated header row, title, orientation/paper, auto widths, zebra rows; in-page preview with sort (numeric-aware), search, hide columns; PDF prints the view | Repeated header, title, in-page sort and cell edit, bulk/folder | 🟰 | Synthetic people.csv filtered+sorted: 15 rows in order, 5.4 KB. We have search/column hiding, they have cell edit and bulk. internal/benchmarks/wave2-b, 2026-10-19 |
| HTML to PDF | Inline and <style> CSS (colour, background, borders, fonts, alignment), lists, tables, data images, A4/Letter/Legal/A3, orientation; text selectable | Full CSS as a raster (text not selectable), page size, orientation | 🟰 | merged from wave2 branches, agent browser-proved + lead render check; rival features from head-to-head notes, wave 2; no fresh side-by-side, 2026-10-17 (ours selectable, theirs keeps more CSS) |
| Scan to PDF (camera) | Camera or photo upload; auto-detected corners with drag handles, perspective fix, edge trim; filters (original, document, grayscale, B&W, photo), brightness/contrast, turn, reorder/delete; page size; searchable OCR text layer (on by default) | Corner crop, filters, brightness/contrast, OCR text layer (20 languages) | ✅ | 2 synthetic perspective photos, defaults: ours corners found and page straight, theirs no crop (tilted page on background); Document 246 KB vs 355 KB, B&W 8.9 KB vs 310 KB; our OCR text clean, theirs mangled; 0.25 s (5 s with OCR) vs ~7 s. Lead checked renders. internal/benchmarks/scan, 2026-10-19 |
| Ask / chat with PDF | Multi-turn chat, up to 10 PDFs, page-marked text, our server (no key) or own Gemini key from the browser (key stored only if ticked); honest copy | BYO Gemini key, multi-turn, up to 10 PDFs | 🟰 | Feature parity; ours adds a no-key path. Network mocked in tests, no live side-by-side (no key). internal/benchmarks/ask, 2026-10-19 |

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
- Reverse engineering: REA (`npx rea-agents@latest`, Node 24) against an isolated Chrome profile; method notes in `internal/notes/pdf-to-word/rea-findings.md`.
- Use synthetic test files only, never personal documents.

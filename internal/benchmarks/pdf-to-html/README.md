# PDF to HTML: proof and head-to-head (2026-10-21)

Synthetic files only: the 20-document realistic corpus from `../pdf-to-word/realistic/corpus` (invented text, ground truth in `*.truth.json`) and five pdf-lib / Chrome fixtures made by `gen.ts` and `gen-mini.mjs` (`fx/`, ground truth read with pdf.js plus hand-written structure for `sample`).

```
bun run build && bunx next start --port 43160
node internal/benchmarks/pdf-to-html/run.mjs                     # corpus: ours (3 layouts) + ihatepdf.cv (Semantic, Positioned) -> results/<side>/<doc>.html
node internal/benchmarks/pdf-to-html/run.mjs --fx                # same for fx/ -> results-fx/
node internal/benchmarks/pdf-to-html/extract.mjs [--fx]          # open every .html in Chrome: lines, headings, lists, tables, links, images, selection, page screenshots
bun internal/benchmarks/pdf-to-html/score.ts [--fx]              # -> results[-fx]/scoreboard.md (needs swiftc once, for PDFKit page renders)
bun internal/benchmarks/pdf-to-html/compare.ts <doc> <side> <page> out.png [--fx]   # PDF render | converted page, side by side
bun internal/benchmarks/pdf-to-html/direct.ts in.pdf exact out.html                 # convert in bun without the app (pictures are placeholders)
```

Our page is driven through the real UI (`Convert to HTML`, `Download HTML page`); their page through `Export N pages as HTML`. All their include toggles (Links, Tables, Images, Forms, Background, Responsive) are on by default and were left on. The run asserts **0 POST/PUT requests** from our page (`results/posts.txt`).

## Metrics

- text: 1 - character error rate over the sorted words (character F1 for CJK and RTL); ignores order and line splits
- order: LCS of the word sequence over the words both share
- headings: F1 of truth headings found as `h1`-`h6` with the same text (levelOK: same level too)
- tables: share of truth cells found as cells of one real `<table>`
- lists: share of truth list items found inside real `ul`/`ol`
- visual: page screenshot (Chrome, 100% zoom) vs the PDF rendered by PDFKit, SSIM of blurred ink maps (same measure as the PDF to Word benchmark). Only for the page-layout outputs.
- A document that failed to convert scores 0 on every metric it has truth for.

## Results

Realistic corpus (20 documents). Their tool ended with `Extraction failed: Cannot read properties of null (reading '0')` on 16 Chrome-made documents (both modes, repeated on a second run); it converted `annotations`, `memo-pdflib` and `scanned-letter` (empty text, no OCR).

| side | converted | text | headings | tables | lists | links | visual |
|---|---|---|---|---|---|---|---|
| ours flowing | 20/20 | 0.99 | 0.87 | 1.00 | 0.89 | 1.00 | - |
| ours exact | 20/20 | 0.99 | - | 0.92 | - | 1.00 | 0.83 |
| ours picture + text layer | 20/20 | 0.99 | - | 0.92 | - | 1.00 | 0.98 |
| ihatepdf.cv Semantic | 3/20 | 0.10 | 0.12 | 0.00 | 0.17 | 0.00 | - |
| ihatepdf.cv Positioned | 3/20 | 0.10 | 0.00 | 0.00 | 0.00 | 0.00 | 0.09 |

Documents both sides converted (3 corpus + 5 fixtures = 8; their weakest case, so this is the fairest comparison):

| side | text | order | headings | tables | lists | visual |
|---|---|---|---|---|---|---|
| ours flowing | 0.99 | 1.00 | 1.00 | 1.00 | 1.00 | - |
| ours exact | 0.99 | 1.00 | - | 1.00 | - | 0.89 |
| ours picture | 0.99 | 1.00 | - | 1.00 | - | 0.99 |
| ihatepdf.cv Semantic | 0.86 | 0.88 | 0.89 | 0.00 | 1.00 | - |
| ihatepdf.cv Positioned | 0.86 | 0.88 | - | 0.00 | - | 0.63 |

What their output lacked on `fx/sample.pdf` (heading, two paragraphs, bullets, numbered list, ruled table, picture, second page): no `<table>` (cells flattened into one paragraph), the numbered list written as bullets, the picture dropped, the second page's text wrapped in `<sup>`, `<title>Converted PDF</title>`, a 4-column layout forced on a one-column page.

## Known limits

- Exact layout uses the PDF's font names, so text can wrap or measure a little differently when the font is missing on the reader's machine (the visual score is lower on `newsletter`, `research-paper`, `cv`).
- AcroForm widgets are not part of the page content, so form boxes and checkboxes are not drawn (`gov-form-acro` visual 0.5), the same as in PDF to Word.
- Reflow does not rebuild multi-column page layouts; text keeps reading order.
- Checked in Chrome only. Safari/WebKit is not installed here, so Safari rendering is untested; the markup is plain HTML and CSS (`zoom` in the page-fit script is supported by Safari and current Firefox).
- Their timing was not compared: their page needs a fixed 1.5 s wait between steps, so wall-clock numbers would mislead. Ours: 0.1-0.2 s per document for text PDFs, 1.8 s for the 2-page scan with OCR.

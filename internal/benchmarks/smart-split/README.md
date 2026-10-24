# Smart split ("Find documents" in Split PDF) benchmark

Synthetic files only: bundles stapled from the shared corpus (`../pdf-to-word/realistic/corpus/`) plus three
generated invoices from one supplier, each with a scanned twin (150 dpi JPEG pages, no text layer, rendered
with PDFKit by `render-jpg.swift`). `fx/truth.json` records where every document starts.

```
node internal/benchmarks/smart-split/gen.mjs                         # fx/: 24 bundles x typed + scanned
bun internal/benchmarks/smart-split/direct.ts [--why]                # finder on the typed bundles, from pdf.js text
node internal/benchmarks/smart-split/prove.mjs 43127                 # local build, the real page, typed + scanned (OCR)
node internal/benchmarks/smart-split/prove.mjs https://www.ihateupload.com
node internal/benchmarks/smart-split/rival-ilovepdf.mjs office-mix-scan
```

Bundle sets: `office-mix` … `assorted` (6) and `heldout-1..8` were used to tune the weights. `fresh-1..10`
were drawn after all tuning and never tuned on: they are the honest score.

## Live results, 2026-10-24 (deploy 0b17a5c)

| Set | Bundles split exactly | Cut precision | Cut recall | Wrong cuts |
|---|---|---|---|---|
| Typed (16 bundles) | 16/16 | 1.00 | 1.00 | 0 |
| Scanned, read with OCR (16) | 13/16 | 1.00 | 0.96 | 0 |
| Fresh only, typed + scanned (20) | 18/20 | 1.00 | 0.98 | 0 |

Every miss was a document start that scored just under the bar; the one checked (reports-scan, page 4) is offered
first under "Maybe also cut at". Files match the panel; no POST or PUT; a 9-page scan takes about 7 s.

Bugs found on the way: a one-line signature page on a scan was dropped as blank (now OCR decides, not ink alone);
the zip of a CJK-named part needs `ditto`, not macOS `unzip`, to extract.

## Against iLovePDF (signed out)

Split PDF → Range → **Smart** asks for a document category and a preset ("Scanned document batches" →
"Split documents by blank pages / keyword / detected title / mixed document types"), then shows
"Get AI Credits — You need 90 credits to auto split this document" and a sign-up wall on the 9-page
office-mix scan. We stopped at the wall. Their smart split needs an account, paid AI credits and an upload;
ours is free, explains each cut, and runs in the tab with no AI service.

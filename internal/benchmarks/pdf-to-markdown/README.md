# PDF to Markdown: proof and head-to-head with iLovePDF (2026-10-24)

Corpus: the 20 synthetic documents in `../pdf-to-word/realistic/corpus` (invented text, truth in `*.truth.json`).
Both sides' Markdown is read by the same standard GFM parser (`marked`), then scored with the PDF to HTML metrics.

```
bun internal/benchmarks/pdf-to-markdown/direct.ts               # engine only, no OCR -> out/direct/
node internal/benchmarks/pdf-to-markdown/prove.mjs 43128        # real page: 20 PDFs in one batch -> out/ours/, zip with pictures, OCR, 0 POST
node internal/benchmarks/pdf-to-markdown/rival-ilovepdf.mjs     # iLovePDF signed out -> out/ilovepdf/ (stops at the Premium wall)
bun internal/benchmarks/pdf-to-markdown/score.ts [doc,doc]      # -> out/score.md
```

| side | converted | text | order | headings | levels | tables | lists | links |
|---|---|---|---|---|---|---|---|---|
| ours (browser, 20 docs) | 20/20 | 0.99 | 1.00 | 0.87 | 0.79 | 1.00 | 0.89 | 1.00 |
| ours on the 2 docs iLovePDF converted | 2/2 | 1.00 | 1.00 | 0.83 | 0.83 | 1.00 | - | - |
| iLovePDF | 2/20 | 1.00 | 0.98 | 0.50 | 0.00 | 0.00 | - | - |

iLovePDF's PDF to Markdown worked twice signed out (invoice, annotations), then showed "Upgrade to Premium — This is a Premium feature".
We stopped there. On the invoice it wrote the whole line-item table as one cell; ours wrote a 4-column pipe table with every cell.
ihatepdf.cv has no PDF to Markdown (only Markdown to PDF), 2026-10-24.

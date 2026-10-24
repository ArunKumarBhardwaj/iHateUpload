# Summarize PDF benchmark

Synthetic files only (the shared corpus in `../pdf-to-word/realistic/corpus/`, plus a generated report).

```
node internal/benchmarks/summarize/gen-long.mjs                       # fx/annual-report-120p.pdf (~200k characters)
node internal/benchmarks/summarize/prove.mjs 43127 --stub             # local build, stand-in for /api/summarize
node internal/benchmarks/summarize/prove.mjs https://www.ihateupload.com   # live, real Gemini
node internal/benchmarks/summarize/rival-ilovepdf.mjs invoice         # iLovePDF AI Summarizer, signed out
```

## Live results, 2026-10-24 (deploy 07e03cb)

8 of 8 checks pass: 6 corpus PDFs in one batch (14 s) plus the 120-page report in Spanish, read in 2 parts
and merged. 67 page citations, all real pages. 95 of 95 figures in the summaries are in the PDFs. Only JSON text
was posted to `/api/summarize`, never the PDF.

The first live run found the merge step mixing English and Spanish and repeating facts across parts; parts now
stay in the document's language and only the merge writes the chosen language (b549f6f).

## Against iLovePDF (signed out, Medium length, Standard AI)

| Check | Ours | iLovePDF |
|---|---|---|
| Figures right on the invoice | 13 of 13 | 25 of 25 (mostly the invoice retyped: 100 words for a 99-word file) |
| Page citations | every point | none |
| Figures checked against the PDF | yes, missing ones marked ⚠ | no |
| Summary language | the PDF's own or 24 others | the website's language only |
| Contract with no fee amounts | leaves fees out | says amounts "not disclosed" and adds advice |
| Paywall | none | Standard AI free (2 runs seen); Advanced AI Premium |

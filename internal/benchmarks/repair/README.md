# Repair PDF — proof and head-to-head (2026-10-20)

Synthetic damage only (`src/lib/repair/fixtures.ts`: 9 kinds, 5-page file with a marker per page).

```
bun internal/benchmarks/repair/write.ts                 # fx/<damage>.pdf + out/ours-<damage>.pdf
bunx next build && bunx next start --port 43127
node internal/benchmarks/repair/prove.mjs 43127         # all 9 as one batch on the real page
node internal/benchmarks/repair/rival.mjs               # ihatepdf.cv/repair-pdf → out/rival-<damage>.pdf
bun internal/benchmarks/repair/score.ts                 # pdf.js readable pages + markers, strict pdf-lib
swift internal/benchmarks/repair/pdfkit-check.swift internal/benchmarks/repair/out/*.pdf   # Preview's engine
```

| damage | can recover | ours | ihatepdf.cv |
|---|---|---|---|
| xref-offsets | 5 | 5 | 5 |
| no-xref | 5 | 5 | 5 |
| truncated | 3 | 3 (3 pages, all readable) | 3 (5 pages: 1 blank, 1 unreadable) |
| junk-header | 5 | 5 | 5 |
| bad-length | 5 | 5 | 5 |
| xref-stream | 5 | 5 | 5, strict parse fails |
| missing-eof | 5 | 5 | 5 |
| zeroed-block | 4 | 4 (report names page 3) | 4 |
| no-catalog | 5 | 5 | no file |

PDFKit opens 4 of 9 damaged originals and all 9 of our outputs.

# Compress PDF bench

Synthetic corpus, our engine at each level, and Ghostscript 10 (`/printer`, `/ebook`, `/screen`,
the engine behind many online compressors) plus qpdf (lossless rewrite) as references.

```sh
python3 internal/benchmarks/compress/make-images.py   # photos, report, colour/grey scans, bloated (needs numpy, Pillow, pikepdf)
bun internal/benchmarks/compress/make-merged.ts       # merged (12 whole-font letters), trimmed (pdf-lib deleted pages)
bun internal/benchmarks/compress/run-ours.ts          # writes out/*.ours-{light,medium,heavy}.pdf
python3 internal/benchmarks/compress/score.py --rivals > internal/benchmarks/compress/RESULTS.md
```

Quality is the worst page's luma PSNR at 100 dpi against the original (poppler render); "text
kept" compares pdftotext word counts. Scans score low for everyone because the reference
includes scanner noise. The corpus and outputs are git-ignored; RESULTS.md is the last run.

# PDF to PowerPoint — proof and head-to-head (2026-10-20)

Synthetic fixtures only (`gen.ts`: 4-slide deck with title band, bullets + picture, vector bar chart, table; plus the PDF to Word sample report).

```
bun internal/benchmarks/pdf-to-pptx/gen.ts
bunx next build && bunx next start --port 43127
node internal/benchmarks/pdf-to-pptx/prove.mjs 43127     # our page: editable, picture, 16:9, page range
node internal/benchmarks/pdf-to-pptx/rival.mjs           # ihatepdf.cv/pdf-to-pptx: Fully Editable + Smart Hybrid
bun internal/benchmarks/pdf-to-pptx/check.ts             # LibreOffice → PDF → text read-back (needs soffice; run outside the sandbox)
swift internal/benchmarks/pdf-to-pptx/render-pages.swift out/lo/<file>.pdf out/sheet.png
bun internal/benchmarks/pdf-to-pptx/direct.ts            # quick conversion in bun without a browser
```

| deck.pdf in LibreOffice | ours (editable) | ihatepdf.cv Fully Editable | ihatepdf.cv Smart Hybrid |
|---|---|---|---|
| text read back | 11/11 | 11/11 | 0/11 (text at 0% opacity over a JPEG) |
| picture | kept | lost | baked into the page JPEG |
| bar chart | 8 native shapes | bars lost, labels run together | baked into the page JPEG |
| table | real 4×5 table | flattened into centred lines | baked into the page JPEG |
| slide size | matches the page | 16:9 forced | 16:9 forced |

Not tested: Microsoft PowerPoint (not installed). Apple Quick Look renders our files but ignores list `startAt` and `wrap="none"`; LibreOffice honours both.

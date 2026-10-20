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

## Keynote and PowerPoint (2026-10-20)

- Keynote 15.4 (`keynote-export.applescript`): all 4 outputs open and export; text complete; renders match the PDFs, including the "1. / 2." list and a centred 16:9 page.
- Microsoft PowerPoint 16.114 (`powerpoint-export.applescript`, `powerpoint-read.applescript`): opens all 4 without a repair prompt; its own PDF export keeps every word and all 20 table cells and looks like the PDFs. Saving as PDF works only after its first-launch screen is dismissed.

## Google Slides (2026-10-20)

Uploaded through the person's own Drive (synthetic files only, trashed afterwards). Slides 1, 2 and 4 of the deck and the report matched; slide 3's axis labels, one line laid out with tab stops, were bunched under the wrong bars because Google Slides ignores custom tab stops. Fix: a one-line tabbed paragraph is written as one text box per tab stop. Rechecked in Google Slides, LibreOffice and Keynote: labels under their bars in all three.

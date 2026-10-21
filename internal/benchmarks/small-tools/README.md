# Alternate & mix pages, PDF to ZIP

Synthetic fixtures only (`gen.ts`): `fronts.pdf` (F1-F4), `backs.pdf` (B4-B1, scanned in reverse), `short.pdf` (S1-S2). Every page carries its label as text, so order is checked by extracting text per output page (`pagetext.mjs`, pdf.js).

```
bun internal/benchmarks/small-tools/gen.ts
bunx next build && bunx next start --port 43162 &
node internal/benchmarks/small-tools/explore.mjs alternate-mix-pdf pdf-to-zip   # their options
node internal/benchmarks/small-tools/prove-mix.mjs 43162                        # ours, production build
node internal/benchmarks/small-tools/rival-mix.mjs                              # theirs, same files
```

## Alternate & mix (their page: /alternate-mix-pdf)

Their options: 2+ files labelled A, B, C; move up/down; per-file Reverse; live "Resulting order" preview; one page per turn only; longer file's rest is appended.

| Case | Ours | Theirs |
|---|---|---|
| Duplex (backs reversed) | F1 B1 F2 B2 F3 B3 F4 B4 | same |
| Unequal (4 + 2) | F1 S1 F2 S2 F3 F4 | same |
| Three files | F1 B4 S1 F2 B3 S2 F3 B2 F4 B1 | same |
| 2 per turn | F1 F2 S1 F3 F4 S2 | not offered |
| Stop at shortest | F1 S1 F2 S2 | not offered |

Ours: 14/14 checks, 0 POST/PUT, no page errors (each run ~60 ms). Theirs: ~110-190 ms.

## PDF to ZIP (their page: /pdf-to-zip)

Their options: add PDFs, reorder, per-file rename and delete, ZIP name, 4 compression levels (store, fast, balanced, max), wrap in a subfolder. No page splitting.

```
node internal/benchmarks/small-tools/prove-zip.mjs 43162   # ours
node internal/benchmarks/small-tools/rival-zip.mjs         # theirs
```

| Case | Ours | Theirs |
|---|---|---|
| 3 whole PDFs | 3 entries, byte-identical to the inputs, ~90 ms | 3 entries at the top level, ~77 ms |
| One PDF per page | 10 real PDFs, each with the right page text, named `{name}_p{part}` in a folder (Max compression) | not offered |
| Every 3 pages, folder per file, `{name} {from}-{to}` | `fronts/fronts 1-3.pdf`, `fronts/fronts 4-4.pdf`, ... | not offered |
| Name pattern, duplicate-name handling | yes | rename per file by hand |

Ours: 10/10 checks, 0 POST/PUT, no page errors.

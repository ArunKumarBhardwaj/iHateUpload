"""Size and quality of every compressor on the corpus.

Rivals: Ghostscript (/printer, /ebook, /screen, the engine behind many online compressors) and qpdf
(lossless rewrite). Quality: luma PSNR of each page rendered at 100 dpi against the original, the
worst page counted; text: pdftotext word count kept. Usage, after run-ours.ts:
  python3 internal/benchmarks/compress/score.py [--rivals]
"""
import glob
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS, OUT = os.path.join(HERE, "corpus"), os.path.join(HERE, "out")


def rivals(src):
    stem = os.path.splitext(os.path.basename(src))[0]
    for preset in ("printer", "ebook", "screen"):
        dst = os.path.join(OUT, f"{stem}.gs-{preset}.pdf")
        if not os.path.exists(dst):
            subprocess.run(["gs", "-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5",
                            f"-dPDFSETTINGS=/{preset}", "-dDetectDuplicateImages=true", f"-sOutputFile={dst}", src], check=True)
    dst = os.path.join(OUT, f"{stem}.qpdf.pdf")
    if not os.path.exists(dst):
        subprocess.run(["qpdf", "--object-streams=generate", "--recompress-flate", "--compression-level=9", src, dst])


def render(pdf, tmp, tag):
    prefix = os.path.join(tmp, tag)
    subprocess.run(["pdftoppm", "-r", "100", "-gray", pdf, prefix], check=True, capture_output=True)
    return [np.asarray(Image.open(p), np.float32) for p in sorted(glob.glob(prefix + "*.pgm"))]


def words(pdf):
    r = subprocess.run(["pdftotext", pdf, "-"], capture_output=True, text=True)
    return len(r.stdout.split())


def psnr(a, b):
    if a.shape != b.shape:
        h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
        a, b = a[:h, :w], b[:h, :w]
    mse = float(np.mean((a - b) ** 2))
    return 99.0 if mse == 0 else 10 * np.log10(255 * 255 / mse)


def main():
    timings = json.load(open(os.path.join(OUT, "timings.json"))) if os.path.exists(os.path.join(OUT, "timings.json")) else {}
    rows = []
    for src in sorted(glob.glob(os.path.join(CORPUS, "*.pdf"))):
        stem = os.path.splitext(os.path.basename(src))[0]
        if "--rivals" in sys.argv:
            rivals(src)
        with tempfile.TemporaryDirectory() as tmp:
            ref = render(src, tmp, "ref")
            ref_words = words(src)
            size0 = os.path.getsize(src)
            for out in sorted(glob.glob(os.path.join(OUT, f"{stem}.*.pdf"))):
                tool = out[len(os.path.join(OUT, stem)) + 1:-4]
                pages = render(out, tmp, tool.replace("-", "_"))
                q = min(psnr(a, b) for a, b in zip(ref, pages)) if len(pages) == len(ref) else 0
                w = words(out)
                rows.append((stem, tool, size0, os.path.getsize(out), q, w == ref_words, timings.get(os.path.basename(out))))
    print(f"| file | tool | size | % of original | worst-page PSNR dB | text kept | ms |")
    print("|---|---|---:|---:|---:|---|---:|")
    for stem, tool, s0, s, q, ok, ms in rows:
        print(f"| {stem} | {tool} | {s:,} | {100 * s / s0:.1f}% | {q:.1f} | {'yes' if ok else 'NO'} | {ms or ''} |")
    json.dump(rows, open(os.path.join(OUT, "scores.json"), "w"))


main()

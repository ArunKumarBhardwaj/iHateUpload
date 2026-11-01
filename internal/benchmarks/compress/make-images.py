"""Synthetic images and PDFs for the compression bench. Nothing here is a real person's file.

Writes into internal/benchmarks/compress/corpus:
  photos.pdf       4 pages, two 3000x2000 camera-style JPEGs each (q92, with EXIF-like APP data), drawn small
  report.pdf       text pages with charts and screenshots stored as raw Flate RGB (no predictor), as many exporters do
  colour-scan.pdf  3 A4 pages scanned at 300 dpi in colour: black text, blue signature, red stamp, paper tint, noise
  grey-scan.pdf    3 A4 pages scanned at 300 dpi in grey (JPEG), the most common "scan to PDF"
  bloated.pdf      one photo page plus page thumbnails, Illustrator-style PieceInfo, a 40 KB XMP packet, raw content
Usage: python3 internal/benchmarks/compress/make-images.py
"""
import io
import math
import os
import random
import zlib

import numpy as np
import pikepdf
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "corpus")
os.makedirs(OUT, exist_ok=True)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def value_noise(w, h, rng, octaves=6):
    out = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        cw, ch = max(2, w >> (octaves - o)), max(2, h >> (octaves - o))
        small = Image.fromarray((rng.random((ch, cw)) * 255).astype(np.uint8))
        out += np.asarray(small.resize((w, h), Image.BICUBIC), np.float32) * amp
        total += amp
        amp *= 0.55
    return out / total


def photo(w, h, seed):
    """A landscape-ish photo: sky gradient, noisy hills, texture, grain."""
    rng = np.random.default_rng(seed)
    y = np.linspace(0, 1, h)[:, None]
    sky = np.stack([120 + 80 * y, 160 + 60 * y, 230 - 40 * y], -1) * np.ones((1, w, 1))
    n = value_noise(w, h, rng)
    hills = (n / 255.0)
    horizon = 0.45 + 0.15 * np.sin(np.linspace(0, 6, w))[None, :] + (hills - 0.5) * 0.25
    ground = y > horizon
    tex = value_noise(w, h, rng, 8)[..., None] / 255.0
    land = np.stack([60 + 90 * tex[..., 0], 110 + 70 * tex[..., 0], 40 + 50 * tex[..., 0]], -1)
    img = np.where(ground[..., None], land, sky)
    img += rng.normal(0, 4, img.shape)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def jpeg(img, q, exif_pad=0):
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=q, subsampling=0 if q >= 90 else 2)
    data = buf.getvalue()
    if exif_pad:
        # A camera-style APP1 block (maker notes, embedded preview) right after SOI.
        payload = b"Exif\x00\x00" + bytes(random.Random(1).getrandbits(8) for _ in range(exif_pad))
        app1 = b"\xff\xe1" + (len(payload) + 2).to_bytes(2, "big") + payload
        data = data[:2] + app1 + data[2:]
    return data


def chart(w, h, seed):
    rnd = random.Random(seed)
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, h // 30)
    for k in range(6):
        y = h - 80 - k * (h - 160) // 5
        d.line([(80, y), (w - 40, y)], fill=(225, 225, 225), width=2)
        d.text((10, y - 12), f"{k * 20}", font=f, fill=(90, 90, 90))
    colors = [(66, 133, 244), (219, 68, 55), (244, 180, 0), (15, 157, 88)]
    bars = 12
    bw = (w - 160) // bars
    for i in range(bars):
        v = rnd.uniform(0.2, 0.95)
        x = 100 + i * bw
        d.rectangle([x, h - 80 - v * (h - 160), x + bw * 0.7, h - 80], fill=colors[i % 4])
        d.text((x, h - 60), f"Q{i % 4 + 1}", font=f, fill=(60, 60, 60))
    d.text((w // 3, 20), "Quarterly revenue by region", font=ImageFont.truetype(FONT_B, h // 22), fill=(30, 30, 30))
    return img


def screenshot(w, h, seed):
    rnd = random.Random(seed)
    img = Image.new("RGB", (w, h), (246, 247, 249))
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, 22)
    d.rectangle([0, 0, w, 60], fill=(32, 41, 64))
    d.text((24, 16), "Dashboard  ·  Orders  ·  Customers  ·  Reports", font=f, fill="white")
    d.rectangle([0, 60, 260, h], fill=(255, 255, 255))
    for i in range(14):
        d.text((24, 90 + i * 44), f"Menu item {i + 1}", font=f, fill=(70, 70, 90))
    for r in range(16):
        y = 100 + r * 50
        d.rectangle([300, y, w - 40, y + 44], fill=(255, 255, 255) if r % 2 else (250, 251, 253))
        for c in range(5):
            d.text((320 + c * 260, y + 10), f"{rnd.randint(1000, 99999)}", font=f, fill=(40, 40, 40))
    return img


LOREM = (
    "This agreement is made between the parties named below. The tenant agrees to pay the monthly rent on or before "
    "the fifth day of each month. Any repairs above five thousand rupees need written approval from the owner. "
    "The deposit will be returned within thirty days of the end of the lease, less any agreed deductions. "
).split()


def scan_page(seed, color=True):
    """An A4 page at 300 dpi as a flatbed scanner would give it."""
    rnd = random.Random(seed)
    w, h = 2480, 3508
    img = Image.new("RGB", (w, h), (255, 255, 255))
    d = ImageDraw.Draw(img)
    title = ImageFont.truetype(FONT_B, 62)
    body = ImageFont.truetype(FONT, 40)
    d.text((220, 260), "RENTAL AGREEMENT", font=title, fill=(15, 15, 15))
    y = 420
    while y < 2700:
        line, x = [], 220
        while True:
            word = rnd.choice(LOREM)
            wlen = d.textlength(word + " ", font=body)
            if x + wlen > w - 220:
                break
            line.append(word)
            x += wlen
        d.text((220, y), " ".join(line), font=body, fill=(20, 20, 20))
        y += 64 if rnd.random() > 0.1 else 120
    if color:
        # Blue ink signature and a red rubber stamp.
        pts = [(1500 + t * 6, 2950 + 60 * math.sin(t / 9) + 25 * math.sin(t / 3)) for t in range(110)]
        d.line(pts, fill=(25, 45, 160), width=7)
        d.ellipse([400, 2850, 760, 3210], outline=(200, 30, 40), width=10)
        d.text((455, 3000), "APPROVED", font=ImageFont.truetype(FONT_B, 48), fill=(200, 30, 40))
    arr = np.asarray(img, np.float32)
    paper = np.array([248, 244, 232] if color else [242, 242, 242], np.float32)
    arr = arr / 255.0 * paper
    rng = np.random.default_rng(seed)
    arr += rng.normal(0, 5, arr.shape[:2])[..., None]
    out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).rotate(0.25, resample=Image.BICUBIC, fillcolor=tuple(int(v) for v in paper))
    out = out.filter(ImageFilter.GaussianBlur(0.7))
    return out if color else out.convert("L")


def new_pdf():
    pdf = pikepdf.new()
    return pdf


def add_page(pdf, w_pt, h_pt, content: bytes, xobjects=None, font=True):
    resources = pikepdf.Dictionary()
    if xobjects:
        resources.XObject = pikepdf.Dictionary({f"/{k}": v for k, v in xobjects.items()})
    if font:
        resources.Font = pikepdf.Dictionary(F1=pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica))
    page = pikepdf.Dictionary(
        Type=pikepdf.Name.Page,
        MediaBox=[0, 0, w_pt, h_pt],
        Resources=resources,
        Contents=pdf.make_stream(content),
    )
    pdf.pages.append(pikepdf.Page(page))
    return pdf.pages[-1]


def jpeg_xobject(pdf, data, w, h, gray=False):
    s = pikepdf.Stream(pdf, data)
    s.Type, s.Subtype = pikepdf.Name.XObject, pikepdf.Name.Image
    s.Width, s.Height, s.BitsPerComponent = w, h, 8
    s.ColorSpace = pikepdf.Name.DeviceGray if gray else pikepdf.Name.DeviceRGB
    s.Filter = pikepdf.Name.DCTDecode
    return s


def flate_xobject(pdf, img):
    raw = img.convert("RGB").tobytes()
    s = pikepdf.Stream(pdf, zlib.compress(raw, 6))
    s.Type, s.Subtype = pikepdf.Name.XObject, pikepdf.Name.Image
    s.Width, s.Height, s.BitsPerComponent = img.width, img.height, 8
    s.ColorSpace = pikepdf.Name.DeviceRGB
    s.Filter = pikepdf.Name.FlateDecode
    return s


def text_ops(lines, x=56, y=780, size=10, lead=14):
    ops = [b"BT", f"/F1 {size} Tf {x} {y} Td {lead} TL".encode()]
    for l in lines:
        ops.append(f"({l}) '".encode())
    ops.append(b"ET")
    return b"\n".join(ops)


def save(pdf, name, **kw):
    path = os.path.join(OUT, name)
    pdf.save(path, compress_streams=kw.get("compress", True), object_stream_mode=pikepdf.ObjectStreamMode.disable)
    print(f"{name:18} {os.path.getsize(path):>10,} bytes")


def paragraph(seed, n=40):
    rnd = random.Random(seed)
    return [" ".join(rnd.choice(LOREM) for _ in range(12)) for _ in range(n)]


# photos.pdf
pdf = new_pdf()
for p in range(4):
    xo = {}
    ops = [text_ops([f"Site visit, photo sheet {p + 1}"], y=800, size=14)]
    for k in range(2):
        img = photo(3000, 2000, p * 10 + k)
        xo[f"Im{k}"] = jpeg_xobject(pdf, jpeg(img, 92, exif_pad=30000), 3000, 2000)
        ops.append(f"q 400 0 0 267 98 {440 - k * 330} cm /Im{k} Do Q".encode())
    add_page(pdf, 595, 842, b"\n".join(ops), xo)
save(pdf, "photos.pdf")

# report.pdf
pdf = new_pdf()
for p in range(5):
    xo = {}
    ops = [text_ops(paragraph(p, 18), y=800)]
    if p % 2 == 0:
        xo["Ch"] = flate_xobject(pdf, chart(1800, 1100, p))
        ops.append(b"q 480 0 0 293 56 220 cm /Ch Do Q")
    else:
        xo["Sc"] = flate_xobject(pdf, screenshot(1920, 1080, p))
        ops.append(b"q 480 0 0 270 56 230 cm /Sc Do Q")
    add_page(pdf, 595, 842, b"\n".join(ops), xo)
save(pdf, "report.pdf")

# colour-scan.pdf and grey-scan.pdf
for name, color in (("colour-scan.pdf", True), ("grey-scan.pdf", False)):
    pdf = new_pdf()
    for p in range(3):
        img = scan_page(100 + p, color)
        xo = {"Scan": jpeg_xobject(pdf, jpeg(img, 88), img.width, img.height, gray=not color)}
        add_page(pdf, 595.28, 841.89, b"q 595.28 0 0 841.89 0 0 cm /Scan Do Q", xo, font=False)
    save(pdf, name)

# bloated.pdf: what design and office apps leave behind
pdf = new_pdf()
img = photo(2400, 1600, 77)
xo = {"Im0": jpeg_xobject(pdf, jpeg(img, 95, exif_pad=60000), 2400, 1600)}
content = text_ops(paragraph(9, 30), y=800) + b"\nq 480 0 0 320 56 200 cm /Im0 Do Q\n"
page = add_page(pdf, 595, 842, content, xo)
thumb = img.resize((106, 150))
page.obj.Thumb = jpeg_xobject(pdf, jpeg(thumb, 90), 106, 150)
private = pikepdf.Stream(pdf, bytes(random.Random(5).getrandbits(8) for _ in range(250_000)))
page.obj.PieceInfo = pikepdf.Dictionary(Illustrator=pikepdf.Dictionary(LastModified=pikepdf.String("D:20260101"), Private=pikepdf.Dictionary(AIMetaData=private)))
xmp = ('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">' + " " * 40000 + "</x:xmpmeta><?xpacket end=\"w\"?>").encode()
pdf.Root.Metadata = pikepdf.Stream(pdf, xmp)
pdf.Root.Metadata.Type = pikepdf.Name.Metadata
pdf.Root.Metadata.Subtype = pikepdf.Name.XML
save(pdf, "bloated.pdf", compress=False)

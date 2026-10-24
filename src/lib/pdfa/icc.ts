/**
 * ICC v2 profiles written from scratch, so PDF/A output needs no profile file:
 * sRGB for the output intent, and a plain CMYK one that maps DeviceCMYK the
 * way browsers draw it, for DefaultCMYK: pdf.js's fit of a US Web Coated
 * (SWOP) press, so archived flyers keep the colours people saw on screen.
 */

const D50 = [0.9642, 1, 0.8249] as const;
// sRGB primaries adapted to D50 (Bradford), the columns of the RGB -> XYZ matrix.
const RED = [0.4361, 0.2225, 0.0139] as const;
const GREEN = [0.3851, 0.7169, 0.0971] as const;
const BLUE = [0.1431, 0.0606, 0.7141] as const;

class Writer {
  bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 0xff);
  }
  u16(v: number) {
    this.u8(v >> 8);
    this.u8(v);
  }
  u32(v: number) {
    this.u16(v >>> 16);
    this.u16(v & 0xffff);
  }
  s15(v: number) {
    this.u32(Math.round(v * 65536) >>> 0);
  }
  ascii(s: string) {
    for (const c of s) this.u8(c.charCodeAt(0));
  }
  pad() {
    while (this.bytes.length % 4) this.u8(0);
  }
}

function tag(fill: (w: Writer) => void): number[] {
  const w = new Writer();
  fill(w);
  w.pad();
  return w.bytes;
}

const desc = (text: string) =>
  tag((w) => {
    w.ascii("desc");
    w.u32(0);
    w.u32(text.length + 1);
    w.ascii(text);
    w.u8(0);
    w.u32(0); // Unicode language
    w.u32(0); // Unicode count
    w.u16(0); // ScriptCode code
    w.u8(0); // ScriptCode count
    for (let i = 0; i < 67; i++) w.u8(0);
  });

const textTag = (text: string) =>
  tag((w) => {
    w.ascii("text");
    w.u32(0);
    w.ascii(text);
    w.u8(0);
  });

const xyz = (v: readonly number[]) =>
  tag((w) => {
    w.ascii("XYZ ");
    w.u32(0);
    v.forEach((n) => w.s15(n));
  });

const srgbDecode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const srgbEncode = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp = (v: number) => Math.min(1, Math.max(0, v));

const curve = tag((w) => {
  w.ascii("curv");
  w.u32(0);
  w.u32(256);
  for (let i = 0; i < 256; i++) w.u16(Math.round(srgbDecode(i / 255) * 65535));
});

function build(
  deviceClass: string,
  space: string,
  pcs: string,
  tags: [string, number[]][],
): Uint8Array {
  // Identical tag bodies (the three TRCs) are stored once.
  const offsets = new Map<number[], number>();
  let cursor = 128 + 4 + tags.length * 12;
  const body: number[] = [];
  const table: [string, number, number][] = [];
  for (const [sig, data] of tags) {
    let at = offsets.get(data);
    if (at === undefined) {
      at = cursor;
      offsets.set(data, at);
      body.push(...data);
      cursor += data.length;
    }
    table.push([sig, at, data.length]);
  }
  const w = new Writer();
  w.u32(cursor);
  w.u32(0); // CMM
  w.u32(0x02100000);
  w.ascii(deviceClass);
  w.ascii(space);
  w.ascii(pcs);
  [2026, 1, 1, 0, 0, 0].forEach((n) => w.u16(n));
  w.ascii("acsp");
  w.u32(0); // platform
  w.u32(0); // flags
  w.u32(0); // manufacturer
  w.u32(0); // model
  w.u32(0);
  w.u32(0); // attributes
  w.u32(0); // rendering intent: perceptual
  D50.forEach((n) => w.s15(n));
  w.u32(0); // creator
  while (w.bytes.length < 128) w.u8(0);
  w.u32(tags.length);
  for (const [sig, at, size] of table) {
    w.ascii(sig);
    w.u32(at);
    w.u32(size);
  }
  return Uint8Array.from([...w.bytes, ...body]);
}

const COPYRIGHT = "No copyright, use freely";

export function srgbProfile(): Uint8Array {
  return build("mntr", "RGB ", "XYZ ", [
    ["desc", desc("sRGB IEC61966-2.1")],
    ["cprt", textTag(COPYRIGHT)],
    ["wtpt", xyz(D50)],
    ["rXYZ", xyz(RED)],
    ["gXYZ", xyz(GREEN)],
    ["bXYZ", xyz(BLUE)],
    ["rTRC", curve],
    ["gTRC", curve],
    ["bTRC", curve],
  ]);
}

// --- CMYK, through CIELAB ---------------------------------------------------

type Vec3 = [number, number, number];

function rgbToLab([r, g, b]: Vec3): Vec3 {
  const lin = [r, g, b].map(srgbDecode);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const xyzv = [0, 1, 2].map((i) => RED[i] * lin[0] + GREEN[i] * lin[1] + BLUE[i] * lin[2]);
  const [fx, fy, fz] = xyzv.map((v, i) => f(v / D50[i]));
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function invert3(m: number[][]): number[][] {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

const XYZ_TO_RGB = invert3([0, 1, 2].map((i) => [RED[i], GREEN[i], BLUE[i]]));

function labToRgb([l, a, b]: Vec3): Vec3 {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const xyzv = [fx, fy, fz].map((t, i) => inv(t) * D50[i]);
  return XYZ_TO_RGB.map((row) =>
    clamp(srgbEncode(clamp(row[0] * xyzv[0] + row[1] * xyzv[1] + row[2] * xyzv[2]))),
  ) as Vec3;
}

/** ICC v2 16-bit Lab encoding: L 0..100 -> 0..0xFF00, a/b -128..127.99 -> 0..0xFFFF. */
const encodeLab = ([l, a, b]: Vec3) => [
  Math.round(clamp(l / 100) * 0xff00),
  Math.round(Math.min(0xffff, Math.max(0, (a + 128) * 256))),
  Math.round(Math.min(0xffff, Math.max(0, (b + 128) * 256))),
];

function lut16(inputs: number, outputs: number, grid: number, cell: (x: number[]) => number[]) {
  return tag((w) => {
    w.ascii("mft2");
    w.u32(0);
    w.u8(inputs);
    w.u8(outputs);
    w.u8(grid);
    w.u8(0);
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((n) => w.s15(n));
    w.u16(2);
    w.u16(2);
    for (let i = 0; i < inputs; i++) {
      w.u16(0);
      w.u16(0xffff);
    }
    const total = grid ** inputs;
    for (let n = 0; n < total; n++) {
      const x: number[] = [];
      let rest = n;
      for (let i = inputs - 1; i >= 0; i--) {
        x[i] = (rest % grid) / (grid - 1);
        rest = Math.floor(rest / grid);
      }
      cell(x).forEach((v) => w.u16(v));
    }
    for (let i = 0; i < outputs; i++) {
      w.u16(0);
      w.u16(0xffff);
    }
  });
}

/** CMYK (0..1) to sRGB (0..1), the polynomial pdf.js uses for DeviceCMYK (Apache-2.0). */
export function cmykToRgb(c: number, m: number, y: number, k: number): Vec3 {
  const r = 255 + c * (-4.387332384609988 * c + 54.48615194189176 * m + 18.82290502165302 * y + 212.25662451639585 * k + -285.2331026137004) + m * (1.7149763477362134 * m - 5.6096736904047315 * y + -17.873870861415444 * k - 5.497006427196366) + y * (-2.5217340131683033 * y - 21.248923337353073 * k + 17.5119270841813) + k * (-21.86122147463605 * k - 189.48180835922747);
  const g = 255 + c * (8.841041422036149 * c + 60.118027045597366 * m + 6.871425592049007 * y + 31.159100130055922 * k + -79.2970844816548) + m * (-15.310361306967817 * m + 17.575251261109482 * y + 131.35250912493976 * k - 190.9453302588951) + y * (4.444339102852739 * y + 9.8632861493405 * k - 24.86741582555878) + k * (-20.737325471181034 * k - 187.80453709719578);
  const b = 255 + c * (0.8842522430003296 * c + 8.078677503112928 * m + 30.89978309703729 * y - 0.23883238689178934 * k + -14.183576799673286) + m * (10.49593273432072 * m + 63.02378494754052 * y + 50.606957656360734 * k - 112.23884253719248) + y * (0.03296041114873217 * y + 115.60384449646641 * k + -193.58209356861505) + k * (-22.33816807309886 * k - 180.12613974708367);
  return [clamp(r / 255), clamp(g / 255), clamp(b / 255)];
}

export function cmykProfile(): Uint8Array {
  const a2b = lut16(4, 3, 7, ([c, m, y, k]) => encodeLab(rgbToLab(cmykToRgb(c, m, y, k))));
  const b2a = lut16(3, 4, 17, ([l, a, b]) => {
    const [r, g, bl] = labToRgb([(l * 0xffff) / 0xff00 * 100, a * 0xffff / 256 - 128, b * 0xffff / 256 - 128]);
    const k = 1 - Math.max(r, g, bl);
    const ink = (v: number) => (k >= 1 ? 0 : (1 - v - k) / (1 - k));
    return [ink(r), ink(g), ink(bl), k].map((v) => Math.round(clamp(v) * 0xffff));
  });
  return build("spac", "CMYK", "Lab ", [
    ["desc", desc("CMYK, screen match (SWOP-like)")],
    ["cprt", textTag(COPYRIGHT)],
    ["wtpt", xyz(D50)],
    ["A2B0", a2b],
    ["B2A0", b2a],
  ]);
}

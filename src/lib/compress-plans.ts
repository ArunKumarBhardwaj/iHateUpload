// Plain data so pages can name a level without loading the engine.

/**
 * How hard one pass squeezes. dpi is the resolution an image keeps at the
 * size the page draws it. quality is where JPEG starts; it steps down while
 * the result stays above minPsnr, so smooth images cost less than detailed
 * ones. lossyFlate lets photo-like lossless images become JPEG. bilevelDpi
 * is the most resolution scanned text keeps when it is turned into 1-bit
 * JBIG2; 0 leaves grey scans alone.
 */
export type CompressPlan = {
  dpi: number;
  quality: number;
  minPsnr: number;
  lossyFlate: boolean;
  bilevelDpi: number;
  /** Letter matching in JBIG2 may swap near-identical marks; off keeps the 1-bit image exact. */
  matchLetters: boolean;
};

export const COMPRESS_PLANS = {
  light: { dpi: 220, quality: 84, minPsnr: 40, lossyFlate: false, bilevelDpi: 300, matchLetters: false },
  medium: { dpi: 150, quality: 74, minPsnr: 36, lossyFlate: true, bilevelDpi: 300, matchLetters: true },
  heavy: { dpi: 100, quality: 60, minPsnr: 32, lossyFlate: true, bilevelDpi: 150, matchLetters: true },
} satisfies Record<string, CompressPlan>;

/** Tried in order until a file fits a target size. */
export const TARGET_LADDER: CompressPlan[] = [
  COMPRESS_PLANS.light,
  COMPRESS_PLANS.medium,
  { dpi: 120, quality: 66, minPsnr: 34, lossyFlate: true, bilevelDpi: 250, matchLetters: true },
  COMPRESS_PLANS.heavy,
  { dpi: 80, quality: 50, minPsnr: 30, lossyFlate: true, bilevelDpi: 130, matchLetters: true },
  { dpi: 64, quality: 40, minPsnr: 28, lossyFlate: true, bilevelDpi: 110, matchLetters: true },
  { dpi: 50, quality: 30, minPsnr: 0, lossyFlate: true, bilevelDpi: 100, matchLetters: true },
];

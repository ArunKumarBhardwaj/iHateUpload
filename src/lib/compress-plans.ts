// Plain data so pages can name a level without loading the engine.

/**
 * How hard one pass squeezes. dpi is the resolution an image keeps at the
 * size the page draws it. quality is where JPEG starts; it steps down while
 * the result stays above minPsnr, so smooth images cost less than detailed
 * ones. lossyFlate lets photo-like lossless images become JPEG.
 */
export type CompressPlan = {
  dpi: number;
  quality: number;
  minPsnr: number;
  lossyFlate: boolean;
};

export const COMPRESS_PLANS = {
  light: { dpi: 220, quality: 84, minPsnr: 40, lossyFlate: false },
  medium: { dpi: 150, quality: 74, minPsnr: 36, lossyFlate: true },
  heavy: { dpi: 100, quality: 60, minPsnr: 32, lossyFlate: true },
} satisfies Record<string, CompressPlan>;

/** Tried in order until a file fits a target size. */
export const TARGET_LADDER: CompressPlan[] = [
  COMPRESS_PLANS.light,
  COMPRESS_PLANS.medium,
  { dpi: 120, quality: 66, minPsnr: 34, lossyFlate: true },
  COMPRESS_PLANS.heavy,
  { dpi: 80, quality: 50, minPsnr: 30, lossyFlate: true },
  { dpi: 64, quality: 40, minPsnr: 28, lossyFlate: true },
  { dpi: 50, quality: 30, minPsnr: 0, lossyFlate: true },
];

import sharp from 'sharp';

/**
 * Cleaning pictures before anyone else sees them.
 *
 * Phone photos carry hidden metadata: GPS position (often someone's home),
 * camera serial numbers, dates, sometimes the owner's name. Every picture
 * shown on BUKU is therefore decoded and RE-ENCODED from its pixels:
 *
 *  • turned the right way up first (the orientation is itself metadata),
 *  • every metadata block dropped (EXIF, XMP, IPTC, comments),
 *  • colours converted to sRGB, the profile not kept,
 *  • shrunk to the size we actually display, saved as WebP,
 *  • only the first frame of animated images.
 *
 * Re-encoding also means anything hidden in the original file (a "polyglot"
 * that is both an image and a script) does not survive. Decoding is bounded:
 * images over `MAX_INPUT_PIXELS` are refused before their pixels are decoded,
 * so a tiny file claiming to be 50,000 × 50,000 can't exhaust memory.
 */

export const MAX_INPUT_PIXELS = 40_000_000; // e.g. 8000 × 5000 — beyond any phone camera

export const IMAGE_PRESETS = {
  /** Business gallery / cover. */
  photo: { maxSide: 2048, quality: 82 },
  logo: { maxSide: 512, quality: 90 },
  /** Employee photo next to their name. */
  portrait: { maxSide: 800, quality: 85 },
  /** Customer profile picture (private). */
  avatar: { maxSide: 512, quality: 85 },
} as const;

export type ImagePreset = keyof typeof IMAGE_PRESETS;

export interface CleanImage {
  data: Buffer;
  contentType: 'image/webp';
  width: number;
  height: number;
}

export class ImageRejectedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ImageRejectedError';
  }
}

// One image at a time per process and no decoded-image cache: predictable
// memory on a small server matters more than throughput here.
sharp.concurrency(1);
sharp.cache(false);

export async function cleanImage(input: Buffer, preset: ImagePreset): Promise<CleanImage> {
  const { maxSide, quality } = IMAGE_PRESETS[preset];
  try {
    const { data, info } = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error', // truncated/corrupt files are refused, not half-decoded
      animated: false,
    })
      .rotate() // apply the EXIF orientation to the pixels
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    return { data, contentType: 'image/webp', width: info.width, height: info.height };
  } catch (err) {
    const message = (err as Error).message ?? '';
    throw new ImageRejectedError(
      /pixel limit/i.test(message)
        ? 'The image is too large (too many pixels)'
        : 'The file is not a readable image',
      { cause: err },
    );
  }
}

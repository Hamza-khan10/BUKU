import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { cleanImage, ImageRejectedError, MAX_INPUT_PIXELS } from '../src/images.js';

/** A "phone photo": 1200×800 pixels stored sideways (EXIF orientation 6), with GPS and camera data. */
async function phonePhoto(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 800, channels: 3, background: '#c0392b' } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Make: 'PhoneMaker', Model: 'Phone 15', Artist: 'Ayesha Khan' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '31/1 31/1 1200/100',
        GPSLongitudeRef: 'E',
        GPSLongitude: '74/1 21/1 3000/100',
      },
    })
    .toBuffer();
}

describe('cleaning pictures', () => {
  it('removes GPS and camera metadata and re-encodes as WebP', async () => {
    const original = await phonePhoto();
    // The test photo really carries what we claim to remove.
    const before = await sharp(original).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif?.includes(Buffer.from('PhoneMaker'))).toBe(true);
    const gpsBlock = Buffer.from([0x25, 0x88]); // EXIF tag 0x8825: pointer to the GPS data
    expect(before.exif?.includes(gpsBlock)).toBe(true);

    const clean = await cleanImage(original, 'photo');
    const meta = await sharp(clean.data).metadata();
    expect(clean.contentType).toBe('image/webp');
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(clean.data.includes(Buffer.from('PhoneMaker'))).toBe(false);
    expect(clean.data.includes(Buffer.from('Ayesha'))).toBe(false);
  });

  it('turns the picture the right way up before dropping the orientation tag', async () => {
    const clean = await cleanImage(await phonePhoto(), 'photo');
    // Stored 1200×800 with "rotate 90°": shown upright it is 800 wide, 1200 tall.
    expect([clean.width, clean.height]).toEqual([800, 1200]);
  });

  it('shrinks to the displayed size and never enlarges', async () => {
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    expect(await cleanImage(big, 'avatar')).toMatchObject({ width: 512, height: 384 });
    const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    expect(await cleanImage(small, 'photo')).toMatchObject({ width: 300, height: 200 });
  });

  it('refuses decompression bombs before decoding their pixels', async () => {
    // A small file (one colour compresses well) that declares 8000 × 6000 = 48 MP.
    const bomb = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: '#000' } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(8000 * 6000).toBeGreaterThan(MAX_INPUT_PIXELS);
    await expect(cleanImage(bomb, 'photo')).rejects.toThrow('too many pixels');
  });

  it('refuses files that are not readable images, including truncated ones', async () => {
    await expect(
      cleanImage(Buffer.from('<html><script>alert(1)</script></html>'), 'photo'),
    ).rejects.toBeInstanceOf(ImageRejectedError);
    const jpeg = await phonePhoto();
    await expect(cleanImage(jpeg.subarray(0, jpeg.length / 2), 'photo')).rejects.toBeInstanceOf(
      ImageRejectedError,
    );
  });
});

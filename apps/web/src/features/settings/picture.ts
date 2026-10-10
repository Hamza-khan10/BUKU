/**
 * What the API takes as a profile picture (`@buku/media` PHOTO_TYPES and
 * MAX_PHOTO_BYTES; a test keeps them the same). Checked here first so a wrong
 * file is explained before anything is sent.
 */
export const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PictureType = (typeof PICTURE_TYPES)[number];
export const MAX_PICTURE_BYTES = 10 * 1024 * 1024;

export const isPictureType = (type: string): type is PictureType =>
  (PICTURE_TYPES as readonly string[]).includes(type);

/** "3.4 MB" / "820 KB". */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Why this file can't be a profile picture, or null when it can. */
export function pictureProblem(file: { type: string; size: number }): string | null {
  if (!isPictureType(file.type)) return 'Choose a JPEG, PNG or WebP picture.';
  if (file.size === 0) return 'That file is empty. Choose another picture.';
  if (file.size > MAX_PICTURE_BYTES) {
    return `Pictures can be up to ${fileSize(MAX_PICTURE_BYTES)}; this one is ${fileSize(file.size)}.`;
  }
  return null;
}

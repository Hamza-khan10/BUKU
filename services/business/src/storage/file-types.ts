/**
 * File-type allow-lists and signature ("magic bytes") checks.
 *
 * The declared Content-Type is just a claim by the client. Before accepting
 * an upload we read its first bytes and check they match a real PDF / JPEG /
 * PNG / WebP — a renamed executable or HTML page is rejected and deleted.
 */
export const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedContentType = (typeof DOCUMENT_TYPES)[number] | (typeof PHOTO_TYPES)[number];

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const SIGNATURE_BYTES = 16;

const startsWith = (buf: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

export function matchesSignature(contentType: AllowedContentType, head: Buffer): boolean {
  switch (contentType) {
    case 'application/pdf':
      return startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case 'image/jpeg':
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp':
      return startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8); // RIFF....WEBP
  }
}

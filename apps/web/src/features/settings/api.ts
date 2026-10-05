import type { Me } from '@/features/auth/api';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { PictureType } from './picture';

/** Where to send the file: a signed link to storage, good for a few minutes. */
interface UploadStart {
  uploadId: string;
  upload: { method: 'PUT'; url: string; headers: Record<string, string>; expiresAt: string };
}

const NOT_SENT = 'Your picture couldn’t be sent. Check your connection and try again.';

/**
 * A new profile picture, in three steps: the API hands out a signed link, the
 * file goes straight to storage (never through our server), then the API
 * checks it really is a picture, cleans it (no location or camera details
 * survive) and makes it the account's picture.
 */
export async function uploadPicture(file: File, type: PictureType): Promise<Me> {
  const { uploadId, upload } = await api<UploadStart>('auth/me/avatar/uploads', {
    method: 'POST',
    body: { contentType: type, sizeBytes: file.size },
  });
  const target = new URL(upload.url);
  if (target.protocol !== 'https:' && target.protocol !== 'http:')
    throw new ApiError(0, 'UPLOAD_FAILED', NOT_SENT);

  let sent: Response;
  try {
    sent = await fetch(target, {
      method: 'PUT',
      // The signed headers; the browser sets Content-Length from the file itself.
      headers: { 'Content-Type': upload.headers['Content-Type'] ?? type },
      body: file,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', NOT_SENT);
  }
  if (!sent.ok) throw new ApiError(sent.status, 'UPLOAD_FAILED', NOT_SENT);

  return api<Me>(`auth/me/avatar/uploads/${uploadId}/complete`, { method: 'POST' });
}

/** No picture: the uploaded one and the one from the sign-in provider. */
export const removePicture = () => api<Me>('auth/me/avatar', { method: 'DELETE' });

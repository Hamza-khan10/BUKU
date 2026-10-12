import { api } from './client';
import { ApiError } from './errors';

/**
 * Sending a picture, the same way everywhere (a profile picture, a business's logo and
 * photos): the API hands out a signed link, the file goes straight to storage (never through
 * our server), then the API checks it really is a picture and cleans it (no location or camera
 * details survive) before anything shows it.
 */

/** Where to send the file: a signed link to storage, good for a few minutes. */
export interface UploadStart {
  uploadId: string;
  upload: { method: 'PUT'; url: string; headers: Record<string, string>; expiresAt: string };
}

export const NOT_SENT = 'The picture couldn’t be sent. Check your connection and try again.';

/**
 * Ask for a link at `start` (with `body`), send the file there, then finish at
 * `${start}/${uploadId}/complete`; the API's answer to that last step is returned.
 */
export async function uploadFile<T>(
  start: string,
  body: Record<string, unknown>,
  file: File,
  type: string,
): Promise<T> {
  const { uploadId, upload } = await api<UploadStart>(start, {
    method: 'POST',
    body: { ...body, contentType: type, sizeBytes: file.size },
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

  return api<T>(`${start}/${uploadId}/complete`, { method: 'POST' });
}

import { api } from './client';
import { ApiError } from './errors';

/**
 * Sending a file, the same way everywhere (a profile picture, a business's logo and photos, a
 * verification document): the API hands out a signed link, the file goes straight to storage
 * (never through our server), then the API checks it really is what it claims; pictures are also
 * cleaned (no location or camera details survive) before anything shows them.
 */

/** Where to send the file: a signed link to storage, good for a few minutes. */
export interface UploadStart {
  uploadId?: string;
  /** Documents are named by the document they become. */
  documentId?: string;
  upload: { method: 'PUT'; url: string; headers: Record<string, string>; expiresAt: string };
}

export const NOT_SENT = 'The picture couldn’t be sent. Check your connection and try again.';

/**
 * Ask for a link at `start` (with `body`), send the file there, then finish at
 * `${start}/${uploadId}/complete` (or where `complete` says, for documents); the API's answer to
 * that last step is returned.
 */
export async function uploadFile<T>(
  start: string,
  body: Record<string, unknown>,
  file: File,
  type: string,
  complete: (started: UploadStart) => string | null = (s) =>
    s.uploadId ? `${start}/${s.uploadId}/complete` : null,
  notSent = NOT_SENT,
): Promise<T> {
  const started = await api<UploadStart>(start, {
    method: 'POST',
    body: { ...body, contentType: type, sizeBytes: file.size },
  });
  const { upload } = started;
  const finish = complete(started);
  const target = new URL(upload.url);
  if (!finish || (target.protocol !== 'https:' && target.protocol !== 'http:'))
    throw new ApiError(0, 'UPLOAD_FAILED', notSent);

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
    throw new ApiError(0, 'NETWORK_ERROR', notSent);
  }
  if (!sent.ok) throw new ApiError(sent.status, 'UPLOAD_FAILED', notSent);

  return api<T>(finish, { method: 'POST' });
}

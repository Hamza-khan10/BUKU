import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * S3-compatible object storage (RustFS locally, DigitalOcean Spaces in production).
 *
 * Files never pass through our API: clients upload directly to storage with
 * a short-lived PRESIGNED link that is valid for exactly one object key, one
 * content type and one exact size. We then inspect what actually arrived
 * before accepting it.
 *
 * Two clients: one talks to storage over the private network; the other only
 * SIGNS links with the endpoint browsers can reach (the host is part of the
 * signature, so it must match what the browser calls).
 */
export interface ObjectStorage {
  presignPut(
    bucket: string,
    key: string,
    contentType: string,
    sizeBytes: number,
    expiresInSeconds: number,
  ): Promise<string>;
  presignGet(bucket: string, key: string, expiresInSeconds: number): Promise<string>;
  head(bucket: string, key: string): Promise<{ sizeBytes: number; contentType: string | undefined } | null>;
  /** First `bytes` bytes of an object (to check its real file signature). */
  readPrefix(bucket: string, key: string, bytes: number): Promise<Buffer>;
  /** A whole (small) object. Callers check its size with `head` first. */
  read(bucket: string, key: string): Promise<Buffer>;
  put(bucket: string, key: string, body: Buffer, contentType: string, cacheControl?: string): Promise<void>;
  delete(bucket: string, key: string): Promise<void>;
  ping(buckets: string[]): Promise<void>;
}

export interface S3Settings {
  endpoint: string;
  publicEndpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export function createS3Storage(settings: S3Settings): ObjectStorage {
  const base = {
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
  };
  const internal = new S3Client({ ...base, endpoint: settings.endpoint });
  const signer = new S3Client({ ...base, endpoint: settings.publicEndpoint });

  return {
    presignPut(bucket, key, contentType, sizeBytes, expiresIn) {
      return getSignedUrl(
        signer,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: sizeBytes,
        }),
        // Signing these headers means the upload is refused unless the client
        // sends exactly this type and exactly this many bytes.
        { expiresIn, signableHeaders: new Set(['content-type', 'content-length']) },
      );
    },
    presignGet(bucket, key, expiresIn) {
      return getSignedUrl(signer, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
    },
    async head(bucket, key) {
      try {
        const res = await internal.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { sizeBytes: res.ContentLength ?? 0, contentType: res.ContentType };
      } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || (err as Error).name === 'NotFound') return null;
        throw err;
      }
    },
    async readPrefix(bucket, key, bytes) {
      const res = await internal.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
      );
      return Buffer.from(await res.Body!.transformToByteArray());
    },
    async read(bucket, key) {
      const res = await internal.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    },
    async put(bucket, key, body, contentType, cacheControl) {
      await internal.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
          ...(cacheControl && { CacheControl: cacheControl }),
        }),
      );
    },
    async delete(bucket, key) {
      await internal.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async ping(buckets) {
      await Promise.all(buckets.map((Bucket) => internal.send(new HeadBucketCommand({ Bucket }))));
    },
  };
}

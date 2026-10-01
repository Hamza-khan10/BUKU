import type { ObjectStorage } from './object-storage.js';

/**
 * Links to stored pictures.
 *
 *  • PUBLIC pictures (business photos and logo, employee photos) live in the
 *    media bucket. In production a CDN serves them at `publicBaseUrl` with
 *    permanent links; without one (development) they get 1-hour signed links.
 *  • PRIVATE pictures (customer profile pictures) live in the private bucket
 *    and are only ever handed out as short-lived signed links, to their owner.
 *
 * Every stored picture gets a new key when replaced, so public copies can be
 * cached "forever" (`immutable`) without ever showing a stale picture.
 */
export const PUBLIC_PICTURE_CACHE = 'public, max-age=31536000, immutable';
export const PRIVATE_PICTURE_CACHE = 'private, max-age=3600';

export interface MediaLinkSettings {
  mediaBucket: string;
  privateBucket: string;
  publicBaseUrl?: string | undefined;
  /** Lifetime of signed links (seconds). */
  signedLinkSeconds?: number;
}

export class MediaLinks {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly settings: MediaLinkSettings,
  ) {}

  get mediaBucket(): string {
    return this.settings.mediaBucket;
  }

  get privateBucket(): string {
    return this.settings.privateBucket;
  }

  publicUrl(key: string): Promise<string> {
    const base = this.settings.publicBaseUrl;
    return base
      ? Promise.resolve(`${base.replace(/\/$/, '')}/${key}`)
      : this.storage.presignGet(this.settings.mediaBucket, key, this.linkSeconds);
  }

  privateUrl(key: string): Promise<string> {
    return this.storage.presignGet(this.settings.privateBucket, key, this.linkSeconds);
  }

  private get linkSeconds(): number {
    return this.settings.signedLinkSeconds ?? 60 * 60;
  }
}

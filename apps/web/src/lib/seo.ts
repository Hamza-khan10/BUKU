import type { Metadata } from 'next';
import { X_HANDLE } from './brand';

/** The site's share card (public/og/buku.png, drawn by scripts/og-image.ts). */
export const SHARE_IMAGE = {
  url: '/og/buku.png',
  width: 1200,
  height: 630,
  alt: 'BUKU: book the time, skip the wait. Bookings and walk-in queues for local businesses.',
};

/**
 * A public page's metadata in one place (D-136): its title and description, its one address
 * (canonical, so ?source= and other tags don't make copies of it in search results), and the card
 * shown when its link is shared. Next doesn't carry a page's title into its share card by itself:
 * a page that sets no `openGraph` shows the site's, so every public page sets its own here.
 */
export function pageMetadata({
  title,
  description,
  path,
  absoluteTitle = false,
}: {
  title: string;
  description: string;
  path: `/${string}`;
  /** The home page: the title as it is, without " · BUKU" after it. */
  absoluteTitle?: boolean;
}): Metadata {
  const shown = absoluteTitle ? title : `${title} · BUKU`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: 'BUKU',
      title: shown,
      description,
      url: path,
      images: [SHARE_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      site: X_HANDLE,
      title: shown,
      description,
      images: [SHARE_IMAGE],
    },
  };
}

/**
 * Structured data (schema.org JSON-LD) for a <script type="application/ld+json">. Every "<" is
 * escaped, so nothing in the data can end the script block early.
 */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\' + 'u003c');
}

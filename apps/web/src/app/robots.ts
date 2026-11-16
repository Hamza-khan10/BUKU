import type { MetadataRoute } from 'next';
import { prelaunch } from '@/lib/flags';
import { siteUrl } from '@/lib/site-url';

/**
 * Nothing is indexed until ALLOW_INDEXING; then everything public and nothing personal (before
 * launch, only the pages that stand without the API).
 */
export default function robots(): MetadataRoute.Robots {
  if (process.env.ALLOW_INDEXING !== 'true') return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/account',
        '/appointments',
        '/queue/',
        '/business',
        '/admin',
        '/welcome',
        '/kit',
        // Before launch, pages that need the API would be empty: they wait for launch (D-134).
        ...(prelaunch() ? ['/explore', '/c/', '/b/', '/signin', '/checkout'] : []),
      ],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}

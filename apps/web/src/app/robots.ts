import type { MetadataRoute } from 'next';

/** Nothing is indexed until launch; then everything public, nothing personal. */
export default function robots(): MetadataRoute.Robots {
  if (process.env.ALLOW_INDEXING !== 'true') return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/account', '/appointments', '/queue/', '/business', '/admin', '/welcome', '/kit'],
    },
    sitemap: `${process.env.APP_URL || 'http://localhost:3000'}/sitemap.xml`,
  };
}

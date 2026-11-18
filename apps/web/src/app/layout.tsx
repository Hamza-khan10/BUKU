import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import { cookies, headers } from 'next/headers';
import Script from 'next/script';
import { SHARE_IMAGE } from '@/lib/seo';
import { siteUrl } from '@/lib/site-url';
import { THEME_COOKIE, themeFrom } from '@/lib/theme';
import { beaconSettings, webAnalyticsToken } from '@/lib/web-analytics';
import { Providers } from './providers';
import './globals.css';

// Self-hosted at build time: visitors' browsers never contact a font CDN.
// One family for everything (D-093), with its width axis for display sizes.
const instrument = Instrument_Sans({
  subsets: ['latin', 'latin-ext'],
  axes: ['wdth'],
  variable: '--font-instrument',
  display: 'swap',
});
// Only for codes read aloud at a front desk, where 0 and O must never be confused.
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: 'BUKU: appointment booking and walk-in queue app in Pakistan', template: '%s · BUKU' },
  description:
    'Book appointments and join walk-in queues at barbers, clinics, salons and offices in Pakistan, free. Businesses run their bookings and queue with BUKU.',
  applicationName: 'BUKU',
  // The share card of pages that don't set their own (public pages do, through pageMetadata).
  openGraph: {
    type: 'website',
    siteName: 'BUKU',
    title: 'BUKU: book appointments and join queues',
    description:
      'Book appointments and join queues at local businesses, get reminded, and see your place in line as it moves.',
    images: [SHARE_IMAGE],
  },
  twitter: { card: 'summary_large_image', images: [SHARE_IMAGE] },
  // Not indexed until launch (ALLOW_INDEXING=true on the production domain).
  robots: process.env.ALLOW_INDEXING === 'true' ? undefined : { index: false, follow: false },
  formatDetection: { telephone: false, email: false, address: false },
  // Google Search Console's ownership check (a public token), once the owner adds the site there.
  ...(process.env.GOOGLE_SITE_VERIFICATION?.trim() && {
    verification: { google: process.env.GOOGLE_SITE_VERIFICATION.trim() },
  }),
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f8f6' },
    { media: '(prefers-color-scheme: dark)', color: '#0c1310' },
  ],
  colorScheme: 'light dark',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const [jar, incoming] = await Promise.all([cookies(), headers()]);
  const theme = themeFrom(jar.get(THEME_COOKIE)?.value);
  const analytics = webAnalyticsToken();
  return (
    <html
      lang="en"
      data-theme={theme === 'system' ? undefined : theme}
      className={`${instrument.variable} ${jetbrains.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
        {/* Cloudflare Web Analytics (D-136): counts visits from real browsers, no cookies. */}
        {analytics && (
          <Script
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={beaconSettings(analytics)}
            nonce={incoming.get('x-nonce') ?? undefined}
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}

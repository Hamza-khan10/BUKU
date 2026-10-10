import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import { THEME_COOKIE, themeFrom } from '@/lib/theme';
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
  metadataBase: new URL(process.env.APP_URL || 'http://localhost:3000'),
  title: { default: 'BUKU: book appointments and join queues', template: '%s · BUKU' },
  description:
    'Book appointments and join queues at local businesses, get reminded, and see your place in line as it moves.',
  applicationName: 'BUKU',
  // Not indexed until launch (ALLOW_INDEXING=true on the production domain).
  robots: process.env.ALLOW_INDEXING === 'true' ? undefined : { index: false, follow: false },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f5f3' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0f0d' },
  ],
  colorScheme: 'light dark',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const theme = themeFrom((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      data-theme={theme === 'system' ? undefined : theme}
      className={`${instrument.variable} ${jetbrains.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import { THEME_COOKIE, themeFrom } from '@/lib/theme';
import { Providers } from './providers';
import './globals.css';

// Self-hosted at build time: visitors' browsers never contact a font CDN.
const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter', display: 'swap' });
const bricolage = Bricolage_Grotesque({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-bricolage',
  display: 'swap',
});
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || 'http://localhost:3000'),
  title: { default: 'BUKU — book appointments and join queues', template: '%s · BUKU' },
  description:
    'Book appointments and join queues at local businesses, get reminded, and see your place in line as it moves.',
  applicationName: 'BUKU',
  // Not indexed until launch (ALLOW_INDEXING=true on the production domain).
  robots: process.env.ALLOW_INDEXING === 'true' ? undefined : { index: false, follow: false },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbf8f3' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1525' },
  ],
  colorScheme: 'light dark',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const theme = themeFrom((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      data-theme={theme === 'system' ? undefined : theme}
      className={`${inter.variable} ${bricolage.variable} ${jetbrains.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

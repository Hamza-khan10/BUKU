import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'BUKU admin', template: '%s · BUKU admin' },
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-canvas text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
            <span className="font-semibold tracking-tight">BUKU</span>
            <span className="rounded bg-brand px-2 py-0.5 text-xs font-semibold text-brand-ink">Admin</span>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-5xl px-4 py-10">
          {children}
        </main>
      </body>
    </html>
  );
}

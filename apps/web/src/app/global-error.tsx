'use client';

/**
 * The last line of defence: the whole page failed, including its layout, so
 * this renders its own document with no stylesheet (plain inline styles in
 * BUKU's colours, following the device's light/dark setting).
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          background: 'Canvas',
          color: 'CanvasText',
          colorScheme: 'light dark',
          padding: '1rem',
        }}
      >
        <title>Something went wrong · BUKU</title>
        <main style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
          <p style={{ opacity: 0.8, lineHeight: 1.5 }}>
            BUKU couldn’t show this page. Please try again; if it keeps happening, quote the reference below
            to support.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: '1rem',
              minHeight: '2.75rem',
              padding: '0 1.25rem',
              border: 0,
              borderRadius: '0.75rem',
              background: '#d4432a',
              color: '#fff',
              fontSize: '1rem',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', opacity: 0.7 }}>
              Reference: <code>{error.digest}</code>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}

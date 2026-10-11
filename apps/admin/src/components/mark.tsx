/**
 * BUKU's mark (D-094): a ticket whose two clock hands make a check. The same
 * drawing as the website's `public/brand/buku-mark.svg`; decorative here, the
 * word "BUKU" beside it carries the name.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className={className}>
      <path
        d="M11 9H37A7 7 0 0 1 44 16V19.5A4.5 4.5 0 0 0 44 28.5V32A7 7 0 0 1 37 39H11A7 7 0 0 1 4 32V28.5A4.5 4.5 0 0 0 4 19.5V16A7 7 0 0 1 11 9Z"
        fill="#067F5D"
      />
      <path d="M15 24L21 30" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" />
      <path d="M21 30L34.5 16.5" stroke="#FFFFFF" strokeWidth="3.6" strokeLinecap="round" />
      <circle cx="21" cy="30" r="3.3" fill="#FFAD52" />
    </svg>
  );
}

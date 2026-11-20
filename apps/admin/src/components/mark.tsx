/**
 * BUKU's mark (Brand Identity v1.0, D-143): a thick Emerald U holding a Saffron dot, "your place,
 * held". The same drawing as the website's `public/brand/buku-mark.svg`; decorative here, the word
 * "BUKU" beside it carries the name.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 60" aria-hidden className={className}>
      <path
        d="M8 8V30A22 22 0 0 0 52 30V8"
        fill="none"
        stroke="#067F5D"
        strokeWidth="16"
        strokeLinecap="round"
      />
      <circle cx="30" cy="32" r="11" fill="#E28A0A" />
    </svg>
  );
}

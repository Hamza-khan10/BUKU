import { cn } from '@/lib/cn';
import { BRAND, MARK, WORDMARK } from './mark';

/**
 * The BUKU logo (Brand Identity v1.0, D-143). Its colours follow the ground (globals.css, the
 * --logo-* tokens): an Emerald U and a deep Saffron dot on light; a white U and a Saffron dot on
 * dark mode and Midnight sections. `reversed` forces the white pair (on Emerald). One component,
 * so the brand changes in one place.
 */

type Named = { className?: string; title?: string; reversed?: boolean };

const colours = (reversed: boolean) =>
  reversed ? { u: BRAND.white, dot: BRAND.saffron } : { u: 'var(--logo-u)', dot: 'var(--logo-dot)' };

/** Read aloud only when named; beside the word "BUKU" (or inside a named link) it's decoration. */
const naming = (title?: string) =>
  title ? ({ role: 'img', 'aria-label': title } as const) : ({ 'aria-hidden': true } as const);

/** The cup and the dot, drawn in a 60-unit square. */
function Cup({ u, dot }: { u: string; dot: string }) {
  return (
    <>
      <path d={MARK.cup} fill="none" stroke={u} strokeWidth={MARK.cupWidth} strokeLinecap="round" />
      <circle {...MARK.dot} fill={dot} />
    </>
  );
}

/** The symbol alone: where BUKU is already named nearby (menus, sign-in, the workspace). */
export function LogoMark({ className, title, reversed = false }: Named) {
  return (
    <svg viewBox="0 0 60 60" className={cn('size-8 shrink-0', className)} {...naming(title)}>
      <Cup {...colours(reversed)} />
    </svg>
  );
}

/** The symbol on its Emerald tile: the app icon (notifications, the phone in the story). */
export function AppIcon({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={cn('size-10 shrink-0', className)} {...naming(title)}>
      <rect width="100" height="100" rx="23" fill={BRAND.emerald} />
      <g transform="translate(24 23) scale(.866)">
        <Cup u={BRAND.white} dot={BRAND.saffron} />
      </g>
    </svg>
  );
}

/** The wordmark's strokes and dot, on its 266 × 100 grid. */
function Word({ u, dot }: { u: string; dot: string }) {
  return (
    <>
      <g fill="none" stroke={u} strokeWidth={WORDMARK.width} strokeLinecap="round" strokeLinejoin="round">
        <path d={WORDMARK.strokes[0]} />
        <circle {...WORDMARK.bowl} />
        {WORDMARK.strokes.slice(1).map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <circle {...WORDMARK.dot} fill={dot} />
    </>
  );
}

/**
 * The primary lockup: symbol and wordmark side by side (390 × 100). At its default 32 px tall it's
 * 125 px wide, just over the brand's 120 px minimum; smaller than that, use the symbol.
 */
export function Logo({ className, title, reversed = false }: Named) {
  const c = colours(reversed);
  return (
    <svg viewBox="0 0 390 100" className={cn('h-8 w-auto shrink-0', className)} {...naming(title)}>
      <g transform="translate(0 10) scale(1.5)">
        <Cup {...c} />
      </g>
      <g transform="translate(124 0)">
        <Word {...c} />
      </g>
    </svg>
  );
}

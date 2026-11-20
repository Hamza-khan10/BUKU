/**
 * The BUKU mark's one definition (Brand Identity v1.0, D-143): "U is for you". A thick U, one
 * 16-unit stroke with round ends, holds a Saffron dot: your place, held. Drawn on a 60-unit grid.
 * The wordmark spells "buku" in lowercase with the same round strokes, and its last u holds the
 * same dot (266 × 100). The files in public/brand/ are drawn from these paths.
 */
export const MARK = {
  cup: 'M8 8V30A22 22 0 0 0 52 30V8',
  cupWidth: 16,
  dot: { cx: 30, cy: 32, r: 11 },
} as const;

export const WORDMARK = {
  strokes: [
    'M7 7V93',
    'M77 51V72A21 21 0 0 0 119 72V51',
    'M147 7V93M187 51L151 79M165 68L189 93',
    'M217 51V72A21 21 0 0 0 259 72V51',
  ],
  bowl: { cx: 28, cy: 72, r: 21 },
  width: 14,
  dot: { cx: 238, cy: 75, r: 10 },
} as const;

export const BRAND = {
  emerald: '#067f5d',
  saffron: '#ffad52',
  /** Saffron 400: the dot on light grounds, where plain Saffron would fade. Never text. */
  saffronDeep: '#e28a0a',
  midnight: '#011e14',
  porcelain: '#f4f8f6',
  ink: '#131a17',
  mint: '#79d7b1',
  white: '#ffffff',
} as const;

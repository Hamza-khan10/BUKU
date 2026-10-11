/**
 * The BUKU mark's one definition (D-094), on a 48-unit grid: a notched ticket (a
 * booking receipt and a queue ticket are both tickets), two clock hands that also
 * read as a check (your time, confirmed), and a Saffron pivot (your turn). The
 * files in public/brand/ are drawn from these same paths; the logo is the same
 * colour in both themes.
 */
export const MARK = {
  ticket:
    'M11 9H37A7 7 0 0 1 44 16V19.5A4.5 4.5 0 0 0 44 28.5V32A7 7 0 0 1 37 39H11A7 7 0 0 1 4 32V28.5A4.5 4.5 0 0 0 4 19.5V16A7 7 0 0 1 11 9Z',
  hour: 'M15 24L21 30',
  minute: 'M21 30L34.5 16.5',
  pivot: { cx: 21, cy: 30, r: 3.3 },
  hourWidth: 5,
  minuteWidth: 3.6,
} as const;

export const BRAND = {
  emerald: '#067f5d',
  saffron: '#ffad52',
  midnight: '#011e14',
  porcelain: '#f4f8f6',
  ink: '#131a17',
  white: '#ffffff',
} as const;

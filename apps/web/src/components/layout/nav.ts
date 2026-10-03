import type { Route } from 'next';

/**
 * The public site's navigation, in one place. Only pages that exist are
 * listed: links join as their pages are built (WEB_PLAN §7).
 */

/** A legal document's address (a dynamic route: /legal/[doc]). */
const legal = (doc: string) => `/legal/${doc}` as Route;

export interface NavLink {
  href: Route;
  label: string;
}

export const primaryNav: NavLink[] = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/help', label: 'Help' },
];

/** Shown under the main links in the phone menu. */
export const secondaryNav: NavLink[] = [
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
  { href: '/security', label: 'Security' },
  { href: '/legal', label: 'Legal' },
];

export const footerNav: { title: string; links: NavLink[] }[] = [
  {
    title: 'BUKU',
    links: [
      { href: '/how-it-works', label: 'How it works' },
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
    ],
  },
  {
    title: 'Trust',
    links: [
      { href: '/security', label: 'Security' },
      { href: '/help', label: 'Help' },
      { href: legal('sub-processors'), label: 'Sub-processors' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: legal('privacy'), label: 'Privacy' },
      { href: legal('terms'), label: 'Terms' },
      { href: legal('business-terms'), label: 'Business terms' },
      { href: legal('cookies'), label: 'Cookies' },
      { href: legal('acceptable-use'), label: 'Acceptable use' },
      { href: legal('refunds'), label: 'Refunds' },
    ],
  },
];

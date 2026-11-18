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
  { href: '/explore', label: 'Explore' },
  { href: '/categories', label: 'Categories' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/for-business', label: 'For businesses' },
];

/** Pages that need the API to show anything: kept out of the navigation before launch (D-137). */
const NEED_THE_API = new Set<string>(['/explore']);

/** The links to show: all of them, or before launch only those that stand without the API. */
export const visibleLinks = (links: NavLink[], early: boolean) =>
  early ? links.filter((l) => !NEED_THE_API.has(l.href)) : links;

/** Shown under the main links in the phone menu. */
export const secondaryNav: NavLink[] = [
  { href: '/help', label: 'Help' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
  { href: '/security', label: 'Security' },
  { href: '/legal', label: 'Legal' },
];

export const footerNav: { title: string; links: NavLink[] }[] = [
  {
    title: 'BUKU',
    links: [
      { href: '/explore', label: 'Explore' },
      { href: '/categories', label: 'Categories' },
      { href: '/how-it-works', label: 'How it works' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/for-business', label: 'For businesses' },
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
    ],
  },
  {
    // The kinds people look for most, linked from every page (D-139).
    title: 'Popular',
    links: [
      { href: '/c/barbershop' as Route, label: 'Barbershops' },
      { href: '/c/hair-salon' as Route, label: 'Hair salons' },
      { href: '/c/dental-clinic' as Route, label: 'Dental clinics' },
      { href: '/c/general-physician' as Route, label: 'Doctors' },
      { href: '/c/gym' as Route, label: 'Gyms' },
      { href: '/c/car-wash' as Route, label: 'Car washes' },
      { href: '/c/passport-office' as Route, label: 'Passport offices' },
      { href: '/c/bank-branch' as Route, label: 'Banks' },
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

/**
 * One line for each of BUKU's groups, saying what's in it in plain words, so a visitor can
 * tell the groups apart at a glance (D-102). Written from the kinds each group holds (D-100);
 * a group added later simply shows without one.
 */
const BLURBS: Record<string, string> = {
  'beauty-hair': 'Barbers, salons, makeup, lashes, henna and tattoos.',
  'health-medical': 'Doctors, specialists, clinics, labs and hospital outpatients.',
  'wellness-spa': 'Spas, massage, hijama, steam and quiet hours.',
  fitness: 'Gyms, classes, trainers, and courts and nets to book.',
  automotive: 'Washing, servicing, repairs, inspections and driving lessons.',
  pets: 'Grooming, vets, boarding, daycare and training.',
  'government-public': 'Offices for cards, licences, permits and records.',
  'home-professional': 'Advisers, repairs and services that come to you.',
  'education-tutoring': 'Tutors, lessons, classes and test preparation.',
  'events-photography': 'Photographers, planners, halls and marquees.',
  'finance-banking': 'Banks, exchange, insurance and financial advice.',
};

export function groupBlurb(slug: string): string | null {
  return Object.hasOwn(BLURBS, slug) ? BLURBS[slug]! : null;
}

/** Case, "&" and spacing don't matter when looking a kind up ("lash and brow" finds "Lash & Brow"). */
export function searchKey(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('en').replaceAll('&', 'and').replace(/\s+/g, ' ').trim();
}

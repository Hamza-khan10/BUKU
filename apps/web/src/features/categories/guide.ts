import type { Question } from '@/features/marketing/faq';
import type { CategoryNode } from '@/features/search/types';
import { KIND_GUIDES, type Visits } from './guide-content';
import { groupBlurb } from './groups';
import { CATEGORY_SNAPSHOT } from './snapshot';

/**
 * Every category's own page, before and after launch (D-139): what it is, how BUKU works there,
 * what it means for that kind of business, and questions people ask, worded for the way people
 * search ("book a dentist online", "join the queue at the passport office"). After launch the
 * same address lists the places too, so what the page earns in search carries over.
 */

export interface Placed {
  node: CategoryNode;
  parent: CategoryNode | null;
}

/** A category in the catalog BUKU starts with, and its group (null for a group). */
export function placeOf(slug: string, tree: CategoryNode[] = CATEGORY_SNAPSHOT): Placed | null {
  for (const group of tree) {
    if (group.slug === slug) return { node: group, parent: null };
    const kind = group.children.find((c) => c.slug === slug);
    if (kind) return { node: kind, parent: group };
  }
  return null;
}

/** "Dental Clinic" → "dental clinic", keeping the capitals that matter ("ENT specialist", "car AC repair"). */
export function inSentence(name: string): string {
  return name
    .split(' ')
    .map((w) => (/[A-Z].*[A-Z]/.test(w) ? w : w.toLowerCase()))
    .join(' ');
}

/** "a barbershop", "an ENT specialist", "a union council office" (a "yoo" sound takes "a"). */
export function withArticle(phrase: string): string {
  return /^(?![Uu](?:ni|ti|se))[AEIOUaeiou]/.test(phrase) ? `an ${phrase}` : `a ${phrase}`;
}

export function visitsOf(slug: string): Visits {
  return KIND_GUIDES[slug]?.visits ?? 'both';
}

/** The page's title and description, as search results show them. */
export function categoryCopy({ node, parent }: Placed): { title: string; description: string } {
  const name = node.name;
  const lower = inSentence(name);
  if (!parent)
    return {
      title: `${name}: book appointments and join queues online`,
      description: `${groupBlurb(node.slug) ?? `${name} on BUKU.`} Book appointments or join the queue online, free for customers.`,
    };
  switch (visitsOf(node.slug)) {
    case 'book':
      return {
        title: `${name} appointments online`,
        description: `Book ${lower} appointments online with BUKU: choose a free time, get a reminder, and change it from your phone. Free for customers.`,
      };
    case 'queue':
      return {
        title: `${name} queue online: skip the wait`,
        description: `Join the ${lower} queue from your phone with BUKU: see your place move and arrive when it’s your turn. Free for customers.`,
      };
    default:
      return {
        title: `${name} booking and walk-in queue online`,
        description: `Book ${lower} appointments online or join the walk-in queue from your phone with BUKU, and arrive when it’s your turn. Free for customers.`,
      };
  }
}

/** One line under the heading: the way BUKU helps here. */
export function categoryLead({ node, parent }: Placed): string {
  if (!parent) return 'Book a time ahead, or join the queue from your phone and arrive when it’s your turn.';
  switch (visitsOf(node.slug)) {
    case 'book':
      return 'Book a time that’s really free, get a reminder, and change it from your phone.';
    case 'queue':
      return 'Join the queue from your phone, watch your place move, and arrive when it’s your turn.';
    default:
      return 'Book a time ahead, or join the walk-in queue from your phone and arrive when it’s your turn.';
  }
}

/** Questions people ask about this kind of place on BUKU (and their FAQPage data). */
export function categoryQuestions({ node, parent }: Placed, early: boolean): Question[] {
  const lower = inSentence(node.name);
  const where = parent ? lower : `places in ${node.name}`;
  const visits = parent ? visitsOf(node.slug) : 'both';
  const questions: Question[] = [];
  if (visits !== 'queue')
    questions.push({
      id: 'book',
      q: parent ? `How do I book ${lower} appointments online?` : `How do I book ${where} online?`,
      a: `Find the place on BUKU, choose what you need and a time that’s free, and confirm. You get a reminder before your visit, and you can cancel or move it from your phone.`,
    });
  if (visits !== 'book')
    questions.push({
      id: 'queue',
      q: parent ? `Can I join the ${lower} queue from home?` : `Can I join the queue at ${where} from home?`,
      a: `Yes, where the place runs its queue on BUKU. Take a ticket from your phone, watch your place move, and get told when your turn is near, so you arrive just in time instead of waiting there.`,
    });
  questions.push({
    id: 'free',
    q: 'Does it cost anything to book or queue with BUKU?',
    a: 'No. Booking and queueing with BUKU are free for customers, always. You pay the business for its service, as you normally would, never through BUKU.',
  });
  questions.push(
    early
      ? {
          id: 'when',
          q: 'When will BUKU open near me?',
          a: 'BUKU is opening city by city. Join the early-access list and we’ll email you the day it opens near you.',
        }
      : {
          id: 'near',
          q: parent ? `How do I find ${withArticle(lower)} near me?` : `How do I find ${where} near me?`,
          a: 'Search on BUKU and choose your area: places near you show first, with their hours, prices and reviews from real visits.',
        },
  );
  const business = parent ? `my ${lower}` : 'my business';
  questions.push({
    id: 'business',
    q: `How can ${business} use BUKU?`,
    a:
      visits === 'queue'
        ? 'Run your walk-in queue on BUKU: customers take a ticket from their phone and arrive when it’s their turn, and you call the next one and add walk-ins. Starter is free.'
        : visits === 'book'
          ? 'Take bookings from your real availability, send reminders for you, and check customers in by code or QR. Starter is free, and every business can try Professional for 30 days.'
          : 'Take bookings from your real availability and run your walk-in queue in one place, with reminders sent for you and check-in by code or QR. Starter is free.',
  });
  return questions;
}

/** Where the page sits (Home › Categories › group › kind), as schema.org BreadcrumbList. */
export function breadcrumbData(site: string, { node, parent }: Placed) {
  const trail = [
    { name: 'Home', url: site },
    { name: 'Categories', url: `${site}/categories` },
    ...(parent ? [{ name: parent.name, url: `${site}/c/${parent.slug}` }] : []),
    { name: node.name, url: `${site}/c/${node.slug}` },
  ];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      item: t.url,
    })),
  };
}

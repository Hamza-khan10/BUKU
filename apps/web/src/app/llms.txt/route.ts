import { BUSINESS_QUESTIONS, PRICING_QUESTIONS } from '@/features/marketing/faq';
import { ENTERPRISE, LAUNCH_PLANS, money, TRIAL_DAYS } from '@/features/pricing/launch-plans';
import { prelaunch } from '@/lib/flags';
import { siteUrl } from '@/lib/site-url';

/**
 * /llms.txt (llmstxt.org), D-136: BUKU in plain Markdown for AI assistants and answer engines,
 * so what they say about it comes from what BUKU says about itself. The questions are the same
 * ones /for-business shows. Only pages that stand on their own are listed.
 */
export function GET(): Response {
  const site = siteUrl();
  const early = prelaunch();
  const page = (path: string, name: string, about: string) => `- [${name}](${site}${path}): ${about}`;
  const lines = [
    '# BUKU',
    '',
    '> BUKU is an app for booking appointments and joining walk-in queues at local businesses such as barbers, clinics, salons and offices. People book or join a queue from their phone, free. Businesses take bookings from their real availability and run their queue with it. BUKU opens in Pakistan first.',
    '',
    early
      ? 'BUKU has not opened yet. Businesses and people who book can join the early-access list to hear the day it opens near them.'
      : 'BUKU is open: people can find a business, book a time or join its queue.',
    '',
    '## Pages',
    '',
    page('/', 'Home', 'what BUKU is'),
    page(
      '/for-business',
      'For businesses',
      'what a business gets: bookings, the walk-in queue, check-in, the team, its own page',
    ),
    page('/pricing', 'Pricing', 'free for people who book; the plans for businesses'),
    page(
      '/categories',
      'Categories',
      'every kind of place BUKU covers, from barbers and clinics to passport offices',
    ),
    page('/how-it-works', 'How it works', 'booking an appointment and joining a queue, step by step'),
    ...(early ? [page('/early-access', 'Early access', 'join the list before BUKU opens')] : []),
    page('/help', 'Help', 'answers about booking, queues, accounts and reviews'),
    page('/about', 'About', 'why BUKU exists and the principles it is built on'),
    page('/security', 'Security', 'how BUKU protects accounts and data'),
    '',
    `## Prices${early ? ' at launch' : ''}`,
    '',
    'Free for people who book and queue, always. For businesses, per branch, per month (before tax); in Pakistan in rupees, elsewhere in US dollars; a year costs ten months:',
    '',
    ...LAUNCH_PLANS.map(
      (p) =>
        `- ${p.name} (${p.forWhom.toLowerCase()}): ${
          p.monthly.USD === 0
            ? 'free'
            : `${money(p.monthly.PKR, 'PKR')} or ${money(p.monthly.USD, 'USD')}${p.perBranch ? ' a branch' : ''}`
        }`,
    ),
    `- Enterprise (${ENTERPRISE.fromBranches} branches or more): priced with the business`,
    `- Every business can try Professional free for ${TRIAL_DAYS} days.`,
    '',
    '## Questions businesses ask',
    '',
    ...[
      ...BUSINESS_QUESTIONS,
      ...PRICING_QUESTIONS.filter((p) => !BUSINESS_QUESTIONS.some((b) => b.q === p.q)),
    ].flatMap(({ q, a }) => [`### ${q}`, '', a, '']),
    '## Optional',
    '',
    page('/legal/privacy', 'Privacy notice', 'what BUKU keeps and why'),
    page('/legal/terms', 'Terms of use', 'the rules for using BUKU'),
    page('/contact', 'Contact', 'how to reach BUKU'),
    '',
  ];
  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-robots-tag': 'noindex',
    },
  });
}

import { Contact } from '@/components/content/legal-doc';
import type { SiteFacts } from '@/lib/site';
import type { LegalDocument } from './types';

/** What everyone using BUKU — customers and businesses — agrees not to do. */
export function acceptableUse(facts: SiteFacts): LegalDocument {
  return {
    title: 'Acceptable use',
    description: 'The rules that keep BUKU fair and safe for customers and businesses.',
    version: '1.0',
    inShort: [
      'Be real: real bookings, real reviews of real visits, real business details.',
      'Be respectful: no harassment, hate or threats, in reviews, replies or anywhere else.',
      'Don’t attack, overload or copy BUKU — and if you find a security problem, tell us.',
    ],
    sections: [
      {
        id: 'be-real',
        title: 'Be real',
        body: (
          <ul>
            <li>
              Don’t make bookings or join queues you don’t intend to keep, or on someone else’s behalf without
              asking them.
            </li>
            <li>
              Don’t write reviews of visits that didn’t happen, or pay, reward or pressure anyone for a
              review.
            </li>
            <li>Businesses: don’t list a business you don’t run, or give false details, prices or hours.</li>
            <li>Don’t pretend to be someone else, or to be BUKU.</li>
          </ul>
        ),
      },
      {
        id: 'be-respectful',
        title: 'Be respectful',
        body: (
          <ul>
            <li>No harassment, threats, hate speech or discrimination.</li>
            <li>No one else’s personal details (phone numbers, addresses) in reviews or replies.</li>
            <li>Nothing illegal, sexually explicit, or that promotes violence.</li>
          </ul>
        ),
      },
      {
        id: 'keep-it-safe',
        title: 'Keep BUKU safe',
        body: (
          <ul>
            <li>
              Don’t try to get into accounts or data that aren’t yours, or get around limits and security
              checks.
            </li>
            <li>Don’t overload BUKU or collect its data with automated tools (scraping).</li>
            <li>Don’t send spam or malicious links through BUKU.</li>
            <li>
              Found a security problem? Please tell us at{' '}
              <Contact value={facts.email.security} kind="email" /> and give us time to fix it before telling
              others.
            </li>
          </ul>
        ),
      },
      {
        id: 'what-happens',
        title: 'If the rules are broken',
        body: (
          <p>
            Anyone can report a review or a business in BUKU. We look at every report and may hide content,
            limit an account, suspend a business or close an account, and we’ll say why unless the law
            prevents it. Where the law requires, we report illegal content to the authorities.
          </p>
        ),
      },
    ],
  };
}

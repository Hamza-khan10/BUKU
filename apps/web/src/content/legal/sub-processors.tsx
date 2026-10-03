import { ProseTable } from '@/components/content/prose';
import type { LegalDocument } from './types';

/**
 * Companies that will process personal data for BUKU (docs/compliance/sub-processors.md).
 * Only what is decided is named; open choices say so.
 */
export function subProcessors(): LegalDocument {
  return {
    title: 'Sub-processors',
    description: 'The companies that run parts of BUKU and the personal data each one handles.',
    version: '1.0',
    inShort: [
      'These companies run parts of BUKU for us and handle personal data only on our instructions.',
      'Businesses are told 30 days before a new one starts handling their customers’ data.',
    ],
    sections: [
      {
        id: 'list',
        title: 'Who they are',
        body: (
          <ProseTable
            caption="Sub-processors"
            head={['Company', 'What for', 'Personal data', 'Where']}
            rows={[
              [
                'DigitalOcean',
                'Servers, databases, file storage and backups',
                'All data BUKU holds',
                'Region chosen at launch',
              ],
              ['Vercel', 'Hosting this website', 'Request details (IP address, browser)', 'Global'],
              ['Google', 'Signing in with Google', 'Name, email, Google account ID', 'Global'],
              [
                'Paddle',
                'Selling and billing subscriptions',
                'Name, email, payment details (held by Paddle)',
                'EU, UK, US',
              ],
              [
                'Meta (WhatsApp)',
                'WhatsApp messages, only if you connect WhatsApp',
                'Phone number, message content',
                'Global',
              ],
              [
                'Expo, Apple and Google',
                'Notifications on phones (with the apps)',
                'Device token, message content',
                'US',
              ],
              [
                'Apple',
                'Signing in with Apple (with the iPhone app)',
                'Name, email (may be private relay), Apple ID',
                'Global',
              ],
              [
                'An email delivery service (to be confirmed before launch)',
                'Sending emails',
                'Email address, message content',
                'To be confirmed',
              ],
            ]}
          />
        ),
      },
      {
        id: 'not-sub-processors',
        title: 'Who isn’t on this list',
        body: (
          <p>
            Businesses you book with aren’t our sub-processors: they see what they need to serve you (see the
            privacy notice) and are responsible for their own customer relationships.
          </p>
        ),
      },
      {
        id: 'changes',
        title: 'Changes',
        body: (
          <p>
            We update this page before a new company starts handling personal data, and review every company
            on it once a year.
          </p>
        ),
      },
    ],
  };
}

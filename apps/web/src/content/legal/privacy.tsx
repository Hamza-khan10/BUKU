import Link from 'next/link';
import { Contact } from '@/components/content/legal-doc';
import { ProseTable } from '@/components/content/prose';
import type { SiteFacts } from '@/lib/site';
import type { LegalDocument } from './types';

/**
 * Privacy notice. Every statement matches the system: what is stored (schema),
 * who sees it (API views), how long (docs/compliance retention schedule), and
 * the controls people have (export, deletion grace, notification settings).
 */
export function privacy(facts: SiteFacts): LegalDocument {
  return {
    title: 'Privacy notice',
    description: 'What BUKU collects, why, who sees it, how long it’s kept, and the controls you have.',
    version: '1.0',
    inShort: [
      'We collect what booking and queueing need: your name and email from Google or Apple, your bookings and queue tickets, and a phone number only if you add one.',
      'Businesses see your name, your booking and a reliability label — never your contact details or your picture.',
      'We don’t sell personal data, and the website uses no advertising or analytics cookies.',
      'You can download everything we hold about you, and delete your account at any time (with 30 days to change your mind).',
    ],
    sections: [
      {
        id: 'who-we-are',
        title: 'Who we are',
        body: (
          <>
            <p>
              BUKU lets people book appointments and join queues at local businesses. BUKU is run by{' '}
              <Contact value={facts.legalName} kind="text" />, which is responsible for your personal data
              (the “controller”).
            </p>
            <p>
              Questions about privacy: <Contact value={facts.email.privacy} kind="email" />.
            </p>
          </>
        ),
      },
      {
        id: 'what-we-collect',
        title: 'What we collect and why',
        body: (
          <ProseTable
            caption="What BUKU collects and why"
            head={['What', 'Why', 'Legal basis']}
            rows={[
              [
                'Your name and email, from Google or Apple when you sign in',
                'Your account; telling you about your bookings',
                'Contract',
              ],
              [
                'A phone number, only if you add one (and whether you agreed to WhatsApp messages)',
                'Messages about your bookings on the channels you chose',
                'Contract; consent for WhatsApp',
              ],
              [
                'Your bookings, queue tickets, cancellations and reviews',
                'Providing the service; your history; showing businesses a reliability label',
                'Contract; legitimate interest',
              ],
              [
                'Your location, only when you search nearby or join a queue — used at that moment, not stored',
                'Showing places near you; checking you’re close enough to join a queue',
                'Consent (your browser or phone asks you)',
              ],
              [
                'Device notification tokens and your notification choices',
                'Sending the notifications you asked for',
                'Contract; consent for suggestions and marketing',
              ],
              [
                'Sign-in and security records: IP address, device and browser, times',
                'Keeping accounts safe; investigating misuse',
                'Legitimate interest',
              ],
              [
                'Subscription details (payments themselves are handled by Paddle)',
                'BUKU Plus and business plans',
                'Contract',
              ],
            ]}
          />
        ),
      },
      {
        id: 'what-we-dont-do',
        title: 'What we don’t do',
        body: (
          <ul>
            <li>We don’t sell or rent personal data.</li>
            <li>
              We don’t put advertising or analytics cookies on the website (see the{' '}
              <Link href="/legal/cookies">cookie policy</Link>).
            </li>
            <li>We don’t give businesses your phone number, email or picture.</li>
            <li>We don’t keep a history of where you’ve been.</li>
          </ul>
        ),
      },
      {
        id: 'who-sees-what',
        title: 'Who sees what',
        body: (
          <>
            <p>
              <strong>Businesses you book with or queue at</strong> see your name, the booking or ticket, any
              note you write for them, and a reliability label such as “Shows up 95%” or “New customer” — not
              your history with other businesses.
            </p>
            <p>
              <strong>Everyone</strong> can read reviews, which show your first name and the initial of your
              last name (for example “Ayesha K.”), never your full name or picture.
            </p>
            <p>
              <strong>Companies that run parts of BUKU for us</strong> (hosting, email, notifications,
              payments) process data only on our instructions. They’re listed on the{' '}
              <Link href="/legal/sub-processors">sub-processors</Link> page.
            </p>
            <p>
              <strong>Authorities</strong>, only when the law requires it; each such disclosure is recorded
              with its legal basis.
            </p>
          </>
        ),
      },
      {
        id: 'how-long',
        title: 'How long we keep it',
        body: (
          <ProseTable
            caption="How long BUKU keeps data"
            head={['Data', 'Kept']}
            rows={[
              [
                'Your account',
                'While you have it. When you delete it: 30 days to change your mind, then your personal data is erased; bookings and ratings stay only without your name.',
              ],
              ['Security records (sign-ins, changes to your account)', '24 months'],
              ['Notifications and their delivery records', '13 months'],
              ['Signed-in sessions', 'Until you sign out, or after 180 days without use'],
              ['Backups', 'Up to 7 days'],
            ]}
          />
        ),
      },
      {
        id: 'your-rights',
        title: 'Your rights and controls',
        body: (
          <ul>
            <li>
              <strong>See and download</strong> everything we hold about you, from your account settings.
            </li>
            <li>
              <strong>Correct</strong> your name and phone number at any time.
            </li>
            <li>
              <strong>Delete</strong> your account: you have 30 days to change your mind by signing in again;
              after that it’s permanent.
            </li>
            <li>
              <strong>Choose your messages</strong>: turn notification types on or off, opt out of suggestions
              and marketing, reply STOP on WhatsApp, or use the unsubscribe link in any email.
            </li>
            <li>
              <strong>Object or complain</strong>: write to{' '}
              <Contact value={facts.email.privacy} kind="email" />, or complain to your data protection
              authority.
            </li>
          </ul>
        ),
      },
      {
        id: 'security',
        title: 'How we protect it',
        body: (
          <p>
            Data is encrypted in transit and at rest, your email and phone number carry an extra layer of
            encryption, and every change to your account is recorded. Read more on the{' '}
            <Link href="/security">security page</Link>.
          </p>
        ),
      },
      {
        id: 'changes',
        title: 'Changes to this notice',
        body: (
          <p>
            If we change how we use personal data in a way that matters, we’ll tell you in BUKU before the
            change takes effect, and show the new version here.
          </p>
        ),
      },
    ],
  };
}

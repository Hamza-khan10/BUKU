import { ProseTable } from '@/components/content/prose';
import type { LegalDocument } from './types';

/**
 * Cookie policy. The list is exactly the cookies the website sets
 * (src/lib/session/policy.ts, src/lib/theme.ts) — keep them in step.
 */
export function cookies(): LegalDocument {
  return {
    title: 'Cookie policy',
    description: 'The few cookies the BUKU website uses, and why there’s no cookie banner.',
    version: '1.0',
    inShort: [
      'The website uses only the cookies it needs to work: keeping you signed in, and remembering your colour theme.',
      'No advertising, analytics or tracking cookies, and none from other companies — so there’s no cookie banner to click through.',
    ],
    sections: [
      {
        id: 'cookies-we-use',
        title: 'The cookies we use',
        body: (
          <>
            <p>
              Over a secure connection the session cookies’ names start with <code>__Host-</code> or{' '}
              <code>__Secure-</code>, which tells your browser to send them only to BUKU, only securely.
            </p>
            <ProseTable
              caption="Cookies set by the BUKU website"
              head={['Cookie', 'What it does', 'How long']}
              rows={[
                [
                  <code key="at">buku_at</code>,
                  'Keeps you signed in while you use the site. Your browser’s scripts can’t read it.',
                  '15 minutes (renewed while you’re active)',
                ],
                [
                  <code key="rt">buku_rt</code>,
                  'Renews your sign-in. Sent only to the part of the site that renews sessions; scripts can’t read it.',
                  'Until you sign out, or 180 days without use',
                ],
                [
                  <code key="s">buku_s</code>,
                  'Says when your sign-in needs renewing, so the site can renew it in time. Holds only a time, nothing about you.',
                  'Same as above',
                ],
                [
                  <code key="t">buku_theme</code>,
                  'Remembers light or dark colours, only if you choose one.',
                  '1 year',
                ],
              ]}
            />
          </>
        ),
      },
      {
        id: 'no-banner',
        title: 'Why there’s no cookie banner',
        body: (
          <p>
            Cookies that are strictly necessary for a service you asked for don’t need consent, and those are
            the only ones we use. If we ever wanted to add another kind, we would ask you first.
          </p>
        ),
      },
      {
        id: 'your-choice',
        title: 'Your choice',
        body: (
          <p>
            You can delete cookies in your browser at any time. Deleting the sign-in cookies signs you out;
            deleting the theme cookie goes back to your device’s setting.
          </p>
        ),
      },
    ],
  };
}

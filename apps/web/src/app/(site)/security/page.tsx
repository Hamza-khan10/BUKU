import { Fingerprint, KeyRound, ListChecks, Lock, ScanSearch, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Contact } from '@/components/content/legal-doc';
import { Prose } from '@/components/content/prose';
import { Container, PageHeading } from '@/components/ui/layout';
import { siteFacts } from '@/lib/site';

export const metadata = {
  title: 'Security',
  description: 'How BUKU protects accounts and data, in plain words, and how to report a vulnerability.',
};

/** Each claim is a control that exists and is tested (docs/SECURITY.md, docs/compliance). */
const CONTROLS: { Icon: LucideIcon; title: string; points: string[] }[] = [
  {
    Icon: Lock,
    title: 'Encryption',
    points: [
      'Everything travels over HTTPS, and browsers are told to never use anything else.',
      'Your email address and phone number get an extra layer of encryption (AES-256-GCM) on top of the database’s own, and are looked up without ever being stored in plain text.',
    ],
  },
  {
    Icon: KeyRound,
    title: 'Signing in',
    points: [
      'Customers sign in with Google. BUKU never holds a password for them.',
      'Business staff passwords are stored only as Argon2id hashes; repeated wrong passwords lock the account for a while.',
      'On this website, sign-in tokens live in cookies that its scripts can’t read.',
      'You can see every device you’re signed in on, and sign any of them out.',
    ],
  },
  {
    Icon: Fingerprint,
    title: 'Two-step sign-in',
    points: [
      'Anyone can add an authenticator app as a second step, with single-use recovery codes.',
      'BUKU’s own staff can’t reach the admin tools without it.',
    ],
  },
  {
    Icon: ListChecks,
    title: 'A record of every change',
    points: [
      'Sign-ins, changes to accounts and businesses, and every admin action are written to a log that can’t be edited or deleted, kept for 24 months.',
      'Who can use the admin tools is reviewed every quarter.',
    ],
  },
  {
    Icon: ShieldCheck,
    title: 'Only what each person needs',
    points: [
      'Businesses see a customer’s name, booking and a reliability label. Never contact details.',
      'Each team member’s role decides what they can do, and the system checks it on every request.',
      'Everything people type is checked before it’s stored; pages only run BUKU’s own scripts.',
    ],
  },
  {
    Icon: ScanSearch,
    title: 'Checked on every change',
    points: [
      'Every change to BUKU’s code is tested and scanned for security problems (code analysis, known-vulnerable dependencies, leaked secrets) before it can go live.',
      'The servers’ software images are scanned for known vulnerabilities on every change.',
    ],
  },
];

export default function SecurityPage() {
  const facts = siteFacts();
  return (
    <Container className="flex flex-col gap-14 py-12 sm:py-16">
      <PageHeading
        eyebrow="Security"
        title="How we keep BUKU safe"
        description="What we actually do to protect your account and your data. No jargon, no vague promises."
      />
      <ul className="grid gap-4 md:grid-cols-2">
        {CONTROLS.map(({ Icon, title, points }) => (
          <li
            key={title}
            className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-6 shadow-soft"
          >
            <span className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-md bg-ok-soft text-ok">
                <Icon className="size-5" aria-hidden />
              </span>
              <h2 className="text-xl tracking-[-0.02em] font-semibold">{title}</h2>
            </span>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-ink-2">
              {points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <section aria-labelledby="report">
        <Prose>
          <h2 id="report">Reporting a vulnerability</h2>
          <p>
            If you think you’ve found a security problem in BUKU, please tell us at{' '}
            <Contact value={facts.email.security} kind="email" /> before telling anyone else, with enough
            detail for us to reproduce it. We’ll confirm we received it and keep you updated while we fix it.
            Please don’t access other people’s data or disrupt the service while testing.
          </p>
        </Prose>
      </section>
    </Container>
  );
}

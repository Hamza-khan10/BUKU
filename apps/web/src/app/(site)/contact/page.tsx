import { Building2, LifeBuoy, Lock, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Contact } from '@/components/content/legal-doc';
import { Container, PageHeading } from '@/components/ui/layout';
import { siteFacts } from '@/lib/site';

export const metadata = {
  title: 'Contact',
  description: 'How to reach BUKU: support, privacy and security.',
};

function Way({ Icon, title, children }: { Icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-6 shadow-soft">
      <span className="grid size-11 place-items-center rounded-md bg-sunken text-ink-2">
        <Icon className="size-5" aria-hidden />
      </span>
      <h2 className="text-xl tracking-[-0.02em] font-semibold">{title}</h2>
      <div className="text-ink-2 [&_a]:font-medium [&_a]:text-brand-ink [&_a]:underline [&_a]:underline-offset-4">
        {children}
      </div>
    </li>
  );
}

export default function ContactPage() {
  const facts = siteFacts();
  return (
    <Container className="flex flex-col gap-12 py-12 sm:py-16">
      <PageHeading
        eyebrow="Contact"
        title="Talk to us"
        description="Questions about a booking itself (times, prices, what to bring) are best asked to the business. Their phone number and website are on their BUKU page."
      />
      <ul className="grid gap-4 sm:grid-cols-2">
        <Way Icon={LifeBuoy} title="Help with BUKU">
          <p>
            Most answers are in the <Link href="/help">help centre</Link>. Otherwise:{' '}
            <Contact value={facts.email.support} kind="email" />.
          </p>
        </Way>
        <Way Icon={Building2} title="Businesses">
          <p>
            Questions about listing your business, verification or plans:{' '}
            <Contact value={facts.email.support} kind="email" />.
          </p>
        </Way>
        <Way Icon={Lock} title="Privacy">
          <p>
            Your data and your rights: <Contact value={facts.email.privacy} kind="email" />. See also the{' '}
            <Link href="/legal/privacy">privacy notice</Link>.
          </p>
        </Way>
        <Way Icon={ShieldCheck} title="Security">
          <p>
            Found a vulnerability? <Contact value={facts.email.security} kind="email" />. Read how we protect
            BUKU on the <Link href="/security">security page</Link>.
          </p>
        </Way>
      </ul>
      {facts.legalName && (
        <p className="text-sm text-ink-3">
          BUKU is run by {facts.legalName}
          {facts.legalAddress ? `, ${facts.legalAddress}` : ''}.
        </p>
      )}
    </Container>
  );
}

import type { Route } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Container, PageHeading } from '@/components/ui/layout';
import { LEGAL_DOCUMENTS, LEGAL_SLUGS } from '@/content/legal';
import { siteFacts } from '@/lib/site';

export const metadata = {
  title: 'Legal',
  description: 'BUKU’s privacy notice, terms, cookie policy and other legal documents.',
};

export default function LegalIndex() {
  const facts = siteFacts();
  return (
    <Container className="flex flex-col gap-10 py-12 sm:py-16">
      <PageHeading
        eyebrow="Legal"
        title="The fine print, in plain words"
        description="Each document starts with a short summary, and says exactly what BUKU does."
      />
      <ul className="grid gap-3 sm:grid-cols-2">
        {LEGAL_SLUGS.map((slug) => {
          const doc = LEGAL_DOCUMENTS[slug]!(facts);
          return (
            <li key={slug}>
              <Link
                href={`/legal/${slug}` as Route}
                className="group flex h-full items-start justify-between gap-4 rounded-lg border border-line bg-surface p-5 shadow-soft transition-shadow hover:shadow-lift"
              >
                <span className="flex flex-col gap-1">
                  <span className="text-lg tracking-[-0.015em] font-semibold">{doc.title}</span>
                  <span className="text-sm text-ink-2">{doc.description}</span>
                </span>
                <ChevronRight
                  className="mt-1 size-5 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </Container>
  );
}

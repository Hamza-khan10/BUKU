import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LegalDoc } from '@/components/content/legal-doc';
import { LEGAL_DOCUMENTS } from '@/content/legal';
import { siteFacts } from '@/lib/site';

function documentFor(slug: string) {
  const make = Object.hasOwn(LEGAL_DOCUMENTS, slug) ? LEGAL_DOCUMENTS[slug] : undefined;
  return make?.(siteFacts());
}

export async function generateMetadata({ params }: PageProps<'/legal/[doc]'>): Promise<Metadata> {
  const doc = documentFor((await params).doc);
  return doc ? { title: doc.title, description: doc.description } : {};
}

export default async function LegalPage({ params }: PageProps<'/legal/[doc]'>) {
  const doc = documentFor((await params).doc);
  if (!doc) notFound();
  return (
    <LegalDoc
      title={doc.title}
      version={doc.version}
      reviewed={siteFacts().legalReviewed}
      inShort={doc.inShort}
      sections={doc.sections}
    />
  );
}

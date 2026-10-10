import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Container } from '@/components/ui/layout';
import { Prose } from './prose';

export interface LegalSection {
  /** Anchor, so any section can be linked to: /legal/privacy#your-rights. */
  id: string;
  title: string;
  body: ReactNode;
}

/**
 * A legal document laid out for reading: what it is, its version and status,
 * the main points in plain words first, then a linkable table of contents and
 * the full text. Drafts say so plainly until a lawyer has reviewed them.
 */
export function LegalDoc({
  title,
  version,
  reviewed,
  inShort,
  sections,
}: {
  title: string;
  version: string;
  reviewed: boolean;
  inShort: ReactNode[];
  sections: LegalSection[];
}) {
  return (
    <Container className="py-12 sm:py-16">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav aria-label="On this page" className="sticky top-24 flex flex-col gap-1 text-sm">
            <p className="mb-2 font-semibold text-ink">On this page</p>
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="rounded-sm py-1 text-ink-2 hover:text-ink">
                {s.title}
              </a>
            ))}
          </nav>
        </aside>

        <article className="min-w-0">
          <header className="flex flex-col gap-3">
            <p className="text-sm font-medium text-brand-ink">Legal</p>
            <h1 className="text-4xl font-semibold tracking-[-0.03em]">{title}</h1>
            <p className="text-sm text-ink-3">
              Version {version} · {reviewed ? 'In effect' : 'Draft — not yet in effect'}
            </p>
          </header>

          {!reviewed && (
            <Alert tone="wait" className="mt-6 max-w-[70ch]" title="This is a draft">
              It describes exactly how BUKU works today, and is being reviewed by a lawyer before BUKU opens
              to the public. The final version will be published here, and you’ll be asked to agree to it.
            </Alert>
          )}

          <section
            aria-labelledby="in-short"
            className="mt-8 max-w-[70ch] rounded-lg bg-surface p-6 shadow-soft"
          >
            <h2 id="in-short" className="text-lg tracking-[-0.015em] font-semibold">
              In short
            </h2>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-ink-2">
              {inShort.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          </section>

          <Prose className="mt-4">
            {sections.map((s) => (
              <section key={s.id} aria-labelledby={s.id}>
                <h2 id={s.id}>{s.title}</h2>
                {s.body}
              </section>
            ))}
          </Prose>
        </article>
      </div>
    </Container>
  );
}

/** A contact detail that may not be published yet (never a made-up address). */
export function Contact({ value, kind }: { value: string | null; kind: 'email' | 'text' }) {
  if (!value) return <em>published here before launch</em>;
  return kind === 'email' ? <a href={`mailto:${value}`}>{value}</a> : <>{value}</>;
}

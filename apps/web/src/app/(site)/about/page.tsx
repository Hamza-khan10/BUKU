import { Clock, Eye, Globe, Scale } from 'lucide-react';
import { Container, PageHeading } from '@/components/ui/layout';

export const metadata = {
  title: 'About',
  description: 'Why BUKU exists, and the principles it’s built on.',
};

const PRINCIPLES = [
  {
    Icon: Clock,
    title: 'Your time matters',
    text: 'Fewest steps to a booking, real free times only, reminders that arrive when they help — and a queue you can watch instead of stand in.',
  },
  {
    Icon: Eye,
    title: 'Only the truth',
    text: 'Reviews only from real visits. Numbers from real data. A business that hasn’t been checked says “Not verified”. No fake scarcity, no made-up countdowns.',
  },
  {
    Icon: Scale,
    title: 'Fair both ways',
    text: 'Businesses see how reliably a customer turns up; customers see how reliably a business keeps its bookings. Neither sees more than they need.',
  },
  {
    Icon: Globe,
    title: 'For everyone, everywhere',
    text: 'Names in any script, prices in local currencies, times in the business’s own timezone. Starting in Pakistan, built to work anywhere.',
  },
];

export default function AboutPage() {
  return (
    <Container className="flex flex-col gap-16 py-12 sm:py-16">
      <PageHeading
        eyebrow="About BUKU"
        title="Nobody should wait without knowing how long"
        description="Getting a haircut, seeing a doctor or renewing a document often means calling around or standing in line. BUKU replaces that with a time you choose, or a place in line you can see from wherever you are."
      />
      <section aria-labelledby="principles" className="flex flex-col gap-8">
        <h2 id="principles" className="font-display text-3xl font-bold tracking-tight">
          What we build on
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {PRINCIPLES.map(({ Icon, title, text }) => (
            <li
              key={title}
              className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-6 shadow-soft"
            >
              <span className="grid size-11 place-items-center rounded-md bg-brand-soft text-brand-ink">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="font-display text-xl font-semibold">{title}</h3>
              <p className="text-ink-2">{text}</p>
            </li>
          ))}
        </ul>
      </section>
    </Container>
  );
}

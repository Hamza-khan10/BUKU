'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CalendarCheck, Ticket as TicketIcon } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Ticket } from '@/components/ui/ticket';
import { cn } from '@/lib/cn';

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * "Two ways to stop waiting", told as you scroll (the page's one GSAP story,
 * D-093): on wide screens the picture stays put while the steps pass, and
 * each step, reaching the middle of the screen, shows its moment. The
 * pictures are BUKU's own components with example content (labelled as such).
 * On phones, and under reduced motion, each step simply sits beside its
 * picture; nothing is pinned or scrubbed.
 */

type Path = 'book' | 'queue';
interface Step {
  path: Path;
  title: string;
  text: string;
}

const STEPS: Step[] = [
  { path: 'book', title: 'Pick a free time', text: 'Only the business’s real free times show. Tap one.' },
  {
    path: 'book',
    title: 'Get your ticket',
    text: 'A code, the time and the place, with reminders before you go.',
  },
  { path: 'book', title: 'Show the code', text: 'The front desk scans it. Review your visit afterwards.' },
  { path: 'queue', title: 'Take a number', text: 'Join from nearby, before you set off.' },
  { path: 'queue', title: 'Watch it move', text: 'See how many are ahead of you, live, wherever you are.' },
  { path: 'queue', title: 'Come in when called', text: 'A nudge when you’re close. Walk in at your turn.' },
];

function Picture({ index }: { index: number }): ReactNode {
  switch (index) {
    case 0:
      return (
        <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-lift">
          <p className="text-sm text-ink-3">Haircut, Thursday</p>
          <ul aria-label="Free times (example)" className="mt-4 flex flex-wrap gap-2">
            {['10:00', '10:30', '11:30', '12:00', '14:30', '15:00'].map((t) => (
              <li
                key={t}
                className={cn(
                  'tabular inline-flex h-11 min-w-[5.5rem] items-center justify-center rounded-full border px-4 font-medium',
                  t === '10:30'
                    ? 'border-brand bg-brand text-on-brand shadow-soft'
                    : 'border-line bg-surface text-ink',
                )}
              >
                {t}
              </li>
            ))}
          </ul>
        </div>
      );
    case 1:
    case 2:
      return (
        <Ticket
          qr={index === 2}
          title="Haircut with Ali"
          place="A barber near you"
          when="Thu 10:30 to 11:00"
          details={<span>Pay at the venue</span>}
          code="BK-7KQ2MX"
          codeLabel="Booking code"
          status={index === 2 ? { label: 'Checked in', tone: 'ok' } : { label: 'Confirmed', tone: 'ok' }}
        />
      );
    default: {
      const story = [
        { serving: '07', line: 'You’re number 10', tone: 'wait' },
        { serving: '08', line: '2 ahead of you. About 8 minutes.', tone: 'wait' },
        { serving: '10', line: 'It’s your turn.', tone: 'go' },
      ][index - 3]!;
      return (
        <div className="w-full max-w-md rounded-2xl bg-night p-7 text-[#edf2ef] shadow-lift ring-1 ring-white/8">
          <p className="text-sm text-[#b9c2bd]">Now serving</p>
          <p className="tabular mt-2 text-[4.5rem] leading-none font-semibold tracking-[-0.04em]">
            {story.serving}
          </p>
          <p
            className={cn(
              'mt-6 border-t border-white/10 pt-5 text-lg font-medium',
              story.tone === 'go' ? 'text-[#5ed3a8]' : 'text-[#f2b655]',
            )}
          >
            {story.line}
          </p>
        </div>
      );
    }
  }
}

export function HowItGoes() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      // Only on wide screens, and only for people who haven't asked for less motion.
      mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
        gsap.utils.toArray<HTMLElement>('[data-step]').forEach((el, i) => {
          ScrollTrigger.create({
            trigger: el,
            start: 'top 55%',
            end: 'bottom 55%',
            onToggle: (self) => {
              if (self.isActive) setActive(i);
            },
          });
        });
        // The line beside the steps fills as the story goes.
        gsap.fromTo(
          '[data-progress]',
          { scaleY: 0 },
          {
            scaleY: 1,
            ease: 'none',
            scrollTrigger: { trigger: '[data-steps]', start: 'top 55%', end: 'bottom 55%', scrub: true },
          },
        );
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} aria-labelledby="how" className="flex flex-col gap-10">
      <div className="flex max-w-2xl flex-col gap-4">
        <h2
          id="how"
          className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[3rem]"
        >
          Two ways to stop waiting.
        </h2>
        <p className="text-lg leading-relaxed text-ink-2">
          Book a time when it suits you, or join the queue and come in when it’s your turn.
        </p>
      </div>

      <div className="grid gap-12 lg:motion-safe:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:motion-safe:gap-20">
        <ol data-steps className="relative flex flex-col lg:motion-safe:pl-10">
          {/* The progress line (wide screens). */}
          <span
            aria-hidden
            className="absolute top-0 bottom-0 left-0 hidden w-px bg-line lg:motion-safe:block"
          >
            <span data-progress className="block h-full w-full origin-top scale-y-0 bg-brand" />
          </span>
          {STEPS.map((step, i) => {
            const firstOfPath = i === 0 || STEPS[i - 1]!.path !== step.path;
            const Icon = step.path === 'book' ? CalendarCheck : TicketIcon;
            return (
              <li
                key={step.title}
                data-step
                className={cn(
                  'group/step flex flex-col gap-5 py-6',
                  'lg:motion-safe:min-h-[52vh] lg:motion-safe:justify-center',
                  firstOfPath && i > 0 && 'mt-10 lg:mt-0',
                )}
                data-on={active === i}
              >
                {firstOfPath && (
                  <p className="inline-flex items-center gap-2 text-sm font-medium text-ink-2">
                    <Icon className="size-4" aria-hidden />
                    {step.path === 'book' ? 'Book a time' : 'Join the queue'}
                  </p>
                )}
                <div className="flex flex-col gap-2">
                  <h3 className="text-2xl font-semibold tracking-[-0.025em] transition-colors duration-500 sm:text-[1.75rem] lg:motion-safe:text-ink-3 lg:motion-safe:group-data-[on=true]/step:text-ink">
                    {step.title}
                  </h3>
                  <p className="max-w-md text-lg leading-relaxed text-ink-2 transition-colors duration-500 lg:motion-safe:text-ink-3 lg:motion-safe:group-data-[on=true]/step:text-ink-2">
                    {step.text}
                  </p>
                </div>
                {/* Phones, and wide screens under reduced motion: the picture sits with its step. */}
                <div className="lg:motion-safe:hidden">
                  <Picture index={i} />
                </div>
              </li>
            );
          })}
        </ol>

        <div className="hidden lg:motion-safe:block">
          <div className="sticky top-28 flex min-h-[28rem] flex-col items-center justify-center gap-4">
            <div className="grid w-full place-items-center">
              {STEPS.map((step, i) => (
                <div
                  key={step.title}
                  aria-hidden={active !== i}
                  className={cn(
                    'col-start-1 row-start-1 flex w-full justify-center transition-[opacity,transform,filter] duration-700 ease-(--ease-out)',
                    active === i
                      ? 'opacity-100'
                      : 'pointer-events-none translate-y-3 scale-[0.98] opacity-0 blur-[2px]',
                  )}
                >
                  <Picture index={i} />
                </div>
              ))}
            </div>
            <p className="text-sm text-ink-3">Examples of what you see on BUKU</p>
          </div>
        </div>
      </div>
    </section>
  );
}

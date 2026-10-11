'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Search } from 'lucide-react';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LogoMark } from '@/components/brand/logo';
import { SplitFlap } from '@/components/motion/split-flap';
import { useReducedMotion } from '@/components/motion/use-reduced-motion';
import { cn } from '@/lib/cn';

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * "Two ways to stop waiting", told on a phone as you scroll (D-094): a Midnight
 * panel opens out to fill the screen, the phone stays in view, and its screen
 * plays BUKU's flow, step by step, as the page moves: find a place, pick a free
 * time, get your ticket, take a number and watch it count down, your turn. On
 * phones too. The screens are an illustration of the app (labelled as one); the
 * captions carry the words for everyone. Under reduced motion nothing is pinned
 * or scrubbed: the steps sit one after another.
 */

const STEPS = [
  {
    title: 'Find a place',
    text: 'Barbers, clinics, salons and offices near you, with what’s free right now.',
  },
  { title: 'Pick a free time', text: 'Only real free times show. Tap one and it’s yours.' },
  { title: 'Get your ticket', text: 'A code and reminders, so there’s nothing to remember.' },
  { title: 'Or take a number', text: 'Join the queue from home and watch the line move.' },
  { title: 'Come in at your turn', text: 'A nudge when you’re close. Walk in, skip the waiting room.' },
] as const;

const TIMES = ['10:00', '10:30', '11:00', '11:30', '12:00', '14:30'];
const PLACES = [
  { name: 'Barbershop', meta: '0.4 km', tag: 'Free at 10:30', tone: 'go' },
  { name: 'Hair salon', meta: '1.1 km', tag: '3 waiting', tone: 'wait' },
  { name: 'Grooming studio', meta: '2.0 km', tag: 'Free at 11:00', tone: 'go' },
] as const;

/** One screen of the phone: what the app shows at each step. */
function Screen({ step, serving }: { step: number; serving: number }): ReactNode {
  switch (step) {
    case 0:
      return (
        <div className="flex h-full flex-col gap-3 px-4 pt-3">
          <p className="text-[0.95rem] font-semibold tracking-[-0.01em] text-ink">Barbers near you</p>
          <div className="flex h-9 items-center gap-2 rounded-full border border-control bg-surface px-3 text-xs text-ink-3">
            <Search className="size-3.5" aria-hidden /> Haircut
          </div>
          <ul className="flex flex-col gap-2">
            {PLACES.map((p, i) => (
              <li
                key={p.name}
                className="story-in flex items-center gap-3 rounded-2xl bg-surface p-2.5 shadow-soft"
                style={{ '--i': i } as CSSProperties}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-sm font-semibold text-brand-ink">
                  {p.name[0]}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-[0.8rem] font-semibold text-ink">{p.name}</span>
                  <span className="flex items-center gap-1.5 text-[0.62rem] text-ink-3">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 font-semibold',
                        p.tone === 'go' ? 'bg-brand-soft text-brand-ink' : 'bg-wait-soft text-wait-ink',
                      )}
                    >
                      {p.tag}
                    </span>
                    <span className="tabular">{p.meta}</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    case 1:
      return (
        <div className="flex h-full flex-col gap-3 px-4 pt-3">
          <p className="text-[0.95rem] font-semibold tracking-[-0.01em] text-ink">Haircut</p>
          <p className="-mt-2 text-xs text-ink-3">Thursday, with anyone available</p>
          <ul className="grid grid-cols-3 gap-2">
            {TIMES.map((t, i) => (
              <li
                key={t}
                className={cn(
                  'story-in tabular flex h-9 items-center justify-center rounded-full border text-[0.78rem] font-medium',
                  t === '10:30'
                    ? 'story-pick border-brand bg-brand text-on-brand'
                    : 'border-line bg-surface text-ink',
                )}
                style={{ '--i': i } as CSSProperties}
              >
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-auto mb-5 flex h-10 items-center justify-center rounded-full bg-brand text-[0.82rem] font-semibold text-on-brand">
            Book 10:30
          </div>
        </div>
      );
    case 2:
      return (
        <div className="flex h-full flex-col gap-3 px-4 pt-3">
          <div className="story-print overflow-hidden rounded-2xl bg-surface shadow-lift">
            <div className="bg-brand px-3 py-1.5 text-[0.72rem] font-semibold text-on-brand">Confirmed</div>
            <div className="flex flex-col gap-1 p-3">
              <span className="text-[0.68rem] text-ink-3">A barber near you</span>
              <span className="text-[1.05rem] leading-tight font-semibold tracking-[-0.02em] text-ink">
                Haircut
              </span>
              <span className="tabular text-[0.8rem] text-ink">Thu 10:30 to 11:00</span>
            </div>
            <div className="mx-3 border-t-2 border-dashed border-line" />
            <div className="flex flex-col items-center gap-1 p-3">
              <span className="text-[0.62rem] text-ink-3">Booking code</span>
              <span className="font-mono text-[1.05rem] font-bold tracking-wider text-ink">BK-7KQ2MX</span>
            </div>
          </div>
          <div
            className="story-in flex items-center gap-2 rounded-2xl bg-wait-soft p-2.5 text-[0.7rem] text-wait-ink"
            style={{ '--i': 3 } as CSSProperties}
          >
            <span className="size-2 shrink-0 rounded-full bg-wait" /> Reminder the day before, and 2 hours
            before
          </div>
        </div>
      );
    case 3:
      return (
        <div className="flex h-full flex-col gap-3 px-4 pt-3">
          <p className="text-[0.95rem] font-semibold tracking-[-0.01em] text-ink">You’re in the queue</p>
          <div className="rounded-2xl bg-board p-3.5 text-board-ink">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <span className="text-[0.62rem] text-board-ink-2">Now serving</span>
                <SplitFlap value={String(serving).padStart(2, '0')} className="text-[2.1rem] font-semibold" />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-[0.62rem] text-board-ink-2">Your number</span>
                <SplitFlap
                  value="10"
                  className="text-[2.1rem] font-semibold"
                  style={{ '--flap-ink': 'var(--color-board-spark)' } as CSSProperties}
                />
              </div>
            </div>
            <p className="mt-3 border-t border-white/10 pt-2.5 text-[0.78rem] font-medium">
              {serving >= 9 ? 'You’re next.' : `${10 - serving} ahead of you.`}
            </p>
          </div>
          <p className="text-[0.7rem] text-ink-3">This page moves by itself. Keep it open, or get a nudge.</p>
        </div>
      );
    default:
      return (
        <div className="story-turn flex h-full flex-col items-center justify-center gap-4 bg-brand px-5 text-center text-on-brand">
          <span className="story-pulse grid size-24 place-items-center rounded-[1.75rem] bg-white/12">
            <LogoMark reversed className="size-16" />
          </span>
          <span className="text-[1.6rem] leading-tight font-semibold tracking-[-0.03em]">
            It’s your turn.
          </span>
          <span className="text-[0.82rem] opacity-90">Go to the counter. Number 10.</span>
        </div>
      );
  }
}

/**
 * A phone, drawn in CSS: a bezel, the island, and the app in BUKU's light look (both themes).
 * Every screen stays mounted so the one leaving can fade out; the one arriving plays its
 * entrance (the animations run under [data-active='true']). `still` shows one screen only.
 */
function Phone({
  step,
  serving,
  still = false,
  className,
}: {
  step: number;
  serving: number;
  still?: boolean;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'scope-light relative aspect-[9/19] rounded-[2.6rem] bg-[#0a0f0d] p-[0.55rem] shadow-[0_40px_80px_-20px_rgb(0_0_0/0.6)] ring-1 ring-white/15',
        className,
      )}
    >
      <div className="relative h-full overflow-hidden rounded-[2.1rem] bg-canvas">
        <div className="flex h-9 items-center justify-between px-6 text-[0.62rem] font-semibold text-ink">
          <span className="tabular">10:24</span>
          <span className="h-[1.15rem] w-[4.6rem] rounded-full bg-[#0a0f0d]" />
          <span className="flex items-center gap-1">
            <LogoMark className="size-3.5" />
          </span>
        </div>
        {STEPS.map((s, i) =>
          still && i !== step ? null : (
            <div
              key={s.title}
              className={cn(
                'absolute inset-x-0 top-9 bottom-0 transition-[opacity,transform,filter] duration-500 ease-(--ease-out)',
                i === step ? 'opacity-100' : 'pointer-events-none opacity-0',
                i < step && '-translate-y-6 blur-[2px]',
                i > step && 'translate-y-6',
              )}
              data-active={i === step}
            >
              <Screen step={i} serving={serving} />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

export function ScrollStory() {
  const reduce = useReducedMotion();
  const root = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const [serving, setServing] = useState(7);
  // The cinematic version only where motion is welcome. The server assumes "less motion",
  // so the first paint is the still version and the browser upgrades it.
  const cinematic = !reduce;

  useGSAP(
    () => {
      if (!cinematic) return;
      ScrollTrigger.config({ ignoreMobileResize: true });
      let lastStep = -1;
      let lastServing = -1;
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: '[data-story-stage]',
          start: 'top top',
          end: () => `+=${window.innerHeight * STEPS.length * 0.85}`,
          pin: true,
          scrub: 0.5,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            const at = self.progress * STEPS.length;
            const i = Math.min(STEPS.length - 1, Math.floor(at));
            if (i !== lastStep) setStep((lastStep = i));
            // While on "take a number", the line moves with the scroll: 7, 8, 9.
            const n = i < 3 ? 7 : i > 3 ? 10 : 7 + Math.min(2, Math.floor((at - 3) * 3));
            if (n !== lastServing) setServing((lastServing = n));
          },
        },
      });
      tl.fromTo(
        '[data-story-panel]',
        { clipPath: 'inset(7% 5% 7% 5% round 36px)' },
        { clipPath: 'inset(0% 0% 0% 0% round 0px)', ease: 'none', duration: 0.14 },
      )
        .fromTo(
          '[data-story-phone]',
          { yPercent: 8, scale: 0.9 },
          { yPercent: 0, scale: 1, ease: 'none', duration: 0.14 },
          0,
        )
        .to({}, { duration: 0.86 });
      return () => tl.scrollTrigger?.kill();
    },
    { scope: root, dependencies: [cinematic] },
  );

  if (!cinematic) {
    return (
      <section aria-labelledby="how" className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-10 rounded-2xl bg-board p-6 text-board-ink sm:p-10">
          <h2
            id="how"
            className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[3rem]"
          >
            Two ways to stop waiting.
          </h2>
          <ol className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-4">
                <Phone step={i} serving={i === 3 ? 8 : 7} still className="mx-auto w-[15rem] max-w-full" />
                <div className="flex flex-col gap-1">
                  <h3 className="text-xl font-semibold tracking-[-0.02em]">{s.title}</h3>
                  <p className="text-board-ink-2">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    );
  }

  return (
    <section ref={root} aria-labelledby="how" className="relative">
      <div data-story-stage className="relative h-[100svh] overflow-hidden">
        <div
          data-story-panel
          aria-hidden
          className="absolute inset-0 bg-board"
          style={{ clipPath: 'inset(7% 5% 7% 5% round 36px)' }}
        />
        <div className="relative mx-auto grid h-full w-full max-w-6xl grid-rows-[auto_minmax(0,1fr)] items-center gap-5 px-7 pt-[max(4.75rem,9svh)] pb-[max(1.5rem,5svh)] text-board-ink sm:px-10 lg:grid-cols-[minmax(0,1fr)_19rem] lg:grid-rows-1 lg:gap-20 lg:py-10">
          <div className="flex flex-col gap-5 lg:gap-8">
            <h2 id="how" className="text-[1.05rem] font-medium text-board-ink-2 lg:text-lg">
              Two ways to stop waiting
            </h2>
            {/* Phones: the current step only. Wide screens: the whole list, current one lit. */}
            <ol className="relative flex flex-col lg:gap-5">
              {STEPS.map((s, i) => (
                <li
                  key={s.title}
                  aria-current={i === step ? 'step' : undefined}
                  className={cn(
                    'flex flex-col gap-1.5 transition-[opacity,transform] duration-500 ease-(--ease-out)',
                    i === step
                      ? 'opacity-100'
                      : 'max-lg:pointer-events-none max-lg:absolute max-lg:inset-x-0 max-lg:top-0 max-lg:translate-y-3 max-lg:opacity-0',
                  )}
                >
                  <h3
                    className={cn(
                      'text-[1.85rem] leading-[1.05] font-semibold tracking-[-0.035em] transition-colors duration-500 sm:text-[2.4rem]',
                      i === step ? 'text-board-ink' : 'lg:text-board-ink-2',
                    )}
                  >
                    <span
                      className={cn(
                        'tabular mr-3 text-[0.55em] align-middle',
                        i === step ? 'text-board-spark' : 'text-board-ink-2',
                      )}
                    >
                      {i + 1}
                    </span>
                    {s.title}
                  </h3>
                  <p
                    className={cn(
                      'max-w-md text-[1.02rem] leading-relaxed text-board-ink-2',
                      i !== step && 'lg:hidden',
                    )}
                  >
                    {s.text}
                  </p>
                </li>
              ))}
            </ol>
            <div aria-hidden className="h-1 w-full max-w-md overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-board-spark transition-[width] duration-500 ease-(--ease-out)"
                style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
              />
            </div>
          </div>
          <div data-story-phone className="flex h-full min-h-0 flex-col items-center justify-center gap-3">
            <Phone
              step={step}
              serving={serving}
              className="h-[min(36rem,calc(100%-2rem))] max-w-full shrink-0"
            />
            <p className="text-xs text-board-ink-2">An example of BUKU on your phone</p>
          </div>
        </div>
      </div>
    </section>
  );
}

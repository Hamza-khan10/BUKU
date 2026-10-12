'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useRef, useState } from 'react';
import { useReducedMotion } from '@/components/motion/use-reduced-motion';
import { cn } from '@/lib/cn';
import { FittedPhone, SCREEN_COUNT } from './story-phone';

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * "Two ways to stop waiting", told on a phone as you scroll (D-094, reworked in D-095).
 * The Midnight stage stays put while the phone plays BUKU's flow, step by step: find a place,
 * pick a free time, get your ticket, take a number and watch it count down, your turn.
 *
 * Phones first: the stage comes up full-width (nothing shrinks or closes in), the phone is
 * the one design scaled to the space left (see story-phone), and the captions share one
 * slot as tall as the longest, so the phone never changes size between steps. The screens
 * are an illustration (labelled as one); the captions carry the words for everyone. Under
 * reduced motion nothing is pinned or scrubbed: the five screens sit one after another.
 */

const STEPS = [
  { title: 'Find a place', text: 'Barbers, clinics, salons and offices near you, with what’s free now.' },
  { title: 'Pick a free time', text: 'Only real free times show. Tap one and it’s yours.' },
  { title: 'Get your ticket', text: 'A code and a reminder, so there’s nothing to remember.' },
  { title: 'Or take a number', text: 'Join the queue from wherever you are and watch the line move.' },
  { title: 'Come in at your turn', text: 'A nudge when you’re next. Walk in, skip the waiting room.' },
] as const;

if (STEPS.length !== SCREEN_COUNT) throw new Error('Every step needs a screen.');

/** One segment per step: how far along, at a glance. */
function Progress({ step, className }: { step: number; className?: string }) {
  return (
    <div aria-hidden className={cn('flex gap-1.5', className)}>
      {STEPS.map((s, i) => (
        <span key={s.title} className="h-1 flex-1 overflow-hidden rounded-full bg-white/12">
          <span
            className={cn(
              'block h-full origin-left rounded-full bg-board-spark transition-transform duration-500 ease-(--ease-out)',
              i <= step ? 'scale-x-100' : 'scale-x-0',
            )}
          />
        </span>
      ))}
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

      // The story: pinned for five screens' worth of scrolling, one step per screen.
      ScrollTrigger.create({
        trigger: '[data-story-stage]',
        start: 'top top',
        end: () => `+=${window.innerHeight * STEPS.length * 0.8}`,
        pin: true,
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
      });

      // On the way in, the phone rises into place (and sinks back on the way out). Movement
      // only: it is never see-through, so its text keeps its full contrast.
      gsap.fromTo(
        '[data-story-phone]',
        { yPercent: 14 },
        {
          yPercent: 0,
          ease: 'none',
          scrollTrigger: { trigger: '[data-story-stage]', start: 'top 90%', end: 'top 15%', scrub: 0.6 },
        },
      );

      // Wide screens only: the stage opens out to the edges as it arrives. On a phone it is
      // already full-width, so nothing narrows or closes in.
      const mm = gsap.matchMedia();
      mm.add('(min-width: 1024px)', () => {
        gsap.fromTo(
          '[data-story-panel]',
          { clipPath: 'inset(0% 3% 0% 3% round 40px)' },
          {
            clipPath: 'inset(0% 0% 0% 0% round 0px)',
            ease: 'none',
            scrollTrigger: { trigger: '[data-story-stage]', start: 'top 80%', end: 'top top', scrub: 0.6 },
          },
        );
      });
      return () => mm.revert();
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
                <FittedPhone step={i} serving={8} still max={0.75} className="h-[30rem] w-full" />
                <div className="flex flex-col gap-1">
                  <h3 className="text-xl font-semibold tracking-[-0.02em]">
                    <span className="tabular mr-2 text-board-spark">{i + 1}</span>
                    {s.title}
                  </h3>
                  <p className="text-board-ink-2">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="text-xs text-board-ink-2">An example of BUKU on your phone</p>
        </div>
      </section>
    );
  }

  return (
    <section ref={root} aria-labelledby="how" className="relative">
      <div data-story-stage data-tone="dark" className="relative h-[100svh] overflow-hidden">
        <div
          data-story-panel
          aria-hidden
          className="absolute inset-0 rounded-t-[2rem] bg-board lg:rounded-none"
        />
        <div className="relative mx-auto grid h-full w-full max-w-6xl grid-rows-[auto_minmax(0,1fr)] gap-4 px-6 pt-[calc(4rem+max(1rem,3svh))] pb-[max(0.75rem,2svh)] text-board-ink sm:px-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:grid-rows-1 lg:items-center lg:gap-16 lg:py-10">
          <div className="flex flex-col gap-3 sm:gap-5 lg:gap-8">
            <div className="flex items-center justify-between gap-4">
              <h2 id="how" className="text-[0.95rem] font-medium text-board-ink-2 lg:text-lg">
                Two ways to stop waiting
              </h2>
              <Progress step={step} className="w-24 lg:hidden" />
            </div>
            <Progress step={step} className="max-lg:hidden lg:order-last lg:max-w-md" />
            {/* Phones: one slot, as tall as the longest step, the current one shown. Wide
                screens: the whole list, the current one lit. */}
            <ol className="grid lg:flex lg:flex-col lg:gap-5">
              {STEPS.map((s, i) => (
                <li
                  key={s.title}
                  aria-current={i === step ? 'step' : undefined}
                  className={cn(
                    'flex flex-col gap-1.5 transition-[opacity,transform] duration-500 ease-(--ease-out) max-lg:[grid-area:1/1]',
                    i === step
                      ? 'opacity-100'
                      : cn(
                          'max-lg:pointer-events-none max-lg:opacity-0',
                          i < step ? 'max-lg:-translate-y-2' : 'max-lg:translate-y-2',
                        ),
                  )}
                >
                  <h3
                    className={cn(
                      'text-[1.6rem] leading-[1.08] font-semibold tracking-[-0.035em] transition-colors duration-500 sm:text-[2.1rem] lg:text-[2.4rem] [@media(max-height:700px)]:text-[1.4rem]',
                      i === step ? 'text-board-ink' : 'lg:text-board-ink-2',
                    )}
                  >
                    <span
                      className={cn(
                        'tabular mr-3 align-middle text-[0.55em] max-lg:hidden',
                        i === step ? 'text-board-spark' : 'text-board-ink-2',
                      )}
                    >
                      {i + 1}
                    </span>
                    {s.title}
                  </h3>
                  <p
                    className={cn(
                      'max-w-md text-[1rem] leading-snug text-board-ink-2 sm:text-[1.05rem] max-lg:[@media(max-height:700px)]:hidden',
                      i !== step && 'lg:hidden',
                    )}
                  >
                    {s.text}
                  </p>
                </li>
              ))}
            </ol>
          </div>
          <div data-story-phone className="flex h-full min-h-0 flex-col items-center gap-2 lg:justify-center">
            <FittedPhone
              step={step}
              serving={serving}
              max={1}
              className="w-full flex-1 lg:h-[min(41.5rem,calc(100%-2rem))] lg:flex-none"
            />
            <p className="text-[11px] text-board-ink-2">An example of BUKU on your phone</p>
          </div>
        </div>
      </div>
    </section>
  );
}

'use client';

import { Bell, ChevronLeft, Search, Star } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LogoMark } from '@/components/brand/logo';
import { SplitFlap } from '@/components/motion/split-flap';
import { cn } from '@/lib/cn';

/**
 * The phone in "Two ways to stop waiting" (D-095). Every screen is drawn once, at one fixed
 * size (a 320 × 664 phone), and the whole phone is scaled to the space it has. So a small
 * phone shows the same screen, smaller, never a squashed one: nothing wraps, nothing is cut.
 *
 * Screens move the way the eye expects from a phone, and reverse when scrolling back:
 * the next page pushes in from the right, the queue rises as a sheet over the ticket, and
 * "your turn" opens out from the middle (WEB_PLAN §2, spatial consistency).
 */

export const PHONE_W = 320;
export const PHONE_H = 664;

/** How each screen arrives. */
const ENTER = ['push', 'push', 'push', 'sheet', 'reveal'] as const;
export const SCREEN_COUNT = ENTER.length;

function screenState(i: number, step: number): string {
  if (i === step) return 'here';
  return i > step ? `next-${ENTER[i]}` : `under-${ENTER[step]}`;
}

const PLACES = [
  { name: 'Barbershop', meta: '4.8 · 0.4 km', tag: '10:30', tone: 'go' },
  { name: 'Hair salon', meta: '4.6 · 1.1 km', tag: '3 waiting', tone: 'wait' },
  { name: 'Dental clinic', meta: '4.9 · 2.0 km', tag: '11:00', tone: 'go' },
] as const;
const DAYS = [
  ['Mon', '13'],
  ['Tue', '14'],
  ['Wed', '15'],
  ['Thu', '16'],
  ['Fri', '17'],
] as const;
const TIMES = ['10:00', '10:30', '11:00', '11:30', '12:00', '14:30'];

const stagger = (i: number) => ({ '--i': i }) as CSSProperties;

function TopBar({ title }: { title: string }) {
  return (
    <div className="relative flex h-11 items-center justify-center px-4">
      <ChevronLeft className="absolute left-3 size-6 text-brand" strokeWidth={2.2} aria-hidden />
      <span className="text-[15px] font-semibold tracking-[-0.01em]">{title}</span>
    </div>
  );
}

function FindScreen() {
  return (
    <div className="flex h-full flex-col gap-4 px-5 pt-2">
      <div className="story-in flex flex-col" style={stagger(0)}>
        <span className="text-[12px] text-ink-3">Lahore · Tuesday</span>
        <span className="text-[26px] leading-tight font-semibold tracking-[-0.035em]">Find a place</span>
      </div>
      <div
        className="story-in flex h-11 items-center gap-2 rounded-full bg-surface px-4 text-[15px] shadow-soft ring-1 ring-line"
        style={stagger(1)}
      >
        <Search className="size-4 text-ink-3" strokeWidth={2.2} aria-hidden />
        <span className="story-type">Haircut</span>
      </div>
      <div className="story-in flex gap-1.5 text-[12px] font-medium" style={stagger(2)}>
        <span className="rounded-full bg-ink px-3 py-1.5 text-canvas">Open now</span>
        <span className="rounded-full bg-surface px-3 py-1.5 ring-1 ring-line">Queue</span>
        <span className="rounded-full bg-surface px-3 py-1.5 ring-1 ring-line">Top rated</span>
      </div>
      <ul className="flex flex-col gap-2">
        {PLACES.map((p, i) => (
          <li
            key={p.name}
            className={cn(
              'story-in flex items-center gap-3 rounded-[18px] bg-surface p-2.5 shadow-soft',
              i === 0 && 'story-tap',
            )}
            style={stagger(i + 3)}
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-[13px] bg-brand-soft text-[17px] font-semibold text-brand-ink">
              {p.name[0]}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[14px] font-semibold">{p.name}</span>
              <span className="flex items-center gap-1 text-[12px] text-ink-3">
                <Star className="size-3 fill-current text-ink" aria-hidden /> {p.meta}
              </span>
            </span>
            <span
              className={cn(
                'tabular shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
                p.tone === 'go' ? 'bg-brand-soft text-brand-ink' : 'bg-wait-soft text-wait-ink',
              )}
            >
              {p.tag}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TimeScreen() {
  return (
    <div className="relative flex h-full flex-col">
      <TopBar title="Barbershop" />
      <div className="flex flex-col gap-4 px-5 pt-2">
        <div
          className="story-in flex items-center justify-between rounded-[18px] bg-surface p-3.5 shadow-soft ring-2 ring-brand"
          style={stagger(0)}
        >
          <span className="flex flex-col">
            <span className="text-[15px] font-semibold">Haircut</span>
            <span className="text-[12px] text-ink-3">30 min · with anyone</span>
          </span>
          <span className="tabular text-[15px] font-semibold">Rs 800</span>
        </div>
        <div className="story-in flex flex-col gap-2" style={stagger(1)}>
          <span className="text-[13px] font-semibold">October</span>
          <div className="grid grid-cols-5 gap-1.5">
            {DAYS.map(([d, n]) => (
              <span
                key={n}
                className={cn(
                  'flex h-[58px] flex-col items-center justify-center rounded-[16px] text-[11px]',
                  n === '14' ? 'bg-ink text-canvas' : 'bg-surface text-ink-2 ring-1 ring-line',
                )}
              >
                {d}
                <span className="tabular text-[17px] font-semibold">{n}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="story-in text-[13px] font-semibold" style={stagger(2)}>
            Free times
          </span>
          <ul className="grid grid-cols-3 gap-2">
            {TIMES.map((t, i) => (
              <li
                key={t}
                className={cn(
                  'story-in tabular flex h-10 items-center justify-center rounded-full text-[14px] font-medium',
                  t === '10:30' ? 'story-pick bg-brand text-on-brand' : 'bg-surface ring-1 ring-line',
                )}
                style={stagger(i + 3)}
              >
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="story-cta absolute inset-x-5 bottom-7 flex h-12 items-center justify-center rounded-full bg-brand text-[15px] font-semibold text-on-brand shadow-lift">
        Book Tuesday 10:30
      </div>
    </div>
  );
}

function TicketScreen() {
  return (
    <div className="flex h-full flex-col gap-4 px-5 pt-4">
      <div className="flex items-center gap-3">
        <span className="story-pop grid size-11 shrink-0 place-items-center rounded-full bg-brand text-on-brand">
          <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
            <path
              className="story-draw"
              d="M5 12.5l4.5 4.5L19 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="story-in flex flex-col" style={stagger(1)}>
          <span className="text-[21px] leading-tight font-semibold tracking-[-0.03em]">You’re booked</span>
          <span className="text-[13px] text-ink-2">Tuesday 14 October, 10:30</span>
        </span>
      </div>

      {/* The same ticket as the app's: a band, the visit, a perforation with notches, the stub. */}
      <div className="story-print relative overflow-hidden rounded-[20px] bg-surface shadow-lift">
        <div className="bg-brand px-4 py-2 text-[12px] font-semibold text-on-brand">Confirmed</div>
        <div className="flex flex-col gap-1 px-4 pt-3.5 pb-4">
          <span className="text-[12px] text-ink-3">Barbershop · 0.4 km</span>
          <span className="text-[21px] leading-tight font-semibold tracking-[-0.025em]">Haircut</span>
          <span className="tabular text-[13.5px] font-medium">Tue 14 Oct · 10:30 to 11:00</span>
          <span className="text-[12px] text-ink-2">Pay at the venue · Rs 800</span>
        </div>
        <div aria-hidden className="relative flex items-center">
          <span className="absolute -left-2.5 size-5 rounded-full bg-canvas" />
          <span className="mx-4 h-0 flex-1 border-t-2 border-dashed border-line" />
          <span className="absolute -right-2.5 size-5 rounded-full bg-canvas" />
        </div>
        <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-4">
          <span className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ink-3">Booking code</span>
            <span className="font-mono text-[18px] font-bold tracking-wider">BK-7KQ2MX</span>
            <span className="text-[11px] text-ink-3">Show it at the front desk</span>
          </span>
          <span className="rounded-[10px] bg-white p-1.5 ring-1 ring-line">
            <QRCodeSVG value="BK-7KQ2MX" size={58} level="M" />
          </span>
        </div>
      </div>

      <div
        className="story-in flex items-center gap-2.5 rounded-[16px] bg-wait-soft p-3 text-[12.5px] leading-snug text-wait-ink"
        style={stagger(5)}
      >
        <Bell className="size-4 shrink-0" strokeWidth={2.2} aria-hidden />
        We’ll remind you the day before, and 2 hours before.
      </div>
    </div>
  );
}

function QueueScreen({ serving }: { serving: number }) {
  const ahead = Math.max(0, 10 - serving);
  return (
    <div className="story-sheet flex h-full flex-col">
      <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-line" />
      <div className="flex flex-col gap-4 px-5 pt-3">
        <div className="flex items-center justify-between">
          <span className="flex flex-col">
            <span className="text-[21px] leading-tight font-semibold tracking-[-0.03em]">Walk-in queue</span>
            <span className="text-[12px] text-ink-3">Hair salon · 1.1 km</span>
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-wait-soft px-2.5 py-1 text-[11.5px] font-semibold text-wait-ink">
            <span className="size-1.5 rounded-full bg-wait" /> Live
          </span>
        </div>

        <div className="rounded-[22px] bg-board p-4 text-board-ink shadow-lift">
          <div className="grid grid-cols-2 gap-3">
            <span className="flex flex-col gap-2">
              <span className="text-[11px] text-board-ink-2">Now serving</span>
              <SplitFlap value={String(serving).padStart(2, '0')} className="text-[40px] font-semibold" />
            </span>
            <span className="flex flex-col gap-2">
              <span className="text-[11px] text-board-ink-2">Your number</span>
              <SplitFlap
                value="10"
                className="text-[40px] font-semibold"
                style={{ '--flap-ink': 'var(--color-board-spark)' } as CSSProperties}
              />
            </span>
          </div>
          <p className="tabular mt-3.5 border-t border-white/10 pt-3 text-[13px] font-medium">
            {ahead <= 1 ? 'You’re next. About 4 min.' : `${ahead} ahead of you. About ${ahead * 4} min.`}
          </p>
        </div>

        {/* The line itself: people ahead step up to the counter, and you move along with them. */}
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-medium text-ink-2">Your place in line</span>
          <div className="flex h-12 items-center rounded-[16px] bg-surface px-3 shadow-soft ring-1 ring-line">
            <span className="mr-3 border-r border-line pr-3 text-[11px] font-semibold text-ink-3">
              Counter
            </span>
            {[0, 1, 2].map((k) => {
              const gone = k < 3 - ahead;
              return (
                <span
                  key={k}
                  className={cn(
                    'size-7 shrink-0 rounded-full bg-sunken ring-1 ring-line transition-[width,margin,opacity,transform] duration-500 ease-(--ease-out)',
                    gone ? 'mr-0 w-0 scale-50 opacity-0' : 'mr-2',
                  )}
                />
              );
            })}
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-wait text-[11px] font-bold text-on-wait">
              You
            </span>
          </div>
        </div>
        <p className="text-[12px] leading-snug text-ink-3">
          This page moves by itself. We’ll nudge you when you’re next.
        </p>
      </div>
    </div>
  );
}

function TurnScreen() {
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-4 bg-brand px-6 text-center text-on-brand">
      {/* The nudge arrives the way a phone shows one: dropping in from the top. */}
      <div className="story-drop absolute inset-x-2.5 top-1 flex items-start gap-2.5 rounded-[20px] bg-white/90 p-3 text-left text-ink shadow-lift backdrop-blur">
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-logo">
          <LogoMark reversed className="size-7" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="flex justify-between text-[11.5px] text-ink-3">
            <span className="font-semibold text-ink">BUKU</span> now
          </span>
          <span className="text-[13px] font-semibold">It’s your turn at Hair salon</span>
          <span className="text-[12px] text-ink-2">Number 10. Go to the counter.</span>
        </span>
      </div>
      <span className="story-pulse grid size-24 place-items-center rounded-[28px] bg-white/12">
        <LogoMark reversed className="size-16" />
      </span>
      <span className="text-[30px] leading-tight font-semibold tracking-[-0.035em]">It’s your turn.</span>
      <span className="text-[14px] opacity-90">Number 10 · Go to the counter</span>
    </div>
  );
}

function Screen({ step, serving }: { step: number; serving: number }): ReactNode {
  switch (step) {
    case 0:
      return <FindScreen />;
    case 1:
      return <TimeScreen />;
    case 2:
      return <TicketScreen />;
    case 3:
      return <QueueScreen serving={serving} />;
    default:
      return <TurnScreen />;
  }
}

function StatusBar() {
  return (
    <div className="relative z-20 flex h-11 shrink-0 items-center justify-between px-7 text-[14px] font-semibold">
      <span className="tabular">10:24</span>
      <span className="absolute top-2.5 left-1/2 h-[30px] w-[100px] -translate-x-1/2 rounded-full bg-device" />
      <span className="flex items-center gap-1.5">
        <svg viewBox="0 0 18 12" className="h-[11px] w-[17px]" fill="currentColor">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg viewBox="0 0 27 13" className="h-[12px] w-[25px]" fill="none">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.5" stroke="currentColor" opacity="0.4" />
          <rect x="2.5" y="2.5" width="17" height="8" rx="2" fill="currentColor" />
          <path d="M25 4.5v4c.8-.3 1.5-1.1 1.5-2s-.7-1.7-1.5-2Z" fill="currentColor" opacity="0.4" />
        </svg>
      </span>
    </div>
  );
}

/** The phone at its one design size (320 × 664). `scale` fits it to the space it has. */
export function Phone({ step, serving, still = false }: { step: number; serving: number; still?: boolean }) {
  return (
    <div
      aria-hidden
      data-illustration
      className="scope-light rounded-[52px] bg-device p-[9px] shadow-[0_50px_100px_-30px_rgb(0_0_0/0.7)] ring-1 ring-white/15"
      style={{ width: PHONE_W, height: PHONE_H }}
    >
      <div className="relative flex h-full flex-col overflow-hidden rounded-[43px] bg-canvas text-ink">
        <StatusBar />
        <div className="relative min-h-0 flex-1">
          {ENTER.map((_, i) =>
            still && i !== step ? null : (
              <div
                key={i}
                className="story-screen"
                data-state={still ? 'here' : screenState(i, step)}
                style={{ zIndex: i + 1 }}
              >
                <Screen step={i} serving={serving} />
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The phone, scaled to fill the box it's given (never past `max`). Until the box has been
 * measured nothing shows, so it never appears at the wrong size first.
 */
export function FittedPhone({
  step,
  serving,
  still,
  max = 1,
  className,
}: {
  step: number;
  serving: number;
  still?: boolean;
  max?: number;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setScale(Math.max(0.3, Math.min(max, width / PHONE_W, height / PHONE_H)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [max]);

  return (
    <div ref={box} className={cn('relative flex min-h-0 items-center justify-center', className)}>
      {scale !== null && (
        <div style={{ width: PHONE_W * scale, height: PHONE_H * scale }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <Phone step={step} serving={serving} still={still} />
          </div>
        </div>
      )}
    </div>
  );
}

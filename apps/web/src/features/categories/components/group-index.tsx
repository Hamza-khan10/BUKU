'use client';

import { useLenis } from 'lenis/react';
import { stackTarget } from '@/components/motion/stacked-cards';
import { CategoryIcon } from '../icons';

/**
 * The groups at the top of the categories page: one tap takes you to a group's card (stacked or
 * not), and focus moves to its heading so a keyboard or screen reader carries on from there.
 */
export function GroupIndex({ groups }: { groups: { slug: string; name: string; count: number }[] }) {
  const lenis = useLenis();
  const go = (slug: string) => {
    const top = stackTarget(slug);
    if (top === null) return;
    const heading = document.getElementById(`group-${slug}`);
    const done = () => heading?.focus({ preventScroll: true });
    if (lenis) lenis.scrollTo(top, { duration: 0.9, onComplete: done });
    else {
      window.scrollTo({ top });
      done();
    }
  };
  return (
    <nav aria-label="Groups">
      {/* One row to swipe on a phone; wrapped on wider screens. */}
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {groups.map((g) => (
          <li key={g.slug} className="shrink-0">
            <button
              type="button"
              onClick={() => go(g.slug)}
              className="relative inline-flex h-11 items-center gap-2 rounded-full bg-surface pr-4 pl-3 text-[0.95rem] font-medium text-ink ring-1 ring-line transition-shadow hover:ring-control focus-visible:ring-2 focus-visible:ring-control focus-visible:outline-none"
            >
              <CategoryIcon slug={g.slug} className="size-4.5 text-brand-ink" />
              {g.name}
              <span className="tabular text-ink-3">
                {g.count}
                <span className="sr-only"> kinds</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

'use client';

import { motion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useReducedMotion } from './use-reduced-motion';

/**
 * Cards that pin under the header one after another as the page scrolls, each new one settling
 * over the last while those beneath sink back a little — a deck being laid down (D-099). The
 * pattern of componentry's Sticky Scroll Cards (github.com/harshjdhv/componentry, MIT, © 2026
 * Harsh Jadhav), rebuilt for BUKU's own content and smooth scrolling (no second Lenis, no stock
 * photos). Cards are stacked only where a whole card fits on the screen (a wide, tall window):
 * a pinned card never scrolls, so on a phone, where a card is taller than the screen, its last
 * lines would be hidden under the next. There, and under reduced motion, they're a plain list,
 * each rising in as it scrolls into view.
 */

const WIDE = '(min-width: 64rem) and (min-height: 40rem)';
const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(WIDE);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};
export function StackedCards({ cards, className }: { cards: ReactNode[]; className?: string }) {
  const reduce = useReducedMotion();
  const wide = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
  const deck = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: deck, offset: ['start start', 'end end'] });

  if (reduce || !wide) {
    return (
      <div ref={deck} className={cn('flex flex-col gap-6', className)}>
        {cards.map((card, i) => (
          <div key={i} className="reveal" style={{ '--i': 0 } as CSSProperties}>
            {card}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div ref={deck} className={cn('flex flex-col gap-[18vh]', className)}>
      {cards.map((card, i) => (
        <Card key={i} index={i} total={cards.length} progress={scrollYProgress}>
          {card}
        </Card>
      ))}
    </div>
  );
}

function Card({
  index,
  total,
  progress,
  children,
}: {
  index: number;
  total: number;
  progress: MotionValue<number>;
  children: ReactNode;
}) {
  // Each card settles back by a few percent for every card laid over it.
  const scale = useTransform(progress, [index / total, 1], [1, 1 - (total - index - 1) * 0.045]);
  return (
    <div className="sticky" style={{ top: `calc(5.5rem + ${index * 1.4}rem)` }}>
      <motion.div style={{ scale }} className="origin-top">
        {children}
      </motion.div>
    </div>
  );
}

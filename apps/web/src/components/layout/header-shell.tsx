'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The header's glass, aware of what's under it: over a Midnight section (anything marked
 * `data-tone="dark"`, like the scroll story or the footer) it turns dark too, the way a
 * phone's bar adapts, instead of a light glass going grey over a dark stage.
 */
export function HeaderShell({ className, children }: { className?: string; children: ReactNode }) {
  const header = useRef<HTMLElement>(null);
  const [overDark, setOverDark] = useState(false);

  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const line = (header.current?.offsetHeight ?? 64) / 2;
      const dark = [...document.querySelectorAll('[data-tone="dark"]')].some((el) => {
        const r = el.getBoundingClientRect();
        return r.top <= line && r.bottom >= line;
      });
      setOverDark(dark);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  return (
    <header
      ref={header}
      data-over={overDark ? 'dark' : undefined}
      className={cn(className, overDark && 'text-ink')}
    >
      {children}
    </header>
  );
}

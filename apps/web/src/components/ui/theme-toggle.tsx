'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { ToggleGroup } from 'radix-ui';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { cn } from '@/lib/cn';
import { THEME_COOKIE, type Theme } from '@/lib/theme';

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'system', label: 'Use device setting', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

/** What the page shows now (the server sets it; another toggle may have changed it since). */
function shownTheme(fallback: Theme): Theme {
  if (typeof document === 'undefined') return fallback;
  const value = document.documentElement.getAttribute('data-theme');
  return value === 'light' || value === 'dark' ? value : 'system';
}

/**
 * Light / dark / device. Applies at once and is remembered for a year. Where the browser can
 * (View Transitions) and motion is welcome, the new look spreads in a circle from the switch that
 * was pressed (3.7i): the change starts where its cause is. Elsewhere it simply switches.
 */
export function ThemeToggle({ initial, className }: { initial: Theme; className?: string }) {
  const [theme, setTheme] = useState<Theme>(() => shownTheme(initial));
  // Where the last press landed; a keyboard press spreads from the focused switch instead.
  const press = useRef<{ x: number; y: number } | null>(null);

  const choose = (next: string) => {
    if (next !== 'system' && next !== 'light' && next !== 'dark') return;
    const root = document.documentElement;
    const apply = () => {
      flushSync(() => setTheme(next));
      if (next === 'system') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', next);
    };
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie =
      next === 'system'
        ? `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
        : `${THEME_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;

    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      apply();
      return;
    }
    const from =
      press.current ??
      (() => {
        const r = (document.activeElement ?? root).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })();
    press.current = null;
    const reach = Math.hypot(Math.max(from.x, innerWidth - from.x), Math.max(from.y, innerHeight - from.y));
    root.style.setProperty('--reveal-x', `${from.x}px`);
    root.style.setProperty('--reveal-y', `${from.y}px`);
    root.style.setProperty('--reveal-r', `${reach}px`);
    root.classList.add('theme-reveal');
    void document.startViewTransition(apply).finished.finally(() => root.classList.remove('theme-reveal'));
  };

  return (
    <ToggleGroup.Root
      type="single"
      value={theme}
      onValueChange={choose}
      onPointerDown={(e) => {
        press.current = { x: e.clientX, y: e.clientY };
      }}
      aria-label="Colour theme"
      className={cn('inline-flex gap-0.5 rounded-full bg-sunken p-1', className)}
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <ToggleGroup.Item
          key={value}
          value={value}
          aria-label={label}
          title={label}
          className="grid size-8 place-items-center rounded-full text-ink-2 transition-colors hover:text-ink data-[state=on]:bg-surface data-[state=on]:text-ink data-[state=on]:shadow-soft"
        >
          <Icon className="size-4" aria-hidden />
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

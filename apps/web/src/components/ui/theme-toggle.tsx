'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { ToggleGroup } from 'radix-ui';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { THEME_COOKIE, type Theme } from '@/lib/theme';

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'system', label: 'Use device setting', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

/** Light / dark / device. Applies at once and is remembered for a year. */
export function ThemeToggle({ initial, className }: { initial: Theme; className?: string }) {
  const [theme, setTheme] = useState<Theme>(initial);

  const choose = (next: string) => {
    if (next !== 'system' && next !== 'light' && next !== 'dark') return;
    setTheme(next);
    const root = document.documentElement;
    if (next === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', next);
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie =
      next === 'system'
        ? `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
        : `${THEME_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  };

  return (
    <ToggleGroup.Root
      type="single"
      value={theme}
      onValueChange={choose}
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

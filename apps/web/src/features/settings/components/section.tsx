import type { ReactNode } from 'react';

/** One part of the settings page: a titled card, named for screen readers by its title. */
export function SettingsSection({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
        {intro && <p className="text-sm text-ink-3">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

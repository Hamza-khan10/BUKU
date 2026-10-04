'use client';

import { RadioGroup } from 'radix-ui';
import { Avatar } from '@/components/ui/avatar';
import { duration, money } from '@/lib/format';
import type { ServiceItem, ServiceMenu, StaffMember } from '@/features/business/types';
import { choiceCard } from './step';

/** Pick what to book: the menu, by category, with how long and how much. */
export function ServiceChoice({
  menu,
  value,
  onChange,
}: {
  menu: ServiceMenu;
  value: string | null;
  onChange: (serviceId: string) => void;
}) {
  const groups = menu.categories.filter((c) => c.services.length > 0);
  const single = groups.length === 1;
  return (
    <RadioGroup.Root
      value={value ?? ''}
      onValueChange={onChange}
      aria-label="Service"
      className="flex flex-col gap-5"
    >
      {groups.map((group) => (
        <div key={group.id ?? 'other'} className="flex flex-col gap-2">
          {!single && <p className="text-sm font-semibold text-ink-2">{group.name}</p>}
          {group.services.map((s) => (
            <RadioGroup.Item key={s.id} value={s.id} className={choiceCard}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-medium text-ink">{s.name}</span>
                {s.description && <span className="text-sm text-ink-2">{s.description}</span>}
                <span className="text-sm text-ink-3">{duration(s.durationMinutes)}</span>
              </span>
              <span className="shrink-0 font-semibold text-ink tabular">{money(s.price, s.currency)}</span>
            </RadioGroup.Item>
          ))}
        </div>
      ))}
    </RadioGroup.Root>
  );
}

export const serviceSummary = (s: ServiceItem) =>
  `${s.name} · ${duration(s.durationMinutes)} · ${money(s.price, s.currency)}`;

/** Pick who: anyone available (the business assigns), or a person who does this service. */
export function PersonChoice({
  staff,
  value,
  onChange,
}: {
  staff: StaffMember[];
  value: string | null;
  onChange: (staffId: string | null) => void;
}) {
  return (
    <RadioGroup.Root
      value={value ?? 'anyone'}
      onValueChange={(v) => onChange(v === 'anyone' ? null : v)}
      aria-label="Person"
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
    >
      <RadioGroup.Item value="anyone" className={choiceCard}>
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-ink">Anyone available</span>
          <span className="text-sm text-ink-3">The most free times</span>
        </span>
      </RadioGroup.Item>
      {staff.map((p) => (
        <RadioGroup.Item key={p.id} value={p.id} className={choiceCard}>
          <Avatar name={p.displayName} src={p.photoUrl} size={36} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium text-ink">{p.displayName}</span>
            {p.specializations.length > 0 && (
              <span className="truncate text-sm text-ink-3">{p.specializations.join(' · ')}</span>
            )}
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

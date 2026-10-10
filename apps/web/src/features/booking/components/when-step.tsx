'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { RadioGroup } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { byPartOfDay, clockLabel, dayParts } from '../choices';
import type { Availability, Slot } from '../types';
import { choiceCard } from './step';

/**
 * The days in view (two weeks at a time), each saying how many times are
 * free — so nobody opens a full day to find nothing. Days without times can't
 * be picked.
 */
export function DayChoice({
  days,
  loading,
  value,
  onChange,
  onEarlier,
  onLater,
}: {
  days: Availability['days'] | undefined;
  loading: boolean;
  value: string | null;
  onChange: (date: string) => void;
  /** Absent when there is nothing earlier (today) or later (the booking horizon). */
  onEarlier?: (() => void) | undefined;
  onLater?: (() => void) | undefined;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onEarlier} disabled={!onEarlier}>
          <ChevronLeft aria-hidden /> Earlier
        </Button>
        <Button variant="ghost" size="sm" onClick={onLater} disabled={!onLater}>
          Later <ChevronRight aria-hidden />
        </Button>
      </div>
      {loading || !days ? (
        <div role="status" aria-label="Loading free times" className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {Array.from({ length: 14 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : (
        <RadioGroup.Root
          value={value ?? ''}
          onValueChange={onChange}
          aria-label="Day"
          className="grid grid-cols-4 gap-2 sm:grid-cols-7"
        >
          {days.map(({ date, slots }) => {
            const d = dayParts(date);
            const free = slots.length;
            return (
              <RadioGroup.Item
                key={date}
                value={date}
                disabled={free === 0}
                aria-label={`${d.label}: ${free === 0 ? 'no free times' : `${free} free ${free === 1 ? 'time' : 'times'}`}`}
                className={cn(choiceCard, 'flex-col items-center gap-0 px-1 py-2 text-center')}
              >
                <span className="text-xs font-medium text-ink-3">{d.weekday}</span>
                <span className="text-xl tracking-[-0.02em] font-semibold text-ink tabular">{d.day}</span>
                <span className="text-xs text-ink-3">{d.month}</span>
                <span className={cn('mt-1 text-xs font-medium', free ? 'text-ok' : 'text-ink-3')}>
                  {free ? `${free} free` : 'None free'}
                </span>
              </RadioGroup.Item>
            );
          })}
        </RadioGroup.Root>
      )}
    </div>
  );
}

/** The free start times on one day, by morning, afternoon and evening (the business's own clock). */
export function TimeChoice({
  slots,
  value,
  onChange,
}: {
  slots: Slot[];
  value: string | null;
  onChange: (startAt: string) => void;
}) {
  return (
    <RadioGroup.Root
      value={value ?? ''}
      onValueChange={onChange}
      aria-label="Time"
      className="flex flex-col gap-4"
    >
      {byPartOfDay(slots).map(({ part, slots: group }) => (
        <div key={part} className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-ink-2">{part}</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {group.map((slot) => (
              <RadioGroup.Item
                key={slot.startAt}
                value={slot.startAt}
                className={cn(choiceCard, 'justify-center px-2 py-2.5 font-medium text-ink tabular')}
              >
                {clockLabel(slot.time)}
              </RadioGroup.Item>
            ))}
          </div>
        </div>
      ))}
    </RadioGroup.Root>
  );
}

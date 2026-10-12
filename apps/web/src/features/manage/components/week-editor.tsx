'use client';

import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/choice';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { copyDay, MAX_RANGES, WEEK, type Day, type Week } from '../setup';

/**
 * A week of opening hours, a row per day: open or closed, then its times (the phone's own time
 * picker), and a lunch break when there is one. "Same as Monday" copies one day to the others,
 * since most places keep the same hours most days. Problems are said on the day they're about.
 */
export function WeekEditor({
  week,
  onChange,
  problems,
  label = 'Opening hours',
}: {
  week: Week;
  onChange: (week: Week) => void;
  problems: Record<number, string>;
  label?: string;
}) {
  const setDay = (day: number, change: Partial<Day>) =>
    onChange({ ...week, [day]: { ...week[day]!, ...change } });

  const addBreak = (day: number) => {
    const d = week[day]!;
    const only = d.ranges[0] ?? { start: '09:00', end: '18:00' };
    // A sensible split: the morning ends at 13:00 and the afternoon starts at 14:00, when that fits.
    const fits = only.start < '13:00' && only.end > '14:00';
    setDay(day, {
      ranges: fits
        ? [
            { start: only.start, end: '13:00' },
            { start: '14:00', end: only.end },
          ]
        : [only, { start: only.end, end: only.end }],
    });
  };

  const openDays = WEEK.filter(({ day }) => week[day]?.open).map(({ day }) => day);
  const first = openDays[0];

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">{label}</legend>
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
        {WEEK.map(({ day, name }) => {
          const d = week[day]!;
          const problem = problems[day];
          return (
            <li key={day} className="flex flex-col gap-3 px-3 py-3 sm:px-4">
              <Switch
                label={<span className="font-medium">{name}</span>}
                description={d.open ? undefined : 'Closed'}
                checked={d.open}
                onCheckedChange={(open) => setDay(day, { open })}
              />
              {d.open && (
                <div className="flex flex-col gap-2">
                  {d.ranges.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        type="time"
                        step={900}
                        aria-label={`${name}${d.ranges.length > 1 ? `, opening ${i + 1}` : ''}: opens at`}
                        value={r.start}
                        onChange={(e) =>
                          setDay(day, {
                            ranges: d.ranges.map((x, k) => (k === i ? { ...x, start: e.target.value } : x)),
                          })
                        }
                        aria-invalid={problem ? true : undefined}
                        className="tabular min-w-0 flex-1 px-2.5 sm:w-[9.75rem] sm:flex-none sm:px-3"
                      />
                      <span className="shrink-0 text-sm text-ink-3">to</span>
                      <Input
                        type="time"
                        step={900}
                        aria-label={`${name}${d.ranges.length > 1 ? `, opening ${i + 1}` : ''}: closes at`}
                        value={r.end}
                        onChange={(e) =>
                          setDay(day, {
                            ranges: d.ranges.map((x, k) => (k === i ? { ...x, end: e.target.value } : x)),
                          })
                        }
                        aria-invalid={problem ? true : undefined}
                        className="tabular min-w-0 flex-1 px-2.5 sm:w-[9.75rem] sm:flex-none sm:px-3"
                      />
                      {i > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove the break on ${name}`}
                          onClick={() => setDay(day, { ranges: [{ start: d.ranges[0]!.start, end: r.end }] })}
                        >
                          <X aria-hidden />
                        </Button>
                      )}
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {d.ranges.length < MAX_RANGES && (
                      <button
                        type="button"
                        onClick={() => addBreak(day)}
                        className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
                      >
                        <Plus className="size-4" aria-hidden /> Add a break
                        <span className="sr-only"> on {name}</span>
                      </button>
                    )}
                    {day === first && openDays.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          onChange(
                            copyDay(
                              week,
                              day,
                              openDays.filter((x) => x !== day),
                            ),
                          )
                        }
                        className="inline-flex min-h-9 items-center text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
                      >
                        Same hours on every open day
                      </button>
                    )}
                  </div>
                </div>
              )}
              {problem && (
                <p role="alert" className={cn('text-sm font-medium text-danger')}>
                  {problem}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ProblemAlert } from '@/features/auth/components/problem-alert';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { MINE_KEY, managedKey, setOpeningHours, type ManagedBusiness } from '../api';
import { weekFromApi, weekProblems, weekToApi, type Week } from '../setup';
import { WeekEditor } from './week-editor';

/**
 * A business's opening hours (setup step 1, and the Hours page): a row per day, open or closed,
 * the phone's own time picker, a break, the same hours copied to other days. Free times are only
 * ever offered inside them.
 */
export function OpeningHoursForm({ business, onSaved }: { business: ManagedBusiness; onSaved?: () => void }) {
  const queryClient = useQueryClient();
  const [week, setWeek] = useState<Week>(() => weekFromApi(business.hours));
  const [shown, setShown] = useState<ReturnType<typeof weekProblems>>({ days: {} });
  const [problem, setProblem] = useState<Problem | undefined>();
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const problems = weekProblems(week);
    setShown(problems);
    if (problems.week || Object.keys(problems.days).length > 0) return;
    setProblem(undefined);
    setBusy(true);
    try {
      await setOpeningHours(business.id, weekToApi(week));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: managedKey(business.id) }),
        queryClient.invalidateQueries({ queryKey: MINE_KEY }),
      ]);
      onSaved?.();
    } catch (err) {
      setProblem(problemFrom(err, 'Your opening hours couldn’t be saved. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
      <p className="text-ink-2">
        When people can come, in {business.name}’s time ({business.timezone.replaceAll('_', ' ')}). Free times
        are only ever offered inside them.
      </p>
      <ProblemAlert problem={problem} />
      <WeekEditor
        week={week}
        onChange={(w) => {
          setWeek(w);
          // Problems clear as they're fixed, never appear while typing.
          if (shown.week || Object.keys(shown.days).length > 0) setShown(weekProblems(w));
        }}
        problems={shown.days}
      />
      {shown.week && (
        <p role="alert" className="text-sm font-medium text-danger">
          {shown.week}
        </p>
      )}
      <div>
        <Button type="submit" variant="primary" loading={busy}>
          Save opening hours
        </Button>
      </div>
    </form>
  );
}

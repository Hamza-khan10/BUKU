import { describe, expect, it } from 'vitest';
import { businessPages, currentPage } from '../src/features/manage/navigation';

const labels = (role: Parameters<typeof businessPages>[1]) =>
  businessPages('AbCdEfGhIjKl', role).map((g) => [g.title, g.pages.map((p) => p.label)]);

describe('A business’s pages', () => {
  it('groups every page the owner can use, in four groups', () => {
    expect(labels('owner')).toEqual([
      ['Run the day', ['Today', 'Appointments', 'Calendar', 'Check-in', 'Queue']],
      ['People and time', ['Hours', 'Attendance', 'Team', 'Services']],
      ['Customers', ['Reviews', 'Insights']],
      ['The business', ['Plan', 'Settings', 'Verification']],
    ]);
  });

  it('shows each role only what it can use; empty groups go', () => {
    expect(labels('manager').at(-1)).toEqual(['The business', ['Plan', 'Settings']]);
    for (const role of ['front_desk', 'staff'] as const)
      expect(labels(role)).toEqual([
        ['Run the day', ['Today', 'Appointments', 'Calendar', 'Check-in', 'Queue']],
        ['People and time', ['Hours', 'Attendance']],
      ]);
  });

  it('finds the page someone is on by its exact address', () => {
    const groups = businessPages('AbCdEfGhIjKl', 'owner');
    expect(currentPage(groups, '/business/AbCdEfGhIjKl')).toMatchObject({
      page: { label: 'Today' },
      group: 'Run the day',
    });
    expect(currentPage(groups, '/business/AbCdEfGhIjKl/insights')?.page.label).toBe('Insights');
    expect(currentPage(groups, '/business/AbCdEfGhIjKl/setup')).toBeNull();
    expect(currentPage(groups, '/business/OtherBizzzzz/insights')).toBeNull();
  });
});

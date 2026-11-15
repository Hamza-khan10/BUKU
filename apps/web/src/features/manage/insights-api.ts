import { api } from '@/lib/api/client';
import type { CancellationReport } from './insights';

/** Insights (3.5j): cancellations and no-shows for the owner and managers (`reports.view`). */
export const insightsKey = (id: string, from: string, to: string) =>
  ['business', id, 'insights', from, to] as const;

export function fetchInsights(id: string, from: string, to: string) {
  const q = new URLSearchParams({ from, to });
  return api<CancellationReport>(`businesses/${id}/insights/cancellations?${q}`);
}

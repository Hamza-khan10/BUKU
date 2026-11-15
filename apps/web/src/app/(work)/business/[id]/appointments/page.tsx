import { isDecimalId } from '@buku/validation';
import type { Metadata } from 'next';
import { Appointments } from '@/features/manage/components/appointments';
import type { VisitQuery, VisitStatus } from '@/features/manage/visits';

export const metadata: Metadata = { title: 'Appointments', robots: { index: false, follow: false } };

const STATUSES = new Set<VisitStatus>([
  'pending',
  'confirmed',
  'cancelled',
  'completed',
  'no_show',
  'rescheduled',
]);

/** Only well-formed choices from the address reach the API; anything else is ignored. */
function parse(params: Record<string, string | string[] | undefined>): VisitQuery {
  const one = (k: string) => (typeof params[k] === 'string' ? params[k] : undefined);
  const date = one('date');
  const staffId = one('staffId');
  const status = one('status') as VisitStatus | undefined;
  const q = one('q')?.trim().slice(0, 100);
  return {
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
    staffId: staffId && isDecimalId(staffId) ? staffId : undefined,
    status: status && STATUSES.has(status) ? status : undefined,
    q: q || undefined,
  };
}

export default async function AppointmentsPage({
  params,
  searchParams,
}: PageProps<'/business/[id]/appointments'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <Appointments id={id} query={parse(query)} />;
}

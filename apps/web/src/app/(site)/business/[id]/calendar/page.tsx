import { isDecimalId } from '@buku/validation';
import type { Metadata } from 'next';
import { CalendarPage } from '@/features/manage/components/calendar-page';

export const metadata: Metadata = { title: 'Calendar', robots: { index: false, follow: false } };

/** Only a well-formed week and person from the address reach the API; anything else is ignored. */
export default async function BusinessCalendarPage({
  params,
  searchParams,
}: PageProps<'/business/[id]/calendar'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const date =
    typeof query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : undefined;
  const staffId = typeof query.staffId === 'string' && isDecimalId(query.staffId) ? query.staffId : undefined;
  return <CalendarPage id={id} date={date} staffId={staffId} />;
}

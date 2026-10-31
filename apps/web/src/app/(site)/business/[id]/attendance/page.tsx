import type { Metadata } from 'next';
import { AttendancePage } from '@/features/manage/components/attendance-page';

export const metadata: Metadata = { title: 'Attendance', robots: { index: false, follow: false } };

export default async function BusinessAttendancePage({ params }: PageProps<'/business/[id]/attendance'>) {
  return <AttendancePage id={(await params).id} />;
}

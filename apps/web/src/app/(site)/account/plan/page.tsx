import type { Metadata } from 'next';
import { MyPlanPanel } from '@/features/plan/components/my-plan';

export const metadata: Metadata = { title: 'Your plan', robots: { index: false, follow: false } };

export default function PlanPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="type-app-title">Your plan</h1>
      <MyPlanPanel />
    </div>
  );
}

import type { Metadata } from 'next';
import { MyPlanPanel } from '@/features/plan/components/my-plan';

export const metadata: Metadata = { title: 'Your plan', robots: { index: false, follow: false } };

export default function PlanPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-4xl font-semibold tracking-[-0.03em]">Your plan</h1>
      <MyPlanPanel />
    </div>
  );
}

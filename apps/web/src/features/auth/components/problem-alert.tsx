import { Alert } from '@/components/ui/alert';
import type { Problem } from '../problems';

/** A sign-in form's refusal: what happened, what to do, and the reference support can look up. */
export function ProblemAlert({ problem }: { problem: Problem | null | undefined }) {
  if (!problem) return null;
  return (
    <Alert tone="danger" title={problem.title}>
      {problem.detail && <p>{problem.detail}</p>}
      {problem.reference && <p className="font-mono text-xs">Reference: {problem.reference}</p>}
    </Alert>
  );
}

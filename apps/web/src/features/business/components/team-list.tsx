import { Avatar } from '@/components/ui/avatar';
import type { StaffMember } from '../types';

/** The people customers can book with. Photos only where the employee agreed (business-service rule). */
export function TeamList({ staff }: { staff: StaffMember[] }) {
  if (staff.length === 0) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {staff.map((m) => (
        <li key={m.id} className="flex items-start gap-3 rounded-lg border border-line bg-surface p-4">
          <Avatar name={m.displayName} src={m.photoUrl} size={48} />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-medium text-ink">{m.displayName}</p>
            {m.specializations.length > 0 && (
              <p className="text-sm text-ink-2">{m.specializations.join(' · ')}</p>
            )}
            {m.bio && <p className="text-sm text-ink-3">{m.bio}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

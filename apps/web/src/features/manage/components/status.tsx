import { Badge } from '@/components/ui/badge';
import type { BusinessStatus } from '../api';

/** Where a business stands with BUKU, as its team should read it. */
export const STATUS: Record<
  BusinessStatus,
  { label: string; tone: 'ok' | 'wait' | 'danger'; text: string; public: boolean }
> = {
  pending: {
    label: 'Live, not verified yet',
    tone: 'wait',
    text: 'People can find it and book. It shows “Not verified” until BUKU has checked your registration details and a document.',
    public: true,
  },
  verified: {
    label: 'Verified',
    tone: 'ok',
    text: 'BUKU has checked this business’s details and documents.',
    public: true,
  },
  rejected: {
    label: 'Not approved',
    tone: 'danger',
    text: 'It’s hidden from the public until its details are fixed; fixing them sends it back for review.',
    public: false,
  },
  suspended: {
    label: 'Suspended',
    tone: 'danger',
    text: 'It’s hidden from the public and can’t be changed. Contact BUKU to find out why.',
    public: false,
  },
};

export function StatusBadge({ status }: { status: BusinessStatus }) {
  return <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;
}

import type { Metadata } from 'next';
import { AccountHome } from '@/features/account/components/account-home';

export const metadata: Metadata = { title: 'Your account', robots: { index: false, follow: false } };

export default function AccountPage() {
  return <AccountHome />;
}

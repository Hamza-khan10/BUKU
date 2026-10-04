import { cookies } from 'next/headers';
import { Container } from '@/components/ui/layout';
import { SignOutPanel } from '@/features/auth/components/sign-out-panel';

export const metadata = { title: 'Sign out', robots: { index: false, follow: false } };

const SESSION_HINTS = ['__Host-buku_s', 'buku_s'];

/** Sign out here, or on every device (a lost phone, a shared computer). */
export default async function SignOutPage() {
  const jar = await cookies();
  return (
    <Container className="flex justify-center py-12 sm:py-20">
      <div className="w-full max-w-lg">
        <SignOutPanel signedIn={SESSION_HINTS.some((n) => jar.has(n))} />
      </div>
    </Container>
  );
}

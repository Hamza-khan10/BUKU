import { Container } from '@/components/ui/layout';
import { SignOutPanel } from '@/features/auth/components/sign-out-panel';
import { signedInHere } from '@/lib/session/server';

export const metadata = { title: 'Sign out', robots: { index: false, follow: false } };

/** Sign out here, or on every device (a lost phone, a shared computer). */
export default async function SignOutPage() {
  const signedIn = await signedInHere();
  return (
    <Container className="flex justify-center py-12 sm:py-20">
      <div className="w-full max-w-lg">
        <SignOutPanel signedIn={signedIn} />
      </div>
    </Container>
  );
}

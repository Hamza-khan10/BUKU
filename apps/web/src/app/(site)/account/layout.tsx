import { Container } from '@/components/ui/layout';
import { AccountNav } from '@/features/account/components/account-nav';

/**
 * The signed-in person's own area. Signed-out visitors never get here: the
 * proxy sends them to sign in first, and the API answers only to the session.
 */
export default function AccountLayout({ children }: LayoutProps<'/account'>) {
  return (
    <Container className="flex flex-col gap-8 py-10 sm:py-14">
      <AccountNav />
      {children}
    </Container>
  );
}

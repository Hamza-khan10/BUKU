import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/layout';
import { PaddleCheckout } from '@/features/pricing/components/paddle-checkout';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

/** A Paddle transaction ID, as Paddle puts it in the link ("txn_" and 26 lowercase letters or digits). */
const TRANSACTION = /^txn_[a-z0-9]{26}$/;

/**
 * Paying for a business plan (D-119): Paddle's "default payment link" is this page. It only
 * opens Paddle's checkout for the transaction in the address; who pays for what was settled by
 * billing-service when it made the transaction, so nothing here can change the price or the plan.
 */
export default async function CheckoutPage({ searchParams }: PageProps<'/checkout'>) {
  const ptxn = (await searchParams)._ptxn;
  const transactionId = typeof ptxn === 'string' && TRANSACTION.test(ptxn) ? ptxn : null;
  const { PADDLE_CLIENT_TOKEN: token, PADDLE_ENVIRONMENT: environment } = env();
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <Container className="flex justify-center py-16 sm:py-24">
      <div className="flex w-full max-w-lg flex-col gap-5">
        <h1 className="type-app-title">Checkout</h1>
        {!token ? (
          <p className="text-ink-2">Payments aren’t available here yet. Nothing was charged.</p>
        ) : !transactionId ? (
          <>
            <p className="text-ink-2">
              There’s nothing to pay on this page. To change your business’s plan, start from its plan page:
              it brings you back here with the payment ready.
            </p>
            <div>
              <Button asChild variant="primary">
                <Link href="/pricing">See the plans</Link>
              </Button>
            </div>
          </>
        ) : (
          <PaddleCheckout
            token={token}
            environment={environment}
            transactionId={transactionId}
            nonce={nonce}
          />
        )}
      </div>
    </Container>
  );
}

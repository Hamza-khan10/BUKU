'use client';

import Link from 'next/link';
import Script from 'next/script';
import { useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/**
 * Paddle's checkout for one payment (D-119). BUKU starts a payment as a Paddle transaction, and
 * Paddle's link to it is this page with `?_ptxn=…`: Paddle.js, once started with the client-side
 * token, opens its checkout for that transaction by itself. The card details go to Paddle's own
 * frame, never through this site; Paddle then tells billing-service, which switches the plan on.
 */

interface PaddleEvent {
  name?: string;
}

interface PaddleJs {
  Environment: { set(environment: 'sandbox'): void };
  Initialize(options: { token: string; eventCallback?: (event: PaddleEvent) => void }): void;
  Checkout: { open(options: { transactionId: string }): void };
}

declare global {
  interface Window {
    Paddle?: PaddleJs;
  }
}

type State = 'loading' | 'open' | 'paid' | 'closed' | 'failed';

export function PaddleCheckout({
  token,
  environment,
  transactionId,
  nonce,
}: {
  token: string;
  environment: 'sandbox' | 'production';
  transactionId: string;
  nonce: string | undefined;
}) {
  const [state, setState] = useState<State>('loading');
  const started = useRef(false);

  const start = () => {
    const paddle = window.Paddle;
    if (!paddle) return setState('failed');
    if (started.current) return;
    started.current = true;
    if (environment === 'sandbox') paddle.Environment.set('sandbox');
    paddle.Initialize({
      token,
      eventCallback: (event) => {
        if (event.name === 'checkout.loaded') setState('open');
        else if (event.name === 'checkout.completed') setState('paid');
        else if (event.name === 'checkout.closed') setState((s) => (s === 'paid' ? s : 'closed'));
        else if (event.name === 'checkout.error') setState('failed');
      },
    });
  };

  return (
    <>
      <Script
        src="https://cdn.paddle.com/paddle/v2/paddle.js"
        nonce={nonce}
        onReady={start}
        onError={() => setState('failed')}
      />
      {environment === 'sandbox' && (
        <Alert tone="wait" title="Test payments only">
          Paddle’s sandbox: no real money moves. Card 4242 4242 4242 4242, any future expiry, CVC 100.
        </Alert>
      )}
      {state === 'loading' && (
        <p role="status" className="flex items-center gap-2 text-ink-2">
          <Spinner /> Opening Paddle’s secure checkout…
        </p>
      )}
      {state === 'open' && (
        <p role="status" className="text-ink-2">
          Paddle’s checkout is open. Your card details go to Paddle, never to BUKU.
        </p>
      )}
      {state === 'paid' && (
        <Alert
          tone="ok"
          title="Payment received"
          action={
            <Button asChild variant="primary">
              <Link href="/business">Back to your business</Link>
            </Button>
          }
        >
          Your plan switches on within a minute, as soon as Paddle tells BUKU. Paddle emails you the receipt.
        </Alert>
      )}
      {state === 'closed' && (
        <Alert
          title="Checkout closed"
          action={
            <Button variant="primary" onClick={() => window.Paddle?.Checkout.open({ transactionId })}>
              Open the checkout again
            </Button>
          }
        >
          Nothing was charged.
        </Alert>
      )}
      {state === 'failed' && (
        <Alert tone="danger" title="Paddle’s checkout didn’t load">
          Nothing was charged. Check your connection and reload this page, or start again from your business’s
          plan.
        </Alert>
      )}
    </>
  );
}

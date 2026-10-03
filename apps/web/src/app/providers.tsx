'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { ApiError } from '@/lib/api/errors';

/** Retry what may succeed on a second try (network, overload) — never a refusal. */
function shouldRetry(failures: number, error: unknown): boolean {
  if (failures >= 2) return false;
  if (error instanceof ApiError) return error.isNetwork || error.status >= 500 || error.status === 429;
  return true;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: shouldRetry, refetchOnWindowFocus: true },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}

'use client';

import { HeroUIProvider } from '@heroui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

import { WorkspaceProvider } from '@/components/WorkspaceProvider';
import { ApiError } from '@/lib/api';

/**
 * Client-side providers.
 *
 * TanStack Query holds server state with stale-while-revalidate, and from Phase D
 * onward Socket.IO events are its *invalidation signal* rather than a second
 * store. Realtime already delivers the truth, so the socket's only job is to say
 * when the cache is out of date — which keeps one source of truth instead of a
 * query cache plus a parallel socket store that drift the moment one misses an
 * event. See docs/17-caching.md.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  // Created in state so a Fast Refresh does not discard the cache.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // A 4xx will not become a 2xx by asking again; retrying an
              // authorization failure just delays the redirect to login.
              if (error instanceof ApiError && !error.isRetryable) return false;
              return failureCount < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <HeroUIProvider>
      <QueryClientProvider client={queryClient}>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </QueryClientProvider>
    </HeroUIProvider>
  );
}

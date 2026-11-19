import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { RouterProvider, type RouterHistory } from '@tanstack/react-router';
import { MotionConfig } from 'framer-motion';
import { ApiRequestError, setUnauthorizedHandler } from '../api/client';
import { qk } from '../api/keys';
import { createAppRouter } from './router';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => !(err instanceof ApiRequestError && err.status >= 400 && err.status < 500) && count < 2,
      },
      mutations: { retry: false },
    },
  });
}

/** Shows the login screen when any request returns 401. */
function UnauthorizedBridge({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  useEffect(() => {
    setUnauthorizedHandler(() => qc.setQueryData(qk.auth, { authRequired: true, authenticated: false }));
    return () => setUnauthorizedHandler(null);
  }, [qc]);
  return <>{children}</>;
}

export function App({ queryClient, history }: { queryClient?: QueryClient; history?: RouterHistory }) {
  const [qc] = useState(() => queryClient ?? createQueryClient());
  const [router] = useState(() => createAppRouter(history));
  return (
    <QueryClientProvider client={qc}>
      <UnauthorizedBridge>
        <MotionConfig reducedMotion="user">
          <RouterProvider router={router} />
        </MotionConfig>
      </UnauthorizedBridge>
    </QueryClientProvider>
  );
}

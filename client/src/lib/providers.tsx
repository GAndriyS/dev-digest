/* providers.tsx — client provider stack: React Query + Theme + active Repo. */
"use client";

import React from "react";
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
  MutationCache,
} from "@tanstack/react-query";
import { ThemeProvider } from "./theme";
import { RepoProvider } from "./repo-context";
import { ToastProvider, notify } from "./toast";
import { ApiError } from "./api";

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
        // Global error surfacing (errors anywhere → toast). Mutations always
        // toast (they are user actions). Queries only toast on network/5xx —
        // expected 4xx like a 404 "no tour yet" stay silent for inline empty states.
        queryCache: new QueryCache({
          onError: (err) => {
            const status = err instanceof ApiError ? err.status : 500;
            if (status === 0 || status >= 500) notify.error(errorMessage(err));
          },
        }),
        mutationCache: new MutationCache({
          // `meta.ownErrorToast` opts a mutation out of this global toast: the
          // caller shows its own translated message for at least one failure
          // branch, and both firing would stack two toasts for one click
          // (cache-level and instance-level onError both always run).
          onError: (err, _vars, _ctx, mutation) => {
            if (mutation.meta?.ownErrorToast) return;
            notify.error(errorMessage(err));
          },
        }),
      })
  );
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <ToastProvider>
          <RepoProvider>{children}</RepoProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

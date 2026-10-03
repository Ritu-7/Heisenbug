import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 60 seconds before data is considered stale — fine for a catalogue page
      staleTime: 60_000,
      // Show error boundary if a query fails (can be overridden per-query)
      retry: 1,
    },
  },
});

import { useQuery } from '@tanstack/react-query';

interface HealthCheckResponse {
  status: string;
  timestamp: string;
}

/**
 * Demo React Query hook — fetches a mock healthcheck.
 * Replace the URL with a real endpoint when available.
 */
export function useHealthCheck() {
  return useQuery<HealthCheckResponse>({
    queryKey: ['healthcheck'],
    queryFn: async (): Promise<HealthCheckResponse> => {
      // Mock healthcheck — replace with real endpoint
      // e.g. const res = await fetch('/api/health');
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            status: 'ok',
            timestamp: new Date().toISOString(),
          });
        }, 300);
      });
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

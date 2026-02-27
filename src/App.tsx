import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell/AppShell';
import { ErrorFallback } from '@/components/ErrorFallback/ErrorFallback';
import { OverviewPage } from '@/pages/OverviewPage/OverviewPage';
import { DevicePage } from '@/pages/DevicePage/DevicePage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <ErrorFallback />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: ':deviceId', element: <DevicePage /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

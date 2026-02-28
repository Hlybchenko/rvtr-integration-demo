import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from '@/components/AppShell/AppShell';
import { ErrorFallback } from '@/components/ErrorFallback/ErrorFallback';
import { OverviewPage } from '@/pages/OverviewPage/OverviewPage';
import { DevicePage } from '@/pages/DevicePage/DevicePage';

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
  return <RouterProvider router={router} />;
}

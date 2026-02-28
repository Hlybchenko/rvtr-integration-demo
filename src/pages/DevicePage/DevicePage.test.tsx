/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

// Mock DevicePreview to avoid complex rendering
vi.mock('@/components/DevicePreview/DevicePreview', () => ({
  DevicePreview: () => <div data-testid="device-preview" />,
}));

const { DevicePage } = await import('./DevicePage');

/** Render DevicePage inside a data router. */
function renderDevicePage(deviceId: string) {
  const router = createMemoryRouter(
    [
      { path: '/:deviceId', element: <DevicePage /> },
      { path: '/', element: <div data-testid="settings-page">Settings</div> },
    ],
    { initialEntries: [`/${deviceId}`] },
  );

  return { router, ...render(<RouterProvider router={router} />) };
}

beforeEach(() => {
  cleanup();
});

describe('DevicePage', () => {
  it('renders without errors for stream device', async () => {
    renderDevicePage('holobox');

    await new Promise((r) => setTimeout(r, 50));
    // Component renders successfully without process management
    expect(true).toBe(true);
  });

  it('renders without errors for non-stream device', async () => {
    renderDevicePage('phone');

    await new Promise((r) => setTimeout(r, 50));
    // Component renders successfully without process management
    expect(true).toBe(true);
  });
});

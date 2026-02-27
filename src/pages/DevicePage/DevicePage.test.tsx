/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { useSettingsStore } from '@/stores/settingsStore';

// Mock voiceAgentWriter before importing DevicePage
vi.mock('@/services/voiceAgentWriter', () => ({
  startDeviceProcess: vi.fn(() => Promise.resolve({ ok: true, pid: 1 })),
  stopProcess: vi.fn(() => Promise.resolve({ ok: true })),
}));

// Mock DevicePreview to avoid complex rendering
vi.mock('@/components/DevicePreview/DevicePreview', () => ({
  DevicePreview: () => <div data-testid="device-preview" />,
}));

const { startDeviceProcess, stopProcess } = await import('@/services/voiceAgentWriter');
const { DevicePage } = await import('./DevicePage');

const mockedStart = vi.mocked(startDeviceProcess);
const mockedStop = vi.mocked(stopProcess);

/** Render DevicePage inside a data router (required for useBlocker). */
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
  mockedStart.mockClear();
  mockedStop.mockClear();
  cleanup();
});

describe('DevicePage process lifecycle', () => {
  it('calls startDeviceProcess for a stream device with exePath', async () => {
    useSettingsStore.setState({
      deviceExePaths: { holobox: '/path/holobox.bat', 'keba-kiosk': '', kiosk: '' },
    });

    renderDevicePage('holobox');

    await vi.waitFor(() => {
      expect(mockedStart).toHaveBeenCalledTimes(1);
    });

    expect(mockedStart).toHaveBeenCalledWith('holobox', '/path/holobox.bat');
  });

  it('does NOT call startDeviceProcess for non-stream device', async () => {
    renderDevicePage('phone');

    await new Promise((r) => setTimeout(r, 50));

    expect(mockedStart).not.toHaveBeenCalled();
  });

  it('does NOT call startDeviceProcess when exePath is empty', async () => {
    useSettingsStore.setState({
      deviceExePaths: { holobox: '', 'keba-kiosk': '', kiosk: '' },
    });

    renderDevicePage('holobox');

    await new Promise((r) => setTimeout(r, 50));

    expect(mockedStart).not.toHaveBeenCalled();
  });

  it('calls stopProcess when navigating away from stream device', async () => {
    useSettingsStore.setState({
      deviceExePaths: { holobox: '/path/holobox.bat', 'keba-kiosk': '', kiosk: '' },
    });

    const { router } = renderDevicePage('holobox');

    // Wait for start to fire
    await vi.waitFor(() => {
      expect(mockedStart).toHaveBeenCalledTimes(1);
    });

    // Navigate away — triggers the blocker which calls stopProcess
    router.navigate('/');

    await vi.waitFor(() => {
      expect(mockedStop).toHaveBeenCalledTimes(1);
    });

    // After stop completes, navigation proceeds to settings page
    await vi.waitFor(() => {
      expect(screen.queryByTestId('settings-page')).not.toBeNull();
    });
  });
});

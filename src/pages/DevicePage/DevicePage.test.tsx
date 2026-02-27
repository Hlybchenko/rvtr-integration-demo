/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

const mockedStart = vi.mocked(startDeviceProcess);
const mockedStop = vi.mocked(stopProcess);

// Helper: render DevicePage with a given deviceId route
function renderDevicePage(deviceId: string) {
  return render(
    <MemoryRouter initialEntries={[`/${deviceId}`]}>
      <Routes>
        <Route path="/:deviceId" element={<DevicePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

// Import after mocks
const { DevicePage } = await import('./DevicePage');

beforeEach(() => {
  mockedStart.mockClear();
  mockedStop.mockClear();
  cleanup();
});

describe('DevicePage process lifecycle', () => {
  it('calls startDeviceProcess for a stream device with exePath', async () => {
    // Set exe path in store
    useSettingsStore.setState({
      deviceExePaths: { holobox: '/path/holobox.bat', 'keba-kiosk': '', kiosk: '' },
    });

    renderDevicePage('holobox');

    // Wait for async effect
    await vi.waitFor(() => {
      expect(mockedStart).toHaveBeenCalledTimes(1);
    });

    expect(mockedStart).toHaveBeenCalledWith('holobox', '/path/holobox.bat');
  });

  it('does NOT call startDeviceProcess for non-stream device', async () => {
    renderDevicePage('phone');

    // Give effects time to fire
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

  it('calls stopProcess on unmount', async () => {
    useSettingsStore.setState({
      deviceExePaths: { holobox: '/path/holobox.bat', 'keba-kiosk': '', kiosk: '' },
    });

    const { unmount } = renderDevicePage('holobox');

    await vi.waitFor(() => {
      expect(mockedStart).toHaveBeenCalledTimes(1);
    });

    unmount();

    await vi.waitFor(() => {
      expect(mockedStop).toHaveBeenCalledTimes(1);
    });
  });
});

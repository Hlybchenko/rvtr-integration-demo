/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useSettingsStore } from '@/stores/settingsStore';

// Mock voiceAgentWriter
vi.mock('@/services/voiceAgentWriter', () => ({
  getWriterConfig: vi.fn(),
  setWriterFilePath: vi.fn(),
  setDeviceExePath: vi.fn(),
  getProcessStatus: vi.fn(),
  readVoiceAgentFromFile: vi.fn(),
  forceRewriteVoiceAgentFile: vi.fn(),
  browseForFile: vi.fn(),
  browseForExe: vi.fn(),
  restartStart2stream: vi.fn(),
}));

// Mock device config to avoid complex imports
vi.mock('@/config/devices', () => ({
  devices: [],
  preloadDeviceFrameImages: vi.fn(),
}));

vi.mock('@/hooks/useDetectScreenRect', () => ({
  warmDetectScreenRect: vi.fn(),
}));

const {
  getWriterConfig,
  getProcessStatus,
  readVoiceAgentFromFile,
} = await import('@/services/voiceAgentWriter');

const mockedGetConfig = vi.mocked(getWriterConfig);
const mockedGetStatus = vi.mocked(getProcessStatus);
const mockedReadVoiceAgent = vi.mocked(readVoiceAgentFromFile);

const { OverviewPage } = await import('./OverviewPage');

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  // Default mock: readVoiceAgentFromFile resolves to a valid state
  mockedReadVoiceAgent.mockResolvedValue({
    voiceAgent: 'elevenlabs',
    configured: true,
  });
  // Reset store
  useSettingsStore.setState({
    phoneUrl: '',
    laptopUrl: '',
    kioskUrl: '',
    holoboxUrl: '',
    kebaKioskUrl: '',
    voiceAgent: 'elevenlabs',
    licenseFilePath: '',
    deviceExePaths: { holobox: '', 'keba-kiosk': '', kiosk: '' },
  });
});

describe('OverviewPage init effect', () => {
  it('shows backend error when backend is unreachable', async () => {
    mockedGetConfig.mockRejectedValueOnce(new Error('Connection refused'));

    render(<OverviewPage />);

    await vi.waitFor(() => {
      expect(
        screen.getByText(/Backend unavailable/),
      ).toBeInTheDocument();
    });
  });

  it('syncs license path from backend config', async () => {
    mockedGetConfig.mockResolvedValueOnce({
      licenseFilePath: '/from/backend.lic',
      deviceExePaths: { holobox: '', 'keba-kiosk': '', kiosk: '' },
    });
    mockedGetStatus.mockResolvedValueOnce({
      running: false,
      pid: null,
      deviceId: null,
    });

    render(<OverviewPage />);

    await vi.waitFor(() => {
      const store = useSettingsStore.getState();
      expect(store.licenseFilePath).toBe('/from/backend.lic');
    });
  });

  it('syncs device exe paths from backend', async () => {
    mockedGetConfig.mockResolvedValueOnce({
      licenseFilePath: '',
      deviceExePaths: {
        holobox: '/backend/holobox.bat',
        'keba-kiosk': '/backend/keba.bat',
        kiosk: '/backend/kiosk.bat',
      },
    });
    mockedGetStatus.mockResolvedValueOnce({
      running: true,
      pid: 999,
      deviceId: 'holobox',
    });

    render(<OverviewPage />);

    await vi.waitFor(() => {
      const store = useSettingsStore.getState();
      expect(store.deviceExePaths.holobox).toBe('/backend/holobox.bat');
      expect(store.deviceExePaths['keba-kiosk']).toBe('/backend/keba.bat');
    });
  });

  it('does not update state after unmount (cancelled guard)', async () => {
    // Make getWriterConfig resolve slowly
    let resolveConfig!: (value: { licenseFilePath: string; deviceExePaths: Record<string, string> }) => void;
    mockedGetConfig.mockImplementationOnce(
      () => new Promise((r) => { resolveConfig = r; }),
    );

    const { unmount } = render(<OverviewPage />);

    // Unmount before the config resolves
    unmount();

    // Now resolve — should NOT cause errors
    resolveConfig({
      licenseFilePath: '/should/not/apply',
      deviceExePaths: { holobox: '', 'keba-kiosk': '', kiosk: '' },
    });

    // Give time for potential state updates
    await new Promise((r) => setTimeout(r, 50));

    // Store should NOT have been updated
    expect(useSettingsStore.getState().licenseFilePath).toBe('');
  });
});

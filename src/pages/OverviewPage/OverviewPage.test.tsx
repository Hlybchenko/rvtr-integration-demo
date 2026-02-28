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
  setGlobalExePath: vi.fn(),
  browseForFile: vi.fn(),
  browseForExe: vi.fn(),
  readVoiceAgentFromFile: vi.fn(),
  forceRewriteVoiceAgentFile: vi.fn(),
  restartProcess: vi.fn(),
  getProcessStatus: vi.fn().mockResolvedValue({ running: false, pid: null }),
  checkPixelStreamingStatus: vi.fn().mockResolvedValue({ reachable: false }),
}));

// Mock device config to avoid complex imports
vi.mock('@/config/devices', () => ({
  devices: [],
  preloadDeviceFrameImages: vi.fn(),
}));

vi.mock('@/hooks/useDetectScreenRect', () => ({
  warmDetectScreenRect: vi.fn(),
}));

const { getWriterConfig, readVoiceAgentFromFile } =
  await import('@/services/voiceAgentWriter');

const mockedGetConfig = vi.mocked(getWriterConfig);
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
    pixelStreamingUrl: '',
    voiceAgent: 'elevenlabs',
    licenseFilePath: '',
    exePath: '',
  });
});

describe('OverviewPage init effect', () => {
  it('shows backend error when backend is unreachable', async () => {
    mockedGetConfig.mockRejectedValueOnce(new Error('Connection refused'));

    render(<OverviewPage />);

    await vi.waitFor(() => {
      expect(screen.getByText(/Local server unavailable/)).toBeInTheDocument();
    });
  });

  it('syncs license path from backend config', async () => {
    mockedGetConfig.mockResolvedValueOnce({
      licenseFilePath: '/from/backend.lic',
      pixelStreamingUrl: 'https://streaming.example.com',
      exePath: '',
    });

    render(<OverviewPage />);

    await vi.waitFor(() => {
      const store = useSettingsStore.getState();
      expect(store.licenseFilePath).toBe('/from/backend.lic');
    });
  });

  it('syncs pixelStreamingUrl from backend config', async () => {
    mockedGetConfig.mockResolvedValueOnce({
      licenseFilePath: '/from/backend.lic',
      pixelStreamingUrl: 'https://pixel-stream.example.com',
      exePath: '',
    });

    render(<OverviewPage />);

    await vi.waitFor(() => {
      const store = useSettingsStore.getState();
      expect(store.pixelStreamingUrl).toBe('https://pixel-stream.example.com');
    });
  });

  it('does not update state after unmount (cancelled guard)', async () => {
    // Make getWriterConfig resolve slowly
    let resolveConfig!: (value: {
      licenseFilePath: string;
      pixelStreamingUrl: string;
      exePath: string;
    }) => void;
    mockedGetConfig.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveConfig = r;
        }),
    );

    const { unmount } = render(<OverviewPage />);

    // Unmount before the config resolves
    unmount();

    // Now resolve — should NOT cause errors
    resolveConfig({
      licenseFilePath: '/should/not/apply',
      pixelStreamingUrl: 'https://should-not-apply.com',
      exePath: '',
    });

    // Give time for potential state updates
    await new Promise((r) => setTimeout(r, 50));

    // Store should NOT have been updated
    expect(useSettingsStore.getState().licenseFilePath).toBe('');
    expect(useSettingsStore.getState().pixelStreamingUrl).toBe('');
  });
});

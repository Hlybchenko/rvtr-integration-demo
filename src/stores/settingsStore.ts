import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const ENV_WIDGET_URL = import.meta.env.VITE_DEFAULT_WIDGET_URL || '';

export type DeviceId = 'phone' | 'laptop' | 'kiosk' | 'holobox' | 'keba-kiosk';
export type VoiceAgent = 'elevenlabs' | 'gemini-live';

export const STREAMING_DEVICE_IDS: DeviceId[] = ['kiosk', 'keba-kiosk', 'holobox'];

export function isStreamingDevice(id: string): boolean {
  return (STREAMING_DEVICE_IDS as string[]).includes(id);
}

type LegacyVoiceAgent = VoiceAgent | 'google-native-audio';

/** @internal Exported for unit tests only */
export function normalizeVoiceAgent(value: LegacyVoiceAgent | undefined): VoiceAgent {
  if (value === 'google-native-audio') return 'gemini-live';
  return value === 'gemini-live' || value === 'elevenlabs' ? value : 'elevenlabs';
}

function isValidUrl(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

interface SettingsState {
  /** User-entered phone URL */
  phoneUrl: string;
  /** User-entered laptop URL */
  laptopUrl: string;
  /** Single Pixel Streaming URL for all streaming devices */
  pixelStreamingUrl: string;
  /** Selected voice agent provider */
  voiceAgent: VoiceAgent;
  /** Absolute path to the license file on the host machine */
  licenseFilePath: string;
  /** Path to the start2stream executable (.bat / .sh) */
  exePath: string;

  setDeviceUrl: (deviceId: 'phone' | 'laptop', url: string) => void;
  setPixelStreamingUrl: (url: string) => void;
  setVoiceAgent: (agent: VoiceAgent) => void;
  setLicenseFilePath: (filePath: string) => void;
  setExePath: (path: string) => void;
}

/**
 * Zustand persist migration: handles all schema versions from v1 to v10.
 *
 * Key migrations:
 *   v1 → v2:   widgetUrl split into phoneUrl + laptopUrl
 *   v7 → v8:   single start2streamPath → per-device deviceExePaths
 *   v8 → v9:   per-device streaming URLs + deviceExePaths → single pixelStreamingUrl
 *   v9 → v10:  add global exePath (collapse legacy per-device deviceExePaths)
 *   any:       google-native-audio → gemini-live (voice agent rename)
 *
 * @internal Exported for unit tests only
 */
export function migrateSettingsState(
  persistedState: unknown,
  version: number,
): Omit<
  SettingsState,
  | 'setDeviceUrl'
  | 'setPixelStreamingUrl'
  | 'setVoiceAgent'
  | 'setLicenseFilePath'
  | 'setExePath'
> {
  const state = persistedState as
    | {
        widgetUrl?: string;
        holoboxUrl?: string;
        phoneUrl?: string;
        laptopUrl?: string;
        kioskUrl?: string;
        kebaKioskUrl?: string;
        pixelStreamingUrl?: string;
        voiceAgent?: LegacyVoiceAgent;
        licenseFilePath?: string;
        start2streamPath?: string;
        deviceExePaths?: Record<string, string>;
        exePath?: string;
      }
    | undefined;

  if (!state) {
    return {
      phoneUrl: '',
      laptopUrl: '',
      pixelStreamingUrl: '',
      voiceAgent: 'elevenlabs' as VoiceAgent,
      licenseFilePath: '',
      exePath: '',
    };
  }

  // Resolve exe path from any legacy format
  const resolvedExePath =
    state.exePath ??
    state.start2streamPath ??
    (state.deviceExePaths
      ? (state.deviceExePaths.holobox ||
        state.deviceExePaths.kiosk ||
        state.deviceExePaths['keba-kiosk'] ||
        '')
      : '');

  // For v10+ states
  if (version >= 10) {
    return {
      phoneUrl: state.phoneUrl ?? '',
      laptopUrl: state.laptopUrl ?? '',
      pixelStreamingUrl: state.pixelStreamingUrl ?? '',
      voiceAgent: normalizeVoiceAgent(state.voiceAgent),
      licenseFilePath: state.licenseFilePath ?? '',
      exePath: state.exePath ?? '',
    };
  }

  // Migrate v9: just add exePath
  if (version >= 9) {
    return {
      phoneUrl: state.phoneUrl ?? '',
      laptopUrl: state.laptopUrl ?? '',
      pixelStreamingUrl: state.pixelStreamingUrl ?? '',
      voiceAgent: normalizeVoiceAgent(state.voiceAgent),
      licenseFilePath: state.licenseFilePath ?? '',
      exePath: resolvedExePath,
    };
  }

  // Migrate v8 and below: collapse per-device streaming URLs into single pixelStreamingUrl
  const pixelStreamingUrl =
    state.pixelStreamingUrl ??
    state.holoboxUrl ??
    state.kioskUrl ??
    state.kebaKioskUrl ??
    '';

  if (version < 2) {
    const legacyWidgetUrl = state.widgetUrl ?? '';
    return {
      phoneUrl: state.phoneUrl ?? legacyWidgetUrl,
      laptopUrl: state.laptopUrl ?? legacyWidgetUrl,
      pixelStreamingUrl: pixelStreamingUrl || (state.holoboxUrl ?? ''),
      voiceAgent: normalizeVoiceAgent(state.voiceAgent),
      licenseFilePath: state.licenseFilePath ?? '',
      exePath: resolvedExePath,
    };
  }

  return {
    phoneUrl: state.phoneUrl ?? '',
    laptopUrl: state.laptopUrl ?? '',
    pixelStreamingUrl,
    voiceAgent: normalizeVoiceAgent(state.voiceAgent),
    licenseFilePath: state.licenseFilePath ?? '',
    exePath: resolvedExePath,
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      phoneUrl: '',
      laptopUrl: '',
      pixelStreamingUrl: '',
      voiceAgent: 'elevenlabs',
      licenseFilePath: '',
      exePath: '',

      setDeviceUrl: (deviceId, url) => {
        if (deviceId === 'phone') set({ phoneUrl: url });
        if (deviceId === 'laptop') set({ laptopUrl: url });
      },

      setPixelStreamingUrl: (url) => set({ pixelStreamingUrl: url }),

      setVoiceAgent: (agent) => set({ voiceAgent: agent }),

      setLicenseFilePath: (filePath) => set({ licenseFilePath: filePath }),

      setExePath: (path) => set({ exePath: path }),
    }),
    {
      name: 'rvtr-settings',
      version: 10,
      migrate: migrateSettingsState,
    },
  ),
);

/** Selector that returns the raw URL for a non-streaming device */
function selectRawUrl(deviceId: string) {
  return (s: SettingsState): string => {
    if (deviceId === 'phone') return s.phoneUrl;
    if (deviceId === 'laptop') return s.laptopUrl;
    return '';
  };
}

/** Get the resolved URL for a non-streaming device (user input → env fallback) */
export function useResolvedUrl(deviceId: string): string {
  const rawUrl = useSettingsStore(selectRawUrl(deviceId));

  if (deviceId !== 'phone' && deviceId !== 'laptop') return '';

  if (isValidUrl(rawUrl)) return rawUrl;

  return ENV_WIDGET_URL;
}

/** Get raw (user-entered) URL for a non-streaming device without env fallback */
export function useRawDeviceUrl(deviceId: string): string {
  return useSettingsStore(selectRawUrl(deviceId));
}

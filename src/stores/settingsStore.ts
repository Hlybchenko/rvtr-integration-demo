import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const ENV_WIDGET_URL = import.meta.env.VITE_DEFAULT_WIDGET_URL || '';
const ENV_HOLOBOX_URL = import.meta.env.VITE_DEFAULT_HOLOBOX_URL || '';

export type DeviceId = 'phone' | 'laptop' | 'kiosk' | 'holobox' | 'keba-kiosk';
/** Device IDs that require a dedicated start2stream executable */
export type StreamDeviceId = 'holobox' | 'keba-kiosk' | 'kiosk';
export type VoiceAgent = 'elevenlabs' | 'gemini-live';

export const STREAM_DEVICE_IDS: StreamDeviceId[] = ['kiosk', 'keba-kiosk', 'holobox'];

export function isStreamDevice(id: string): id is StreamDeviceId {
  return (STREAM_DEVICE_IDS as string[]).includes(id);
}
type LegacyVoiceAgent = VoiceAgent | 'google-native-audio';

/** @internal Exported for unit tests only */
export function normalizeVoiceAgent(value: LegacyVoiceAgent | undefined): VoiceAgent {
  if (value === 'google-native-audio') return 'gemini-live';
  return value === 'gemini-live' || value === 'elevenlabs' ? value : 'elevenlabs';
}

function getEnvDefaultUrl(deviceId: DeviceId): string {
  if (deviceId === 'phone' || deviceId === 'laptop') return ENV_WIDGET_URL;
  return ENV_HOLOBOX_URL;
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
  /** User-entered kiosk URL */
  kioskUrl: string;
  /** User-entered holobox URL */
  holoboxUrl: string;
  /** User-entered keba-kiosk URL */
  kebaKioskUrl: string;
  /** Selected voice agent provider */
  voiceAgent: VoiceAgent;
  /** Absolute path to the license file on the host machine */
  licenseFilePath: string;
  /** Per-device executable paths for start2stream instances */
  deviceExePaths: Record<StreamDeviceId, string>;

  setDeviceUrl: (deviceId: DeviceId, url: string) => void;
  setVoiceAgent: (agent: VoiceAgent) => void;
  setLicenseFilePath: (filePath: string) => void;
  setDeviceExePath: (deviceId: StreamDeviceId, path: string) => void;

  /** Resolved URL for a device (user input → env fallback) */
  getDeviceUrl: (deviceId: DeviceId) => string;
}

/**
 * Zustand persist migration: handles all schema versions from v1 to v8.
 *
 * Key migrations:
 *   v1 → v2:  widgetUrl split into phoneUrl + laptopUrl
 *   v7 → v8:  single start2streamPath → per-device deviceExePaths
 *   any:      google-native-audio → gemini-live (voice agent rename)
 *
 * @internal Exported for unit tests only
 */
export function migrateSettingsState(
  persistedState: unknown,
  version: number,
): Omit<
  SettingsState,
  | 'setDeviceUrl'
  | 'setVoiceAgent'
  | 'setLicenseFilePath'
  | 'setDeviceExePath'
  | 'getDeviceUrl'
> {
  const state = persistedState as
    | {
        widgetUrl?: string;
        holoboxUrl?: string;
        phoneUrl?: string;
        laptopUrl?: string;
        kioskUrl?: string;
        kebaKioskUrl?: string;
        voiceAgent?: LegacyVoiceAgent;
        licenseFilePath?: string;
        /** Legacy single exe path (versions <= 7) */
        start2streamPath?: string;
        deviceExePaths?: Record<string, string>;
      }
    | undefined;

  const defaultExePaths: Record<StreamDeviceId, string> = {
    holobox: '',
    'keba-kiosk': '',
    kiosk: '',
  };

  if (!state) {
    return {
      phoneUrl: '',
      laptopUrl: '',
      kioskUrl: '',
      holoboxUrl: '',
      kebaKioskUrl: '',
      voiceAgent: 'elevenlabs' as VoiceAgent,
      licenseFilePath: '',
      deviceExePaths: defaultExePaths,
    };
  }

  // Migrate legacy single start2streamPath → deviceExePaths (v7 → v8)
  const migratedExePaths: Record<StreamDeviceId, string> = state.deviceExePaths
    ? {
        holobox: state.deviceExePaths.holobox ?? '',
        'keba-kiosk': state.deviceExePaths['keba-kiosk'] ?? '',
        kiosk: state.deviceExePaths.kiosk ?? '',
      }
    : state.start2streamPath
      ? {
          holobox: state.start2streamPath,
          'keba-kiosk': state.start2streamPath,
          kiosk: state.start2streamPath,
        }
      : defaultExePaths;

  if (version < 2) {
    const legacyWidgetUrl = state.widgetUrl ?? '';
    const legacyHoloboxUrl = state.holoboxUrl ?? '';

    return {
      phoneUrl: state.phoneUrl ?? legacyWidgetUrl,
      laptopUrl: state.laptopUrl ?? legacyWidgetUrl,
      kioskUrl: state.kioskUrl ?? legacyHoloboxUrl,
      holoboxUrl: state.holoboxUrl ?? legacyHoloboxUrl,
      kebaKioskUrl: state.kebaKioskUrl ?? '',
      voiceAgent: normalizeVoiceAgent(state.voiceAgent),
      licenseFilePath: state.licenseFilePath ?? '',
      deviceExePaths: migratedExePaths,
    };
  }

  return {
    phoneUrl: state.phoneUrl ?? '',
    laptopUrl: state.laptopUrl ?? '',
    kioskUrl: state.kioskUrl ?? '',
    holoboxUrl: state.holoboxUrl ?? '',
    kebaKioskUrl: state.kebaKioskUrl ?? '',
    voiceAgent: normalizeVoiceAgent(state.voiceAgent),
    licenseFilePath: state.licenseFilePath ?? '',
    deviceExePaths: migratedExePaths,
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      phoneUrl: '',
      laptopUrl: '',
      kioskUrl: '',
      holoboxUrl: '',
      kebaKioskUrl: '',
      voiceAgent: 'elevenlabs',
      licenseFilePath: '',
      deviceExePaths: { holobox: '', 'keba-kiosk': '', kiosk: '' },

      setDeviceUrl: (deviceId, url) => {
        if (deviceId === 'phone') set({ phoneUrl: url });
        if (deviceId === 'laptop') set({ laptopUrl: url });
        if (deviceId === 'kiosk') set({ kioskUrl: url });
        if (deviceId === 'holobox') set({ holoboxUrl: url });
        if (deviceId === 'keba-kiosk') set({ kebaKioskUrl: url });
      },

      setVoiceAgent: (agent) => set({ voiceAgent: agent }),

      setLicenseFilePath: (filePath) => set({ licenseFilePath: filePath }),

      setDeviceExePath: (deviceId, path) =>
        set((state) => ({
          deviceExePaths: { ...state.deviceExePaths, [deviceId]: path },
        })),

      getDeviceUrl: (deviceId) => {
        const state = get();
        const rawValue =
          deviceId === 'phone'
            ? state.phoneUrl
            : deviceId === 'laptop'
              ? state.laptopUrl
              : deviceId === 'kiosk'
                ? state.kioskUrl
                : deviceId === 'holobox'
                  ? state.holoboxUrl
                  : state.kebaKioskUrl;

        return isValidUrl(rawValue) ? rawValue : getEnvDefaultUrl(deviceId);
      },
    }),
    {
      name: 'rvtr-settings',
      version: 8,
      migrate: migrateSettingsState,
    },
  ),
);

/** Selector that returns the raw URL for a single device — single subscription */
function selectRawUrl(deviceId: string) {
  return (s: SettingsState): string => {
    if (deviceId === 'phone') return s.phoneUrl;
    if (deviceId === 'laptop') return s.laptopUrl;
    if (deviceId === 'kiosk') return s.kioskUrl;
    if (deviceId === 'holobox') return s.holoboxUrl;
    if (deviceId === 'keba-kiosk') return s.kebaKioskUrl;
    return '';
  };
}

/** Get the resolved URL for a given device id */
export function useResolvedUrl(deviceId: string): string {
  const rawUrl = useSettingsStore(selectRawUrl(deviceId));
  const getDeviceUrl = useSettingsStore((s) => s.getDeviceUrl);

  if (
    deviceId !== 'phone' &&
    deviceId !== 'laptop' &&
    deviceId !== 'kiosk' &&
    deviceId !== 'holobox' &&
    deviceId !== 'keba-kiosk'
  ) {
    return '';
  }

  // rawUrl subscription ensures re-render; getDeviceUrl applies env fallback
  return isValidUrl(rawUrl) ? rawUrl : getDeviceUrl(deviceId as DeviceId);
}

/** Get raw (user-entered) URL for a device id without env fallback */
export function useRawDeviceUrl(deviceId: string): string {
  return useSettingsStore(selectRawUrl(deviceId));
}

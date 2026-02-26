import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const ENV_WIDGET_URL = import.meta.env.VITE_DEFAULT_WIDGET_URL || '';
const ENV_HOLOBOX_URL = import.meta.env.VITE_DEFAULT_HOLOBOX_URL || '';

export type DeviceId = 'phone' | 'laptop' | 'kiosk' | 'holobox' | 'keba-kiosk';
export type VoiceAgent = 'elevenlabs' | 'gemini-live';
type LegacyVoiceAgent = VoiceAgent | 'google-native-audio';

/**
 * Devices that require a configured & synced voice agent file
 * before they can be previewed.
 */
export const VOICE_AGENT_DEPENDENT_DEVICES: ReadonlySet<DeviceId> = new Set([
  'holobox',
  'kiosk',
  'keba-kiosk',
]);

function normalizeVoiceAgent(value: LegacyVoiceAgent | undefined): VoiceAgent {
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
  /** Absolute path to start2stream executable on the host machine */
  start2streamPath: string;

  setDeviceUrl: (deviceId: DeviceId, url: string) => void;
  setVoiceAgent: (agent: VoiceAgent) => void;
  setLicenseFilePath: (filePath: string) => void;
  setStart2streamPath: (filePath: string) => void;

  /** Resolved URL for a device (user input → env fallback) */
  getDeviceUrl: (deviceId: DeviceId) => string;
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
      start2streamPath: '',

      setDeviceUrl: (deviceId, url) => {
        if (deviceId === 'phone') set({ phoneUrl: url });
        if (deviceId === 'laptop') set({ laptopUrl: url });
        if (deviceId === 'kiosk') set({ kioskUrl: url });
        if (deviceId === 'holobox') set({ holoboxUrl: url });
        if (deviceId === 'keba-kiosk') set({ kebaKioskUrl: url });
      },

      setVoiceAgent: (agent) => set({ voiceAgent: agent }),

      setLicenseFilePath: (filePath) => set({ licenseFilePath: filePath }),

      setStart2streamPath: (filePath) => set({ start2streamPath: filePath }),

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
      version: 7,
      migrate: (persistedState, version) => {
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
              start2streamPath?: string;
            }
          | undefined;

        if (!state) {
          return {
            phoneUrl: '',
            laptopUrl: '',
            kioskUrl: '',
            holoboxUrl: '',
            kebaKioskUrl: '',
            voiceAgent: 'elevenlabs' as VoiceAgent,
            licenseFilePath: '',
            start2streamPath: '',
          };
        }

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
            start2streamPath: state.start2streamPath ?? '',
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
          start2streamPath: state.start2streamPath ?? '',
        };
      },
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

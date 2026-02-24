import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const ENV_WIDGET_URL = import.meta.env.VITE_DEFAULT_WIDGET_URL || '';
const ENV_HOLOBOX_URL = import.meta.env.VITE_DEFAULT_HOLOBOX_URL || '';

export type DeviceId = 'phone' | 'laptop' | 'kiosk' | 'holobox';
export type VoiceAgent = 'elevenlabs' | 'google-native-audio';

function getEnvDefaultUrl(deviceId: DeviceId): string {
  return deviceId === 'phone' || deviceId === 'laptop' ? ENV_WIDGET_URL : ENV_HOLOBOX_URL;
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
  /** Selected voice agent provider */
  voiceAgent: VoiceAgent;

  setDeviceUrl: (deviceId: DeviceId, url: string) => void;
  setVoiceAgent: (agent: VoiceAgent) => void;

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
      voiceAgent: 'elevenlabs',

      setDeviceUrl: (deviceId, url) => {
        if (deviceId === 'phone') set({ phoneUrl: url });
        if (deviceId === 'laptop') set({ laptopUrl: url });
        if (deviceId === 'kiosk') set({ kioskUrl: url });
        if (deviceId === 'holobox') set({ holoboxUrl: url });
      },

      setVoiceAgent: (agent) => set({ voiceAgent: agent }),

      getDeviceUrl: (deviceId) => {
        const state = get();
        const rawValue =
          deviceId === 'phone'
            ? state.phoneUrl
            : deviceId === 'laptop'
              ? state.laptopUrl
              : deviceId === 'kiosk'
                ? state.kioskUrl
                : state.holoboxUrl;

        return isValidUrl(rawValue) ? rawValue : getEnvDefaultUrl(deviceId);
      },
    }),
    {
      name: 'rvtr-settings',
      version: 3,
      migrate: (persistedState, version) => {
        const state = persistedState as
          | {
              widgetUrl?: string;
              holoboxUrl?: string;
              phoneUrl?: string;
              laptopUrl?: string;
              kioskUrl?: string;
              voiceAgent?: VoiceAgent;
            }
          | undefined;

        if (!state) {
          return {
            phoneUrl: '',
            laptopUrl: '',
            kioskUrl: '',
            holoboxUrl: '',
            voiceAgent: 'elevenlabs' as VoiceAgent,
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
            voiceAgent: state.voiceAgent ?? 'elevenlabs',
          };
        }

        return {
          phoneUrl: state.phoneUrl ?? '',
          laptopUrl: state.laptopUrl ?? '',
          kioskUrl: state.kioskUrl ?? '',
          holoboxUrl: state.holoboxUrl ?? '',
          voiceAgent: state.voiceAgent ?? 'elevenlabs',
        };
      },
    },
  ),
);

/** Get the resolved URL for a given device id */
export function useResolvedUrl(deviceId: string): string {
  const getDeviceUrl = useSettingsStore((s) => s.getDeviceUrl);
  // Subscribe to raw values so the component re-renders on change
  useSettingsStore((s) => s.phoneUrl);
  useSettingsStore((s) => s.laptopUrl);
  useSettingsStore((s) => s.kioskUrl);
  useSettingsStore((s) => s.holoboxUrl);

  if (
    deviceId !== 'phone' &&
    deviceId !== 'laptop' &&
    deviceId !== 'kiosk' &&
    deviceId !== 'holobox'
  ) {
    return '';
  }

  return getDeviceUrl(deviceId);
}

/** Get raw (user-entered) URL for a device id without env fallback */
export function useRawDeviceUrl(deviceId: string): string {
  const phoneUrl = useSettingsStore((s) => s.phoneUrl);
  const laptopUrl = useSettingsStore((s) => s.laptopUrl);
  const kioskUrl = useSettingsStore((s) => s.kioskUrl);
  const holoboxUrl = useSettingsStore((s) => s.holoboxUrl);

  if (deviceId === 'phone') return phoneUrl;
  if (deviceId === 'laptop') return laptopUrl;
  if (deviceId === 'kiosk') return kioskUrl;
  if (deviceId === 'holobox') return holoboxUrl;
  return '';
}

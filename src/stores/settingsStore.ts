import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const ENV_WIDGET_URL = import.meta.env.VITE_DEFAULT_WIDGET_URL || '';
const ENV_HOLOBOX_URL = import.meta.env.VITE_DEFAULT_HOLOBOX_URL || '';

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
  /** User-entered widget URL */
  widgetUrl: string;
  /** User-entered holobox URL */
  holoboxUrl: string;

  setWidgetUrl: (url: string) => void;
  setHoloboxUrl: (url: string) => void;

  /** Resolved URL for regular devices (user input → env fallback) */
  getWidgetUrl: () => string;
  /** Resolved URL for holobox (user input → env fallback) */
  getHoloboxUrl: () => string;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      widgetUrl: '',
      holoboxUrl: '',

      setWidgetUrl: (url) => set({ widgetUrl: url }),
      setHoloboxUrl: (url) => set({ holoboxUrl: url }),

      getWidgetUrl: () => {
        const { widgetUrl } = get();
        return isValidUrl(widgetUrl) ? widgetUrl : ENV_WIDGET_URL;
      },
      getHoloboxUrl: () => {
        const { holoboxUrl } = get();
        return isValidUrl(holoboxUrl) ? holoboxUrl : ENV_HOLOBOX_URL;
      },
    }),
    {
      name: 'rvtr-settings',
    },
  ),
);

/** Get the resolved URL for a given device id */
export function useResolvedUrl(deviceId: string): string {
  const getWidgetUrl = useSettingsStore((s) => s.getWidgetUrl);
  const getHoloboxUrl = useSettingsStore((s) => s.getHoloboxUrl);
  // Subscribe to raw values so the component re-renders on change
  useSettingsStore((s) => s.widgetUrl);
  useSettingsStore((s) => s.holoboxUrl);

  return deviceId === 'holobox' || deviceId === 'kiosk'
    ? getHoloboxUrl()
    : getWidgetUrl();
}

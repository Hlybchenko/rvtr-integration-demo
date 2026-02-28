/**
 * UE Remote Control store (persisted to localStorage as `rvtr-ue-control`).
 *
 * Stores per-device UE settings (camera offsets, level, avatar, toggles)
 * and the UE API URL. Settings are keyed by DeviceId so each streaming device
 * (kiosk, keba-kiosk, holobox) remembers its own camera position independently.
 *
 * `ueReachable` is runtime-only (excluded from persist) — set by useStatusPolling.
 *
 * Important: camera values (zoom, cameraVertical/Horizontal, cameraPitch) are
 * cumulative offsets, NOT absolute positions. The UE API adds them to its current
 * state. See `resetCameraToZero` in ueRemoteApi.ts for the reversal strategy.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ─── Level catalogue ────────────────────────────────────────────────────────

export const UE_LEVELS = [
  { id: 'LVL_Master_ModernOffice', label: 'Modern Office' },
  { id: 'LVL_Master_Ravabox', label: 'Ravabox' },
  { id: 'LVL_Master_RavaboxBackground', label: 'Ravabox Background' },
  { id: 'LVL_Master_ConferenceRoom', label: 'Conference Room' },
  { id: 'LVL_Master_CustomBackground', label: 'Custom Background' },
  { id: 'LVL_Master_Logo', label: 'Logo' },
  { id: 'LVL_Master_OfficeSunset', label: 'Office Sunset' },
  { id: 'LVL_Master_White_Ravabox', label: 'White Ravabox' },
] as const;

export type UeLevelId = (typeof UE_LEVELS)[number]['id'];

// ─── Per-device settings ─────────────────────────────────────────────────────

export interface UeDeviceSettings {
  /** Zoom offset (cumulative value sent to UE) */
  zoom: number;
  /** Camera vertical offset */
  cameraVertical: number;
  /** Camera horizontal offset */
  cameraHorizontal: number;
  /** Camera pitch angle */
  cameraPitch: number;
  /** Active background level */
  level: UeLevelId;
  /** Avatar ID */
  avatarId: string;
  /** Show RAVATAR logo overlay */
  showLogo: boolean;
  /** Allow runtime avatar switching */
  allowAvatarChange: boolean;
  /** Allow voice interruption */
  allowInterruption: boolean;
  /** Output audio as PCM */
  isPcm: boolean;
}

export const DEFAULT_DEVICE_SETTINGS: UeDeviceSettings = {
  zoom: 0,
  cameraVertical: 0,
  cameraHorizontal: 0,
  cameraPitch: 0,
  level: 'LVL_Master_ModernOffice',
  avatarId: '',
  showLogo: true,
  allowAvatarChange: true,
  allowInterruption: true,
  isPcm: false,
};

// ─── Store ───────────────────────────────────────────────────────────────────

interface UeControlState {
  /** UE Remote API base URL (e.g. http://127.0.0.1:8081) */
  ueApiUrl: string;
  /** Per-device settings, keyed by DeviceId */
  deviceSettings: Record<string, UeDeviceSettings>;
  /** Runtime-only: UE API reachability (null = unknown, true/false = last check) */
  ueReachable: boolean | null;

  setUeApiUrl: (url: string) => void;
  setUeReachable: (reachable: boolean | null) => void;
  /** Partial update for a single device */
  updateDeviceSettings: (
    deviceId: string,
    patch: Partial<UeDeviceSettings>,
  ) => void;
  /** Reset device to defaults */
  resetDeviceSettings: (deviceId: string) => void;
  /** Get settings for a device (returns defaults if not yet configured) */
  getDeviceSettings: (deviceId: string) => UeDeviceSettings;
}

export const useUeControlStore = create<UeControlState>()(
  persist(
    (set, get) => ({
      ueApiUrl: '',
      deviceSettings: {},
      ueReachable: null,

      setUeApiUrl: (url) => set({ ueApiUrl: url }),
      setUeReachable: (reachable) => set({ ueReachable: reachable }),

      updateDeviceSettings: (deviceId, patch) =>
        set((state) => {
          const current = state.deviceSettings[deviceId] ?? { ...DEFAULT_DEVICE_SETTINGS };
          return {
            deviceSettings: {
              ...state.deviceSettings,
              [deviceId]: { ...current, ...patch },
            },
          };
        }),

      resetDeviceSettings: (deviceId) =>
        set((state) => {
          const next = { ...state.deviceSettings };
          delete next[deviceId];
          return { deviceSettings: next };
        }),

      getDeviceSettings: (deviceId) => {
        const stored = get().deviceSettings[deviceId];
        return stored ?? { ...DEFAULT_DEVICE_SETTINGS };
      },
    }),
    {
      name: 'rvtr-ue-control',
      version: 1,
      partialize: (state) => ({
        ueApiUrl: state.ueApiUrl,
        deviceSettings: state.deviceSettings,
      }),
    },
  ),
);

/** Non-reactive selector for device settings (use outside React) */
export function getDeviceSettingsSnapshot(deviceId: string): UeDeviceSettings {
  const stored = useUeControlStore.getState().deviceSettings[deviceId];
  return stored ?? { ...DEFAULT_DEVICE_SETTINGS };
}

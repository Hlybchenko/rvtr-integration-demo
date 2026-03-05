import { useCallback, useEffect, useRef } from 'react';
import { useUeControlStore } from '@/stores/ueControlStore';
import { sendUeCommand } from '@/services/ueRemoteApi';

export const SLIDER_DEBOUNCE_MS = 200;

/** Slider key → UE command name mapping */
export const SLIDER_COMMANDS: Record<string, { command: string; param: string }> = {
  zoom: { command: 'zoom', param: 'offset' },
  cameraVertical: { command: 'CameraVertical', param: 'offset' },
  cameraHorizontal: { command: 'CameraHorizontal', param: 'offset' },
  cameraPitch: { command: 'cameraPitch', param: 'angle' },
};

export type SliderKey = 'zoom' | 'cameraVertical' | 'cameraHorizontal' | 'cameraPitch';

interface UseSliderSendOptions {
  deviceId: string;
  /** Inject for tests — defaults to real sendUeCommand */
  sendCommand?: typeof sendUeCommand;
}

interface UseSliderSendResult {
  handleSlider: (key: SliderKey, value: number) => void;
  resetSliderState: () => void;
}

/**
 * Hook that debounces slider changes and sends delta commands to UE.
 *
 * Delta computation:
 *   delta = deviceSettings[deviceId][key] − ueCommittedCamera[key]
 *
 * `ueCommittedCamera` represents UE's actual camera position (updated after
 * every successful command). This ensures sliders work as absolute positioning
 * relative to 0: dragging from −15 to −10 sends +5 (zoom IN), not −10.
 *
 * `inFlightRef` prevents concurrent sends per key so committed camera
 * is always up-to-date before computing the next delta.
 */
export function useSliderSend({
  deviceId,
  sendCommand = sendUeCommand,
}: UseSliderSendOptions): UseSliderSendResult {
  const updateSettings = useUeControlStore((s) => s.updateDeviceSettings);

  const sliderTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** True while an HTTP send is in-flight for a given key — prevents concurrent sends */
  const inFlightRef = useRef(new Set<string>());

  // Clean up all pending timers on unmount.
  useEffect(() => {
    const timers = sliderTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  const resetSliderState = useCallback(() => {
    // Clear pending debounce timers and in-flight flags.
    // Baseline is now always read from ueCommittedCamera in the store,
    // so no local state needs resetting beyond cancellation.
    sliderTimersRef.current.forEach((t) => clearTimeout(t));
    sliderTimersRef.current.clear();
    inFlightRef.current.clear();
  }, []);

  const fireSliderSend = useCallback(
    (key: SliderKey) => {
      const state = useUeControlStore.getState();
      const url = state.ueApiUrl;
      if (!url) return;
      const cmd = SLIDER_COMMANDS[key];
      if (!cmd) return;

      // Only one send per key at a time — prevents baseline races
      if (inFlightRef.current.has(key)) return;

      // Baseline = UE's actual position; target = desired position for this device
      const baseline = state.ueCommittedCamera[key];
      const target = state.deviceSettings[deviceId]?.[key] ?? 0;
      const delta = target - baseline;
      if (delta === 0) return;

      inFlightRef.current.add(key);

      // Capture deviceId at send time — prevents stale closure reads if the
      // component re-renders with a new deviceId while this request is in-flight.
      const sendDeviceId = deviceId;

      void sendCommand(url, {
        command: cmd.command,
        [cmd.param]: String(delta),
      })
        .then((ok) => {
          inFlightRef.current.delete(key);

          if (ok) {
            // Advance committed — UE now has this position
            useUeControlStore.getState().patchUeCommittedCamera({ [key]: target });

            // Catch-up: if slider moved while we were in-flight, send again.
            // Only on success — on failure committed stays unchanged, and the
            // next debounce fire will recompute the full delta automatically.
            // Skip if deviceId changed (component re-rendered for a different device).
            const latest = useUeControlStore.getState().deviceSettings[sendDeviceId]?.[key] ?? 0;
            if (latest !== target) {
              fireSliderSend(key);
            }
          }
          // On failure: committed stays at old value.
          // Next fire will read committed fresh and recompute the correct delta.
        })
        .catch(() => {
          inFlightRef.current.delete(key);
        });
    },
    [deviceId, sendCommand],
  );

  const handleSlider = useCallback(
    (key: SliderKey, value: number) => {
      // Update store immediately (optimistic UI)
      updateSettings(deviceId, { [key]: value });

      // Debounce the actual UE command (per slider key)
      const existing = sliderTimersRef.current.get(key);
      if (existing) clearTimeout(existing);

      sliderTimersRef.current.set(
        key,
        setTimeout(() => fireSliderSend(key), SLIDER_DEBOUNCE_MS),
      );
    },
    [deviceId, updateSettings, fireSliderSend],
  );

  return { handleSlider, resetSliderState };
}

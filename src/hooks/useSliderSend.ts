import { useCallback, useEffect, useRef } from 'react';
import {
  useUeControlStore,
  type CameraPosition,
} from '@/stores/ueControlStore';
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
  resetSliderState: (camera: CameraPosition) => void;
}

export function useSliderSend({
  deviceId,
  sendCommand = sendUeCommand,
}: UseSliderSendOptions): UseSliderSendResult {
  const updateSettings = useUeControlStore((s) => s.updateDeviceSettings);

  const sliderTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Last value that was sent (or initial) — used to track the "sent" baseline */
  const sentValueRef = useRef(new Map<string, number>());
  /** True while an HTTP send is in-flight for a given key — prevents concurrent sends */
  const inFlightRef = useRef(new Set<string>());

  // Clean up all pending timers on unmount.
  useEffect(() => {
    const timers = sliderTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  const resetSliderState = useCallback((camera: CameraPosition) => {
    sliderTimersRef.current.forEach((t) => clearTimeout(t));
    sliderTimersRef.current.clear();
    inFlightRef.current.clear();
    sentValueRef.current.clear();
    sentValueRef.current.set('zoom', camera.zoom);
    sentValueRef.current.set('cameraVertical', camera.cameraVertical);
    sentValueRef.current.set('cameraHorizontal', camera.cameraHorizontal);
    sentValueRef.current.set('cameraPitch', camera.cameraPitch);
  }, []);

  const fireSliderSend = useCallback(
    (key: SliderKey) => {
      const url = useUeControlStore.getState().ueApiUrl;
      if (!url) return;
      const cmd = SLIDER_COMMANDS[key];
      if (!cmd) return;

      // Only one send per key at a time — prevents baseline races
      if (inFlightRef.current.has(key)) return;

      const baseline = sentValueRef.current.get(key) ?? 0;
      const target = useUeControlStore.getState().deviceSettings[deviceId]?.[key] ?? 0;
      const delta = target - baseline;
      if (delta === 0) return;

      inFlightRef.current.add(key);
      sentValueRef.current.set(key, target);

      void sendCommand(url, {
        command: cmd.command,
        [cmd.param]: String(delta),
      }).then((ok) => {
        inFlightRef.current.delete(key);

        if (ok) {
          useUeControlStore.getState().patchUeCommittedCamera({ [key]: target });
          // Catch-up: if slider moved while we were in-flight, send again.
          // Only on success — on failure baseline reverts, and retrying
          // would loop infinitely when UE is unreachable.
          const latest = useUeControlStore.getState().deviceSettings[deviceId]?.[key] ?? 0;
          if (latest !== target) {
            fireSliderSend(key);
          }
        } else {
          sentValueRef.current.set(key, baseline);
        }
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

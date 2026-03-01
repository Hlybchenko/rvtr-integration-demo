import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useUeControlStore,
  UE_LEVELS,
  DEFAULT_DEVICE_SETTINGS,
  ZERO_CAMERA,
  type CameraPosition,
  type UeDeviceSettings,
  type UeLevelId,
} from '@/stores/ueControlStore';
import {
  sendUeCommand,
  changeLevel,
  setLogo,
  setInterruption,
  lightUp,
  lightDown,
  changeLight,
  stopAnswer,
  resetCameraToZero,
  applyDeviceSettings,
} from '@/services/ueRemoteApi';
import styles from './UeControlPanel.module.css';

const SLIDER_DEBOUNCE_MS = 200;

/** Slider min/max ranges per camera axis.
 *  Zoom/pan are positional offsets (UE units). Pitch is an angle. */
const SLIDER_RANGES = {
  zoom:             { min: -1000, max: 1000 },
  cameraVertical:   { min: -300,  max: 300  },
  cameraHorizontal: { min: -300,  max: 300  },
  cameraPitch:      { min: -45,   max: 45   },
} as const;

/** Slider key → UE command name mapping */
const SLIDER_COMMANDS: Record<string, { command: string; param: string }> = {
  zoom: { command: 'zoom', param: 'offset' },
  cameraVertical: { command: 'CameraVertical', param: 'offset' },
  cameraHorizontal: { command: 'CameraHorizontal', param: 'offset' },
  cameraPitch: { command: 'cameraPitch', param: 'angle' },
};

type SliderKey = 'zoom' | 'cameraVertical' | 'cameraHorizontal' | 'cameraPitch';

interface UeControlPanelProps {
  deviceId: string;
}

/**
 * Floating UE Remote Control panel, rendered on streaming device pages.
 *
 * Features:
 *   - Camera sliders (zoom, vertical, horizontal, pitch) — debounced at 200ms,
 *     accumulates deltas so rapid drags don't lose offset.
 *   - Scene (level) selector, logo toggle, lighting controls, audio interruption toggle.
 *   - "Reset to defaults" — reverses camera offsets via `resetCameraToZero`,
 *     then applies `DEFAULT_DEVICE_SETTINGS`.
 *   - UE connection status badge (bottom-right pill).
 *   - Auto-closes on outside click; returns focus to PS iframe when closed.
 *
 * Slider delta tracking:
 *   `sentValueRef` holds the last baseline successfully sent to UE.
 *   On debounce fire, delta is computed as (latest store value − baseline).
 *   Baseline is advanced optimistically before the HTTP send; on failure
 *   it reverts so the next fire re-includes the missed offset.
 */
export function UeControlPanel({ deviceId }: UeControlPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const ueApiUrl = useUeControlStore((s) => s.ueApiUrl);
  const ueConnected = useUeControlStore((s) => s.ueReachable);
  // Stable selector: memoize per deviceId to avoid re-subscriptions
  const settingsSelector = useMemo(
    () => (s: { deviceSettings: Record<string, UeDeviceSettings> }) =>
      s.deviceSettings[deviceId] ?? DEFAULT_DEVICE_SETTINGS,
    [deviceId],
  );
  const settings = useUeControlStore(settingsSelector);
  const updateSettings = useUeControlStore((s) => s.updateDeviceSettings);
  const resetSettings = useUeControlStore((s) => s.resetDeviceSettings);

  // Close panel on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Return focus to streaming iframe when panel closes
  const prevOpenRef = useRef(isOpen);
  useEffect(() => {
    if (prevOpenRef.current && !isOpen) {
      // Panel just closed — find and refocus the persistent iframe
      const iframe = document.querySelector<HTMLIFrameElement>(
        'iframe[title="Pixel Streaming"]',
      );
      if (iframe) {
        requestAnimationFrame(() => {
          try {
            iframe.focus();
          } catch {
            // cross-origin
          }
        });
      }
    }
    prevOpenRef.current = isOpen;
  }, [isOpen]);

  // ── Debounced slider handler ──────────────────────────────────────────────
  // Per-key timers so concurrent slider movements don't cancel each other.
  //
  // NOTE: `useUeControlStore.getState()` is used inside setTimeout callbacks
  // and onClick handlers instead of reading from hook state. In debounced
  // callbacks this avoids stale closures — the timer fires after the closure
  // was created, so hook-level state would be outdated. In onClick handlers
  // the same pattern is used for consistency. `.getState()` reads the latest
  // Zustand snapshot directly.

  const sliderTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Last value that was sent (or initial) — used to track the "sent" baseline */
  const sentValueRef = useRef(new Map<string, number>());
  /** True while an HTTP send is in-flight for a given key — prevents concurrent sends */
  const inFlightRef = useRef(new Set<string>());
  // Clean up all pending timers on unmount.
  // Copy ref to local var so cleanup captures the same Map instance.
  useEffect(() => {
    const timers = sliderTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  // Cancel pending slider timers and seed baselines at the given camera
  // values. After this call, slider drags compute deltas from `camera`
  // which must reflect what we believe UE currently has.
  const resetSliderState = (camera: CameraPosition) => {
    sliderTimersRef.current.forEach((t) => clearTimeout(t));
    sliderTimersRef.current.clear();
    inFlightRef.current.clear();
    sentValueRef.current.clear();
    sentValueRef.current.set('zoom', camera.zoom);
    sentValueRef.current.set('cameraVertical', camera.cameraVertical);
    sentValueRef.current.set('cameraHorizontal', camera.cameraHorizontal);
    sentValueRef.current.set('cameraPitch', camera.cameraPitch);
  };

  // ── Auto-apply saved settings on device switch ──────────────────────────
  // Generation counter ensures rapid device switches don't overlap: only the
  // latest switch's commands run to completion.
  const applyGenRef = useRef(0);
  useEffect(() => {
    const desired = useUeControlStore.getState().getDeviceSettings(deviceId);
    resetSliderState(desired);

    const url = useUeControlStore.getState().ueApiUrl;
    if (!url) return;

    const gen = ++applyGenRef.current;
    const committed = useUeControlStore.getState().ueCommittedCamera;

    void (async () => {
      // Reset camera to zero from current committed position
      const afterReset = await resetCameraToZero(url, committed);
      if (applyGenRef.current !== gen) return;
      useUeControlStore.getState().setUeCommittedCamera(afterReset);

      // Apply the new device's saved settings
      const { newCommitted } = await applyDeviceSettings(url, desired, afterReset);
      if (applyGenRef.current !== gen) return;
      useUeControlStore.getState().setUeCommittedCamera(newCommitted);
    })();
  }, [deviceId]);

  // Sends the delta for a single slider key. Extracted so it can be called
  // both from the debounce timer and as a catch-up after an in-flight send.
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

      void sendUeCommand(url, {
        command: cmd.command,
        [cmd.param]: String(delta),
      }).then((ok) => {
        if (ok) {
          useUeControlStore.getState().patchUeCommittedCamera({ [key]: target });
        } else {
          sentValueRef.current.set(key, baseline);
        }
        inFlightRef.current.delete(key);

        // Catch-up: if slider moved while we were in-flight, send again
        const latest = useUeControlStore.getState().deviceSettings[deviceId]?.[key] ?? 0;
        if (latest !== (sentValueRef.current.get(key) ?? 0)) {
          fireSliderSend(key);
        }
      });
    },
    [deviceId],
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

  // ── Toggle handler ────────────────────────────────────────────────────────

  const handleToggle = useCallback(
    (
      key: keyof Pick<UeDeviceSettings, 'showLogo' | 'allowInterruption'>,
      value: boolean,
      sendFn: (baseUrl: string, val: boolean) => Promise<boolean>,
    ) => {
      updateSettings(deviceId, { [key]: value });
      const url = useUeControlStore.getState().ueApiUrl;
      if (url) void sendFn(url, value);
    },
    [deviceId, updateSettings],
  );

  // ── Level handler ─────────────────────────────────────────────────────────

  const handleLevel = useCallback(
    (level: UeLevelId) => {
      updateSettings(deviceId, { level });
      const url = useUeControlStore.getState().ueApiUrl;
      if (url) void changeLevel(url, level);
    },
    [deviceId, updateSettings],
  );

  const handleReset = useCallback(() => {
    // Invalidate any in-flight auto-apply or previous reset/re-sync
    const gen = ++applyGenRef.current;

    // Seed baselines at zero — defaults have all camera values at 0
    resetSliderState(ZERO_CAMERA);

    // Reset device settings in store (UI immediately shows defaults)
    resetSettings(deviceId);

    // Send reverse camera deltas from committed position + default absolute commands
    const url = useUeControlStore.getState().ueApiUrl;
    const committed = useUeControlStore.getState().ueCommittedCamera;

    if (url) {
      void (async () => {
        const newCommitted = await resetCameraToZero(url, committed);
        if (applyGenRef.current !== gen) return;
        useUeControlStore.getState().setUeCommittedCamera(newCommitted);
        await applyDeviceSettings(url, DEFAULT_DEVICE_SETTINGS, newCommitted);
      })();
    }
  }, [deviceId, resetSettings]);

  if (!ueApiUrl) return null;

  return (
    <div ref={panelRef} className={styles.wrapper} data-ue-panel>
      {/* Status label — centered at top */}
      {ueConnected !== null && (
        <div className={styles.statusLabel}>
          <span
            className={`${styles.statusDot} ${
              ueConnected ? styles.statusDotConnected : styles.statusDotDisconnected
            }`}
          />
          <span className={styles.statusText}>
            {ueConnected ? 'UE Connected' : 'UE Offline'}
          </span>
        </div>
      )}

      {/* Trigger button */}
      <button
        type="button"
        className={`${styles.trigger} ${isOpen ? styles.triggerActive : ''}`}
        onClick={() => setIsOpen((v) => !v)}
        title="UE Remote Control"
      >
        <span className={styles.triggerIcon}>&#9881;</span>
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className={styles.panel}>
          {/* ── Camera & Zoom ── */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Camera</h3>

            <div className={styles.controlRow}>
              <span className={styles.controlLabel}>Zoom</span>
              <input
                type="range"
                className={styles.slider}
                min={SLIDER_RANGES.zoom.min}
                max={SLIDER_RANGES.zoom.max}
                step={1}
                value={settings.zoom}
                onChange={(e) =>
                  handleSlider('zoom', Number(e.target.value))
                }
              />
              <span className={styles.controlValue}>{settings.zoom}</span>
            </div>

            <div className={styles.controlRow}>
              <span className={styles.controlLabel}>Vertical</span>
              <input
                type="range"
                className={styles.slider}
                min={SLIDER_RANGES.cameraVertical.min}
                max={SLIDER_RANGES.cameraVertical.max}
                step={1}
                value={settings.cameraVertical}
                onChange={(e) =>
                  handleSlider('cameraVertical', Number(e.target.value))
                }
              />
              <span className={styles.controlValue}>{settings.cameraVertical}</span>
            </div>

            <div className={styles.controlRow}>
              <span className={styles.controlLabel}>Horizontal</span>
              <input
                type="range"
                className={styles.slider}
                min={SLIDER_RANGES.cameraHorizontal.min}
                max={SLIDER_RANGES.cameraHorizontal.max}
                step={1}
                value={settings.cameraHorizontal}
                onChange={(e) =>
                  handleSlider('cameraHorizontal', Number(e.target.value))
                }
              />
              <span className={styles.controlValue}>{settings.cameraHorizontal}</span>
            </div>

            <div className={styles.controlRow}>
              <span className={styles.controlLabel}>Pitch</span>
              <input
                type="range"
                className={styles.slider}
                min={SLIDER_RANGES.cameraPitch.min}
                max={SLIDER_RANGES.cameraPitch.max}
                step={1}
                value={settings.cameraPitch}
                onChange={(e) =>
                  handleSlider('cameraPitch', Number(e.target.value))
                }
              />
              <span className={styles.controlValue}>{settings.cameraPitch}</span>
            </div>
          </div>

          {/* ── Scene / Level ── */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Scene</h3>
            <select
              className={styles.select}
              value={settings.level}
              onChange={(e) => handleLevel(e.target.value as UeLevelId)}
            >
              {UE_LEVELS.map((lvl) => (
                <option key={lvl.id} value={lvl.id}>
                  {lvl.label}
                </option>
              ))}
            </select>
          </div>

          {/* ── Avatar ── */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Avatar</h3>

            <div className={styles.controlRow}>
              <span className={styles.controlLabel}>Show logo</span>
              <input
                type="checkbox"
                className={styles.toggle}
                checked={settings.showLogo}
                onChange={(e) => handleToggle('showLogo', e.target.checked, setLogo)}
              />
            </div>

            <div className={styles.buttonRow}>
              <button
                type="button"
                className={styles.smallButton}
                onClick={() => { const u = useUeControlStore.getState().ueApiUrl; if (u) void stopAnswer(u); }}
              >
                Stop Answer
              </button>
            </div>
          </div>

          {/* ── Lighting ── */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Lighting</h3>

            <div className={styles.buttonRow}>
              <button
                type="button"
                className={styles.smallButton}
                onClick={() => { const u = useUeControlStore.getState().ueApiUrl; if (u) void lightUp(u); }}
              >
                Light +
              </button>
              <button
                type="button"
                className={styles.smallButton}
                onClick={() => { const u = useUeControlStore.getState().ueApiUrl; if (u) void lightDown(u); }}
              >
                Light -
              </button>
              <button
                type="button"
                className={styles.smallButton}
                onClick={() => { const u = useUeControlStore.getState().ueApiUrl; if (u) void changeLight(u); }}
              >
                Toggle type
              </button>
            </div>
          </div>

          {/* ── Audio ── */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Audio</h3>

            <div className={styles.controlRow}>
              <span className={styles.controlLabel}>Allow interruption</span>
              <input
                type="checkbox"
                className={styles.toggle}
                checked={settings.allowInterruption}
                onChange={(e) => handleToggle('allowInterruption', e.target.checked, setInterruption)}
              />
            </div>
          </div>

          {/* Reset / Re-sync */}
          <div className={styles.buttonRow}>
            <button type="button" className={styles.resetButton} onClick={handleReset}>
              Reset to defaults
            </button>
            <button
              type="button"
              className={styles.resetButton}
              onClick={() => {
                // Invalidate any in-flight auto-apply or previous reset
                const gen = ++applyGenRef.current;
                // Assume UE is at zero (fresh start), then re-apply current settings
                const desired = useUeControlStore.getState().getDeviceSettings(deviceId);
                resetSliderState(desired);
                useUeControlStore.getState().resetUeCommittedCamera();
                const url = useUeControlStore.getState().ueApiUrl;
                if (url) {
                  void applyDeviceSettings(url, desired, ZERO_CAMERA).then(({ newCommitted }) => {
                    if (applyGenRef.current !== gen) return;
                    useUeControlStore.getState().setUeCommittedCamera(newCommitted);
                  });
                }
              }}
            >
              Re-sync UE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

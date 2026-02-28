import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useUeControlStore,
  UE_LEVELS,
  DEFAULT_DEVICE_SETTINGS,
  type UeDeviceSettings,
  type UeLevelId,
} from '@/stores/ueControlStore';
import {
  sendUeCommand,
  changeLevel,
  changeAvatarById,
  setLogo,
  setAllowAvatarChange,
  setInterruption,
  setOutputAudioFormat,
  lightUp,
  lightDown,
  changeLight,
  stopAnswer,
} from '@/services/ueRemoteApi';
import styles from './UeControlPanel.module.css';

const SLIDER_DEBOUNCE_MS = 200;

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
  // Accumulated pending deltas ensure rapid slider moves don't lose offset.

  const sliderTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Accumulated delta not yet sent to UE, keyed by slider */
  const pendingDeltaRef = useRef(new Map<string, number>());
  /** Last value that was sent (or initial) — used to track the "sent" baseline */
  const sentValueRef = useRef(new Map<string, number>());
  /** Timer for debounced avatar ID change */
  const avatarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up all pending timers on unmount.
  // Copy ref to local var so cleanup captures the same Map instance.
  useEffect(() => {
    const timers = sliderTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      if (avatarTimerRef.current) clearTimeout(avatarTimerRef.current);
    };
  }, []);

  const handleSlider = useCallback(
    (key: SliderKey, value: number) => {
      // Read the baseline from sentValue; fallback to current store value
      const baseline = sentValueRef.current.get(key)
        ?? useUeControlStore.getState().deviceSettings[deviceId]?.[key]
        ?? 0;
      const accumulatedDelta = value - baseline;
      pendingDeltaRef.current.set(key, accumulatedDelta);

      // Update store immediately (optimistic UI)
      updateSettings(deviceId, { [key]: value });

      // Debounce the actual UE command (per slider key)
      const existing = sliderTimersRef.current.get(key);
      if (existing) clearTimeout(existing);

      sliderTimersRef.current.set(
        key,
        setTimeout(() => {
          const url = useUeControlStore.getState().ueApiUrl;
          const delta = pendingDeltaRef.current.get(key) ?? 0;
          pendingDeltaRef.current.set(key, 0);

          if (!url || delta === 0) return;
          const cmd = SLIDER_COMMANDS[key];
          if (!cmd) return;

          void sendUeCommand(url, {
            command: cmd.command,
            [cmd.param]: String(delta),
          }).then((ok) => {
            if (ok) {
              // Only advance baseline on successful send
              sentValueRef.current.set(key, value);
            }
            // On failure: baseline stays — next delta will include the missed offset
          });
        }, SLIDER_DEBOUNCE_MS),
      );
    },
    [deviceId, updateSettings],
  );

  // ── Toggle handler ────────────────────────────────────────────────────────

  const handleToggle = useCallback(
    (
      key: keyof Pick<UeDeviceSettings, 'showLogo' | 'allowAvatarChange' | 'allowInterruption' | 'isPcm'>,
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

  // ── Avatar handler ────────────────────────────────────────────────────────

  const handleAvatarId = useCallback(
    (avatarId: string) => {
      updateSettings(deviceId, { avatarId });

      if (avatarTimerRef.current) clearTimeout(avatarTimerRef.current);
      if (avatarId.trim()) {
        avatarTimerRef.current = setTimeout(() => {
          const url = useUeControlStore.getState().ueApiUrl;
          if (url) void changeAvatarById(url, avatarId);
        }, 600);
      }
    },
    [deviceId, updateSettings],
  );

  const handleReset = useCallback(() => {
    resetSettings(deviceId);
    // Clear accumulated slider state so next move starts from defaults
    pendingDeltaRef.current.clear();
    sentValueRef.current.clear();
    sliderTimersRef.current.forEach((t) => clearTimeout(t));
    sliderTimersRef.current.clear();
  }, [deviceId, resetSettings]);

  if (!ueApiUrl) return null;

  return (
    <div ref={panelRef} className={styles.wrapper} data-ue-panel>
      {/* Trigger button */}
      <button
        type="button"
        className={`${styles.trigger} ${isOpen ? styles.triggerActive : ''}`}
        onClick={() => setIsOpen((v) => !v)}
        title="UE Remote Control"
      >
        <span className={styles.triggerIcon}>&#9881;</span>
        {ueConnected !== null && (
          <span
            className={`${styles.statusDot} ${
              ueConnected ? styles.statusDotConnected : styles.statusDotDisconnected
            }`}
          />
        )}
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
                min={-200}
                max={200}
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
                min={-100}
                max={100}
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
                min={-100}
                max={100}
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
                min={-90}
                max={90}
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
              <span className={styles.controlLabel}>ID</span>
              <input
                type="text"
                className={styles.smallInput}
                placeholder="e.g. avatar_01"
                value={settings.avatarId}
                onChange={(e) => handleAvatarId(e.target.value)}
                spellCheck={false}
              />
            </div>

            <div className={styles.controlRow}>
              <span className={styles.controlLabel}>Show logo</span>
              <input
                type="checkbox"
                className={styles.toggle}
                checked={settings.showLogo}
                onChange={(e) => handleToggle('showLogo', e.target.checked, setLogo)}
              />
            </div>

            <div className={styles.controlRow}>
              <span className={styles.controlLabel}>Allow avatar switch</span>
              <input
                type="checkbox"
                className={styles.toggle}
                checked={settings.allowAvatarChange}
                onChange={(e) => handleToggle('allowAvatarChange', e.target.checked, setAllowAvatarChange)}
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

          {/* ── Lighting & Audio ── */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Lighting & Audio</h3>

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

            <div className={styles.controlRow}>
              <span className={styles.controlLabel}>Allow interruption</span>
              <input
                type="checkbox"
                className={styles.toggle}
                checked={settings.allowInterruption}
                onChange={(e) => handleToggle('allowInterruption', e.target.checked, setInterruption)}
              />
            </div>

            <div className={styles.controlRow}>
              <span className={styles.controlLabel}>Raw audio (PCM)</span>
              <input
                type="checkbox"
                className={styles.toggle}
                checked={settings.isPcm}
                onChange={(e) => handleToggle('isPcm', e.target.checked, setOutputAudioFormat)}
              />
            </div>
          </div>

          {/* Reset */}
          <button type="button" className={styles.resetButton} onClick={handleReset}>
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}

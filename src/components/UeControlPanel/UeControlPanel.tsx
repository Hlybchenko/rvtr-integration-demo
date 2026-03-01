import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useUeControlStore,
  UE_LEVELS,
  DEFAULT_DEVICE_SETTINGS,
  ZERO_CAMERA,
  type UeDeviceSettings,
  type UeLevelId,
} from '@/stores/ueControlStore';
import {
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
import { useSliderSend } from '@/hooks/useSliderSend';
import styles from './UeControlPanel.module.css';

/** Slider min/max ranges per camera axis (UI steps).
 *  `scale` converts a UI step to UE units (offset / angle). */
const SLIDER_RANGES = {
  zoom:             { min: -20, max: 20, scale: 50   },
  cameraVertical:   { min: -20, max: 20, scale: 15   },
  cameraHorizontal: { min: -20, max: 20, scale: 15   },
  cameraPitch:      { min: -20, max: 20, scale: 2.25 },
} as const;

// ── Focus-free slider ──────────────────────────────────────────────────
// Uses <div> instead of <input type="range"> so it never enters the
// browser focus system. The global mousedown capture handler in
// PersistentPixelStreaming calls preventDefault() on non-form-control
// elements, which blocks focus theft WITHOUT blocking our mouse events.
// Result: slider drags work perfectly while focus stays on the iframe.

interface DivSliderProps {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}

function DivSlider({ min, max, value, onChange }: DivSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const rangeRef = useRef({ min, max });
  rangeRef.current = { min, max };

  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

  const handleMouseDown = (e: React.MouseEvent) => {
    const track = trackRef.current;
    if (!track) return;

    const calc = (clientX: number): number => {
      const { min: mn, max: mx } = rangeRef.current;
      const rect = track.getBoundingClientRect();
      const r = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(mn + r * (mx - mn));
    };

    setDragging(true);
    onChangeRef.current(calc(e.clientX));

    const onMove = (ev: MouseEvent) => onChangeRef.current(calc(ev.clientX));
    const onUp = () => {
      setDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={trackRef}
      className={`${styles.sliderTrack} ${dragging ? styles.sliderTrackActive : ''}`}
      onMouseDown={handleMouseDown}
    >
      <div
        className={`${styles.sliderThumb} ${dragging ? styles.sliderThumbActive : ''}`}
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}

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

  const { handleSlider, resetSliderState } = useSliderSend({ deviceId });

  // DEBUG: auto-apply disabled to isolate focus bug
  const applyGenRef = useRef(0);

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
  }, [deviceId, resetSettings, resetSliderState]);

  return (
    <div ref={panelRef} className={styles.wrapper} data-ue-panel>
      {/* Status label — HIDDEN until backend provides a dedicated health-check endpoint.
          The previous `{ command: 'ping' }` was not a real UE command, causing false
          "UE Offline" reports. To re-enable: add a real ping endpoint, uncomment
          the health check in useStatusPolling.ts, and restore this block. */}

      {/* Trigger button — always visible, dimmed when no UE URL */}
      <button
        type="button"
        className={`${styles.trigger} ${isOpen ? styles.triggerActive : ''} ${!ueApiUrl ? styles.triggerDimmed : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setIsOpen((v) => !v)}
        title={ueApiUrl ? 'UE Remote Control' : 'UE Remote Control — set API URL in Settings'}
      >
        <span className={styles.triggerIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            {/* Horizontal slider tracks */}
            <line x1="3" y1="6" x2="17" y2="6" strokeWidth="1" opacity="0.3" />
            <line x1="3" y1="10" x2="17" y2="10" strokeWidth="1" opacity="0.3" />
            <line x1="3" y1="14" x2="17" y2="14" strokeWidth="1" opacity="0.3" />
            {/* Slider knobs */}
            <circle className={styles.knob1} cx="8" cy="6" r="2" />
            <circle className={styles.knob2} cx="13" cy="10" r="2" />
            <circle className={styles.knob3} cx="6" cy="14" r="2" />
            {/* Knob center dots */}
            <circle cx="8" cy="6" r="0.5" fill="currentColor" stroke="none" opacity="0.5" />
            <circle cx="13" cy="10" r="0.5" fill="currentColor" stroke="none" opacity="0.5" />
            <circle cx="6" cy="14" r="0.5" fill="currentColor" stroke="none" opacity="0.5" />
          </svg>
        </span>
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className={styles.panel}>
          {!ueApiUrl && (
            <div className={styles.noUrlHint}>
              Set <strong>UE API URL</strong> on the{' '}
              <a href="/" className={styles.noUrlLink}>Settings</a> page to enable controls.
            </div>
          )}

          {/* ── Camera & Zoom ── */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Camera</h3>

            <div className={styles.controlRow}>
              <span className={styles.controlLabel}>Zoom</span>
              <DivSlider
                min={SLIDER_RANGES.zoom.min}
                max={SLIDER_RANGES.zoom.max}
                value={Math.round(settings.zoom / SLIDER_RANGES.zoom.scale)}
                onChange={(v) => handleSlider('zoom', v * SLIDER_RANGES.zoom.scale)}
              />
              <span className={styles.controlValue}>{Math.round(settings.zoom / SLIDER_RANGES.zoom.scale)}</span>
            </div>

            <div className={styles.controlRow}>
              <span className={styles.controlLabel}>Vertical</span>
              <DivSlider
                min={SLIDER_RANGES.cameraVertical.min}
                max={SLIDER_RANGES.cameraVertical.max}
                value={Math.round(settings.cameraVertical / SLIDER_RANGES.cameraVertical.scale)}
                onChange={(v) => handleSlider('cameraVertical', v * SLIDER_RANGES.cameraVertical.scale)}
              />
              <span className={styles.controlValue}>{Math.round(settings.cameraVertical / SLIDER_RANGES.cameraVertical.scale)}</span>
            </div>

            <div className={styles.controlRow}>
              <span className={styles.controlLabel}>Horizontal</span>
              <DivSlider
                min={SLIDER_RANGES.cameraHorizontal.min}
                max={SLIDER_RANGES.cameraHorizontal.max}
                value={Math.round(settings.cameraHorizontal / SLIDER_RANGES.cameraHorizontal.scale)}
                onChange={(v) => handleSlider('cameraHorizontal', v * SLIDER_RANGES.cameraHorizontal.scale)}
              />
              <span className={styles.controlValue}>{Math.round(settings.cameraHorizontal / SLIDER_RANGES.cameraHorizontal.scale)}</span>
            </div>

            <div className={styles.controlRow}>
              <span className={styles.controlLabel}>Pitch</span>
              <DivSlider
                min={SLIDER_RANGES.cameraPitch.min}
                max={SLIDER_RANGES.cameraPitch.max}
                value={Math.round(settings.cameraPitch / SLIDER_RANGES.cameraPitch.scale)}
                onChange={(v) => handleSlider('cameraPitch', v * SLIDER_RANGES.cameraPitch.scale)}
              />
              <span className={styles.controlValue}>{Math.round(settings.cameraPitch / SLIDER_RANGES.cameraPitch.scale)}</span>
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

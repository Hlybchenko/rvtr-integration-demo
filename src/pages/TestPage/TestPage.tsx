import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
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
import { useSliderSend, type SliderKey } from '@/hooks/useSliderSend';
import { isValidUrl } from '@/utils/isValidUrl';
import styles from './TestPage.module.css';

const DEVICE_ID = 'test';

const SANDBOX =
  import.meta.env.VITE_IFRAME_SANDBOX ||
  'allow-scripts allow-same-origin allow-forms allow-popups';

const SLIDER_RANGES = {
  zoom:             { min: -20, max: 20, scale: 50   },
  cameraVertical:   { min: -20, max: 20, scale: 15   },
  cameraHorizontal: { min: -20, max: 20, scale: 15   },
  cameraPitch:      { min: -20, max: 20, scale: 2.25 },
} as const;

// ── Focus-free slider ─────────────────────────────────────────────────

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
      className={styles.sliderTrack}
      onMouseDown={handleMouseDown}
    >
      <div
        className={`${styles.sliderThumb} ${dragging ? styles.sliderThumbActive : ''}`}
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────

export function TestPage() {
  // ── PS URL ──
  const pixelStreamingUrl = useSettingsStore((s) => s.pixelStreamingUrl);
  const setPixelStreamingUrl = useSettingsStore((s) => s.setPixelStreamingUrl);
  const [psUrlInput, setPsUrlInput] = useState(pixelStreamingUrl);
  const psUrlDirtyRef = useRef(false);

  // ── UE API URL ──
  const ueApiUrl = useUeControlStore((s) => s.ueApiUrl);
  const setUeApiUrl = useUeControlStore((s) => s.setUeApiUrl);
  const [ueUrlInput, setUeUrlInput] = useState(ueApiUrl);
  const ueUrlDirtyRef = useRef(false);

  // ── UE device settings ──
  const settings = useUeControlStore(
    (s) => s.deviceSettings[DEVICE_ID] ?? DEFAULT_DEVICE_SETTINGS,
  );
  const updateSettings = useUeControlStore((s) => s.updateDeviceSettings);
  const resetSettings = useUeControlStore((s) => s.resetDeviceSettings);

  const { handleSlider, resetSliderState } = useSliderSend({ deviceId: DEVICE_ID });
  const applyGenRef = useRef(0);

  // ── Debounced URL saves ──
  useEffect(() => {
    const trimmed = psUrlInput.trim();
    if (trimmed === pixelStreamingUrl) { psUrlDirtyRef.current = false; return; }
    if (!trimmed && !psUrlDirtyRef.current) return;
    if (trimmed && !isValidUrl(trimmed)) return;
    const t = setTimeout(() => { setPixelStreamingUrl(trimmed); psUrlDirtyRef.current = false; }, 400);
    return () => clearTimeout(t);
  }, [psUrlInput, pixelStreamingUrl, setPixelStreamingUrl]);

  useEffect(() => {
    const trimmed = ueUrlInput.trim();
    if (trimmed === ueApiUrl) { ueUrlDirtyRef.current = false; return; }
    if (!trimmed && !ueUrlDirtyRef.current) return;
    if (trimmed && !isValidUrl(trimmed)) return;
    const t = setTimeout(() => { setUeApiUrl(trimmed); ueUrlDirtyRef.current = false; }, 400);
    return () => clearTimeout(t);
  }, [ueUrlInput, ueApiUrl, setUeApiUrl]);

  // ── Handlers ──
  const handleToggle = useCallback(
    (
      key: keyof Pick<UeDeviceSettings, 'showLogo' | 'allowInterruption'>,
      value: boolean,
      sendFn: (baseUrl: string, val: boolean) => Promise<boolean>,
    ) => {
      updateSettings(DEVICE_ID, { [key]: value });
      const url = useUeControlStore.getState().ueApiUrl;
      if (url) void sendFn(url, value);
    },
    [updateSettings],
  );

  const handleLevel = useCallback(
    (level: UeLevelId) => {
      updateSettings(DEVICE_ID, { level });
      const url = useUeControlStore.getState().ueApiUrl;
      if (url) void changeLevel(url, level);
    },
    [updateSettings],
  );

  const handleReset = useCallback(() => {
    const gen = ++applyGenRef.current;
    resetSliderState(ZERO_CAMERA);
    resetSettings(DEVICE_ID);
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
  }, [resetSettings, resetSliderState]);

  const handleResync = useCallback(() => {
    const gen = ++applyGenRef.current;
    const desired = useUeControlStore.getState().getDeviceSettings(DEVICE_ID);
    resetSliderState(desired);
    useUeControlStore.getState().resetUeCommittedCamera();
    const url = useUeControlStore.getState().ueApiUrl;
    if (url) {
      void applyDeviceSettings(url, desired, ZERO_CAMERA).then(({ newCommitted }) => {
        if (applyGenRef.current !== gen) return;
        useUeControlStore.getState().setUeCommittedCamera(newCommitted);
      });
    }
  }, [resetSliderState]);

  const resolvedSandbox = SANDBOX === 'none' ? undefined : SANDBOX;

  // ── Slider helper ──
  const renderSlider = (key: SliderKey, label: string) => {
    const range = SLIDER_RANGES[key];
    return (
      <div className={styles.controlRow}>
        <span className={styles.controlLabel}>{label}</span>
        <DivSlider
          min={range.min}
          max={range.max}
          value={Math.round(settings[key] / range.scale)}
          onChange={(v) => handleSlider(key, v * range.scale)}
        />
        <span className={styles.controlValue}>{Math.round(settings[key] / range.scale)}</span>
      </div>
    );
  };

  return (
    <div className={styles.page}>
      {/* ── Top bar: URL inputs ── */}
      <div className={styles.topBar}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ps-url">Pixel Streaming URL</label>
          <input
            id="ps-url"
            className={styles.input}
            type="url"
            placeholder="https://stream.example.com"
            value={psUrlInput}
            onChange={(e) => { psUrlDirtyRef.current = true; setPsUrlInput(e.target.value); }}
            spellCheck={false}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ue-url">UE Remote API</label>
          <input
            id="ue-url"
            className={styles.input}
            type="url"
            placeholder="http://127.0.0.1:8081"
            value={ueUrlInput}
            onChange={(e) => { ueUrlDirtyRef.current = true; setUeUrlInput(e.target.value); }}
            spellCheck={false}
          />
        </div>
      </div>

      {/* ── Iframe rectangle ── */}
      <div className={styles.iframeArea}>
        {pixelStreamingUrl ? (
          <iframe
            className={styles.iframe}
            src={pixelStreamingUrl}
            title="Pixel Streaming"
            sandbox={resolvedSandbox}
            allow="autoplay; microphone; fullscreen"
          />
        ) : (
          <div className={styles.iframePlaceholder}>
            Enter Pixel Streaming URL above
          </div>
        )}
      </div>

      {/* ── Right panel: UE controls ── */}
      <div className={styles.controlPanel}>
        {/* Camera */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Camera</h3>
          {renderSlider('zoom', 'Zoom')}
          {renderSlider('cameraVertical', 'Vertical')}
          {renderSlider('cameraHorizontal', 'Horizontal')}
          {renderSlider('cameraPitch', 'Pitch')}
        </div>

        {/* Scene */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Scene</h3>
          <select
            className={styles.select}
            value={settings.level}
            onChange={(e) => handleLevel(e.target.value as UeLevelId)}
          >
            {UE_LEVELS.map((lvl) => (
              <option key={lvl.id} value={lvl.id}>{lvl.label}</option>
            ))}
          </select>
        </div>

        {/* Avatar */}
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
            <span />
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

        {/* Lighting */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Lighting</h3>
          <div className={styles.buttonRow}>
            <button type="button" className={styles.smallButton}
              onClick={() => { const u = useUeControlStore.getState().ueApiUrl; if (u) void lightUp(u); }}>
              Light +
            </button>
            <button type="button" className={styles.smallButton}
              onClick={() => { const u = useUeControlStore.getState().ueApiUrl; if (u) void lightDown(u); }}>
              Light -
            </button>
            <button type="button" className={styles.smallButton}
              onClick={() => { const u = useUeControlStore.getState().ueApiUrl; if (u) void changeLight(u); }}>
              Toggle type
            </button>
          </div>
        </div>

        {/* Audio */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Audio</h3>
          <div className={styles.controlRow}>
            <span className={styles.controlLabel}>Interruption</span>
            <input
              type="checkbox"
              className={styles.toggle}
              checked={settings.allowInterruption}
              onChange={(e) => handleToggle('allowInterruption', e.target.checked, setInterruption)}
            />
            <span />
          </div>
        </div>

        {/* Reset / Re-sync */}
        <div className={styles.buttonRow}>
          <button type="button" className={styles.resetButton} onClick={handleReset}>
            Reset defaults
          </button>
          <button type="button" className={styles.resetButton} onClick={handleResync}>
            Re-sync UE
          </button>
        </div>
      </div>
    </div>
  );
}

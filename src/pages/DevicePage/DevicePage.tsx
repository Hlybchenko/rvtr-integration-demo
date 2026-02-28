import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router';
import { devicesMap } from '@/config/devices';
import { useResolvedUrl, isStreamingDevice } from '@/stores/settingsStore';
import { useStreamingStore } from '@/stores/streamingStore';
import { useUeControlStore, getDeviceSettingsSnapshot } from '@/stores/ueControlStore';
import { applyDeviceSettings } from '@/services/ueRemoteApi';
import { DevicePreview } from '@/components/DevicePreview/DevicePreview';
import { UeControlPanel } from '@/components/UeControlPanel/UeControlPanel';
import styles from './DevicePage.module.css';

const EXIT_TRANSITION_MS = 220;
const ENTER_TRANSITION_MS = 1500;

type TransitionPhase = 'idle' | 'exiting' | 'entering';

export function DevicePage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const targetDevice = deviceId ? devicesMap.get(deviceId) : undefined;
  const [displayedDeviceId, setDisplayedDeviceId] = useState(deviceId ?? '');
  const [transitionPhase, setTransitionPhase] = useState<TransitionPhase>('idle');
  const startEnterTimerRef = useRef<number | null>(null);
  const finishEnterTimerRef = useRef<number | null>(null);

  const displayedDevice =
    devicesMap.get(displayedDeviceId) ??
    (deviceId && devicesMap.has(deviceId) ? devicesMap.get(deviceId) : undefined);

  const isStreaming = isStreamingDevice(displayedDevice?.id ?? '');

  // For non-streaming devices (phone, laptop): resolve their own URL
  const resolvedUrl = useResolvedUrl(displayedDevice?.id ?? '');

  // Streaming store: show/hide on enter/leave (connect happens on Settings page)
  const connected = useStreamingStore((s) => s.connected);
  const show = useStreamingStore((s) => s.show);
  const hide = useStreamingStore((s) => s.hide);

  useEffect(() => {
    return () => {
      if (startEnterTimerRef.current) window.clearTimeout(startEnterTimerRef.current);
      if (finishEnterTimerRef.current) window.clearTimeout(finishEnterTimerRef.current);
    };
  }, []);

  const ueApiUrl = useUeControlStore((s) => s.ueApiUrl);

  // Show/hide persistent iframe when entering/leaving a streaming device page.
  // The iframe is already mounted if user clicked Connect on Settings.
  useEffect(() => {
    if (!isStreaming || !connected) return;

    show();
    return () => {
      hide();
    };
  }, [isStreaming, connected, show, hide]);

  // Auto-apply saved UE settings when switching to a streaming device.
  // Uses a ref for ueApiUrl so the effect only fires on displayedDeviceId change,
  // not when the user edits the URL on the settings page.
  const ueApiUrlRef = useRef(ueApiUrl);
  ueApiUrlRef.current = ueApiUrl;

  const ueReachable = useUeControlStore((s) => s.ueReachable);

  useEffect(() => {
    const url = ueApiUrlRef.current;
    // Skip batch apply when UE API is known to be unreachable — commands would fail silently
    if (!isStreaming || !url || !displayedDeviceId || ueReachable === false) return;

    const saved = getDeviceSettingsSnapshot(displayedDeviceId);
    void applyDeviceSettings(url, saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ueReachable intentionally excluded to avoid re-apply on health change
  }, [isStreaming, displayedDeviceId]);

  useEffect(() => {
    if (!deviceId || !targetDevice || displayedDeviceId === deviceId) return;

    if (startEnterTimerRef.current) window.clearTimeout(startEnterTimerRef.current);
    if (finishEnterTimerRef.current) window.clearTimeout(finishEnterTimerRef.current);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayedDeviceId(deviceId);
      setTransitionPhase('idle');
      return;
    }

    setTransitionPhase('exiting');

    startEnterTimerRef.current = window.setTimeout(() => {
      setDisplayedDeviceId(deviceId);
      setTransitionPhase('entering');

      finishEnterTimerRef.current = window.setTimeout(() => {
        setTransitionPhase('idle');
      }, ENTER_TRANSITION_MS);
    }, EXIT_TRANSITION_MS);
  }, [deviceId, targetDevice, displayedDeviceId]);

  if (!targetDevice) {
    return (
      <div className={styles.devicePage}>
        <div className={styles.notFound}>
          <span className={styles.notFoundIcon}>🔍</span>
          <span>
            Device "<code>{deviceId}</code>" not found.
          </span>
          <Link to="/">← Back to Settings</Link>
        </div>
      </div>
    );
  }

  if (!displayedDevice) {
    return <div className={styles.devicePage} />;
  }

  const finalUrl = isStreaming ? '' : resolvedUrl || displayedDevice.defaultUrl || '';
  const transitionClass =
    transitionPhase === 'exiting'
      ? styles.previewExit
      : transitionPhase === 'entering'
        ? styles.previewEnter
        : styles.previewIdle;

  return (
    <div className={styles.devicePage}>
      <div className={`${styles.previewStage} ${transitionClass}`}>
        <DevicePreview
          device={displayedDevice}
          url={finalUrl}
          transitionPhase={transitionPhase}
          isStreaming={isStreaming}
        />
        {isStreaming && <UeControlPanel deviceId={displayedDeviceId} />}
      </div>
    </div>
  );
}

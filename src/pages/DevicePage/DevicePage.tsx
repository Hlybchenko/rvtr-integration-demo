import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router';
import { devicesMap } from '@/config/devices';
import { useResolvedUrl, isStreamingDevice } from '@/stores/settingsStore';
import { useStreamingStore } from '@/stores/streamingStore';
import { DevicePreview } from '@/components/DevicePreview/DevicePreview';
import { UeControlPanel } from '@/components/UeControlPanel/UeControlPanel';
import styles from './DevicePage.module.css';

const EXIT_TRANSITION_MS = 220;
const ENTER_TRANSITION_MS = 1500;

type TransitionPhase = 'idle' | 'exiting' | 'entering';

/**
 * Full-screen device preview page (route: `/:deviceId`).
 *
 * Responsibilities:
 *   1. Resolves the device template from URL params (phone/laptop/kiosk/holobox/keba-kiosk).
 *   2. For streaming devices — shows/hides the persistent PS iframe and renders UeControlPanel.
 *   3. On device switch — runs a crossfade transition (exit → swap → enter).
 *   4. For non-streaming devices — renders an `<iframe>` with the widget URL inside DevicePreview.
 */
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

  // Streaming store: show/hide on enter/leave
  const show = useStreamingStore((s) => s.show);
  const hide = useStreamingStore((s) => s.hide);

  useEffect(() => {
    return () => {
      if (startEnterTimerRef.current) window.clearTimeout(startEnterTimerRef.current);
      if (finishEnterTimerRef.current) window.clearTimeout(finishEnterTimerRef.current);
    };
  }, []);

  // Show/hide persistent iframe when entering/leaving a streaming device page.
  // Hide during crossfade transitions to avoid expensive browser recomposites
  // when the viewport geometry changes (position/size/borderRadius) — this
  // prevents WebRTC video freezes during rapid device navigation.
  useEffect(() => {
    if (!isStreaming) return;

    if (transitionPhase === 'exiting') {
      hide();
      return;
    }

    show();
    return () => {
      hide();
    };
  }, [isStreaming, transitionPhase, show, hide]);

  // ── Crossfade transition on device switch ─────────────────────────────────
  // Sequence: idle → exiting (220ms fade-out) → entering (swap ID, 1500ms fade-in) → idle.
  // Respects prefers-reduced-motion by skipping the animation entirely.
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
    <div className={styles.devicePage} onMouseDown={(e) => e.preventDefault()}>
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

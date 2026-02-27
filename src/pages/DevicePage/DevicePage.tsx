import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router';
import { devicesMap } from '@/config/devices';
import { useResolvedUrl, useSettingsStore, isStreamDevice } from '@/stores/settingsStore';
import { startDeviceProcess, stopProcess } from '@/services/voiceAgentWriter';
import { DevicePreview } from '@/components/DevicePreview/DevicePreview';
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

  const resolvedUrl = useResolvedUrl(displayedDevice?.id ?? '');

  useEffect(() => {
    return () => {
      if (startEnterTimerRef.current) window.clearTimeout(startEnterTimerRef.current);
      if (finishEnterTimerRef.current) window.clearTimeout(finishEnterTimerRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Process lifecycle: start on mount, stop on unmount (fire-and-forget).
  //
  // Only stream devices (holobox, keba-kiosk, kiosk) need a native process.
  // Non-stream devices (phone, laptop) skip this entirely.
  //
  // Both start and stop are serialized via the async queue in
  // voiceAgentWriter, so concurrent calls never overlap. The backend's
  // /process/start also kills any existing process before spawning,
  // so even orphaned processes are handled.
  //
  // IMPORTANT: The iframe URL is passed through immediately (no gate).
  // Pixel Streaming's PS client handles connection retries internally.
  // Withholding the URL until process start completes was found to cause
  // timing issues with WebRTC establishment.
  //
  // Granular selector: subscribe to THIS device's exePath only.
  // Using the whole `deviceExePaths` object would re-trigger this effect
  // whenever ANY device's path changes.
  // ---------------------------------------------------------------------------
  const streamDeviceId = deviceId && isStreamDevice(deviceId) ? deviceId : null;
  const exePath = useSettingsStore((s) =>
    streamDeviceId ? s.deviceExePaths[streamDeviceId] : '',
  );

  useEffect(() => {
    if (!streamDeviceId || !exePath) return;

    // Start the process for this device (fire-and-forget)
    void startDeviceProcess(streamDeviceId, exePath).catch((err) => {
      console.error(`[DevicePage] Failed to start process for ${streamDeviceId}:`, err);
    });

    // Stop when leaving this device page (fire-and-forget)
    return () => {
      void stopProcess().catch((err) => {
        console.error('[DevicePage] Failed to stop process:', err);
      });
    };
  }, [streamDeviceId, exePath]);

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

  const finalUrl = resolvedUrl || displayedDevice.defaultUrl || '';
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
        />
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
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

  // -- Start/stop device process on mount/unmount --
  // Select only the exe path for the current device to avoid unnecessary
  // effect re-runs when other device paths change in the store.
  const streamDeviceId = deviceId && isStreamDevice(deviceId) ? deviceId : null;
  const exePath = useSettingsStore((s) =>
    streamDeviceId ? s.deviceExePaths[streamDeviceId] : '',
  );

  // Guard against race conditions when rapidly switching between devices.
  // Without this, cleanup (stop) from device A can fire AFTER start for device B,
  // killing the just-started process.
  const processSeqRef = useRef(0);

  useEffect(() => {
    if (!streamDeviceId || !exePath) return;

    const seq = ++processSeqRef.current;

    // Start the process for this device
    void startDeviceProcess(streamDeviceId, exePath).catch((err) => {
      console.error(`[DevicePage] Failed to start process for ${streamDeviceId}:`, err);
    });

    // Stop when leaving this device page — but only if no newer start has been issued.
    // Reading processSeqRef.current at cleanup time is intentional: we need the
    // latest value to detect whether a newer effect has already started a new process.
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: seq guard reads latest ref value
      if (processSeqRef.current !== seq) return;
      void stopProcess().catch((err) => {
        console.error(`[DevicePage] Failed to stop process:`, err);
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
          <Link to="/">← Back to overview</Link>
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

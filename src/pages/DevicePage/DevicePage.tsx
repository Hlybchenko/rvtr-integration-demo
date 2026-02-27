import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link, useBlocker } from 'react-router';
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
  const [isStopping, setIsStopping] = useState(false);
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
  // Process lifecycle: start on mount, stop via navigation blocker
  //
  // Only stream devices (holobox, keba-kiosk, kiosk) need a native process.
  // Non-stream devices (phone, laptop) skip this entirely.
  //
  // Granular selector: subscribe to THIS device's exePath only.
  // Using the whole `deviceExePaths` object would re-trigger this effect
  // whenever ANY device's path changes (e.g., user edits kiosk path while
  // viewing holobox page → unnecessary process restart).
  // ---------------------------------------------------------------------------
  const streamDeviceId = deviceId && isStreamDevice(deviceId) ? deviceId : null;
  const exePath = useSettingsStore((s) =>
    streamDeviceId ? s.deviceExePaths[streamDeviceId] : '',
  );

  // Track whether a process was started so the blocker knows if stop is needed.
  const processActiveRef = useRef(false);

  useEffect(() => {
    if (!streamDeviceId || !exePath) {
      processActiveRef.current = false;
      return;
    }

    let cancelled = false;

    const launch = async () => {
      // Stop any running process first. This call is serialized via the
      // async queue in voiceAgentWriter — if the previous effect cleanup
      // already queued a stop, this one waits for it before executing.
      try {
        await stopProcess();
      } catch {
        // Ignore — process may not be running
      }

      if (cancelled) return;

      processActiveRef.current = true;
      try {
        await startDeviceProcess(streamDeviceId, exePath);
      } catch (err) {
        console.error(`[DevicePage] Failed to start process for ${streamDeviceId}:`, err);
        processActiveRef.current = false;
      }
    };

    void launch();

    // Safety net: stop the process when the effect re-runs (HMR, deps change)
    // or the component unmounts without going through the navigation blocker.
    // The blocker sets processActiveRef.current = false before proceed(),
    // so this cleanup will be a no-op after a blocker-managed stop.
    //
    // stopProcess() is fire-and-forget here (can't await in cleanup), but the
    // async queue guarantees the next launch() won't start until this finishes.
    return () => {
      cancelled = true;
      if (!processActiveRef.current) return;
      processActiveRef.current = false;
      void stopProcess().catch(() => {});
    };
  }, [streamDeviceId, exePath]);

  // ---------------------------------------------------------------------------
  // Navigation blocker: stop the process synchronously before leaving.
  //
  // When the user navigates away from a stream device page, we block the
  // navigation, call stopProcess(), show a loader, then proceed once done.
  // This guarantees the backend process and iframe connections are fully
  // torn down before the next page mounts.
  // ---------------------------------------------------------------------------
  const shouldBlock = useCallback(
    ({
      currentLocation,
      nextLocation,
    }: {
      currentLocation: { pathname: string };
      nextLocation: { pathname: string };
    }) => {
      return (
        processActiveRef.current && currentLocation.pathname !== nextLocation.pathname
      );
    },
    [],
  );

  const blocker = useBlocker(shouldBlock);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;

    setIsStopping(true);

    void stopProcess()
      .catch((err) => {
        console.error('[DevicePage] Failed to stop process on navigation:', err);
      })
      .finally(() => {
        processActiveRef.current = false;
        setIsStopping(false);
        blocker.proceed();
      });
  }, [blocker]);

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

  // Stopping overlay — shown while awaiting process stop before navigation
  if (isStopping) {
    return (
      <div className={styles.devicePage}>
        <div className={styles.stoppingOverlay}>
          <div className={styles.spinner} />
          <span className={styles.stoppingText}>Stopping process…</span>
        </div>
      </div>
    );
  }

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

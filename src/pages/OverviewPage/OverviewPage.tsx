import { useState, useCallback, useEffect, useRef } from 'react';
import { devices, preloadDeviceFrameImages } from '@/config/devices';
import { warmDetectScreenRect } from '@/hooks/useDetectScreenRect';
import { useDebouncedUrlSave } from '@/hooks/useDebouncedUrlSave';
import { useSettingsStore } from '@/stores/settingsStore';
import type { VoiceAgent } from '@/stores/settingsStore';
import { isValidUrl } from '@/utils/isValidUrl';
import {
  useKiosksStore,
  KIOSK_SHORTCUTS,
  type ShortcutId,
  type AssistantMode,
} from '@/stores/kiosksStore';
import {
  browseForExe,
  browseForFile,
  forceRewriteVoiceAgentFile,
  setWriterFilePath,
  startProcess,
  stopProcess,
  getProcessStatus,
} from '@/services/voiceAgentWriter';
import { setFaceCapture } from '@/services/ueRemoteApi';
import { useUeControlStore } from '@/stores/ueControlStore';
import styles from './OverviewPage.module.css';

const IS_WINDOWS =
  typeof navigator !== 'undefined' &&
  (/win/i.test(navigator.userAgent) ||
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ===
      'Windows');

const LAUNCH_COOLDOWN_MS = 2_000;

interface DeviceField {
  id: 'phone' | 'laptop';
  label: string;
  placeholder: string;
}

const WIDGET_DEVICES: DeviceField[] = [
  { id: 'phone', label: 'Phone', placeholder: 'https://widget.example.com/phone' },
  { id: 'laptop', label: 'Laptop', placeholder: 'https://widget.example.com/laptop' },
];

// ── Component ────────────────────────────────────────────────────────────────

export function OverviewPage() {
  // ── Widget ──────────────────────────────────────────────────────────────
  const phoneUrl = useSettingsStore((s) => s.phoneUrl);
  const laptopUrl = useSettingsStore((s) => s.laptopUrl);
  const setDeviceUrl = useSettingsStore((s) => s.setDeviceUrl);

  const phoneUrlSave = useDebouncedUrlSave({ storeValue: phoneUrl, saveFn: (url) => setDeviceUrl('phone', url) });
  const laptopUrlSave = useDebouncedUrlSave({ storeValue: laptopUrl, saveFn: (url) => setDeviceUrl('laptop', url) });

  const urlSaveByDevice: Record<'phone' | 'laptop', typeof phoneUrlSave> = {
    phone: phoneUrlSave,
    laptop: laptopUrlSave,
  };

  const widgetHasError = WIDGET_DEVICES.some((d) => {
    const v = urlSaveByDevice[d.id].input;
    return v.trim().length > 0 && !isValidUrl(v);
  });
  const widgetAllGood = WIDGET_DEVICES.every((d) => {
    const v = urlSaveByDevice[d.id].input;
    return v.trim().length > 0 && isValidUrl(v);
  });

  // ── Process (kiosks store) ──────────────────────────────────────────────
  const paths = useKiosksStore((s) => s.paths);
  const setPath = useKiosksStore((s) => s.setPath);
  const licenseFilePath = useKiosksStore((s) => s.licenseFilePath);
  const setLicenseFilePath = useKiosksStore((s) => s.setLicenseFilePath);
  const assistantMode = useKiosksStore((s) => s.assistantMode);
  const setAssistantMode = useKiosksStore((s) => s.setAssistantMode);
  const voiceAgent = useKiosksStore((s) => s.voiceAgent);
  const setVoiceAgent = useKiosksStore((s) => s.setVoiceAgent);

  const [licenseInput, setLicenseInput] = useState(licenseFilePath);
  const [licenseBrowsing, setLicenseBrowsing] = useState(false);
  const [licenseError, setLicenseError] = useState<string | null>(null);

  const [pendingAgent, setPendingAgent] = useState<VoiceAgent>(voiceAgent);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [faceCaptureError, setFaceCaptureError] = useState<string | null>(null);

  // Sync local state with store on external changes (e.g. persist rehydration)
  useEffect(() => { setLicenseInput(licenseFilePath); }, [licenseFilePath]);
  useEffect(() => { setPendingAgent(voiceAgent); }, [voiceAgent]);

  const hasLicense = licenseInput.trim().length > 0;
  const hasPendingChange = pendingAgent !== voiceAgent;

  const handleModeSwitch = useCallback((mode: AssistantMode) => {
    setAssistantMode(mode);
    setFaceCaptureError(null);
    setApplyError(null);
  }, [setAssistantMode]);

  // ── Drag-to-switch for mode toggle ─────────────────────────────────────
  const modeSwitchRef = useRef<HTMLDivElement>(null);
  const wormRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<{
    startX: number;
    prevX: number;
    velocity: number;
    halfW: number;
    maxDrag: number;
    mode: AssistantMode;
  } | null>(null);
  const wasDragging = useRef(false);

  const onModeDragDown = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, mode: AssistantMode) => {
      if (mode !== assistantMode) return;
      const container = modeSwitchRef.current;
      const worm = wormRef.current;
      if (!container || !worm) return;
      const wormW = worm.getBoundingClientRect().width;
      dragRef.current = {
        startX: e.clientX,
        prevX: e.clientX,
        velocity: 0,
        halfW: container.getBoundingClientRect().width / 2,
        maxDrag: wormW / 3,
        mode,
      };
      wasDragging.current = false;
      worm.style.willChange = 'translate, scale';
      worm.style.transition = 'none';
    },
    [assistantMode],
  );

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      const worm = wormRef.current;
      if (!d || !worm) return;
      const dx = e.clientX - d.startX;
      if (Math.abs(dx) > 6) wasDragging.current = true;

      // Clamp: full halfW toward switch side, only 1/3 worm width backward (outside container)
      const min = d.mode === 'ai' ? -d.maxDrag : -d.halfW;
      const max = d.mode === 'ai' ? d.halfW : d.maxDrag;
      const clamped = Math.max(min, Math.min(max, dx));
      const frameDx = e.clientX - d.prevX;
      d.velocity = d.velocity * 0.7 + frameDx * 0.3;
      d.prevX = e.clientX;

      const speed = Math.abs(d.velocity);
      const sx = reducedMotion ? 1 : 1 + Math.min(speed * 0.008, 0.15);
      const sy = reducedMotion ? 1 : 1 - Math.min(speed * 0.004, 0.08);

      worm.style.translate = `${clamped}px 0`;
      worm.style.scale = `${sx} ${sy}`;
    };

    const onUp = () => {
      const d = dragRef.current;
      const worm = wormRef.current;
      if (!d || !worm) return;
      const dx = parseFloat(worm.style.translate) || 0;
      const threshold = d.halfW * 0.25;
      const shouldSwitch =
        (d.mode === 'ai' && dx > threshold) ||
        (d.mode === 'human' && dx < -threshold);

      const fromT = worm.style.translate;
      const fromS = worm.style.scale;

      // Clear inline overrides
      worm.style.translate = '';
      worm.style.scale = '';
      worm.style.willChange = '';
      worm.style.transition = '';

      if (shouldSwitch) {
        // Animate translate to 0 in sync with CSS left/right transition (same easing)
        if (fromT && fromT !== '0px 0') {
          worm.animate(
            { translate: [fromT, '0 0'], scale: [fromS || '1 1', '1 1'] },
            { duration: 450, easing: 'cubic-bezier(0.22, 0.9, 0.25, 1)' },
          );
        }
        // Suppress jellyPop on the newly-active tab during drag-switch
        const container = modeSwitchRef.current;
        if (container) {
          container.setAttribute('data-drag-switch', '');
          setTimeout(() => container.removeAttribute('data-drag-switch'), 600);
        }
        handleModeSwitch(d.mode === 'ai' ? 'human' : 'ai');
      } else {
        // Snap back with spring bounce
        if (fromT && fromT !== '0px 0') {
          worm.animate(
            { translate: [fromT, '0 0'], scale: [fromS || '1 1', '1 1'] },
            { duration: 400, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
          );
        }
      }
      dragRef.current = null;
    };

    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [handleModeSwitch]);

  const onModeClick = useCallback(
    (mode: AssistantMode) => {
      if (wasDragging.current) {
        wasDragging.current = false;
        return;
      }
      handleModeSwitch(mode);
    },
    [handleModeSwitch],
  );

  // ── Badge hover + implode-return state machine (fully JS-driven) ────────
  const badgeRef = useRef<HTMLDivElement>(null);
  const implodedRef = useRef(false);
  const greetingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fidgetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const implodeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Cleanup badge timers on unmount
  useEffect(() => {
    return () => {
      clearTimeout(fidgetTimer.current);
      clearTimeout(implodeTimer.current);
      clearTimeout(greetingTimer.current);
    };
  }, []);

  const addBadgeClass = useCallback((cls: string | undefined) => {
    if (cls) badgeRef.current?.classList.add(cls);
  }, []);

  const removeBadgeClasses = useCallback((...classes: (string | undefined)[]) => {
    const el = badgeRef.current;
    if (!el) return;
    for (const cls of classes) {
      if (cls) el.classList.remove(cls);
    }
  }, []);

  const clearBadgeTimers = useCallback(() => {
    clearTimeout(fidgetTimer.current);
    clearTimeout(implodeTimer.current);
  }, []);

  const onBadgeAnimEnd = useCallback((e: React.AnimationEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;

    if (e.animationName.includes('badgeEntranceInertia')) {
      removeBadgeClasses(styles.operatorEntrance);
    }

    if (e.animationName.includes('operatorImplode')) {
      implodedRef.current = true;
      removeBadgeClasses(
        styles.operatorHovered,
        styles.operatorFidgeting,
        styles.operatorImploding,
      );
      addBadgeClass(styles.operatorImploded);
    }

    if (e.animationName.includes('operatorLookAround')) {
      removeBadgeClasses(styles.operatorReturning);
      addBadgeClass(styles.operatorReturnDone);

      addBadgeClass(styles.operatorGreeting);
      clearTimeout(greetingTimer.current);
      greetingTimer.current = setTimeout(() => {
        removeBadgeClasses(styles.operatorGreeting);
      }, 5000);
    }
  }, [addBadgeClass, removeBadgeClasses]);

  // Entrance inertia when badge appears (mode switch to human or mount)
  useEffect(() => {
    if (assistantMode !== 'human') return;
    addBadgeClass(styles.operatorEntrance);
  }, [assistantMode, addBadgeClass]);

  const onBadgeWrapEnter = useCallback(() => {
    clearBadgeTimers();
    clearTimeout(greetingTimer.current);
    const el = badgeRef.current;
    if (!el) return;

    // Clean any leftover state
    removeBadgeClasses(
      styles.operatorEntrance,
      styles.operatorGreeting,
      styles.operatorReturnDone,
      styles.operatorReturning,
      styles.operatorFidgeting,
      styles.operatorImploding,
      styles.operatorImploded,
    );
    implodedRef.current = false;

    // Start hover phase
    addBadgeClass(styles.operatorHovered);

    // Schedule fidget at 5s
    fidgetTimer.current = setTimeout(() => {
      addBadgeClass(styles.operatorFidgeting);
    }, 5000);

    // Schedule implode at 7s (keep operatorHovered for bubble visibility)
    implodeTimer.current = setTimeout(() => {
      removeBadgeClasses(styles.operatorFidgeting);
      addBadgeClass(styles.operatorImploding);
    }, 7000);
  }, [clearBadgeTimers, addBadgeClass, removeBadgeClasses]);

  const onBadgeWrapLeave = useCallback(() => {
    clearBadgeTimers();
    const el = badgeRef.current;
    if (!el) return;

    if (implodedRef.current) {
      // Was imploded → trigger return sequence
      implodedRef.current = false;
      removeBadgeClasses(styles.operatorImploded);
      addBadgeClass(styles.operatorReturning);
    } else {
      // Left before implode completed → clean up hover classes
      removeBadgeClasses(
        styles.operatorHovered,
        styles.operatorFidgeting,
        styles.operatorImploding,
      );
    }
  }, [clearBadgeTimers, addBadgeClass, removeBadgeClasses]);

  const handleLicenseChange = useCallback((value: string) => {
    setLicenseInput(value);
    setLicenseError(null);
    setLicenseFilePath(value);
  }, [setLicenseFilePath]);

  const handleLicenseBrowse = useCallback(async () => {
    setLicenseBrowsing(true);
    setLicenseError(null);
    try {
      const result = await browseForFile();
      if (result.cancelled) return;
      if (result.licenseFilePath) {
        setLicenseInput(result.licenseFilePath);
        setLicenseFilePath(result.licenseFilePath);
        // Sync to backend config so /voice-agent endpoints work
        const sync = await setWriterFilePath(result.licenseFilePath);
        if (!sync.ok) {
          setLicenseError(sync.error ?? 'Failed to save path on server');
        }
      } else {
        setLicenseError(result.errors?.join('; ') || 'Browse failed');
      }
    } catch (err) {
      setLicenseError(err instanceof Error ? err.message : String(err));
    } finally {
      setLicenseBrowsing(false);
    }
  }, [setLicenseFilePath]);

  const handleApply = useCallback(async () => {
    setApplying(true);
    setApplyError(null);
    try {
      // 0. Ensure license file path is synced to backend config
      const currentLicense = useKiosksStore.getState().licenseFilePath.trim();
      if (!currentLicense) {
        throw new Error('License file path is not configured');
      }
      const syncResult = await setWriterFilePath(currentLicense);
      if (!syncResult.ok) {
        throw new Error(syncResult.error ?? 'Failed to sync license path to server');
      }

      // 1. Write provider to license file
      const result = await forceRewriteVoiceAgentFile(pendingAgent);
      if (!result.matched) {
        throw new Error('File verification failed — provider was not written');
      }
      setVoiceAgent(pendingAgent);

      // 2. Restart kiosk-app: stop then start
      const kioskId: ShortcutId = 'kiosk-app';
      const kioskPath = useKiosksStore.getState().paths[kioskId];

      if (kioskPath.trim()) {
        setLaunching((prev) => ({ ...prev, [kioskId]: true }));

        const stopResult = await stopProcess(kioskId, kioskPath);
        if (!stopResult.ok) {
          throw new Error(stopResult.error ?? 'Failed to stop Kiosk app before restart');
        }
        setRunning((prev) => ({ ...prev, [kioskId]: false }));

        const startResult = await startProcess(kioskPath, kioskId);
        if (!startResult.ok) {
          throw new Error(startResult.error ?? 'Failed to start Kiosk app');
        }
        if (startResult.pid) console.log(`[${kioskId}] started, PID: ${startResult.pid}`);
        setRunning((prev) => ({ ...prev, [kioskId]: true }));

        if (launchTimers.current[kioskId]) clearTimeout(launchTimers.current[kioskId]);
        launchTimers.current[kioskId] = setTimeout(() => {
          setLaunching((prev) => ({ ...prev, [kioskId]: false }));
        }, LAUNCH_COOLDOWN_MS);
      }
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
      setLaunching((prev) => ({ ...prev, 'kiosk-app': false }));
      setRunning((prev) => ({ ...prev, 'kiosk-app': false }));
    } finally {
      setApplying(false);
    }
  }, [pendingAgent, setVoiceAgent]);

  // ── Shortcut launcher ──────────────────────────────────────────────────
  const [browsing, setBrowsing] = useState<ShortcutId | null>(null);
  const [starting, setStarting] = useState<ShortcutId | null>(null);
  const [stopping, setStopping] = useState<ShortcutId | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ShortcutId, string>>>({});
  const [running, setRunning] = useState<Partial<Record<ShortcutId, boolean>>>({});
  const [launching, setLaunching] = useState<Partial<Record<ShortcutId, boolean>>>({});
  const launchTimers = useRef<Partial<Record<ShortcutId, ReturnType<typeof setTimeout>>>>({});

  // Cleanup launch timers on unmount
  useEffect(() => {
    const timers = launchTimers.current;
    return () => {
      Object.values(timers).forEach((t) => { if (t) clearTimeout(t); });
    };
  }, []);

  const clearError = useCallback((id: ShortcutId) => {
    setErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // Fetch process status once on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await getProcessStatus();
        if (cancelled) return;
        const next: Partial<Record<ShortcutId, boolean>> = {};
        for (const s of KIOSK_SHORTCUTS) {
          next[s.id] = status.processes[s.id]?.running === true;
        }
        setRunning(next);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleBrowse = useCallback(async (id: ShortcutId) => {
    setBrowsing(id);
    clearError(id);
    try {
      const result = await browseForExe();
      if (result.cancelled) return;
      if (result.exePath) {
        setPath(id, result.exePath);
      } else {
        setErrors((prev) => ({
          ...prev,
          [id]: result.errors.join('; ') || 'Browse failed',
        }));
      }
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setBrowsing(null);
    }
  }, [setPath, clearError]);

  const handleStart = useCallback(async (id: ShortcutId) => {
    const exePath = useKiosksStore.getState().paths[id];
    if (!exePath) return;

    setStarting(id);
    setLaunching((prev) => ({ ...prev, [id]: true }));
    clearError(id);
    try {
      const result = await startProcess(exePath, id);
      if (!result.ok) {
        setErrors((prev) => ({ ...prev, [id]: result.error ?? 'Failed to start' }));
        setLaunching((prev) => ({ ...prev, [id]: false }));
      } else {
        if (result.pid) console.log(`[${id}] started, PID: ${result.pid}`);
        setRunning((prev) => ({ ...prev, [id]: true }));
        // Keep "Starting..." state for cooldown period
        if (launchTimers.current[id]) clearTimeout(launchTimers.current[id]);
        launchTimers.current[id] = setTimeout(() => {
          setLaunching((prev) => ({ ...prev, [id]: false }));
        }, LAUNCH_COOLDOWN_MS);
      }
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : String(err),
      }));
      setLaunching((prev) => ({ ...prev, [id]: false }));
    } finally {
      setStarting(null);
    }
  }, [clearError]);

  const handleStop = useCallback(async (id: ShortcutId) => {
    setStopping(id);
    clearError(id);
    try {
      const exePath = useKiosksStore.getState().paths[id];
      const result = await stopProcess(id, exePath || undefined);
      if (!result.ok) {
        setErrors((prev) => ({ ...prev, [id]: result.error ?? 'Failed to stop' }));
      } else {
        setRunning((prev) => ({ ...prev, [id]: false }));
      }
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setStopping(null);
    }
  }, [clearError]);

  const handleRestart = useCallback(async (id: ShortcutId) => {
    const exePath = useKiosksStore.getState().paths[id];
    if (!exePath) return;

    setStarting(id);
    setLaunching((prev) => ({ ...prev, [id]: true }));
    clearError(id);
    try {
      const stopResult = await stopProcess(id, exePath);
      if (!stopResult.ok) {
        setErrors((prev) => ({ ...prev, [id]: stopResult.error ?? 'Failed to stop' }));
        setLaunching((prev) => ({ ...prev, [id]: false }));
        return;
      }
      setRunning((prev) => ({ ...prev, [id]: false }));

      const result = await startProcess(exePath, id);
      if (!result.ok) {
        setErrors((prev) => ({ ...prev, [id]: result.error ?? 'Failed to restart' }));
        setLaunching((prev) => ({ ...prev, [id]: false }));
        setRunning((prev) => ({ ...prev, [id]: false }));
      } else {
        if (result.pid) console.log(`[${id}] restarted, PID: ${result.pid}`);
        setRunning((prev) => ({ ...prev, [id]: true }));
        if (launchTimers.current[id]) clearTimeout(launchTimers.current[id]);
        launchTimers.current[id] = setTimeout(() => {
          setLaunching((prev) => ({ ...prev, [id]: false }));
        }, LAUNCH_COOLDOWN_MS);
      }
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : String(err),
      }));
      setLaunching((prev) => ({ ...prev, [id]: false }));
    } finally {
      setStarting(null);
    }
  }, [clearError]);

  // ── Side effects ──────────────────────────────────────────────────────
  useEffect(() => {
    preloadDeviceFrameImages();
    devices.forEach((device) => {
      if (!device.autoDetectScreen) return;
      warmDetectScreenRect(device.frameSrc);
    });
  }, []);

  // Send FaceCapture command to UE when assistant mode changes (dedup by ref)
  const lastSentFaceCapture = useRef<boolean | null>(null);
  useEffect(() => {
    const enabled = assistantMode === 'human';
    if (lastSentFaceCapture.current === enabled) return;
    lastSentFaceCapture.current = enabled;

    const url = useUeControlStore.getState().ueApiUrl;
    if (url) {
      setFaceCapture(url, enabled).then((ok) => {
        if (!ok) console.warn('[FaceCapture] UE did not respond — command may not have been applied');
      });
    }
  }, [assistantMode]);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className={styles.settings}>
      {/* ── Process: Shortcuts + License + Provider ── */}
      <section className={styles.settingsBlock}>
        <h2 className={styles.settingsBlockTitle}>Process</h2>

        {KIOSK_SHORTCUTS.map((shortcut) => {
          const value = paths[shortcut.id];
          const error = errors[shortcut.id];
          const isRunning = running[shortcut.id] === true;
          const isLaunching = launching[shortcut.id] === true;
          const isBrowsing = browsing === shortcut.id;
          const isStarting = starting === shortcut.id;
          const isStopping = stopping === shortcut.id;
          const hasPath = value.trim().length > 0;
          const isBusy = isStarting || isLaunching;

          return (
            <div key={shortcut.id} className={styles.field}>
              <div className={styles.fieldHeader}>
                <label className={styles.label} htmlFor={`kiosk-${shortcut.id}`}>
                  {shortcut.label}
                </label>
                {isLaunching && (
                  <span className={`${styles.badge} ${styles.badgeValid}`}>Starting...</span>
                )}
                {isRunning && !isLaunching && (
                  <span className={`${styles.badge} ${styles.badgeRunning}`}>Running</span>
                )}
              </div>
              <div className={styles.filePathRow}>
                <input
                  id={`kiosk-${shortcut.id}`}
                  className={`${styles.input} ${error ? styles.inputError : ''}`}
                  type="text"
                  placeholder={IS_WINDOWS ? 'C:\\Users\\Desktop\\shortcut.lnk' : '/path/to/shortcut'}
                  value={value}
                  onChange={(e) => {
                    setPath(shortcut.id, e.target.value);
                    clearError(shortcut.id);
                  }}
                  disabled={isRunning || isLaunching}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className={styles.filePathAction}
                  onClick={() => void handleBrowse(shortcut.id)}
                  disabled={isBrowsing || isBusy || isRunning}
                >
                  {isBrowsing ? '...' : 'Browse'}
                </button>
                {isRunning && !isLaunching ? (
                  <>
                    <button
                      type="button"
                      className={styles.filePathAction}
                      onClick={() => void handleRestart(shortcut.id)}
                      disabled={isStarting}
                      title="Restart"
                    >
                      {isStarting ? '...' : 'Restart'}
                    </button>
                    <button
                      type="button"
                      className={styles.stopButton}
                      onClick={() => void handleStop(shortcut.id)}
                      disabled={isStopping}
                    >
                      {isStopping ? '...' : 'Stop'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.startButton}
                    onClick={() => void handleStart(shortcut.id)}
                    disabled={!hasPath || isBusy}
                  >
                    {isBusy ? 'Starting...' : 'Start'}
                  </button>
                )}
              </div>
              {error && <span className={styles.filePathValidationError}>{error}</span>}
            </div>
          );
        })}

        <hr className={styles.divider} />

        <div className={styles.field}>
          <label className={styles.label} htmlFor="kiosk-license-path">
            License file path
          </label>
          <div className={styles.filePathRow}>
            <input
              id="kiosk-license-path"
              className={`${styles.input} ${licenseError ? styles.inputError : ''}`}
              type="text"
              placeholder={IS_WINDOWS ? 'C:\\Path\\To\\license.lic' : '/path/to/license.lic'}
              value={licenseInput}
              onChange={(e) => handleLicenseChange(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className={styles.filePathAction}
              onClick={() => void handleLicenseBrowse()}
              disabled={licenseBrowsing}
            >
              {licenseBrowsing ? '...' : 'Browse'}
            </button>
          </div>
          {licenseError && <span className={styles.filePathValidationError}>{licenseError}</span>}
        </div>

        <div className={styles.field}>
          <div className={styles.fieldHeader}>
            <span className={styles.label}>Mode</span>
          </div>
          <div ref={modeSwitchRef} className={styles.modeSwitch} role="radiogroup" aria-label="Assistant mode" data-no-jelly>
            <span
              ref={wormRef}
              className={`${styles.worm} ${assistantMode === 'human' ? styles.wormRight : ''}`}
              aria-hidden="true"
            />
            <button
              type="button"
              className={`${styles.modeSwitchOption} ${assistantMode === 'ai' ? styles.modeSwitchOptionActive : ''}`}
              onMouseDown={(e) => onModeDragDown(e, 'ai')}
              onClick={() => onModeClick('ai')}
              aria-checked={assistantMode === 'ai'}
              role="radio"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <rect className={styles.aiChipBody} x="6" y="6" width="12" height="12" rx="2" />
                <circle className={styles.aiChipCore} cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
                <path className={styles.aiPinTop} d="M9 2v4M15 2v4" />
                <path className={styles.aiPinRight} d="M18 9h4M18 15h4" />
                <path className={styles.aiPinBottom} d="M9 18v4M15 18v4" />
                <path className={styles.aiPinLeft} d="M2 9h4M2 15h4" />
              </svg>
              AI Assistant
            </button>
            <button
              type="button"
              className={`${styles.modeSwitchOption} ${assistantMode === 'human' ? styles.modeSwitchOptionActive : ''}`}
              onMouseDown={(e) => onModeDragDown(e, 'human')}
              onClick={() => onModeClick('human')}
              aria-checked={assistantMode === 'human'}
              role="radio"
            >
              Human Assistant
            </button>
          </div>
        </div>

        <div className={styles.field}>
          <div className={styles.fieldHeader}>
            <span className={styles.label}>Provider</span>
          </div>

          <div className={styles.providerWrap}>
            {/* AI provider — collapses when Human mode */}
            <div className={`${styles.providerSection} ${assistantMode === 'ai' ? styles.providerSectionActive : ''}`}>
              <div className={styles.providerSectionInner}>
                <div className={styles.providerRow}>
                  <div
                    className={`${styles.radioGroup} ${!hasLicense ? styles.radioGroupDisabled : ''}`}
                    role="radiogroup"
                    aria-label="Voice agent"
                  >
                    <label className={styles.radioOption}>
                      <input
                        type="radio"
                        name="kiosk-voice-agent"
                        value="elevenlabs"
                        className={styles.radioInput}
                        checked={pendingAgent === 'elevenlabs'}
                        onChange={() => setPendingAgent('elevenlabs')}
                        disabled={!hasLicense || applying}
                      />
                      <span className={styles.radioMark} />
                      <span>ElevenLabs</span>
                    </label>
                    <label className={styles.radioOption}>
                      <input
                        type="radio"
                        name="kiosk-voice-agent"
                        value="gemini-live"
                        className={styles.radioInput}
                        checked={pendingAgent === 'gemini-live'}
                        onChange={() => setPendingAgent('gemini-live')}
                        disabled={!hasLicense || applying}
                      />
                      <span className={styles.radioMark} />
                      <span>Gemini Live</span>
                    </label>
                  </div>
                  <button
                    type="button"
                    className={styles.applyButton}
                    onClick={() => void handleApply()}
                    disabled={
                      !hasLicense ||
                      applying ||
                      !hasPendingChange ||
                      !paths['kiosk-app'].trim()
                    }
                  >
                    {applying ? 'Applying...' : 'Apply & restart'}
                  </button>
                </div>
                {!hasLicense && (
                  <p className={styles.disabledHint}>
                    Configure a license file path above to enable agent selection
                  </p>
                )}
                {applyError && <span className={styles.filePathValidationError}>{applyError}</span>}
              </div>
            </div>

            {/* Human provider — collapses when AI mode */}
            <div className={`${styles.providerSection} ${assistantMode === 'human' ? styles.providerSectionActive : ''}`}>
              <div className={styles.providerSectionInner}>
                <div className={styles.providerRow}>
                  <div className={styles.radioGroup} role="radiogroup" aria-label="Human provider">
                    <label className={styles.radioOption}>
                      <input
                        type="radio"
                        name="kiosk-human-provider"
                        value="face-capture"
                        className={styles.radioInput}
                        checked
                        readOnly
                      />
                      <span className={styles.radioMark} />
                      <span>FaceCapture</span>
                    </label>
                  </div>
                  <div
                    className={styles.operatorBadgeWrap}
                    onMouseEnter={onBadgeWrapEnter}
                    onMouseLeave={onBadgeWrapLeave}
                  >
                    <div
                      ref={badgeRef}
                      className={styles.operatorBadge}
                      aria-label="Human operator"
                      onAnimationEnd={onBadgeAnimEnd}
                    >
                      <svg
                        width="34"
                        height="34"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path className={styles.operatorHead} d="M4 15v-3a8 8 0 0 1 16 0v3" />
                        <path className={styles.operatorEarL} d="M2 14.5h2a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1H2v-4.5Z" />
                        <path className={styles.operatorEarR} d="M22 14.5h-2a1 1 0 0 0-1 1v2.5a1 1 0 0 0 1 1h2v-4.5Z" />
                        <path className={styles.operatorMic} d="M18 19c0 1.5-2.5 3-6 3" />
                      </svg>
                      <span className={`${styles.speechBubble} ${styles.speechBubble1}`}>Hello!</span>
                      <span className={`${styles.speechBubble} ${styles.speechBubble2}`}>Bonjour</span>
                      <span className={`${styles.speechBubble} ${styles.speechBubble3}`}>Hola!</span>
                      <span className={`${styles.speechBubble} ${styles.speechBubble4}`}>Ciao</span>
                      <span className={`${styles.speechBubble} ${styles.speechBubble5}`}>Hej!</span>
                    </div>
                  </div>
                </div>
                {faceCaptureError && <span className={styles.filePathValidationError}>{faceCaptureError}</span>}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Widget: Phone + Laptop ── */}
      <section
        className={`${styles.settingsBlock} ${
          widgetHasError
            ? styles.settingsBlockError
            : widgetAllGood
              ? styles.settingsBlockValid
              : ''
        }`}
      >
        <h2 className={styles.settingsBlockTitle}>Widget</h2>

        {WIDGET_DEVICES.map((field) => {
          const urlHook = urlSaveByDevice[field.id];
          const urlValue = urlHook.input;
          const hasUrl = urlValue.trim().length > 0;
          const urlValid = !hasUrl || isValidUrl(urlValue);

          return (
            <div key={field.id} className={styles.field}>
              <div className={styles.fieldHeader}>
                <label className={styles.label} htmlFor={`${field.id}-url`}>
                  {field.label}
                </label>
                {hasUrl && (
                  <span className={`${styles.badge} ${urlValid ? styles.badgeValid : styles.badgeInvalid}`}>
                    {urlValid ? '✓ Valid' : '✗ Invalid URL'}
                  </span>
                )}
              </div>
              <input
                id={`${field.id}-url`}
                className={`${styles.input} ${hasUrl && !urlValid ? styles.inputError : ''} ${urlHook.isSaving ? styles.inputSaving : ''}`}
                type="url"
                placeholder={field.placeholder}
                value={urlValue}
                onChange={(e) => urlHook.setInput(e.target.value)}
                spellCheck={false}
                autoComplete="url"
              />
            </div>
          );
        })}
      </section>
    </div>
  );
}

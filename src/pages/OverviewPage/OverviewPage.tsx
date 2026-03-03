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
} from '@/stores/kiosksStore';
import {
  browseForExe,
  browseForFile,
  forceRewriteVoiceAgentFile,
  startProcess,
  stopProcess,
  getProcessStatus,
} from '@/services/voiceAgentWriter';
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
  const voiceAgent = useKiosksStore((s) => s.voiceAgent);
  const setVoiceAgent = useKiosksStore((s) => s.setVoiceAgent);

  const [licenseInput, setLicenseInput] = useState(licenseFilePath);
  const [licenseBrowsing, setLicenseBrowsing] = useState(false);
  const [licenseError, setLicenseError] = useState<string | null>(null);

  const [pendingAgent, setPendingAgent] = useState<VoiceAgent>(voiceAgent);
  const [applying, setApplying] = useState(false);

  // Sync local state with store on external changes (e.g. persist rehydration)
  useEffect(() => { setLicenseInput(licenseFilePath); }, [licenseFilePath]);
  useEffect(() => { setPendingAgent(voiceAgent); }, [voiceAgent]);

  const hasLicense = licenseInput.trim().length > 0;
  const hasPendingChange = pendingAgent !== voiceAgent;

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
      } else {
        setLicenseError(result.errors?.join('; ') || 'Browse failed');
      }
    } catch (err) {
      setLicenseError(err instanceof Error ? err.message : String(err));
    } finally {
      setLicenseBrowsing(false);
    }
  }, [setLicenseFilePath]);

  const [applyError, setApplyError] = useState<string | null>(null);

  const handleApply = useCallback(async () => {
    setApplying(true);
    setApplyError(null);
    try {
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

        const stopResult = await stopProcess(kioskId);
        if (!stopResult.ok) {
          throw new Error(stopResult.error ?? 'Failed to stop Kiosk app before restart');
        }
        setRunning((prev) => ({ ...prev, [kioskId]: false }));

        const startResult = await startProcess(kioskPath, kioskId);
        if (!startResult.ok) {
          throw new Error(startResult.error ?? 'Failed to start Kiosk app');
        }
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
    return () => {
      Object.values(launchTimers.current).forEach((t) => { if (t) clearTimeout(t); });
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
      const result = await stopProcess(id);
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
      const stopResult = await stopProcess(id);
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
            <span className={styles.label}>Provider</span>
          </div>
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

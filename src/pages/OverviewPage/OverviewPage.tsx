import { useCallback, useEffect, useRef, useState } from 'react';
import { devices, preloadDeviceFrameImages } from '@/config/devices';
import { warmDetectScreenRect } from '@/hooks/useDetectScreenRect';
import {
  useSettingsStore,
  type DeviceId,
  type VoiceAgent,
  type StreamDeviceId,
  STREAM_DEVICE_IDS,
} from '@/stores/settingsStore';
import {
  forceRewriteVoiceAgentFile,
  readVoiceAgentFromFile,
  setWriterFilePath,
  getWriterConfig,
  browseForFile,
  setDeviceExePath,
  browseForExe,
  restartStart2stream,
  stopProcess,
} from '@/services/voiceAgentWriter';
import styles from './OverviewPage.module.css';

const IS_WINDOWS =
  typeof navigator !== 'undefined' &&
  (/win/i.test(navigator.userAgent) ||
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ===
      'Windows');

interface DeviceField {
  id: DeviceId;
  label: string;
  placeholder: string;
}

/** Widget devices — left column, URL-only */
const WIDGET_DEVICES: DeviceField[] = [
  { id: 'phone', label: 'Phone', placeholder: 'https://your-phone-url.com' },
  { id: 'laptop', label: 'Laptop', placeholder: 'https://your-laptop-url.com' },
];

/** Stream devices — right column, URL + executable */
const STREAM_DEVICES: DeviceField[] = [
  { id: 'kiosk', label: 'Info Kiosk', placeholder: 'https://your-kiosk-url.com' },
  {
    id: 'keba-kiosk',
    label: 'Keba Kiosk',
    placeholder: 'https://your-keba-kiosk-url.com',
  },
  { id: 'holobox', label: 'Holobox', placeholder: 'https://your-holobox-url.com' },
];

function isValidUrl(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

interface ExeFieldState {
  input: string;
  saving: boolean;
  browsing: boolean;
  saved: boolean;
  error: string | null;
  resolvedPath: string | null;
}

function initExeState(path: string): ExeFieldState {
  return {
    input: path,
    saving: false,
    browsing: false,
    saved: !!path,
    error: null,
    resolvedPath: path || null,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OverviewPage() {
  const phoneUrl = useSettingsStore((s) => s.phoneUrl);
  const laptopUrl = useSettingsStore((s) => s.laptopUrl);
  const kioskUrl = useSettingsStore((s) => s.kioskUrl);
  const holoboxUrl = useSettingsStore((s) => s.holoboxUrl);
  const kebaKioskUrl = useSettingsStore((s) => s.kebaKioskUrl);
  const voiceAgent = useSettingsStore((s) => s.voiceAgent);
  const licenseFilePath = useSettingsStore((s) => s.licenseFilePath);
  const deviceExePaths = useSettingsStore((s) => s.deviceExePaths);
  const setDeviceUrl = useSettingsStore((s) => s.setDeviceUrl);
  const setVoiceAgent = useSettingsStore((s) => s.setVoiceAgent);
  const setLicenseFilePath = useSettingsStore((s) => s.setLicenseFilePath);
  const setDeviceExePathStore = useSettingsStore((s) => s.setDeviceExePath);

  // Kill any running streaming process when entering the settings page
  useEffect(() => {
    void stopProcess().catch(() => {});
  }, []);

  // -- backend connectivity --
  const [backendError, setBackendError] = useState<string | null>(null);

  // -- file path state --
  const [filePathInput, setFilePathInput] = useState(licenseFilePath);
  const [isFilePathSaving, setIsFilePathSaving] = useState(false);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [filePathSaved, setFilePathSaved] = useState(!!licenseFilePath);
  const [filePathError, setFilePathError] = useState<string | null>(null);
  const [filePathResolvedPath, setFilePathResolvedPath] = useState<string | null>(null);

  // -- per-device exe path state --
  const [exeStates, setExeStates] = useState<Record<StreamDeviceId, ExeFieldState>>(
    () => ({
      holobox: initExeState(deviceExePaths.holobox),
      'keba-kiosk': initExeState(deviceExePaths['keba-kiosk']),
      kiosk: initExeState(deviceExePaths.kiosk),
    }),
  );

  const updateExeState = useCallback(
    (deviceId: StreamDeviceId, patch: Partial<ExeFieldState>) => {
      setExeStates((prev) => ({
        ...prev,
        [deviceId]: { ...prev[deviceId], ...patch },
      }));
    },
    [],
  );

  // Ref mirror of exeStates — allows callbacks (handleSaveExePath) to read
  // the latest input value without listing exeStates in their deps array.
  // Without this, every keystroke would re-create all save handlers because
  // exeStates changes on every input change.
  const exeStatesRef = useRef(exeStates);
  exeStatesRef.current = exeStates;

  // -- voice agent state --
  /** Local voice agent selection — only written to file on Apply */
  const [pendingVoiceAgent, setPendingVoiceAgent] = useState<VoiceAgent>(voiceAgent);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const valuesByDevice: Record<DeviceId, string> = {
    phone: phoneUrl,
    laptop: laptopUrl,
    kiosk: kioskUrl,
    holobox: holoboxUrl,
    'keba-kiosk': kebaKioskUrl,
  };

  const isFileConfigured = filePathSaved && !filePathError;
  const hasAnyExeConfigured = STREAM_DEVICE_IDS.some(
    (id) => exeStates[id].saved && !exeStates[id].error,
  );

  // Block-level validation for Widget (Phone + Laptop)
  const widgetHasError = WIDGET_DEVICES.some((d) => {
    const v = valuesByDevice[d.id];
    return v.trim().length > 0 && !isValidUrl(v);
  });
  const widgetAllGood = WIDGET_DEVICES.every((d) => {
    const v = valuesByDevice[d.id];
    return v.trim().length > 0 && isValidUrl(v);
  });

  // Block-level validation for Streaming wrapper
  const streamHasError = STREAM_DEVICES.some((d) => {
    const sid = d.id as StreamDeviceId;
    const v = valuesByDevice[d.id];
    return (v.trim().length > 0 && !isValidUrl(v)) || !!exeStates[sid].error;
  });
  const streamAllGood = STREAM_DEVICES.every((d) => {
    const sid = d.id as StreamDeviceId;
    const v = valuesByDevice[d.id];
    return v.trim().length > 0 && isValidUrl(v) && exeStates[sid].saved && !exeStates[sid].error;
  });

  /** Restart the currently running process (if any) */
  const triggerRestart = useCallback(async () => {
    if (!hasAnyExeConfigured) return;
    try {
      await restartStart2stream();
    } catch {
      // Best-effort restart — failure is non-critical
    }
  }, [hasAnyExeConfigured]);

  // -- preload device assets --
  useEffect(() => {
    preloadDeviceFrameImages();
    devices.forEach((device) => {
      if (!device.autoDetectScreen) return;
      warmDetectScreenRect(device.frameSrc);
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Init effect: synchronize frontend state with the backend on mount.
  //
  // Data flow:
  //   1. GET /config → read license path + device exe paths from backend
  //   2. Compare with Zustand store → backend wins if it has a value
  //   3. If Zustand has a value but backend doesn't → push to backend (POST)
  //   4. GET /process/status → show current process state in UI
  //
  // The `cancelled` flag prevents state updates after unmount, which would
  // happen if the user navigates away before the async chain completes.
  // Each `await` is followed by `if (cancelled) return` to bail out early.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const cfg = await getWriterConfig();
        if (cancelled) return;
        setBackendError(null);

        // Backend is the source of truth for paths; fall back to Zustand
        // only if the backend has no value yet (first-time setup).
        const backendLicensePath = cfg.licenseFilePath || '';
        const effectiveLicensePath = backendLicensePath || licenseFilePath;

        if (effectiveLicensePath) {
          setFilePathInput(effectiveLicensePath);
          setFilePathResolvedPath(effectiveLicensePath);

          if (!backendLicensePath && licenseFilePath) {
            // Zustand has a path but backend doesn't — push it to backend
            const result = await setWriterFilePath(licenseFilePath);
            if (cancelled) return;
            if (result.ok) {
              setLicenseFilePath(result.resolvedPath ?? licenseFilePath);
              setFilePathSaved(true);
            } else {
              setFilePathError(result.error ?? 'Previously saved path no longer exists');
              setFilePathSaved(false);
            }
          } else {
            setLicenseFilePath(backendLicensePath);
            setFilePathSaved(true);
          }
        }

        // Sync per-device exe paths
        for (const did of STREAM_DEVICE_IDS) {
          if (cancelled) return;
          const backendExePath = cfg.deviceExePaths[did] || '';
          const storePath = deviceExePaths[did] || '';
          const effectiveExePath = backendExePath || storePath;

          if (effectiveExePath) {
            updateExeState(did, {
              input: effectiveExePath,
              resolvedPath: effectiveExePath,
              saved: true,
            });

            if (!backendExePath && storePath) {
              // Zustand has a path but backend doesn't — push it
              const result = await setDeviceExePath(did, storePath);
              if (cancelled) return;
              if (result.ok) {
                setDeviceExePathStore(did, result.resolvedPath ?? storePath);
              } else {
                updateExeState(did, {
                  error: result.error ?? 'Previously saved path no longer exists',
                  saved: false,
                });
              }
            } else if (backendExePath) {
              setDeviceExePathStore(did, backendExePath);
            }
          }
        }

        if (cancelled) return;
      } catch (err) {
        if (cancelled) return;
        setBackendError(
          `Local server unavailable. Start agent-option-writer and reload the page.${err instanceof Error ? ` (${err.message})` : ''}`,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- sync pendingVoiceAgent from file on mount (read-only, no restart) --
  useEffect(() => {
    if (!isFileConfigured) return;
    let cancelled = false;

    void readVoiceAgentFromFile()
      .then((result) => {
        if (cancelled || !result.configured || !result.voiceAgent) return;
        // Align pending selection with what's actually in the file
        setPendingVoiceAgent(result.voiceAgent);
      })
      .catch(() => {
        /* ignore — non-critical */
      });

    return () => {
      cancelled = true;
    };
  }, [isFileConfigured]);

  const hasPendingAgentChange = pendingVoiceAgent !== voiceAgent;

  // -- debounced auto-save for license file path --
  useEffect(() => {
    const trimmed = filePathInput.trim();
    if (!trimmed || filePathSaved || isFilePathSaving || isBrowsing || filePathError) return;

    const timer = setTimeout(() => {
      void (async () => {
        setIsFilePathSaving(true);
        setFilePathError(null);
        setFilePathResolvedPath(null);

        try {
          const result = await setWriterFilePath(trimmed);
          if (!result.ok) {
            setFilePathError(result.error ?? 'Path not found or not readable');
            setFilePathResolvedPath(result.resolvedPath ?? null);
            setFilePathSaved(false);
          } else {
            setLicenseFilePath(result.resolvedPath ?? trimmed);
            setFilePathResolvedPath(result.resolvedPath ?? null);
            setFilePathSaved(true);
            setFilePathError(null);
          }
        } catch (error) {
          setFilePathError(error instanceof Error ? error.message : String(error));
          setFilePathSaved(false);
        } finally {
          setIsFilePathSaving(false);
        }
      })();
    }, 400);

    return () => clearTimeout(timer);
  }, [filePathInput, filePathSaved, isFilePathSaving, isBrowsing, filePathError, setLicenseFilePath]);

  // -- handlers --

  /**
   * Apply voice agent: write selected value to the license file on disk,
   * update the Zustand store, and restart the running process so it picks
   * up the new agent. Restart is fire-and-forget (no await) to keep UI snappy.
   */
  const handleApplyAgent = useCallback(async () => {
    if (!isFileConfigured) return;
    setIsApplying(true);
    setApplyError(null);

    try {
      const result = await forceRewriteVoiceAgentFile(pendingVoiceAgent);

      if (result.matched) {
        setVoiceAgent(pendingVoiceAgent);
        void triggerRestart();
      } else {
        setApplyError('Agent updated, but the file content didn\'t change as expected');
      }
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsApplying(false);
    }
  }, [pendingVoiceAgent, isFileConfigured, setVoiceAgent, triggerRestart]);

  const handleBrowse = useCallback(async () => {
    setIsBrowsing(true);
    setFilePathError(null);

    try {
      const result = await browseForFile();

      if (result.cancelled) return;

      // Backend error — no path returned but not cancelled
      if (!result.licenseFilePath) {
        setFilePathError(
          result.errors.join('; ') || 'File picker failed. Try again or enter the path manually.',
        );
        return;
      }

      // Fill the input with the selected path
      setFilePathInput(result.licenseFilePath);

      if (result.valid) {
        // Auto-save when file is valid
        const saveResult = await setWriterFilePath(result.licenseFilePath);

        if (saveResult.ok) {
          setLicenseFilePath(saveResult.resolvedPath ?? result.licenseFilePath);
          setFilePathResolvedPath(saveResult.resolvedPath ?? result.licenseFilePath);
          setFilePathSaved(true);
          setFilePathError(null);
        } else {
          setFilePathError(saveResult.error ?? 'Could not save — file may be missing or locked');
          setFilePathSaved(false);
        }
      } else {
        // File picked but invalid
        setFilePathError(result.errors.join('; ') || 'Selected file is not valid for this field');
        setFilePathSaved(false);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (error instanceof DOMException && error.name === 'AbortError') {
        setFilePathError('Browse timed out — the local server may be unresponsive');
      } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setFilePathError('Cannot reach the local server. Is agent-option-writer running?');
      } else {
        setFilePathError(msg);
      }
    } finally {
      setIsBrowsing(false);
    }
  }, [setLicenseFilePath]);

  const handleSaveExePath = useCallback(
    async (deviceId: StreamDeviceId) => {
      const trimmed = exeStatesRef.current[deviceId].input.trim();
      if (!trimmed) {
        updateExeState(deviceId, { error: 'Executable path is required' });
        return;
      }

      updateExeState(deviceId, { saving: true, error: null, resolvedPath: null });

      try {
        const result = await setDeviceExePath(deviceId, trimmed);

        if (!result.ok) {
          updateExeState(deviceId, {
            error: result.error ?? 'Path not found or not readable',
            resolvedPath: result.resolvedPath ?? null,
            saved: false,
            saving: false,
          });
          return;
        }

        setDeviceExePathStore(deviceId, result.resolvedPath ?? trimmed);
        updateExeState(deviceId, {
          resolvedPath: result.resolvedPath ?? null,
          saved: true,
          error: null,
          saving: false,
        });
      } catch (error) {
        updateExeState(deviceId, {
          error: error instanceof Error ? error.message : String(error),
          saved: false,
          saving: false,
        });
      }
    },
    [updateExeState, setDeviceExePathStore],
  );

  const handleBrowseExe = useCallback(
    async (deviceId: StreamDeviceId) => {
      updateExeState(deviceId, { browsing: true, error: null });

      try {
        const result = await browseForExe();

        if (result.cancelled) {
          updateExeState(deviceId, { browsing: false });
          return;
        }

        if (!result.exePath) {
          updateExeState(deviceId, {
            error: result.errors.join('; ') || 'File picker failed. Try again or enter the path manually.',
            browsing: false,
          });
          return;
        }

        updateExeState(deviceId, { input: result.exePath });

        if (result.valid) {
          const saveResult = await setDeviceExePath(deviceId, result.exePath);

          if (saveResult.ok) {
            setDeviceExePathStore(deviceId, saveResult.resolvedPath ?? result.exePath);
            updateExeState(deviceId, {
              resolvedPath: saveResult.resolvedPath ?? result.exePath,
              saved: true,
              error: null,
              browsing: false,
            });
          } else {
            updateExeState(deviceId, {
              error: saveResult.error ?? 'Could not save — file may be missing or locked',
              saved: false,
              browsing: false,
            });
          }
        } else {
          updateExeState(deviceId, {
            error: result.errors.join('; ') || 'Selected file is not valid for this field',
            saved: false,
            browsing: false,
          });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        let errorMsg = msg;
        if (error instanceof DOMException && error.name === 'AbortError') {
          errorMsg = 'Browse timed out — the local server may be unresponsive';
        } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
          errorMsg = 'Cannot reach the local server. Is agent-option-writer running?';
        }
        updateExeState(deviceId, { error: errorMsg, browsing: false });
      }
    },
    [updateExeState, setDeviceExePathStore],
  );

  // -- debounced auto-save for exe paths --
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const did of STREAM_DEVICE_IDS) {
      const st = exeStates[did];
      const trimmed = st.input.trim();
      if (!trimmed || st.saved || st.saving || st.browsing || st.error) continue;

      timers.push(
        setTimeout(() => {
          void handleSaveExePath(did);
        }, 400),
      );
    }

    return () => timers.forEach(clearTimeout);
  }, [exeStates, handleSaveExePath]);

  return (
    <div className={styles.settings}>
      {backendError && (
        <div className={styles.backendErrorBanner}>
          <span>{backendError}</span>
        </div>
      )}

      <div className={styles.form}>
        {/* ── Left column: Voice Agent + Widget ── */}
        <div className={styles.column}>
        {/* ── Voice Agent (must be configured first) ── */}
        <section
          className={`${styles.settingsBlock} ${
            filePathError || (isFileConfigured && hasPendingAgentChange)
              ? styles.settingsBlockError
              : isFileConfigured && !hasPendingAgentChange
                ? styles.settingsBlockValid
                : ''
          }`}
        >
          <h2 className={styles.settingsBlockTitle}>Voice Agent</h2>

          {/* File path input */}
          <div className={styles.field}>
            <div className={styles.fieldHeader}>
              <label className={styles.label} htmlFor="license-file-path">
                License file path
              </label>
              {filePathSaved && !filePathError && (
                <span className={`${styles.badge} ${styles.badgeValid}`}>
                  ✓ Configured
                </span>
              )}
              {filePathError && (
                <span className={`${styles.badge} ${styles.badgeInvalid}`}>
                  ✗ Invalid
                </span>
              )}
            </div>

            <div className={styles.filePathRow}>
              <input
                id="license-file-path"
                className={`${styles.input} ${filePathError ? styles.inputError : ''}`}
                type="text"
                placeholder={
                  IS_WINDOWS ? 'C:\\Path\\To\\license.lic' : '/path/to/license.lic'
                }
                value={filePathInput}
                onChange={(e) => {
                  setFilePathInput(e.target.value);
                  setFilePathSaved(false);
                  setFilePathError(null);
                }}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                className={styles.filePathAction}
                onClick={() => {
                  void handleBrowse();
                }}
                disabled={isBrowsing || isFilePathSaving}
              >
                {isBrowsing ? 'Browsing...' : 'Browse'}
              </button>
            </div>

            <div className={styles.filePathValidation}>
              {filePathError && (
                <span className={styles.filePathValidationError}>{filePathError}</span>
              )}
              {filePathResolvedPath && !filePathError && (
                <span className={styles.filePathResolvedPath}>
                  {filePathResolvedPath}
                </span>
              )}
            </div>
          </div>

          {/* Voice agent selector */}
          <div className={styles.fieldHeader}>
            <label className={styles.label}>Agent provider</label>
            {isFileConfigured && !hasPendingAgentChange && voiceAgent && (
              <span className={`${styles.badge} ${styles.badgeValid}`}>
                ✓ Applied
              </span>
            )}
            {isFileConfigured && hasPendingAgentChange && (
              <span className={`${styles.badge} ${styles.badgeInvalid}`}>
                ● Unsaved
              </span>
            )}
          </div>

          <div
            className={`${styles.radioGroup} ${!isFileConfigured ? styles.radioGroupDisabled : ''}`}
            role="radiogroup"
            aria-label="Voice agent"
          >
            <label className={styles.radioOption}>
              <input
                type="radio"
                name="voice-agent"
                value="elevenlabs"
                checked={pendingVoiceAgent === 'elevenlabs'}
                onChange={() => setPendingVoiceAgent('elevenlabs')}
                disabled={!isFileConfigured || isApplying}
              />
              <span>ElevenLabs</span>
            </label>

            <label className={styles.radioOption}>
              <input
                type="radio"
                name="voice-agent"
                value="gemini-live"
                checked={pendingVoiceAgent === 'gemini-live'}
                onChange={() => setPendingVoiceAgent('gemini-live')}
                disabled={!isFileConfigured || isApplying}
              />
              <span>Gemini Live</span>
            </label>

          </div>

          <button
            type="button"
            className={styles.applyButton}
            onClick={() => {
              void handleApplyAgent();
            }}
            disabled={!isFileConfigured || isApplying || !hasPendingAgentChange}
          >
            {isApplying ? 'Applying...' : 'Apply'}
          </button>

          {applyError && <p className={styles.filePathValidationError}>{applyError}</p>}
        </section>

        {/* ── Widget: Phone + Laptop (URL-only) ── */}
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
            const urlValue = valuesByDevice[field.id];
            const hasUrl = urlValue.trim().length > 0;
            const urlValid = !hasUrl || isValidUrl(urlValue);
            const hasError = hasUrl && !urlValid;
            const allGood = hasUrl && urlValid;

            return (
              <div
                key={field.id}
                className={`${styles.deviceCard} ${
                  hasError
                    ? styles.deviceCardError
                    : allGood
                      ? styles.deviceCardValid
                      : ''
                }`}
              >
                <h3 className={styles.deviceCardTitle}>{field.label}</h3>

                <div className={styles.field}>
                  <div className={styles.fieldHeader}>
                    <label className={styles.label} htmlFor={`${field.id}-url`}>
                      URL
                    </label>
                    {hasUrl && (
                      <span
                        className={`${styles.badge} ${urlValid ? styles.badgeValid : styles.badgeInvalid}`}
                      >
                        {urlValid ? '✓ Valid' : '✗ Invalid URL'}
                      </span>
                    )}
                  </div>
                  <input
                    id={`${field.id}-url`}
                    className={`${styles.input} ${hasUrl && !urlValid ? styles.inputError : ''}`}
                    type="url"
                    placeholder={field.placeholder}
                    value={urlValue}
                    onChange={(e) => setDeviceUrl(field.id, e.target.value)}
                    spellCheck={false}
                    autoComplete="url"
                  />
                </div>
              </div>
            );
          })}
        </section>
        </div>

        {/* ── Right column: Streaming ── */}
        <div className={styles.column}>
          <section
            className={`${styles.settingsBlock} ${
              streamHasError
                ? styles.settingsBlockError
                : streamAllGood
                  ? styles.settingsBlockValid
                  : ''
            }`}
          >
            <h2 className={styles.settingsBlockTitle}>Streaming</h2>

            {STREAM_DEVICES.map((field) => {
              const streamId = field.id as StreamDeviceId;
              const exeSt = exeStates[streamId];
              const urlValue = valuesByDevice[field.id];
              const hasUrl = urlValue.trim().length > 0;
              const urlValid = !hasUrl || isValidUrl(urlValue);

              const hasError = (hasUrl && !urlValid) || !!exeSt.error;
              const allGood =
                hasUrl && urlValid && exeSt.saved && !exeSt.error;

              return (
                <div
                  key={field.id}
                  className={`${styles.deviceCard} ${
                    hasError
                      ? styles.deviceCardError
                      : allGood
                        ? styles.deviceCardValid
                        : ''
                  }`}
                >
                  <h3 className={styles.deviceCardTitle}>{field.label}</h3>

                  {/* URL */}
                  <div className={styles.field}>
                    <div className={styles.fieldHeader}>
                      <label className={styles.label} htmlFor={`${field.id}-url`}>
                        URL
                      </label>
                      {hasUrl && (
                        <span
                          className={`${styles.badge} ${urlValid ? styles.badgeValid : styles.badgeInvalid}`}
                        >
                          {urlValid ? '✓ Valid' : '✗ Invalid URL'}
                        </span>
                      )}
                    </div>
                    <input
                      id={`${field.id}-url`}
                      className={`${styles.input} ${hasUrl && !urlValid ? styles.inputError : ''}`}
                      type="url"
                      placeholder={field.placeholder}
                      value={urlValue}
                      onChange={(e) => setDeviceUrl(field.id, e.target.value)}
                      spellCheck={false}
                      autoComplete="url"
                    />
                  </div>

                  {/* Executable */}
                  <div className={styles.field}>
                    <div className={styles.fieldHeader}>
                      <label
                        className={styles.label}
                        htmlFor={`exe-path-${streamId}`}
                      >
                        Executable
                      </label>
                      {exeSt.saved && !exeSt.error && (
                        <span className={`${styles.badge} ${styles.badgeValid}`}>
                          ✓ Configured
                        </span>
                      )}
                      {exeSt.error && (
                        <span className={`${styles.badge} ${styles.badgeInvalid}`}>
                          ✗ Invalid
                        </span>
                      )}
                    </div>

                    <div className={styles.filePathRow}>
                      <input
                        id={`exe-path-${streamId}`}
                        className={`${styles.input} ${exeSt.error ? styles.inputError : ''}`}
                        type="text"
                        placeholder={
                          IS_WINDOWS
                            ? `C:\\Path\\To\\${streamId}.bat`
                            : `/path/to/${streamId}.bat`
                        }
                        value={exeSt.input}
                        onChange={(e) => {
                          updateExeState(streamId, {
                            input: e.target.value,
                            saved: false,
                            error: null,
                          });
                        }}
                        spellCheck={false}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className={styles.filePathAction}
                        onClick={() => {
                          void handleBrowseExe(streamId);
                        }}
                        disabled={exeSt.browsing || exeSt.saving}
                      >
                        {exeSt.browsing ? 'Browsing...' : 'Browse'}
                      </button>
                    </div>

                    <div className={styles.filePathValidation}>
                      {exeSt.error && (
                        <span className={styles.filePathValidationError}>
                          {exeSt.error}
                        </span>
                      )}
                      {exeSt.resolvedPath && !exeSt.error && (
                        <span className={styles.filePathResolvedPath}>
                          {exeSt.resolvedPath}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
}

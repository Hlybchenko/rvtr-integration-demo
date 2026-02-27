import { useCallback, useEffect, useState } from 'react';
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
  getProcessStatus,
} from '@/services/voiceAgentWriter';
import styles from './OverviewPage.module.css';

const IS_WINDOWS =
  typeof navigator !== 'undefined' &&
  (/win/i.test(navigator.userAgent) ||
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ===
      'Windows');

const STREAM_DEVICE_LABELS: Record<StreamDeviceId, string> = {
  holobox: 'Holobox',
  'keba-kiosk': 'Keba Kiosk',
  kiosk: 'Info Kiosk',
};

const DEVICE_FIELDS: Array<{
  id: DeviceId;
  label: string;
  placeholder: string;
}> = [
  { id: 'phone', label: 'Phone', placeholder: 'https://your-phone-url.com' },
  { id: 'laptop', label: 'Laptop', placeholder: 'https://your-laptop-url.com' },
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
  type ExeFieldState = {
    input: string;
    saving: boolean;
    browsing: boolean;
    saved: boolean;
    error: string | null;
    resolvedPath: string | null;
  };

  const initExeState = (path: string): ExeFieldState => ({
    input: path,
    saving: false,
    browsing: false,
    saved: !!path,
    error: null,
    resolvedPath: path || null,
  });

  const [exeStates, setExeStates] = useState<Record<StreamDeviceId, ExeFieldState>>(() => ({
    holobox: initExeState(deviceExePaths.holobox),
    'keba-kiosk': initExeState(deviceExePaths['keba-kiosk']),
    kiosk: initExeState(deviceExePaths.kiosk),
  }));

  const updateExeState = useCallback(
    (deviceId: StreamDeviceId, patch: Partial<ExeFieldState>) => {
      setExeStates((prev) => ({
        ...prev,
        [deviceId]: { ...prev[deviceId], ...patch },
      }));
    },
    [],
  );

  // -- process status state --
  const [processRunning, setProcessRunning] = useState<boolean | null>(null);
  const [processDeviceId, setProcessDeviceId] = useState<string | null>(null);

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

  /** Restart the currently running process (if any) */
  const triggerRestart = useCallback(async () => {
    if (!hasAnyExeConfigured) return;
    try {
      const result = await restartStart2stream();
      if (result.ok) {
        setProcessRunning(true);
        setProcessDeviceId(result.pid ? null : null);
      } else {
        setProcessRunning(false);
      }
    } catch {
      setProcessRunning(false);
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

  // -- init: sync file path from backend config, then auto-validate --
  useEffect(() => {
    void (async () => {
      try {
        const cfg = await getWriterConfig();
        setBackendError(null);

        // Backend has a saved path — use it as source of truth
        const backendPath = cfg.licenseFilePath || '';
        const effectivePath = backendPath || licenseFilePath;

        if (effectivePath) {
          setFilePathInput(effectivePath);
          setFilePathResolvedPath(effectivePath);

          if (!backendPath && licenseFilePath) {
            // Zustand has a path but backend doesn't — push it to backend
            const result = await setWriterFilePath(licenseFilePath);
            if (result.ok) {
              setLicenseFilePath(result.resolvedPath ?? licenseFilePath);
              setFilePathSaved(true);
            } else {
              setFilePathError(result.error ?? 'Saved path is no longer valid');
              setFilePathSaved(false);
            }
          } else {
            setLicenseFilePath(backendPath);
            setFilePathSaved(true);
          }
        }

        // Sync per-device exe paths
        for (const did of STREAM_DEVICE_IDS) {
          const backendPath = cfg.deviceExePaths[did] || '';
          const storePath = deviceExePaths[did] || '';
          const effectivePath = backendPath || storePath;

          if (effectivePath) {
            updateExeState(did, {
              input: effectivePath,
              resolvedPath: effectivePath,
              saved: true,
            });

            if (!backendPath && storePath) {
              // Zustand has a path but backend doesn't — push it
              const result = await setDeviceExePath(did, storePath);
              if (result.ok) {
                setDeviceExePathStore(did, result.resolvedPath ?? storePath);
              } else {
                updateExeState(did, {
                  error: result.error ?? 'Saved exe path is no longer valid',
                  saved: false,
                });
              }
            } else if (backendPath) {
              setDeviceExePathStore(did, backendPath);
            }
          }
        }

        // Check process status
        try {
          const status = await getProcessStatus();
          setProcessRunning(status.running);
          setProcessDeviceId(status.deviceId);
        } catch {
          setProcessRunning(null);
        }
      } catch (err) {
        setBackendError(
          `Backend unavailable (http://127.0.0.1:3210). Is agent-option-writer running? ${err instanceof Error ? err.message : ''}`,
        );
      }
    })();
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
      .catch(() => { /* ignore — non-critical */ });

    return () => { cancelled = true; };
  }, [isFileConfigured]);

  const hasPendingAgentChange = pendingVoiceAgent !== voiceAgent;

  // -- handlers --

  /** Apply the selected voice agent: force write to file, update store, restart */
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
        setApplyError('Write completed, but file value still differs');
      }
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsApplying(false);
    }
  }, [pendingVoiceAgent, isFileConfigured, setVoiceAgent, triggerRestart]);

  const handleSaveFilePath = useCallback(async () => {
    const trimmed = filePathInput.trim();
    if (!trimmed) {
      setFilePathError('File path is required');
      return;
    }

    setIsFilePathSaving(true);
    setFilePathError(null);
    setFilePathResolvedPath(null);

    try {
      const result = await setWriterFilePath(trimmed);

      if (!result.ok) {
        setFilePathError(result.error ?? 'Validation failed');
        setFilePathResolvedPath(result.resolvedPath ?? null);
        setFilePathSaved(false);
        return;
      }

      setLicenseFilePath(result.resolvedPath ?? trimmed);
      setFilePathResolvedPath(result.resolvedPath ?? null);
      setFilePathSaved(true);
      setFilePathError(null);
    } catch (error) {
      setFilePathError(error instanceof Error ? error.message : String(error));
      setFilePathSaved(false);
    } finally {
      setIsFilePathSaving(false);
    }
  }, [filePathInput, setLicenseFilePath]);

  const handleBrowse = useCallback(async () => {
    setIsBrowsing(true);
    setFilePathError(null);

    try {
      const result = await browseForFile();

      if (result.cancelled) return;

      // Backend error — no path returned but not cancelled
      if (!result.licenseFilePath) {
        setFilePathError(result.errors.join('; ') || 'File picker failed — check backend logs');
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
          setFilePathError(saveResult.error ?? 'Failed to save');
          setFilePathSaved(false);
        }
      } else {
        // File picked but invalid
        setFilePathError(result.errors.join('; ') || 'Selected file is not valid');
        setFilePathSaved(false);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (error instanceof DOMException && error.name === 'AbortError') {
        setFilePathError('Browse timed out — backend may be unresponsive');
      } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setFilePathError('Cannot reach backend (http://127.0.0.1:3210). Is it running?');
      } else {
        setFilePathError(msg);
      }
    } finally {
      setIsBrowsing(false);
    }
  }, [setLicenseFilePath]);

  const handleSaveExePath = useCallback(async (deviceId: StreamDeviceId) => {
    const trimmed = exeStates[deviceId].input.trim();
    if (!trimmed) {
      updateExeState(deviceId, { error: 'Executable path is required' });
      return;
    }

    updateExeState(deviceId, { saving: true, error: null, resolvedPath: null });

    try {
      const result = await setDeviceExePath(deviceId, trimmed);

      if (!result.ok) {
        updateExeState(deviceId, {
          error: result.error ?? 'Validation failed',
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
  }, [exeStates, updateExeState, setDeviceExePathStore]);

  const handleBrowseExe = useCallback(async (deviceId: StreamDeviceId) => {
    updateExeState(deviceId, { browsing: true, error: null });

    try {
      const result = await browseForExe();

      if (result.cancelled) {
        updateExeState(deviceId, { browsing: false });
        return;
      }

      if (!result.exePath) {
        updateExeState(deviceId, {
          error: result.errors.join('; ') || 'File picker failed — check backend logs',
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
            error: saveResult.error ?? 'Failed to save',
            saved: false,
            browsing: false,
          });
        }
      } else {
        updateExeState(deviceId, {
          error: result.errors.join('; ') || 'Selected file is not valid',
          saved: false,
          browsing: false,
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      let errorMsg = msg;
      if (error instanceof DOMException && error.name === 'AbortError') {
        errorMsg = 'Browse timed out — backend may be unresponsive';
      } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        errorMsg = 'Cannot reach backend (http://127.0.0.1:3210). Is it running?';
      }
      updateExeState(deviceId, { error: errorMsg, browsing: false });
    }
  }, [updateExeState, setDeviceExePathStore]);

  return (
    <div className={styles.settings}>
      {backendError && (
        <div className={styles.backendErrorBanner}>
          <span>{backendError}</span>
        </div>
      )}

      <div className={styles.form}>
        {/* ── Voice Agent (must be configured first) ── */}
        <section className={styles.settingsBlock}>
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
                  IS_WINDOWS
                    ? 'C:\\Path\\To\\license.lic'
                    : '/path/to/license.lic'
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
                {isBrowsing ? 'Picking...' : 'Browse'}
              </button>
              <button
                type="button"
                className={styles.filePathAction}
                onClick={() => {
                  void handleSaveFilePath();
                }}
                disabled={isFilePathSaving || isBrowsing || !filePathInput.trim()}
              >
                {isFilePathSaving ? 'Saving...' : 'Save'}
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

            <button
              type="button"
              className={styles.filePathAction}
              onClick={() => { void handleApplyAgent(); }}
              disabled={!isFileConfigured || isApplying || !hasPendingAgentChange}
            >
              {isApplying ? 'Applying...' : 'Apply'}
            </button>
          </div>

          {applyError && (
            <p className={styles.filePathValidationError}>{applyError}</p>
          )}
        </section>

        {/* ── Device Executables ── */}
        <section className={styles.settingsBlock}>
          <h2 className={styles.settingsBlockTitle}>Device Executables</h2>

          {STREAM_DEVICE_IDS.map((did) => {
            const st = exeStates[did];
            return (
              <div key={did} className={styles.field}>
                <div className={styles.fieldHeader}>
                  <label className={styles.label} htmlFor={`exe-path-${did}`}>
                    {STREAM_DEVICE_LABELS[did]}
                  </label>
                  {st.saved && !st.error && (
                    <span className={`${styles.badge} ${styles.badgeValid}`}>
                      ✓ Configured
                    </span>
                  )}
                  {st.error && (
                    <span className={`${styles.badge} ${styles.badgeInvalid}`}>
                      ✗ Invalid
                    </span>
                  )}
                </div>

                <div className={styles.filePathRow}>
                  <input
                    id={`exe-path-${did}`}
                    className={`${styles.input} ${st.error ? styles.inputError : ''}`}
                    type="text"
                    placeholder={
                      IS_WINDOWS
                        ? `C:\\Path\\To\\${did}.bat`
                        : `/path/to/${did}.bat`
                    }
                    value={st.input}
                    onChange={(e) => {
                      updateExeState(did, {
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
                    onClick={() => { void handleBrowseExe(did); }}
                    disabled={st.browsing || st.saving}
                  >
                    {st.browsing ? 'Picking...' : 'Browse'}
                  </button>
                  <button
                    type="button"
                    className={styles.filePathAction}
                    onClick={() => { void handleSaveExePath(did); }}
                    disabled={st.saving || st.browsing || !st.input.trim()}
                  >
                    {st.saving ? 'Saving...' : 'Save'}
                  </button>
                </div>

                <div className={styles.filePathValidation}>
                  {st.error && (
                    <span className={styles.filePathValidationError}>{st.error}</span>
                  )}
                  {st.resolvedPath && !st.error && (
                    <span className={styles.filePathResolvedPath}>
                      {st.resolvedPath}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Process status (read-only, managed by DevicePage) */}
          {hasAnyExeConfigured && (
            <div className={styles.syncStatusBox}>
              <div className={styles.syncStatusRow}>
                <span className={styles.syncStatusLabel}>Process</span>
                {processRunning === null ? (
                  <span className={styles.syncStatusNeutral}>Unknown</span>
                ) : processRunning ? (
                  <span className={styles.syncStatusOk}>
                    Running{processDeviceId ? ` (${processDeviceId})` : ''}
                  </span>
                ) : (
                  <span className={styles.syncStatusNeutral}>Not running</span>
                )}
              </div>

              <p className={styles.hint}>
                Processes start automatically when navigating to a device page.
              </p>
            </div>
          )}
        </section>

        {/* ── Device URLs ── */}
        <section className={styles.settingsBlock}>
          <h2 className={styles.settingsBlockTitle}>Device URLs</h2>

          {DEVICE_FIELDS.map((field) => {
            const value = valuesByDevice[field.id];
            const hasValue = value.trim().length > 0;
            const isValid = !hasValue || isValidUrl(value);

            return (
              <div key={field.id} className={styles.field}>
                <div className={styles.fieldHeader}>
                  <label className={styles.label} htmlFor={`${field.id}-url`}>
                    {field.label}
                  </label>
                  {hasValue && (
                    <span
                      className={`${styles.badge} ${isValid ? styles.badgeValid : styles.badgeInvalid}`}
                    >
                      {isValid ? '✓ Valid' : '✗ Invalid URL'}
                    </span>
                  )}
                </div>
                <input
                  id={`${field.id}-url`}
                  className={`${styles.input} ${hasValue && !isValid ? styles.inputError : ''}`}
                  type="url"
                  placeholder={field.placeholder}
                  value={value}
                  onChange={(e) => setDeviceUrl(field.id, e.target.value)}
                  spellCheck={false}
                  autoComplete="url"
                />
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}

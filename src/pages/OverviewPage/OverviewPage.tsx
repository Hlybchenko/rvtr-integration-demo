import { useCallback, useEffect, useRef, useState } from 'react';
import { devices, preloadDeviceFrameImages } from '@/config/devices';
import { warmDetectScreenRect } from '@/hooks/useDetectScreenRect';
import { useSettingsStore, type DeviceId, type VoiceAgent } from '@/stores/settingsStore';
import {
  ensureVoiceAgentFileSync,
  forceRewriteVoiceAgentFile,
  setWriterFilePath,
  getWriterConfig,
  browseForFile,
  setStart2streamPath,
  browseForExe,
  restartStart2stream,
  getProcessStatus,
} from '@/services/voiceAgentWriter';
import styles from './OverviewPage.module.css';

const VOICE_AGENT_SYNC_DEBOUNCE_MS = 180;

const IS_WINDOWS =
  typeof navigator !== 'undefined' &&
  (/win/i.test(navigator.userAgent) ||
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ===
      'Windows');

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
  const start2streamPath = useSettingsStore((s) => s.start2streamPath);
  const setDeviceUrl = useSettingsStore((s) => s.setDeviceUrl);
  const setVoiceAgent = useSettingsStore((s) => s.setVoiceAgent);
  const setLicenseFilePath = useSettingsStore((s) => s.setLicenseFilePath);
  const setStart2streamPathStore = useSettingsStore((s) => s.setStart2streamPath);

  // -- backend connectivity --
  const [backendError, setBackendError] = useState<string | null>(null);

  // -- file path state --
  const [filePathInput, setFilePathInput] = useState(licenseFilePath);
  const [isFilePathSaving, setIsFilePathSaving] = useState(false);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [filePathSaved, setFilePathSaved] = useState(!!licenseFilePath);
  const [filePathError, setFilePathError] = useState<string | null>(null);
  const [filePathResolvedPath, setFilePathResolvedPath] = useState<string | null>(null);

  // -- start2stream path state --
  const [exePathInput, setExePathInput] = useState(start2streamPath);
  const [isExePathSaving, setIsExePathSaving] = useState(false);
  const [isExeBrowsing, setIsExeBrowsing] = useState(false);
  const [exePathSaved, setExePathSaved] = useState(!!start2streamPath);
  const [exePathError, setExePathError] = useState<string | null>(null);
  const [exePathResolvedPath, setExePathResolvedPath] = useState<string | null>(null);

  // -- process status state --
  const [processRunning, setProcessRunning] = useState<boolean | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const [restartMessage, setRestartMessage] = useState<string | null>(null);

  // -- voice agent sync state --
  const [fileVoiceAgent, setFileVoiceAgent] = useState<VoiceAgent | null>(null);
  const [isAgentSyncMatched, setIsAgentSyncMatched] = useState<boolean | null>(null);
  const [agentSyncError, setAgentSyncError] = useState<string | null>(null);
  const [isForceRewriting, setIsForceRewriting] = useState(false);
  const [forceRewriteMessage, setForceRewriteMessage] = useState<string | null>(null);
  const lastSyncedVoiceAgentRef = useRef<VoiceAgent | null>(null);
  const syncDebounceTimerRef = useRef<number | null>(null);
  const syncRequestIdRef = useRef(0);

  const valuesByDevice: Record<DeviceId, string> = {
    phone: phoneUrl,
    laptop: laptopUrl,
    kiosk: kioskUrl,
    holobox: holoboxUrl,
    'keba-kiosk': kebaKioskUrl,
  };

  const isFileConfigured = filePathSaved && !filePathError;
  const isExeConfigured = exePathSaved && !exePathError;

  /** Auto-restart start2stream after a successful voice agent write */
  const triggerRestart = useCallback(async () => {
    if (!isExeConfigured) return;
    setIsRestarting(true);
    setRestartMessage(null);
    try {
      const result = await restartStart2stream();
      if (result.ok) {
        setProcessRunning(true);
        setRestartMessage(`Restarted (PID ${result.pid ?? '?'})`);
      } else {
        setProcessRunning(false);
        setRestartMessage(result.error ?? 'Restart failed');
      }
    } catch (err) {
      setProcessRunning(false);
      setRestartMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRestarting(false);
    }
  }, [isExeConfigured]);

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

        // Sync start2stream path
        const backendExePath = cfg.start2streamPath || '';
        const effectiveExePath = backendExePath || start2streamPath;

        if (effectiveExePath) {
          setExePathInput(effectiveExePath);
          setExePathResolvedPath(effectiveExePath);

          if (!backendExePath && start2streamPath) {
            const result = await setStart2streamPath(start2streamPath);
            if (result.ok) {
              setStart2streamPathStore(result.resolvedPath ?? start2streamPath);
              setExePathSaved(true);
            } else {
              setExePathError(result.error ?? 'Saved exe path is no longer valid');
              setExePathSaved(false);
            }
          } else {
            setStart2streamPathStore(backendExePath);
            setExePathSaved(true);
          }
        }

        // Check process status
        try {
          const status = await getProcessStatus();
          setProcessRunning(status.running);
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

  // -- sync voice agent when selection changes --
  useEffect(() => {
    if (!isFileConfigured) return;
    if (lastSyncedVoiceAgentRef.current === voiceAgent) return;
    lastSyncedVoiceAgentRef.current = voiceAgent;

    if (syncDebounceTimerRef.current) {
      window.clearTimeout(syncDebounceTimerRef.current);
      syncDebounceTimerRef.current = null;
    }

    const requestId = syncRequestIdRef.current + 1;
    syncRequestIdRef.current = requestId;

    syncDebounceTimerRef.current = window.setTimeout(() => {
      void ensureVoiceAgentFileSync(voiceAgent)
        .then((result) => {
          if (syncRequestIdRef.current !== requestId) return;
          setFileVoiceAgent(result.fileVoiceAgent);
          setIsAgentSyncMatched(result.matched);
          setAgentSyncError(null);
          // Auto-restart start2stream after successful write
          if (result.matched) void triggerRestart();
        })
        .catch((error) => {
          if (syncRequestIdRef.current !== requestId) return;
          setIsAgentSyncMatched(false);
          setAgentSyncError(error instanceof Error ? error.message : String(error));
        });
    }, VOICE_AGENT_SYNC_DEBOUNCE_MS);

    return () => {
      if (syncDebounceTimerRef.current) {
        window.clearTimeout(syncDebounceTimerRef.current);
        syncDebounceTimerRef.current = null;
      }
    };
  }, [voiceAgent, isFileConfigured, triggerRestart]);

  // -- handlers --

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

      // Reset sync state so it re-checks with the new file
      lastSyncedVoiceAgentRef.current = null;
      setIsAgentSyncMatched(null);
      setFileVoiceAgent(null);
      setAgentSyncError(null);
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

          // Reset sync state
          lastSyncedVoiceAgentRef.current = null;
          setIsAgentSyncMatched(null);
          setFileVoiceAgent(null);
          setAgentSyncError(null);
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

  const handleForceRewrite = async () => {
    setIsForceRewriting(true);
    setForceRewriteMessage(null);

    try {
      const result = await forceRewriteVoiceAgentFile(voiceAgent);
      setFileVoiceAgent(result.fileVoiceAgent);
      setIsAgentSyncMatched(result.matched);
      setAgentSyncError(null);
      setForceRewriteMessage(
        result.matched ? null : 'Rewrite completed, but values still differ',
      );
      // Auto-restart start2stream after successful force rewrite
      if (result.matched) void triggerRestart();
    } catch (error) {
      setIsAgentSyncMatched(false);
      setAgentSyncError(error instanceof Error ? error.message : String(error));
      setForceRewriteMessage('Force rewrite failed');
    } finally {
      setIsForceRewriting(false);
    }
  };

  const handleSaveExePath = useCallback(async () => {
    const trimmed = exePathInput.trim();
    if (!trimmed) {
      setExePathError('Executable path is required');
      return;
    }

    setIsExePathSaving(true);
    setExePathError(null);
    setExePathResolvedPath(null);

    try {
      const result = await setStart2streamPath(trimmed);

      if (!result.ok) {
        setExePathError(result.error ?? 'Validation failed');
        setExePathResolvedPath(result.resolvedPath ?? null);
        setExePathSaved(false);
        return;
      }

      setStart2streamPathStore(result.resolvedPath ?? trimmed);
      setExePathResolvedPath(result.resolvedPath ?? null);
      setExePathSaved(true);
      setExePathError(null);
    } catch (error) {
      setExePathError(error instanceof Error ? error.message : String(error));
      setExePathSaved(false);
    } finally {
      setIsExePathSaving(false);
    }
  }, [exePathInput, setStart2streamPathStore]);

  const handleBrowseExe = useCallback(async () => {
    setIsExeBrowsing(true);
    setExePathError(null);

    try {
      const result = await browseForExe();

      if (result.cancelled) return;

      if (!result.start2streamPath) {
        setExePathError(result.errors.join('; ') || 'File picker failed — check backend logs');
        return;
      }

      setExePathInput(result.start2streamPath);

      if (result.valid) {
        const saveResult = await setStart2streamPath(result.start2streamPath);

        if (saveResult.ok) {
          setStart2streamPathStore(saveResult.resolvedPath ?? result.start2streamPath);
          setExePathResolvedPath(saveResult.resolvedPath ?? result.start2streamPath);
          setExePathSaved(true);
          setExePathError(null);
        } else {
          setExePathError(saveResult.error ?? 'Failed to save');
          setExePathSaved(false);
        }
      } else {
        setExePathError(result.errors.join('; ') || 'Selected file is not valid');
        setExePathSaved(false);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (error instanceof DOMException && error.name === 'AbortError') {
        setExePathError('Browse timed out — backend may be unresponsive');
      } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setExePathError('Cannot reach backend (http://127.0.0.1:3210). Is it running?');
      } else {
        setExePathError(msg);
      }
    } finally {
      setIsExeBrowsing(false);
    }
  }, [setStart2streamPathStore]);

  const handleManualRestart = useCallback(() => {
    void triggerRestart();
  }, [triggerRestart]);

  const syncReasonTooltip = agentSyncError
    ? `Writer error: ${agentSyncError}`
    : isAgentSyncMatched === null
      ? 'Checking current value in target file'
      : fileVoiceAgent === null
        ? 'No valid voice_agent value found in target file'
        : isAgentSyncMatched
          ? `File contains "${fileVoiceAgent}" and matches selected option`
          : `Mismatch: selected "${voiceAgent}", file contains "${fileVoiceAgent}"`;

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
            {isFileConfigured && (
              <>
                {isAgentSyncMatched === null ? (
                  <span
                    className={`${styles.voiceAgentStatusIcon} ${styles.voiceAgentStatusNeutral}`}
                    title={syncReasonTooltip}
                  >
                    ...
                  </span>
                ) : isAgentSyncMatched ? (
                  <span
                    className={`${styles.voiceAgentStatusIcon} ${styles.voiceAgentStatusOk}`}
                    title={syncReasonTooltip}
                  >
                    ✓
                  </span>
                ) : (
                  <span
                    className={`${styles.voiceAgentStatusIcon} ${styles.voiceAgentStatusError}`}
                    title={syncReasonTooltip}
                  >
                    ✗
                  </span>
                )}
              </>
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
                checked={voiceAgent === 'elevenlabs'}
                onChange={() => setVoiceAgent('elevenlabs')}
                disabled={!isFileConfigured}
              />
              <span>ElevenLabs</span>
            </label>

            <label className={styles.radioOption}>
              <input
                type="radio"
                name="voice-agent"
                value="gemini-live"
                checked={voiceAgent === 'gemini-live'}
                onChange={() => setVoiceAgent('gemini-live')}
                disabled={!isFileConfigured}
              />
              <span>Gemini Live</span>
            </label>
          </div>

          {/* Sync status (only when file is configured) */}
          {isFileConfigured && (
            <div className={styles.syncStatusBox}>
              <div className={styles.syncStatusRow}>
                <span className={styles.syncStatusLabel}>Sync status</span>
                {isAgentSyncMatched === null ? (
                  <span className={styles.syncStatusNeutral}>Checking...</span>
                ) : isAgentSyncMatched ? (
                  <span className={styles.syncStatusOk}>
                    ✓ File matches selected option
                  </span>
                ) : (
                  <span className={styles.syncStatusError}>
                    ✗ File differs from selected option
                  </span>
                )}
              </div>

              <div className={styles.syncStatusRow}>
                <span className={styles.syncStatusLabel}>Selected</span>
                <span className={styles.syncStatusValue}>{voiceAgent}</span>
              </div>

              <div className={styles.syncStatusRow}>
                <span className={styles.syncStatusLabel}>Target file</span>
                <span
                  className={`${styles.syncStatusValue} ${styles.syncStatusValueWithTooltip}`}
                  title={syncReasonTooltip}
                >
                  {fileVoiceAgent ?? 'not set'}
                </span>
              </div>

              <div className={styles.syncActions}>
                <button
                  type="button"
                  className={styles.forceRewriteButton}
                  onClick={() => {
                    void handleForceRewrite();
                  }}
                  disabled={isForceRewriting}
                >
                  {isForceRewriting ? 'Rewriting...' : 'Force rewrite'}
                </button>
                {forceRewriteMessage ? (
                  <span className={styles.syncActionMessage}>{forceRewriteMessage}</span>
                ) : null}
              </div>

              {agentSyncError ? (
                <p className={styles.syncStatusErrorText}>{agentSyncError}</p>
              ) : null}
            </div>
          )}
        </section>

        {/* ── Start2Stream executable ── */}
        <section className={styles.settingsBlock}>
          <h2 className={styles.settingsBlockTitle}>Start2Stream</h2>

          <div className={styles.field}>
            <div className={styles.fieldHeader}>
              <label className={styles.label} htmlFor="start2stream-path">
                Executable path
              </label>
              {exePathSaved && !exePathError && (
                <span className={`${styles.badge} ${styles.badgeValid}`}>
                  ✓ Configured
                </span>
              )}
              {exePathError && (
                <span className={`${styles.badge} ${styles.badgeInvalid}`}>
                  ✗ Invalid
                </span>
              )}
            </div>

            <div className={styles.filePathRow}>
              <input
                id="start2stream-path"
                className={`${styles.input} ${exePathError ? styles.inputError : ''}`}
                type="text"
                placeholder={
                  IS_WINDOWS
                    ? 'C:\\Path\\To\\start2stream.exe'
                    : '/path/to/start2stream'
                }
                value={exePathInput}
                onChange={(e) => {
                  setExePathInput(e.target.value);
                  setExePathSaved(false);
                  setExePathError(null);
                }}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                className={styles.filePathAction}
                onClick={() => {
                  void handleBrowseExe();
                }}
                disabled={isExeBrowsing || isExePathSaving}
              >
                {isExeBrowsing ? 'Picking...' : 'Browse'}
              </button>
              <button
                type="button"
                className={styles.filePathAction}
                onClick={() => {
                  void handleSaveExePath();
                }}
                disabled={isExePathSaving || isExeBrowsing || !exePathInput.trim()}
              >
                {isExePathSaving ? 'Saving...' : 'Save'}
              </button>
            </div>

            <div className={styles.filePathValidation}>
              {exePathError && (
                <span className={styles.filePathValidationError}>{exePathError}</span>
              )}
              {exePathResolvedPath && !exePathError && (
                <span className={styles.filePathResolvedPath}>
                  {exePathResolvedPath}
                </span>
              )}
            </div>
          </div>

          {/* Process status & manual restart */}
          {isExeConfigured && (
            <div className={styles.syncStatusBox}>
              <div className={styles.syncStatusRow}>
                <span className={styles.syncStatusLabel}>Process</span>
                {processRunning === null ? (
                  <span className={styles.syncStatusNeutral}>Unknown</span>
                ) : processRunning ? (
                  <span className={styles.syncStatusOk}>Running</span>
                ) : (
                  <span className={styles.syncStatusNeutral}>Not running</span>
                )}
              </div>

              <div className={styles.syncActions}>
                <button
                  type="button"
                  className={styles.forceRewriteButton}
                  onClick={handleManualRestart}
                  disabled={isRestarting}
                >
                  {isRestarting ? 'Restarting...' : 'Restart'}
                </button>
                {restartMessage && (
                  <span className={styles.syncActionMessage}>{restartMessage}</span>
                )}
              </div>

              <p className={styles.hint}>
                Process auto-restarts when voice agent is changed.
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

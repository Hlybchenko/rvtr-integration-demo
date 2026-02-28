import { useCallback, useEffect, useRef, useState } from 'react';
import { devices, preloadDeviceFrameImages } from '@/config/devices';
import { warmDetectScreenRect } from '@/hooks/useDetectScreenRect';
import { useSettingsStore, type VoiceAgent } from '@/stores/settingsStore';
import { useUeControlStore } from '@/stores/ueControlStore';
import { useStatusStore } from '@/stores/statusStore';
import { useStreamingStore } from '@/stores/streamingStore';
import {
  forceRewriteVoiceAgentFile,
  readVoiceAgentFromFile,
  setWriterFilePath,
  getWriterConfig,
  browseForFile,
  setGlobalExePath,
  browseForExe,
  startProcess,
  restartProcess,
} from '@/services/voiceAgentWriter';
import { isValidUrl } from '@/utils/isValidUrl';
import styles from './OverviewPage.module.css';

const IS_WINDOWS =
  typeof navigator !== 'undefined' &&
  (/win/i.test(navigator.userAgent) ||
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ===
      'Windows');

interface DeviceField {
  id: 'phone' | 'laptop';
  label: string;
  placeholder: string;
}

const WIDGET_DEVICES: DeviceField[] = [
  { id: 'phone', label: 'Phone', placeholder: 'https://widget.example.com/phone' },
  { id: 'laptop', label: 'Laptop', placeholder: 'https://widget.example.com/laptop' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OverviewPage() {
  const phoneUrl = useSettingsStore((s) => s.phoneUrl);
  const laptopUrl = useSettingsStore((s) => s.laptopUrl);
  const pixelStreamingUrl = useSettingsStore((s) => s.pixelStreamingUrl);
  const voiceAgent = useSettingsStore((s) => s.voiceAgent);
  const licenseFilePath = useSettingsStore((s) => s.licenseFilePath);
  const storeExePath = useSettingsStore((s) => s.exePath);
  const setDeviceUrl = useSettingsStore((s) => s.setDeviceUrl);
  const setPixelStreamingUrl = useSettingsStore((s) => s.setPixelStreamingUrl);
  const setVoiceAgent = useSettingsStore((s) => s.setVoiceAgent);
  const setLicenseFilePath = useSettingsStore((s) => s.setLicenseFilePath);
  const setExePathStore = useSettingsStore((s) => s.setExePath);

  // -- backend connectivity --
  const [backendError, setBackendError] = useState<string | null>(null);

  // -- file path state --
  const [filePathInput, setFilePathInput] = useState(licenseFilePath);
  const [isFilePathSaving, setIsFilePathSaving] = useState(false);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [filePathSaved, setFilePathSaved] = useState(!!licenseFilePath);
  const [filePathError, setFilePathError] = useState<string | null>(null);
  const [filePathResolvedPath, setFilePathResolvedPath] = useState<string | null>(null);

  // -- exe path state --
  const [exePathInput, setExePathInput] = useState(storeExePath);
  const [isExeSaving, setIsExeSaving] = useState(false);
  const [isExeBrowsing, setIsExeBrowsing] = useState(false);
  const [exePathSaved, setExePathSaved] = useState(!!storeExePath);
  const [exePathError, setExePathError] = useState<string | null>(null);
  const [exePathResolvedPath, setExePathResolvedPath] = useState<string | null>(null);

  // -- pixel streaming URL local state --
  const [psUrlInput, setPsUrlInput] = useState(pixelStreamingUrl);

  // -- voice agent state --
  const [pendingVoiceAgent, setPendingVoiceAgent] = useState<VoiceAgent>(voiceAgent);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // -- process start/restart --
  const [isStartingProcess, setIsStartingProcess] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);

  // -- UE API URL state (health stored centrally in ueControlStore) --
  const ueApiUrl = useUeControlStore((s) => s.ueApiUrl);
  const setUeApiUrl = useUeControlStore((s) => s.setUeApiUrl);
  const ueReachable = useUeControlStore((s) => s.ueReachable);
  const setUeReachable = useUeControlStore((s) => s.setUeReachable);
  const [ueApiUrlInput, setUeApiUrlInput] = useState(ueApiUrl);

  // -- global status (polling runs in AppShell) --
  const processRunning = useStatusStore((s) => s.processRunning);
  const psReachable = useStatusStore((s) => s.psReachable);

  // -- streaming connection --
  const psConnected = useStreamingStore((s) => s.connected);
  const psConnect = useStreamingStore((s) => s.connect);
  const psDisconnect = useStreamingStore((s) => s.disconnect);

  // Timer for auto-reconnect PS after agent change — cleaned up on unmount
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  const valuesByDevice: Record<'phone' | 'laptop', string> = {
    phone: phoneUrl,
    laptop: laptopUrl,
  };

  const isFileConfigured = filePathSaved && !filePathError;
  const isExeConfigured = exePathSaved && !exePathError;

  // Block-level validation for Widget
  const widgetHasError = WIDGET_DEVICES.some((d) => {
    const v = valuesByDevice[d.id];
    return v.trim().length > 0 && !isValidUrl(v);
  });
  const widgetAllGood = WIDGET_DEVICES.every((d) => {
    const v = valuesByDevice[d.id];
    return v.trim().length > 0 && isValidUrl(v);
  });

  // Pixel Streaming URL validation
  const psHasUrl = psUrlInput.trim().length > 0;
  const psUrlValid = !psHasUrl || isValidUrl(psUrlInput);
  const psHasError = psHasUrl && !psUrlValid;
  const psAllGood = psHasUrl && psUrlValid;

  // -- preload device assets --
  useEffect(() => {
    preloadDeviceFrameImages();
    devices.forEach((device) => {
      if (!device.autoDetectScreen) return;
      warmDetectScreenRect(device.frameSrc);
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Init effect
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const cfg = await getWriterConfig();
        if (cancelled) return;
        setBackendError(null);

        // License file path
        const backendLicensePath = cfg.licenseFilePath || '';
        const effectiveLicensePath = backendLicensePath || licenseFilePath;

        if (effectiveLicensePath) {
          setFilePathInput(effectiveLicensePath);
          setFilePathResolvedPath(effectiveLicensePath);

          if (!backendLicensePath && licenseFilePath) {
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

        // Exe path
        const backendExePath = cfg.exePath || '';
        const effectiveExePath = backendExePath || storeExePath;
        if (effectiveExePath) {
          setExePathInput(effectiveExePath);
          setExePathResolvedPath(effectiveExePath);

          if (!backendExePath && storeExePath) {
            const result = await setGlobalExePath(storeExePath);
            if (cancelled) return;
            if (result.ok) {
              setExePathStore(result.resolvedPath ?? storeExePath);
              setExePathSaved(true);
            } else {
              setExePathError(result.error ?? 'Previously saved path no longer exists');
              setExePathSaved(false);
            }
          } else if (backendExePath) {
            setExePathStore(backendExePath);
            setExePathSaved(true);
          }
        }

        // Pixel Streaming URL
        const backendPsUrl = cfg.pixelStreamingUrl || '';
        if (backendPsUrl) {
          setPsUrlInput(backendPsUrl);
          setPixelStreamingUrl(backendPsUrl);
        }

        if (cancelled) return;
      } catch (err) {
        if (cancelled) return;
        setBackendError(
          `Local server unavailable. Start the backend service and reload.${err instanceof Error ? ` (${err.message})` : ''}`,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- sync pendingVoiceAgent from file on mount --
  useEffect(() => {
    if (!isFileConfigured) return;
    let cancelled = false;

    void readVoiceAgentFromFile()
      .then((result) => {
        if (cancelled || !result.configured || !result.voiceAgent) return;
        setPendingVoiceAgent(result.voiceAgent);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isFileConfigured]);

  const hasPendingAgentChange = pendingVoiceAgent !== voiceAgent;

  // -- debounced auto-save for license file path --
  useEffect(() => {
    const trimmed = filePathInput.trim();
    if (!trimmed || filePathSaved || isFilePathSaving || isBrowsing || filePathError)
      return;

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

  // -- debounced auto-save for exe path --
  useEffect(() => {
    const trimmed = exePathInput.trim();
    if (!trimmed || exePathSaved || isExeSaving || isExeBrowsing || exePathError) return;

    const timer = setTimeout(() => {
      void (async () => {
        setIsExeSaving(true);
        setExePathError(null);
        setExePathResolvedPath(null);

        try {
          const result = await setGlobalExePath(trimmed);
          if (!result.ok) {
            setExePathError(result.error ?? 'Path not found or not executable');
            setExePathSaved(false);
          } else {
            setExePathStore(result.resolvedPath ?? trimmed);
            setExePathResolvedPath(result.resolvedPath ?? null);
            setExePathSaved(true);
            setExePathError(null);
          }
        } catch (error) {
          setExePathError(error instanceof Error ? error.message : String(error));
          setExePathSaved(false);
        } finally {
          setIsExeSaving(false);
        }
      })();
    }, 400);

    return () => clearTimeout(timer);
  }, [exePathInput, exePathSaved, isExeSaving, isExeBrowsing, exePathError, setExePathStore]);

  // -- debounced auto-save for Pixel Streaming URL --
  useEffect(() => {
    const trimmed = psUrlInput.trim();
    if (!trimmed || trimmed === pixelStreamingUrl) return;
    if (!isValidUrl(trimmed)) return;

    const timer = setTimeout(() => {
      setPixelStreamingUrl(trimmed);
    }, 400);

    return () => clearTimeout(timer);
  }, [psUrlInput, pixelStreamingUrl, setPixelStreamingUrl]);

  // -- debounced auto-save for UE API URL --
  // Allows clearing (empty string) or setting a valid URL
  useEffect(() => {
    const trimmed = ueApiUrlInput.trim();
    if (trimmed === ueApiUrl) return;
    // Allow empty (clear) or valid URL only
    if (trimmed && !isValidUrl(trimmed)) return;

    const timer = setTimeout(() => {
      setUeApiUrl(trimmed);
      if (!trimmed) setUeReachable(null);
    }, 400);

    return () => clearTimeout(timer);
  }, [ueApiUrlInput, ueApiUrl, setUeApiUrl, setUeReachable]);

  // -- handlers --

  const handleApplyAgent = useCallback(async () => {
    if (!isFileConfigured) return;
    setIsApplying(true);
    setApplyError(null);

    try {
      const result = await forceRewriteVoiceAgentFile(pendingVoiceAgent);

      if (result.matched) {
        setVoiceAgent(pendingVoiceAgent);

        // Restart process after applying agent change
        if (isExeConfigured) {
          try {
            const restart = await restartProcess();
            if (!restart.ok) {
              setApplyError(
                `Agent applied, but process restart failed: ${restart.error ?? 'unknown error'}`,
              );
            }
          } catch (err) {
            setApplyError(
              `Agent applied, but process restart failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        // Auto-reconnect Pixel Streaming when agent provider changes
        if (psConnected) {
          // Cancel any pending reconnect from a previous Apply click
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          psDisconnect();
          reconnectTimerRef.current = setTimeout(() => psConnect(), 300);
        }
      } else {
        setApplyError('Agent config saved, but file verification failed. Try applying again.');
      }
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsApplying(false);
    }
  }, [pendingVoiceAgent, isFileConfigured, isExeConfigured, setVoiceAgent, psConnected, psConnect, psDisconnect]);

  const handleBrowse = useCallback(async () => {
    setIsBrowsing(true);
    setFilePathError(null);

    try {
      const result = await browseForFile();
      if (result.cancelled) return;

      if (!result.licenseFilePath) {
        setFilePathError(
          result.errors.join('; ') || 'File picker failed. Try again or enter the path manually.',
        );
        return;
      }

      setFilePathInput(result.licenseFilePath);

      if (result.valid) {
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
        setFilePathError(result.errors.join('; ') || 'Selected file is not a valid license file');
        setFilePathSaved(false);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (error instanceof DOMException && error.name === 'AbortError') {
        setFilePathError('Browse timed out — the local server may be unresponsive');
      } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setFilePathError('Cannot reach the local server. Make sure the backend is running.');
      } else {
        setFilePathError(msg);
      }
    } finally {
      setIsBrowsing(false);
    }
  }, [setLicenseFilePath]);

  const handleBrowseExe = useCallback(async () => {
    setIsExeBrowsing(true);
    setExePathError(null);

    try {
      const result = await browseForExe();
      if (result.cancelled) return;

      if (!result.exePath) {
        setExePathError(result.errors.join('; ') || 'File picker failed. Try again or enter the path manually.');
        return;
      }

      setExePathInput(result.exePath);

      if (result.valid) {
        const saveResult = await setGlobalExePath(result.exePath);
        if (saveResult.ok) {
          setExePathStore(saveResult.resolvedPath ?? result.exePath);
          setExePathResolvedPath(saveResult.resolvedPath ?? result.exePath);
          setExePathSaved(true);
          setExePathError(null);
        } else {
          setExePathError(saveResult.error ?? 'Could not save — file may be missing or inaccessible');
          setExePathSaved(false);
        }
      } else {
        setExePathError(result.errors.join('; ') || 'Selected file is not a valid executable');
        setExePathSaved(false);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (error instanceof DOMException && error.name === 'AbortError') {
        setExePathError('Browse timed out');
      } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setExePathError('Cannot reach the local server. Make sure the backend is running.');
      } else {
        setExePathError(msg);
      }
    } finally {
      setIsExeBrowsing(false);
    }
  }, [setExePathStore]);

  const handleStartProcess = useCallback(async () => {
    if (!isExeConfigured) return;
    setIsStartingProcess(true);
    setProcessError(null);

    try {
      const result = processRunning
        ? await restartProcess()
        : await startProcess(storeExePath);

      if (!result.ok) {
        setProcessError(result.error ?? 'Failed to start process');
      }
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsStartingProcess(false);
    }
  }, [isExeConfigured, processRunning, storeExePath]);

  // Determine Voice Agent block validation state
  const voiceAgentHasError = !!filePathError || !!exePathError;

  return (
    <div className={styles.settings}>
      {backendError && (
        <div className={styles.backendErrorBanner}>
          <span>{backendError}</span>
        </div>
      )}

      <div className={styles.form}>
        {/* -- Left column: Voice Agent + Widget -- */}
        <div className={styles.column}>
          {/* -- Process (License + Executable) -- */}
          <section
            className={`${styles.settingsBlock} ${
              voiceAgentHasError
                ? styles.settingsBlockError
                : isFileConfigured && isExeConfigured
                  ? styles.settingsBlockValid
                  : ''
            }`}
          >
            <h2 className={styles.settingsBlockTitle}>Process</h2>

            {/* License file path */}
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
                    ✗ Path not found
                  </span>
                )}
              </div>

              <div className={styles.filePathRow}>
                <input
                  id="license-file-path"
                  className={`${styles.input} ${filePathError ? styles.inputError : ''}`}
                  type="text"
                  placeholder={IS_WINDOWS ? 'C:\\Path\\To\\license.lic' : '/path/to/license.lic'}
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
                  onClick={() => void handleBrowse()}
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
                  <span className={styles.filePathResolvedPath}>{filePathResolvedPath}</span>
                )}
              </div>
            </div>

            {/* Executable path */}
            <div className={styles.field}>
              <div className={styles.fieldHeader}>
                <label className={styles.label} htmlFor="exe-path">
                  Executable
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
                {/* Process status badge */}
                {processRunning === true && (
                  <span className={`${styles.badge} ${styles.badgeRunning}`}>
                    ● Running
                  </span>
                )}
                {processRunning === false && isExeConfigured && (
                  <span className={`${styles.badge} ${styles.badgeStopped}`}>
                    ○ Stopped
                  </span>
                )}
              </div>

              <div className={styles.filePathRow}>
                <input
                  id="exe-path"
                  className={`${styles.input} ${exePathError ? styles.inputError : ''}`}
                  type="text"
                  placeholder={IS_WINDOWS ? 'C:\\Path\\To\\start2stream.bat' : '/path/to/start2stream.sh'}
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
                  onClick={() => void handleBrowseExe()}
                  disabled={isExeBrowsing || isExeSaving}
                >
                  {isExeBrowsing ? 'Browsing...' : 'Browse'}
                </button>
              </div>

              <div className={styles.filePathValidation}>
                {exePathError && (
                  <span className={styles.filePathValidationError}>{exePathError}</span>
                )}
                {exePathResolvedPath && !exePathError && (
                  <span className={styles.filePathResolvedPath}>{exePathResolvedPath}</span>
                )}
              </div>
            </div>

            {/* Start / Restart button */}
            <div className={styles.processActions}>
              <button
                type="button"
                className={styles.applyButton}
                onClick={() => void handleStartProcess()}
                disabled={!isExeConfigured || isStartingProcess}
              >
                {isStartingProcess
                  ? 'Starting...'
                  : processRunning
                    ? 'Restart'
                    : 'Start'}
              </button>
            </div>

            {processError && <p className={styles.filePathValidationError}>{processError}</p>}
          </section>

          {/* -- Agent Provider -- */}
          <section
            className={`${styles.settingsBlock} ${
              isFileConfigured && hasPendingAgentChange
                ? styles.settingsBlockError
                : isFileConfigured && !hasPendingAgentChange && voiceAgent
                  ? styles.settingsBlockValid
                  : ''
            }`}
          >
            <h2 className={styles.settingsBlockTitle}>Agent Provider</h2>

            {/* Voice agent selector */}
            <div className={styles.fieldHeader}>
              <label className={styles.label}>Provider</label>
              {isFileConfigured && !hasPendingAgentChange && voiceAgent && (
                <span className={`${styles.badge} ${styles.badgeValid}`}>✓ Applied</span>
              )}
              {isFileConfigured && hasPendingAgentChange && (
                <span className={`${styles.badge} ${styles.badgeInvalid}`}>Unsaved changes</span>
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
              onClick={() => void handleApplyAgent()}
              disabled={!isFileConfigured || isApplying || !hasPendingAgentChange}
            >
              {isApplying ? 'Applying...' : 'Apply & restart'}
            </button>

            {applyError && <p className={styles.filePathValidationError}>{applyError}</p>}
          </section>
        </div>

        {/* -- Right column: Widget + Pixel Streaming -- */}
        <div className={styles.column}>
          {/* -- Widget: Phone + Laptop -- */}
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
                    hasError ? styles.deviceCardError : allGood ? styles.deviceCardValid : ''
                  }`}
                >
                  <h3 className={styles.deviceCardTitle}>{field.label}</h3>
                  <div className={styles.field}>
                    <div className={styles.fieldHeader}>
                      <label className={styles.label} htmlFor={`${field.id}-url`}>URL</label>
                      {hasUrl && (
                        <span className={`${styles.badge} ${urlValid ? styles.badgeValid : styles.badgeInvalid}`}>
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

          {/* -- Pixel Streaming -- */}
          <section
            className={`${styles.settingsBlock} ${
              psHasError
                ? styles.settingsBlockError
                : psAllGood
                  ? styles.settingsBlockValid
                  : ''
            }`}
          >
            <h2 className={styles.settingsBlockTitle}>Pixel Streaming</h2>

            <div className={styles.field}>
              <div className={styles.fieldHeader}>
                <label className={styles.label} htmlFor="pixel-streaming-url">URL</label>
                {psHasUrl && (
                  <span className={`${styles.badge} ${psUrlValid ? styles.badgeValid : styles.badgeInvalid}`}>
                    {psUrlValid ? '✓ Valid' : '✗ Invalid URL'}
                  </span>
                )}
                {/* PS server reachability badge */}
                {psReachable === true && psAllGood && (
                  <span className={`${styles.badge} ${styles.badgeRunning}`}>● Reachable</span>
                )}
                {psReachable === false && psAllGood && (
                  <span className={`${styles.badge} ${styles.badgeStopped}`}>○ Not responding</span>
                )}
              </div>
              <input
                id="pixel-streaming-url"
                className={`${styles.input} ${psHasError ? styles.inputError : ''}`}
                type="url"
                placeholder="https://stream.example.com"
                value={psUrlInput}
                onChange={(e) => setPsUrlInput(e.target.value)}
                spellCheck={false}
                autoComplete="url"
              />
              <div className={styles.connectRow}>
                <button
                  type="button"
                  className={`${styles.connectButton} ${psConnected ? styles.connectButtonDisconnect : ''}`}
                  onClick={() => (psConnected ? psDisconnect() : psConnect())}
                  disabled={!psAllGood}
                >
                  {psConnected ? 'Disconnect' : 'Connect'}
                </button>
                {psConnected && (
                  <span className={`${styles.badge} ${styles.badgeRunning}`}>● Session active</span>
                )}
              </div>
              <p className={styles.hint}>
                Shared URL for all streaming devices. Session persists across page navigation.
              </p>
            </div>

            {/* UE Remote API URL */}
            <div className={styles.field}>
              <div className={styles.fieldHeader}>
                <label className={styles.label} htmlFor="ue-api-url">UE Remote API</label>
                {ueApiUrlInput.trim() && isValidUrl(ueApiUrlInput) && (
                  <span className={`${styles.badge} ${styles.badgeValid}`}>
                    ✓ Valid
                  </span>
                )}
                {ueApiUrlInput.trim() && !isValidUrl(ueApiUrlInput) && (
                  <span className={`${styles.badge} ${styles.badgeInvalid}`}>
                    ✗ Invalid URL
                  </span>
                )}
                {ueReachable === true && ueApiUrl && (
                  <span className={`${styles.badge} ${styles.badgeRunning}`}>● Reachable</span>
                )}
                {ueReachable === false && ueApiUrl && (
                  <span className={`${styles.badge} ${styles.badgeStopped}`}>○ Not responding</span>
                )}
              </div>
              <input
                id="ue-api-url"
                className={`${styles.input} ${ueApiUrlInput.trim() && !isValidUrl(ueApiUrlInput) ? styles.inputError : ''}`}
                type="url"
                placeholder="http://127.0.0.1:8081"
                value={ueApiUrlInput}
                onChange={(e) => setUeApiUrlInput(e.target.value)}
                spellCheck={false}
                autoComplete="url"
              />
              <p className={styles.hint}>
                UE app built-in HTTP server for runtime control (camera, levels, avatars).
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

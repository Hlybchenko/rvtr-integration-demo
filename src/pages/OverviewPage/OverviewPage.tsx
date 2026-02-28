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
  restartProcess,
} from '@/services/voiceAgentWriter';
import { isValidUrl } from '@/utils/isValidUrl';
import { SetupStepper, type StepConfig } from '@/components/SetupStepper/SetupStepper';
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

  // -- Step 5: Start process --
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [startCountdown, setStartCountdown] = useState(0);
  const [needsRestart, setNeedsRestart] = useState(false);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Timer for auto-reconnect PS after agent change — cleaned up on unmount
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
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

  // Agent applied state (step 3 complete)
  const isAgentApplied = isFileConfigured && !hasPendingAgentChange && !!voiceAgent;

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
  useEffect(() => {
    const trimmed = ueApiUrlInput.trim();
    if (trimmed === ueApiUrl) return;
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

        // Flag restart needed if process was already running
        if (isExeConfigured && processRunning === true) {
          setNeedsRestart(true);
        }

        // Auto-reconnect Pixel Streaming when agent provider changes
        if (psConnected) {
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
  }, [pendingVoiceAgent, isFileConfigured, isExeConfigured, processRunning, setVoiceAgent, psConnected, psConnect, psDisconnect, setNeedsRestart]);

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

  // -- Step 5: Start / Restart process --
  const handleStartProcess = useCallback(async () => {
    setIsStarting(true);
    setStartError(null);
    setStartCountdown(5);

    // Clean up any previous countdown
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);

    const startTime = Date.now();
    countdownTimerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const remaining = Math.max(0, 5 - elapsed);
      setStartCountdown(remaining);
      if (remaining <= 0 && countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    }, 500);

    try {
      const result = await restartProcess();
      if (!result.ok) {
        setStartError(`Process start failed: ${result.error ?? 'unknown error'}`);
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
        setStartCountdown(0);
        setIsStarting(false);
        return;
      }

      // Wait remaining time from the 5s window (minus time already spent on restartProcess)
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 5000 - elapsed);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));

      // Clear restart-needed flag after successful (re)start
      setNeedsRestart(false);
    } catch (err) {
      setStartError(`Process start failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
      setStartCountdown(0);
      setIsStarting(false);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Stepper step configs
  // -------------------------------------------------------------------------

  const isUrlsConfigured = psAllGood; // PS URL is required; UE is optional
  const isProcessReady = processRunning === true;

  const steps: StepConfig[] = [
    // Step 1: License file
    {
      label: 'License file',
      summary: isFileConfigured ? (filePathResolvedPath ?? filePathInput) : undefined,
      isComplete: !!isFileConfigured,
      isLocked: false,
      content: (
        <div className={styles.field}>
          <div className={styles.fieldHeader}>
            <label className={styles.label} htmlFor="license-file-path">
              Path to license file
            </label>
            {filePathSaved && !filePathError && (
              <span className={`${styles.badge} ${styles.badgeValid}`}>Configured</span>
            )}
            {filePathError && (
              <span className={`${styles.badge} ${styles.badgeInvalid}`}>Path not found</span>
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
      ),
    },

    // Step 2: Executable
    {
      label: 'Executable',
      summary: isExeConfigured ? (exePathResolvedPath ?? exePathInput) : undefined,
      isComplete: !!isExeConfigured,
      isLocked: !isFileConfigured,
      content: (
        <div className={styles.field}>
          <div className={styles.fieldHeader}>
            <label className={styles.label} htmlFor="exe-path">
              Path to start2stream executable
            </label>
            {exePathSaved && !exePathError && (
              <span className={`${styles.badge} ${styles.badgeValid}`}>Configured</span>
            )}
            {exePathError && (
              <span className={`${styles.badge} ${styles.badgeInvalid}`}>Invalid</span>
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
      ),
    },

    // Step 3: Agent provider
    {
      label: 'Agent provider',
      summary: isAgentApplied ? voiceAgent : undefined,
      isComplete: isAgentApplied,
      isLocked: !isExeConfigured,
      content: (
        <>
          <div className={styles.fieldHeader}>
            <label className={styles.label}>Select voice agent</label>
            {isFileConfigured && !hasPendingAgentChange && voiceAgent && (
              <span className={`${styles.badge} ${styles.badgeValid}`}>Applied</span>
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
            {isApplying ? 'Applying...' : 'Apply'}
          </button>

          {applyError && <p className={styles.filePathValidationError}>{applyError}</p>}
        </>
      ),
    },

    // Step 4: Streaming URLs
    {
      label: 'Streaming URLs',
      summary: isUrlsConfigured ? psUrlInput : undefined,
      isComplete: isUrlsConfigured,
      isLocked: !isAgentApplied,
      content: (
        <>
          {/* Pixel Streaming URL */}
          <div className={styles.field}>
            <div className={styles.fieldHeader}>
              <label className={styles.label} htmlFor="pixel-streaming-url">
                Pixel Streaming URL
              </label>
              {psHasUrl && (
                <span className={`${styles.badge} ${psUrlValid ? styles.badgeValid : styles.badgeInvalid}`}>
                  {psUrlValid ? 'Valid' : 'Invalid URL'}
                </span>
              )}
              {psReachable === true && psAllGood && (
                <span className={`${styles.badge} ${styles.badgeRunning}`}>Reachable</span>
              )}
              {psReachable === false && psAllGood && (
                <span className={`${styles.badge} ${styles.badgeStopped}`}>Not responding</span>
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
          </div>

          {/* UE Remote API URL */}
          <div className={styles.field}>
            <div className={styles.fieldHeader}>
              <label className={styles.label} htmlFor="ue-api-url">
                UE Remote API
              </label>
              {ueApiUrlInput.trim() && isValidUrl(ueApiUrlInput) && (
                <span className={`${styles.badge} ${styles.badgeValid}`}>Valid</span>
              )}
              {ueApiUrlInput.trim() && !isValidUrl(ueApiUrlInput) && (
                <span className={`${styles.badge} ${styles.badgeInvalid}`}>Invalid URL</span>
              )}
              {ueReachable === true && ueApiUrl && (
                <span className={`${styles.badge} ${styles.badgeRunning}`}>Reachable</span>
              )}
              {ueReachable === false && ueApiUrl && (
                <span className={`${styles.badge} ${styles.badgeStopped}`}>Not responding</span>
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
              Optional. UE HTTP server for runtime control (camera, levels, avatars).
            </p>
          </div>
        </>
      ),
    },

    // Step 5: Start process
    {
      label: 'Start process',
      summary: needsRestart
        ? 'Restart required'
        : isProcessReady
          ? 'Running'
          : undefined,
      isComplete: isProcessReady && !needsRestart,
      isLocked: !isUrlsConfigured,
      content: (
        <div className={styles.startStepContent}>
          {needsRestart && (
            <p className={styles.hint}>
              Agent provider changed. Restart the process to apply the new configuration.
            </p>
          )}
          {!needsRestart && (
            <p className={styles.hint}>
              Launch the start2stream executable. The process needs a few seconds to initialize.
            </p>
          )}
          <div className={styles.connectRow}>
            <button
              type="button"
              className={styles.applyButton}
              onClick={() => void handleStartProcess()}
              disabled={isStarting}
            >
              {isStarting
                ? `Starting... ${startCountdown > 0 ? `(${startCountdown}s)` : ''}`
                : needsRestart || processRunning === true
                  ? 'Restart'
                  : 'Start'}
            </button>
            {needsRestart && (
              <span className={`${styles.badge} ${styles.badgeInvalid}`}>Restart required</span>
            )}
            {!needsRestart && processRunning === true && (
              <span className={`${styles.badge} ${styles.badgeRunning}`}>Running</span>
            )}
            {!needsRestart && processRunning === false && (
              <span className={`${styles.badge} ${styles.badgeStopped}`}>Stopped</span>
            )}
          </div>
          {startError && <p className={styles.filePathValidationError}>{startError}</p>}
        </div>
      ),
    },

    // Step 6: Connect PS
    {
      label: 'Connect',
      summary: psConnected ? 'Session active' : undefined,
      isComplete: psConnected,
      isLocked: !isProcessReady,
      content: (
        <div className={styles.startStepContent}>
          <p className={styles.hint}>
            Mount the Pixel Streaming session. It persists across device page navigation.
          </p>
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
              <span className={`${styles.badge} ${styles.badgeRunning}`}>Session active</span>
            )}
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className={styles.settings}>
      {backendError && (
        <div className={styles.backendErrorBanner}>
          <span>{backendError}</span>
        </div>
      )}

      {/* Setup stepper */}
      <SetupStepper steps={steps} />

      {/* Widget URLs — separate section below stepper */}
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
                      {urlValid ? 'Valid' : 'Invalid URL'}
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
  );
}

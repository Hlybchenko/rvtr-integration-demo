import { useCallback, useEffect, useRef, useState } from 'react';
import { devices, preloadDeviceFrameImages } from '@/config/devices';
import { warmDetectScreenRect } from '@/hooks/useDetectScreenRect';
import { usePathConfig, type BrowseResult } from '@/hooks/usePathConfig';
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
  stopProcess,
  restartProcess,
} from '@/services/voiceAgentWriter';
import { isValidUrl } from '@/utils/isValidUrl';
import styles from './OverviewPage.module.css';

/**
 * Settings / overview page (route: `/`).
 *
 * This is the app's main configuration surface. It is divided into four sections
 * rendered in a two-column layout:
 *
 *   **Left column**
 *   1. Process — license file path + executable path + start/stop/restart controls.
 *   2. Agent Provider — select ElevenLabs or Gemini Live and apply to the config file.
 *
 *   **Right column**
 *   3. Widget — phone & laptop iframe URLs.
 *   4. Pixel Streaming — PS URL, UE Remote API URL (auto-connects when URL is set).
 *
 * Data flow:
 *   - Persisted settings live in `settingsStore` and `ueControlStore` (Zustand + localStorage).
 *   - Backend state (file paths, exe path) is synced to `agent-option-writer` on mount via
 *     `getWriterConfig()` and reconciled with the frontend store.
 *   - File/exe path inputs use debounced auto-save (400ms) to avoid excessive backend calls.
 */

const IS_WINDOWS =
  typeof navigator !== 'undefined' &&
  (/win/i.test(navigator.userAgent) ||
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ===
      'Windows');

/** Descriptor for a non-streaming (widget) device URL field. */
interface DeviceField {
  id: 'phone' | 'laptop';
  label: string;
  placeholder: string;
}

const WIDGET_DEVICES: DeviceField[] = [
  { id: 'phone', label: 'Phone', placeholder: 'https://widget.example.com/phone' },
  { id: 'laptop', label: 'Laptop', placeholder: 'https://widget.example.com/laptop' },
];

// ── Browse adapters ──────────────────────────────────────────────────────────
// Normalize browse results from voiceAgentWriter into the generic BrowseResult
// shape expected by usePathConfig.

async function browseForLicenseFile(): Promise<BrowseResult> {
  const r = await browseForFile();
  return { cancelled: r.cancelled, path: r.licenseFilePath, valid: r.valid, errors: r.errors };
}

async function browseForExeFile(): Promise<BrowseResult> {
  const r = await browseForExe();
  return { cancelled: r.cancelled, path: r.exePath, valid: r.valid, errors: r.errors };
}

// ── Component ────────────────────────────────────────────────────────────────

export function OverviewPage() {
  // ── Store selectors ──────────────────────────────────────────────────────
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

  // ── Path config hooks ──────────────────────────────────────────────────
  const filePath = usePathConfig({
    initialValue: licenseFilePath,
    onSaved: setLicenseFilePath,
    saveFn: setWriterFilePath,
    browseFn: browseForLicenseFile,
    notFoundMessage: 'Path not found or not readable',
  });

  const exePath = usePathConfig({
    initialValue: storeExePath,
    onSaved: setExePathStore,
    saveFn: setGlobalExePath,
    browseFn: browseForExeFile,
    notFoundMessage: 'Path not found or not executable',
  });

  // ── Local state ──────────────────────────────────────────────────────────
  const [backendError, setBackendError] = useState<string | null>(null);

  // -- pixel streaming URL local state --
  const [psUrlInput, setPsUrlInput] = useState(pixelStreamingUrl);
  // Tracks whether user has actively typed in the PS URL input.
  // Prevents Zustand hydration race from clearing the URL on mount.
  const psUrlDirtyRef = useRef(false);

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
  const ueUrlDirtyRef = useRef(false);

  // -- global status (polling runs in AppShell) --
  const processRunning = useStatusStore((s) => s.processRunning);
  const psReachable = useStatusStore((s) => s.psReachable);

  // -- streaming remount (used after voice agent change to rebuild iframe) --
  const psRemount = useStreamingStore((s) => s.remount);

  const valuesByDevice: Record<'phone' | 'laptop', string> = {
    phone: phoneUrl,
    laptop: laptopUrl,
  };

  const isFileConfigured = filePath.isConfigured;
  const isExeConfigured = exePath.isConfigured;

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

  // ── Side effects ─────────────────────────────────────────────────────────

  // Preload device frame images and warm screen-cutout detection cache
  useEffect(() => {
    preloadDeviceFrameImages();
    devices.forEach((device) => {
      if (!device.autoDetectScreen) return;
      warmDetectScreenRect(device.frameSrc);
    });
  }, []);

  // Reconcile frontend store with backend config on mount
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const cfg = await getWriterConfig();
        if (cancelled) return;
        setBackendError(null);

        // License file path — prefer backend value, fall back to store
        const backendLicensePath = cfg.licenseFilePath || '';
        const effectiveLicensePath = backendLicensePath || licenseFilePath;

        if (effectiveLicensePath) {
          if (!backendLicensePath && licenseFilePath) {
            const result = await setWriterFilePath(licenseFilePath);
            if (cancelled) return;
            if (result.ok) {
              setLicenseFilePath(result.resolvedPath ?? licenseFilePath);
              filePath.setFromBackend(effectiveLicensePath, true);
            } else {
              filePath.setFromBackend(
                effectiveLicensePath,
                false,
                result.error ?? 'Previously saved path no longer exists',
              );
            }
          } else {
            setLicenseFilePath(backendLicensePath);
            filePath.setFromBackend(effectiveLicensePath, true);
          }
        }

        // Exe path — prefer backend value, fall back to store
        const backendExePath = cfg.exePath || '';
        const effectiveExePath = backendExePath || storeExePath;
        if (effectiveExePath) {
          if (!backendExePath && storeExePath) {
            const result = await setGlobalExePath(storeExePath);
            if (cancelled) return;
            if (result.ok) {
              setExePathStore(result.resolvedPath ?? storeExePath);
              exePath.setFromBackend(effectiveExePath, true);
            } else {
              exePath.setFromBackend(
                effectiveExePath,
                false,
                result.error ?? 'Previously saved path no longer exists',
              );
            }
          } else if (backendExePath) {
            setExePathStore(backendExePath);
            exePath.setFromBackend(effectiveExePath, true);
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

  // Debounced auto-save for file/exe paths is handled by usePathConfig hooks above.

  // -- debounced auto-save for Pixel Streaming URL --
  // Allows clearing (empty string) only when user has actively typed (dirty).
  // Without the dirty guard, Zustand async hydration can race: psUrlInput starts
  // as '' while pixelStreamingUrl hydrates from localStorage, causing an unwanted clear.
  useEffect(() => {
    const trimmed = psUrlInput.trim();
    if (trimmed === pixelStreamingUrl) {
      psUrlDirtyRef.current = false;
      return;
    }
    // Allow clearing only from explicit user action, not hydration race
    if (!trimmed && !psUrlDirtyRef.current) return;
    if (trimmed && !isValidUrl(trimmed)) return;

    const timer = setTimeout(() => {
      setPixelStreamingUrl(trimmed);
      psUrlDirtyRef.current = false;
    }, 400);

    return () => clearTimeout(timer);
  }, [psUrlInput, pixelStreamingUrl, setPixelStreamingUrl]);

  // -- debounced auto-save for UE API URL --
  // Same dirty guard as PS URL above to prevent hydration race.
  useEffect(() => {
    const trimmed = ueApiUrlInput.trim();
    if (trimmed === ueApiUrl) {
      ueUrlDirtyRef.current = false;
      return;
    }
    if (!trimmed && !ueUrlDirtyRef.current) return;
    if (trimmed && !isValidUrl(trimmed)) return;

    const timer = setTimeout(() => {
      setUeApiUrl(trimmed);
      if (!trimmed) setUeReachable(null);
      ueUrlDirtyRef.current = false;
    }, 400);

    return () => clearTimeout(timer);
  }, [ueApiUrlInput, ueApiUrl, setUeApiUrl, setUeReachable]);

  // ── Handlers ─────────────────────────────────────────────────────────────

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

        // Force PS iframe remount so it picks up the new agent provider
        if (useSettingsStore.getState().pixelStreamingUrl) {
          psRemount();
        }
      } else {
        setApplyError('Agent config saved, but file verification failed. Try applying again.');
      }
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsApplying(false);
    }
  }, [pendingVoiceAgent, isFileConfigured, isExeConfigured, setVoiceAgent, psRemount]);

  // Browse handlers are now provided by usePathConfig (filePath.onBrowse, exePath.onBrowse).

  const handleStartProcess = useCallback(async () => {
    if (!isExeConfigured) return;
    setIsStartingProcess(true);
    setProcessError(null);

    try {
      const result = await startProcess(storeExePath);

      if (!result.ok) {
        setProcessError(result.error ?? 'Failed to start process');
      }
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsStartingProcess(false);
    }
  }, [isExeConfigured, storeExePath]);

  const handleStopProcess = useCallback(async () => {
    setIsStartingProcess(true);
    setProcessError(null);

    try {
      const result = await stopProcess();
      if (!result.ok) {
        setProcessError(result.error ?? 'Failed to stop process');
      }
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsStartingProcess(false);
    }
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  const voiceAgentHasError = !!filePath.error || !!exePath.error;

  return (
    <div className={styles.settings}>
      {backendError && (
        <div className={styles.backendErrorBanner}>
          <span>{backendError}</span>
        </div>
      )}

      <div className={styles.form}>
        {/* -- Left column: Process + Agent Provider -- */}
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
                {filePath.saved && !filePath.error && (
                  <span className={`${styles.badge} ${styles.badgeValid}`}>✓ Configured</span>
                )}
                {filePath.error && (
                  <span className={`${styles.badge} ${styles.badgeInvalid}`}>✗ Path not found</span>
                )}
              </div>

              <div className={styles.filePathRow}>
                <input
                  id="license-file-path"
                  className={`${styles.input} ${filePath.error ? styles.inputError : ''}`}
                  type="text"
                  placeholder={IS_WINDOWS ? 'C:\\Path\\To\\license.lic' : '/path/to/license.lic'}
                  value={filePath.input}
                  onChange={(e) => filePath.setInput(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className={styles.filePathAction}
                  onClick={() => void filePath.onBrowse()}
                  disabled={filePath.isBrowsing || filePath.isSaving}
                >
                  {filePath.isBrowsing ? 'Browsing...' : 'Browse'}
                </button>
              </div>

              <div className={styles.filePathValidation}>
                {filePath.error && (
                  <span className={styles.filePathValidationError}>{filePath.error}</span>
                )}
                {filePath.resolvedPath && !filePath.error && (
                  <span className={styles.filePathResolvedPath}>{filePath.resolvedPath}</span>
                )}
              </div>
            </div>

            {/* Executable path */}
            <div className={styles.field}>
              <div className={styles.fieldHeader}>
                <label className={styles.label} htmlFor="exe-path">
                  Executable
                </label>
                {exePath.saved && !exePath.error && (
                  <span className={`${styles.badge} ${styles.badgeValid}`}>✓ Configured</span>
                )}
                {exePath.error && (
                  <span className={`${styles.badge} ${styles.badgeInvalid}`}>✗ Invalid</span>
                )}
              </div>

              <div className={styles.filePathRow}>
                <input
                  id="exe-path"
                  className={`${styles.input} ${exePath.error ? styles.inputError : ''}`}
                  type="text"
                  placeholder={IS_WINDOWS ? 'C:\\Path\\To\\start2stream.bat' : '/path/to/start2stream.sh'}
                  value={exePath.input}
                  onChange={(e) => exePath.setInput(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className={styles.filePathAction}
                  onClick={() => void exePath.onBrowse()}
                  disabled={exePath.isBrowsing || exePath.isSaving}
                >
                  {exePath.isBrowsing ? 'Browsing...' : 'Browse'}
                </button>
              </div>

              <div className={styles.filePathValidation}>
                {exePath.error && (
                  <span className={styles.filePathValidationError}>{exePath.error}</span>
                )}
                {exePath.resolvedPath && !exePath.error && (
                  <span className={styles.filePathResolvedPath}>{exePath.resolvedPath}</span>
                )}
              </div>
            </div>

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
                  className={styles.radioInput}
                  checked={pendingVoiceAgent === 'elevenlabs'}
                  onChange={() => setPendingVoiceAgent('elevenlabs')}
                  disabled={!isFileConfigured || isApplying}
                />
                <span className={styles.radioMark} />
                <span>ElevenLabs</span>
              </label>

              <label className={styles.radioOption}>
                <input
                  type="radio"
                  name="voice-agent"
                  value="gemini-live"
                  className={styles.radioInput}
                  checked={pendingVoiceAgent === 'gemini-live'}
                  onChange={() => setPendingVoiceAgent('gemini-live')}
                  disabled={!isFileConfigured || isApplying}
                />
                <span className={styles.radioMark} />
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
                    className={`${styles.input} ${hasUrl && !urlValid ? styles.inputError : ''}`}
                    type="url"
                    placeholder={field.placeholder}
                    value={urlValue}
                    onChange={(e) => setDeviceUrl(field.id, e.target.value)}
                    spellCheck={false}
                    autoComplete="url"
                  />
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
              </div>
              <input
                id="pixel-streaming-url"
                className={`${styles.input} ${psHasError ? styles.inputError : ''}`}
                type="url"
                placeholder="https://stream.example.com"
                value={psUrlInput}
                onChange={(e) => { psUrlDirtyRef.current = true; setPsUrlInput(e.target.value); }}
                spellCheck={false}
                autoComplete="url"
              />
              {psAllGood && (psReachable === true || psReachable === false) && (
                <div className={styles.badgeRow}>
                  {psReachable === true && (
                    <span className={`${styles.badge} ${styles.badgeRunning}`}>Reachable</span>
                  )}
                  {psReachable === false && (
                    <span className={`${styles.badge} ${styles.badgeStopped}`}>Not responding</span>
                  )}
                </div>
              )}
            </div>

            {/* UE Remote API URL */}
            <div className={styles.field}>
              <div className={styles.fieldHeader}>
                <label className={styles.label} htmlFor="ue-api-url">UE Remote API</label>
                {ueApiUrlInput.trim() && isValidUrl(ueApiUrlInput) && (
                  <span className={`${styles.badge} ${styles.badgeValid}`}>✓ Valid</span>
                )}
                {ueApiUrlInput.trim() && !isValidUrl(ueApiUrlInput) && (
                  <span className={`${styles.badge} ${styles.badgeInvalid}`}>✗ Invalid URL</span>
                )}
              </div>
              <input
                id="ue-api-url"
                className={`${styles.input} ${ueApiUrlInput.trim() && !isValidUrl(ueApiUrlInput) ? styles.inputError : ''}`}
                type="url"
                placeholder="http://127.0.0.1:8081"
                value={ueApiUrlInput}
                onChange={(e) => { ueUrlDirtyRef.current = true; setUeApiUrlInput(e.target.value); }}
                spellCheck={false}
                autoComplete="url"
              />
              {ueApiUrl && (ueReachable === true || ueReachable === false) && (
                <div className={styles.badgeRow}>
                  {ueReachable === true && (
                    <span className={`${styles.badge} ${styles.badgeRunning}`}>Reachable</span>
                  )}
                  {ueReachable === false && (
                    <span className={`${styles.badge} ${styles.badgeStopped}`}>Not responding</span>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* -- Process launch bar (full width, below columns) -- */}
      <div className={styles.processLaunchBar}>
        <div className={styles.processLaunchActions}>
          {processRunning ? (
            <button
              type="button"
              className={styles.stopButtonLarge}
              onClick={() => void handleStopProcess()}
              disabled={isStartingProcess}
            >
              {isStartingProcess ? 'Stopping...' : 'Stop'}
            </button>
          ) : (
            <button
              type="button"
              className={styles.startButtonLarge}
              onClick={() => void handleStartProcess()}
              disabled={!isExeConfigured || isStartingProcess}
            >
              {isStartingProcess ? 'Starting...' : 'Start'}
            </button>
          )}
        </div>
        <span className={`${styles.processHint} ${processRunning ? styles.processHintRunning : ''}`}>
          {processRunning ? 'Process is running' : isExeConfigured ? 'Ready to launch' : 'Configure executable to start'}
        </span>
      </div>
      {processError && <p className={styles.filePathValidationError}>{processError}</p>}
    </div>
  );
}

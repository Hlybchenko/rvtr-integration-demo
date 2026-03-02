import { useCallback, useEffect, useState } from 'react';
import { devices, preloadDeviceFrameImages } from '@/config/devices';
import { warmDetectScreenRect } from '@/hooks/useDetectScreenRect';
import { usePathConfig, type BrowseResult } from '@/hooks/usePathConfig';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDebouncedUrlSave } from '@/hooks/useDebouncedUrlSave';
import { useBackendReconciliation } from '@/hooks/useBackendReconciliation';
import { useSettingsStore, type VoiceAgent } from '@/stores/settingsStore';
import { useUeControlStore } from '@/stores/ueControlStore';
import { useStatusStore } from '@/stores/statusStore';
import { useStreamingStore } from '@/stores/streamingStore';
import {
  forceRewriteVoiceAgentFile,
  setWriterFilePath,
  setGlobalExePath,
  browseForFile,
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

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const [pendingVoiceAgent, setPendingVoiceAgent] = useState<VoiceAgent>(voiceAgent);
  const [applyStep, setApplyStep] = useState<string | null>(null);

  // -- UE API URL state (health stored centrally in ueControlStore) --
  const ueApiUrl = useUeControlStore((s) => s.ueApiUrl);
  const setUeApiUrl = useUeControlStore((s) => s.setUeApiUrl);
  // UE health badges — disabled until backend provides a real ping endpoint
  // const ueReachable = useUeControlStore((s) => s.ueReachable);
  // const setUeReachable = useUeControlStore((s) => s.setUeReachable);

  // -- global status (polling runs in AppShell) --
  const processRunning = useStatusStore((s) => s.processRunning);
  const psReachable = useStatusStore((s) => s.psReachable);

  // -- streaming remount (used after voice agent change to rebuild iframe) --
  const psRemount = useStreamingStore((s) => s.remount);

  const isFileConfigured = filePath.isConfigured;
  const isExeConfigured = exePath.isConfigured;

  // ── Debounced URL saves ──────────────────────────────────────────────────
  const psUrl = useDebouncedUrlSave({ storeValue: pixelStreamingUrl, saveFn: setPixelStreamingUrl });
  const ueUrl = useDebouncedUrlSave({ storeValue: ueApiUrl, saveFn: setUeApiUrl });
  const phoneUrlSave = useDebouncedUrlSave({ storeValue: phoneUrl, saveFn: (url) => setDeviceUrl('phone', url) });
  const laptopUrlSave = useDebouncedUrlSave({ storeValue: laptopUrl, saveFn: (url) => setDeviceUrl('laptop', url) });

  const urlSaveByDevice: Record<'phone' | 'laptop', typeof phoneUrlSave> = {
    phone: phoneUrlSave,
    laptop: laptopUrlSave,
  };

  // ── Backend reconciliation ──────────────────────────────────────────────
  const { backendError } = useBackendReconciliation({
    filePath,
    exePath,
    licenseFilePath,
    setLicenseFilePath,
    storeExePath,
    setExePathStore,
    setPsUrlInput: psUrl.setInput,
    setPixelStreamingUrl,
    isFileConfigured,
    setPendingVoiceAgent,
  });

  // ── Validation ─────────────────────────────────────────────────────────
  const widgetHasError = WIDGET_DEVICES.some((d) => {
    const v = urlSaveByDevice[d.id].input;
    return v.trim().length > 0 && !isValidUrl(v);
  });
  const widgetAllGood = WIDGET_DEVICES.every((d) => {
    const v = urlSaveByDevice[d.id].input;
    return v.trim().length > 0 && isValidUrl(v);
  });

  const psHasUrl = psUrl.input.trim().length > 0;
  const psUrlValid = !psHasUrl || isValidUrl(psUrl.input);
  const psHasError = psHasUrl && !psUrlValid;
  const psAllGood = psHasUrl && psUrlValid;

  const hasPendingAgentChange = pendingVoiceAgent !== voiceAgent;

  // ── Side effects ─────────────────────────────────────────────────────────

  // Preload device frame images and warm screen-cutout detection cache
  useEffect(() => {
    preloadDeviceFrameImages();
    devices.forEach((device) => {
      if (!device.autoDetectScreen) return;
      warmDetectScreenRect(device.frameSrc);
    });
  }, []);

  // ── Async actions ──────────────────────────────────────────────────────

  const applyAction = useAsyncAction(
    useCallback(async () => {
      if (!isFileConfigured) return;

      setApplyStep('Writing agent config...');
      const result = await forceRewriteVoiceAgentFile(pendingVoiceAgent);
      await delay(1000);

      if (!result.matched) throw new Error('File verification failed. Try again.');
      setVoiceAgent(pendingVoiceAgent);

      if (isExeConfigured) {
        setApplyStep('Restarting process...');
        await delay(1000);
        const restart = await restartProcess();
        if (!restart.ok) throw new Error(`Restart failed: ${restart.error ?? 'unknown'}`);
      }

      if (useSettingsStore.getState().pixelStreamingUrl) {
        setApplyStep('Reconnecting stream...');
        await delay(1000);
        psRemount();
      }

      setApplyStep('Done');
      await delay(1000);
      setApplyStep(null);
    }, [isFileConfigured, isExeConfigured, pendingVoiceAgent, setVoiceAgent, psRemount]),
  );

  const startAction = useAsyncAction(
    useCallback(async () => {
      const r = await startProcess(storeExePath);
      if (!r.ok) throw new Error(r.error ?? 'Failed to start');
    }, [storeExePath]),
  );

  const stopAction = useAsyncAction(
    useCallback(async () => {
      const r = await stopProcess();
      if (!r.ok) throw new Error(r.error ?? 'Failed to stop');
    }, []),
  );

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
                  disabled={!isFileConfigured || applyAction.isRunning}
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
                  disabled={!isFileConfigured || applyAction.isRunning}
                />
                <span className={styles.radioMark} />
                <span>Gemini Live</span>
              </label>
            </div>

            {!isFileConfigured && (
              <p className={styles.disabledHint}>Configure a license file path above to enable agent selection</p>
            )}

            <button
              type="button"
              className={styles.applyButton}
              onClick={() => void applyAction.execute()}
              disabled={!isFileConfigured || applyAction.isRunning || !hasPendingAgentChange}
            >
              {applyAction.isRunning ? 'Applying...' : 'Apply & restart'}
            </button>

            {applyStep && (
              <div className={`${styles.applyProgress} ${applyStep === 'Done' ? styles.applyProgressDone : ''}`}>
                {applyStep}
              </div>
            )}

            {applyAction.error && <p className={styles.filePathValidationError}>{applyAction.error}</p>}
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
                className={`${styles.input} ${psHasError ? styles.inputError : ''} ${psUrl.isSaving ? styles.inputSaving : ''}`}
                type="url"
                placeholder="https://stream.example.com"
                value={psUrl.input}
                onChange={(e) => psUrl.setInput(e.target.value)}
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
                {ueUrl.input.trim() && isValidUrl(ueUrl.input) && (
                  <span className={`${styles.badge} ${styles.badgeValid}`}>✓ Valid</span>
                )}
                {ueUrl.input.trim() && !isValidUrl(ueUrl.input) && (
                  <span className={`${styles.badge} ${styles.badgeInvalid}`}>✗ Invalid URL</span>
                )}
              </div>
              <input
                id="ue-api-url"
                className={`${styles.input} ${ueUrl.input.trim() && !isValidUrl(ueUrl.input) ? styles.inputError : ''} ${ueUrl.isSaving ? styles.inputSaving : ''}`}
                type="url"
                placeholder="http://127.0.0.1:8081"
                value={ueUrl.input}
                onChange={(e) => ueUrl.setInput(e.target.value)}
                spellCheck={false}
                autoComplete="url"
              />
              {/* UE health badges — disabled until real ping endpoint exists
              {ueApiUrl && (ueReachable === true || ueReachable === false) && (
                <div className={styles.badgeRow}>
                  {ueReachable === true && (
                    <span className={`${styles.badge} ${styles.badgeRunning}`}>Reachable</span>
                  )}
                  {ueReachable === false && (
                    <span className={`${styles.badge} ${styles.badgeStopped}`}>Not responding</span>
                  )}
                </div>
              )} */}
            </div>
          </section>
        </div>
      </div>

      <div className={styles.processLaunchBar}>
        <div className={styles.processLaunchActions}>
          {processRunning ? (
            <button
              type="button"
              className={styles.stopButtonLarge}
              onClick={() => void stopAction.execute()}
              disabled={stopAction.isRunning}
            >
              {stopAction.isRunning ? 'Stopping...' : 'Stop'}
            </button>
          ) : (
            <button
              type="button"
              className={styles.startButtonLarge}
              onClick={() => void startAction.execute()}
              disabled={!isExeConfigured || startAction.isRunning}
            >
              {startAction.isRunning ? 'Starting...' : 'Start'}
            </button>
          )}
        </div>
        <span className={`${styles.processHint} ${processRunning ? styles.processHintRunning : ''}`}>
          {processRunning ? 'Process is running' : isExeConfigured ? 'Ready to launch' : 'Configure executable to start'}
        </span>
        {!isExeConfigured && !processRunning && (
          <span className={styles.disabledHint}>Set an executable path to enable launching</span>
        )}
      </div>
      {startAction.error && <p className={styles.filePathValidationError}>{startAction.error}</p>}
      {stopAction.error && <p className={styles.filePathValidationError}>{stopAction.error}</p>}
    </div>
  );
}

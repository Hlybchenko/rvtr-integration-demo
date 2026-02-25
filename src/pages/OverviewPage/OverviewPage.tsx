import { useEffect, useRef, useState } from 'react';
import { devices, preloadDeviceFrameImages } from '@/config/devices';
import { warmDetectScreenRect } from '@/hooks/useDetectScreenRect';
import { useSettingsStore, type DeviceId, type VoiceAgent } from '@/stores/settingsStore';
import {
  ensureVoiceAgentFileSync,
  forceRewriteVoiceAgentFile,
} from '@/services/voiceAgentWriter';
import styles from './OverviewPage.module.css';

const VOICE_AGENT_SYNC_DEBOUNCE_MS = 180;

const DEVICE_FIELDS: Array<{
  id: DeviceId;
  label: string;
  placeholder: string;
}> = [
  {
    id: 'phone',
    label: 'Phone',
    placeholder: 'https://your-phone-url.com',
  },
  {
    id: 'laptop',
    label: 'Laptop',
    placeholder: 'https://your-laptop-url.com',
  },
  {
    id: 'kiosk',
    label: 'Info Kiosk',
    placeholder: 'https://your-kiosk-url.com',
  },
  {
    id: 'keba-kiosk',
    label: 'Keba Kiosk',
    placeholder: 'https://your-keba-kiosk-url.com',
  },
  {
    id: 'holobox',
    label: 'Holobox',
    placeholder: 'https://your-holobox-url.com',
  },
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

export function OverviewPage() {
  const phoneUrl = useSettingsStore((s) => s.phoneUrl);
  const laptopUrl = useSettingsStore((s) => s.laptopUrl);
  const kioskUrl = useSettingsStore((s) => s.kioskUrl);
  const holoboxUrl = useSettingsStore((s) => s.holoboxUrl);
  const kebaKioskUrl = useSettingsStore((s) => s.kebaKioskUrl);
  const voiceAgent = useSettingsStore((s) => s.voiceAgent);
  const setDeviceUrl = useSettingsStore((s) => s.setDeviceUrl);
  const setVoiceAgent = useSettingsStore((s) => s.setVoiceAgent);
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

  const syncReasonTooltip = agentSyncError
    ? `Writer error: ${agentSyncError}`
    : isAgentSyncMatched === null
      ? 'Checking current value in target file'
      : fileVoiceAgent === null
        ? 'No valid voice_agent value found in target file (missing file, unreadable file, or invalid value)'
        : isAgentSyncMatched
          ? `File contains "${fileVoiceAgent}" and matches selected option`
          : `Mismatch: selected "${voiceAgent}", file contains "${fileVoiceAgent}"`;

  useEffect(() => {
    preloadDeviceFrameImages();

    devices.forEach((device) => {
      if (!device.autoDetectScreen) return;
      warmDetectScreenRect(device.frameSrc);
    });
  }, []);

  useEffect(() => {
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
  }, [voiceAgent]);

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
    } catch (error) {
      setIsAgentSyncMatched(false);
      setAgentSyncError(error instanceof Error ? error.message : String(error));
      setForceRewriteMessage('Force rewrite failed');
    } finally {
      setIsForceRewriting(false);
    }
  };

  return (
    <div className={styles.settings}>
      {/* <header className={styles.header}>
        <h1 className={styles.title}>
          <span className={styles.accent}>Settings</span>
        </h1>
        <p className={styles.subtitle}>
          Configure URL per device preview. Changes are saved automatically.
        </p>
      </header> */}

      <div className={styles.form}>
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

        <section className={styles.settingsBlock}>
          <div className={styles.fieldHeader}>
            <h2 className={styles.settingsBlockTitle}>Voice Agent</h2>
            {isAgentSyncMatched === null ? (
              <span
                className={`${styles.voiceAgentStatusIcon} ${styles.voiceAgentStatusNeutral}`}
                title={syncReasonTooltip}
                aria-label={syncReasonTooltip}
              >
                …
              </span>
            ) : isAgentSyncMatched ? (
              <span
                className={`${styles.voiceAgentStatusIcon} ${styles.voiceAgentStatusOk}`}
                title={syncReasonTooltip}
                aria-label={syncReasonTooltip}
              >
                ✓
              </span>
            ) : (
              <span
                className={`${styles.voiceAgentStatusIcon} ${styles.voiceAgentStatusError}`}
                title={syncReasonTooltip}
                aria-label={syncReasonTooltip}
              >
                ✗
              </span>
            )}
          </div>

          <div className={styles.radioGroup} role="radiogroup" aria-label="Voice agent">
            <label className={styles.radioOption}>
              <input
                type="radio"
                name="voice-agent"
                value="elevenlabs"
                checked={voiceAgent === 'elevenlabs'}
                onChange={() => setVoiceAgent('elevenlabs')}
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
              />
              <span>Gemini Live</span>
            </label>
          </div>

          <div className={styles.syncStatusBox}>
            <div className={styles.syncStatusRow}>
              <span className={styles.syncStatusLabel}>Sync status</span>
              {isAgentSyncMatched === null ? (
                <span className={styles.syncStatusNeutral}>Checking…</span>
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
                aria-label={syncReasonTooltip}
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
                {isForceRewriting ? 'Rewriting…' : 'Force rewrite'}
              </button>
              {forceRewriteMessage ? (
                <span className={styles.syncActionMessage}>{forceRewriteMessage}</span>
              ) : null}
            </div>

            {agentSyncError ? (
              <p className={styles.syncStatusErrorText}>{agentSyncError}</p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

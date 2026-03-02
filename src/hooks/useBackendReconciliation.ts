import { useEffect, useState } from 'react';
import type { PathConfigState } from '@/hooks/usePathConfig';
import type { VoiceAgent } from '@/stores/settingsStore';
import {
  getWriterConfig,
  setWriterFilePath,
  setGlobalExePath,
  readVoiceAgentFromFile,
} from '@/services/voiceAgentWriter';

export interface UseBackendReconciliationOptions {
  filePath: PathConfigState;
  exePath: PathConfigState;
  licenseFilePath: string;
  setLicenseFilePath: (path: string) => void;
  storeExePath: string;
  setExePathStore: (path: string) => void;
  setPsUrlInput: (url: string) => void;
  setPixelStreamingUrl: (url: string) => void;
  isFileConfigured: boolean;
  setPendingVoiceAgent: (agent: VoiceAgent) => void;
}

export function useBackendReconciliation({
  filePath,
  exePath,
  licenseFilePath,
  setLicenseFilePath,
  storeExePath,
  setExePathStore,
  setPsUrlInput,
  setPixelStreamingUrl,
  isFileConfigured,
  setPendingVoiceAgent,
}: UseBackendReconciliationOptions): { backendError: string | null } {
  const [backendError, setBackendError] = useState<string | null>(null);

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

  // Sync pendingVoiceAgent from file on mount
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
  }, [isFileConfigured, setPendingVoiceAgent]);

  return { backendError };
}

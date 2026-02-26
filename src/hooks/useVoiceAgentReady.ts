import { useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { readVoiceAgentFromFile } from '@/services/voiceAgentWriter';

/**
 * Returns `true` when:
 * 1. A license file path is configured (non-empty in store)
 * 2. The backend can read the file and extract a known voice agent value
 *
 * Polls once on mount and re-checks when `licenseFilePath` changes.
 */
export function useVoiceAgentReady(): boolean {
  const licenseFilePath = useSettingsStore((s) => s.licenseFilePath);
  const [ready, setReady] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!licenseFilePath) {
      setReady(false);
      return;
    }

    const id = ++requestIdRef.current;

    void readVoiceAgentFromFile()
      .then((state) => {
        if (requestIdRef.current !== id) return;
        setReady(state.configured && state.voiceAgent !== null);
      })
      .catch(() => {
        if (requestIdRef.current !== id) return;
        setReady(false);
      });
  }, [licenseFilePath]);

  return ready;
}

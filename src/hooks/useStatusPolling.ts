import { useEffect, useRef } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUeControlStore } from '@/stores/ueControlStore';
import { useStatusStore } from '@/stores/statusStore';
import { getProcessStatus, checkPixelStreamingStatus } from '@/services/voiceAgentWriter';
import { checkUeApiHealth } from '@/services/ueRemoteApi';
import { isValidUrl } from '@/utils/isValidUrl';

/** Polling interval for all status checks */
const STATUS_POLL_MS = 5_000;

/**
 * Global status polling hook — runs at AppShell level.
 *
 * Polls every 5s:
 *  - start2stream process status
 *  - Pixel Streaming endpoint reachability
 *  - UE Remote API health
 *
 * Results go into statusStore (process, PS) and ueControlStore (UE health).
 */
export function useStatusPolling(): void {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = async () => {
      const { pixelStreamingUrl } = useSettingsStore.getState();
      const { ueApiUrl, setUeReachable } = useUeControlStore.getState();
      const { setProcessRunning, setPsReachable } = useStatusStore.getState();

      // Run all health checks in parallel — no reason to block on each other
      await Promise.allSettled([
        // Process status
        getProcessStatus()
          .then((status) => setProcessRunning(status.running))
          .catch(() => setProcessRunning(null)),

        // Pixel Streaming reachability
        pixelStreamingUrl && isValidUrl(pixelStreamingUrl)
          ? checkPixelStreamingStatus(pixelStreamingUrl)
              .then((ps) => setPsReachable(ps.reachable))
              .catch(() => setPsReachable(null))
          : Promise.resolve(setPsReachable(null)),

        // UE API health
        ueApiUrl && isValidUrl(ueApiUrl)
          ? checkUeApiHealth(ueApiUrl)
              .then((ok) => setUeReachable(ok))
              .catch(() => setUeReachable(null))
          : Promise.resolve(setUeReachable(null)),
      ]);
    };

    void poll();
    timerRef.current = setInterval(() => void poll(), STATUS_POLL_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);
}

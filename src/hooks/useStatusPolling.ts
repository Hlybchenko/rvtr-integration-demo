import { useEffect, useRef } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUeControlStore } from '@/stores/ueControlStore';
import { useStatusStore } from '@/stores/statusStore';
import { getProcessStatus, checkPixelStreamingStatus } from '@/services/voiceAgentWriter';
import { checkUeApiHealth } from '@/services/ueRemoteApi';
import { isValidUrl } from '@/utils/isValidUrl';

/** Base polling interval for process & PS checks */
const STATUS_POLL_MS = 5_000;
/** Max backoff for UE health when unreachable */
const UE_MAX_BACKOFF_MS = 30_000;

/**
 * Global status polling hook — runs at AppShell level.
 *
 * Polls every 5s:
 *  - start2stream process status
 *  - Pixel Streaming endpoint reachability
 *  - UE Remote API health (with exponential backoff when unreachable)
 *
 * Results go into statusStore (process, PS) and ueControlStore (UE health).
 */
export function useStatusPolling(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Consecutive UE health check failures — drives backoff */
  const ueFailCountRef = useRef(0);
  /** Tick counter to compare against backoff interval */
  const tickRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const { pixelStreamingUrl } = useSettingsStore.getState();
      const { ueApiUrl, setUeReachable } = useUeControlStore.getState();
      const { setProcessRunning, setPsReachable } = useStatusStore.getState();

      tickRef.current += 1;

      // Determine whether to run UE health check this tick.
      // Backoff: skip ticks when UE is known unreachable to avoid console spam.
      const backoffMs = Math.min(
        STATUS_POLL_MS * 2 ** ueFailCountRef.current,
        UE_MAX_BACKOFF_MS,
      );
      const ticksBetweenUeChecks = Math.max(1, Math.round(backoffMs / STATUS_POLL_MS));
      const shouldCheckUe = tickRef.current % ticksBetweenUeChecks === 0;

      // Run health checks in parallel — no reason to block on each other
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

        // UE API health — with backoff
        shouldCheckUe && ueApiUrl && isValidUrl(ueApiUrl)
          ? checkUeApiHealth(ueApiUrl)
              .then((ok) => {
                const prevReachable = useUeControlStore.getState().ueReachable;
                setUeReachable(ok);
                // Reset backoff on success, increase on failure
                ueFailCountRef.current = ok ? 0 : ueFailCountRef.current + 1;
                // UE came back after being unreachable → likely restarted →
                // reset committed camera so next device apply sends full offsets.
                if (ok && prevReachable === false) {
                  useUeControlStore.getState().resetUeCommittedCamera();
                }
              })
              .catch(() => {
                setUeReachable(null);
                ueFailCountRef.current += 1;
              })
          : shouldCheckUe
            ? Promise.resolve(setUeReachable(null))
            : Promise.resolve(),
      ]);
    };

    // Recursive setTimeout: next poll starts only after current one finishes.
    // Prevents overlapping polls when a fetch hangs longer than STATUS_POLL_MS.
    const loop = async () => {
      await poll();
      if (!cancelled) {
        timerRef.current = setTimeout(() => void loop(), STATUS_POLL_MS);
      }
    };

    void loop();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}

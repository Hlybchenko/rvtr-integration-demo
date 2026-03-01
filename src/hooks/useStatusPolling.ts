import { useEffect, useRef } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
// import { useUeControlStore } from '@/stores/ueControlStore';
import { useStatusStore } from '@/stores/statusStore';
import { getProcessStatus, checkPixelStreamingStatus } from '@/services/voiceAgentWriter';
// import { checkUeApiHealth } from '@/services/ueRemoteApi';
import { isValidUrl } from '@/utils/isValidUrl';

/** Base polling interval for process & PS checks */
const STATUS_POLL_MS = 5_000;
// /** Max backoff for UE health when unreachable */
// const UE_MAX_BACKOFF_MS = 30_000;

/**
 * Global status polling hook — runs at AppShell level.
 *
 * Polls every 5s:
 *  - start2stream process status
 *  - Pixel Streaming endpoint reachability
 *
 * UE Remote API health check is disabled until a real ping endpoint exists.
 * To re-enable: uncomment UE sections here and in UeControlPanel/OverviewPage.
 */
export function useStatusPolling(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // UE health refs — disabled until real ping endpoint
  // const ueFailCountRef = useRef(0);
  // const tickRef = useRef(0);
  // const prevUeUrlRef = useRef('');

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const { pixelStreamingUrl } = useSettingsStore.getState();
      // const { ueApiUrl, setUeReachable } = useUeControlStore.getState();

      // UE health check backoff — disabled until real ping endpoint exists
      // if (ueApiUrl !== prevUeUrlRef.current) {
      //   ueFailCountRef.current = 0;
      //   prevUeUrlRef.current = ueApiUrl;
      // }
      const { setProcessRunning, setPsReachable } = useStatusStore.getState();

      // tickRef.current += 1;
      // const backoffMs = Math.min(
      //   STATUS_POLL_MS * 2 ** ueFailCountRef.current,
      //   UE_MAX_BACKOFF_MS,
      // );
      // const ticksBetweenUeChecks = Math.max(1, Math.round(backoffMs / STATUS_POLL_MS));
      // const shouldCheckUe = tickRef.current % ticksBetweenUeChecks === 0;

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

        // UE API health — DISABLED until backend provides a dedicated ping endpoint.
        // The previous `{ command: 'ping' }` was not a real UE command; it caused
        // false "UE Offline" reports even though actual commands worked fine.
        // To re-enable: implement a real health-check endpoint and uncomment.
        //
        // shouldCheckUe && ueApiUrl && isValidUrl(ueApiUrl)
        //   ? checkUeApiHealth(ueApiUrl)
        //       .then((ok) => {
        //         const prevReachable = useUeControlStore.getState().ueReachable;
        //         setUeReachable(ok);
        //         ueFailCountRef.current = ok ? 0 : ueFailCountRef.current + 1;
        //         if (ok && prevReachable === false) {
        //           useUeControlStore.getState().resetUeCommittedCamera();
        //         }
        //       })
        //       .catch(() => {
        //         setUeReachable(null);
        //         ueFailCountRef.current += 1;
        //       })
        //   : shouldCheckUe
        //     ? Promise.resolve(setUeReachable(null))
        //     : Promise.resolve(),
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

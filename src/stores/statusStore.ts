import { create } from 'zustand';

/**
 * Global runtime status store.
 *
 * Holds health-check / reachability data that needs to be
 * visible on every page (not just OverviewPage).
 * Polling is driven by the useStatusPolling hook in AppShell.
 */
interface StatusState {
  /** start2stream process running flag (null = unknown / loading) */
  processRunning: boolean | null;
  /** Pixel Streaming endpoint reachable (null = unknown) */
  psReachable: boolean | null;

  setProcessRunning: (v: boolean | null) => void;
  setPsReachable: (v: boolean | null) => void;
}

export const useStatusStore = create<StatusState>()((set) => ({
  processRunning: null,
  psReachable: null,

  setProcessRunning: (v) => set({ processRunning: v }),
  setPsReachable: (v) => set({ psReachable: v }),
}));

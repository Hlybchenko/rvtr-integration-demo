/**
 * Streaming state store (runtime-only, NOT persisted).
 *
 * Manages the lifecycle of the persistent Pixel Streaming iframe:
 *   isVisible → iframe positioned over the device screen slot
 *   viewport  → exact geometry (left/top/width/height/borderRadius) from DevicePreview
 *
 * The iframe auto-mounts whenever `pixelStreamingUrl` is set in settingsStore.
 * No manual connect/disconnect — the iframe stays alive across route changes.
 *
 * Flow:
 *   1. User enters a PS URL on Settings → iframe mounts automatically
 *   2. User navigates to /kiosk → show() → iframe moves over screen slot
 *   3. User navigates away → hide() → iframe stays mounted but invisible
 *   4. remount() forces iframe teardown+rebuild (used after voice agent change)
 */
import { create } from 'zustand';

export interface StreamingViewport {
  left: number;
  top: number;
  width: number;
  height: number;
  borderRadius: string;
}

interface StreamingState {
  /** True when a streaming device page is currently displayed */
  isVisible: boolean;
  /** Current screen slot geometry in viewport coordinates */
  viewport: StreamingViewport | null;
  /** Incremented to force iframe remount (key change) */
  mountGeneration: number;

  /** Call when entering a streaming device page */
  show: () => void;
  /** Call when leaving a streaming device page */
  hide: () => void;
  /** Update viewport geometry from ResizeObserver / scroll */
  setViewport: (viewport: StreamingViewport) => void;
  /** Force iframe teardown + rebuild (e.g. after voice agent provider change) */
  remount: () => void;
}

export const useStreamingStore = create<StreamingState>()((set) => ({
  isVisible: false,
  viewport: null,
  mountGeneration: 0,

  show: () => set({ isVisible: true }),
  hide: () => set({ isVisible: false }),
  setViewport: (viewport) => set({ viewport }),
  remount: () => {
    // Best-effort: notify current PS iframe to gracefully close WebRTC
    const iframe = document.querySelector<HTMLIFrameElement>('[data-ps-iframe]');
    if (iframe?.contentWindow) {
      try {
        iframe.contentWindow.postMessage({ type: 'ps-disconnect' }, '*');
      } catch {
        // cross-origin — iframe will cleanup on unload
      }
    }
    set((s) => ({ isVisible: false, viewport: null, mountGeneration: s.mountGeneration + 1 }));
  },
}));

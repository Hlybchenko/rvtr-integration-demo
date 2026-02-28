/**
 * Streaming state store (runtime-only, NOT persisted).
 *
 * Manages the lifecycle of the persistent Pixel Streaming iframe:
 *   connected → iframe mounted in DOM (position:fixed, off-screen until show())
 *   isVisible → iframe positioned over the device screen slot
 *   viewport  → exact geometry (left/top/width/height/borderRadius) from DevicePreview
 *
 * Flow:
 *   1. User clicks Connect on Settings → connect() → iframe mounts
 *   2. User navigates to /kiosk → show() → iframe moves over screen slot
 *   3. User navigates away → hide() → iframe stays mounted but invisible
 *   4. User clicks Disconnect → disconnect() → postMessage to close WebRTC → iframe unmounts
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
  /**
   * True when user explicitly connected to Pixel Streaming (via Connect button).
   * Toggleable — disconnect unmounts the iframe.
   */
  connected: boolean;
  /** True when a streaming device page is currently displayed */
  isVisible: boolean;
  /** Current screen slot geometry in viewport coordinates */
  viewport: StreamingViewport | null;

  /** User clicked Connect — mount the persistent iframe */
  connect: () => void;
  /** User clicked Disconnect — unmount the persistent iframe */
  disconnect: () => void;
  /** Call when entering a streaming device page */
  show: () => void;
  /** Call when leaving a streaming device page */
  hide: () => void;
  /** Update viewport geometry from ResizeObserver / scroll */
  setViewport: (viewport: StreamingViewport) => void;
}

export const useStreamingStore = create<StreamingState>()((set) => ({
  connected: false,
  isVisible: false,
  viewport: null,

  connect: () => set({ connected: true }),
  disconnect: () => {
    // Best-effort: notify PS iframe to gracefully close WebRTC before unmount
    const iframe = document.querySelector<HTMLIFrameElement>('[data-ps-iframe]');
    if (iframe?.contentWindow) {
      try {
        iframe.contentWindow.postMessage({ type: 'ps-disconnect' }, '*');
      } catch {
        // cross-origin — iframe will cleanup on unload
      }
    }
    set({ connected: false, isVisible: false, viewport: null });
  },
  show: () => set({ isVisible: true }),
  hide: () => set({ isVisible: false }),
  setViewport: (viewport) => set({ viewport }),
}));

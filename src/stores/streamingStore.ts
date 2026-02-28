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
  disconnect: () => set({ connected: false, isVisible: false, viewport: null }),
  show: () => set({ isVisible: true }),
  hide: () => set({ isVisible: false }),
  setViewport: (viewport) => set({ viewport }),
}));

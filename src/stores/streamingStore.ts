import { create } from 'zustand';

export interface StreamingViewport {
  left: number;
  top: number;
  width: number;
  height: number;
  borderRadius: string;
}

interface StreamingState {
  /** True after first streaming page visit — never resets to false */
  iframeMounted: boolean;
  /** True when a streaming device page is currently displayed */
  isVisible: boolean;
  /** Current screen slot geometry in viewport coordinates */
  viewport: StreamingViewport | null;

  /** Call on first streaming device page visit to mount the persistent iframe */
  mount: () => void;
  /** Call when entering a streaming device page */
  show: () => void;
  /** Call when leaving a streaming device page */
  hide: () => void;
  /** Update viewport geometry from ResizeObserver / scroll */
  setViewport: (viewport: StreamingViewport) => void;
}

export const useStreamingStore = create<StreamingState>()((set) => ({
  iframeMounted: false,
  isVisible: false,
  viewport: null,

  mount: () => set({ iframeMounted: true }),
  show: () => set({ isVisible: true }),
  hide: () => set({ isVisible: false }),
  setViewport: (viewport) => set({ viewport }),
}));

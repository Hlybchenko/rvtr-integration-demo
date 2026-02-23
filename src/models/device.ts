/**
 * Device template model.
 *
 * screenRect coordinates are in the PNG's native pixel space.
 * The DevicePreview component maps them proportionally when scaling.
 */
export interface DeviceTemplate {
  /** Unique route-friendly identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Path to the PNG frame asset */
  frameSrc: string;
  /** Natural width of the PNG (px) */
  frameWidth: number;
  /** Natural height of the PNG (px) */
  frameHeight: number;
  /** Screen area inside the frame (in PNG native px) */
  screenRect: {
    x: number;
    y: number;
    w: number;
    h: number;
    /** border-radius in PNG px */
    r: number;
  };
  /** Optional default URL for this device's iframe */
  defaultUrl?: string;
  /** Render screen layer above frame (useful for opaque vector frames) */
  screenOnTop?: boolean;
  /**
   * When true, the transparent area in the PNG is auto-detected at runtime
   * via canvas alpha-channel scanning. screenRect is used as a fallback.
   */
  autoDetectScreen?: boolean;
  /** Border-radius for the screen area (in PNG native px). Useful for rounded screens. */
  screenRadius?: number;
  /** Extra pixels to add at the bottom of the detected screen area (native px). */
  screenExpandBottom?: number;
  /** Extra pixels to expand the detected screen area on all sides (native px). */
  screenExpand?: number;
}

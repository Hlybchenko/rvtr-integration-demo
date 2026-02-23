import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
  type CSSProperties,
} from 'react';
import type { DeviceTemplate } from '@/models/device';
import { useDetectScreenRect } from '@/hooks/useDetectScreenRect';
import styles from './DevicePreview.module.css';

interface DevicePreviewProps {
  device: DeviceTemplate;
  url: string;
  sandbox?: string;
  showWidgetRequired?: boolean;
}

const DEFAULT_SANDBOX =
  import.meta.env.VITE_IFRAME_SANDBOX ||
  'allow-scripts allow-same-origin allow-forms allow-popups';

/**
 * Renders a device frame image with an iframe "screen" overlay.
 * Scales responsively using object-fit: contain logic via ResizeObserver.
 */
export const DevicePreview = forwardRef<HTMLIFrameElement, DevicePreviewProps>(
  function DevicePreview({ device, url, sandbox, showWidgetRequired = false }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLImageElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [loading, setLoading] = useState(!!url);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [naturalSize, setNaturalSize] = useState({
      width: device.frameWidth,
      height: device.frameHeight,
    });

    // Expose iframe ref to parent
    useImperativeHandle(ref, () => iframeRef.current!, []);

    // Compute the scale factor so the device fits in the container (contain)
    const computeSize = useCallback(() => {
      const el = containerRef.current;
      if (!el) return;

      // Use content box (subtract padding) so the wrapper never overflows
      const cs = getComputedStyle(el);
      const containerW =
        el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const containerH =
        el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const frameWidth = naturalSize.width || device.frameWidth;
      const frameHeight = naturalSize.height || device.frameHeight;

      const scale = Math.min(containerW / frameWidth, containerH / frameHeight);

      setSize({
        width: frameWidth * scale,
        height: frameHeight * scale,
      });
    }, [device, naturalSize.height, naturalSize.width]);

    useEffect(() => {
      computeSize();
      const el = containerRef.current;
      if (!el) return;

      const ro = new ResizeObserver(computeSize);
      ro.observe(el);
      return () => ro.disconnect();
    }, [computeSize]);

    // Reset loading state when url changes
    useEffect(() => {
      setLoading(!!url);
    }, [url]);

    const handleIframeLoad = useCallback(() => {
      setLoading(false);
    }, []);

    // Auto-detect the screen cutout (inner transparent hole) in the PNG.
    // Falls back to the manually configured screenRect.
    const detectedRect = useDetectScreenRect(device.frameSrc, !!device.autoDetectScreen);

    const sourceWidth = naturalSize.width || device.frameWidth;
    const sourceHeight = naturalSize.height || device.frameHeight;
    const rawRect = detectedRect ?? device.screenRect;
    const expandBottom = device.screenExpandBottom ?? 0;
    const expand = device.screenExpand ?? 0;
    const rect = {
      x: rawRect.x - expand,
      y: rawRect.y - expand,
      w: rawRect.w + expand * 2,
      h: rawRect.h + expand * 2 + expandBottom,
    };

    const screenStyle: CSSProperties = {
      left: (rect.x / sourceWidth) * size.width,
      top: (rect.y / sourceHeight) * size.height,
      width: (rect.w / sourceWidth) * size.width,
      height: (rect.h / sourceHeight) * size.height,
      borderRadius: device.screenRadius
        ? (device.screenRadius / sourceWidth) * size.width
        : 'r' in rect
          ? ((rect as typeof device.screenRect).r / sourceWidth) * size.width
          : 0,
      zIndex: device.screenOnTop ? 3 : 1,
    };

    const resolvedSandbox =
      sandbox !== undefined
        ? sandbox === 'none'
          ? undefined
          : sandbox
        : DEFAULT_SANDBOX === 'none'
          ? undefined
          : DEFAULT_SANDBOX;

    return (
      <div className={styles.container} ref={containerRef}>
        <div
          className={styles.wrapper}
          style={{ width: size.width, height: size.height }}
        >
          {/* Device frame */}
          <img
            ref={frameRef}
            className={styles.frame}
            src={device.frameSrc}
            alt={`${device.name} frame`}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setNaturalSize({
                  width: img.naturalWidth,
                  height: img.naturalHeight,
                });
              }
            }}
          />

          {/* Screen area */}
          <div className={styles.screen} style={screenStyle}>
            {url ? (
              <>
                <iframe
                  ref={iframeRef}
                  className={styles.iframe}
                  src={url}
                  title={`${device.name} preview`}
                  sandbox={resolvedSandbox}
                  loading="lazy"
                  onLoad={handleIframeLoad}
                  allow="autoplay; microphone; fullscreen"
                />
                <div
                  className={`${styles.loadingOverlay} ${!loading ? styles.loadingHidden : ''}`}
                >
                  <div className={styles.spinner} />
                </div>
              </>
            ) : (
              <div className={styles.emptyScreen}>
                {showWidgetRequired ? (
                  <>
                    <div className={styles.spinner} />
                    <span>Widget URL required</span>
                  </>
                ) : (
                  <>
                    <span className={styles.emptyIcon}>🔗</span>
                    <span>Enter a widget URL above</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
);

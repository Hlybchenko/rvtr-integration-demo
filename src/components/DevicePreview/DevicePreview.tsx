import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  forwardRef,
  type CSSProperties,
} from 'react';
import { preloadDeviceFrameImages } from '@/config/devices';
import type { DeviceTemplate } from '@/models/device';
import { useDetectScreenRect } from '@/hooks/useDetectScreenRect';
import styles from './DevicePreview.module.css';

interface DevicePreviewProps {
  device: DeviceTemplate;
  url: string;
  sandbox?: string;
  showWidgetRequired?: boolean;
  transitionPhase?: 'idle' | 'exiting' | 'entering';
}

const DEFAULT_SANDBOX =
  import.meta.env.VITE_IFRAME_SANDBOX ||
  'allow-scripts allow-same-origin allow-forms allow-popups';

const IFRAME_REVEAL_DELAY_MS = 1000;

/**
 * Renders a device frame image with an iframe "screen" overlay.
 * Scales responsively using object-fit: contain logic via ResizeObserver.
 */
export const DevicePreview = forwardRef<HTMLIFrameElement, DevicePreviewProps>(
  function DevicePreview(
    { device, url, sandbox, showWidgetRequired = false, transitionPhase = 'idle' },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLImageElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const iframeRevealTimerRef = useRef<number | null>(null);
    const [loading, setLoading] = useState(!!url);
    const [frameLoaded, setFrameLoaded] = useState(false);
    const [isIframeRevealed, setIsIframeRevealed] = useState(true);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [naturalSize, setNaturalSize] = useState({
      width: device.frameWidth,
      height: device.frameHeight,
    });

    useEffect(() => {
      preloadDeviceFrameImages([device]);
    }, [device]);

    useEffect(() => {
      if (iframeRevealTimerRef.current) {
        window.clearTimeout(iframeRevealTimerRef.current);
      }

      if (transitionPhase !== 'entering') {
        setIsIframeRevealed(true);
        return;
      }

      setIsIframeRevealed(false);
      iframeRevealTimerRef.current = window.setTimeout(() => {
        setIsIframeRevealed(true);
      }, IFRAME_REVEAL_DELAY_MS);

      return () => {
        if (iframeRevealTimerRef.current) {
          window.clearTimeout(iframeRevealTimerRef.current);
        }
      };
    }, [transitionPhase, device.id]);

    useLayoutEffect(() => {
      setNaturalSize({
        width: device.frameWidth,
        height: device.frameHeight,
      });
      setFrameLoaded(false);
    }, [device.frameWidth, device.frameHeight, device.frameSrc]);

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
    }, [url, device.id, device.frameSrc]);

    const handleIframeLoad = useCallback(() => {
      setLoading(false);
    }, []);

    // Auto-detect the screen cutout (inner transparent hole) in the PNG.
    // Falls back to the manually configured screenRect.
    const detectedRect = useDetectScreenRect(device.frameSrc, !!device.autoDetectScreen);

    const sourceWidth = naturalSize.width || device.frameWidth;
    const sourceHeight = naturalSize.height || device.frameHeight;
    const rawRect = device.autoDetectScreen
      ? (detectedRect ?? device.screenRect)
      : device.screenRect;
    const expandBottom = device.screenExpandBottom ?? 0;
    const expand = device.screenExpand ?? 0;
    const rect = rawRect
      ? {
          x: rawRect.x - expand,
          y: rawRect.y - expand,
          w: rawRect.w + expand * 2,
          h: rawRect.h + expand * 2 + expandBottom,
        }
      : null;

    const screenStyle: CSSProperties | undefined = rect
      ? {
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
        }
      : undefined;

    const resolvedSandbox =
      sandbox !== undefined
        ? sandbox === 'none'
          ? undefined
          : sandbox
        : DEFAULT_SANDBOX === 'none'
          ? undefined
          : DEFAULT_SANDBOX;

    const previewScale = device.previewScale ?? 1;
    const isGeometryReady = frameLoaded && !!rect && size.width > 0 && size.height > 0;
    const shouldRenderIframe = Boolean(url) && isGeometryReady;
    const showGlobalLoader = !isGeometryReady || (Boolean(url) && loading);

    return (
      <div className={styles.container} ref={containerRef}>
        <div
          className={styles.wrapper}
          style={{
            width: size.width,
            height: size.height,
            transform: `scale(${previewScale})`,
            transformOrigin: 'center center',
          }}
        >
          {/* Device frame */}
          <img
            ref={frameRef}
            className={`${styles.frame} ${!frameLoaded ? styles.frameHidden : ''}`}
            src={device.frameSrc}
            alt={`${device.name} frame`}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              setFrameLoaded(true);
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setNaturalSize({
                  width: img.naturalWidth,
                  height: img.naturalHeight,
                });
              }
            }}
          />

          {screenStyle ? (
            <div className={styles.screen} style={screenStyle}>
              {shouldRenderIframe ? (
                <iframe
                  ref={iframeRef}
                  className={`${styles.iframe} ${isIframeRevealed ? styles.iframeRevealed : styles.iframeMuted}`}
                  src={url}
                  title={`${device.name} preview`}
                  sandbox={resolvedSandbox}
                  loading="lazy"
                  onLoad={handleIframeLoad}
                  allow="autoplay; microphone; fullscreen"
                />
              ) : !url && isGeometryReady ? (
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
              ) : null}
            </div>
          ) : null}
        </div>

        <div
          className={`${styles.deviceBootOverlay} ${!showGlobalLoader ? styles.deviceBootHidden : ''}`}
        >
          <div className={styles.loaderMinimal}>
            <div className={styles.spinner} />
            <div className={styles.loaderText}>Preparing preview…</div>
          </div>
        </div>
      </div>
    );
  },
);

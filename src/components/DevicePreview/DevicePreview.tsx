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
import { useStreamingStore } from '@/stores/streamingStore';
import styles from './DevicePreview.module.css';

interface DevicePreviewProps {
  device: DeviceTemplate;
  /** URL for non-streaming devices (phone, laptop). Ignored when isStreaming=true. */
  url: string;
  sandbox?: string;
  transitionPhase?: 'idle' | 'exiting' | 'entering';
  /** When true, renders empty screen slot and reports viewport to streamingStore */
  isStreaming?: boolean;
}

const DEFAULT_SANDBOX =
  import.meta.env.VITE_IFRAME_SANDBOX ||
  'allow-scripts allow-same-origin allow-forms allow-popups';

const IFRAME_REVEAL_DELAY_MS = 1000;

/**
 * Renders a device frame image with an iframe "screen" overlay.
 * Scales responsively using object-fit: contain logic via ResizeObserver.
 *
 * When isStreaming=true, the screen slot is empty (no iframe) and its
 * viewport geometry is reported to streamingStore for the persistent iframe.
 */
export const DevicePreview = forwardRef<HTMLIFrameElement, DevicePreviewProps>(
  function DevicePreview(
    { device, url, sandbox, transitionPhase = 'idle', isStreaming = false },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLImageElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const screenSlotRef = useRef<HTMLDivElement>(null);
    const iframeRevealTimerRef = useRef<number | null>(null);
    const [loading, setLoading] = useState(!!url);
    const [isEmbedBlocked, setIsEmbedBlocked] = useState(false);
    const [frameLoaded, setFrameLoaded] = useState(false);
    const [isIframeRevealed, setIsIframeRevealed] = useState(true);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [naturalSize, setNaturalSize] = useState({
      width: device.frameWidth,
      height: device.frameHeight,
    });

    const setViewport = useStreamingStore((s) => s.setViewport);

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

    // Expose iframe ref to parent (only relevant for non-streaming)
    useImperativeHandle(ref, () => iframeRef.current!, []);

    // Compute the scale factor so the device fits in the container (contain)
    const computeSize = useCallback(() => {
      const el = containerRef.current;
      if (!el) return;

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

    // Report screen slot viewport geometry to streamingStore (rAF-debounced).
    // Uses a 1px threshold to avoid unnecessary store updates on sub-pixel changes.
    // `size` is intentionally excluded — ResizeObserver already fires on geometry changes.
    useEffect(() => {
      if (!isStreaming) return;

      const el = screenSlotRef.current;
      if (!el) return;

      let rafId: number | null = null;
      let prev = { left: 0, top: 0, width: 0, height: 0 };

      const scheduleUpdate = () => {
        if (rafId !== null) return; // already scheduled
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;

          // Skip update if geometry changed by less than 1px
          if (
            Math.abs(rect.left - prev.left) < 1 &&
            Math.abs(rect.top - prev.top) < 1 &&
            Math.abs(rect.width - prev.width) < 1 &&
            Math.abs(rect.height - prev.height) < 1
          ) {
            return;
          }
          prev = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };

          const computedStyle = getComputedStyle(el);
          setViewport({
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            borderRadius: computedStyle.borderRadius,
          });
        });
      };

      // Initial measurement
      scheduleUpdate();

      const ro = new ResizeObserver(scheduleUpdate);
      ro.observe(el);

      // Also update on scroll (in case parent scrolls) and resize
      // (position may shift due to flex centering without size change).
      window.addEventListener('scroll', scheduleUpdate, { passive: true });
      window.addEventListener('resize', scheduleUpdate, { passive: true });

      return () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        ro.disconnect();
        window.removeEventListener('scroll', scheduleUpdate);
        window.removeEventListener('resize', scheduleUpdate);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- size excluded: ResizeObserver handles geometry changes
    }, [isStreaming, setViewport]);

    // Reset loading / blocked state when url or device changes (non-streaming only)
    useEffect(() => {
      if (isStreaming) return;
      setLoading(!!url);
      setIsEmbedBlocked(false);
    }, [url, device.id, device.frameSrc, isStreaming]);

    const handleIframeLoad = useCallback(() => {
      const iframe = iframeRef.current;
      let blocked = false;

      if (iframe) {
        try {
          const href = iframe.contentWindow?.location.href ?? '';
          const title = iframe.contentDocument?.title?.toLowerCase() ?? '';
          const bodyText = iframe.contentDocument?.body?.innerText?.toLowerCase() ?? '';

          if (href === 'about:blank' || href.startsWith('chrome-error://')) {
            blocked = true;
          }

          if (
            title.includes('refused to connect') ||
            bodyText.includes('refused to connect') ||
            bodyText.includes('x-frame-options') ||
            bodyText.includes('frame-ancestors')
          ) {
            blocked = true;
          }
        } catch {
          blocked = false;
        }
      }

      setIsEmbedBlocked(blocked);
      setLoading(false);

      if (!blocked) {
        requestAnimationFrame(() => {
          try {
            iframeRef.current?.focus();
          } catch {
            // cross-origin – safe to ignore
          }
        });
      }
    }, []);

    const handleIframeError = useCallback(() => {
      setIsEmbedBlocked(true);
      setLoading(false);
    }, []);

    const handleScreenMouseDown = useCallback(() => {
      requestAnimationFrame(() => {
        try {
          iframeRef.current?.focus();
        } catch {
          // cross-origin focus may throw – safe to ignore
        }
      });
    }, []);

    // Auto-detect the screen cutout (inner transparent hole) in the PNG.
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
          zIndex: device.screenOnTop ? 4 : undefined,
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
    const shouldRenderIframe = !isStreaming && Boolean(url) && isGeometryReady;
    const showGlobalLoader = !isStreaming && (!isGeometryReady || (Boolean(url) && loading));

    // Keep focus on the iframe — re-focus whenever it loses it (non-streaming only).
    useEffect(() => {
      if (isStreaming) return;
      const iframe = iframeRef.current;
      if (!iframe || !url || isEmbedBlocked) return;

      const refocus = () => {
        requestAnimationFrame(() => {
          try {
            iframeRef.current?.focus();
          } catch {
            // cross-origin — safe to ignore
          }
        });
      };

      iframe.addEventListener('blur', refocus);
      return () => iframe.removeEventListener('blur', refocus);
    }, [url, isEmbedBlocked, isGeometryReady, isStreaming]);

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
            <div
              ref={screenSlotRef}
              className={styles.screen}
              style={screenStyle}
              onMouseDown={isStreaming ? undefined : handleScreenMouseDown}
            >
              {isStreaming ? (
                // Empty screen slot — persistent iframe is positioned over this via streamingStore
                <div className={styles.streamingSlot} />
              ) : shouldRenderIframe ? (
                <>
                  <iframe
                    ref={iframeRef}
                    className={`${styles.iframe} ${isIframeRevealed ? styles.iframeRevealed : styles.iframeMuted}`}
                    data-rvtr-preview="true"
                    src={url}
                    title={`${device.name} preview`}
                    tabIndex={0}
                    sandbox={resolvedSandbox}
                    onLoad={handleIframeLoad}
                    onError={handleIframeError}
                    allow="autoplay; microphone; fullscreen"
                  />
                  {isEmbedBlocked ? (
                    <div className={`${styles.emptyScreen} ${styles.embedBlockedScreen}`}>
                      <span className={styles.emptyIcon}>⛔</span>
                      <span>
                        This URL blocks embedding. Try a different URL or check the
                        server's CSP headers.
                      </span>
                    </div>
                  ) : null}
                </>
              ) : !url && !isStreaming && isGeometryReady ? (
                <div className={styles.emptyScreen}>
                  <span className={styles.emptyIcon}>🔗</span>
                  <span>Set a device URL in Settings to see the preview</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {showGlobalLoader ? (
          <div className={styles.deviceBootOverlay}>
            <div className={styles.loaderMinimal}>
              <div className={styles.spinner} />
              <div className={styles.loaderText}>Preparing preview…</div>
            </div>
          </div>
        ) : null}
      </div>
    );
  },
);

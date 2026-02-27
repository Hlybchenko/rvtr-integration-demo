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
  function DevicePreview({ device, url, sandbox, transitionPhase = 'idle' }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLImageElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
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

    // Reset loading / blocked state when url or device changes.
    // The browser automatically closes the old page context (WebSocket,
    // WebRTC, etc.) when React updates the iframe `src` prop, so there's
    // no need to imperatively blank it — doing so desynchronises React's
    // virtual DOM from the real DOM and can kill Pixel Streaming sessions.
    useEffect(() => {
      setLoading(!!url);
      setIsEmbedBlocked(false);
    }, [url, device.id, device.frameSrc]);

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

      // Auto-focus the iframe so keyboard events reach its content immediately
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

    /**
     * Ensure the iframe content-window receives keyboard focus.
     * Use mousedown (fires before the browser's own focus logic) so the
     * iframe gets focus even when a higher-z-index transparent layer sits
     * on top of it.
     */
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
    const shouldRenderIframe = Boolean(url) && isGeometryReady;
    const showGlobalLoader = !isGeometryReady || (Boolean(url) && loading);

    // Tear down iframe connections on unmount.
    // Setting src to "about:blank" forces the browser to close any active
    // WebSocket, HTTP, or media connections inside the iframe immediately,
    // rather than waiting for GC or TCP keepalive timeout.
    //
    // NOTE: read iframeRef.current inside the cleanup, not at effect time,
    // because at mount time the iframe hasn't rendered yet (shouldRenderIframe
    // is initially false) so the ref would capture null.
    useEffect(() => {
      return () => {
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: iframe renders conditionally, ref is null at mount time
        const iframe = iframeRef.current;
        if (iframe) {
          try {
            iframe.src = 'about:blank';
          } catch {
            // cross-origin — safe to ignore
          }
        }
      };
    }, []);

    // NOTE: aggressive blur→refocus was removed because it creates a
    // focus cycling loop during idle / tab-switch that interferes with
    // Pixel Streaming's WebRTC heartbeat and can freeze the stream.
    // The iframe is focused once on load (handleIframeLoad) and on
    // mousedown (handleScreenMouseDown), which is sufficient.

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
              className={styles.screen}
              style={screenStyle}
              onMouseDown={handleScreenMouseDown}
            >
              {shouldRenderIframe ? (
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
              ) : !url && isGeometryReady ? (
                <div className={styles.emptyScreen}>
                  <span className={styles.emptyIcon}>🔗</span>
                  <span>Set a device URL in Settings to see the preview</span>
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

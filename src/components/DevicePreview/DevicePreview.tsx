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
    // Overlay lifecycle: mount → (rAF) → fade in → loader done → fade out → unmount
    const [overlayMounted, setOverlayMounted] = useState(false);
    const [overlayActive, setOverlayActive] = useState(false);
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
    // `device.id` is included so the effect re-runs on device switch — the
    // screenSlotRef may point to a different DOM element (e.g. fullscreen ↔
    // non-fullscreen) and the ResizeObserver must observe the new element.
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
      // Also observe the container — when sidebar pins/unpins the container
      // resizes, shifting the screen slot position without changing its size.
      if (containerRef.current) ro.observe(containerRef.current);

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
    }, [isStreaming, setViewport, device.id]);

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

    // Overlay enter: mount first (opacity 0), then activate next frame (opacity 1)
    // Overlay exit:  deactivate (opacity 1→0 via transition), then unmount after transition
    const overlayExitTimer = useRef<number | null>(null);
    useEffect(() => {
      if (showGlobalLoader) {
        // Cancel pending unmount
        if (overlayExitTimer.current) {
          window.clearTimeout(overlayExitTimer.current);
          overlayExitTimer.current = null;
        }
        // Mount, then activate next frame so browser sees opacity:0 → opacity:1
        setOverlayMounted(true);
        requestAnimationFrame(() => requestAnimationFrame(() => setOverlayActive(true)));
      } else if (overlayMounted) {
        // Deactivate → CSS transition fades to 0, then unmount
        setOverlayActive(false);
        overlayExitTimer.current = window.setTimeout(() => {
          setOverlayMounted(false);
          overlayExitTimer.current = null;
        }, 700);
      }
      return () => {
        if (overlayExitTimer.current) window.clearTimeout(overlayExitTimer.current);
      };
    }, [showGlobalLoader]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Fullscreen devices: no frame image, screen slot fills the entire container
    if (device.fullscreen) {
      return (
        <div className={`${styles.container} ${styles.fullscreenContainer}`} ref={containerRef}>
          <div
            ref={screenSlotRef}
            className={styles.fullscreenScreen}
          >
            {isStreaming ? (
              <div className={styles.streamingSlot} />
            ) : null}
          </div>
        </div>
      );
    }

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

        {overlayMounted ? (
          <div className={`${styles.deviceBootOverlay} ${overlayActive ? styles.deviceBootOverlayActive : ''}`}>
            <div className={styles.loaderMinimal}>
              <div className={styles.loaderLogo}>
                {/* Central prism — static, pulses */}
                <svg className={styles.loaderPrism} width="44" height="40" viewBox="0 0 40 36" fill="none">
                  <defs>
                    <linearGradient id="ldPrism" x1="0.2" y1="0" x2="0.8" y2="1">
                      <stop offset="0%" stopColor="#1a1d28" />
                      <stop offset="50%" stopColor="#363c4e" />
                      <stop offset="100%" stopColor="#14171f" />
                    </linearGradient>
                    <linearGradient id="ldEdge" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#6a7290" />
                      <stop offset="50%" stopColor="#8890a8" />
                      <stop offset="100%" stopColor="#5a6280" />
                    </linearGradient>
                  </defs>
                  <path className={styles.loaderFacetFill} d="M11.5 6.3 H28.5 L20 23.5 Z" fill="url(#ldPrism)" />
                  <path className={styles.loaderPrismOuter} d="M11.5 6.3 H28.5 L20 23.5 Z" stroke="url(#ldEdge)" strokeWidth="1.1" strokeLinejoin="round" fill="none" />
                  <path className={styles.loaderEdgeInner} d="M28.5 6.3 L20 12.5 L11.5 6.3 M20 12.5 L20 23.5" stroke="url(#ldEdge)" strokeWidth="0.6" fill="none" opacity="0.5" />
                </svg>
                {/* Orbit wrapper rotates; inner SVG breathes scale */}
                <div className={styles.loaderArrowsOrbit}>
                <svg className={styles.loaderArrows} width="44" height="40" viewBox="0 0 40 36" fill="none" overflow="visible">
                  <defs>
                    <linearGradient id="ldArrow" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#9a2820" />
                      <stop offset="30%" stopColor="#EB4D3D" />
                      <stop offset="50%" stopColor="#ff8a7a" />
                      <stop offset="70%" stopColor="#EB4D3D" />
                      <stop offset="100%" stopColor="#9a2820" />
                    </linearGradient>
                  </defs>
                  {/* Three V-chevrons at 120° around prism centroid (20, 12) */}
                  <path d="M16 -8 L20 -14 L24 -8" stroke="url(#ldArrow)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  <path d="M16 -8 L20 -14 L24 -8" stroke="url(#ldArrow)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" transform="rotate(120 20 12)" />
                  <path d="M16 -8 L20 -14 L24 -8" stroke="url(#ldArrow)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" transform="rotate(240 20 12)" />
                </svg>
                </div>
              </div>
              <div className={styles.loaderTextWrap}>
                {'Preparing preview'.split('').map((ch, i) => (
                  <span key={i} className={styles.loaderChar} style={{ animationDelay: `${i * 0.07}s` }}>
                    {ch === ' ' ? '\u00A0' : ch}
                  </span>
                ))}
                <span className={styles.loaderDot} style={{ animationDelay: '0s' }}>.</span>
                <span className={styles.loaderDot} style={{ animationDelay: '0.3s' }}>.</span>
                <span className={styles.loaderDot} style={{ animationDelay: '0.6s' }}>.</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  },
);

import { useEffect, useRef, useCallback, useMemo, useState, type CSSProperties } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useStreamingStore, type StreamingViewport } from '@/stores/streamingStore';
import styles from './PersistentPixelStreaming.module.css';

/**
 * Persistent position:fixed iframe for Pixel Streaming.
 *
 * Auto-mounts when pixelStreamingUrl is configured in settingsStore.
 * Follows the screen-slot viewport geometry from streamingStore.
 * Keeps WebRTC alive by re-focusing on blur.
 * Uses mountGeneration as React key to force remount after voice agent change.
 */
export function PersistentPixelStreaming() {
  const pixelStreamingUrl = useSettingsStore((s) => s.pixelStreamingUrl);
  const isVisible = useStreamingStore((s) => s.isVisible);
  const viewport = useStreamingStore((s) => s.viewport);
  const mountGeneration = useStreamingStore((s) => s.mountGeneration);

  if (!pixelStreamingUrl) return null;

  return (
    <PersistentIframe
      key={mountGeneration}
      url={pixelStreamingUrl}
      isVisible={isVisible}
      viewport={viewport}
    />
  );
}

// ─── Inner component to isolate hooks from early return ───

interface PersistentIframeProps {
  url: string;
  isVisible: boolean;
  viewport: StreamingViewport | null;
}

const SANDBOX =
  import.meta.env.VITE_IFRAME_SANDBOX ||
  'allow-scripts allow-same-origin allow-forms allow-popups';

function PersistentIframe({ url, isVisible, viewport }: PersistentIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [isEmbedBlocked, setIsEmbedBlocked] = useState(false);

  // Force WebRTC teardown on unmount (HMR, remount, URL change).
  // Navigating iframe to about:blank makes the PS frontend close its
  // RTCPeerConnection before the DOM element is removed.
  useEffect(() => {
    const iframe = iframeRef.current;
    return () => {
      if (iframe) {
        try {
          iframe.src = 'about:blank';
        } catch {
          // cross-origin — iframe will clean up on unload
        }
      }
    };
  }, []);

  const shouldShow = isVisible && !!viewport;

  // ── Focus lock ─────────────────────────────────────────────────────────
  // Keeps keyboard focus on the PS iframe so keystrokes reach the stream.
  //
  // Architecture: listeners and polling are registered ONCE when the iframe
  // mounts and stay active for the component's lifetime.  `shouldShowRef`
  // is read inside callbacks to decide whether to act — this avoids the
  // React effect-batching problem where rapid hide()/show() calls cause
  // React to see shouldShow: true→true and skip effect re-runs.
  //
  //   1. mousedown capture — preventDefault() on every click that isn't
  //      a form control (input/textarea/select). Only active when
  //      shouldShowRef is true so non-streaming pages work normally.
  //
  //   2. mouseup capture — after releasing a form control (checkbox click),
  //      returns focus to iframe. <select> exempted: dropdown still open.
  //
  //   3. change event — reclaims focus after <select> value change
  //      (dropdown closes) or checkbox toggle.
  //
  //   4. Polling (200ms) — safety net for silent focus loss: React DOM
  //      removal, Tab navigation, programmatic .focus() calls.
  const shouldShowRef = useRef(shouldShow);
  shouldShowRef.current = shouldShow;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !url || isEmbedBlocked) return;

    const isFormControl = (el: EventTarget | null): boolean =>
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement;

    const focusIframe = () => {
      try { iframe.focus(); } catch { /* cross-origin */ }
    };

    // (1) Prevent focus theft — only when streaming page is active
    const onMouseDown = (e: MouseEvent) => {
      if (!shouldShowRef.current) return;
      if (isFormControl(e.target)) return;
      e.preventDefault();
    };
    document.addEventListener('mousedown', onMouseDown, true);

    // (2) Reclaim after form control interaction ends
    const onMouseUp = (e: MouseEvent) => {
      if (!shouldShowRef.current) return;
      if (!isFormControl(e.target)) return;
      if (e.target instanceof HTMLSelectElement) return;
      requestAnimationFrame(focusIframe);
    };
    document.addEventListener('mouseup', onMouseUp, true);

    // (3) Reclaim after <select> change / checkbox toggle
    const onChange = (e: Event) => {
      if (!shouldShowRef.current) return;
      if (!isFormControl(e.target)) return;
      requestAnimationFrame(focusIframe);
    };
    document.addEventListener('change', onChange);

    // (4) Polling safety net
    const poll = () => {
      if (!shouldShowRef.current) return;
      if (isFormControl(document.activeElement)) return;
      if (document.activeElement === iframe) return;
      focusIframe();
    };
    const pollId = window.setInterval(poll, 100);

    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('mouseup', onMouseUp, true);
      document.removeEventListener('change', onChange);
      window.clearInterval(pollId);
    };
  }, [url, isEmbedBlocked]);

  // Explicit focus grab whenever shouldShow transitions to true.
  // Deferred by one frame so the browser processes visibility/z-index first.
  useEffect(() => {
    if (!shouldShow) return;
    const iframe = iframeRef.current;
    if (!iframe || isEmbedBlocked) return;
    const id = requestAnimationFrame(() => {
      try { iframe.focus(); } catch { /* cross-origin */ }
    });
    return () => cancelAnimationFrame(id);
  }, [shouldShow, isEmbedBlocked]);

  const handleLoad = useCallback(() => {
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
        // Cross-origin: can't inspect iframe content. Assume not blocked —
        // PS URLs are typically same-origin or CORS-friendly.
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
          // cross-origin
        }
      });
    }
  }, []);

  const handleError = useCallback(() => {
    setIsEmbedBlocked(true);
    setLoading(false);
  }, []);

  // Reset loading state when URL changes; add timeout fallback so loading
  // doesn't stick forever if the iframe never fires onLoad/onError.
  useEffect(() => {
    setLoading(!!url);
    setIsEmbedBlocked(false);

    if (!url) return;
    const timer = window.setTimeout(() => setLoading(false), 15_000);
    return () => window.clearTimeout(timer);
  }, [url]);

  const resolvedSandbox = SANDBOX === 'none' ? undefined : SANDBOX;

  // Wrapper handles positioning only.
  // border-radius is intentionally NOT applied — even on the wrapper — because
  // the rounded clip + overflow:hidden forces the browser to recomposite the
  // WebRTC video layer, which freezes the stream (observed on keba-kiosk).
  // The device frame image (z-index 2) visually masks the corners anyway.
  //
  // IMPORTANT: we never use visibility:hidden — Chrome silently ignores
  // .focus() on hidden elements, which breaks the focus guard after
  // rapid page switching.  Instead we use z-index:-1 + opacity:0 to
  // hide the iframe while keeping it focusable.
  const active = shouldShow && !loading;
  const wrapperStyle = useMemo<CSSProperties>(
    () =>
      viewport
        ? {
            position: 'fixed',
            left: viewport.left,
            top: viewport.top,
            width: viewport.width,
            height: viewport.height,
            overflow: 'hidden',
            zIndex: active ? 3 : -1,
            opacity: active ? 1 : 0,
            background: '#0a0c14',
            pointerEvents: active ? 'auto' : 'none',
          }
        : {
            position: 'fixed',
            left: -9999,
            top: -9999,
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: 'none',
            overflow: 'hidden',
          },
    [viewport, active],
  );

  if (!url) {
    return null;
  }

  return (
    <>
      <div style={wrapperStyle}>
        <iframe
          ref={iframeRef}
          className={styles.persistentIframe}
          data-ps-iframe
          src={url}
          title="Pixel Streaming"
          tabIndex={0}
          sandbox={resolvedSandbox}
          onLoad={handleLoad}
          onError={handleError}
          allow="autoplay; microphone; fullscreen"
        />
      </div>
      {shouldShow && isEmbedBlocked ? (
        <div
          className={styles.embedError}
          style={{
            position: 'fixed',
            left: viewport.left,
            top: viewport.top,
            width: viewport.width,
            height: viewport.height,
            borderRadius: viewport.borderRadius,
            zIndex: 4,
          }}
        >
          <span>This URL blocks embedding. Check CSP headers.</span>
        </div>
      ) : null}
    </>
  );
}

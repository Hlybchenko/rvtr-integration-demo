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
  // Single low-level mechanism that keeps keyboard focus on the PS iframe.
  //
  // How it works:
  //   1. A `mousedown` capture listener on `document` calls preventDefault()
  //      for every click that would steal focus from the iframe. This stops
  //      focus theft at the source — no element on the page can take focus.
  //      Form controls (inputs, textareas, selects) are exempted so the
  //      UE control panel remains interactive.
  //
  //   2. A 200ms polling interval calls iframe.focus() whenever
  //      document.activeElement isn't the iframe or a form control.
  //      This handles edge cases that mousedown can't prevent:
  //      React unmounting a focused element, Tab navigation, programmatic
  //      focus changes, etc.
  //
  //   3. Initial focus is set immediately when the effect runs (iframe
  //      becomes visible).
  //
  // Active only when shouldShow is true (iframe visible on a device page).
  // On non-device pages the effect is cleaned up — no interference.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !url || isEmbedBlocked || !shouldShow) return;

    const isFormControl = (el: EventTarget | null): boolean =>
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement;

    // (1) Prevent focus theft at the source — capture phase runs before
    // any component-level handlers.
    const blockFocusTheft = (e: MouseEvent) => {
      if (isFormControl(e.target)) return;  // let UE panel controls work
      e.preventDefault();
    };
    document.addEventListener('mousedown', blockFocusTheft, true);

    // (2) Reclaim focus after form control interaction ends (mouseup).
    // Without this, releasing a slider leaves focus on the <input> and
    // polling (which exempts form controls) never reclaims it.
    const reclaimOnRelease = (e: MouseEvent) => {
      if (isFormControl(e.target)) {
        try { iframe.focus(); } catch { /* cross-origin */ }
      }
    };
    document.addEventListener('mouseup', reclaimOnRelease, true);

    // (3) Polling fallback — catches silent focus loss (DOM removal,
    // Tab navigation, programmatic focus, etc.)
    const reclaimFocus = () => {
      if (isFormControl(document.activeElement)) return;
      if (document.activeElement === iframe) return;
      try { iframe.focus(); } catch { /* cross-origin */ }
    };
    const pollId = window.setInterval(reclaimFocus, 200);

    // (4) Initial focus
    reclaimFocus();

    return () => {
      document.removeEventListener('mousedown', blockFocusTheft, true);
      document.removeEventListener('mouseup', reclaimOnRelease, true);
      window.clearInterval(pollId);
    };
  }, [url, isEmbedBlocked, shouldShow]);

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
            zIndex: 3,
            background: '#0a0c14',
            pointerEvents: shouldShow ? 'auto' : 'none',
            visibility: shouldShow && !loading ? 'visible' : 'hidden',
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
    [viewport, shouldShow, loading],
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

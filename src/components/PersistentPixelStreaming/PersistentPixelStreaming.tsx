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
  //
  // Keeps keyboard focus on the PS iframe so keystrokes always reach the
  // stream. The page is split into two zones:
  //
  //   IFRAME  — must own focus at all times
  //   PANEL   — [data-ue-panel] overlay; controls need native mouse
  //             interaction (slider drag, select dropdown, checkbox toggle)
  //
  // Browser constraint: the ONLY way to prevent a mousedown from moving
  // focus is calling preventDefault(). But preventDefault() also kills
  // native <input type="range"> drag. So we can't blanket-prevent inside
  // the panel — we have to let panel mousedowns through and reclaim focus
  // afterwards.
  //
  // Four layers, each covering what the previous one can't:
  //
  //   1. mousedown capture — preventDefault() for clicks OUTSIDE the panel
  //      and the iframe. Stops empty-space, sidebar, backdrop, etc. from
  //      stealing focus. Panel clicks proceed naturally.
  //
  //   2. mouseup capture — after releasing the mouse following a panel
  //      interaction, returns focus to iframe via rAF (lets click handlers
  //      fire first). <select> is exempted: its dropdown is still open
  //      at mouseup time.
  //
  //   3. change event delegation — fires when a <select> dropdown closes
  //      with a new value, or a checkbox toggles. Reclaims focus.
  //
  //   4. Polling safety net (200ms) — catches edge cases that produce NO
  //      DOM events: React unmounting a focused element (focus silently
  //      falls to <body>), Tab navigation, programmatic .focus() calls.
  //      Skips when mouse is held down or focus is inside the panel
  //      (don't fight active interaction).
  //
  // Active only when shouldShow is true (device page with iframe visible).
  // On other pages the effect cleans up — zero interference.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !url || isEmbedBlocked || !shouldShow) return;

    let mouseDownInPanel = false;

    const inPanel = (el: EventTarget | null): boolean =>
      el instanceof Element && !!el.closest('[data-ue-panel]');

    // (1) Block focus theft from everything outside panel & iframe
    const onMouseDown = (e: MouseEvent) => {
      if (inPanel(e.target)) {
        mouseDownInPanel = true;
        return;
      }
      e.preventDefault();
    };

    // (2) Reclaim focus after panel interaction
    const onMouseUp = (e: MouseEvent) => {
      if (!mouseDownInPanel) return;
      mouseDownInPanel = false;
      // <select> dropdown may still be open — let onChange handle it
      if (e.target instanceof HTMLSelectElement) return;
      requestAnimationFrame(() => {
        try { iframe.focus(); } catch { /* cross-origin */ }
      });
    };

    // (3) Handle <select>/<checkbox> completion
    const onChange = (e: Event) => {
      if (!inPanel(e.target)) return;
      requestAnimationFrame(() => {
        try { iframe.focus(); } catch { /* cross-origin */ }
      });
    };

    // (4) Polling safety net
    const poll = () => {
      if (mouseDownInPanel) return;
      if (document.activeElement === iframe) return;
      if (inPanel(document.activeElement)) return;
      try { iframe.focus(); } catch { /* cross-origin */ }
    };

    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('change', onChange);
    const pollId = window.setInterval(poll, 200);

    iframe.focus();

    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('mouseup', onMouseUp, true);
      document.removeEventListener('change', onChange);
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

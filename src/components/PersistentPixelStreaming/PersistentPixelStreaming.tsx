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
  'allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock';

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

  // ── Focus guard ────────────────────────────────────────────────────────
  // Keeps keyboard input locked to the PS iframe's content window.
  //
  // Key insight: iframe.focus() alone sets the <iframe> as activeElement
  // in the parent DOM but does NOT guarantee the iframe's content window
  // receives keyboard events.  contentWindow.focus() is required to
  // activate the browsing context for keyboard routing.
  //
  //   1. blur — immediate (next-frame) reclaim when iframe loses focus,
  //      unless a text-entry element or <select> currently needs it.
  //
  //   2. change — when a <select> closes or checkbox/radio toggles,
  //      reclaims focus after the value settles.
  //
  //   3. keydown Escape — reclaims when a <select> dismisses via Escape.
  //
  //   4. pointerup — reclaims when any pointer interaction ends (slider drag,
  //      click on non-focusable element, or panel close via outside click).
  //
  //   5. focusin — catches ALL focus transitions including the critical case
  //      where a focused element unmounts (e.g. UeControlPanel closes while
  //      <select> has focus → focus falls to <body>).  Neither blur (on the
  //      iframe) nor pointerup catches this because the iframe wasn't focused
  //      and pointerup fires before the React click handler unmounts the panel.
  //
  //   6. Polling (500 ms) — safety net for edge cases where everything else misses.
  const shouldShowRef = useRef(shouldShow);
  shouldShowRef.current = shouldShow;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !url || isEmbedBlocked) return;

    /** True for elements where the user is actively typing. */
    const isTextEntry = (el: Element | null): boolean =>
      (el instanceof HTMLInputElement &&
        /^(text|email|password|url|search|number|tel)$/.test(el.type)) ||
      el instanceof HTMLTextAreaElement;

    /** True for elements that need transient focus protection. */
    const keepFocus = (el: Element | null): boolean =>
      isTextEntry(el) || el instanceof HTMLSelectElement;

    /** Focus both the <iframe> element AND its content window. */
    const focusIframe = () => {
      try {
        iframe.focus();
        iframe.contentWindow?.focus();
      } catch { /* cross-origin — iframe.focus() alone is the fallback */ }
    };

    // (1) blur — reclaim within one frame unless a protected element took focus
    const onBlur = () => {
      if (!shouldShowRef.current) return;
      requestAnimationFrame(() => {
        if (!shouldShowRef.current) return;
        if (document.activeElement === iframe) return;
        if (keepFocus(document.activeElement)) return;
        focusIframe();
      });
    };
    iframe.addEventListener('blur', onBlur);

    // (2) change — reclaim after <select> closes or checkbox/radio toggles
    const onChange = (e: Event) => {
      if (!shouldShowRef.current) return;
      const t = e.target;
      if (
        t instanceof HTMLSelectElement ||
        (t instanceof HTMLInputElement && /^(checkbox|radio)$/.test(t.type))
      ) {
        setTimeout(focusIframe, 50);
      }
    };
    document.addEventListener('change', onChange, true);

    // (3) Escape — reclaim when <select> dropdown dismissed without change
    const onKeyDown = (e: KeyboardEvent) => {
      if (!shouldShowRef.current) return;
      if (e.key === 'Escape' && document.activeElement instanceof HTMLSelectElement) {
        setTimeout(focusIframe, 50);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    // (4) pointerup — reclaim when any pointer interaction ends.
    // Covers: slider drag release, click on non-focusable elements,
    // and panel close via outside click (focused element unmounts → body).
    const onPointerUp = () => {
      if (!shouldShowRef.current) return;
      requestAnimationFrame(() => {
        if (!shouldShowRef.current) return;
        if (document.activeElement === iframe) return;
        if (keepFocus(document.activeElement)) return;
        focusIframe();
      });
    };
    document.addEventListener('pointerup', onPointerUp, true);

    // (5) focusin — catches focus transitions the iframe blur handler can't see.
    // Critical for: focused element unmounts → focus falls to <body>.
    const onFocusIn = () => {
      if (!shouldShowRef.current) return;
      if (document.activeElement === iframe) return;
      if (keepFocus(document.activeElement)) return;
      requestAnimationFrame(() => {
        if (!shouldShowRef.current) return;
        if (document.activeElement === iframe) return;
        if (keepFocus(document.activeElement)) return;
        focusIframe();
      });
    };
    document.addEventListener('focusin', onFocusIn, true);

    // (6) Polling — slower safety net for edge cases
    const poll = () => {
      if (!shouldShowRef.current) return;
      if (document.activeElement === iframe) return;
      if (keepFocus(document.activeElement)) return;
      focusIframe();
    };
    const pollId = window.setInterval(poll, 500);

    return () => {
      iframe.removeEventListener('blur', onBlur);
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('focusin', onFocusIn, true);
      window.clearInterval(pollId);
    };
  }, [url, isEmbedBlocked]);

  // Immediate focus grab when streaming page becomes visible.
  useEffect(() => {
    if (!shouldShow) return;
    const iframe = iframeRef.current;
    if (!iframe || isEmbedBlocked) return;
    const id = requestAnimationFrame(() => {
      try {
        iframe.focus();
        iframe.contentWindow?.focus();
      } catch { /* cross-origin */ }
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
          iframeRef.current?.contentWindow?.focus();
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
  // rapid page switching.  When inactive the wrapper is moved off-screen
  // (keeping iframe dimensions for WebRTC quality) while remaining
  // focusable for the focus guard.
  const active = shouldShow && !loading;
  const wrapperStyle = useMemo<CSSProperties>(
    () =>
      active && viewport
        ? {
            position: 'fixed',
            left: viewport.left,
            top: viewport.top,
            width: viewport.width,
            height: viewport.height,
            overflow: 'hidden',
            zIndex: 3,
            background: '#1a1e2a',
            pointerEvents: 'auto',
          }
        : {
            position: 'fixed',
            left: -9999,
            top: -9999,
            width: viewport?.width ?? 1,
            height: viewport?.height ?? 1,
            overflow: 'hidden',
            pointerEvents: 'none',
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
          allow="autoplay; microphone; fullscreen; pointer-lock; xr-spatial-tracking; clipboard-write; gamepad; focus-without-user-activation"
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

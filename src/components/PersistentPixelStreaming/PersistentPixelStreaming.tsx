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
  const [proxiedUrl, setProxiedUrl] = useState<string | null>(null);

  // Configure the Vite PS proxy and compute same-origin iframe src.
  // This makes iframe.contentDocument accessible for the keyboard bridge.
  useEffect(() => {
    if (!pixelStreamingUrl) {
      setProxiedUrl(null);
      return;
    }

    let cancelled = false;
    try {
      const parsed = new URL(pixelStreamingUrl);
      const origin = parsed.origin;

      fetch('/api/ps-target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: origin }),
      })
        .then(() => {
          if (cancelled) return;
          let src = '/ps-proxy' + parsed.pathname + parsed.search;
          // Route signaling WebSocket through our proxy so the server
          // sees Origin: https://box.rvtr.ai instead of http://localhost
          if (!parsed.searchParams.has('ss')) {
            const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${wsProto}//${window.location.host}/ps-proxy/`;
            const sep = src.includes('?') ? '&' : '?';
            src += `${sep}ss=${wsUrl}`;
          }
          setProxiedUrl(src);
        })
        .catch(() => {
          if (cancelled) return;
          setProxiedUrl(pixelStreamingUrl); // fallback: cross-origin
        });
    } catch {
      setProxiedUrl(pixelStreamingUrl);
    }

    return () => {
      cancelled = true;
    };
  }, [pixelStreamingUrl]);

  if (!proxiedUrl) return null;

  return (
    <PersistentIframe
      key={mountGeneration}
      url={proxiedUrl}
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

// EXPERIMENT: sandbox disabled to test keyboard event delivery.
// const SANDBOX =
//   import.meta.env.VITE_IFRAME_SANDBOX ||
//   'allow-scripts allow-same-origin allow-forms allow-popups';

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

  // ── Keyboard bridge ──────────────────────────────────────────────────
  // NO iframe.focus() polling — programmatic focus creates a "black hole"
  // where keyboard events reach NEITHER the parent NOR the iframe content
  // (confirmed by badge showing ✅ iframe but keys not working).
  //
  // Instead: capture ALL keyboard events on the parent document and
  // forward them into the iframe's contentDocument (same-origin) or
  // via postMessage (cross-origin).
  //
  // When the user CLICKS on the iframe, it gets real browsing-context
  // focus — keyboard events go directly inside and never reach the parent,
  // so this bridge stays silent (no double-fire).
  const shouldShowRef = useRef(shouldShow);
  shouldShowRef.current = shouldShow;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !url || isEmbedBlocked) return;

    const isTypingInput = (el: Element | null): boolean =>
      el instanceof HTMLInputElement && /^(text|email|password|search|url|tel|number)$/.test(el.type) ||
      el instanceof HTMLTextAreaElement;

    const forwardKeyEvent = (e: KeyboardEvent) => {
      if (!shouldShowRef.current) return;
      // If iframe has real focus (user clicked it), keys go directly inside —
      // they never reach here, but guard just in case.
      if (document.activeElement === iframe) return;
      // Don't intercept typing in text fields
      if (isTypingInput(document.activeElement)) return;

      const init: KeyboardEventInit = {
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        which: e.which,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        repeat: e.repeat,
        bubbles: true,
        cancelable: true,
        composed: true,
      };

      // Same-origin: dispatch directly on content document
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          // Use iframe's own KeyboardEvent constructor (correct JS realm)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const KbdEvent = (iframe.contentWindow as any)?.KeyboardEvent ?? KeyboardEvent;
          doc.dispatchEvent(new KbdEvent(e.type, init));
          return;
        }
      } catch {
        // cross-origin → fall through to postMessage
      }

      // Cross-origin: postMessage
      try {
        iframe.contentWindow?.postMessage(
          { type: 'rvtr-keyboard', eventType: e.type, ...init },
          '*',
        );
      } catch { /* contentWindow not accessible */ }
    };

    document.addEventListener('keydown', forwardKeyEvent, true);
    document.addEventListener('keyup', forwardKeyEvent, true);

    return () => {
      document.removeEventListener('keydown', forwardKeyEvent, true);
      document.removeEventListener('keyup', forwardKeyEvent, true);
    };
  }, [url, isEmbedBlocked]);

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

    // Same-origin: inject click→focus inside iframe (like the game-iframe trick).
    // When user clicks inside the iframe, window.focus() gives it real
    // browsing-context focus so keyboard events go directly to PS.
    if (!blocked && iframe) {
      try {
        const win = iframe.contentWindow;
        const doc = iframe.contentDocument;
        if (win && doc) {
          win.focus();
          doc.addEventListener('click', () => win.focus());
        }
      } catch { /* cross-origin: keyboard bridge handles it */ }
    }
  }, []);

  const handleError = useCallback(() => {
    setIsEmbedBlocked(true);
    setLoading(false);
  }, []);

  // Parent-side: clicking the wrapper also focuses the iframe content window
  const handleWrapperClick = useCallback(() => {
    try {
      iframeRef.current?.contentWindow?.focus();
    } catch { /* cross-origin */ }
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
      <div style={wrapperStyle} onClick={handleWrapperClick}>
        <iframe
          ref={iframeRef}
          className={styles.persistentIframe}
          data-ps-iframe
          src={url}
          title="Pixel Streaming"
          tabIndex={0}
          // sandbox disabled — all permissions granted
          onLoad={handleLoad}
          onError={handleError}
          allow="autoplay; camera; microphone; fullscreen; display-capture; encrypted-media; picture-in-picture; clipboard-read; clipboard-write; gamepad; keyboard-map; screen-wake-lock; web-share; geolocation; midi; xr-spatial-tracking; window-management; idle-detection; hid; serial; usb; bluetooth; accelerometer; gyroscope; magnetometer; payment; local-fonts; compute-pressure; browsing-topics; identity-credentials-get; storage-access"
          referrerPolicy="no-referrer-when-downgrade"
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
      {shouldShow && <FocusBadge iframeRef={iframeRef} />}
    </>
  );
}

// ─── Debug badge — shows live focus state on screen ───

function FocusBadge({ iframeRef }: { iframeRef: React.RefObject<HTMLIFrameElement | null> }) {
  const [info, setInfo] = useState('…');

  useEffect(() => {
    const iframe = iframeRef.current;

    const tick = () => {
      // Origin check
      let origin = '?';
      if (iframe) {
        try {
          origin = iframe.contentDocument ? 'same' : 'cross';
        } catch {
          origin = 'cross';
        }
      }

      const ae = document.activeElement;
      const isIframe = ae === iframe;
      const tag = isIframe ? 'iframe' : (ae?.tagName?.toLowerCase() ?? 'null');
      setInfo(`${tag} | ${origin}`);
    };
    const id = window.setInterval(tick, 300);
    return () => window.clearInterval(id);
  }, [iframeRef]);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 8,
        left: 8,
        padding: '4px 10px',
        borderRadius: 6,
        background: 'rgba(0,0,0,0.75)',
        color: '#fff',
        fontSize: 11,
        fontFamily: 'monospace',
        zIndex: 99999,
        pointerEvents: 'none',
      }}
    >
      focus: {info}
    </div>
  );
}

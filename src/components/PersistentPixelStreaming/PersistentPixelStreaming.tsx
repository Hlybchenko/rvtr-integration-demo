import { useEffect, useRef, useCallback, useState, type CSSProperties } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useStreamingStore, type StreamingViewport } from '@/stores/streamingStore';
import styles from './PersistentPixelStreaming.module.css';

/**
 * Persistent position:fixed iframe for Pixel Streaming.
 *
 * Mounts when user clicks Connect on Settings page.
 * Unmounts on Disconnect or when Agent provider changes.
 * Follows the screen-slot viewport geometry from streamingStore.
 * Keeps WebRTC alive by re-focusing on blur.
 */
export function PersistentPixelStreaming() {
  const pixelStreamingUrl = useSettingsStore((s) => s.pixelStreamingUrl);
  const connected = useStreamingStore((s) => s.connected);
  const isVisible = useStreamingStore((s) => s.isVisible);
  const viewport = useStreamingStore((s) => s.viewport);

  // Don't render anything until user clicks Connect
  if (!connected) return null;

  return (
    <PersistentIframe
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

  // Blur → refocus for WebRTC keepalive.
  // Skip refocus when user interacts with UE control panel or other UI overlays
  // so that sliders, inputs and buttons work correctly.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !url || isEmbedBlocked) return;

    const refocus = () => {
      requestAnimationFrame(() => {
        // Don't steal focus from overlay UI elements
        const active = document.activeElement;
        if (
          active &&
          active !== document.body &&
          active !== iframe &&
          active.closest('[data-ue-panel]')
        ) {
          return;
        }
        try {
          iframeRef.current?.focus();
        } catch {
          // cross-origin — safe to ignore
        }
      });
    };

    iframe.addEventListener('blur', refocus);
    return () => iframe.removeEventListener('blur', refocus);
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

  // Reset loading state when URL changes
  useEffect(() => {
    setLoading(!!url);
    setIsEmbedBlocked(false);
  }, [url]);

  const shouldShow = isVisible && !!viewport;
  const resolvedSandbox = SANDBOX === 'none' ? undefined : SANDBOX;

  const iframeStyle: CSSProperties = viewport
    ? {
        position: 'fixed',
        left: viewport.left,
        top: viewport.top,
        width: viewport.width,
        height: viewport.height,
        borderRadius: viewport.borderRadius,
        zIndex: 3,
        border: 'none',
        background: '#0a0c14',
        pointerEvents: shouldShow ? 'auto' : 'none',
        opacity: shouldShow && !loading ? 1 : 0,
        transition: 'opacity 300ms ease',
      }
    : {
        position: 'fixed',
        left: -9999,
        top: -9999,
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: 'none',
      };

  if (!url) {
    return null;
  }

  return (
    <>
      <iframe
        ref={iframeRef}
        className={styles.persistentIframe}
        style={iframeStyle}
        src={url}
        title="Pixel Streaming"
        tabIndex={0}
        sandbox={resolvedSandbox}
        onLoad={handleLoad}
        onError={handleError}
        allow="autoplay; microphone; fullscreen"
      />
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

import { useEffect, useRef } from 'react';

/**
 * Debug harness for iframe focus investigation.
 *
 * Logs all focus-related events (focusin/focusout, blur/focus,
 * visibilitychange, activeElement changes) to the console.
 * Enable by setting VITE_DEBUG_FOCUS=1 in .env (or via console:
 *   window.__RVTR_DEBUG_FOCUS = true).
 *
 * Output format:
 *   [Focus] <event> | activeElement: <tag#id.class> | relatedTarget: <tag> | Δ<ms>
 */
const ENABLED =
  import.meta.env.VITE_DEBUG_FOCUS === '1' ||
  import.meta.env.VITE_DEBUG_FOCUS === 'true';

function isEnabled(): boolean {
  return ENABLED || (globalThis as Record<string, unknown>).__RVTR_DEBUG_FOCUS === true;
}

function describeElement(el: Element | null): string {
  if (!el) return '(null)';
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = el.className && typeof el.className === 'string'
    ? `.${el.className.split(/\s+/).slice(0, 2).join('.')}`
    : '';
  const extra =
    el instanceof HTMLInputElement ? ` [type=${el.type}]` :
    el instanceof HTMLIFrameElement ? ` [src=${el.src.slice(0, 60)}]` :
    '';
  return `${tag}${id}${cls}${extra}`;
}

/**
 * Mount this hook once (e.g. in AppShell) to instrument focus events.
 * All listeners are passive / capture and cleaned up on unmount.
 */
export function useFocusDebug(): void {
  const t0 = useRef(performance.now());

  useEffect(() => {
    if (!isEnabled()) return;

    const ts = () => `Δ${(performance.now() - t0.current).toFixed(0)}ms`;

    const log = (event: string, detail: string) => {
      console.log(
        `%c[Focus]%c ${event} | ${detail} | ${ts()}`,
        'color:#f59e0b;font-weight:bold',
        'color:inherit',
      );
    };

    const onFocusIn = (e: FocusEvent) => {
      log('focusin', `target: ${describeElement(e.target as Element)} | activeElement: ${describeElement(document.activeElement)} | relatedTarget: ${describeElement(e.relatedTarget as Element)}`);
    };
    const onFocusOut = (e: FocusEvent) => {
      log('focusout', `target: ${describeElement(e.target as Element)} | relatedTarget: ${describeElement(e.relatedTarget as Element)}`);
    };
    const onWindowBlur = () => {
      log('window.blur', `activeElement: ${describeElement(document.activeElement)}`);
    };
    const onWindowFocus = () => {
      log('window.focus', `activeElement: ${describeElement(document.activeElement)}`);
    };
    const onVisibility = () => {
      log('visibilitychange', `hidden=${document.hidden}`);
    };

    // Track iframe identity — detect remounts
    const iframeIdentity = new WeakSet<HTMLIFrameElement>();
    const iframeObserver = new MutationObserver(() => {
      const iframe = document.querySelector<HTMLIFrameElement>('[data-ps-iframe]');
      if (iframe && !iframeIdentity.has(iframe)) {
        iframeIdentity.add(iframe);
        log('iframe-mount', `new iframe node detected: ${describeElement(iframe)}`);
        iframe.addEventListener('load', () => log('iframe-load', describeElement(iframe)));
      }
    });
    iframeObserver.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisibility);

    console.log('%c[Focus] Debug harness active. Set window.__RVTR_DEBUG_FOCUS = false to disable.', 'color:#f59e0b');

    return () => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      iframeObserver.disconnect();
    };
  }, []);
}

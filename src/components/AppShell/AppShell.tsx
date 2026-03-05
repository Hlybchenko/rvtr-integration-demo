import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { PersistentPixelStreaming } from '@/components/PersistentPixelStreaming/PersistentPixelStreaming';
import { useStatusPolling } from '@/hooks/useStatusPolling';
import { useUiScale } from '@/hooks/useUiScale';
import { useJellyDrag } from '@/hooks/useJellyDrag';
import styles from './AppShell.module.css';

const PIN_STORAGE_KEY = 'rvtr-sidebar-pinned-v2';
const DESKTOP_MQ = '(min-width: 1100px)';

function resolveInitialPin(): boolean {
  if (!window.matchMedia(DESKTOP_MQ).matches) return false;
  const stored = window.localStorage.getItem(PIN_STORAGE_KEY);
  // Default to pinned on first visit (no stored preference)
  return stored === null || stored === '1';
}

/**
 * Root layout component that wraps every route.
 *
 * Responsibilities:
 *   - Renders the collapsible sidebar, burger toggle, and backdrop overlay.
 *   - Supports pinning the sidebar on desktop (persisted to localStorage).
 *   - Mounts <PersistentPixelStreaming /> once so the WebRTC iframe
 *     survives route transitions without reconnecting.
 *   - Starts global status polling (process health, PS reachability, UE health).
 *   - Auto-closes the sidebar on route change (unless pinned).
 */
export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pinned, setPinned] = useState(resolveInitialPin);
  const location = useLocation();

  // Global status polling (process, PS reachability, UE health)
  useStatusPolling();
  useUiScale();
  useJellyDrag();

  // Unpin when window shrinks below desktop breakpoint
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);
    const handler = (e: MediaQueryListEvent) => {
      if (!e.matches) {
        setPinned(false);
        window.localStorage.setItem(PIN_STORAGE_KEY, '0');
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Track "just opened" to play reveal animation only once (not on pin/unpin toggle)
  const [revealing, setRevealing] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((v) => {
      if (!v) {
        setRevealing(true);
        clearTimeout(revealTimer.current);
        revealTimer.current = setTimeout(() => setRevealing(false), 800);
      }
      return !v;
    });
  }, []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const togglePin = useCallback(() => {
    setPinned((prev) => {
      const next = !prev;
      window.localStorage.setItem(PIN_STORAGE_KEY, next ? '1' : '0');
      // Pinning: clear overlay open (sidebar stays visible via pinned state)
      // Unpinning: open as overlay so sidebar doesn't disappear
      setSidebarOpen(!next);
      return next;
    });
  }, []);

  const layoutClass = `${styles.layout} ${pinned ? styles.layoutPinned : ''}`;

  return (
    <div className={layoutClass}>
      {/* Burger button — animated out when pinned */}
      <button
        type="button"
        className={`${styles.burger} ${pinned ? styles.burgerPinned : ''}`}
        onClick={toggleSidebar}
        aria-label="Toggle navigation"
        aria-expanded={sidebarOpen}
        aria-hidden={pinned}
        tabIndex={pinned ? -1 : 0}
      >
        <span
          className={`${styles.burgerLine} ${sidebarOpen ? styles.burgerOpen : ''}`}
        />
      </button>

      {/* Backdrop — always rendered for smooth fade transitions */}
      <div
        className={`${styles.backdrop} ${sidebarOpen && !pinned ? styles.backdropVisible : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={closeSidebar}
        aria-hidden="true"
      />

      <Sidebar
        className={`${sidebarOpen || pinned ? styles.sidebarOpen : ''} ${revealing ? styles.sidebarRevealing : ''}`}
        pinned={pinned}
        revealing={revealing}
        onTogglePin={togglePin}
      />

      <main className={styles.main}>
        <div className={styles.content}>
          <div key={location.pathname} className={styles.pageTransition}>
            <Outlet />
          </div>
        </div>
      </main>

      <PersistentPixelStreaming />
    </div>
  );
}

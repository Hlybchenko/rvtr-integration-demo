import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useBlocker, useLocation } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import styles from './AppShell.module.css';

const MOBILE_BREAKPOINT = 768;

const SESSION_CLOSE_WAIT_MS = 400;

function closeRavatarSession() {
  const iframe = document.querySelector<HTMLIFrameElement>(
    'iframe[data-rvtr-preview="true"]',
  );
  iframe?.contentWindow?.postMessage('ravatar-session-close', '*');
}

export function AppShell() {
  const handledNavigationKeyRef = useRef<string | null>(null);
  const blockerTimerRef = useRef<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Close sidebar if window resizes above mobile breakpoint
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT}px)`);
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setSidebarOpen(false);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (currentLocation.pathname === nextLocation.pathname) return false;

    return Boolean(document.querySelector('iframe[data-rvtr-preview="true"]'));
  });

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      // Reset handled key when blocker resets so repeated navigations work
      if (blocker.state === 'unblocked') {
        handledNavigationKeyRef.current = null;
      }
      return;
    }

    const next = blocker.location;
    const navigationKey = next
      ? `${next.pathname}${next.search}${next.hash}`
      : '__unknown__';

    if (handledNavigationKeyRef.current === navigationKey) return;
    handledNavigationKeyRef.current = navigationKey;

    if (blockerTimerRef.current) {
      window.clearTimeout(blockerTimerRef.current);
      blockerTimerRef.current = null;
    }

    closeRavatarSession();

    blockerTimerRef.current = window.setTimeout(() => {
      blocker.proceed();
      blockerTimerRef.current = null;
    }, SESSION_CLOSE_WAIT_MS);
  }, [blocker.state, blocker.location, blocker]);

  useEffect(() => {
    return () => {
      if (blockerTimerRef.current) {
        window.clearTimeout(blockerTimerRef.current);
        blockerTimerRef.current = null;
      }
    };
  }, []);

  return (
    <div className={styles.layout}>
      {/* Mobile burger button */}
      <button
        type="button"
        className={styles.burger}
        onClick={toggleSidebar}
        aria-label="Toggle navigation"
        aria-expanded={sidebarOpen}
      >
        <span
          className={`${styles.burgerLine} ${sidebarOpen ? styles.burgerOpen : ''}`}
        />
      </button>

      {/* Backdrop (mobile only, when sidebar open) */}
      <div
        className={`${styles.backdrop} ${sidebarOpen ? styles.backdropVisible : ''}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />

      <Sidebar className={sidebarOpen ? styles.sidebarOpen : ''} />

      <main className={styles.main}>
        <div className={styles.content}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

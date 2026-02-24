import { useEffect, useRef } from 'react';
import { Outlet, useBlocker } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import styles from './AppShell.module.css';

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
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (currentLocation.pathname === nextLocation.pathname) return false;

    return Boolean(document.querySelector('iframe[data-rvtr-preview="true"]'));
  });

  useEffect(() => {
    if (blocker.state !== 'blocked') return;

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
      <Sidebar />
      <main className={styles.main}>
        <div className={styles.content}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

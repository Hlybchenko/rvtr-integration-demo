import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { PersistentPixelStreaming } from '@/components/PersistentPixelStreaming/PersistentPixelStreaming';
import { useStatusPolling } from '@/hooks/useStatusPolling';
import styles from './AppShell.module.css';

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Global status polling (process, PS reachability, UE health)
  useStatusPolling();

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <div className={styles.layout}>
      {/* Burger button */}
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

      {/* Backdrop (when sidebar open) */}
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

      <PersistentPixelStreaming />
    </div>
  );
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { devices } from '@/config/devices';
import {
  IconSettings,
  IconPhone,
  IconLaptop,
  IconKiosk,
  IconKebaKiosk,
  IconHolobox,
  IconFullscreen,
} from './NavIcons';
import styles from './Sidebar.module.css';

/**
 * App-wide navigation sidebar.
 *
 * Responsibilities:
 *   - Shows links to Settings (/) and each device page (/:deviceId).
 *   - Manages dark/light theme toggle (persisted to localStorage).
 *   - Initially hidden off-screen via CSS transform; slides in when
 *     the parent passes the `sidebarOpen` class from AppShell.
 */

type ThemeMode = 'dark' | 'light';
const THEME_STORAGE_KEY = 'rvtr-theme';

function resolveInitialTheme(): ThemeMode {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;

  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme: ThemeMode): void {
  const update = () => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  };

  // Use View Transition API for sunrise/sunset crossfade
  if ('startViewTransition' in document) {
    (document as unknown as { startViewTransition: (cb: () => void) => void })
      .startViewTransition(update);
  } else {
    update();
  }
}

const DEVICE_ICONS: Record<string, ReactNode> = {
  phone: <IconPhone />,
  laptop: <IconLaptop />,
  kiosk: <IconKiosk />,
  holobox: <IconHolobox />,
  'keba-kiosk': <IconKebaKiosk />,
  fullscreen: <IconFullscreen />,
};

interface SidebarProps {
  className?: string;
  pinned?: boolean;
  onTogglePin?: () => void;
}

export function Sidebar({ className, pinned, onTogglePin }: SidebarProps) {
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const navRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    const initial = resolveInitialTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  // Floating indicator — tracks the active nav link position
  const updateIndicator = useCallback(() => {
    const nav = navRef.current;
    const indicator = indicatorRef.current;
    if (!nav || !indicator) return;

    const active = nav.querySelector<HTMLElement>(`.${styles.navLinkActive}`);
    if (!active) {
      indicator.style.opacity = '0';
      return;
    }

    const navRect = nav.getBoundingClientRect();
    const linkRect = active.getBoundingClientRect();
    indicator.style.top = `${linkRect.top - navRect.top + nav.scrollTop}px`;
    indicator.style.height = `${linkRect.height}px`;
    indicator.style.opacity = '1';
  }, []);

  useEffect(() => {
    // Small delay to let NavLink update its active class
    const id = requestAnimationFrame(updateIndicator);
    return () => cancelAnimationFrame(id);
  }, [location.pathname, updateIndicator]);

  const switchTheme = (nextTheme: ThemeMode) => {
    setTheme(nextTheme);
    applyTheme(nextTheme);
  };

  return (
    <aside
      className={`${styles.sidebar} ${pinned ? styles.sidebarPinned : ''} ${className ?? ''}`}
      aria-label="Main navigation"
    >
      {/* Logo */}
      <div className={styles.logo}>
        <div className={styles.logoText}>
          <span className={styles.logoAccent}>RVTR</span> Integration Demo
        </div>
      </div>

      {/* Navigation */}
      <nav ref={navRef} className={styles.nav} role="navigation">
        {/* Floating active indicator */}
        <div ref={indicatorRef} className={styles.navIndicator} aria-hidden="true" />

        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
          }
        >
          <span className={styles.navIcon}><IconSettings /></span>
          Settings
        </NavLink>

        <span className={styles.navLabel}>Devices</span>
        {devices
          .filter((d) => d.id !== 'fullscreen')
          .map((device) => (
            <NavLink
              key={device.id}
              to={`/${device.id}`}
              className={({ isActive }) =>
                `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
              }
            >
              <span className={styles.navIcon}>{DEVICE_ICONS[device.id]}</span>
              {device.name}
            </NavLink>
          ))}

        <span className={styles.navLabel}>Display</span>
        <NavLink
          to="/fullscreen"
          className={({ isActive }) =>
            `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
          }
        >
          <span className={styles.navIcon}>{DEVICE_ICONS.fullscreen}</span>
          Fullscreen
        </NavLink>

        <div className={styles.navBottom}>
          {onTogglePin && (
            <button
              type="button"
              className={`${styles.pinButton} ${pinned ? styles.pinned : ''}`}
              onClick={onTogglePin}
              aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
              aria-pressed={pinned}
            >
              <span className={styles.pinLabel}>{pinned ? 'Pinned' : 'Pin sidebar'}</span>
              <span className={styles.pinIconWrap} aria-hidden="true">
                <span className={styles.pinShadow} />
                <span className={styles.pinNeedle} />
                <span className={styles.pinHead}>
                  <span className={styles.pinShine} />
                </span>
                <span className={styles.pinRipple} />
              </span>
            </button>
          )}
          <div className={styles.themeRow}>
            <span className={styles.themeModeText}>
              {theme === 'dark' ? 'Dark mode' : 'Light mode'}
            </span>
            <button
              type="button"
              className={`${styles.themeToggle} ${theme === 'light' ? styles.themeToggleLight : styles.themeToggleDark}`}
              onClick={() => switchTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              aria-pressed={theme === 'light'}
            >
              <span className={styles.themeToggleTrack}>
                <span className={styles.themeToggleThumb}>
                  <span className={styles.themeGlyph} aria-hidden="true" />
                </span>
              </span>
            </button>
          </div>
        </div>
      </nav>
    </aside>
  );
}

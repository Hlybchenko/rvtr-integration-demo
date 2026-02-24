import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { devices } from '@/config/devices';
import styles from './Sidebar.module.css';

type ThemeMode = 'dark' | 'light';
const THEME_STORAGE_KEY = 'rvtr-theme';

function resolveInitialTheme(): ThemeMode {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;

  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme: ThemeMode): void {
  document.documentElement.setAttribute('data-theme', theme);
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

const DEVICE_ICONS: Record<string, string> = {
  phone: '📱',
  laptop: '💻',
  kiosk: '🖥️',
  holobox: '🔲',
  'keba-kiosk': '🏧',
};

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const [theme, setTheme] = useState<ThemeMode>('dark');

  useEffect(() => {
    const initial = resolveInitialTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const switchTheme = (nextTheme: ThemeMode) => {
    setTheme(nextTheme);
    applyTheme(nextTheme);
  };

  return (
    <aside
      className={`${styles.sidebar} ${className ?? ''}`}
      aria-label="Main navigation"
    >
      {/* Logo */}
      <div className={styles.logo}>
        <div className={styles.logoText}>
          <span className={styles.logoAccent}>RVTR</span> Integration Demo
        </div>
      </div>

      {/* Navigation */}
      <nav className={styles.nav} role="navigation">
        {/* <span className={styles.navLabel}>General</span> */}
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
          }
        >
          <span className={styles.navIcon}>⚙️</span>
          Settings
        </NavLink>

        <span className={styles.navLabel}>Devices</span>
        {devices.map((device) => (
          <NavLink
            key={device.id}
            to={`/${device.id}`}
            className={({ isActive }) =>
              `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
            }
          >
            <span className={styles.navIcon}>{DEVICE_ICONS[device.id] || '📦'}</span>
            {device.name}
          </NavLink>
        ))}

        <div className={styles.navBottom}>
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

import { NavLink } from 'react-router-dom';
import { devices } from '@/config/devices';
import { useHealthCheck } from '@/hooks/useHealthCheck';
import styles from './Sidebar.module.css';

const DEVICE_ICONS: Record<string, string> = {
  phone: '📱',
  laptop: '💻',
  kiosk: '🖥️',
  holobox: '🔲',
};

export function Sidebar() {
  useHealthCheck();

  return (
    <aside className={styles.sidebar} aria-label="Main navigation">
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
            <span className={styles.navIcon}>
              {DEVICE_ICONS[device.id] || '📦'}
            </span>
            {device.name}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

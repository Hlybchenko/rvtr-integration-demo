import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { devices } from '@/config/devices';
import { useSettingsStore } from '@/stores/settingsStore';
import { isValidUrl } from '@/utils/isValidUrl';
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

/** Prevent mousedown from stealing focus from the PS iframe.
 *  Click events still fire; keyboard Tab navigation is unaffected. */
const preventFocusSteal = (e: React.MouseEvent) => e.preventDefault();

const ENV_WIDGET_URL = import.meta.env.VITE_DEFAULT_WIDGET_URL || '';

export function Sidebar({ className, pinned, onTogglePin }: SidebarProps) {
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const navRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const logoMarkRef = useRef<SVGSVGElement>(null);
  const logoRafRef = useRef<number | null>(null);
  const location = useLocation();

  // UI scale
  const uiScale = useSettingsStore((s) => s.uiScale);
  const setUiScale = useSettingsStore((s) => s.setUiScale);
  const scaleDialRef = useRef<HTMLDivElement>(null);
  const [isDraggingScale, setIsDraggingScale] = useState(false);

  const scaleValue = uiScale ?? 1;
  const scaleRotation = ((scaleValue - 0.7) / 0.6) * 270 - 135;

  // Dial drag — horizontal mouse movement maps to scale value
  const handleScaleDialDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingScale(true);
    document.body.style.cursor = 'grabbing';
    const startX = e.clientX;
    const startVal = useSettingsStore.getState().uiScale ?? 1;

    const handleMove = (ev: MouseEvent) => {
      // ~400px of horizontal drag covers the full 0.7–1.3 range (0.6 / 400)
      const delta = (ev.clientX - startX) / 400;
      const raw = startVal + delta * 0.6;
      const clamped = Math.min(1.3, Math.max(0.7, raw));
      const snapped = Math.round(clamped * 20) / 20;
      useSettingsStore.getState().setUiScale(snapped);
    };

    const handleUp = () => {
      setIsDraggingScale(false);
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, []);

  // Wheel support on the dial (passive: false to prevent nav scroll).
  // Accumulates sub-pixel deltas so trackpad inertia scrolling is very smooth —
  // you need a long swipe for meaningful change (~600px of scroll = full range).
  useEffect(() => {
    const el = scaleDialRef.current;
    if (!el) return;
    let accum = 0;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // deltaMode 1 = lines (~40px each), 0 = pixels
      const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      // ~600px of scroll covers the full 0.7–1.3 range (0.6 / 600 = 0.001 per px)
      accum -= px * 0.001;
      // Snap to nearest 0.05 only when accumulated enough
      const current = useSettingsStore.getState().uiScale ?? 1;
      const target = current + accum;
      const snapped = Math.round(Math.min(1.3, Math.max(0.7, target)) * 20) / 20;
      if (snapped !== current) {
        useSettingsStore.getState().setUiScale(snapped);
        // Consume only the portion that caused the step, keep leftover
        accum = target - snapped;
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // Hide phone/laptop nav items when no valid URL is configured
  const phoneUrl = useSettingsStore((s) => s.phoneUrl);
  const laptopUrl = useSettingsStore((s) => s.laptopUrl);
  const hasPhoneUrl = isValidUrl(phoneUrl) || isValidUrl(ENV_WIDGET_URL);
  const hasLaptopUrl = isValidUrl(laptopUrl) || isValidUrl(ENV_WIDGET_URL);

  useEffect(() => {
    const initial = resolveInitialTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  // ── Magnetic logo — tilts toward cursor ──────────────────────────────────────
  const MAX_TILT = 14;

  const handleLogoMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const logo = logoRef.current;
    const mark = logoMarkRef.current;
    if (!logo || !mark) return;

    // Disable CSS animation so inline transform takes effect
    mark.classList.add(styles.logoMarkMagnetic!);

    if (logoRafRef.current) cancelAnimationFrame(logoRafRef.current);
    logoRafRef.current = requestAnimationFrame(() => {
      const rect = logo.getBoundingClientRect();
      // -1..1 from center
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;

      // rotateY follows X, rotateX is inverted Y (tilt toward cursor)
      const rotY = x * MAX_TILT;
      const rotX = -y * MAX_TILT;

      mark.style.transform =
        `perspective(200px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(1.08)`;
    });
  }, []);

  const handleLogoMouseLeave = useCallback(() => {
    const mark = logoMarkRef.current;
    if (!mark) return;
    if (logoRafRef.current) cancelAnimationFrame(logoRafRef.current);
    // Spring-back to resting position, then re-enable idle animation
    mark.style.transition = 'transform 600ms cubic-bezier(0.34, 1.56, 0.64, 1)';
    mark.style.transform = '';
    const onEnd = () => {
      mark.classList.remove(styles.logoMarkMagnetic!);
      mark.style.transition = '';
      mark.removeEventListener('transitionend', onEnd);
    };
    mark.addEventListener('transitionend', onEnd);
  }, []);

  // Floating indicator — tracks the active nav link position with jelly stretch
  const prevIndicatorTop = useRef<number | null>(null);
  const jellyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const updateIndicator = useCallback(() => {
    const nav = navRef.current;
    const indicator = indicatorRef.current;
    if (!nav || !indicator) return;

    const active = nav.querySelector<HTMLElement>(`.${styles.navLinkActive}`);
    if (!active) {
      indicator.style.opacity = '0';
      prevIndicatorTop.current = null;
      return;
    }

    const navRect = nav.getBoundingClientRect();
    const linkRect = active.getBoundingClientRect();
    const pad = 5;
    const newTop = linkRect.top - navRect.top + nav.scrollTop - pad;
    const targetH = linkRect.height + pad * 2;
    const oldTop = prevIndicatorTop.current;

    // Jelly stretch: if moving, temporarily stretch partway toward old position
    if (oldTop !== null && oldTop !== newTop) {
      const distance = newTop - oldTop;
      // Only stretch 40% of the gap — subtle pull, not full rubber band
      const stretchTop = newTop - distance * 0.4;
      const stretchH = targetH + Math.abs(distance) * 0.4;

      indicator.style.top = `${Math.min(stretchTop, newTop)}px`;
      indicator.style.height = `${stretchH}px`;
      indicator.style.borderRadius = '6px';
      indicator.style.opacity = '1';

      clearTimeout(jellyTimer.current);
      jellyTimer.current = setTimeout(() => {
        indicator.style.top = `${newTop}px`;
        indicator.style.height = `${targetH}px`;
        indicator.style.borderRadius = '';
      }, 120);
    } else {
      indicator.style.top = `${newTop}px`;
      indicator.style.height = `${targetH}px`;
      indicator.style.opacity = '1';
    }

    prevIndicatorTop.current = newTop;
  }, []);

  useEffect(() => {
    // Small delay to let NavLink update its active class
    const id = requestAnimationFrame(updateIndicator);
    return () => cancelAnimationFrame(id);
  }, [location.pathname, updateIndicator]);

  // Re-position the indicator when scale changes (including during the --scale CSS transition).
  // Uses rAF polling during the 450ms bounce transition for smooth tracking.
  useEffect(() => {
    updateIndicator();
    let frameId: number;
    const start = performance.now();
    const poll = () => {
      updateIndicator();
      if (performance.now() - start < 500) frameId = requestAnimationFrame(poll);
    };
    frameId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frameId);
  }, [uiScale, updateIndicator]);

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
      <div
        ref={logoRef}
        className={styles.logo}
        onMouseMove={handleLogoMouseMove}
        onMouseLeave={handleLogoMouseLeave}
      >
        <svg
          ref={logoMarkRef}
          className={styles.logoMark}
          width="44"
          height="40"
          viewBox="0 0 40 36"
          fill="none"
          aria-hidden="true"
        >
          <defs>
            {/* Metallic red gradient — 3D depth on arrow shafts */}
            <linearGradient id="arrowMetal" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#9a2820" />
              <stop offset="30%" stopColor="#EB4D3D" />
              <stop offset="48%" stopColor="#ff8a7a" />
              <stop offset="70%" stopColor="#EB4D3D" />
              <stop offset="100%" stopColor="#9a2820" />
            </linearGradient>
            {/* Dark metallic gradient for prism */}
            <linearGradient id="prismMetal" x1="0.2" y1="0" x2="0.8" y2="1">
              <stop offset="0%" stopColor="#1a1d28" />
              <stop offset="25%" stopColor="#2a2f3d" />
              <stop offset="50%" stopColor="#363c4e" />
              <stop offset="75%" stopColor="#252a38" />
              <stop offset="100%" stopColor="#14171f" />
            </linearGradient>
            <linearGradient id="prismEdge" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#6a7290" />
              <stop offset="50%" stopColor="#8890a8" />
              <stop offset="100%" stopColor="#5a6280" />
            </linearGradient>
          </defs>

          {/* ── Central prism ── */}
          {/* Filled triangle — dark metallic */}
          <path
            className={styles.logoFacetFill}
            d="M11.5 6.3 H28.5 L20 23.5 Z"
            fill="url(#prismMetal)"
          />
          {/* Outer stroke — subtle metallic edge */}
          <path
            className={styles.logoPrismOuter}
            d="M11.5 6.3 H28.5 L20 23.5 Z"
            stroke="url(#prismEdge)"
            strokeWidth="1.1"
            strokeLinejoin="round"
            fill="none"
          />
          {/* Inner edges — faceted look */}
          <path
            className={styles.logoEdgeInner}
            d="M28.5 6.3 L20 12.5 L11.5 6.3 M20 12.5 L20 23.5"
            stroke="url(#prismEdge)"
            strokeWidth="0.6"
            fill="none"
          />

          {/* ── Red accents — arrow-like radiating brackets ── */}

          {/* ─ Top-left arrow ─ */}
          <g className={styles.logoArrowTL}>
            <path
              d="M10.5 1.2 H2.8 L7 8.5"
              stroke="url(#arrowMetal)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </g>

          {/* ─ Top-right arrow ─ */}
          <g className={styles.logoArrowTR}>
            <path
              d="M29.5 1.2 H37.2 L33 8.5"
              stroke="url(#arrowMetal)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </g>

          {/* ─ Bottom arrow (V chevron) ─ */}
          <g className={styles.logoArrowBot}>
            <path
              d="M15.5 26 L20 34 L24.5 26"
              stroke="url(#arrowMetal)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </g>
          {/* Midpoint energy dots */}
          <circle className={styles.logoMidTL} cx="4.8" cy="5" r="0.4" fill="#EB4D3D" />
          <circle className={styles.logoMidTR} cx="35.2" cy="5" r="0.4" fill="#EB4D3D" />
          <circle className={styles.logoMidBot} cx="17.8" cy="30" r="0.4" fill="#EB4D3D" />
        </svg>
        <div className={styles.logoTextWrap}>
          <span className={styles.logoTitle}>
            <span className={styles.logoAccent}>RAVATAR</span>
          </span>
          <span className={styles.logoSub}>Integration Demo</span>
        </div>
      </div>

      {/* Navigation */}
      <nav ref={navRef} className={styles.nav} role="navigation">
        {/* Floating active indicator */}
        <div ref={indicatorRef} className={styles.navIndicator} aria-hidden="true" />

        <NavLink
          to="/"
          end
          onMouseDown={preventFocusSteal}
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
          .filter((d) => {
            if (d.id === 'phone') return hasPhoneUrl;
            if (d.id === 'laptop') return hasLaptopUrl;
            return true;
          })
          .map((device) => (
            <NavLink
              key={device.id}
              to={`/${device.id}`}
              onMouseDown={preventFocusSteal}
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
          onMouseDown={preventFocusSteal}
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
              onMouseDown={preventFocusSteal}
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
          <div className={styles.scaleRow}>
            <span className={styles.scaleLabel}>UI Scale</span>
            <div
              ref={scaleDialRef}
              className={`${styles.scaleDial} ${isDraggingScale ? styles.scaleDialActive : ''}`}
              style={{ '--dial-angle': `${scaleRotation}deg` } as React.CSSProperties}
              onMouseDown={handleScaleDialDown}
              onDoubleClick={() => setUiScale(null)}
              title={uiScale === null ? 'Auto (DPI-aware) · Double-click to reset' : `${Math.round(uiScale * 100)}% · Double-click to reset`}
              tabIndex={-1}
            >
              <div className={styles.scaleDialWave} />
              <div
                className={styles.scaleDialRing}
                style={{ transform: `rotate(${scaleRotation}deg)` }}
              />
              <div className={styles.scaleDialLens}>
                <span className={styles.scaleDialValue}>
                  {uiScale === null ? 'Auto' : Math.round(uiScale * 100)}
                </span>
              </div>
            </div>
          </div>
          <div className={styles.themeRow}>
            <span className={styles.themeModeText}>
              {theme === 'dark' ? 'Dark mode' : 'Light mode'}
            </span>
            <button
              type="button"
              className={`${styles.themeToggle} ${theme === 'light' ? styles.themeToggleLight : styles.themeToggleDark}`}
              onMouseDown={preventFocusSteal}
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

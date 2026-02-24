import { useEffect, useState } from 'react';
import styles from './TopBar.module.css';

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

export function TopBar() {
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
    <header className={styles.topBar}>
      <div className={styles.brand}></div>

      <div className={styles.themeSwitch} role="group" aria-label="Theme switcher">
        <button
          type="button"
          className={`${styles.themeBtn} ${theme === 'dark' ? styles.themeBtnActive : ''}`}
          onClick={() => switchTheme('dark')}
          aria-pressed={theme === 'dark'}
        >
          Dark
        </button>
        <button
          type="button"
          className={`${styles.themeBtn} ${theme === 'light' ? styles.themeBtnActive : ''}`}
          onClick={() => switchTheme('light')}
          aria-pressed={theme === 'light'}
        >
          Light
        </button>
      </div>
    </header>
  );
}

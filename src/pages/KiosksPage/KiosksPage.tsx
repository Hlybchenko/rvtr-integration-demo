import { useState, useCallback } from 'react';
import {
  useKiosksStore,
  KIOSK_SHORTCUTS,
  type ShortcutId,
} from '@/stores/kiosksStore';
import { browseForExe, startProcess } from '@/services/voiceAgentWriter';
import styles from './KiosksPage.module.css';

const IS_WINDOWS =
  typeof navigator !== 'undefined' &&
  (/win/i.test(navigator.userAgent) ||
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ===
      'Windows');

export function KiosksPage() {
  const paths = useKiosksStore((s) => s.paths);
  const setPath = useKiosksStore((s) => s.setPath);

  const [browsing, setBrowsing] = useState<ShortcutId | null>(null);
  const [starting, setStarting] = useState<ShortcutId | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ShortcutId, string>>>({});

  const clearError = useCallback((id: ShortcutId) => {
    setErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const handleBrowse = useCallback(async (id: ShortcutId) => {
    setBrowsing(id);
    clearError(id);
    try {
      const result = await browseForExe();
      if (result.cancelled) return;
      if (result.exePath) {
        setPath(id, result.exePath);
      } else {
        setErrors((prev) => ({
          ...prev,
          [id]: result.errors.join('; ') || 'Browse failed',
        }));
      }
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setBrowsing(null);
    }
  }, [setPath, clearError]);

  const handleStart = useCallback(async (id: ShortcutId) => {
    const exePath = useKiosksStore.getState().paths[id];
    if (!exePath) return;

    setStarting(id);
    clearError(id);
    try {
      const result = await startProcess(exePath);
      if (!result.ok) {
        setErrors((prev) => ({
          ...prev,
          [id]: result.error ?? 'Failed to start',
        }));
      }
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setStarting(null);
    }
  }, [clearError]);

  return (
    <div className={styles.page}>
      <section className={styles.block}>
        <h2 className={styles.blockTitle}>Process</h2>

        {KIOSK_SHORTCUTS.map((shortcut) => {
          const value = paths[shortcut.id];
          const error = errors[shortcut.id];
          const isBrowsing = browsing === shortcut.id;
          const isStarting = starting === shortcut.id;
          const hasPath = value.trim().length > 0;

          return (
            <div key={shortcut.id} className={styles.field}>
              <label className={styles.label} htmlFor={`kiosk-${shortcut.id}`}>
                {shortcut.label}
              </label>
              <div className={styles.row}>
                <input
                  id={`kiosk-${shortcut.id}`}
                  className={`${styles.input} ${error ? styles.inputError : ''}`}
                  type="text"
                  placeholder={IS_WINDOWS ? 'C:\\Users\\Desktop\\shortcut.lnk' : '/path/to/shortcut'}
                  value={value}
                  onChange={(e) => {
                    setPath(shortcut.id, e.target.value);
                    clearError(shortcut.id);
                  }}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className={styles.browseButton}
                  onClick={() => void handleBrowse(shortcut.id)}
                  disabled={isBrowsing}
                >
                  {isBrowsing ? '...' : 'Browse'}
                </button>
                <button
                  type="button"
                  className={styles.startButton}
                  onClick={() => void handleStart(shortcut.id)}
                  disabled={!hasPath || isStarting}
                >
                  {isStarting ? '...' : 'Start'}
                </button>
              </div>
              {error && <span className={styles.error}>{error}</span>}
            </div>
          );
        })}
      </section>
    </div>
  );
}

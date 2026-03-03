import { useState, useCallback, useEffect, useRef } from 'react';
import {
  useKiosksStore,
  KIOSK_SHORTCUTS,
  type ShortcutId,
} from '@/stores/kiosksStore';
import {
  browseForExe,
  startProcess,
  stopProcess,
  getProcessStatus,
} from '@/services/voiceAgentWriter';
import styles from './KiosksPage.module.css';

const IS_WINDOWS =
  typeof navigator !== 'undefined' &&
  (/win/i.test(navigator.userAgent) ||
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ===
      'Windows');

const POLL_INTERVAL_MS = 3_000;

export function KiosksPage() {
  const paths = useKiosksStore((s) => s.paths);
  const setPath = useKiosksStore((s) => s.setPath);

  const [browsing, setBrowsing] = useState<ShortcutId | null>(null);
  const [starting, setStarting] = useState<ShortcutId | null>(null);
  const [stopping, setStopping] = useState<ShortcutId | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ShortcutId, string>>>({});
  const [running, setRunning] = useState<Partial<Record<ShortcutId, boolean>>>({});

  const clearError = useCallback((id: ShortcutId) => {
    setErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // Poll process statuses
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const status = await getProcessStatus();
        if (cancelled) return;
        const next: Partial<Record<ShortcutId, boolean>> = {};
        for (const s of KIOSK_SHORTCUTS) {
          next[s.id] = status.processes[s.id]?.running === true;
        }
        setRunning(next);
      } catch {
        // Backend unreachable — clear all
        if (!cancelled) setRunning({});
      }
    };

    const loop = async () => {
      await poll();
      if (!cancelled) {
        timerRef.current = setTimeout(() => void loop(), POLL_INTERVAL_MS);
      }
    };

    void loop();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
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
      const result = await startProcess(exePath, id);
      if (!result.ok) {
        setErrors((prev) => ({ ...prev, [id]: result.error ?? 'Failed to start' }));
      } else {
        setRunning((prev) => ({ ...prev, [id]: true }));
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

  const handleStop = useCallback(async (id: ShortcutId) => {
    setStopping(id);
    clearError(id);
    try {
      const result = await stopProcess(id);
      if (!result.ok) {
        setErrors((prev) => ({ ...prev, [id]: result.error ?? 'Failed to stop' }));
      } else {
        setRunning((prev) => ({ ...prev, [id]: false }));
      }
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setStopping(null);
    }
  }, [clearError]);

  const handleRestart = useCallback(async (id: ShortcutId) => {
    const exePath = useKiosksStore.getState().paths[id];
    if (!exePath) return;

    setStarting(id);
    clearError(id);
    try {
      // Stop then start with same processId
      await stopProcess(id);
      const result = await startProcess(exePath, id);
      if (!result.ok) {
        setErrors((prev) => ({ ...prev, [id]: result.error ?? 'Failed to restart' }));
        setRunning((prev) => ({ ...prev, [id]: false }));
      } else {
        setRunning((prev) => ({ ...prev, [id]: true }));
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
          const isRunning = running[shortcut.id] === true;
          const isBrowsing = browsing === shortcut.id;
          const isStarting = starting === shortcut.id;
          const isStopping = stopping === shortcut.id;
          const hasPath = value.trim().length > 0;

          return (
            <div key={shortcut.id} className={styles.field}>
              <div className={styles.fieldHeader}>
                <label className={styles.label} htmlFor={`kiosk-${shortcut.id}`}>
                  {shortcut.label}
                </label>
                {isRunning && (
                  <span className={styles.badgeRunning}>Running</span>
                )}
              </div>
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
                {isRunning ? (
                  <>
                    <button
                      type="button"
                      className={styles.restartButton}
                      onClick={() => void handleRestart(shortcut.id)}
                      disabled={isStarting}
                      title="Restart"
                    >
                      {isStarting ? '...' : 'Restart'}
                    </button>
                    <button
                      type="button"
                      className={styles.stopButton}
                      onClick={() => void handleStop(shortcut.id)}
                      disabled={isStopping}
                    >
                      {isStopping ? '...' : 'Stop'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.startButton}
                    onClick={() => void handleStart(shortcut.id)}
                    disabled={!hasPath || isStarting}
                  >
                    {isStarting ? '...' : 'Start'}
                  </button>
                )}
              </div>
              {error && <span className={styles.error}>{error}</span>}
            </div>
          );
        })}
      </section>
    </div>
  );
}

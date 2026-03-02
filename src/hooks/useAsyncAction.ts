import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseAsyncActionResult {
  execute: (...args: unknown[]) => Promise<void>;
  isRunning: boolean;
  error: string | null;
  clearError: () => void;
}

export function useAsyncAction(
  actionFn: (...args: unknown[]) => Promise<void>,
): UseAsyncActionResult {
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const fnRef = useRef(actionFn);
  fnRef.current = actionFn;

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const execute = useCallback(async (...args: unknown[]) => {
    setIsRunning(true);
    setError(null);
    try {
      await fnRef.current(...args);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current) {
        setIsRunning(false);
      }
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { execute, isRunning, error, clearError };
}

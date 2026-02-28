import { useCallback, useEffect, useState } from 'react';

/**
 * Manages a file/exe path input with debounced auto-save and native browse dialog.
 *
 * Encapsulates the repetitive pattern used for both the license-file path and
 * the executable path on the Settings page:
 *   - Local `input` state (what the user types)
 *   - Debounced save to the backend after 400ms of inactivity
 *   - Browse button that opens a native OS file picker via the backend
 *   - Validation display (saved/error/resolvedPath)
 *
 * The hook is intentionally generic: callers pass the save and browse functions
 * so the same logic works for any path field.
 */

const AUTO_SAVE_DEBOUNCE_MS = 400;

/** Normalized result from a native file picker dialog. */
export interface BrowseResult {
  cancelled: boolean;
  path: string | null;
  valid: boolean;
  errors: string[];
}

/** Result from a backend path-save operation. */
export interface SaveResult {
  ok: boolean;
  error?: string;
  resolvedPath?: string | null;
}

interface UsePathConfigOptions {
  /** Current persisted path from the store. */
  initialValue: string;
  /** Persist the resolved path to the store. */
  onSaved: (resolvedPath: string) => void;
  /** Backend call to validate and save the path. */
  saveFn: (path: string) => Promise<SaveResult>;
  /**
   * Backend call to open a native file picker.
   * Should return a normalized `BrowseResult`.
   */
  browseFn: () => Promise<BrowseResult>;
  /** Error suffix for the "path not found" message. */
  notFoundMessage?: string;
}

export interface PathConfigState {
  /** Current input value (may differ from persisted value during typing). */
  input: string;
  setInput: (value: string) => void;
  /** Whether the path has been successfully saved to the backend. */
  saved: boolean;
  /** Whether a save or browse operation is in progress. */
  isSaving: boolean;
  isBrowsing: boolean;
  /** Validation error message, if any. */
  error: string | null;
  /** Backend-resolved absolute path (shown under the input). */
  resolvedPath: string | null;
  /** Opens the native file picker. */
  onBrowse: () => Promise<void>;
  /** Whether the path is fully configured (saved + no error). */
  isConfigured: boolean;
  /**
   * Directly set the input, saved, resolvedPath, and error state.
   * Used by the init effect to reconcile backend config on mount.
   */
  setFromBackend: (path: string, saved: boolean, error?: string | null) => void;
}

export function usePathConfig({
  initialValue,
  onSaved,
  saveFn,
  browseFn,
  notFoundMessage = 'Path not found',
}: UsePathConfigOptions): PathConfigState {
  const [input, setInput] = useState(initialValue);
  const [isSaving, setIsSaving] = useState(false);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [saved, setSaved] = useState(!!initialValue);
  const [error, setError] = useState<string | null>(null);
  const [resolvedPath, setResolvedPath] = useState<string | null>(null);

  // Debounced auto-save: fires 400ms after user stops typing
  useEffect(() => {
    const trimmed = input.trim();
    if (!trimmed || saved || isSaving || isBrowsing || error) return;

    const timer = setTimeout(() => {
      void (async () => {
        setIsSaving(true);
        setError(null);
        setResolvedPath(null);

        try {
          const result = await saveFn(trimmed);
          if (!result.ok) {
            setError(result.error ?? notFoundMessage);
            setResolvedPath(result.resolvedPath ?? null);
            setSaved(false);
          } else {
            onSaved(result.resolvedPath ?? trimmed);
            setResolvedPath(result.resolvedPath ?? null);
            setSaved(true);
            setError(null);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setSaved(false);
        } finally {
          setIsSaving(false);
        }
      })();
    }, AUTO_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [input, saved, isSaving, isBrowsing, error, saveFn, onSaved, notFoundMessage]);

  const onBrowse = useCallback(async () => {
    setIsBrowsing(true);
    setError(null);

    try {
      const result = await browseFn();
      if (result.cancelled) return;

      if (!result.path) {
        setError(
          result.errors.join('; ') || 'File picker failed. Try again or enter the path manually.',
        );
        return;
      }

      setInput(result.path);

      if (result.valid) {
        const saveResult = await saveFn(result.path);
        if (saveResult.ok) {
          onSaved(saveResult.resolvedPath ?? result.path);
          setResolvedPath(saveResult.resolvedPath ?? result.path);
          setSaved(true);
          setError(null);
        } else {
          setError(saveResult.error ?? 'Could not save — file may be missing or inaccessible');
          setSaved(false);
        }
      } else {
        setError(result.errors.join('; ') || 'Selected file is not valid');
        setSaved(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Browse timed out — the local server may be unresponsive');
      } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setError('Cannot reach the local server. Make sure the backend is running.');
      } else {
        setError(msg);
      }
    } finally {
      setIsBrowsing(false);
    }
  }, [browseFn, saveFn, onSaved]);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    setSaved(false);
    setError(null);
  }, []);

  const setFromBackend = useCallback(
    (path: string, isSaved: boolean, backendError?: string | null) => {
      setInput(path);
      setResolvedPath(path);
      setSaved(isSaved);
      setError(backendError ?? null);
    },
    [],
  );

  return {
    input,
    setInput: handleInputChange,
    saved,
    isSaving,
    isBrowsing,
    error,
    resolvedPath,
    onBrowse,
    isConfigured: saved && !error,
    setFromBackend,
  };
}

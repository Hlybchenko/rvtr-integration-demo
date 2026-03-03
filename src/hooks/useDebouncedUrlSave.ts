import { useEffect, useRef, useState } from 'react';
import { isValidUrl } from '@/utils/isValidUrl';

export interface UseDebouncedUrlSaveOptions {
  storeValue: string;
  saveFn: (value: string) => void;
  debounceMs?: number;
}

export interface UseDebouncedUrlSaveResult {
  input: string;
  setInput: (value: string) => void;
  isSaving: boolean;
}

export function useDebouncedUrlSave({
  storeValue,
  saveFn,
  debounceMs = 400,
}: UseDebouncedUrlSaveOptions): UseDebouncedUrlSaveResult {
  const [input, setInputRaw] = useState(storeValue);
  const [isSaving, setIsSaving] = useState(false);
  const dirtyRef = useRef(false);
  const saveFnRef = useRef(saveFn);
  saveFnRef.current = saveFn;

  const setInput = (value: string) => {
    dirtyRef.current = true;
    setInputRaw(value);
  };

  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed === storeValue) {
      dirtyRef.current = false;
      return;
    }
    if (!trimmed && !dirtyRef.current) return;
    if (trimmed && !isValidUrl(trimmed)) return;

    setIsSaving(true);
    const timer = setTimeout(() => {
      saveFnRef.current(trimmed);
      dirtyRef.current = false;
      setIsSaving(false);
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      setIsSaving(false);
    };
  }, [input, storeValue, debounceMs]);

  return { input, setInput, isSaving };
}

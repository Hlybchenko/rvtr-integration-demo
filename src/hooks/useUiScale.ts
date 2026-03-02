import { useEffect, useRef } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';

/** Syncs the persisted uiScale value to `--scale` on `<html>`. */
export function useUiScale(): void {
  const uiScale = useSettingsStore((s) => s.uiScale);
  const readyRef = useRef(false);

  useEffect(() => {
    const el = document.documentElement;
    if (uiScale !== null) {
      el.style.setProperty('--scale', String(uiScale));
    } else {
      el.style.removeProperty('--scale');
    }

    // Enable jelly-bounce transition after the first scale value is applied,
    // so DPI media-query changes on load don't animate.
    if (!readyRef.current) {
      readyRef.current = true;
      requestAnimationFrame(() => {
        el.setAttribute('data-scale-ready', '');
      });
    }
  }, [uiScale]);
}

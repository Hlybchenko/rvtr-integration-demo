import { useEffect } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';

/** Syncs the persisted uiScale value to `--scale` on `<html>`. */
export function useUiScale(): void {
  const uiScale = useSettingsStore((s) => s.uiScale);

  useEffect(() => {
    const el = document.documentElement;
    if (uiScale !== null) {
      el.style.setProperty('--scale', String(uiScale));
    } else {
      el.style.removeProperty('--scale');
    }
  }, [uiScale]);
}

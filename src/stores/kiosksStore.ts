import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ShortcutId = 'agentic-proxy' | 'livelink-hub' | 'kiosk-app';

export interface ShortcutDef {
  id: ShortcutId;
  label: string;
}

export const KIOSK_SHORTCUTS: ShortcutDef[] = [
  { id: 'agentic-proxy', label: 'AgenticProxy' },
  { id: 'livelink-hub', label: 'LiveLinkHUB' },
  { id: 'kiosk-app', label: 'Kiosk app' },
];

interface KiosksState {
  paths: Record<ShortcutId, string>;
  setPath: (id: ShortcutId, path: string) => void;
}

export const useKiosksStore = create<KiosksState>()(
  persist(
    (set) => ({
      paths: {
        'agentic-proxy': '',
        'livelink-hub': '',
        'kiosk-app': '',
      },
      setPath: (id, path) =>
        set((s) => ({ paths: { ...s.paths, [id]: path } })),
    }),
    { name: 'rvtr-kiosks', version: 1 },
  ),
);

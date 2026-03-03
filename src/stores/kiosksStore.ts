import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { VoiceAgent } from '@/stores/settingsStore';

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
  /** Shortcut executable paths */
  paths: Record<ShortcutId, string>;
  setPath: (id: ShortcutId, path: string) => void;

  /** License file path for kiosks config */
  licenseFilePath: string;
  setLicenseFilePath: (path: string) => void;

  /** Voice agent selection for kiosks */
  voiceAgent: VoiceAgent;
  setVoiceAgent: (agent: VoiceAgent) => void;
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

      licenseFilePath: '',
      setLicenseFilePath: (path) => set({ licenseFilePath: path }),

      voiceAgent: 'elevenlabs',
      setVoiceAgent: (agent) => set({ voiceAgent: agent }),
    }),
    { name: 'rvtr-kiosks', version: 2 },
  ),
);

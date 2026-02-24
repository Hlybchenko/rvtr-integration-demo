import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { useSettingsStore } from '@/stores/settingsStore';
import { ensureVoiceAgentFileSync } from '@/services/voiceAgentWriter';
import styles from './AppShell.module.css';

export function AppShell() {
  const voiceAgent = useSettingsStore((s) => s.voiceAgent);

  useEffect(() => {
    void ensureVoiceAgentFileSync(voiceAgent).catch(() => {
      // Writer service is optional in browser runtime.
    });
  }, [voiceAgent]);

  return (
    <div className={styles.layout}>
      <Sidebar />
      <main className={styles.main}>
        <div className={styles.content}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

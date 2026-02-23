import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import styles from './AppShell.module.css';

export function AppShell() {
  return (
    <div className={styles.layout}>
      <Sidebar />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

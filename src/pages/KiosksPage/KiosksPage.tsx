import styles from './KiosksPage.module.css';

export function KiosksPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Kiosks</h1>
      <p className={styles.subtitle}>
        Configure streaming kiosk devices — Info Kiosk, Keba Kiosk, Holobox, and Fullscreen.
      </p>
    </div>
  );
}

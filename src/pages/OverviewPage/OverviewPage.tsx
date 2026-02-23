import { useSettingsStore } from '@/stores/settingsStore';
import styles from './OverviewPage.module.css';

const ENV_WIDGET_URL = import.meta.env.VITE_DEFAULT_WIDGET_URL || '';
const ENV_HOLOBOX_URL = import.meta.env.VITE_DEFAULT_HOLOBOX_URL || '';

function isValidUrl(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function OverviewPage() {
  const widgetUrl = useSettingsStore((s) => s.widgetUrl);
  const holoboxUrl = useSettingsStore((s) => s.holoboxUrl);
  const setWidgetUrl = useSettingsStore((s) => s.setWidgetUrl);
  const setHoloboxUrl = useSettingsStore((s) => s.setHoloboxUrl);

  const widgetHasValue = widgetUrl.trim().length > 0;
  const holoboxHasValue = holoboxUrl.trim().length > 0;
  const widgetValid = !widgetHasValue || isValidUrl(widgetUrl);
  const holoboxValid = !holoboxHasValue || isValidUrl(holoboxUrl);

  return (
    <div className={styles.settings}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          <span className={styles.accent}>Settings</span>
        </h1>
        <p className={styles.subtitle}>
          Configure widget URLs for device previews. Changes are saved automatically.
        </p>
      </header>

      <div className={styles.form}>
        {/* Widget URL */}
        <div className={styles.field}>
          <div className={styles.fieldHeader}>
            <label className={styles.label} htmlFor="widget-url">
              Widget URL
            </label>
            {widgetHasValue && (
              <span
                className={`${styles.badge} ${widgetValid ? styles.badgeValid : styles.badgeInvalid}`}
              >
                {widgetValid ? '✓ Valid' : '✗ Invalid URL'}
              </span>
            )}
          </div>
          <input
            id="widget-url"
            className={`${styles.input} ${widgetHasValue && !widgetValid ? styles.inputError : ''}`}
            type="url"
            placeholder={ENV_WIDGET_URL || 'https://your-widget.com/embed'}
            value={widgetUrl}
            onChange={(e) => setWidgetUrl(e.target.value)}
            spellCheck={false}
            autoComplete="url"
          />
        </div>

        {/* Holobox URL */}
        <div className={styles.field}>
          <div className={styles.fieldHeader}>
            <label className={styles.label} htmlFor="holobox-url">
              Holobox URL
            </label>
            {holoboxHasValue && (
              <span
                className={`${styles.badge} ${holoboxValid ? styles.badgeValid : styles.badgeInvalid}`}
              >
                {holoboxValid ? '✓ Valid' : '✗ Invalid URL'}
              </span>
            )}
          </div>
          <input
            id="holobox-url"
            className={`${styles.input} ${holoboxHasValue && !holoboxValid ? styles.inputError : ''}`}
            type="url"
            placeholder={ENV_HOLOBOX_URL || 'https://your-holobox.com/embed'}
            value={holoboxUrl}
            onChange={(e) => setHoloboxUrl(e.target.value)}
            spellCheck={false}
            autoComplete="url"
          />
        </div>
      </div>
    </div>
  );
}

import { useEffect } from 'react';
import { devices, preloadDeviceFrameImages } from '@/config/devices';
import { warmDetectScreenRect } from '@/hooks/useDetectScreenRect';
import { useDebouncedUrlSave } from '@/hooks/useDebouncedUrlSave';
import { useSettingsStore } from '@/stores/settingsStore';
import { isValidUrl } from '@/utils/isValidUrl';
import styles from './OverviewPage.module.css';

/** Descriptor for a non-streaming (widget) device URL field. */
interface DeviceField {
  id: 'phone' | 'laptop';
  label: string;
  placeholder: string;
}

const WIDGET_DEVICES: DeviceField[] = [
  { id: 'phone', label: 'Phone', placeholder: 'https://widget.example.com/phone' },
  { id: 'laptop', label: 'Laptop', placeholder: 'https://widget.example.com/laptop' },
];

// ── Component ────────────────────────────────────────────────────────────────

export function OverviewPage() {
  // ── Store selectors ──────────────────────────────────────────────────────
  const phoneUrl = useSettingsStore((s) => s.phoneUrl);
  const laptopUrl = useSettingsStore((s) => s.laptopUrl);
  const setDeviceUrl = useSettingsStore((s) => s.setDeviceUrl);

  // ── Debounced URL saves ──────────────────────────────────────────────────
  const phoneUrlSave = useDebouncedUrlSave({ storeValue: phoneUrl, saveFn: (url) => setDeviceUrl('phone', url) });
  const laptopUrlSave = useDebouncedUrlSave({ storeValue: laptopUrl, saveFn: (url) => setDeviceUrl('laptop', url) });

  const urlSaveByDevice: Record<'phone' | 'laptop', typeof phoneUrlSave> = {
    phone: phoneUrlSave,
    laptop: laptopUrlSave,
  };

  // ── Validation ─────────────────────────────────────────────────────────
  const widgetHasError = WIDGET_DEVICES.some((d) => {
    const v = urlSaveByDevice[d.id].input;
    return v.trim().length > 0 && !isValidUrl(v);
  });
  const widgetAllGood = WIDGET_DEVICES.every((d) => {
    const v = urlSaveByDevice[d.id].input;
    return v.trim().length > 0 && isValidUrl(v);
  });

  // ── Side effects ─────────────────────────────────────────────────────────
  useEffect(() => {
    preloadDeviceFrameImages();
    devices.forEach((device) => {
      if (!device.autoDetectScreen) return;
      warmDetectScreenRect(device.frameSrc);
    });
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={styles.settings}>
      <div className={styles.form}>
        {/* -- Widget: Phone + Laptop -- */}
        <section
          className={`${styles.settingsBlock} ${
            widgetHasError
              ? styles.settingsBlockError
              : widgetAllGood
                ? styles.settingsBlockValid
                : ''
          }`}
        >
          <h2 className={styles.settingsBlockTitle}>Widget</h2>

          {WIDGET_DEVICES.map((field) => {
            const urlHook = urlSaveByDevice[field.id];
            const urlValue = urlHook.input;
            const hasUrl = urlValue.trim().length > 0;
            const urlValid = !hasUrl || isValidUrl(urlValue);

            return (
              <div key={field.id} className={styles.field}>
                <div className={styles.fieldHeader}>
                  <label className={styles.label} htmlFor={`${field.id}-url`}>
                    {field.label}
                  </label>
                  {hasUrl && (
                    <span className={`${styles.badge} ${urlValid ? styles.badgeValid : styles.badgeInvalid}`}>
                      {urlValid ? '✓ Valid' : '✗ Invalid URL'}
                    </span>
                  )}
                </div>
                <input
                  id={`${field.id}-url`}
                  className={`${styles.input} ${hasUrl && !urlValid ? styles.inputError : ''} ${urlHook.isSaving ? styles.inputSaving : ''}`}
                  type="url"
                  placeholder={field.placeholder}
                  value={urlValue}
                  onChange={(e) => urlHook.setInput(e.target.value)}
                  spellCheck={false}
                  autoComplete="url"
                />
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}

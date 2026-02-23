import { useParams, Link } from 'react-router-dom';
import { devicesMap } from '@/config/devices';
import { useResolvedUrl, useSettingsStore } from '@/stores/settingsStore';
import { DevicePreview } from '@/components/DevicePreview/DevicePreview';
import styles from './DevicePage.module.css';

export function DevicePage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const device = deviceId ? devicesMap.get(deviceId) : undefined;
  const resolvedUrl = useResolvedUrl(deviceId ?? '');
  const widgetUrl = useSettingsStore((s) => s.widgetUrl);

  if (!device) {
    return (
      <div className={styles.devicePage}>
        <div className={styles.notFound}>
          <span className={styles.notFoundIcon}>🔍</span>
          <span>
            Device "<code>{deviceId}</code>" not found.
          </span>
          <Link to="/">← Back to overview</Link>
        </div>
      </div>
    );
  }

  const isWidgetRequiredDevice = device.id === 'phone' || device.id === 'laptop';
  const isWidgetMissing = isWidgetRequiredDevice && !widgetUrl.trim();
  const finalUrl = isWidgetMissing ? '' : resolvedUrl || device.defaultUrl || '';

  return (
    <div className={styles.devicePage}>
      <DevicePreview
        device={device}
        url={finalUrl}
        showWidgetRequired={isWidgetMissing}
      />
    </div>
  );
}

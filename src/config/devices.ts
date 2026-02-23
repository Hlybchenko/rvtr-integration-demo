import type { DeviceTemplate } from '@/models/device';

// Import device frame assets (SVG placeholders — replace with PNGs if needed)
import phoneFrame from '@/assets/devices/phone.png';
import laptopFrame from '@/assets/devices/laptop.png';
import kioskFrame from '@/assets/devices/kiosk.png';
import holoboxFrame from '@/assets/devices/holobox.png';

/**
 * Device templates registry.
 *
 * To add a new device:
 * 1. Add your PNG to src/assets/devices/
 * 2. Import it above
 * 3. Add a new entry below with the correct screenRect
 *    (measure coordinates in the PNG's native pixel space)
 */
export const devices: DeviceTemplate[] = [
  {
    id: 'phone',
    name: 'Phone',
    frameSrc: phoneFrame,
    frameWidth: 500,
    frameHeight: 787,
    screenRect: { x: 26, y: 80, w: 348, h: 660, r: 8 },
    autoDetectScreen: true,
    screenRadius: 46,
    screenExpand: 5,
  },
  {
    id: 'laptop',
    name: 'Laptop',
    frameSrc: laptopFrame,
    frameWidth: 1920,
    frameHeight: 1080,
    screenRect: { x: 142, y: 42, w: 916, h: 572, r: 4 },
    autoDetectScreen: true,
    screenRadius: 16,
    screenExpandBottom: 5,
  },
  {
    id: 'kiosk',
    name: 'Info Kiosk',
    frameSrc: kioskFrame,
    frameWidth: 561,
    frameHeight: 1267,
    screenRect: { x: 60, y: 70, w: 480, h: 720, r: 6 },
    autoDetectScreen: true,
  },
  {
    id: 'holobox',
    name: 'Holobox',
    frameSrc: holoboxFrame,
    frameWidth: 1600,
    frameHeight: 1600,
    screenRect: { x: 280, y: 170, w: 1440, h: 1630, r: 0 },
    autoDetectScreen: true,
  },
];

export const devicesMap = new Map(devices.map((d) => [d.id, d]));

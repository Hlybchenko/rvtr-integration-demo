import type { DeviceTemplate } from '@/models/device';

// Import device frame assets (SVG placeholders — replace with PNGs if needed)
import phoneFrame from '@/assets/devices/phone.png';
import laptopFrame from '@/assets/devices/laptop.png';
import kioskFrame from '@/assets/devices/kiosk.png';
import holoboxFrame from '@/assets/devices/holobox.png';
import kebaKioskFrame from '@/assets/devices/keba-Kiosk.png';

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
    frameWidth: 427,
    frameHeight: 787,
    screenRect: { x: 44, y: 35, w: 336, h: 717, r: 0 },
    autoDetectScreen: true,
    screenExpand: 5,
    screenRadius: 48,
    previewScale: 0.7,
  },
  {
    id: 'laptop',
    name: 'Laptop',
    frameSrc: laptopFrame,
    frameWidth: 1286,
    frameHeight: 811,
    screenRect: { x: 139, y: 48, w: 1007, h: 657, r: 13 },
    autoDetectScreen: true,
    screenRadius: 13,
    screenExpandBottom: 5,
    previewScale: 1,
  },
  {
    id: 'kiosk',
    name: 'Info Kiosk',
    frameSrc: kioskFrame,
    frameWidth: 561,
    frameHeight: 1267,
    screenRect: { x: 100, y: 81, w: 351, h: 674, r: 0 },
    autoDetectScreen: true,
    previewScale: 1.04,
  },
  {
    id: 'keba-kiosk',
    name: 'Keba Kiosk',
    frameSrc: kebaKioskFrame,
    frameWidth: 675,
    frameHeight: 1280,
    screenRect: { x: 122, y: 38, w: 435, h: 568, r: 30 },
    autoDetectScreen: true,
    screenRadius: 30,
    previewScale: 1,
  },
  {
    id: 'holobox',
    name: 'Holobox',
    frameSrc: holoboxFrame,
    frameWidth: 922,
    frameHeight: 1521,
    screenRect: { x: 106, y: 122, w: 713, h: 1266, r: 0 },
    autoDetectScreen: true,
    previewScale: 1,
  },
];

export const devicesMap = new Map(devices.map((d) => [d.id, d]));

const preloadedFrameSrc = new Set<string>();

export function preloadDeviceFrameImages(deviceList: DeviceTemplate[] = devices): void {
  deviceList.forEach((device) => {
    const src = device.frameSrc;
    if (!src || preloadedFrameSrc.has(src)) return;

    preloadedFrameSrc.add(src);
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  });
}

import { useEffect, useState } from 'react';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const detectedRectCache = new Map<string, Rect | null>();
const pendingRectDetection = new Map<string, Promise<Rect | null>>();

/**
 * Detects the transparent screen cutout in a device frame PNG.
 *
 * Algorithm:
 * 1. Classify transparent pixels using alpha threshold.
 * 2. Flood-fill all transparent regions connected to image borders
 *    (this is the OUTSIDE transparent area).
 * 3. Find remaining transparent connected components (holes),
 *    and pick the largest one as the screen cutout.
 *
 * Returns the rect in the image's **native pixel space**.
 */
function detectScreenCutout(src: string): Promise<Rect | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      if (!ctx) {
        resolve(null);
        return;
      }

      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;

      const alphaAt = (index: number): number => data[index * 4 + 3] ?? 0;
      const pixelIndex = (x: number, y: number): number => y * w + x;
      const alphaThreshold = 16;
      const isTransparent = (index: number): boolean => alphaAt(index) < alphaThreshold;

      // 0 = unseen, 1 = exterior transparent, 2 = interior transparent visited
      const visited = new Uint8Array(w * h);
      const queue: number[] = [];

      const pushExterior = (x: number, y: number) => {
        const index = pixelIndex(x, y);
        if (visited[index] !== 0 || !isTransparent(index)) return;
        visited[index] = 1;
        queue.push(index);
      };

      // Seed flood-fill from border transparent pixels
      for (let x = 0; x < w; x++) {
        pushExterior(x, 0);
        pushExterior(x, h - 1);
      }
      for (let y = 1; y < h - 1; y++) {
        pushExterior(0, y);
        pushExterior(w - 1, y);
      }

      // Flood exterior transparent region
      for (let head = 0; head < queue.length; head++) {
        const index = queue[head];
        if (index === undefined) continue;
        const x = index % w;
        const y = Math.floor(index / w);

        if (x > 0) pushExterior(x - 1, y);
        if (x + 1 < w) pushExterior(x + 1, y);
        if (y > 0) pushExterior(x, y - 1);
        if (y + 1 < h) pushExterior(x, y + 1);
      }

      // Find largest interior transparent connected component (screen cutout)
      let bestArea = 0;
      let bestRect: Rect | null = null;

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const start = pixelIndex(x, y);
          if (visited[start] !== 0 || !isTransparent(start)) continue;

          let minX = x;
          let minY = y;
          let maxX = x;
          let maxY = y;
          let area = 0;

          const holeQueue: number[] = [start];
          visited[start] = 2;

          for (let head = 0; head < holeQueue.length; head++) {
            const index = holeQueue[head];
            if (index === undefined) continue;
            const px = index % w;
            const py = Math.floor(index / w);
            area++;

            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;

            const tryVisit = (nx: number, ny: number) => {
              const next = pixelIndex(nx, ny);
              if (visited[next] !== 0 || !isTransparent(next)) return;
              visited[next] = 2;
              holeQueue.push(next);
            };

            if (px > 0) tryVisit(px - 1, py);
            if (px + 1 < w) tryVisit(px + 1, py);
            if (py > 0) tryVisit(px, py - 1);
            if (py + 1 < h) tryVisit(px, py + 1);
          }

          if (area > bestArea) {
            bestArea = area;
            bestRect = {
              x: minX,
              y: minY,
              w: maxX - minX + 1,
              h: maxY - minY + 1,
            };
          }
        }
      }

      if (!bestRect) {
        resolve(null);
        return;
      }

      resolve(bestRect);
    };

    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function detectScreenCutoutCached(src: string): Promise<Rect | null> {
  if (detectedRectCache.has(src)) {
    return Promise.resolve(detectedRectCache.get(src) ?? null);
  }

  const pending = pendingRectDetection.get(src);
  if (pending) return pending;

  const task = detectScreenCutout(src).then((rect) => {
    detectedRectCache.set(src, rect);
    pendingRectDetection.delete(src);
    return rect;
  });

  pendingRectDetection.set(src, task);
  return task;
}

export function warmDetectScreenRect(src: string): void {
  if (!src) return;
  void detectScreenCutoutCached(src);
}

/**
 * React hook that auto-detects the transparent bounding box in a device
 * frame image. Returns `null` while loading, or the detected Rect.
 */
export function useDetectScreenRect(src: string, enabled: boolean): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!enabled) {
      setRect(null);
      return;
    }

    if (detectedRectCache.has(src)) {
      setRect(detectedRectCache.get(src) ?? null);
      return;
    }

    setRect(null);

    let cancelled = false;
    detectScreenCutoutCached(src).then((r) => {
      if (!cancelled) setRect(r);
    });

    return () => {
      cancelled = true;
    };
  }, [src, enabled]);

  return rect;
}

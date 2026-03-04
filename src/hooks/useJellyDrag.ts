import { useEffect } from 'react';

/**
 * Rubber-band drag-follow + collision deformation for interactive elements.
 *
 * 1. On mousedown+drag, the element stretches toward the cursor (spring-limited).
 * 2. Nearby interactive elements get "dented" on the side facing the dragged element.
 * 3. On release, everything springs back with elastic overshoot.
 *
 * Uses CSS `translate` and `scale` properties (independent of `transform`)
 * so existing animations/transitions are never disrupted.
 * GPU-composited, ~zero layout cost.
 */

const SPRING = 0.12;
const MAX_OFFSET = 5;
const SELECTOR = 'button, a, [role="button"]';

/* ── Collision settings ── */
const PUSH_THRESHOLD = 18;
const MAX_DEFORM = 0.06;
const COLLISION_EVERY = 3; // check every Nth frame

interface CachedEl {
  el: HTMLElement;
  rect: DOMRect;
  origOrigin: string;
}

export function useJellyDrag(): void {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let target: HTMLElement | null = null;
    let originX = 0;
    let originY = 0;
    let currentX = 0;
    let currentY = 0;
    let rafId = 0;
    let frame = 0;

    /* Collision state */
    let nearby: CachedEl[] = [];
    const deformed = new Set<HTMLElement>();

    /* ── Collision detection ── */
    const checkCollisions = () => {
      if (!target) return;
      const dr = target.getBoundingClientRect();

      const stillActive = new Set<HTMLElement>();

      for (const item of nearby) {
        const r = item.rect;

        // Edge-to-edge gaps (negative = overlapping)
        const gapX = Math.max(r.left - dr.right, dr.left - r.right);
        const gapY = Math.max(r.top - dr.bottom, dr.top - r.bottom);

        // Too far — release deformation
        if (gapX > PUSH_THRESHOLD || gapY > PUSH_THRESHOLD) {
          if (deformed.has(item.el)) springBackEl(item);
          continue;
        }

        // Intensity: 0 at threshold edge → 1 at full overlap
        const proximityX = 1 - Math.max(0, gapX) / PUSH_THRESHOLD;
        const proximityY = 1 - Math.max(0, gapY) / PUSH_THRESHOLD;
        const intensity = Math.min(proximityX, proximityY) * MAX_DEFORM;

        if (intensity < 0.002) {
          if (deformed.has(item.el)) springBackEl(item);
          continue;
        }

        // Push direction: from dragged center toward neighbor center
        const dx = (r.left + r.right) / 2 - (dr.left + dr.right) / 2;
        const dy = (r.top + r.bottom) / 2 - (dr.top + dr.bottom) / 2;

        const el = item.el;
        if (Math.abs(dx) > Math.abs(dy)) {
          // Horizontal dent
          el.style.transformOrigin = dx > 0 ? 'left center' : 'right center';
          el.style.scale = `${1 - intensity} 1`;
        } else {
          // Vertical dent
          el.style.transformOrigin = dy > 0 ? 'center top' : 'center bottom';
          el.style.scale = `1 ${1 - intensity}`;
        }

        el.style.willChange = 'scale';
        stillActive.add(el);
        deformed.add(el);
      }

      // Clean up elements that left the zone
      for (const el of deformed) {
        if (!stillActive.has(el)) {
          const item = nearby.find((n) => n.el === el);
          if (item) springBackEl(item);
        }
      }
    };

    const springBackEl = (item: CachedEl) => {
      const el = item.el;
      const prev = el.style.scale;
      el.style.scale = '';
      el.style.transformOrigin = item.origOrigin;
      el.style.willChange = '';
      deformed.delete(el);

      if (prev && prev !== '1' && prev !== '1 1') {
        el.animate(
          { scale: [prev, '1 1'] },
          { duration: 300, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
        );
      }
    };

    /* ── Core loop ── */
    const tick = () => {
      if (!target) return;
      target.style.translate = `${currentX}px ${currentY}px`;

      frame++;
      if (frame % COLLISION_EVERY === 0) checkCollisions();

      rafId = requestAnimationFrame(tick);
    };

    const onDown = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest(SELECTOR) as HTMLElement | null;
      if (!el || el.closest('[data-no-jelly]') || el.hasAttribute('disabled')) return;
      target = el;
      originX = e.clientX;
      originY = e.clientY;
      currentX = 0;
      currentY = 0;
      frame = 0;
      el.style.willChange = 'translate';

      // Cache rects of other interactive elements (static during drag).
      // Skip siblings (same parent) — clicking a menu item shouldn't deform its neighbors.
      nearby = [];
      const parent = el.parentElement;
      document.querySelectorAll<HTMLElement>(SELECTOR).forEach((other) => {
        if (other === el || other.hasAttribute('disabled') || other.closest('[data-no-jelly]')) return;
        if (other.parentElement === parent) return;
        nearby.push({
          el: other,
          rect: other.getBoundingClientRect(),
          origOrigin: getComputedStyle(other).transformOrigin,
        });
      });

      rafId = requestAnimationFrame(tick);
    };

    const onMove = (e: MouseEvent) => {
      if (!target) return;
      const dx = (e.clientX - originX) * SPRING;
      const dy = (e.clientY - originY) * SPRING;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > MAX_OFFSET) {
        const ratio = MAX_OFFSET / dist;
        currentX = dx * ratio;
        currentY = dy * ratio;
      } else {
        currentX = dx;
        currentY = dy;
      }
    };

    const release = () => {
      if (!target) return;
      cancelAnimationFrame(rafId);
      const el = target;
      const from = el.style.translate;
      target = null;
      el.style.translate = '';
      el.style.willChange = '';

      // Spring-back dragged element
      if (from && from !== '0px 0px') {
        el.animate(
          { translate: [from, '0 0'] },
          { duration: 400, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
        );
      }

      // Spring-back all deformed neighbors
      for (const item of nearby) {
        if (deformed.has(item.el)) springBackEl(item);
      }
      nearby = [];
    };

    document.addEventListener('mousedown', onDown, { passive: true });
    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseup', release);
    document.addEventListener('mouseleave', release);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', release);
      document.removeEventListener('mouseleave', release);
    };
  }, []);
}

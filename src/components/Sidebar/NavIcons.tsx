/**
 * Custom SVG nav icons — monoline, geeky style.
 * All icons: 18×18 viewBox, 1.5 stroke, currentColor.
 */

const S = { width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function IconSettings() {
  return (
    <svg {...S}>
      {/* Gear body */}
      <circle cx="9" cy="9" r="2.5" />
      <path d="M9 1.5v1.2M9 15.3v1.2M1.5 9h1.2M15.3 9h1.2M3.7 3.7l.85.85M13.45 13.45l.85.85M3.7 14.3l.85-.85M13.45 4.55l.85-.85" />
      {/* Gear teeth accents */}
      <path d="M7.8 1.5h2.4l.3 1.5-.3.3h-2.4l-.3-.3ZM7.8 14.7h2.4l.3 1.5h-3Z" strokeWidth={1} opacity={0.5} />
    </svg>
  );
}

export function IconPhone() {
  return (
    <svg {...S}>
      {/* Phone body */}
      <rect x="4.5" y="1.5" width="9" height="15" rx="2" />
      {/* Screen */}
      <rect x="5.5" y="3.5" width="7" height="9.5" rx="0.5" strokeWidth={1} opacity={0.4} />
      {/* Home button / notch */}
      <line x1="7.5" y1="14.5" x2="10.5" y2="14.5" strokeWidth={1.2} strokeLinecap="round" opacity={0.6} />
      {/* Signal dots */}
      <circle cx="9" cy="2.6" r="0.4" fill="currentColor" stroke="none" opacity={0.4} />
    </svg>
  );
}

export function IconLaptop() {
  return (
    <svg {...S}>
      {/* Screen / lid */}
      <rect x="2.5" y="2.5" width="13" height="9" rx="1.2" />
      {/* Screen inner */}
      <rect x="3.8" y="3.8" width="10.4" height="6.4" rx="0.5" strokeWidth={0.8} opacity={0.3} />
      {/* Keyboard base */}
      <path d="M1 14.5h16l-.8-2.5H1.8Z" />
      {/* Trackpad line */}
      <line x1="7" y1="13.3" x2="11" y2="13.3" strokeWidth={0.8} opacity={0.4} />
    </svg>
  );
}

export function IconKiosk() {
  return (
    <svg {...S}>
      {/* Monitor */}
      <rect x="3" y="1.5" width="12" height="9" rx="1" />
      {/* Screen */}
      <rect x="4.2" y="2.7" width="9.6" height="6.6" rx="0.5" strokeWidth={0.8} opacity={0.3} />
      {/* Stand neck */}
      <line x1="9" y1="10.5" x2="9" y2="13.5" />
      {/* Base */}
      <path d="M5.5 13.5h7l1 2.5h-9Z" />
      {/* Info "i" on screen */}
      <circle cx="9" cy="4.8" r="0.4" fill="currentColor" stroke="none" opacity={0.5} />
      <line x1="9" y1="5.8" x2="9" y2="8" strokeWidth={1} opacity={0.5} />
    </svg>
  );
}

export function IconKebaKiosk() {
  return (
    <svg {...S}>
      {/* Tall body */}
      <rect x="5" y="1" width="8" height="14" rx="1.2" />
      {/* Screen top */}
      <rect x="6.2" y="2.2" width="5.6" height="5" rx="0.5" strokeWidth={0.8} opacity={0.3} />
      {/* Keypad dots */}
      <circle cx="7.5" cy="9" r="0.5" fill="currentColor" stroke="none" opacity={0.45} />
      <circle cx="9" cy="9" r="0.5" fill="currentColor" stroke="none" opacity={0.45} />
      <circle cx="10.5" cy="9" r="0.5" fill="currentColor" stroke="none" opacity={0.45} />
      <circle cx="7.5" cy="10.8" r="0.5" fill="currentColor" stroke="none" opacity={0.45} />
      <circle cx="9" cy="10.8" r="0.5" fill="currentColor" stroke="none" opacity={0.45} />
      <circle cx="10.5" cy="10.8" r="0.5" fill="currentColor" stroke="none" opacity={0.45} />
      {/* Card slot */}
      <line x1="6.5" y1="13" x2="11.5" y2="13" strokeWidth={1} opacity={0.5} />
      {/* Base stand */}
      <path d="M5.5 15h7l.5 2h-8Z" strokeWidth={1.2} />
    </svg>
  );
}

export function IconHolobox() {
  return (
    <svg {...S}>
      {/* Outer box frame */}
      <rect x="2.5" y="3" width="13" height="12" rx="1" />
      {/* Inner projection area */}
      <rect x="4" y="5" width="10" height="8" rx="0.5" strokeWidth={0.8} opacity={0.25} />
      {/* Hologram diamond floating */}
      <path d="M9 5.5l2.5 3.5-2.5 3-2.5-3Z" strokeWidth={1} opacity={0.6} />
      {/* Hologram glow lines */}
      <line x1="6" y1="4" x2="6.8" y2="5" strokeWidth={0.7} opacity={0.35} />
      <line x1="12" y1="4" x2="11.2" y2="5" strokeWidth={0.7} opacity={0.35} />
      <line x1="9" y1="2" x2="9" y2="3" strokeWidth={0.7} opacity={0.35} />
    </svg>
  );
}

export function IconFullscreen() {
  return (
    <svg {...S}>
      {/* Corner arrows */}
      <path d="M2 6V2.5h3.5" />
      <path d="M16 6V2.5h-3.5" />
      <path d="M2 12v3.5h3.5" />
      <path d="M16 12v3.5h-3.5" />
      {/* Inner screen hint */}
      <rect x="5" y="5" width="8" height="8" rx="0.8" strokeWidth={0.8} opacity={0.3} />
      {/* Play triangle (content hint) */}
      <path d="M8 7.5v3l2.5-1.5Z" fill="currentColor" stroke="none" opacity={0.35} />
    </svg>
  );
}

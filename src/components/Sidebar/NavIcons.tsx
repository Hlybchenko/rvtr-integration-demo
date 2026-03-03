/**
 * Custom SVG nav icons — monoline, detailed style.
 * All icons: 18×18 viewBox, currentColor, strokeLinecap/join round.
 */

const S = { width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function IconSettings() {
  return (
    <svg {...S}>
      {/* Gear outer ring with teeth */}
      <path d="M8.1 1.5h1.8l.4 1.6-.4.4H8.1l-.4-.4ZM8.1 14.5h1.8l.4 1.6-.4.4H8.1l-.4-.4Z" strokeWidth={1} opacity={0.5} />
      <path d="M1.5 8.1v1.8l1.6.4.4-.4V8.1l-.4-.4ZM14.5 8.1v1.8l1.6.4.4-.4V8.1l-.4-.4Z" strokeWidth={1} opacity={0.5} />
      {/* Diagonal teeth */}
      <path d="M3.3 3.3l1.3 1 .5-.1.1-.5-1-1.3ZM13.4 13.4l-1.3-1-.5.1-.1.5 1 1.3Z" strokeWidth={0.9} opacity={0.4} />
      <path d="M14.7 3.3l-1.3 1-.1.5.5.1 1.3-1ZM3.3 14.7l1.3-1 .1-.5-.5-.1-1.3 1Z" strokeWidth={0.9} opacity={0.4} />
      {/* Gear center */}
      <circle cx="9" cy="9" r="3" />
      <circle cx="9" cy="9" r="1.2" strokeWidth={1} opacity={0.5} />
    </svg>
  );
}

export function IconPhone() {
  return (
    <svg {...S}>
      {/* Body */}
      <rect x="4.5" y="1.2" width="9" height="15.6" rx="2" />
      {/* Screen */}
      <rect x="5.8" y="3.5" width="6.4" height="9" rx="0.4" strokeWidth={0.8} opacity={0.3} />
      {/* Notch / dynamic island */}
      <rect x="7.5" y="1.9" width="3" height="0.9" rx="0.45" strokeWidth={0.7} opacity={0.5} />
      {/* Camera dot */}
      <circle cx="8.2" cy="2.35" r="0.35" fill="currentColor" stroke="none" opacity={0.4} />
      {/* Home indicator bar */}
      <line x1="7.2" y1="15.3" x2="10.8" y2="15.3" strokeWidth={1.2} strokeLinecap="round" opacity={0.5} />
      {/* Screen content line */}
      <line x1="6.8" y1="6" x2="11.2" y2="6" strokeWidth={0.6} opacity={0.15} />
      <line x1="6.8" y1="7.5" x2="10" y2="7.5" strokeWidth={0.6} opacity={0.12} />
      {/* Side button */}
      <line x1="13.5" y1="5" x2="13.5" y2="7" strokeWidth={0.7} opacity={0.3} />
    </svg>
  );
}

export function IconLaptop() {
  return (
    <svg {...S}>
      {/* Screen lid */}
      <rect x="2.5" y="2" width="13" height="9.5" rx="1" />
      {/* Screen inner */}
      <rect x="3.8" y="3.3" width="10.4" height="6.9" rx="0.4" strokeWidth={0.7} opacity={0.25} />
      {/* Camera dot */}
      <circle cx="9" cy="2.7" r="0.3" fill="currentColor" stroke="none" opacity={0.35} />
      {/* Screen reflection line */}
      <line x1="4.5" y1="4.5" x2="6.5" y2="4.5" strokeWidth={0.5} opacity={0.12} />
      {/* Keyboard base */}
      <path d="M0.8 14.8h16.4l-.7-3H1.5Z" />
      {/* Hinge accent */}
      <line x1="4" y1="11.8" x2="14" y2="11.8" strokeWidth={0.6} opacity={0.25} />
      {/* Trackpad */}
      <rect x="6.8" y="13" width="4.4" height="1.2" rx="0.3" strokeWidth={0.6} opacity={0.3} />
    </svg>
  );
}

export function IconKiosk() {
  return (
    <svg {...S}>
      {/* Monitor frame */}
      <rect x="2.5" y="1.2" width="13" height="9.3" rx="1" />
      {/* Screen */}
      <rect x="3.8" y="2.5" width="10.4" height="6.7" rx="0.4" strokeWidth={0.7} opacity={0.25} />
      {/* Stand neck */}
      <path d="M7.5 10.5h3v3h-3Z" strokeWidth={1} opacity={0.6} />
      {/* Base */}
      <path d="M5 15.5h8l.8-2H4.2Z" />
      {/* Info icon on screen */}
      <circle cx="9" cy="4.5" r="0.4" fill="currentColor" stroke="none" opacity={0.45} />
      <line x1="9" y1="5.5" x2="9" y2="7.8" strokeWidth={1} opacity={0.4} />
      {/* Screen bezel indicator */}
      <circle cx="9" cy="9.6" r="0.35" fill="currentColor" stroke="none" opacity={0.3} />
    </svg>
  );
}

export function IconKebaKiosk() {
  return (
    <svg {...S}>
      {/* Tall body */}
      <rect x="5" y="0.8" width="8" height="14.2" rx="1.2" />
      {/* Top screen */}
      <rect x="6.3" y="2" width="5.4" height="5.2" rx="0.4" strokeWidth={0.7} opacity={0.25} />
      {/* Screen content — avatar silhouette */}
      <circle cx="9" cy="3.5" r="0.9" strokeWidth={0.6} opacity={0.3} />
      <path d="M7.2 6.2c0-1 .8-1.5 1.8-1.5s1.8.5 1.8 1.5" strokeWidth={0.6} opacity={0.25} fill="none" />
      {/* Keypad grid 3×2 */}
      <circle cx="7.5" cy="9" r="0.45" fill="currentColor" stroke="none" opacity={0.4} />
      <circle cx="9" cy="9" r="0.45" fill="currentColor" stroke="none" opacity={0.4} />
      <circle cx="10.5" cy="9" r="0.45" fill="currentColor" stroke="none" opacity={0.4} />
      <circle cx="7.5" cy="10.8" r="0.45" fill="currentColor" stroke="none" opacity={0.4} />
      <circle cx="9" cy="10.8" r="0.45" fill="currentColor" stroke="none" opacity={0.4} />
      <circle cx="10.5" cy="10.8" r="0.45" fill="currentColor" stroke="none" opacity={0.4} />
      {/* NFC / card reader slot */}
      <path d="M6.8 12.8h4.4" strokeWidth={0.9} opacity={0.45} />
      <path d="M7.5 13.3h3" strokeWidth={0.5} opacity={0.25} />
      {/* Base stand */}
      <path d="M5.5 15h7l.5 2h-8Z" strokeWidth={1.2} />
    </svg>
  );
}

export function IconHolobox() {
  return (
    <svg {...S}>
      {/* Outer box */}
      <rect x="2" y="3" width="14" height="12.5" rx="1" />
      {/* Inner projection area */}
      <rect x="3.5" y="5" width="11" height="8.5" rx="0.4" strokeWidth={0.7} opacity={0.2} />
      {/* Hologram diamond */}
      <path d="M9 5.5l3 4-3 3.5-3-3.5Z" strokeWidth={1} opacity={0.55} />
      {/* Diamond inner facet */}
      <line x1="9" y1="5.5" x2="9" y2="13" strokeWidth={0.5} opacity={0.2} />
      <line x1="6" y1="9.5" x2="12" y2="9.5" strokeWidth={0.5} opacity={0.2} />
      {/* Hologram glow rays */}
      <line x1="5.5" y1="3.8" x2="6.5" y2="5" strokeWidth={0.7} opacity={0.3} />
      <line x1="12.5" y1="3.8" x2="11.5" y2="5" strokeWidth={0.7} opacity={0.3} />
      <line x1="9" y1="1.8" x2="9" y2="3" strokeWidth={0.7} opacity={0.3} />
      {/* Extra glow sparkles */}
      <circle cx="5" cy="2.5" r="0.3" fill="currentColor" stroke="none" opacity={0.2} />
      <circle cx="13" cy="2.5" r="0.3" fill="currentColor" stroke="none" opacity={0.2} />
      {/* Base accent line */}
      <line x1="4" y1="14" x2="14" y2="14" strokeWidth={0.6} opacity={0.25} />
    </svg>
  );
}



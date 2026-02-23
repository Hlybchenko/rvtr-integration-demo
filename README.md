# RVTR Integration Demo

A modern dark-themed demo site for previewing AI assistants across different device form factors (phone, laptop, info kiosk, holobox). Each device is rendered as a realistic frame with an embedded iframe for your widget.

## Prerequisites

- **Node.js ≥ 22**
- **Corepack** enabled (`corepack enable`)
- **Yarn 4** (managed via `packageManager` field / corepack)

## Quick Start

```bash
# Enable corepack (if not already)
corepack enable

# Install dependencies
yarn install

# Copy env and set your widget URL
cp .env.example .env

# Start dev server
yarn dev
```

Open [http://localhost:5173](http://localhost:5173).

## Scripts

| Command              | Description                       |
| -------------------- | --------------------------------- |
| `yarn dev`           | Start Vite dev server             |
| `yarn build`         | Typecheck + production build      |
| `yarn preview`       | Preview production build locally  |
| `yarn typecheck`     | Run TypeScript type checking      |
| `yarn lint`          | Run ESLint                        |
| `yarn format`        | Format code with Prettier         |
| `yarn format:check`  | Check formatting                  |

## Environment Variables

Copy `.env.example` to `.env`:

| Variable                  | Description                                        | Default                                          |
| ------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| `VITE_DEFAULT_WIDGET_URL` | Default iframe URL when no `?url=` param is set    | (empty)                                          |
| `VITE_IFRAME_SANDBOX`     | iframe sandbox attribute override                  | `allow-scripts allow-same-origin allow-forms allow-popups` |

Set `VITE_IFRAME_SANDBOX=none` to disable the sandbox entirely (less secure).

## URL Sharing

The widget URL is stored in the `?url=` query parameter. Use the **Copy Link** button to share the current demo state with someone else.

## How to Add a New Device Template

1. **Add your frame image** to `src/assets/devices/` (SVG or PNG)

2. **Import it** in `src/config/devices.ts`:
   ```ts
   import myDeviceFrame from '@/assets/devices/my-device.svg';
   ```

3. **Add an entry** to the `devices` array:
   ```ts
   {
     id: 'my-device',        // used in the URL path (/my-device)
     name: 'My Device',      // shown in the sidebar
     frameSrc: myDeviceFrame,
     frameWidth: 800,         // natural width of your image
     frameHeight: 600,        // natural height of your image
     screenRect: {
       x: 50,   // left offset of the "screen" area (in image px)
       y: 40,   // top offset
       w: 700,  // screen width
       h: 500,  // screen height
       r: 8,    // border-radius for the screen corners
     },
   }
   ```

4. That's it — the sidebar and routing are generated automatically from the `devices` array.

## Architecture

```
src/
├── assets/devices/         # Device frame images (SVG/PNG)
├── components/
│   ├── AppShell/            # Layout: sidebar + main content
│   ├── DevicePreview/       # Core: renders frame + iframe overlay
│   ├── Sidebar/             # Navigation tabs
│   └── TopBar/              # URL input + reload + copy link
├── config/
│   └── devices.ts           # Device templates registry
├── hooks/
│   ├── useHealthCheck.ts    # Demo React Query hook
│   └── useWidgetUrl.ts      # Sync iframe URL ↔ query param
├── models/
│   └── device.ts            # DeviceTemplate TypeScript interface
├── pages/
│   ├── DevicePage/          # Generic device preview page
│   └── OverviewPage/        # Landing / instructions
├── styles/
│   ├── global.css           # Reset + global styles
│   └── tokens.css           # CSS custom properties (theme)
├── App.tsx                  # Router + QueryClientProvider
└── main.tsx                 # Entry point
```

## Theming

All colors and spacing use CSS custom properties defined in `src/styles/tokens.css`. To change the accent color, edit `--accent` and related variables.

## iframe Security

By default, iframes use:
- `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"`
- `referrerPolicy="strict-origin-when-cross-origin"`
- `loading="lazy"`

Override via `VITE_IFRAME_SANDBOX` env variable.

## TODO (potential improvements)

- [ ] Replace SVG placeholders with real device PNG/WebP frames
- [ ] Add light theme toggle
- [ ] Persist last used URL per device in localStorage
- [ ] Add responsive mobile layout for the app shell itself
- [ ] Add real healthcheck endpoint integration
- [ ] Add screenshot / export functionality
- [ ] Add device rotation (portrait/landscape) toggle for phone/tablet
- [ ] Add custom device frame upload
- [ ] E2E tests (Playwright)
- [ ] CI/CD pipeline (GitHub Actions)

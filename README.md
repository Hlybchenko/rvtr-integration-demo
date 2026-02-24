# RVTR Integration Demo

A modern device-preview demo for AI assistant widgets across phone, laptop, info kiosk, and holobox form factors. Includes per-device URL settings, voice-agent sync to a local Desktop file, and static top-bar theme switching (Dark/Light).

## Quick Start

```bash
# Enable corepack (if not already)
corepack enable

# Install dependencies
yarn install

# Start dev server
yarn dev
```

Open [http://localhost:5173](http://localhost:5173).

`yarn dev` uses a fixed port (`5173`) and performs cleanup before start.

## Current UI features

- Static top bar with theme toggle (`Dark` / `Light`) persisted in local storage.
- Sidebar navigation between device previews and settings.
- Device preview loads with a centered minimal loader to avoid iframe flicker/jumping.
- Settings include:
  - Per-device URLs (with URL validity badges).
  - Voice agent selection (`elevenlabs` / `google-native-audio`).
  - File sync status, tooltip with sync reason, and `Force rewrite now` action.

## Dev Scripts (short guide)

All modes use fixed port `5173`.

- `yarn dev` — safe local run (cleanup + local writer service + Vite).
- `yarn dev:unsafe` — opens app in Chrome with unsafe flags for iframe/debug scenarios (cleanup + local writer service + Vite).
- `yarn stop:dev` — stops local processes on ports `5173` and `3210` plus related launcher helpers.

### Typical usage

```bash
yarn stop:dev
yarn dev        # safe mode
# or
yarn dev:unsafe # unsafe Chrome mode
```

### Troubleshooting

- Port busy: run `yarn stop:dev`, then start again.
- Chrome not found: install Google Chrome in the default OS location and run again.
- Need normal browsing security: use `yarn dev` (not `dev:unsafe`).
- `dev:unsafe` checks `127.0.0.1`, `::1`, and `localhost`, so it works with both IPv4/IPv6 local binds.
- To verify the listener manually: `lsof -nP -iTCP:5173 -sTCP:LISTEN`.

### Local writer service

- Runs on `http://127.0.0.1:3210` in `dev` and `dev:unsafe` modes.
- Writes selected voice-agent option to `~/Desktop/rvtr-agent-option.txt`.
- Used by Settings sync indicator and manual force rewrite.

### Security note

`dev:unsafe` disables parts of browser security. Use only for local debugging.

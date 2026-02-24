# RVTR Integration Demo

A modern device-preview demo for AI assistant widgets across phone, laptop, info kiosk, and holobox form factors.

## Quick Start

```bash
# Enable corepack (if not already)
corepack enable

# Install dependencies
yarn install

# Start dev server
yarn dev        # safe mode
# or
yarn dev:unsafe # unsafe Chrome mode

# Stop dev server
yarn stop:dev

```

Open [http://localhost:5173](http://localhost:5173).

`yarn dev` uses a fixed port (`5173`) and performs cleanup before start.

### Troubleshooting

- Port busy: run `yarn stop:dev`, then start again.
- Chrome not found: install Google Chrome in the default OS location and run again.
- Need normal browsing security: use `yarn dev` (not `dev:unsafe`).
- `dev:unsafe` checks `127.0.0.1`, `::1`, and `localhost`, so it works with both IPv4/IPv6 local binds.
- To verify the listener manually: `lsof -nP -iTCP:5173 -sTCP:LISTEN`.

### Security note

`dev:unsafe` disables parts of browser security. Use only for local debugging.

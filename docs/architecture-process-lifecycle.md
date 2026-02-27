# Architecture: start2stream process lifecycle

## Context

Each stream device (holobox, keba-kiosk, kiosk) requires a native `start2stream` executable running on the host machine. The frontend manages the lifecycle of this process: starting it when the user opens a device page and stopping it when they leave.

## High-level design

```text
┌─────────────────────────────────────────────────────┐
│  Frontend (React)                                   │
│                                                     │
│  OverviewPage                                       │
│  ├─ configures exe paths per device                 │
│  ├─ syncs paths with backend on mount               │
│  └─ polls process status every 5s                   │
│                                                     │
│  DevicePage                                         │
│  ├─ starts process on mount (stream devices only)   │
│  ├─ stops process on unmount                        │
│  └─ uses sequence counter to prevent race conditions│
│                                                     │
├─────────────────────────────────────────────────────┤
│  voiceAgentWriter.ts (API client)                   │
│  ├─ POST /process/start   { deviceId, exePath }     │
│  ├─ POST /process/stop                              │
│  ├─ GET  /process/status                            │
│  ├─ POST /process/restart                           │
│  └─ fetchWithTimeout (5s default, AbortController)  │
│                                                     │
├─────────────────────────────────────────────────────┤
│  Backend (Node, port 3210)                          │
│  ├─ spawns/kills native process                     │
│  ├─ tracks single active process (pid + deviceId)   │
│  └─ returns status on poll                          │
└─────────────────────────────────────────────────────┘
```

## Key decisions

### 1. Process lifecycle tied to DevicePage mount/unmount

The process starts when DevicePage mounts with a valid `streamDeviceId` + `exePath`, and stops when the component unmounts (user navigates away).

Trade-off: F5 (page refresh) causes a full restart (stop + start). This is acceptable because start2stream boots in ~1s and a clean restart avoids stale state. If process persistence across refreshes is needed, the mount effect should check `getProcessStatus()` first and skip start if already running for the same device.

### 2. Sequence counter for race condition prevention

```text
processSeqRef = useRef(0)

mount:   seq = ++processSeqRef.current → start(deviceA)
unmount: if (processSeqRef.current !== seq) return → skip stop
```

Without this, rapid device switching causes: start(A) → start(B) → stop(A) cleanup fires → kills B's process. The sequence counter ensures only the latest effect's cleanup can stop the process.

### 3. Granular Zustand selector

DevicePage subscribes to a single device's exe path, not the whole `deviceExePaths` object:

```ts
const exePath = useSettingsStore(s =>
  streamDeviceId ? s.deviceExePaths[streamDeviceId] : ''
);
```

This prevents effect re-runs when unrelated devices' paths change in the store.

### 4. Polling on OverviewPage

A 5-second `setInterval` polls `GET /process/status` and updates UI indicators. This covers cases where the process crashes or is killed externally — without polling, the UI would show stale "running" state indefinitely.

The poll only runs when `hasAnyExeConfigured` is true (at least one device has an exe path set).

### 5. Cancelled guard on OverviewPage init

The init effect chains multiple async calls (`getWriterConfig` → `readVoiceAgentFromFile` → state updates). A `cancelled` flag prevents state updates after unmount:

```ts
useEffect(() => {
  let cancelled = false;
  // ... async work ...
  if (cancelled) return;
  // ... update state ...
  return () => { cancelled = true; };
}, []);
```

## Data flow: device page open

```text
1. User navigates to /device/holobox
2. DevicePage mounts
3. isStreamDevice('holobox') → true
4. exePath = useSettingsStore(s => s.deviceExePaths.holobox)
5. exePath is non-empty → effect runs
6. seq = ++processSeqRef.current (e.g., seq = 1)
7. POST /process/start { deviceId: 'holobox', exePath: '/path/holobox.bat' }
8. Backend spawns process, returns { ok, pid, deviceId }

--- user navigates away ---

9. Cleanup runs
10. processSeqRef.current === seq (1 === 1) → proceed
11. POST /process/stop
12. Backend kills process
```

## Data flow: rapid device switch

```text
1. User on /device/holobox → process running (seq=1)
2. User navigates to /device/kiosk
3. New effect: seq = ++processSeqRef.current (seq=2)
4. POST /process/start { deviceId: 'kiosk', exePath: '...' }
5. Old cleanup fires for holobox:
   processSeqRef.current (2) !== old seq (1) → SKIP stop
6. Kiosk process continues running
```

## Risks

| Risk                           | Mitigation                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| Orphaned process on app crash  | Backend should track PID and kill on next start, or implement process health monitoring     |
| Process not starting (ENOENT)  | Error logged to console; UI stays on page but process won't run                             |
| Backend unreachable            | `fetchWithTimeout` (5s) throws, caught and logged; UI shows backend error on OverviewPage   |
| Multiple tabs open same device | Backend allows only one process at a time; second start kills first                         |

## Related files

| File                                      | Role                                                     |
| ----------------------------------------- | -------------------------------------------------------- |
| `src/pages/DevicePage/DevicePage.tsx`     | Process start/stop lifecycle                             |
| `src/pages/OverviewPage/OverviewPage.tsx` | Exe path config, status polling, init sync               |
| `src/services/voiceAgentWriter.ts`        | API client for backend communication                     |
| `src/stores/settingsStore.ts`             | Persisted settings (device URLs, exe paths, voice agent) |
| `scripts/agent-option-writer.mjs`         | Backend: process management, file operations             |

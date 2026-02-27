# Testing

## Quick start

```bash
yarn test          # run all tests once
yarn test:watch    # watch mode
yarn test:coverage # with coverage report
```

## Stack

Vitest 4, @testing-library/react, jsdom.

## Configuration

`vitest.config.ts` — node environment by default, jsdom for component tests (`src/pages/**/*.test.tsx`) via `environmentMatchGlobs`. Path alias `@/` mapped to `src/`.

## Test structure

```text
scripts/
  license-utils.test.mjs    # pure functions: encoding, voice agent extraction
src/
  services/
    voiceAgentWriter.test.ts # API client: fetch mocks, request/response contracts
  stores/
    settingsStore.test.ts    # Zustand store: selectors, persist migration v1-v8
  pages/
    DevicePage/
      DevicePage.test.tsx    # process lifecycle: start/stop on mount/unmount
    OverviewPage/
      OverviewPage.test.tsx  # init effect: backend sync, cancelled guard
```

## Writing tests

### Unit tests (node env)

For pure functions and service modules. Mock `fetch` via `vi.stubGlobal`. Tests in `src/**/*.test.ts` and `scripts/**/*.test.mjs` run in node.

### Component tests (jsdom env)

For React components. Place in `src/pages/**/*.test.tsx` — vitest auto-applies jsdom. Mock service layer via `vi.mock`, use `@testing-library/react` for render/assertions.

Pattern for mocking the service layer:

```ts
vi.mock('@/services/voiceAgentWriter', () => ({
  getWriterConfig: vi.fn(),
  getProcessStatus: vi.fn(),
  // ...
}));
```

### Zustand stores in tests

Import store directly, use `useSettingsStore.setState(...)` to set initial state in `beforeEach`. Migration logic is exported as `migrateSettingsState` for direct unit testing.

### Fake timers

Use `vi.useFakeTimers()` / `vi.advanceTimersByTimeAsync()` for timeout-dependent code. Attach `.catch()` before advancing timers to prevent unhandled rejections.

## What's covered

| Area                                       | Tests | Risk level               |
| ------------------------------------------ | ----- | ------------------------ |
| license-utils (encoding, agent extraction) | 32    | high — data corruption   |
| voiceAgentWriter (API client contracts)    | 21    | high — backend protocol  |
| settingsStore (selectors, migration)       | 18    | high — state persistence |
| DevicePage (process lifecycle)             | 4     | medium — resource leaks  |
| OverviewPage (init sync, cancelled guard)  | 4     | medium — race conditions |

## Not covered (yet)

- Integration tests with real backend
- E2E (Playwright/Cypress)
- Visual regression
- `browseForFile` / `browseForExe` (native OS dialog — hard to mock meaningfully)

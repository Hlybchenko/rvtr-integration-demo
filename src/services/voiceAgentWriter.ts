/**
 * API client for the agent-option-writer backend (Node.js, port 3210).
 *
 * Responsibilities:
 *  - License file path CRUD (GET/POST /config, /config/browse, /config/validate)
 *  - Per-device start2stream executable paths (POST /config/device-exe, /config/browse-exe)
 *  - Voice agent read/write to the license file (GET/POST /voice-agent)
 *  - Process lifecycle: start, stop, restart, status (POST/GET /process/*)
 *
 * All requests use fetchWithTimeout (5s default) to avoid hanging when backend is down.
 * Browse endpoints use 120s timeout because they block on native OS file picker.
 * Process start/restart use 15s timeout because spawn may take time.
 *
 * Error handling: every endpoint returns a typed result object with ok/error fields
 * instead of throwing, so callers can show user-friendly messages without try/catch.
 * Internal helpers (ensureOk, parseJsonSafely) handle malformed responses gracefully.
 */
import type { VoiceAgent, StreamDeviceId } from '@/stores/settingsStore';

/** Backend runs on localhost — not configurable, hardcoded by agent-option-writer */
const WRITER_BASE_URL = 'http://127.0.0.1:3210';
/** Default timeout for API calls; short to surface connectivity issues fast */
const FETCH_TIMEOUT_MS = 5_000;
const VALID_AGENTS: VoiceAgent[] = ['elevenlabs', 'gemini-live'];

/**
 * Fetch wrapper with AbortController timeout.
 * Aborts the request if it exceeds timeoutMs — prevents UI from hanging
 * when the backend process is down or unreachable.
 * The timer is always cleaned up via .finally() to prevent leaks.
 */
function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timeoutId),
  );
}

function isVoiceAgent(value: unknown): value is VoiceAgent {
  return typeof value === 'string' && (VALID_AGENTS as string[]).includes(value);
}

/** Normalize legacy agent names from the backend/file. Returns null for unknown values. */
function normalizeVoiceAgent(value: unknown): VoiceAgent | null {
  if (value === 'google-native-audio') return 'gemini-live';
  return isVoiceAgent(value) ? value : null;
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function ensureOk(response: Response, fallbackMessage: string): Promise<unknown> {
  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error?: unknown }).error ?? fallbackMessage)
        : fallbackMessage;
    throw new Error(message);
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Config — license file path + per-device exe paths
// Called by OverviewPage on mount to sync frontend state with backend.
// ---------------------------------------------------------------------------

export interface WriterConfig {
  licenseFilePath: string;
  deviceExePaths: Record<StreamDeviceId, string>;
}

/**
 * GET /config — read current backend configuration.
 * Handles legacy `start2streamPath` (single path for all devices, pre-v8)
 * by falling back to it when per-device `deviceExePaths` are missing.
 */
export async function getWriterConfig(): Promise<WriterConfig> {
  const response = await fetchWithTimeout(`${WRITER_BASE_URL}/config`);
  const payload = await ensureOk(response, 'Failed to read writer config');
  const record = payload && typeof payload === 'object' ? payload : null;

  const r = record as Record<string, unknown> | null;
  const rawPaths = r?.deviceExePaths as Record<string, string> | undefined;
  // Legacy fallback: if backend still has old single start2streamPath
  const legacyPath =
    r && typeof r.start2streamPath === 'string' ? r.start2streamPath : '';

  const deviceExePaths: Record<StreamDeviceId, string> = {
    holobox: rawPaths?.holobox ?? legacyPath,
    'keba-kiosk': rawPaths?.['keba-kiosk'] ?? legacyPath,
    kiosk: rawPaths?.kiosk ?? legacyPath,
  };

  return {
    licenseFilePath: r && typeof r.licenseFilePath === 'string' ? r.licenseFilePath : '',
    deviceExePaths,
  };
}

/**
 * POST /config — set license file path on the backend.
 * Backend validates the file exists and is readable.
 * Returns resolvedPath (absolute path after symlink resolution).
 */
export async function setWriterFilePath(
  licenseFilePath: string,
): Promise<{ ok: boolean; error?: string; resolvedPath?: string }> {
  const response = await fetchWithTimeout(`${WRITER_BASE_URL}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenseFilePath }),
  });

  const payload = await parseJsonSafely(response);
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    return {
      ok: false,
      error: typeof record.error === 'string' ? record.error : 'Failed to set file path',
      resolvedPath:
        typeof record.resolvedPath === 'string' ? record.resolvedPath : undefined,
    };
  }

  return {
    ok: true,
    resolvedPath:
      typeof record.licenseFilePath === 'string' ? record.licenseFilePath : undefined,
  };
}

export interface BrowseFileResult {
  cancelled: boolean;
  licenseFilePath: string | null;
  valid: boolean;
  errors: string[];
}

/**
 * Opens a native OS file picker dialog on the backend.
 * Longer timeout because user interaction is involved.
 */
export async function browseForFile(): Promise<BrowseFileResult> {
  const response = await fetchWithTimeout(
    `${WRITER_BASE_URL}/config/browse`,
    {},
    120_000, // 2min — user may take time picking a file
  );

  const payload = await parseJsonSafely(response);
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    const msg =
      typeof record.error === 'string'
        ? record.error
        : `Browse failed (HTTP ${response.status})`;
    return { cancelled: false, licenseFilePath: null, valid: false, errors: [msg] };
  }

  if (record.cancelled === true) {
    return { cancelled: true, licenseFilePath: null, valid: false, errors: [] };
  }

  return {
    cancelled: false,
    licenseFilePath:
      typeof record.licenseFilePath === 'string' ? record.licenseFilePath : null,
    valid: record.valid === true,
    errors: Array.isArray(record.errors) ? (record.errors as unknown[]).map(String) : [],
  };
}

export interface FileValidationResult {
  valid: boolean;
  errors: string[];
  resolvedPath?: string;
}

export async function validateFilePath(
  licenseFilePath: string,
): Promise<FileValidationResult> {
  const response = await fetchWithTimeout(`${WRITER_BASE_URL}/config/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenseFilePath }),
  });

  const payload = await parseJsonSafely(response);
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<
    string,
    unknown
  >;

  return {
    valid: record.valid === true,
    errors: Array.isArray(record.errors)
      ? (record.errors as unknown[]).map(String)
      : typeof record.error === 'string'
        ? [record.error]
        : [],
    resolvedPath:
      typeof record.resolvedPath === 'string' ? record.resolvedPath : undefined,
  };
}

// ---------------------------------------------------------------------------
// Voice agent read / write
//
// The voice agent setting lives inside the license file on disk (not just in
// the Zustand store). This means changing it requires a file write via the
// backend. The read/write cycle is:
//   1. readVoiceAgentFromFile()  — GET /voice-agent  (what's on disk?)
//   2. writeVoiceAgentToFile()   — POST /voice-agent (overwrite disk value)
//   3. ensureVoiceAgentFileSync() — compare store vs file, write if different
//   4. forceRewriteVoiceAgentFile() — always write, used by "Apply" button
// ---------------------------------------------------------------------------

export interface VoiceAgentFileState {
  voiceAgent: VoiceAgent | null;
  /** Absolute path to the file where the agent value was read from */
  filePath?: string;
  /** Whether a valid license file is configured on the backend */
  configured: boolean;
  error?: string;
}

/** GET /voice-agent — read the current voice agent from the license file on disk */
export async function readVoiceAgentFromFile(): Promise<VoiceAgentFileState> {
  const response = await fetchWithTimeout(`${WRITER_BASE_URL}/voice-agent`);
  const payload = await ensureOk(response, 'Failed to read voice agent option file');
  const record = payload && typeof payload === 'object' ? payload : null;

  if (!record) {
    return { voiceAgent: null, configured: false };
  }

  const r = record as Record<string, unknown>;

  return {
    voiceAgent: normalizeVoiceAgent(r.voiceAgent),
    filePath: typeof r.filePath === 'string' ? r.filePath : undefined,
    configured: r.configured === true,
    error: typeof r.error === 'string' ? r.error : undefined,
  };
}

export async function writeVoiceAgentToFile(voiceAgent: VoiceAgent): Promise<void> {
  const response = await fetchWithTimeout(`${WRITER_BASE_URL}/voice-agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voiceAgent }),
  });

  await ensureOk(response, 'Failed to write voice agent option file');
}

export interface VoiceAgentSyncResult {
  matched: boolean;
  /** Whether a write to the license file actually happened (agent was changed) */
  written: boolean;
  fileVoiceAgent: VoiceAgent | null;
  filePath?: string;
  configured: boolean;
}

/**
 * Compare the store's selected agent with the file on disk.
 * If they differ and the file is configured, write the store's value to disk.
 * Used during init to ensure store and file are consistent.
 */
export async function ensureVoiceAgentFileSync(
  selectedVoiceAgent: VoiceAgent,
): Promise<VoiceAgentSyncResult> {
  const current = await readVoiceAgentFromFile();

  if (!current.configured) {
    return {
      matched: false,
      written: false,
      fileVoiceAgent: null,
      filePath: current.filePath,
      configured: false,
    };
  }

  if (current.voiceAgent === selectedVoiceAgent) {
    return {
      matched: true,
      written: false,
      fileVoiceAgent: current.voiceAgent,
      filePath: current.filePath,
      configured: true,
    };
  }

  await writeVoiceAgentToFile(selectedVoiceAgent);
  const updated = await readVoiceAgentFromFile();

  return {
    matched: updated.voiceAgent === selectedVoiceAgent,
    written: true,
    fileVoiceAgent: updated.voiceAgent,
    filePath: updated.filePath,
    configured: updated.configured,
  };
}

export interface VoiceAgentForceRewriteResult {
  matched: boolean;
  fileVoiceAgent: VoiceAgent | null;
  filePath?: string;
}

export async function forceRewriteVoiceAgentFile(
  selectedVoiceAgent: VoiceAgent,
): Promise<VoiceAgentForceRewriteResult> {
  await writeVoiceAgentToFile(selectedVoiceAgent);
  const updated = await readVoiceAgentFromFile();

  return {
    matched: updated.voiceAgent === selectedVoiceAgent,
    fileVoiceAgent: updated.voiceAgent,
    filePath: updated.filePath,
  };
}

// ---------------------------------------------------------------------------
// Start2stream executable path — per-device .bat/.sh files
// Each stream device (holobox, keba-kiosk, kiosk) can have its own executable.
// Paths are validated by the backend (file must exist and be executable).
// ---------------------------------------------------------------------------

/** POST /config/device-exe — save and validate an exe path for a specific device */
export async function setDeviceExePath(
  deviceId: StreamDeviceId,
  exePath: string,
): Promise<{ ok: boolean; error?: string; resolvedPath?: string }> {
  const response = await fetchWithTimeout(`${WRITER_BASE_URL}/config/device-exe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, exePath }),
  });

  const payload = await parseJsonSafely(response);
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    return {
      ok: false,
      error: typeof record.error === 'string' ? record.error : 'Failed to set exe path',
      resolvedPath:
        typeof record.resolvedPath === 'string' ? record.resolvedPath : undefined,
    };
  }

  return {
    ok: true,
    resolvedPath: typeof record.exePath === 'string' ? record.exePath : undefined,
  };
}

export interface BrowseExeResult {
  cancelled: boolean;
  exePath: string | null;
  valid: boolean;
  errors: string[];
}

/**
 * Opens a native OS file picker for executable files.
 * Longer timeout because user interaction is involved.
 */
export async function browseForExe(): Promise<BrowseExeResult> {
  const response = await fetchWithTimeout(
    `${WRITER_BASE_URL}/config/browse-exe`,
    {},
    120_000,
  );

  const payload = await parseJsonSafely(response);
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    const msg =
      typeof record.error === 'string'
        ? record.error
        : `Browse failed (HTTP ${response.status})`;
    return { cancelled: false, exePath: null, valid: false, errors: [msg] };
  }

  if (record.cancelled === true) {
    return { cancelled: true, exePath: null, valid: false, errors: [] };
  }

  return {
    cancelled: false,
    exePath: typeof record.exePath === 'string' ? record.exePath : null,
    valid: record.valid === true,
    errors: Array.isArray(record.errors) ? (record.errors as unknown[]).map(String) : [],
  };
}

// ---------------------------------------------------------------------------
// Process management — start2stream lifecycle
//
// Only ONE process runs at a time. Starting a new device kills the previous one.
// The backend tracks the active process (pid + deviceId).
//
// Lifecycle:
//   DevicePage mount  → startDeviceProcess(deviceId, exePath)
//   DevicePage unmount → stopProcess()
//   OverviewPage "Apply" → restartStart2stream() (re-reads config from disk)
//   OverviewPage poll  → getProcessStatus() every 5s
// ---------------------------------------------------------------------------

export interface ProcessRestartResult {
  ok: boolean;
  pid?: number;
  deviceId?: string;
  error?: string;
}

export async function restartStart2stream(): Promise<ProcessRestartResult> {
  const response = await fetchWithTimeout(
    `${WRITER_BASE_URL}/process/restart`,
    { method: 'POST' },
    15_000, // process kill + spawn may take a few seconds
  );

  const payload = await parseJsonSafely(response);
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    return {
      ok: false,
      error:
        typeof record.error === 'string' ? record.error : 'Failed to restart process',
    };
  }

  return {
    ok: true,
    pid: typeof record.pid === 'number' ? record.pid : undefined,
    deviceId: typeof record.deviceId === 'string' ? record.deviceId : undefined,
  };
}

export interface ProcessStatusResult {
  running: boolean;
  pid: number | null;
  deviceId: string | null;
}

export async function getProcessStatus(): Promise<ProcessStatusResult> {
  const response = await fetchWithTimeout(`${WRITER_BASE_URL}/process/status`);
  const payload = await ensureOk(response, 'Failed to get process status');
  const record = payload && typeof payload === 'object' ? payload : null;
  const r = record as Record<string, unknown> | null;

  return {
    running: r?.running === true,
    pid: typeof r?.pid === 'number' ? r.pid : null,
    deviceId: typeof r?.deviceId === 'string' ? r.deviceId : null,
  };
}

// ---------------------------------------------------------------------------
// Device process lifecycle — called by DevicePage
// ---------------------------------------------------------------------------

export interface ProcessStartResult {
  ok: boolean;
  deviceId?: string;
  pid?: number;
  error?: string;
}

/**
 * POST /process/start — start a process for a specific device.
 * Backend kills any active process first, then spawns a new one.
 * Returns the new PID and deviceId on success.
 * 15s timeout — process spawn can take a few seconds.
 */
export async function startDeviceProcess(
  deviceId: StreamDeviceId,
  exePath: string,
): Promise<ProcessStartResult> {
  const response = await fetchWithTimeout(
    `${WRITER_BASE_URL}/process/start`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, exePath }),
    },
    15_000,
  );

  const payload = await parseJsonSafely(response);
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    return {
      ok: false,
      error: typeof record.error === 'string' ? record.error : 'Failed to start process',
    };
  }

  return {
    ok: true,
    deviceId: typeof record.deviceId === 'string' ? record.deviceId : undefined,
    pid: typeof record.pid === 'number' ? record.pid : undefined,
  };
}

/** Stop the currently running process */
export async function stopProcess(): Promise<{ ok: boolean; stoppedDeviceId?: string }> {
  const response = await fetchWithTimeout(
    `${WRITER_BASE_URL}/process/stop`,
    { method: 'POST' },
    10_000,
  );

  const payload = await parseJsonSafely(response);
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<
    string,
    unknown
  >;

  return {
    ok: response.ok,
    stoppedDeviceId:
      typeof record.stoppedDeviceId === 'string' ? record.stoppedDeviceId : undefined,
  };
}

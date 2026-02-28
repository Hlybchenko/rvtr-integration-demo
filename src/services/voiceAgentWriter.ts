/**
 * API client for the agent-option-writer backend (Node.js, port 3210).
 *
 * Responsibilities:
 *  - License file path CRUD (GET/POST /config, /config/browse, /config/validate)
 *  - Global executable path (POST /config/exe, /config/browse-exe)
 *  - Voice agent read/write to the license file (GET/POST /voice-agent)
 *  - Process lifecycle: start, stop, restart, status (POST/GET /process/*)
 *
 * All requests use fetchWithTimeout (5s default) to avoid hanging when backend is down.
 * Browse endpoints use 120s timeout because they block on native OS file picker.
 *
 * Error handling: every endpoint returns a typed result object with ok/error fields
 * instead of throwing, so callers can show user-friendly messages without try/catch.
 * Internal helpers (ensureOk, parseJsonSafely) handle malformed responses gracefully.
 */
import type { VoiceAgent } from '@/stores/settingsStore';

/** Backend runs on localhost — not configurable, hardcoded by agent-option-writer */
const WRITER_BASE_URL = 'http://127.0.0.1:3210';
/** Default timeout for API calls; short to surface connectivity issues fast */
const FETCH_TIMEOUT_MS = 5_000;
const VALID_AGENTS: VoiceAgent[] = ['elevenlabs', 'gemini-live'];

/**
 * Fetch wrapper with AbortController timeout.
 * Aborts the request if it exceeds timeoutMs — prevents UI from hanging
 * when the backend process is down or unreachable.
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
// Config — license file path + pixel streaming URL
// ---------------------------------------------------------------------------

export interface WriterConfig {
  licenseFilePath: string;
  pixelStreamingUrl: string;
  exePath: string;
}

/**
 * GET /config — read current backend configuration.
 */
export async function getWriterConfig(): Promise<WriterConfig> {
  const response = await fetchWithTimeout(`${WRITER_BASE_URL}/config`);
  const payload = await ensureOk(response, 'Failed to read writer config');
  const record = payload && typeof payload === 'object' ? payload : null;

  const r = record as Record<string, unknown> | null;

  // Resolve exe path: new field or legacy single/per-device paths
  const rawExePath =
    (r && typeof r.exePath === 'string' ? r.exePath : '') ||
    (r && typeof r.start2streamPath === 'string' ? r.start2streamPath : '');

  return {
    licenseFilePath: r && typeof r.licenseFilePath === 'string' ? r.licenseFilePath : '',
    pixelStreamingUrl:
      r && typeof r.pixelStreamingUrl === 'string' ? r.pixelStreamingUrl : '',
    exePath: rawExePath,
  };
}

/**
 * POST /config — set license file path on the backend.
 * Backend validates the file exists and is readable.
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
// ---------------------------------------------------------------------------

export interface VoiceAgentFileState {
  voiceAgent: VoiceAgent | null;
  filePath?: string;
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
  written: boolean;
  fileVoiceAgent: VoiceAgent | null;
  filePath?: string;
  configured: boolean;
}

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
// Executable path — global .bat/.sh for start2stream
// ---------------------------------------------------------------------------

/** POST /config/exe — save and validate an exe path */
export async function setGlobalExePath(
  exePath: string,
): Promise<{ ok: boolean; error?: string; resolvedPath?: string }> {
  const response = await fetchWithTimeout(`${WRITER_BASE_URL}/config/exe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exePath }),
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

/** Opens a native OS file picker for executable files */
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
// Process lifecycle — start2stream
//
// All mutating process operations are serialized through an async queue
// to prevent concurrent HTTP requests that could create duplicate processes.
// ---------------------------------------------------------------------------

let processQueue: Promise<unknown> = Promise.resolve();

function enqueueProcessOp<T>(op: () => Promise<T>): Promise<T> {
  const result = processQueue.then(op, op);
  processQueue = result.catch(() => {});
  return result;
}

export interface ProcessStartResult {
  ok: boolean;
  pid?: number;
  error?: string;
}

/**
 * POST /process/start — start the start2stream process.
 * Backend kills any active process first, then spawns a new one.
 * Serialized via async queue.
 */
export function startProcess(exePath: string): Promise<ProcessStartResult> {
  return enqueueProcessOp(async () => {
    const response = await fetchWithTimeout(
      `${WRITER_BASE_URL}/process/start`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exePath }),
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
        error:
          typeof record.error === 'string' ? record.error : 'Failed to start process',
      };
    }

    return {
      ok: true,
      pid: typeof record.pid === 'number' ? record.pid : undefined,
    };
  });
}

export interface ProcessRestartResult {
  ok: boolean;
  pid?: number;
  error?: string;
}

/** Restart the process. Serialized via async queue. */
export function restartProcess(): Promise<ProcessRestartResult> {
  return enqueueProcessOp(async () => {
    const response = await fetchWithTimeout(
      `${WRITER_BASE_URL}/process/restart`,
      { method: 'POST' },
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
        error:
          typeof record.error === 'string' ? record.error : 'Failed to restart process',
      };
    }

    return {
      ok: true,
      pid: typeof record.pid === 'number' ? record.pid : undefined,
    };
  });
}

export interface ProcessStatusResult {
  running: boolean;
  pid: number | null;
}

/** GET /process/status — check if process is running */
export async function getProcessStatus(): Promise<ProcessStatusResult> {
  const response = await fetchWithTimeout(`${WRITER_BASE_URL}/process/status`);
  const payload = await ensureOk(response, 'Failed to get process status');
  const record = payload && typeof payload === 'object' ? payload : null;
  const r = record as Record<string, unknown> | null;

  return {
    running: r?.running === true,
    pid: typeof r?.pid === 'number' ? r.pid : null,
  };
}

/** Check if the Pixel Streaming URL is reachable (HEAD request) */
export async function checkPixelStreamingStatus(
  url: string,
): Promise<{ reachable: boolean }> {
  if (!url.trim()) return { reachable: false };

  try {
    // Try CORS first — gives a definitive ok/not-ok answer
    const response = await fetchWithTimeout(url, { method: 'HEAD', mode: 'cors' }, 3_000);
    return { reachable: response.ok };
  } catch {
    // CORS error or network error — fall back to no-cors.
    // Opaque response (status 0) means server is alive but blocks CORS.
    // True network failure throws here too.
    try {
      await fetchWithTimeout(url, { method: 'HEAD', mode: 'no-cors' }, 3_000);
      return { reachable: true };
    } catch {
      return { reachable: false };
    }
  }
}

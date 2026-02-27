import type { VoiceAgent, StreamDeviceId } from '@/stores/settingsStore';

const WRITER_BASE_URL = 'http://127.0.0.1:3210';
const FETCH_TIMEOUT_MS = 5_000;
const VALID_AGENTS: VoiceAgent[] = ['elevenlabs', 'gemini-live'];

/** Fetch wrapper with AbortController timeout */
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
// Config (license file path)
// ---------------------------------------------------------------------------

export interface WriterConfig {
  licenseFilePath: string;
  deviceExePaths: Record<StreamDeviceId, string>;
}

export async function getWriterConfig(): Promise<WriterConfig> {
  const response = await fetchWithTimeout(`${WRITER_BASE_URL}/config`);
  const payload = await ensureOk(response, 'Failed to read writer config');
  const record = payload && typeof payload === 'object' ? payload : null;

  const r = record as Record<string, unknown> | null;
  const rawPaths = r?.deviceExePaths as Record<string, string> | undefined;
  // Legacy fallback: if backend still has old single start2streamPath
  const legacyPath = r && typeof r.start2streamPath === 'string' ? r.start2streamPath : '';

  const deviceExePaths: Record<StreamDeviceId, string> = {
    holobox: rawPaths?.holobox ?? legacyPath,
    'keba-kiosk': rawPaths?.['keba-kiosk'] ?? legacyPath,
    kiosk: rawPaths?.kiosk ?? legacyPath,
  };

  return {
    licenseFilePath:
      r && typeof r.licenseFilePath === 'string' ? r.licenseFilePath : '',
    deviceExePaths,
  };
}

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
      resolvedPath: typeof record.resolvedPath === 'string' ? record.resolvedPath : undefined,
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
    const msg = typeof record.error === 'string' ? record.error : `Browse failed (HTTP ${response.status})`;
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
    errors: Array.isArray(record.errors)
      ? (record.errors as unknown[]).map(String)
      : [],
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
    resolvedPath: typeof record.resolvedPath === 'string' ? record.resolvedPath : undefined,
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
// Start2stream executable path
// ---------------------------------------------------------------------------

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
      resolvedPath: typeof record.resolvedPath === 'string' ? record.resolvedPath : undefined,
    };
  }

  return {
    ok: true,
    resolvedPath:
      typeof record.exePath === 'string' ? record.exePath : undefined,
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
    const msg = typeof record.error === 'string' ? record.error : `Browse failed (HTTP ${response.status})`;
    return { cancelled: false, exePath: null, valid: false, errors: [msg] };
  }

  if (record.cancelled === true) {
    return { cancelled: true, exePath: null, valid: false, errors: [] };
  }

  return {
    cancelled: false,
    exePath:
      typeof record.exePath === 'string' ? record.exePath : null,
    valid: record.valid === true,
    errors: Array.isArray(record.errors)
      ? (record.errors as unknown[]).map(String)
      : [],
  };
}

// ---------------------------------------------------------------------------
// Process restart
// ---------------------------------------------------------------------------

export interface ProcessRestartResult {
  ok: boolean;
  pid?: number;
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
      error: typeof record.error === 'string' ? record.error : 'Failed to restart process',
    };
  }

  return {
    ok: true,
    pid: typeof record.pid === 'number' ? record.pid : undefined,
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
// Device process lifecycle
// ---------------------------------------------------------------------------

export interface ProcessStartResult {
  ok: boolean;
  deviceId?: string;
  pid?: number;
  error?: string;
}

/** Start a process for a specific device (kills any active process first) */
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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// We need to test internal functions. Since they are not exported, we test
// them indirectly through the exported API functions that use them.
// For direct testing, we re-implement the pure logic or test via behaviour.
// ---------------------------------------------------------------------------

const WRITER_BASE_URL = 'http://127.0.0.1:3210';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Helper: create a mock Response
function mockResponse(
  body: unknown,
  init: { status?: number; ok?: boolean } = {},
): Response {
  const status = init.status ?? 200;
  const ok = init.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers(),
    redirected: false,
    statusText: ok ? 'OK' : 'Error',
    type: 'basic' as ResponseType,
    url: '',
    clone: () => mockResponse(body, init),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve(JSON.stringify(body)),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

// Helper: create a mock Response with broken JSON
function mockBrokenJsonResponse(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new Error('Invalid JSON')),
    headers: new Headers(),
    redirected: false,
    statusText: 'OK',
    type: 'basic' as ResponseType,
    url: '',
    clone: () => mockBrokenJsonResponse(status),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve('not json'),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------
const {
  getWriterConfig,
  setWriterFilePath,
  readVoiceAgentFromFile,
  writeVoiceAgentToFile,
  startProcess,
  stopProcess,
  getProcessStatus,
  checkPixelStreamingStatus,
} = await import('./voiceAgentWriter');

// ═══════════════════════════════════════════════════════════════════════════
// getWriterConfig
// ═══════════════════════════════════════════════════════════════════════════

describe('getWriterConfig', () => {
  it('parses full response with all fields', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        ok: true,
        licenseFilePath: '/path/to/license.lic',
        pixelStreamingUrl: 'https://pixel-streaming.example.com',
        exePath: '/path/to/start2stream.bat',
      }),
    );

    const cfg = await getWriterConfig();
    expect(cfg.licenseFilePath).toBe('/path/to/license.lic');
    expect(cfg.pixelStreamingUrl).toBe('https://pixel-streaming.example.com');
    expect(cfg.exePath).toBe('/path/to/start2stream.bat');
  });

  it('returns empty strings when response has no fields', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));

    const cfg = await getWriterConfig();
    expect(cfg.licenseFilePath).toBe('');
    expect(cfg.pixelStreamingUrl).toBe('');
    expect(cfg.exePath).toBe('');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ error: 'Server error' }, { status: 500 }),
    );

    await expect(getWriterConfig()).rejects.toThrow('Server error');
  });

  it('throws with fallback message when error field is missing on non-ok', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}, { status: 500 }));

    await expect(getWriterConfig()).rejects.toThrow('Failed to read writer config');
  });

  it('handles non-JSON response on non-ok status', async () => {
    mockFetch.mockResolvedValueOnce(mockBrokenJsonResponse(500));

    await expect(getWriterConfig()).rejects.toThrow('Failed to read writer config');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// setWriterFilePath
// ═══════════════════════════════════════════════════════════════════════════

describe('setWriterFilePath', () => {
  it('returns ok with resolvedPath on success', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: true, licenseFilePath: '/resolved/path.lic' }),
    );

    const result = await setWriterFilePath('/some/path.lic');
    expect(result.ok).toBe(true);
    expect(result.resolvedPath).toBe('/resolved/path.lic');
  });

  it('returns error on 400 with error field', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(
        { error: 'File not found', resolvedPath: '/bad/path' },
        { status: 400 },
      ),
    );

    const result = await setWriterFilePath('/bad/path');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('File not found');
    expect(result.resolvedPath).toBe('/bad/path');
  });

  it('sends correct request body', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));

    await setWriterFilePath('/my/file.lic');

    expect(mockFetch).toHaveBeenCalledWith(
      `${WRITER_BASE_URL}/config`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ licenseFilePath: '/my/file.lic' }),
      }),
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// fetchWithTimeout (tested indirectly via AbortError)
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts on timeout', async () => {
    // Simulate a fetch that never resolves but respects abort signal
    mockFetch.mockImplementation(
      (_url: string, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );

    // Attach .catch immediately so the rejection is always handled
    const promise = getWriterConfig().catch((e: unknown) => e);

    // Advance past the 5s timeout
    await vi.advanceTimersByTimeAsync(6_000);

    const error = await promise;
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// readVoiceAgentFromFile
// ═══════════════════════════════════════════════════════════════════════════

describe('readVoiceAgentFromFile', () => {
  it('parses voiceAgent, filePath, and configured from response', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        voiceAgent: 'elevenlabs',
        filePath: '/opt/license.lic',
        configured: true,
      }),
    );

    const result = await readVoiceAgentFromFile();
    expect(result.voiceAgent).toBe('elevenlabs');
    expect(result.filePath).toBe('/opt/license.lic');
    expect(result.configured).toBe(true);
  });

  it('normalizes legacy google-native-audio to gemini-live', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        voiceAgent: 'google-native-audio',
        configured: true,
      }),
    );

    const result = await readVoiceAgentFromFile();
    expect(result.voiceAgent).toBe('gemini-live');
  });

  it('returns null voiceAgent and configured=false on empty response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(null));

    const result = await readVoiceAgentFromFile();
    expect(result.voiceAgent).toBeNull();
    expect(result.configured).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// writeVoiceAgentToFile
// ═══════════════════════════════════════════════════════════════════════════

describe('writeVoiceAgentToFile', () => {
  it('sends correct POST body', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));

    await writeVoiceAgentToFile('elevenlabs');

    expect(mockFetch).toHaveBeenCalledWith(
      `${WRITER_BASE_URL}/voice-agent`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ voiceAgent: 'elevenlabs' }),
      }),
    );
  });

  it('throws on non-ok response with error message', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ error: 'Write failed' }, { status: 500 }),
    );

    await expect(writeVoiceAgentToFile('gemini-live')).rejects.toThrow('Write failed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// startProcess / stopProcess
// ═══════════════════════════════════════════════════════════════════════════

describe('startProcess', () => {
  it('returns ok with pid on success', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ pid: 12345 }),
    );

    const result = await startProcess('/path/to/exe');
    expect(result.ok).toBe(true);
    expect(result.pid).toBe(12345);
  });

  it('returns ok=false with error on failure', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ error: 'Exe not found' }, { status: 400 }),
    );

    const result = await startProcess('/bad/path');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Exe not found');
  });
});

describe('stopProcess', () => {
  it('sends processId in body when provided', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}));

    await stopProcess('kiosk');

    expect(mockFetch).toHaveBeenCalledWith(
      `${WRITER_BASE_URL}/process/stop`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ processId: 'kiosk' }),
      }),
    );
  });

  it('returns ok=false with error on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ error: 'No running process' }, { status: 404 }),
    );

    const result = await stopProcess();
    expect(result.ok).toBe(false);
    expect(result.error).toBe('No running process');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getProcessStatus
// ═══════════════════════════════════════════════════════════════════════════

describe('getProcessStatus', () => {
  it('parses nested processes record correctly', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        running: true,
        pid: 999,
        processes: {
          kiosk: { running: true, pid: 1001 },
          holobox: { running: false, pid: null },
        },
      }),
    );

    const result = await getProcessStatus();
    expect(result.running).toBe(true);
    expect(result.pid).toBe(999);
    expect(result.processes.kiosk).toEqual({ running: true, pid: 1001 });
    expect(result.processes.holobox).toEqual({ running: false, pid: null });
  });

  it('handles missing processes field gracefully', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ running: false, pid: null }),
    );

    const result = await getProcessStatus();
    expect(result.running).toBe(false);
    expect(result.pid).toBeNull();
    expect(result.processes).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// checkPixelStreamingStatus
// ═══════════════════════════════════════════════════════════════════════════

describe('checkPixelStreamingStatus', () => {
  it('returns reachable=false for empty URL', async () => {
    const result = await checkPixelStreamingStatus('');
    expect(result.reachable).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

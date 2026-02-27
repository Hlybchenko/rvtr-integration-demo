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
function mockBrokenJsonResponse(
  status = 200,
): Response {
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
  setDeviceExePath,
  startDeviceProcess,
  stopProcess,
  getProcessStatus,
  restartStart2stream,
} = await import('./voiceAgentWriter');

// ═══════════════════════════════════════════════════════════════════════════
// getWriterConfig
// ═══════════════════════════════════════════════════════════════════════════

describe('getWriterConfig', () => {
  it('parses full response with deviceExePaths', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        ok: true,
        licenseFilePath: '/path/to/license.lic',
        deviceExePaths: {
          holobox: '/path/holobox.bat',
          'keba-kiosk': '/path/keba.bat',
          kiosk: '/path/kiosk.bat',
        },
      }),
    );

    const cfg = await getWriterConfig();
    expect(cfg.licenseFilePath).toBe('/path/to/license.lic');
    expect(cfg.deviceExePaths.holobox).toBe('/path/holobox.bat');
    expect(cfg.deviceExePaths['keba-kiosk']).toBe('/path/keba.bat');
    expect(cfg.deviceExePaths.kiosk).toBe('/path/kiosk.bat');
  });

  it('falls back to legacy start2streamPath when deviceExePaths is missing', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        ok: true,
        licenseFilePath: '/path/to/license.lic',
        start2streamPath: '/legacy/path.exe',
      }),
    );

    const cfg = await getWriterConfig();
    expect(cfg.deviceExePaths.holobox).toBe('/legacy/path.exe');
    expect(cfg.deviceExePaths['keba-kiosk']).toBe('/legacy/path.exe');
    expect(cfg.deviceExePaths.kiosk).toBe('/legacy/path.exe');
  });

  it('returns empty strings when response has no paths', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));

    const cfg = await getWriterConfig();
    expect(cfg.licenseFilePath).toBe('');
    expect(cfg.deviceExePaths.holobox).toBe('');
    expect(cfg.deviceExePaths['keba-kiosk']).toBe('');
    expect(cfg.deviceExePaths.kiosk).toBe('');
  });

  it('handles partial deviceExePaths (some devices missing)', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        ok: true,
        deviceExePaths: { holobox: '/path/holobox.bat' },
        start2streamPath: '/legacy.exe',
      }),
    );

    const cfg = await getWriterConfig();
    expect(cfg.deviceExePaths.holobox).toBe('/path/holobox.bat');
    // Missing devices fall back to legacy path
    expect(cfg.deviceExePaths['keba-kiosk']).toBe('/legacy.exe');
    expect(cfg.deviceExePaths.kiosk).toBe('/legacy.exe');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ error: 'Server error' }, { status: 500 }),
    );

    await expect(getWriterConfig()).rejects.toThrow('Server error');
  });

  it('throws with fallback message when error field is missing on non-ok', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({}, { status: 500 }),
    );

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
// setDeviceExePath
// ═══════════════════════════════════════════════════════════════════════════

describe('setDeviceExePath', () => {
  it('sends deviceId and exePath in body', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: true, exePath: '/resolved/holobox.bat' }),
    );

    const result = await setDeviceExePath('holobox', '/my/holobox.bat');
    expect(result.ok).toBe(true);
    expect(result.resolvedPath).toBe('/resolved/holobox.bat');

    expect(mockFetch).toHaveBeenCalledWith(
      `${WRITER_BASE_URL}/config/device-exe`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ deviceId: 'holobox', exePath: '/my/holobox.bat' }),
      }),
    );
  });

  it('returns error on validation failure', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ error: 'File not found' }, { status: 400 }),
    );

    const result = await setDeviceExePath('kiosk', '/nonexistent.bat');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('File not found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// startDeviceProcess / stopProcess / getProcessStatus
// ═══════════════════════════════════════════════════════════════════════════

describe('startDeviceProcess', () => {
  it('sends correct payload and returns pid', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: true, deviceId: 'holobox', pid: 12345 }),
    );

    const result = await startDeviceProcess('holobox', '/path/holobox.bat');
    expect(result.ok).toBe(true);
    expect(result.deviceId).toBe('holobox');
    expect(result.pid).toBe(12345);
  });

  it('returns error on spawn failure', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ error: 'ENOENT' }, { status: 500 }),
    );

    const result = await startDeviceProcess('kiosk', '/bad.bat');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ENOENT');
  });
});

describe('stopProcess', () => {
  it('returns stoppedDeviceId on success', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: true, stoppedDeviceId: 'holobox' }),
    );

    const result = await stopProcess();
    expect(result.ok).toBe(true);
    expect(result.stoppedDeviceId).toBe('holobox');
  });

  it('handles no active process', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: true, stoppedDeviceId: null }),
    );

    const result = await stopProcess();
    expect(result.ok).toBe(true);
    expect(result.stoppedDeviceId).toBeUndefined();
  });
});

describe('getProcessStatus', () => {
  it('returns running status with deviceId', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: true, running: true, pid: 1234, deviceId: 'keba-kiosk' }),
    );

    const status = await getProcessStatus();
    expect(status.running).toBe(true);
    expect(status.pid).toBe(1234);
    expect(status.deviceId).toBe('keba-kiosk');
  });

  it('returns not running', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: true, running: false, pid: null, deviceId: null }),
    );

    const status = await getProcessStatus();
    expect(status.running).toBe(false);
    expect(status.pid).toBeNull();
    expect(status.deviceId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// restartStart2stream
// ═══════════════════════════════════════════════════════════════════════════

describe('restartStart2stream', () => {
  it('returns ok with deviceId on success', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: true, pid: 999, deviceId: 'kiosk' }),
    );

    const result = await restartStart2stream();
    expect(result.ok).toBe(true);
    expect(result.pid).toBe(999);
    expect(result.deviceId).toBe('kiosk');
  });

  it('returns error when no exe path available', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ error: 'No executable path available for restart' }, { status: 400 }),
    );

    const result = await restartStart2stream();
    expect(result.ok).toBe(false);
    expect(result.error).toBe('No executable path available for restart');
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

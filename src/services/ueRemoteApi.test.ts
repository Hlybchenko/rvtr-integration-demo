// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

// Import after mocks
const {
  sendUeCommand,
  applyCameraTransition,
  applyDeviceSettings,
  checkUeApiHealth,
} = await import('./ueRemoteApi');

// Helpers

/** Extract parsed body from nth mock fetch call */
function callBody(n: number): Record<string, string> {
  const call = mockFetch.mock.calls[n] as [string, { body: string }];
  return JSON.parse(call[1].body) as Record<string, string>;
}

/** Extract init from nth mock fetch call */
function callInit(n: number): RequestInit & { headers: Record<string, string> } {
  return (mockFetch.mock.calls[n] as [string, RequestInit & { headers: Record<string, string> }])[1];
}

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
  } as Response;
}

function errorResponse(status = 500): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
  } as Response;
}

// ═══════════════════════════════════════════════════════════════════════════
// sendUeCommand
// ═══════════════════════════════════════════════════════════════════════════

describe('sendUeCommand', () => {
  it('returns true on 200 OK', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());
    const result = await sendUeCommand('http://ue:8080', { command: 'ping' });
    expect(result).toBe(true);
  });

  it('returns false on empty baseUrl (no fetch)', async () => {
    const result = await sendUeCommand('', { command: 'ping' });
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns false on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await sendUeCommand('http://ue:8080', { command: 'ping' });
    expect(result).toBe(false);
  });

  it('returns false on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500));
    const result = await sendUeCommand('http://ue:8080', { command: 'ping' });
    expect(result).toBe(false);
  });

  it('strips trailing slashes from baseUrl', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());
    await sendUeCommand('http://ue:8080///', { command: 'ping' });

    expect(callInit(0).headers['X-Ue-Target']).toBe('http://ue:8080');
  });

  it('sends correct headers', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());
    await sendUeCommand('http://ue:8080', { command: 'test' });

    const init = callInit(0);
    const url = (mockFetch.mock.calls[0] as [string])[0];
    expect(url).toBe('/ue-api/ravatar');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['X-Ue-Target']).toBe('http://ue:8080');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// applyCameraTransition
// ═══════════════════════════════════════════════════════════════════════════

describe('applyCameraTransition', () => {
  const zero = { zoom: 0, cameraVertical: 0, cameraHorizontal: 0, cameraPitch: 0 };

  it('sends only non-zero deltas', async () => {
    // Only zoom differs
    mockFetch.mockResolvedValueOnce(okResponse());
    const desired = { ...zero, zoom: 50 };

    await applyCameraTransition('http://ue', zero, desired);

    // Only 1 fetch call for zoom
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = callBody(0);
    expect(body.command).toBe('zoom');
    expect(body.offset).toBe('50');
  });

  it('clamps delta to MAX_CAMERA_DELTA (1000)', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());
    const desired = { ...zero, zoom: 2000 };

    const result = await applyCameraTransition('http://ue', zero, desired);

    const body = callBody(0);
    expect(body.offset).toBe('1000');
    // Committed advances by clamped delta, not desired
    expect(result.zoom).toBe(1000);
  });

  it('on partial failure: committed advances only for succeeded axes', async () => {
    // zoom succeeds, cameraVertical fails
    mockFetch
      .mockResolvedValueOnce(okResponse())   // zoom
      .mockResolvedValueOnce(errorResponse()); // cameraVertical

    const desired = { zoom: 10, cameraVertical: 20, cameraHorizontal: 30, cameraPitch: 40 };
    const result = await applyCameraTransition('http://ue', zero, desired);

    expect(result.zoom).toBe(10);
    // Failed axis + remaining axes stay at committed
    expect(result.cameraVertical).toBe(0);
    expect(result.cameraHorizontal).toBe(0);
    expect(result.cameraPitch).toBe(0);
  });

  it('on full success: returns desired position', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse());

    const desired = { zoom: 10, cameraVertical: 20, cameraHorizontal: 30, cameraPitch: 40 };
    const result = await applyCameraTransition('http://ue', zero, desired);

    expect(result).toEqual(desired);
  });

  it('returns copy of committed when baseUrl is empty', async () => {
    const committed = { zoom: 5, cameraVertical: 10, cameraHorizontal: 0, cameraPitch: 0 };
    const result = await applyCameraTransition('', committed, { ...committed, zoom: 100 });

    expect(result).toEqual(committed);
    expect(result).not.toBe(committed); // new object
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('stops on aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const desired = { zoom: 10, cameraVertical: 20, cameraHorizontal: 0, cameraPitch: 0 };
    const result = await applyCameraTransition('http://ue', zero, desired, controller.signal);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toEqual(zero);
  });

  it('sends all four axes sequentially', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse());

    const desired = { zoom: 1, cameraVertical: 2, cameraHorizontal: 3, cameraPitch: 4 };
    await applyCameraTransition('http://ue', zero, desired);

    expect(mockFetch).toHaveBeenCalledTimes(4);
    const commands = [0, 1, 2, 3].map((i) => callBody(i).command);
    expect(commands).toEqual(['zoom', 'CameraVertical', 'CameraHorizontal', 'cameraPitch']);
  });

  it('returns committed unchanged when all deltas are zero', async () => {
    const committed = { zoom: 5, cameraVertical: 10, cameraHorizontal: 15, cameraPitch: 20 };
    const result = await applyCameraTransition('http://ue', committed, committed);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toEqual(committed);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// applyDeviceSettings
// ═══════════════════════════════════════════════════════════════════════════

describe('applyDeviceSettings', () => {
  const zero = { zoom: 0, cameraVertical: 0, cameraHorizontal: 0, cameraPitch: 0 };

  const baseSettings = {
    zoom: 0,
    cameraVertical: 0,
    cameraHorizontal: 0,
    cameraPitch: 0,
    level: 'LVL_Master_ModernOffice' as const,
    avatarId: '',
    showLogo: true,
    allowAvatarChange: true,
    allowInterruption: true,
    isPcm: false,
  };

  it('skips absolute commands when prev matches current', async () => {
    // Same settings, no camera change — zero commands
    const result = await applyDeviceSettings('http://ue', baseSettings, zero, undefined, baseSettings);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.successCount).toBe(0);
  });

  it('sends absolute commands when prev differs', async () => {
    const prev = { ...baseSettings, showLogo: false };
    // Only showLogo changed — 1 absolute command
    mockFetch.mockResolvedValueOnce(okResponse());

    const result = await applyDeviceSettings('http://ue', baseSettings, zero, undefined, prev);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(callBody(0).command).toBe('Logo');
    expect(result.successCount).toBe(1);
  });

  it('sends absolute commands when prev is undefined', async () => {
    // All 5 boolean/level commands + no avatar (empty) = 5 commands
    mockFetch.mockResolvedValue(okResponse());

    const result = await applyDeviceSettings('http://ue', baseSettings, zero);

    // 5 absolute commands (level, logo, avatarChange, interruption, pcm — no avatar because empty)
    expect(mockFetch).toHaveBeenCalledTimes(5);
    expect(result.successCount).toBe(5);
  });

  it('sends camera transition after absolute commands', async () => {
    const settings = { ...baseSettings, zoom: 50 };
    // 5 absolute + 1 camera (zoom)
    mockFetch.mockResolvedValue(okResponse());

    const result = await applyDeviceSettings('http://ue', settings, zero);

    // 5 absolute + 1 zoom = 6
    expect(mockFetch).toHaveBeenCalledTimes(6);
    expect(result.successCount).toBe(6);
    expect(result.newCommitted.zoom).toBe(50);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// checkUeApiHealth
// ═══════════════════════════════════════════════════════════════════════════

describe('checkUeApiHealth', () => {
  it('returns true for status < 502 (even 500 means UE is up)', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500));
    const result = await checkUeApiHealth('http://ue:8080');
    expect(result).toBe(true);
  });

  it('returns false on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await checkUeApiHealth('http://ue:8080');
    expect(result).toBe(false);
  });

  it('returns false for empty baseUrl', async () => {
    const result = await checkUeApiHealth('');
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns false for status 502 (proxy unreachable)', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(502));
    const result = await checkUeApiHealth('http://ue:8080');
    expect(result).toBe(false);
  });
});

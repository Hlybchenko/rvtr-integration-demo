/**
 * UE Remote API client.
 *
 * All commands are routed through a Vite dev-server proxy (`/ue-api/ravatar`)
 * to avoid CORS issues. The actual UE host is passed in `X-Ue-Target` header.
 *
 * Two kinds of commands exist:
 *   - **Absolute** (level, logo, avatar, toggles) — idempotent, safe to re-send.
 *   - **Offset-based** (zoom, cameraVertical/Horizontal, cameraPitch) —
 *     cumulative deltas, NOT idempotent. Must be paired with `resetCameraToZero`
 *     on device switch to prevent camera drift.
 */
import type { UeDeviceSettings, UeLevelId } from '@/stores/ueControlStore';

const REQUEST_TIMEOUT_MS = 5_000;

// ─── Low-level transport ─────────────────────────────────────────────────────

interface UeCommandPayload {
  command: string;
  [key: string]: string;
}

/**
 * Send a single command to the UE Remote API.
 *
 * In dev mode, requests go through the Vite proxy (`/ue-api/ravatar`)
 * to bypass CORS. The actual UE host is passed via the `X-Ue-Target` header.
 *
 * Returns `true` on success, `false` on any error (network, timeout, non-2xx).
 */
export async function sendUeCommand(
  baseUrl: string,
  payload: UeCommandPayload,
): Promise<boolean> {
  if (!baseUrl) return false;

  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const url = '/ue-api/ravatar';
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ue-Target': normalizedBase,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

// ─── Individual commands ─────────────────────────────────────────────────────
// Each function maps to a single UE HTTP command.
// Offset commands (zoom, camera*) send deltas — UE adds them to current state.
// Absolute commands (level, logo, avatar, toggles) set the value directly.

/** @group Offset commands */
export function setZoom(baseUrl: string, offset: number): Promise<boolean> {
  return sendUeCommand(baseUrl, { command: 'zoom', offset: String(offset) });
}

export function setCameraVertical(baseUrl: string, offset: number): Promise<boolean> {
  return sendUeCommand(baseUrl, { command: 'CameraVertical', offset: String(offset) });
}

export function setCameraHorizontal(baseUrl: string, offset: number): Promise<boolean> {
  return sendUeCommand(baseUrl, { command: 'CameraHorizontal', offset: String(offset) });
}

export function setCameraPitch(baseUrl: string, angle: number): Promise<boolean> {
  return sendUeCommand(baseUrl, { command: 'cameraPitch', angle: String(angle) });
}

/** @group Absolute commands */
export function changeLevel(baseUrl: string, level: UeLevelId): Promise<boolean> {
  return sendUeCommand(baseUrl, { command: 'ChangeLevel', Level: level });
}

export function changeAvatarById(baseUrl: string, avatarId: string): Promise<boolean> {
  return sendUeCommand(baseUrl, { command: 'ChangeAvatarByID', AvatarID: avatarId });
}

export function setLogo(baseUrl: string, show: boolean): Promise<boolean> {
  return sendUeCommand(baseUrl, { command: 'Logo', showLogo: String(show) });
}

export function setAllowAvatarChange(baseUrl: string, allow: boolean): Promise<boolean> {
  return sendUeCommand(baseUrl, { command: 'AllowAvatarChange', Allow: String(allow) });
}

export function setInterruption(baseUrl: string, allow: boolean): Promise<boolean> {
  return sendUeCommand(baseUrl, { command: 'Interruption', Allow: String(allow) });
}

export function setOutputAudioFormat(baseUrl: string, isPcm: boolean): Promise<boolean> {
  return sendUeCommand(baseUrl, { command: 'OutputAudioFormat', IsPcm: String(isPcm) });
}

/** @group Action commands (fire-and-forget, no stored state) */
export function lightUp(baseUrl: string): Promise<boolean> {
  return sendUeCommand(baseUrl, { command: 'LightUp' });
}

export function lightDown(baseUrl: string): Promise<boolean> {
  return sendUeCommand(baseUrl, { command: 'LightDown' });
}

export function changeLight(baseUrl: string): Promise<boolean> {
  return sendUeCommand(baseUrl, { command: 'ChangeLight' });
}

export function stopAnswer(baseUrl: string): Promise<boolean> {
  return sendUeCommand(baseUrl, { command: 'StopAnswer' });
}

// ─── Camera reset ────────────────────────────────────────────────────────────

/**
 * Send negative offsets to bring UE camera back to its default (0) position.
 * Call this before applying a different device's settings so the offsets
 * don't stack on top of the previous device's camera position.
 */
export async function resetCameraToZero(
  baseUrl: string,
  currentSettings: Pick<UeDeviceSettings, 'zoom' | 'cameraVertical' | 'cameraHorizontal' | 'cameraPitch'>,
): Promise<void> {
  if (!baseUrl) return;

  // Sequential — UE processes one command at a time
  if (currentSettings.zoom !== 0) await setZoom(baseUrl, -currentSettings.zoom);
  if (currentSettings.cameraVertical !== 0) await setCameraVertical(baseUrl, -currentSettings.cameraVertical);
  if (currentSettings.cameraHorizontal !== 0) await setCameraHorizontal(baseUrl, -currentSettings.cameraHorizontal);
  if (currentSettings.cameraPitch !== 0) await setCameraPitch(baseUrl, -currentSettings.cameraPitch);
}

// ─── Batch apply ─────────────────────────────────────────────────────────────

/**
 * Apply full device settings to UE in a single batch.
 * Sends commands sequentially to avoid overwhelming the UE HTTP server.
 *
 * Camera/zoom values are sent as **offsets** (deltas from UE's current position).
 * On device switch we assume UE is at its default (0) position, so the stored
 * value IS the delta. For non-offset commands (level, toggles) the value is absolute.
 *
 * Accepts an optional AbortSignal to bail out early when the device switches
 * again before the batch finishes. Each failed command gets one retry.
 *
 * Returns the number of successfully applied commands.
 */
export async function applyDeviceSettings(
  baseUrl: string,
  settings: UeDeviceSettings,
  signal?: AbortSignal,
): Promise<number> {
  if (!baseUrl) return 0;

  const commands: Array<() => Promise<boolean>> = [
    // Absolute commands — safe to apply directly
    () => changeLevel(baseUrl, settings.level),
    () => setLogo(baseUrl, settings.showLogo),
    () => setAllowAvatarChange(baseUrl, settings.allowAvatarChange),
    () => setInterruption(baseUrl, settings.allowInterruption),
    () => setOutputAudioFormat(baseUrl, settings.isPcm),
  ];

  // Offset-based commands — only send if non-zero
  if (settings.zoom !== 0) commands.push(() => setZoom(baseUrl, settings.zoom));
  if (settings.cameraVertical !== 0) commands.push(() => setCameraVertical(baseUrl, settings.cameraVertical));
  if (settings.cameraHorizontal !== 0) commands.push(() => setCameraHorizontal(baseUrl, settings.cameraHorizontal));
  if (settings.cameraPitch !== 0) commands.push(() => setCameraPitch(baseUrl, settings.cameraPitch));

  // Apply avatar only if ID is specified
  if (settings.avatarId.trim()) {
    commands.push(() => changeAvatarById(baseUrl, settings.avatarId));
  }

  let success = 0;
  for (const cmd of commands) {
    if (signal?.aborted) break;
    let ok = await cmd();
    // One retry for transient failures
    if (!ok && !signal?.aborted) ok = await cmd();
    if (ok) success++;
  }
  return success;
}

// ─── Health check ────────────────────────────────────────────────────────────

/**
 * Check if UE Remote API is reachable.
 * Sends a no-op POST through the Vite proxy and treats any non-5xx response as healthy.
 */
export async function checkUeApiHealth(baseUrl: string): Promise<boolean> {
  if (!baseUrl) return false;

  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 3_000);

  try {
    const res = await fetch('/ue-api/ravatar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ue-Target': normalizedBase,
      },
      body: JSON.stringify({ command: 'ping' }),
      signal: controller.signal,
    });
    // Any response (even 404 for unknown command) means UE is up.
    // 502/504 from our proxy means UE is unreachable.
    return res.status < 500;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * UE Remote API client.
 *
 * All commands are routed through a Vite dev-server proxy (`/ue-api/ravatar`)
 * to avoid CORS issues. The actual UE host is passed in `X-Ue-Target` header.
 *
 * Two kinds of commands exist:
 *   - **Absolute** (level, logo, avatar, toggles) — idempotent, safe to re-send.
 *   - **Offset-based** (zoom, cameraVertical/Horizontal, cameraPitch) —
 *     cumulative deltas, NOT idempotent. Transitions use `applyCameraTransition`
 *     to compute per-axis deltas from the committed camera position.
 */
import type { UeDeviceSettings, UeLevelId, CameraPosition } from '@/stores/ueControlStore';
import { ZERO_CAMERA } from '@/stores/ueControlStore';

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

// ─── Camera transition ───────────────────────────────────────────────────────

/** Camera axis keys in send order */
const CAMERA_KEYS: (keyof CameraPosition)[] = [
  'zoom',
  'cameraVertical',
  'cameraHorizontal',
  'cameraPitch',
];

/** Map camera key → UE send function */
const CAMERA_SENDERS: Record<
  keyof CameraPosition,
  (baseUrl: string, delta: number) => Promise<boolean>
> = {
  zoom: setZoom,
  cameraVertical: setCameraVertical,
  cameraHorizontal: setCameraHorizontal,
  cameraPitch: setCameraPitch,
};

/**
 * Transition UE camera from `committed` position to `desired` position
 * by computing per-axis deltas and sending only non-zero ones.
 *
 * Returns the new committed position: axes that succeeded advance to
 * desired; axes that failed stay at their previous committed value.
 * This prevents phantom drift on partial failure.
 */
export async function applyCameraTransition(
  baseUrl: string,
  committed: CameraPosition,
  desired: CameraPosition,
  signal?: AbortSignal,
): Promise<CameraPosition> {
  if (!baseUrl) return { ...committed };

  const newCommitted = { ...committed };

  for (const key of CAMERA_KEYS) {
    if (signal?.aborted) break;

    const delta = desired[key] - committed[key];
    if (delta === 0) {
      newCommitted[key] = desired[key];
      continue;
    }

    const sendFn = CAMERA_SENDERS[key];
    let ok = await sendFn(baseUrl, delta);
    if (!ok && !signal?.aborted) ok = await sendFn(baseUrl, delta);

    if (ok) {
      newCommitted[key] = desired[key];
    }
  }

  return newCommitted;
}

/**
 * Send offsets to bring UE camera back to its default (0) position
 * from the given committed position.
 *
 * Returns the new committed position (zeros on full success).
 */
export async function resetCameraToZero(
  baseUrl: string,
  committed: CameraPosition,
): Promise<CameraPosition> {
  return applyCameraTransition(baseUrl, committed, ZERO_CAMERA);
}

// ─── Batch apply ─────────────────────────────────────────────────────────────

/**
 * Apply full device settings to UE in a single batch.
 * Sends commands sequentially to avoid overwhelming the UE HTTP server.
 *
 * Camera commands are computed as deltas from `committed` to the target
 * `settings` camera values. Non-camera commands (level, toggles) are
 * absolute and only sent if changed from `prev`.
 *
 * Accepts an optional AbortSignal to bail out early when the device
 * switches again before the batch finishes. Each failed command gets
 * one retry.
 *
 * Returns the number of successfully applied commands and the new
 * committed camera position.
 */
export async function applyDeviceSettings(
  baseUrl: string,
  settings: UeDeviceSettings,
  committed: CameraPosition,
  signal?: AbortSignal,
  prev?: UeDeviceSettings,
): Promise<{ successCount: number; newCommitted: CameraPosition }> {
  if (!baseUrl) return { successCount: 0, newCommitted: { ...committed } };

  let success = 0;

  // Absolute commands — skip if value unchanged from previous device
  const absoluteCommands: Array<() => Promise<boolean>> = [];

  if (!prev || prev.level !== settings.level) {
    absoluteCommands.push(() => changeLevel(baseUrl, settings.level));
  }
  if (!prev || prev.showLogo !== settings.showLogo) {
    absoluteCommands.push(() => setLogo(baseUrl, settings.showLogo));
  }
  if (!prev || prev.allowAvatarChange !== settings.allowAvatarChange) {
    absoluteCommands.push(() => setAllowAvatarChange(baseUrl, settings.allowAvatarChange));
  }
  if (!prev || prev.allowInterruption !== settings.allowInterruption) {
    absoluteCommands.push(() => setInterruption(baseUrl, settings.allowInterruption));
  }
  if (!prev || prev.isPcm !== settings.isPcm) {
    absoluteCommands.push(() => setOutputAudioFormat(baseUrl, settings.isPcm));
  }
  if (settings.avatarId.trim() && (!prev || prev.avatarId !== settings.avatarId)) {
    absoluteCommands.push(() => changeAvatarById(baseUrl, settings.avatarId));
  }

  for (const cmd of absoluteCommands) {
    if (signal?.aborted) break;
    let ok = await cmd();
    if (!ok && !signal?.aborted) ok = await cmd();
    if (ok) success++;
  }

  // Camera offset commands — delta from committed to desired
  const desired: CameraPosition = {
    zoom: settings.zoom,
    cameraVertical: settings.cameraVertical,
    cameraHorizontal: settings.cameraHorizontal,
    cameraPitch: settings.cameraPitch,
  };

  const newCommitted = await applyCameraTransition(baseUrl, committed, desired, signal);

  for (const key of CAMERA_KEYS) {
    if (newCommitted[key] !== committed[key]) success++;
  }

  return { successCount: success, newCommitted };
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
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
    // Any response from UE (including 500 for unknown commands) means UE is up.
    // Only 502/504 from our Vite proxy mean UE is truly unreachable.
    return res.status < 502;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

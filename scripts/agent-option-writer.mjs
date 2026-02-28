import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  AGENT_TO_PATH_SEGMENT,
  PATH_SEGMENT_TO_AGENT,
  ALLOWED_AGENTS,
  LEGACY_ALIASES,
  decodeFileBuffer,
  encodeToBuffer,
  extractVoiceAgentFromApiServer,
  normalizeVoiceAgent,
} from './license-utils.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORT = 3210;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, '..', '.rvtr-config.json');

// ---------------------------------------------------------------------------
// Config persistence  (.rvtr-config.json next to the project root)
// ---------------------------------------------------------------------------

/** @returns {{ licenseFilePath: string, start2streamPath: string } | null} */
async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') return data;
    return null;
  } catch {
    return null;
  }
}

let _configQueue = Promise.resolve();

async function writeConfig(cfg) {
  _configQueue = _configQueue.then(async () => {
    const existing = (await readConfig()) || {};
    const merged = { ...existing, ...cfg };
    await fs.writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
  });
  return _configQueue;
}

// ---------------------------------------------------------------------------
// Process management (start2stream)
// ---------------------------------------------------------------------------

/**
 * Active process state — only one device process runs at a time.
 * @type {{ deviceId: string, child: import('node:child_process').ChildProcess } | null}
 */
let activeProcess = null;

/** Legacy alias used by some internal references */
function getStart2streamProcess() {
  return activeProcess?.child ?? null;
}

/** Full path to taskkill.exe — avoids ENOENT if PATH is incomplete */
function getTaskkillPath() {
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  return path.join(systemRoot, 'System32', 'taskkill.exe');
}

/**
 * Kill the active process if running.
 * Cross-platform: SIGTERM on POSIX, taskkill on Windows.
 * Returns the deviceId of the killed process, or null.
 */
async function killActiveProcess() {
  const proc = activeProcess;
  if (!proc || proc.child.exitCode !== null) {
    activeProcess = null;
    return null;
  }

  const pid = proc.child.pid;
  const killedDeviceId = proc.deviceId;
  if (!pid) { activeProcess = null; return null; }

  const isWin = os.platform() === 'win32';
  const taskkill = isWin ? getTaskkillPath() : null;

  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(forceTimer); resolve(); } };

    const forceTimer = setTimeout(() => {
      try {
        if (isWin) {
          execFile(taskkill, ['/F', '/T', '/PID', String(pid)], finish);
          return;
        }
        process.kill(pid, 'SIGKILL');
      } catch { /* already dead */ }
      finish();
    }, 3000);

    proc.child.once('exit', finish);

    try {
      if (isWin) {
        execFile(taskkill, ['/T', '/PID', String(pid)], () => {});
      } else {
        process.kill(pid, 'SIGTERM');
      }
    } catch {
      finish();
    }
  });

  activeProcess = null;
  return killedDeviceId;
}

/**
 * Spawn start2stream executable.
 * Returns a Promise that resolves with the child process once it's confirmed
 * started (or rejects if spawn fails immediately).
 */
function spawnStart2stream(exePath) {
  return new Promise((resolve, reject) => {
    const cwd = path.dirname(exePath);
    const isWin = os.platform() === 'win32';

    // On Windows, use just the filename so cmd.exe resolves it from cwd.
    // This ensures the exe starts with its own directory as the true CWD
    // (important for DLL loading, config files, relative paths inside the exe).
    const command = isWin ? path.basename(exePath) : exePath;

    const child = spawn(command, [], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: false,
      shell: isWin,
    });

    let resolved = false;

    child.stderr?.on('data', (chunk) => {
      process.stderr.write(`[start2stream:err] ${chunk}`);
    });

    child.on('error', (err) => {
      console.error(`[start2stream] error: ${err.message}`);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    child.on('exit', (code, signal) => {
      if (code !== 0) console.error(`[start2stream] exited code=${code} signal=${signal}`);
      if (activeProcess?.child === child) activeProcess = null;
    });

    // If no error event fires within 500ms, consider the process started.
    // The 'error' event fires synchronously for spawn failures (ENOENT etc.)
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(child);
      }
    }, 500);
  });
}

/**
 * Validate that a path points to an existing executable file.
 */
async function validateExecutable(filePath) {
  const errors = [];

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      errors.push('Path is not a regular file');
    }
  } catch {
    return { valid: false, errors: [`File not found: ${filePath}`] };
  }

  // On Windows, check extension
  if (os.platform() === 'win32') {
    const ext = path.extname(filePath).toLowerCase();
    if (!['.bat', '.cmd', '.ps1', '.exe'].includes(ext)) {
      errors.push(`Unexpected file extension "${ext}" (expected .bat, .cmd, .ps1, .exe)`);
    }
  } else {
    // On POSIX, check executable permission
    try {
      await fs.access(filePath, fs.constants?.X_OK ?? 1);
    } catch {
      // Not critical on macOS for dev — just warn
      errors.push('File is not marked as executable (may not run on this OS)');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// License file helpers (UTF-16LE JSON with BOM)
// decodeFileBuffer, encodeToBuffer — imported from license-utils.mjs
// ---------------------------------------------------------------------------

/**
 * Read the license file, parse JSON, extract voice agent from ApiServer field.
 * @returns {{ voiceAgent: string|null, data: object|null, encoding: string, raw: string }}
 */
async function readLicenseFile(filePath) {
  const buf = await fs.readFile(filePath);
  const { text, encoding } = decodeFileBuffer(buf);

  // Clean potential invisible chars (zero-width spaces, etc.)
  const cleaned = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim();

  let data;
  try {
    data = JSON.parse(cleaned);
  } catch {
    return { voiceAgent: null, data: null, encoding, raw: text };
  }

  const apiServer = data.ApiServer || data.apiServer || '';
  const voiceAgent = extractVoiceAgentFromApiServer(apiServer);

  return { voiceAgent, data, encoding, raw: text };
}

// extractVoiceAgentFromApiServer — imported from license-utils.mjs

/**
 * Write voice agent to the license file by replacing the path segment in ApiServer.
 */
async function writeVoiceAgentToLicense(filePath, voiceAgent) {
  const { data, encoding } = await readLicenseFile(filePath);

  if (!data) {
    throw new Error('Cannot parse license file as JSON');
  }

  const apiServerKey = 'ApiServer' in data ? 'ApiServer' : 'apiServer';
  const currentValue = data[apiServerKey] || '';

  if (typeof currentValue !== 'string') {
    throw new Error(`License file has no valid ${apiServerKey} field`);
  }

  const lastSlash = currentValue.lastIndexOf('/');
  if (lastSlash === -1) {
    throw new Error(`ApiServer value "${currentValue}" has no path segment to replace`);
  }

  const newSegment = AGENT_TO_PATH_SEGMENT[voiceAgent];
  if (!newSegment) {
    throw new Error(`No path segment mapping for agent "${voiceAgent}"`);
  }

  const newApiServer = currentValue.substring(0, lastSlash + 1) + newSegment;
  data[apiServerKey] = newApiServer;

  // Preserve original formatting (tabs), use atomic write pattern
  const json = JSON.stringify(data, null, '\t');
  const buf = encodeToBuffer(json, encoding);
  const tmpPath = filePath + '.tmp';
  await fs.writeFile(tmpPath, buf);
  await fs.rename(tmpPath, filePath);

  // Verify write succeeded
  const verified = await readLicenseFile(filePath);
  if (verified.voiceAgent !== voiceAgent) {
    throw new Error(
      `Write verification failed: wrote "${voiceAgent}" but read back "${verified.voiceAgent}"`,
    );
  }

  return { apiServer: newApiServer, voiceAgent };
}

// ---------------------------------------------------------------------------
// Validate license file at a given path
// ---------------------------------------------------------------------------

async function validateLicenseFile(filePath) {
  const errors = [];

  // Check exists
  try {
    await fs.access(filePath, fs.constants?.R_OK ?? 4);
  } catch {
    return { valid: false, errors: [`File not found or not readable: ${filePath}`] };
  }

  // Check writable
  try {
    await fs.access(filePath, fs.constants?.W_OK ?? 2);
  } catch {
    errors.push('File is not writable');
  }

  // Try parse
  try {
    const result = await readLicenseFile(filePath);
    if (!result.data) {
      errors.push('File content is not valid JSON');
    } else {
      const apiServerKey = 'ApiServer' in result.data ? 'ApiServer' : 'apiServer';
      const apiServer = result.data[apiServerKey];
      if (!apiServer || typeof apiServer !== 'string') {
        errors.push('No ApiServer field found in JSON');
      } else if (!apiServer.includes('/')) {
        errors.push(`ApiServer value "${apiServer}" has no path segment`);
      } else if (!result.voiceAgent) {
        errors.push(
          `ApiServer path segment is not recognized (expected /elevenlabs or /gemini)`,
        );
      }
    }
  } catch (err) {
    errors.push(`Failed to read file: ${err.message}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// normalizeVoiceAgent — imported from license-utils.mjs

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Native file picker — Windows helper (temp .ps1 file approach)
// ---------------------------------------------------------------------------

/**
 * Resolve full path to Windows PowerShell 5.1 (ships with every Windows 10/11).
 * Using full path avoids issues where powershell.exe is not on PATH in some
 * Node.js child process environments.
 */
function getWindowsPowerShellPath() {
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * Run a PowerShell script on Windows via a temp .ps1 file.
 * Uses -STA (required for GUI dialogs) and -ExecutionPolicy Bypass.
 * NOTE: -NonInteractive is intentionally omitted — it can block GUI dialogs.
 */
async function runPowerShellScript(scriptContent) {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `rvtr-picker-${Date.now()}.ps1`);
  const psExe = getWindowsPowerShellPath();

  await fs.writeFile(tmpFile, scriptContent, 'utf8');

  return new Promise((resolve, reject) => {
    execFile(
      psExe,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', tmpFile],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
      async (error, stdout, stderr) => {
        // Cleanup temp file
        try { await fs.unlink(tmpFile); } catch { /* ignore */ }

        if (stderr) {
          console.error(`[file-picker] PowerShell stderr: ${stderr}`);
        }

        if (error) {
          console.error(`[file-picker] PowerShell error: code=${error.code} killed=${error.killed} msg=${error.message}`);
          if (error.killed || error.code === 1) {
            resolve(null); // user cancelled or timeout
          } else {
            reject(new Error(`File picker failed: ${error.message}`));
          }
          return;
        }

        resolve(stdout.trim() || null);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Native file picker dialog (macOS / Windows / Linux)
// ---------------------------------------------------------------------------

/**
 * Opens a native OS file-picker dialog and returns the selected file path.
 * Returns `null` if user cancels.
 */
function openNativeFilePicker() {
  const platform = os.platform();

  if (platform === 'win32') {
    // Use WPF Microsoft.Win32.OpenFileDialog — better focus handling on Win11
    // than WinForms. PresentationFramework provides the dialog, -STA is required.
    return runPowerShellScript(`
Add-Type -AssemblyName PresentationFramework

$dialog = New-Object Microsoft.Win32.OpenFileDialog
$dialog.Filter = "License files (*.lic;*.json;*.txt)|*.lic;*.json;*.txt|All files (*.*)|*.*"
$dialog.Title = "Select license file"
$result = $dialog.ShowDialog()
if ($result) {
    Write-Output $dialog.FileName
}
`);
  }

  return new Promise((resolve, reject) => {
    if (platform === 'darwin') {
      execFile(
        'osascript',
        [
          '-e',
          'set chosenFile to choose file with prompt "Select license file" of type {"lic","json","txt"}\nreturn POSIX path of chosenFile',
        ],
        { timeout: 60_000 },
        (error, stdout) => {
          if (error) {
            if (error.code === 1 || error.killed) resolve(null);
            else reject(new Error(`File picker failed: ${error.message}`));
            return;
          }
          resolve(stdout.trim() || null);
        },
      );
    } else {
      // Linux: zenity fallback
      execFile(
        'zenity',
        ['--file-selection', '--title=Select license file', '--file-filter=*.lic *.json *.txt'],
        { timeout: 60_000 },
        (error, stdout) => {
          if (error) { resolve(null); return; }
          resolve(stdout.trim() || null);
        },
      );
    }
  });
}

/**
 * Opens a native OS file-picker for executable files.
 * Returns `null` if user cancels.
 */
function openNativeExePicker() {
  const platform = os.platform();

  if (platform === 'win32') {
    return runPowerShellScript(`
Add-Type -AssemblyName PresentationFramework

$dialog = New-Object Microsoft.Win32.OpenFileDialog
$dialog.Filter = "Batch files (*.bat)|*.bat|All files (*.*)|*.*"
$dialog.Title = "Select start2stream batch file"
$result = $dialog.ShowDialog()
if ($result) {
    Write-Output $dialog.FileName
}
`);
  }

  return new Promise((resolve, reject) => {
    if (platform === 'darwin') {
      execFile(
        'osascript',
        [
          '-e',
          'set chosenFile to choose file with prompt "Select start2stream batch file"\nreturn POSIX path of chosenFile',
        ],
        { timeout: 60_000 },
        (error, stdout) => {
          if (error) {
            if (error.code === 1 || error.killed) resolve(null);
            else reject(new Error(`File picker failed: ${error.message}`));
            return;
          }
          resolve(stdout.trim() || null);
        },
      );
    } else {
      execFile(
        'zenity',
        ['--file-selection', '--title=Select start2stream batch file'],
        { timeout: 60_000 },
        (error, stdout) => {
          if (error) { resolve(null); return; }
          resolve(stdout.trim() || null);
        },
      );
    }
  });
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk.toString()));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { ok: false, error: 'Invalid request URL' });
    return;
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, { ok: true });
    return;
  }

  try {
    // -----------------------------------------------------------------------
    // GET /health
    // -----------------------------------------------------------------------
    if (req.method === 'GET' && req.url === '/health') {
      const cfg = await readConfig();
      sendJson(res, 200, { ok: true, licenseFilePath: cfg?.licenseFilePath ?? null });
      return;
    }

    // -----------------------------------------------------------------------
    // GET /config — return current config
    // -----------------------------------------------------------------------
    if (req.method === 'GET' && req.url === '/config') {
      const cfg = await readConfig();
      sendJson(res, 200, {
        ok: true,
        licenseFilePath: cfg?.licenseFilePath ?? '',
        exePath: cfg?.exePath ?? cfg?.start2streamPath ?? '',
        deviceExePaths: cfg?.deviceExePaths ?? {},
        // Legacy fallback
        start2streamPath: cfg?.start2streamPath ?? '',
      });
      return;
    }

    // -----------------------------------------------------------------------
    // POST /config — set license file path + validate
    // -----------------------------------------------------------------------
    if (req.method === 'POST' && req.url === '/config') {
      const body = await readBody(req);
      const filePath = typeof body.licenseFilePath === 'string' ? body.licenseFilePath.trim() : '';

      if (!filePath) {
        sendJson(res, 400, { ok: false, error: 'licenseFilePath is required' });
        return;
      }

      const resolved = path.resolve(filePath);
      const validation = await validateLicenseFile(resolved);

      if (!validation.valid) {
        sendJson(res, 400, {
          ok: false,
          error: validation.errors.join('; '),
          errors: validation.errors,
          resolvedPath: resolved,
        });
        return;
      }

      await writeConfig({ licenseFilePath: resolved });

      sendJson(res, 200, {
        ok: true,
        licenseFilePath: resolved,
        validation,
      });
      return;
    }

    // -----------------------------------------------------------------------
    // POST /config/validate — validate a path without saving
    // -----------------------------------------------------------------------
    if (req.method === 'POST' && req.url === '/config/validate') {
      const body = await readBody(req);
      const filePath = typeof body.licenseFilePath === 'string' ? body.licenseFilePath.trim() : '';

      if (!filePath) {
        sendJson(res, 400, { ok: false, error: 'licenseFilePath is required' });
        return;
      }

      const resolved = path.resolve(filePath);
      const validation = await validateLicenseFile(resolved);

      sendJson(res, 200, {
        ok: true,
        resolvedPath: resolved,
        ...validation,
      });
      return;
    }

    // -----------------------------------------------------------------------
    // GET /config/browse — open native OS file picker, return selected path
    // -----------------------------------------------------------------------
    if (req.method === 'GET' && req.url === '/config/browse') {
      try {
        const filePath = await openNativeFilePicker();

        if (!filePath) {
          sendJson(res, 200, { ok: true, cancelled: true, licenseFilePath: null });
          return;
        }

        const resolved = path.resolve(filePath);
        const validation = await validateLicenseFile(resolved);

        sendJson(res, 200, {
          ok: true,
          cancelled: false,
          licenseFilePath: resolved,
          ...validation,
        });
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    // -----------------------------------------------------------------------
    // GET /voice-agent — read current agent from license file
    // -----------------------------------------------------------------------
    if (req.method === 'GET' && req.url === '/voice-agent') {
      const cfg = await readConfig();

      if (!cfg?.licenseFilePath) {
        sendJson(res, 200, {
          ok: true,
          configured: false,
          voiceAgent: null,
          filePath: null,
          error: 'No license file path configured',
        });
        return;
      }

      try {
        const result = await readLicenseFile(cfg.licenseFilePath);
        sendJson(res, 200, {
          ok: true,
          configured: true,
          filePath: cfg.licenseFilePath,
          voiceAgent: result.voiceAgent,
          matchesKnownOption: Boolean(result.voiceAgent),
        });
      } catch (err) {
        sendJson(res, 200, {
          ok: true,
          configured: true,
          filePath: cfg.licenseFilePath,
          voiceAgent: null,
          matchesKnownOption: false,
          error: err.message,
        });
      }
      return;
    }

    // -----------------------------------------------------------------------
    // POST /voice-agent — write agent to license file
    // -----------------------------------------------------------------------
    if (req.method === 'POST' && req.url === '/voice-agent') {
      const cfg = await readConfig();

      if (!cfg?.licenseFilePath) {
        sendJson(res, 400, {
          ok: false,
          error: 'No license file path configured. Set it via POST /config first.',
        });
        return;
      }

      const body = await readBody(req);
      const voiceAgent = normalizeVoiceAgent(body.voiceAgent);

      if (!voiceAgent) {
        sendJson(res, 400, { ok: false, error: 'Unsupported voiceAgent value' });
        return;
      }

      const result = await writeVoiceAgentToLicense(cfg.licenseFilePath, voiceAgent);
      sendJson(res, 200, {
        ok: true,
        filePath: cfg.licenseFilePath,
        voiceAgent: result.voiceAgent,
        apiServer: result.apiServer,
      });
      return;
    }

    // -----------------------------------------------------------------------
    // POST /config/device-exe — set executable path for a specific device
    // -----------------------------------------------------------------------
    if (req.method === 'POST' && req.url === '/config/device-exe') {
      const body = await readBody(req);
      const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
      const exePath = typeof body.exePath === 'string' ? body.exePath.trim() : '';

      if (!deviceId) {
        sendJson(res, 400, { ok: false, error: 'deviceId is required' });
        return;
      }
      if (!exePath) {
        sendJson(res, 400, { ok: false, error: 'exePath is required' });
        return;
      }

      const resolved = path.resolve(exePath);
      const validation = await validateExecutable(resolved);

      if (!validation.valid) {
        sendJson(res, 400, {
          ok: false,
          error: validation.errors.join('; '),
          errors: validation.errors,
          resolvedPath: resolved,
        });
        return;
      }

      // Store per-device path under deviceExePaths.<deviceId>
      const cfg = (await readConfig()) || {};
      const deviceExePaths = cfg.deviceExePaths || {};
      deviceExePaths[deviceId] = resolved;
      await writeConfig({ deviceExePaths });

      sendJson(res, 200, {
        ok: true,
        deviceId,
        exePath: resolved,
        validation,
      });
      return;
    }

    // -----------------------------------------------------------------------
    // GET /config/device-exe — get all per-device executable paths
    // -----------------------------------------------------------------------
    if (req.method === 'GET' && req.url === '/config/device-exe') {
      const cfg = await readConfig();
      sendJson(res, 200, {
        ok: true,
        deviceExePaths: cfg?.deviceExePaths ?? {},
        // Legacy fallback
        start2streamPath: cfg?.start2streamPath ?? '',
      });
      return;
    }

    // -----------------------------------------------------------------------
    // POST /config/exe — set global executable path (replaces start2streamPath)
    // -----------------------------------------------------------------------
    if (req.method === 'POST' && req.url === '/config/exe') {
      const body = await readBody(req);
      const exePath = typeof body.exePath === 'string' ? body.exePath.trim() : '';

      if (!exePath) {
        sendJson(res, 400, { ok: false, error: 'exePath is required' });
        return;
      }

      const resolved = path.resolve(exePath);
      const validation = await validateExecutable(resolved);

      if (!validation.valid) {
        sendJson(res, 400, {
          ok: false,
          error: validation.errors.join('; '),
          errors: validation.errors,
          resolvedPath: resolved,
        });
        return;
      }

      await writeConfig({ exePath: resolved });

      sendJson(res, 200, {
        ok: true,
        exePath: resolved,
        validation,
      });
      return;
    }

    // -----------------------------------------------------------------------
    // POST /config/validate-exe — validate executable path without saving
    // -----------------------------------------------------------------------
    if (req.method === 'POST' && req.url === '/config/validate-exe') {
      const body = await readBody(req);
      const exePath = typeof body.exePath === 'string'
        ? body.exePath.trim()
        : typeof body.start2streamPath === 'string'
          ? body.start2streamPath.trim()
          : '';

      if (!exePath) {
        sendJson(res, 400, { ok: false, error: 'exePath is required' });
        return;
      }

      const resolved = path.resolve(exePath);
      const validation = await validateExecutable(resolved);

      sendJson(res, 200, { ok: true, resolvedPath: resolved, ...validation });
      return;
    }

    // -----------------------------------------------------------------------
    // GET /config/browse-exe — native file picker for executables
    // -----------------------------------------------------------------------
    if (req.method === 'GET' && req.url === '/config/browse-exe') {
      try {
        const filePath = await openNativeExePicker();

        if (!filePath) {
          sendJson(res, 200, { ok: true, cancelled: true, exePath: null });
          return;
        }

        const resolved = path.resolve(filePath);
        const validation = await validateExecutable(resolved);

        sendJson(res, 200, {
          ok: true,
          cancelled: false,
          exePath: resolved,
          ...validation,
        });
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    // -----------------------------------------------------------------------
    // POST /process/start — start process for a device (kills previous if any)
    // -----------------------------------------------------------------------
    if (req.method === 'POST' && req.url === '/process/start') {
      const body = await readBody(req);
      const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
      const exePath = typeof body.exePath === 'string' ? body.exePath.trim() : '';

      if (!deviceId || !exePath) {
        sendJson(res, 400, {
          ok: false,
          error: 'deviceId and exePath are required',
        });
        return;
      }

      const resolved = path.resolve(exePath);
      const validation = await validateExecutable(resolved);
      if (!validation.valid) {
        sendJson(res, 400, {
          ok: false,
          error: `Executable invalid: ${validation.errors.join('; ')}`,
        });
        return;
      }

      try {
        await killActiveProcess();
        const child = await spawnStart2stream(resolved);
        activeProcess = { deviceId, child };

        sendJson(res, 200, {
          ok: true,
          deviceId,
          pid: child.pid,
          exePath: resolved,
        });
      } catch (error) {
        console.error(`[process/start] ${error instanceof Error ? error.message : error}`);
        sendJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    // -----------------------------------------------------------------------
    // POST /process/stop — stop the currently running process
    // -----------------------------------------------------------------------
    if (req.method === 'POST' && req.url === '/process/stop') {
      const killedDeviceId = await killActiveProcess();

      sendJson(res, 200, {
        ok: true,
        stoppedDeviceId: killedDeviceId,
      });
      return;
    }

    // -----------------------------------------------------------------------
    // POST /process/restart — kill + re-spawn for current or specified device
    // -----------------------------------------------------------------------
    if (req.method === 'POST' && req.url === '/process/restart') {
      const body = await readBody(req);
      // Can optionally pass deviceId + exePath; otherwise restarts active process
      let deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
      let exePath = typeof body.exePath === 'string' ? body.exePath.trim() : '';

      // If no deviceId given, restart whatever is currently running
      if (!deviceId && activeProcess) {
        deviceId = activeProcess.deviceId;
        // Look up exe path from config
        const cfg = await readConfig();
        exePath = cfg?.deviceExePaths?.[deviceId] ?? cfg?.exePath ?? cfg?.start2streamPath ?? '';
      }

      if (!exePath) {
        sendJson(res, 400, {
          ok: false,
          error: 'No executable path available for restart',
        });
        return;
      }

      const resolved = path.resolve(exePath);
      const validation = await validateExecutable(resolved);
      if (!validation.valid) {
        sendJson(res, 400, {
          ok: false,
          error: `Executable invalid: ${validation.errors.join('; ')}`,
        });
        return;
      }

      try {
        await killActiveProcess();
        const child = await spawnStart2stream(resolved);
        activeProcess = { deviceId, child };

        sendJson(res, 200, {
          ok: true,
          deviceId,
          pid: child.pid,
          exePath: resolved,
        });
      } catch (error) {
        console.error(`[process/restart] ${error instanceof Error ? error.message : error}`);
        sendJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    // -----------------------------------------------------------------------
    // GET /process/status — check active process status
    // -----------------------------------------------------------------------
    if (req.method === 'GET' && req.url === '/process/status') {
      const child = getStart2streamProcess();
      const running = child !== null && child.exitCode === null;
      sendJson(res, 200, {
        ok: true,
        running,
        pid: running ? child.pid : null,
        deviceId: running ? activeProcess?.deviceId ?? null : null,
      });
      return;
    }

    // -----------------------------------------------------------------------
    // 404
    // -----------------------------------------------------------------------
    sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[agent-option-writer] listening on http://127.0.0.1:${PORT}`);
  console.log(`[agent-option-writer] config: ${CONFIG_PATH}`);
});

async function shutdown() {
  await killActiveProcess();
  server.close(() => process.exit(0));
  // Force exit if server.close hangs (e.g. browse request waiting for dialog)
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

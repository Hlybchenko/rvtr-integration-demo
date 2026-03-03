import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { execFile, spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  AGENT_TO_PATH_SEGMENT,
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
  _configQueue = _configQueue
    .catch(() => {})
    .then(async () => {
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
 * Named processes — multiple concurrent processes keyed by processId.
 * Legacy (no processId) uses the '__default__' key.
 * @type {Map<string, { deviceId: string, child: import('node:child_process').ChildProcess }>}
 */
const activeProcesses = new Map();
const DEFAULT_PROCESS_ID = '__default__';

/**
 * Kill a process by processId.  If no processId given, kills the default.
 * Cross-platform: SIGTERM on POSIX, taskkill on Windows.
 * Returns the deviceId of the killed process, or null.
 */
function killProcess(processId = DEFAULT_PROCESS_ID) {
  const proc = activeProcesses.get(processId);
  if (!proc || proc.child.exitCode !== null) {
    activeProcesses.delete(processId);
    return null;
  }

  const pid = proc.child.pid;
  const killedDeviceId = proc.deviceId;
  if (!pid) { activeProcesses.delete(processId); return null; }

  const isWin = os.platform() === 'win32';

  // Force kill immediately — no graceful shutdown, just terminate
  try {
    if (isWin) {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { shell: true, stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch { /* already dead */ }

  // Safety net: also kill tracked child PIDs
  if (isWin) {
    const trackedPids = proc.child._childPids || [];
    if (trackedPids.length) {
      console.log(`[killProcess] killing tracked child PIDs: ${trackedPids.join(', ')}`);
      killPids(trackedPids);
    }
    const currentChildren = snapshotChildPids(pid);
    if (currentChildren.length) {
      killPids(currentChildren);
    }
  }

  activeProcesses.delete(processId);
  return killedDeviceId;
}

/** Snapshot all descendant PIDs of a given parent PID (Windows only).
 *  Returns array of PID strings, excluding our own process. */
function snapshotChildPids(parentPid) {
  if (!parentPid || os.platform() !== 'win32') return [];
  try {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${parentPid} -and $_.ProcessId -ne ${process.pid} } | ForEach-Object { $_.ProcessId }`,
    ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    if (!result.stdout) return [];
    return result.stdout.split(/\r?\n/).map(s => s.trim()).filter(s => /^\d+$/.test(s));
  } catch { return []; }
}

/** Force-kill a list of PIDs on Windows. */
function killPids(pids) {
  if (!pids.length || os.platform() !== 'win32') return;
  for (const pid of pids) {
    try {
      spawnSync('taskkill', ['/F', '/T', '/PID', pid], { shell: true, stdio: 'ignore' });
    } catch { /* already dead */ }
  }
}

/**
 * Resolve a Windows .lnk shortcut to its actual target path and working directory.
 * Spawning .lnk files via shell creates processes outside the direct parent-child
 * tree (Windows Shell uses ShellExecute), breaking PID tracking and taskkill /T.
 * By resolving first and spawning the target directly, we get a clean process tree.
 * Returns null for non-.lnk files or if resolution fails.
 */
function resolveLnkShortcut(lnkPath) {
  if (os.platform() !== 'win32') return null;
  if (!lnkPath.toLowerCase().endsWith('.lnk')) return null;

  try {
    const escaped = lnkPath.replace(/'/g, "''");
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-Command',
      `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${escaped}'); Write-Output $s.TargetPath; Write-Output $s.WorkingDirectory`,
    ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 });

    const lines = (result.stdout || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const target = lines[0];
    if (!target) return null;

    return { target, workingDir: lines[1] || '' };
  } catch {
    return null;
  }
}

/**
 * How long to watch a newly spawned process before confirming it started.
 * If it exits within this window, we report a startup failure with stderr.
 */
const STARTUP_WATCH_MS = 3_000;

/**
 * Spawn start2stream executable.
 * Watches the process for STARTUP_WATCH_MS — if it exits during that window
 * the promise rejects with exit code + captured stderr (up to 500 chars).
 * Only resolves once the process has been alive for the full watch period.
 */
function spawnStart2stream(exePath) {
  return new Promise((resolve, reject) => {
    const isWin = os.platform() === 'win32';

    // Resolve .lnk shortcuts to their real target so the spawned process
    // stays in our process tree (required for PID tracking and taskkill /T).
    let actualPath = exePath;
    let cwd;
    if (isWin) {
      const lnk = resolveLnkShortcut(exePath);
      if (lnk) {
        actualPath = lnk.target;
        cwd = lnk.workingDir || path.dirname(lnk.target);
        console.log(`[start2stream] resolved .lnk → ${actualPath} (cwd: ${cwd})`);
      }
    }
    if (!cwd) cwd = path.dirname(actualPath);

    // On Windows, use just the filename so cmd.exe resolves it from cwd.
    const command = isWin ? path.basename(actualPath) : actualPath;

    const child = spawn(command, [], {
      cwd,
      stdio: ['ignore', 'inherit', 'pipe'],
      detached: false,
      windowsHide: false,
      shell: isWin,
    });

    let settled = false;
    const stderrChunks = [];

    child.stderr?.on('data', (chunk) => {
      process.stderr.write(`[start2stream:err] ${chunk}`);
      if (!settled) stderrChunks.push(chunk);
    });

    child.on('error', (err) => {
      console.error(`[start2stream] error: ${err.message}`);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on('exit', (code, signal) => {
      if (code !== 0) console.error(`[start2stream] exited code=${code} signal=${signal}`);

      // If still in startup watch window — report as startup failure
      if (!settled) {
        settled = true;
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        const details = stderr ? `\n${stderr.slice(0, 500)}` : '';
        reject(new Error(
          `Process exited during startup (code=${code ?? '?'}, signal=${signal ?? 'none'})${details}`,
        ));
      }

      // Clean up from the map if this child is still registered
      for (const [key, entry] of activeProcesses) {
        if (entry.child === child) { activeProcesses.delete(key); break; }
      }
    });

    // Confirm process is alive after the watch period
    setTimeout(() => {
      if (!settled) {
        settled = true;
        if (child.exitCode !== null) {
          const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
          const details = stderr ? `\n${stderr.slice(0, 500)}` : '';
          reject(new Error(
            `Process exited during startup (code=${child.exitCode})${details}`,
          ));
        } else {
          // Snapshot child PIDs now that the process is stable
          if (child.pid) {
            child._childPids = snapshotChildPids(child.pid);
            if (child._childPids.length) {
              console.log(`[start2stream] tracked child PIDs: ${child._childPids.join(', ')}`);
            }
          }
          resolve(child);
        }
      }
    }, STARTUP_WATCH_MS);
  });
}

/**
 * (Windows-only, fire-and-forget)
 * Poll for a process window by PID and bring it to foreground.
 * Retries every 1s for up to 15s to wait for the UE window to appear.
 */
function focusProcessWindow(pid) {
  if (os.platform() !== 'win32' || !pid) return;

  const psExe = getWindowsPowerShellPath();
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FocusHelper {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  try {
    $proc = Get-Process -Id ${pid} -ErrorAction Stop
    if ($proc.MainWindowHandle -ne 0) {
      [FocusHelper]::ShowWindow($proc.MainWindowHandle, 9)
      [FocusHelper]::SetForegroundWindow($proc.MainWindowHandle)
      exit 0
    }
  } catch { exit 1 }
}
`;

  const tmpFile = path.join(os.tmpdir(), `rvtr-focus-${Date.now()}.ps1`);
  fs.writeFile(tmpFile, script, 'utf8').then(() => {
    const child = execFile(
      psExe,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', tmpFile],
      { timeout: 20_000 },
      () => { fs.unlink(tmpFile).catch(() => {}); },
    );
    child.unref();
  }).catch(() => {});
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
    if (!['.bat', '.cmd', '.ps1', '.exe', '.ahk', '.lnk'].includes(ext)) {
      errors.push(`Unexpected file extension "${ext}" (expected .bat, .cmd, .ps1, .exe, .ahk, .lnk)`);
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
          'tell application "System Events" to set frontmost of process "osascript" to true',
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
$dialog.Filter = "All files (*.*)|*.*|Batch files (*.bat)|*.bat|Executables (*.exe)|*.exe|AutoHotkey (*.ahk)|*.ahk|Shortcuts (*.lnk)|*.lnk"
$dialog.Title = "Select executable or shortcut"
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
          'tell application "System Events" to set frontmost of process "osascript" to true',
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
    // POST /process/start — start a process (named via processId, or default)
    // -----------------------------------------------------------------------
    if (req.method === 'POST' && req.url === '/process/start') {
      const body = await readBody(req);
      const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
      const processId = typeof body.processId === 'string' ? body.processId.trim() : '';
      const exePath = typeof body.exePath === 'string' ? body.exePath.trim() : '';
      const pid_key = processId || DEFAULT_PROCESS_ID;

      if (!exePath) {
        sendJson(res, 400, {
          ok: false,
          error: 'exePath is required',
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
        // Kill only the process with the same processId (not others)
        killProcess(pid_key);

        // killProcess already handles tracked child PIDs

        const child = await spawnStart2stream(resolved);
        activeProcesses.set(pid_key, { deviceId, child, exePath: resolved });

        // Bring the UE window to foreground once it appears (Windows, fire-and-forget)
        focusProcessWindow(child.pid);

        sendJson(res, 200, {
          ok: true,
          pid: child.pid,
          processId: pid_key,
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
    // POST /process/stop — stop a specific or default process
    // -----------------------------------------------------------------------
    if (req.method === 'POST' && req.url === '/process/stop') {
      const body = await readBody(req);
      const processId = typeof body.processId === 'string' ? body.processId.trim() : '';
      const pid_key = processId || DEFAULT_PROCESS_ID;

      const killedDeviceId = killProcess(pid_key);

      sendJson(res, 200, {
        ok: true,
        processId: pid_key,
        stoppedDeviceId: killedDeviceId,
      });
      return;
    }

    // -----------------------------------------------------------------------
    // POST /process/restart — kill + re-spawn for a specific or default process
    // -----------------------------------------------------------------------
    if (req.method === 'POST' && req.url === '/process/restart') {
      const body = await readBody(req);
      const processId = typeof body.processId === 'string' ? body.processId.trim() : '';
      const pid_key = processId || DEFAULT_PROCESS_ID;
      let deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
      let exePath = typeof body.exePath === 'string' ? body.exePath.trim() : '';

      // Resolve exe path from active process or saved config
      if (!exePath) {
        const existing = activeProcesses.get(pid_key);
        if (!deviceId && existing) {
          deviceId = existing.deviceId;
        }
        const cfg = await readConfig();
        exePath = (deviceId && cfg?.deviceExePaths?.[deviceId])
          || cfg?.exePath
          || cfg?.start2streamPath
          || '';
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
        killProcess(pid_key);

        // killProcess already handles tracked child PIDs

        const child = await spawnStart2stream(resolved);
        activeProcesses.set(pid_key, { deviceId, child, exePath: resolved });

        sendJson(res, 200, {
          ok: true,
          processId: pid_key,
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
    // GET /process/status — check all process statuses
    // -----------------------------------------------------------------------
    if (req.method === 'GET' && req.url === '/process/status') {
      // Legacy single-process fields (backward compat for Settings page)
      const defaultEntry = activeProcesses.get(DEFAULT_PROCESS_ID);
      const defaultChild = defaultEntry?.child ?? null;
      const defaultRunning = defaultChild !== null && defaultChild.exitCode === null;

      // All named processes
      const processes = {};
      for (const [key, entry] of activeProcesses) {
        const alive = entry.child.exitCode === null;
        if (!alive) { activeProcesses.delete(key); continue; }
        processes[key] = {
          running: true,
          pid: entry.child.pid ?? null,
          deviceId: entry.deviceId || null,
        };
      }

      sendJson(res, 200, {
        ok: true,
        running: defaultRunning,
        pid: defaultRunning ? defaultChild.pid : null,
        deviceId: defaultRunning ? defaultEntry?.deviceId ?? null : null,
        processes,
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

function shutdown() {
  for (const key of [...activeProcesses.keys()]) {
    killProcess(key);
  }
  server.close(() => process.exit(0));
  // Force exit if server.close hangs (e.g. browse request waiting for dialog)
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

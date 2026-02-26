import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORT = 3210;
const ALLOWED_AGENTS = new Set(['elevenlabs', 'gemini-live']);
const LEGACY_ALIASES = new Map([['google-native-audio', 'gemini-live']]);

/** Map voice agent id → ApiServer path segment in the license file */
const AGENT_TO_PATH_SEGMENT = { elevenlabs: 'elevenlabs', 'gemini-live': 'gemini' };
/** Reverse: path segment → voice agent id */
const PATH_SEGMENT_TO_AGENT = { elevenlabs: 'elevenlabs', gemini: 'gemini-live' };

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

async function writeConfig(cfg) {
  const existing = (await readConfig()) || {};
  const merged = { ...existing, ...cfg };
  await fs.writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Process management (start2stream)
// ---------------------------------------------------------------------------

/** @type {import('node:child_process').ChildProcess | null} */
let start2streamProcess = null;

/**
 * Kill the current start2stream process if running.
 * Cross-platform: SIGTERM on POSIX, taskkill on Windows.
 */
async function killStart2stream() {
  if (!start2streamProcess || start2streamProcess.exitCode !== null) {
    console.log(`[start2stream] no running process to kill`);
    start2streamProcess = null;
    return;
  }
  console.log(`[start2stream] killing pid=${start2streamProcess.pid}`);

  const pid = start2streamProcess.pid;
  if (!pid) return;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      // Force kill if graceful didn't work
      try {
        if (os.platform() === 'win32') {
          execFile('taskkill', ['/F', '/T', '/PID', String(pid)], () => resolve());
        } else {
          process.kill(pid, 'SIGKILL');
        }
      } catch { /* already dead */ }
      resolve();
    }, 3000);

    start2streamProcess.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    try {
      if (os.platform() === 'win32') {
        // /T = kill entire process tree (shell:true spawns cmd.exe → exe)
        execFile('taskkill', ['/T', '/PID', String(pid)], () => {});
      } else {
        process.kill(pid, 'SIGTERM');
      }
    } catch {
      clearTimeout(timeout);
      resolve();
    }
  });
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
    console.log(`[start2stream] spawning: ${exePath}  cwd=${cwd}`);

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

    child.stdout?.on('data', (chunk) => {
      process.stdout.write(`[start2stream] ${chunk}`);
    });
    child.stderr?.on('data', (chunk) => {
      process.stderr.write(`[start2stream:err] ${chunk}`);
    });

    child.on('error', (err) => {
      console.error(`[start2stream] spawn error: ${err.message}`);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    child.on('exit', (code, signal) => {
      console.log(`[start2stream] exited with code=${code} signal=${signal}`);
      if (start2streamProcess === child) start2streamProcess = null;
    });

    // If no error event fires within 500ms, consider the process started.
    // The 'error' event fires synchronously for spawn failures (ENOENT etc.)
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.log(`[start2stream] started, pid=${child.pid}`);
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
    if (!['.exe', '.bat', '.cmd', '.ps1'].includes(ext)) {
      errors.push(`Unexpected file extension "${ext}" (expected .exe, .bat, .cmd, .ps1)`);
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
// ---------------------------------------------------------------------------

/**
 * Detect encoding from BOM and return decoded string.
 * Supports UTF-16LE (FF FE), UTF-16BE (FE FF), UTF-8 BOM (EF BB BF), plain UTF-8.
 */
function decodeFileBuffer(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    // UTF-16LE BOM
    return { text: buf.slice(2).toString('utf16le'), encoding: 'utf16le' };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // UTF-16BE — swap byte pairs then decode as LE
    const bodyLen = buf.length - 2;
    const evenLen = bodyLen - (bodyLen % 2); // ensure even byte count
    const swapped = Buffer.alloc(evenLen);
    for (let i = 0; i < evenLen; i += 2) {
      swapped[i] = buf[i + 3];     // low byte
      swapped[i + 1] = buf[i + 2]; // high byte
    }
    return { text: swapped.toString('utf16le'), encoding: 'utf16be' };
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.slice(3).toString('utf8'), encoding: 'utf8-bom' };
  }
  return { text: buf.toString('utf8'), encoding: 'utf8' };
}

/** Encode string back to original encoding with BOM */
function encodeToBuffer(text, encoding) {
  if (encoding === 'utf16le') {
    const bom = Buffer.from([0xff, 0xfe]);
    const body = Buffer.from(text, 'utf16le');
    return Buffer.concat([bom, body]);
  }
  if (encoding === 'utf16be') {
    const bom = Buffer.from([0xfe, 0xff]);
    const le = Buffer.from(text, 'utf16le');
    const evenLen = le.length - (le.length % 2);
    const swapped = Buffer.alloc(evenLen);
    for (let i = 0; i < evenLen; i += 2) {
      swapped[i] = le[i + 1];
      swapped[i + 1] = le[i];
    }
    return Buffer.concat([bom, swapped]);
  }
  if (encoding === 'utf8-bom') {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    return Buffer.concat([bom, Buffer.from(text, 'utf8')]);
  }
  return Buffer.from(text, 'utf8');
}

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

/** Extract voice agent from ApiServer value like "127.0.0.1:8080/gemini" */
function extractVoiceAgentFromApiServer(apiServer) {
  if (typeof apiServer !== 'string') return null;

  // Take the last path segment
  const lastSlash = apiServer.lastIndexOf('/');
  if (lastSlash === -1) return null;

  const segment = apiServer.substring(lastSlash + 1).toLowerCase().trim();
  return PATH_SEGMENT_TO_AGENT[segment] ?? null;
}

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

// ---------------------------------------------------------------------------
// Normalize helper
// ---------------------------------------------------------------------------

function normalizeVoiceAgent(value) {
  if (typeof value !== 'string') return null;
  if (LEGACY_ALIASES.has(value)) return LEGACY_ALIASES.get(value);
  return ALLOWED_AGENTS.has(value) ? value : null;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Native file picker — Windows helper (temp .ps1 file approach)
// ---------------------------------------------------------------------------

/**
 * Run a PowerShell script on Windows via a temp .ps1 file.
 * Much more reliable than inline `-Command` because:
 * - No quoting/escaping issues with special chars
 * - `-ExecutionPolicy Bypass` works properly with `-File`
 * - `-STA` ensures WinForms dialogs work (STA thread required)
 */
async function runPowerShellScript(scriptContent) {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `rvtr-picker-${Date.now()}.ps1`);

  await fs.writeFile(tmpFile, scriptContent, 'utf8');

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', tmpFile],
      { timeout: 120_000 },
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

        const filePath = stdout.trim();
        console.log(`[file-picker] PowerShell returned: "${filePath}"`);
        resolve(filePath || null);
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
    return runPowerShellScript(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(-9999, -9999)
$form.Size = New-Object System.Drawing.Size(1, 1)
$form.Show()
$form.Hide()

$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Filter = "License files (*.lic;*.json;*.txt)|*.lic;*.json;*.txt|All files (*.*)|*.*"
$dialog.Title = "Select license file"
$result = $dialog.ShowDialog($form)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.FileName
}
$form.Close()
$form.Dispose()
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
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(-9999, -9999)
$form.Size = New-Object System.Drawing.Size(1, 1)
$form.Show()
$form.Hide()

$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Filter = "Executables (*.exe)|*.exe|All files (*.*)|*.*"
$dialog.Title = "Select start2stream executable"
$result = $dialog.ShowDialog($form)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.FileName
}
$form.Close()
$form.Dispose()
`);
  }

  return new Promise((resolve, reject) => {
    if (platform === 'darwin') {
      execFile(
        'osascript',
        [
          '-e',
          'set chosenFile to choose file with prompt "Select start2stream executable"\nreturn POSIX path of chosenFile',
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
        ['--file-selection', '--title=Select start2stream executable'],
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
    // POST /config/start2stream — set start2stream executable path
    // -----------------------------------------------------------------------
    if (req.method === 'POST' && req.url === '/config/start2stream') {
      const body = await readBody(req);
      const exePath = typeof body.start2streamPath === 'string' ? body.start2streamPath.trim() : '';

      if (!exePath) {
        sendJson(res, 400, { ok: false, error: 'start2streamPath is required' });
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

      await writeConfig({ start2streamPath: resolved });

      sendJson(res, 200, {
        ok: true,
        start2streamPath: resolved,
        validation,
      });
      return;
    }

    // -----------------------------------------------------------------------
    // POST /config/validate-exe — validate executable path without saving
    // -----------------------------------------------------------------------
    if (req.method === 'POST' && req.url === '/config/validate-exe') {
      const body = await readBody(req);
      const exePath = typeof body.start2streamPath === 'string' ? body.start2streamPath.trim() : '';

      if (!exePath) {
        sendJson(res, 400, { ok: false, error: 'start2streamPath is required' });
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
          sendJson(res, 200, { ok: true, cancelled: true, start2streamPath: null });
          return;
        }

        const resolved = path.resolve(filePath);
        const validation = await validateExecutable(resolved);

        sendJson(res, 200, {
          ok: true,
          cancelled: false,
          start2streamPath: resolved,
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
    // POST /process/restart — kill + re-spawn start2stream
    // -----------------------------------------------------------------------
    if (req.method === 'POST' && req.url === '/process/restart') {
      const cfg = await readConfig();
      const exePath = cfg?.start2streamPath;

      if (!exePath) {
        sendJson(res, 400, {
          ok: false,
          error: 'No start2stream path configured. Set it via POST /config/start2stream first.',
        });
        return;
      }

      // Validate the exe still exists
      const validation = await validateExecutable(exePath);
      if (!validation.valid) {
        sendJson(res, 400, {
          ok: false,
          error: `Executable invalid: ${validation.errors.join('; ')}`,
        });
        return;
      }

      try {
        console.log(`[process/restart] killing old process...`);
        await killStart2stream();
        console.log(`[process/restart] spawning: ${exePath}`);
        start2streamProcess = await spawnStart2stream(exePath);
        console.log(`[process/restart] spawned pid=${start2streamProcess.pid}`);

        sendJson(res, 200, {
          ok: true,
          pid: start2streamProcess.pid,
          exePath,
        });
      } catch (error) {
        console.error(`[process/restart] error: ${error instanceof Error ? error.message : error}`);
        sendJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    // -----------------------------------------------------------------------
    // GET /process/status — check start2stream process status
    // -----------------------------------------------------------------------
    if (req.method === 'GET' && req.url === '/process/status') {
      const running = start2streamProcess !== null && start2streamProcess.exitCode === null;
      sendJson(res, 200, {
        ok: true,
        running,
        pid: running ? start2streamProcess.pid : null,
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
  await killStart2stream();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

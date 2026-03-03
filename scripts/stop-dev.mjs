import { spawnSync } from 'node:child_process';

const DEV_PORT = 5173;
const WRITER_PORT = 3210;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
    ...options,
  });
}

function parseNumericLines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line));
}

function getListeningPidsOnWindows(port) {
  const result = run('netstat', ['-ano', '-p', 'tcp']);
  if (result.status !== 0 || !result.stdout) return [];

  const pids = new Set();
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.includes(`:${port}`) || !line.includes('LISTENING')) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && /^\d+$/.test(pid)) pids.add(pid);
  }

  return [...pids];
}

function getListeningPidsOnUnix(port) {
  const result = run('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
    shell: false,
  });

  if (result.status !== 0 || !result.stdout) return [];
  return parseNumericLines(result.stdout);
}

function getListeningPids(port) {
  if (process.platform === 'win32') {
    return getListeningPidsOnWindows(port);
  }

  return getListeningPidsOnUnix(port);
}

function killPid(pid) {
  if (process.platform === 'win32') {
    run('taskkill', ['/PID', pid, '/T', '/F']);
    return;
  }

  run('kill', ['-TERM', pid], { shell: false });
}

function stopPortListener(port) {
  const pids = getListeningPids(port);
  for (const pid of pids) {
    killPid(pid);
  }
}

function stopKnownProcesses() {
  // STOP_DEV_CALLER_PID — set by dev-unsafe.mjs to protect itself from being killed
  const excludePid = process.env.STOP_DEV_CALLER_PID || '';

  if (process.platform === 'win32') {
    const exclude = excludePid
      ? ` -and $_.ProcessId -ne ${excludePid}`
      : '';
    run('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -like '*dev-unsafe.mjs*' -or $_.CommandLine -like '*agent-option-writer.mjs*')${exclude} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ], { shell: false });
    return;
  }

  if (excludePid) {
    // pkill doesn't support PID exclusion — use pgrep + kill instead
    for (const pattern of ['dev-unsafe.mjs', 'agent-option-writer.mjs']) {
      const result = run('pgrep', ['-f', pattern], { shell: false });
      if (result.status !== 0 || !result.stdout) continue;
      const pids = parseNumericLines(result.stdout).filter((p) => p !== excludePid);
      for (const pid of pids) {
        run('kill', ['-TERM', pid], { shell: false });
      }
    }
    return;
  }

  run('pkill', ['-f', 'dev-unsafe.mjs'], { shell: false });
  run('pkill', ['-f', 'agent-option-writer.mjs'], { shell: false });
}

function closeUnsafeChrome() {
  const marker = 'ChromeDevSession-rvtr';

  if (process.platform === 'win32') {
    // Graceful close: send WM_CLOSE via CloseMainWindow(), wait, then force-kill stragglers.
    // This prevents the "Restore pages? Chrome didn't shut down correctly" dialog.
    run('powershell.exe', [
      '-NoProfile',
      '-Command',
      [
        `$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${marker}*' }`,
        'foreach ($p in $procs) { $h = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue; if ($h) { [void]$h.CloseMainWindow() } }',
        'if ($procs) { Start-Sleep -Seconds 3 }',
        'foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }',
      ].join('; '),
    ], { shell: false });
    return;
  }

  // macOS / Linux — SIGTERM first (graceful), wait, then SIGKILL stragglers
  run('pkill', ['-TERM', '-f', marker], { shell: false });

  spawnSync('sleep', ['2'], { stdio: 'ignore' });

  run('pkill', ['-KILL', '-f', marker], { shell: false });
}

function main() {
  closeUnsafeChrome();
  stopPortListener(DEV_PORT);
  stopPortListener(WRITER_PORT);
  stopKnownProcesses();

  console.log(
    `Stopped local dev processes on ports ${DEV_PORT} and ${WRITER_PORT} (if any were running).`,
  );
}

main();

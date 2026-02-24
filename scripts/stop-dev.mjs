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
  if (process.platform === 'win32') {
    run('wmic', [
      'process',
      'where',
      "CommandLine like '%dev-unsafe.mjs%' or CommandLine like '%agent-option-writer.mjs%'",
      'call',
      'terminate',
    ]);
    return;
  }

  run('pkill', ['-f', 'dev-unsafe.mjs'], { shell: false });
  run('pkill', ['-f', 'agent-option-writer.mjs'], { shell: false });
}

function closeDevTabsMacos() {
  if (process.platform !== 'darwin') return;

  const apps = [
    'Google Chrome',
    'Google Chrome for Testing',
    'Chromium',
    'Brave Browser',
    'Arc',
  ];

  const lines = [
    'if running then',
    'set wCount to count windows',
    'if wCount > 0 then',
    'repeat with w from wCount to 1 by -1',
    'try',
    'set tCount to count tabs of window w',
    'repeat with t from tCount to 1 by -1',
    'set u to ""',
    'try',
    'set u to URL of tab t of window w',
    'end try',
    'if u starts with "http://localhost:5173" then close tab t of window w',
    'if u starts with "https://localhost:5173" then close tab t of window w',
    'if u starts with "http://127.0.0.1:5173" then close tab t of window w',
    'if u starts with "https://127.0.0.1:5173" then close tab t of window w',
    'end repeat',
    'if (count of tabs of window w) = 0 then close window w',
    'end try',
    'end repeat',
    'end if',
    'end if',
  ];

  for (const appName of apps) {
    const probe = run('pgrep', ['-x', appName], { shell: false });
    if (probe.status !== 0) continue;

    const args = [`tell application "${appName}"`];
    for (const line of lines) {
      args.push(line);
    }
    args.push('end tell');

    const scriptArgs = args.flatMap((line) => ['-e', line]);
    const result = run('/usr/bin/osascript', scriptArgs, { shell: false });

    if (result.status !== 0) {
      const details = (result.stderr || result.stdout || '').trim();
      console.warn(
        `Note: couldn't auto-close browser tab for localhost:5173 (${details || 'unknown error'}).`,
      );
      console.warn(
        'Tip: macOS may require Automation permission for Terminal -> browser in System Settings > Privacy & Security > Automation.',
      );
      break;
    }
  }
}

function main() {
  closeDevTabsMacos();
  stopPortListener(DEV_PORT);
  stopPortListener(WRITER_PORT);
  stopKnownProcesses();

  console.log(
    `Stopped local dev processes on ports ${DEV_PORT} and ${WRITER_PORT} (if any were running).`,
  );
}

main();

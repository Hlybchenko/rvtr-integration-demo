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

function closeUnsafeChrome() {
  const marker = 'ChromeDevSession-rvtr';

  if (process.platform === 'win32') {
    run('wmic', [
      'process',
      'where',
      `CommandLine like '%${marker}%'`,
      'call',
      'terminate',
    ]);
    return;
  }

  // macOS / Linux — kill all Chrome processes launched with the dev user-data-dir
  run('pkill', ['-f', marker], { shell: false });
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

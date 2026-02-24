import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { existsSync } from 'node:fs';
import path from 'node:path';

const FIXED_PORT = 5173;
const WAIT_READY_ATTEMPTS = 80;
const WAIT_READY_DELAY_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });

    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });

    socket.once('error', () => {
      resolve(false);
    });
  });
}

async function isPortOpen(port) {
  const hosts = ['127.0.0.1', '::1', 'localhost'];

  for (const host of hosts) {
    if (await canConnect(host, port)) {
      return true;
    }
  }

  return false;
}

function getListeningPidsOnWindows(port) {
  const result = spawnSync('netstat', ['-ano', '-p', 'tcp'], {
    encoding: 'utf8',
    shell: true,
  });

  if (result.status !== 0 || !result.stdout) return [];

  const pids = new Set();
  const lines = result.stdout.split(/\r?\n/);

  for (const line of lines) {
    if (!line.includes(`:${port}`) || !line.includes('LISTENING')) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && /^\d+$/.test(pid)) pids.add(pid);
  }

  return [...pids];
}

function getListeningPidsOnUnix(port) {
  const result = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });

  if (result.status !== 0 || !result.stdout) return [];

  return result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => /^\d+$/.test(value));
}

function killPidCrossPlatform(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', pid, '/F'], {
      stdio: 'ignore',
      shell: true,
    });
    return;
  }

  spawnSync('kill', ['-TERM', pid], { stdio: 'ignore' });
}

function stopPortListener(port) {
  const pids =
    process.platform === 'win32'
      ? getListeningPidsOnWindows(port)
      : getListeningPidsOnUnix(port);

  for (const pid of pids) {
    killPidCrossPlatform(pid);
  }
}

function findChromeExecutable() {
  if (process.platform === 'darwin') {
    const macPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    return existsSync(macPath) ? macPath : null;
  }

  if (process.platform === 'win32') {
    const candidates = [
      process.env.PROGRAMFILES
        ? path.join(
            process.env.PROGRAMFILES,
            'Google',
            'Chrome',
            'Application',
            'chrome.exe',
          )
        : null,
      process.env['PROGRAMFILES(X86)']
        ? path.join(
            process.env['PROGRAMFILES(X86)'],
            'Google',
            'Chrome',
            'Application',
            'chrome.exe',
          )
        : null,
      process.env.LOCALAPPDATA
        ? path.join(
            process.env.LOCALAPPDATA,
            'Google',
            'Chrome',
            'Application',
            'chrome.exe',
          )
        : null,
    ].filter(Boolean);

    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  const linuxCandidates = [
    'google-chrome',
    'google-chrome-stable',
    'chromium-browser',
    'chromium',
  ];

  for (const candidate of linuxCandidates) {
    const result = spawnSync('which', [candidate], { stdio: 'pipe' });
    if (result.status === 0) return candidate;
  }

  return null;
}

function openChromeUnsafe(chromeExecutable, appUrl) {
  const userDataDir =
    process.platform === 'win32'
      ? path.join(process.env.USERPROFILE ?? '.', 'ChromeDevSession-rvtr')
      : path.join(process.env.HOME ?? '.', 'ChromeDevSession-rvtr');

  const chromeArgs = [
    `--user-data-dir=${userDataDir}`,
    '--disable-web-security',
    '--disable-features=BlockInsecurePrivateNetworkRequests',
    `--unsafely-treat-insecure-origin-as-secure=${appUrl}`,
    '--new-window',
    appUrl,
  ];

  const chromeProcess = spawn(chromeExecutable, chromeArgs, {
    detached: true,
    stdio: 'ignore',
    shell: false,
  });

  chromeProcess.unref();
}

async function main() {
  const port = FIXED_PORT;

  stopPortListener(port);
  await sleep(300);

  if (await isPortOpen(port)) {
    console.error(`Port ${port} is busy and could not be stopped automatically.`);
    process.exit(1);
  }

  const appUrl = `http://localhost:${port}`;
  const chromeExecutable = findChromeExecutable();

  if (!chromeExecutable) {
    console.error(
      'Could not find Google Chrome in standard OS locations. Install Chrome and retry.',
    );
    process.exit(1);
  }

  const writerProcess = spawn('node', ['./scripts/agent-option-writer.mjs'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  const viteProcess = spawn('yarn', ['vite', '--port', String(port), '--strictPort'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  const terminateVite = () => {
    if (!writerProcess.killed) writerProcess.kill('SIGTERM');
    if (!viteProcess.killed) viteProcess.kill('SIGTERM');
  };

  process.on('SIGINT', terminateVite);
  process.on('SIGTERM', terminateVite);
  process.on('exit', terminateVite);

  for (let attempt = 0; attempt < WAIT_READY_ATTEMPTS; attempt += 1) {
    if (await isPortOpen(port)) {
      openChromeUnsafe(chromeExecutable, appUrl);
      break;
    }

    if (viteProcess.exitCode !== null) {
      process.exit(viteProcess.exitCode ?? 1);
    }

    await sleep(WAIT_READY_DELAY_MS);
  }

  if (!(await isPortOpen(port))) {
    console.error(`Dev server did not start at ${appUrl} in time.`);
    terminateVite();
    process.exit(1);
  }

  await new Promise((resolve) => {
    viteProcess.on('close', resolve);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

import { spawn, spawnSync } from 'node:child_process';

const APP_PORT = 5173;

function runStopDev() {
  const result = spawnSync('yarn', ['stop:dev'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  runStopDev();

  const writerProcess = spawn('node', ['./scripts/agent-option-writer.mjs'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  const viteProcess = spawn(
    'yarn',
    ['vite', '--port', String(APP_PORT), '--strictPort'],
    {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );

  const cleanup = () => {
    if (!writerProcess.killed) writerProcess.kill('SIGTERM');
    if (!viteProcess.killed) viteProcess.kill('SIGTERM');
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);

  writerProcess.on('close', (code) => {
    if (code && code !== 0) {
      cleanup();
      process.exit(code);
    }
  });

  viteProcess.on('close', (code) => {
    cleanup();
    process.exit(code ?? 0);
  });
}

main();

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const studioRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const electronExecutable = require('electron');
const app = spawn(electronExecutable, ['.'], {
  cwd: studioRoot,
  env: { ...process.env, TRINDADE_STUDIO_DEV: '1' },
  stdio: 'inherit',
  windowsHide: false,
});

app.once('error', (error) => {
  process.stderr.write(`Não foi possível iniciar o Electron. ${error.message}\n`);
  process.exitCode = 1;
});
app.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
process.once('SIGINT', () => app.kill('SIGINT'));
process.once('SIGTERM', () => app.kill('SIGTERM'));

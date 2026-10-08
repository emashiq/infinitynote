#!/usr/bin/env node
// Starts `electron-vite dev` with a temporary profile and waits for the renderer to load from the dev server.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLI, ensureDisplay, killTree, repoRoot } from './lib/proc.mjs';
import { spawn } from 'node:child_process';

ensureDisplay([process.argv[1], ...process.argv.slice(2)]);

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-devsmoke-'));
const logFile = path.join(ud, 'logs', 'main.log');
const env = { ...process.env, INFINITY_NOTES_USER_DATA_DIR: ud };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(process.execPath, [CLI.electronVite(), 'dev'], {
  cwd: repoRoot,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
  detached: process.platform !== 'win32',
});
let output = '';
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (output += d));

const deadline = Date.now() + 120_000;
let seen = false;
while (Date.now() < deadline) {
  if (fs.existsSync(logFile) && fs.readFileSync(logFile, 'utf8').includes('renderer:loaded origin=http://localhost')) {
    seen = true;
    break;
  }
  if (child.exitCode !== null) break;
  await new Promise((r) => setTimeout(r, 500));
}
killTree(child.pid);
await new Promise((r) => setTimeout(r, 1000));

console.log('--- electron-vite output (tail) ---');
console.log(output.split('\n').slice(-15).join('\n'));
console.log('--- main.log (tail) ---');
if (fs.existsSync(logFile)) console.log(fs.readFileSync(logFile, 'utf8').split('\n').slice(-15).join('\n'));
fs.rmSync(ud, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
console.log(seen ? 'DEV SMOKE OK: renderer:loaded from dev server' : 'DEV SMOKE FAILED: renderer:loaded origin=http://localhost not seen');
process.exit(seen ? 0 : 1);

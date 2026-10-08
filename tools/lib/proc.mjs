// Shared helpers for the Infinity Notes tool scripts. Dependency-free; never uses a shell or npx.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Absolute path of a file inside node_modules (for example a package CLI). */
export function nodeCli(rel) {
  return path.join(repoRoot, 'node_modules', rel);
}

export const CLI = {
  electronVite: () => nodeCli('electron-vite/bin/electron-vite.js'),
  electronBuilder: () => nodeCli('electron-builder/cli.js'),
  playwright: () => nodeCli('@playwright/test/cli.js'),
};

/** Runs a command without a shell and captures output. */
export function run(cmd, args, { env, cwd, timeoutMs, inherit = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: cwd ?? repoRoot,
      env: env ?? process.env,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child.pid);
        }, timeoutMs)
      : null;
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + String(err) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: timedOut ? 124 : (code ?? 1), stdout, stderr, timedOut });
    });
  });
}

/** Runs a node script (CLI) with this node binary, inheriting stdio. Resolves to the exit code. */
export async function runNode(script, args, options = {}) {
  const { code } = await run(process.execPath, [script, ...args], { ...options, inherit: true });
  return code;
}

export function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function hasCommand(name) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { stdio: 'ignore' });
  return r.status === 0;
}

/**
 * On Linux without DISPLAY/WAYLAND_DISPLAY, re-executes the current script under xvfb-run -a when it
 * exists, otherwise exits 1. No-op elsewhere. Application logic only: Xvfb has no window manager.
 */
export function ensureDisplay(argv) {
  if (process.platform !== 'linux') return;
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return;
  if (process.env.INFINITY_XVFB_WRAPPED === '1' || !hasCommand('xvfb-run')) {
    console.error('No display available: run inside WSLg/a desktop session or install xvfb');
    process.exit(1);
  }
  const r = spawnSync('xvfb-run', ['-a', process.execPath, ...argv], {
    stdio: 'inherit',
    env: { ...process.env, INFINITY_XVFB_WRAPPED: '1' },
  });
  process.exit(r.status ?? 1);
}

export function packagedExePath() {
  // INFINITY_RELEASE_DIR lets tests point at an isolated (e.g. empty) release directory.
  const releaseDir = process.env.INFINITY_RELEASE_DIR || path.join(repoRoot, 'release');
  if (process.platform === 'win32') return path.join(releaseDir, 'win-unpacked', 'Infinity Notes.exe');
  return path.join(releaseDir, 'linux-unpacked', 'infinity-notes');
}

export async function buildApp() {
  return runNode(CLI.electronVite(), ['build']);
}

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const repoRoot = path.resolve(__dirname, '..', '..');
export const packagedExe = process.env.INFINITY_NOTES_PACKAGED_EXE ?? '';

export function electronBinary(): string {
  return createRequire(__filename)('electron') as unknown as string;
}

export function makeUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-e2e-'));
}

export async function removeDir(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

function splitArgs(raw: string | undefined): string[] {
  return raw ? raw.split(/\s+/).filter(Boolean) : [];
}

export interface Launched {
  app: ElectronApplication;
  page: Page;
}

export function appEnv(userDataDir: string, extraEnv: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  env.INFINITY_NOTES_USER_DATA_DIR = userDataDir;
  env.INFINITY_NOTES_E2E = '1';
  return { ...env, ...extraEnv };
}

export async function launchApp(options: { userDataDir: string; extraEnv?: Record<string, string>; extraArgs?: string[] }): Promise<Launched> {
  const packaged = packagedExe !== '';
  const app = await electron.launch({
    executablePath: packaged ? packagedExe : undefined,
    args: [...(packaged ? [] : [repoRoot]), ...splitArgs(process.env.INFINITY_NOTES_E2E_ELECTRON_ARGS), ...(options.extraArgs ?? [])],
    env: appEnv(options.userDataDir, options.extraEnv),
    // Without this Playwright adds --no-sandbox on Linux, and the suite would test an unsandboxed app.
    chromiumSandbox: true,
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  await page.waitForSelector('#app-shell[data-ready="true"], [role="alert"]', { timeout: 30_000 });
  return { app, page };
}

export async function closeApp(app: ElectronApplication | null | undefined): Promise<void> {
  if (!app) return;
  let proc: ChildProcess | null = null;
  try {
    proc = app.process();
    await app.close();
  } catch {
    // already closed
  }
  if (proc) await waitForExit(proc);
}

/** Resolves once the child has really exited (pipes closed) so a test never ends with a live Electron process. */
export async function waitForExit(proc: ChildProcess, timeoutMs = 10_000): Promise<boolean> {
  if (proc.exitCode !== null || proc.signalCode !== null) return true;
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve(false);
    }, timeoutMs);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

export interface RendererSandbox {
  /** Whether the OS confirms that the main window's renderer process runs in the Chromium sandbox. */
  osSandboxed: boolean;
  /** The raw OS evidence, for failure messages and logs. */
  evidence: string;
}

/**
 * Asks the OS whether the main window's renderer really runs in the Chromium sandbox. webPreferences.sandbox
 * and the --enable-sandbox renderer switch stay set under --no-sandbox, so neither can tell.
 * - Linux: --no-sandbox drops the namespace sandbox while seccomp-bpf stays (measured under WSLg), so the
 *   renderer must have its own user and PID namespaces and a seccomp filter ("Seccomp: 2").
 * - Windows: Electron's process metrics report whether the renderer process is sandboxed.
 */
export async function rendererSandbox(app: ElectronApplication): Promise<RendererSandbox> {
  const info = await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    const pid = BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId();
    const metric = electronApp.getAppMetrics().find((m) => m.pid === pid);
    return { pid, sandboxed: metric?.sandboxed ?? null, integrityLevel: metric?.integrityLevel ?? null };
  });
  if (process.platform === 'linux') {
    const mainPid = app.process().pid;
    const ns = (pid: number | undefined, kind: string) => fs.readlinkSync(`/proc/${pid}/ns/${kind}`);
    const ownUserNs = ns(info.pid, 'user') !== ns(mainPid, 'user');
    const ownPidNs = ns(info.pid, 'pid') !== ns(mainPid, 'pid');
    const seccomp = /^Seccomp:\s*(\d+)/m.exec(fs.readFileSync(`/proc/${info.pid}/status`, 'utf8'))?.[1] ?? 'missing';
    return {
      osSandboxed: ownUserNs && ownPidNs && seccomp === '2',
      evidence: `pid=${info.pid} ownUserNamespace=${ownUserNs} ownPidNamespace=${ownPidNs} Seccomp=${seccomp}`,
    };
  }
  return {
    osSandboxed: info.sandboxed === true,
    evidence: `pid=${info.pid} sandboxed=${String(info.sandboxed)} integrity=${String(info.integrityLevel)}`,
  };
}

export function dbFileOf(userDataDir: string): string {
  return path.join(userDataDir, 'data', 'infinity-notes.sqlite3');
}

export function openDb(file: string, options: { readonly?: boolean } = {}): Database.Database {
  return new Database(file, { readonly: options.readonly ?? false, fileMustExist: true });
}

export function readMainLog(userDataDir: string): string {
  const file = path.join(userDataDir, 'logs', 'main.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** Spawns a bare Electron process (not controlled by Playwright) and resolves with its exit code. */
export function spawnAndWait(
  exe: string,
  args: string[],
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

export const appArgs = (): string[] => (packagedExe !== '' ? [] : [repoRoot]);
export const appExecutable = (): string => (packagedExe !== '' ? packagedExe : electronBinary());

/** Sets the window's content size and waits until the renderer sees the new inner size. */
export async function setContentSize(app: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    win.setContentSize(w!, h!);
  }, [width, height]);
  await page.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [width, height], { timeout: 10_000 });
}

/** Sets the whole window size (frame included) for the visual specs. */
export async function setWindowSize(app: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    win.setSize(w!, h!);
  }, [width, height]);
  await page.waitForFunction(() => window.innerWidth > 0);
}

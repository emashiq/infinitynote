#!/usr/bin/env node
// Usage: node tools/verify-windows-install.mjs [--installer <path>]
// Installed-build check for the unsigned NSIS installer (INF-PKG-01, INF-PKG-03, INF-PKG-04): silent per-user install
// into a temporary folder, launch and create data, relaunch, install over it (update), uninstall. The app's data goes to
// a temporary folder through INFINITY_NOTES_USER_DATA_DIR, never to the user's profile. Prints a JSON report and exits
// non-zero when a check fails. The host is left clean: the app is uninstalled and the temporary folders are removed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLI, repoRoot, run, sha256File } from './lib/proc.mjs';

if (process.platform !== 'win32') {
  console.error('verify-windows-install runs on Windows only');
  process.exit(2);
}

const argv = process.argv.slice(2);
const installerArg = argv.indexOf('--installer');
const installer = path.resolve(installerArg >= 0 ? argv[installerArg + 1] : defaultInstaller());
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-install-'));
const installDir = path.join(root, 'Infinity Notes');
const userData = path.join(root, 'userdata');
const exe = path.join(installDir, 'Infinity Notes.exe');
const uninstaller = path.join(installDir, 'Uninstall Infinity Notes.exe');
const defaultProfile = path.join(process.env.APPDATA ?? '', 'Infinity Notes');
// The packaged app's pinned toast activator CLSID (single source: src/shared/app-identity.ts, N-D3).
const activatorClsid = /TOAST_ACTIVATOR_CLSID = '(\{[0-9A-F-]+\})'/.exec(fs.readFileSync(path.join(repoRoot, 'src', 'shared', 'app-identity.ts'), 'utf8'))[1];
const activatorKey = `HKCU\\Software\\Classes\\CLSID\\${activatorClsid}`;
const report = {
  date: new Date().toISOString(),
  host: `${os.version()} ${os.release()} ${os.arch()}`,
  installer: { file: installer, bytes: fs.statSync(installer).size, sha256: sha256File(installer) },
  installDir,
  userData,
  steps: [],
};
let failed = false;

function defaultInstaller() {
  const artifacts = JSON.parse(fs.readFileSync(path.join(repoRoot, 'release', 'artifacts.json'), 'utf8'));
  const exeArtifact = artifacts.find((a) => a.file.endsWith('.exe'));
  if (!exeArtifact) throw new Error('release/artifacts.json lists no installer; run npm run package:current first');
  return path.join(repoRoot, 'release', exeArtifact.file);
}

function check(step, ok, detail) {
  report.steps.push({ step, ok, ...detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step} ${JSON.stringify(detail)}`);
  if (!ok) failed = true;
  return ok;
}

async function capture(cmd, args) {
  const r = await run(cmd, args);
  return { code: r.code, out: `${r.stdout}${r.stderr}`.trim() };
}

async function powershell(command) {
  return (await capture('powershell', ['-NoProfile', '-NonInteractive', '-Command', command])).out;
}

/** The per-user uninstall entry the installer wrote, if any. */
async function uninstallEntry() {
  const r = await capture('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s', '/f', 'Infinity Notes', '/d']);
  return r.code === 0 && /Infinity Notes/.test(r.out) ? r.out.split(/\r?\n/).find((l) => l.startsWith('HKEY_')) ?? 'found' : null;
}

/** The executable registered as the app's toast activator COM server, or null when the key is absent. */
async function activatorServer() {
  const r = await capture('reg', ['query', `${activatorKey}\\LocalServer32`, '/ve']);
  if (r.code !== 0) return null;
  return /REG_SZ\s+(.+)$/m.exec(r.out)?.[1]?.trim() ?? '';
}

async function loginItems() {
  const r = await capture('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run']);
  return r.out.split(/\r?\n/).filter((l) => /infinity/i.test(l)).map((l) => l.trim());
}

async function runningApps() {
  const r = await capture('tasklist', ['/FI', 'IMAGENAME eq Infinity Notes.exe', '/FO', 'CSV', '/NH']);
  return r.out.split(/\r?\n/).filter((l) => l.startsWith('"Infinity Notes.exe"')).length;
}

async function shortcuts() {
  const folders = JSON.parse(await powershell("@{ desktop = [Environment]::GetFolderPath('Desktop'); programs = [Environment]::GetFolderPath('Programs') } | ConvertTo-Json"));
  return [path.join(folders.desktop, 'Infinity Notes.lnk'), path.join(folders.programs, 'Infinity Notes.lnk')].filter((f) => fs.existsSync(f));
}

async function waitFor(predicate, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return predicate();
}

async function install(step) {
  const started = Date.now();
  const r = await capture(installer, ['/S', '/currentuser', `/D=${installDir}`]);
  const present = await waitFor(() => fs.existsSync(exe), 30_000);
  return check(step, r.code === 0 && present, { exitCode: r.code, seconds: Math.round((Date.now() - started) / 1000), exe: present, exeBytes: present ? fs.statSync(exe).size : 0 });
}

async function appStep(step, installStep) {
  const env = { ...process.env, INFINITY_NOTES_PACKAGED_EXE: exe, INFINITY_INSTALL_STEP: installStep, INFINITY_INSTALL_USERDATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const nodeBin = process.env.INFINITY_E2E_NODE || process.execPath;
  const r = await run(nodeBin, [CLI.playwright(), 'test', '--config', path.join('tests', 'install', 'playwright.config.ts')], { env, inherit: true });
  return check(step, r.code === 0, { playwrightExit: r.code });
}

// A registration left by an earlier install or development run is put back afterwards, unchanged.
const previousActivator = await activatorServer();
const activatorBackup = path.join(root, 'previous-activator.reg');
if (previousActivator !== null) await capture('reg', ['export', activatorKey, activatorBackup, '/y']);

try {
  check('baseline', (await uninstallEntry()) === null && (await runningApps()) === 0 && !fs.existsSync(defaultProfile), {
    uninstallEntry: await uninstallEntry(),
    running: await runningApps(),
    defaultProfileExists: fs.existsSync(defaultProfile),
    loginItems: await loginItems(),
    previousToastActivator: previousActivator,
  });
  if (await install('install')) {
    const links = await shortcuts();
    check('install-registration', (await uninstallEntry()) !== null && links.length === 2, { uninstallEntry: await uninstallEntry(), shortcuts: links });
    const autoStarted = await runningApps();
    check('install-does-not-launch', autoStarted === 0, { running: autoStarted });
    if ((await appStep('launch-create-data', 'create')) && (await appStep('relaunch-data-persists', 'verify'))) {
      const server = await activatorServer();
      check('toast-activator-registered', server !== null && server.toLowerCase().includes(exe.toLowerCase()), { clsid: activatorClsid, localServer32: server });
      // A file the installer does not own: an update that first removes the previous installation removes it too.
      const marker = path.join(installDir, 'previous-install-marker.txt');
      fs.writeFileSync(marker, 'left by verify-windows-install before the update');
      if (await install('update-install-over')) {
        check('update-replaced-installation', !fs.existsSync(marker), { previousInstallationRemoved: !fs.existsSync(marker) });
        await appStep('after-update-data-preserved', 'verify');
      }
    }
  }
} finally {
  if (fs.existsSync(uninstaller)) {
    const r = await capture(uninstaller, ['/S']);
    // The NSIS uninstaller re-launches a copy of itself from %TEMP% and returns at once; wait for the real work.
    const gone = await waitFor(async () => !fs.existsSync(exe) && (await uninstallEntry()) === null, 60_000);
    const left = fs.existsSync(installDir) ? fs.readdirSync(installDir) : [];
    check('uninstall', r.code === 0 && gone, {
      exitCode: r.code,
      exeRemoved: !fs.existsSync(exe),
      installDirLeft: left,
      uninstallEntry: await uninstallEntry(),
      shortcutsLeft: await shortcuts(),
    });
    const kept = fs.existsSync(path.join(userData, 'data', 'infinity-notes.sqlite3'));
    check('uninstall-keeps-user-data', kept, { userDataDb: kept, defaultProfileCreated: fs.existsSync(defaultProfile) });
    const server = await activatorServer();
    check('uninstall-removes-toast-activator', server === null, { clsid: activatorClsid, localServer32: server });
  }
  if (previousActivator !== null) {
    await capture('reg', ['import', activatorBackup]);
    const restored = await activatorServer();
    check('previous-toast-activator-restored', restored === previousActivator, { localServer32: restored });
  }
  const running = await runningApps();
  const logins = await loginItems();
  check('host-clean', running === 0 && logins.length === 0 && (await uninstallEntry()) === null, { running, loginItems: logins });
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  report.temporaryFolderRemoved = !fs.existsSync(root);
  console.log(`INSTALL-REPORT ${JSON.stringify(report)}`);
  process.exitCode = failed ? 1 : 0;
}

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  APP_ID,
  DEV_APP_ID,
  DEV_TOAST_ACTIVATOR_CLSID,
  TOAST_ACTIVATOR_CLSID,
  windowsNotificationIdentity,
  ATTACHMENT_SCHEME,
  LINUX_EXECUTABLE,
  NPM_NAME,
  PRODUCT_NAME,
  RENDERER_HOST,
  RENDERER_SCHEME,
} from '../../src/shared/app-identity';
import { AUTOSTART_FILE } from '../../src/main/services/autostart';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
  name: string;
  version: string;
  productName: string;
  desktopName: string;
  engines: { node: string };
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  main: string;
  type?: string;
};
const builder = JSON.parse(fs.readFileSync('electron-builder.json', 'utf8')) as {
  appId: string;
  productName: string;
  npmRebuild: boolean;
  nodeGypRebuild: boolean;
  buildDependenciesFromSource: boolean;
  asarUnpack: string[];
  publish: unknown;
  nsis: { include: string; deleteAppDataOnUninstall: boolean };
  electronFuses: Record<string, boolean>;
  linux: { executableName: string; syncDesktopName: boolean; maintainer: string };
};

describe('app identity (INF-FND-11)', () => {
  it('constants match D-013', () => {
    expect(APP_ID).toBe('com.infinitynotes.desktop');
    expect(PRODUCT_NAME).toBe('Infinity Notes');
    expect(NPM_NAME).toBe('infinity-notes');
    expect(LINUX_EXECUTABLE).toBe('infinity-notes');
    expect(RENDERER_SCHEME).toBe('infinity-app');
    expect(RENDERER_HOST).toBe('renderer');
    expect(ATTACHMENT_SCHEME).toBe('infinity-attachment');
  });

  it('package.json identity and engines', () => {
    expect(pkg.name).toBe(NPM_NAME);
    expect(pkg.productName).toBe(PRODUCT_NAME);
    expect(pkg.version).toBe('0.1.0');
    expect(pkg.engines.node).toBe('>=24.15.0 <25');
    expect(pkg.main).toBe('out/main/index.js');
    expect(pkg.type).toBeUndefined();
  });

  it('electron-builder identity and native-module policy', () => {
    expect(builder.appId).toBe(APP_ID);
    expect(builder.productName).toBe(PRODUCT_NAME);
    expect(builder.linux.executableName).toBe(LINUX_EXECUTABLE);
    expect(builder.npmRebuild).toBe(false);
    expect(builder.nodeGypRebuild).toBe(false);
    expect(builder.buildDependenciesFromSource).toBe(false);
    expect(builder.asarUnpack).toContain('**/*.node');
    expect(builder.publish).toBeNull();
    expect(builder.linux.maintainer).toContain('@');
  });

  it('Linux window association: desktopName gives the .desktop file, WM_CLASS and app_id one name (F-01-6, F04-A3)', () => {
    expect(pkg.desktopName).toBe(`${LINUX_EXECUTABLE}.desktop`);
    expect(builder.linux.syncDesktopName).toBe(true);
    // The launch-at-login entry uses the same name as the installed one.
    expect(AUTOSTART_FILE).toBe(pkg.desktopName);
  });

  it('Electron fuses harden the packaged binary; only the inspector stays on, for Playwright (F-01-6, INF-SEC-02)', () => {
    expect(builder.electronFuses).toEqual({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      // Playwright drives the packaged app through --inspect=0 (test:e2e:packaged); see docs/RELEASE_CHECKLIST.md.
      enableNodeCliInspectArguments: true,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      grantFileProtocolExtraPrivileges: false,
    });
  });

  it('the production notification identity is used only by packaged builds; unpackaged runs get their own (N-D1)', () => {
    expect(windowsNotificationIdentity(true)).toEqual({ appUserModelId: APP_ID, toastActivatorClsid: TOAST_ACTIVATOR_CLSID });
    expect(windowsNotificationIdentity(false)).toEqual({ appUserModelId: DEV_APP_ID, toastActivatorClsid: DEV_TOAST_ACTIVATOR_CLSID });
    expect(DEV_APP_ID).toBe('com.infinitynotes.desktop.dev');
    expect(DEV_APP_ID).not.toBe(builder.appId);
    expect(DEV_TOAST_ACTIVATOR_CLSID).not.toBe(TOAST_ACTIVATOR_CLSID);
    for (const clsid of [TOAST_ACTIVATOR_CLSID, DEV_TOAST_ACTIVATOR_CLSID]) expect(clsid).toMatch(/^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/);
  });

  it('main sets the AppUserModelID and the pinned toast activator CLSID on win32 from isPackaged', () => {
    const main = fs.readFileSync('src/main/index.ts', 'utf8');
    expect(main).toContain('const identity = windowsNotificationIdentity(app.isPackaged);');
    expect(main).toContain('app.setAppUserModelId(identity.appUserModelId);');
    expect(main).toContain('app.setToastActivatorCLSID(identity.toastActivatorClsid);');
  });

  it("the uninstaller removes exactly the packaged app's toast activator key, and keeps it on an update (N-D3)", () => {
    expect(builder.nsis.include).toBe('resources/installer.nsh');
    expect(builder.nsis.deleteAppDataOnUninstall).toBe(false);
    const nsh = fs.readFileSync(builder.nsis.include, 'utf8');
    const deletes = [...nsh.matchAll(/^\s*DeleteRegKey\s+(\S+)\s+"([^"]+)"/gm)].map((m) => [m[1], m[2]]);
    expect(deletes).toEqual([['HKCU', `Software\\Classes\\CLSID\\${TOAST_ACTIVATOR_CLSID}`]]);
    expect(nsh).toMatch(/\$\{ifNot\} \$\{isUpdated\}[\s\S]*DeleteRegKey[\s\S]*\$\{endIf\}/);
  });

  it('the placeholder icons are a 512x512 PNG and an ICO with a 256 entry', () => {
    const png = fs.readFileSync('resources/icon.png');
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(16)).toBe(512);
    expect(png.readUInt32BE(20)).toBe(512);
    const ico = fs.readFileSync('resources/icon.ico');
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16]! || 256);
    expect(sizes).toContain(256);
    expect(sizes).toEqual([256, 48, 32, 16]);
  });

  it('forbidden dependencies are absent and runtime dependencies are only what main loads', () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of [
      '@electron/rebuild', 'electron-rebuild', 'node-gyp', '@electron/remote', 'electron-log', 'prettier',
      'sequelize', 'typeorm', 'prisma', 'knex', 'drizzle-orm', 'openai', '@anthropic-ai/sdk', 'axios', 'node-fetch',
      'mixpanel', '@sentry/electron', 'electron-updater',
    ]) {
      expect(Object.keys(all), name).not.toContain(name);
    }
    // yazl and yauzl write and read backup and export archives in main (Phase 08, pinned in DECISIONS).
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['better-sqlite3', 'luxon', 'yauzl', 'yazl', 'zod']);
  });

  it('dependency versions are exact pins', () => {
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(pkg.devDependencies.electron).toBe('44.7.0');
    expect(pkg.dependencies['better-sqlite3']).toBe('13.0.3');
  });

  it('.npmrc disables install scripts and enforces engines', () => {
    const rc = fs.readFileSync('.npmrc', 'utf8');
    expect(rc).toContain('ignore-scripts=true');
    expect(rc).toContain('engine-strict=true');
    expect(rc).not.toContain('legacy-peer-deps');
    expect(fs.existsSync('package-lock.json')).toBe(true);
    expect(fs.existsSync('node_modules/better-sqlite3/build')).toBe(false);
  });
});

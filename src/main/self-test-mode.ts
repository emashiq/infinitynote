import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSqliteSelfTest } from './db/self-test';
import { errorMessage } from './services/app-error';

const REPORT_PREFIX = '--self-test-report=';

export function isSelfTestMode(argv: readonly string[]): boolean {
  return argv.includes('--self-test');
}

function resolveLoadedBinary(): string {
  const pkgDir = path.dirname(require.resolve('better-sqlite3/package.json'));
  const binary = path.join(pkgDir, 'prebuilds', `${process.platform}-${process.arch}.node`);
  return binary.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

/**
 * --self-test: runs the SQLite self-test inside Electron main against a throwaway profile and
 * exits. No single-instance lock, no window and no user database.
 */
export function runSelfTestMode(argv: readonly string[]): void {
  const reportArg = argv.find((a) => a.startsWith(REPORT_PREFIX));
  const reportPath = reportArg ? reportArg.slice(REPORT_PREFIX.length) : '';
  if (!reportPath || !path.isAbsolute(reportPath)) {
    process.stderr.write('--self-test requires --self-test-report=<absolute path>\n');
    app.exit(3);
    return;
  }
  if (!process.env.INFINITY_NOTES_USER_DATA_DIR) {
    app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-selftest-ud-')));
  }
  void app.whenReady().then(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-selftest-'));
    let ok = false;
    try {
      const report = await runSqliteSelfTest(tmp, {
        runtime: {
          electron: process.versions.electron,
          node: process.versions.node,
          modules: process.versions.modules,
          napi: process.versions.napi ?? '',
          platform: process.platform,
          arch: process.arch,
          isPackaged: app.isPackaged,
        },
        resolveBinary: resolveLoadedBinary,
      });
      ok = report.ok;
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      process.stdout.write(`INFINITY_SELF_TEST ${JSON.stringify(report)}\n`);
    } catch (err) {
      process.stderr.write(`self-test crashed: ${errorMessage(err)}\n`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
    app.exit(ok ? 0 : 1);
  });
}

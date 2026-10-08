import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { appArgs, appEnv, appExecutable, makeUserDataDir, removeDir, spawnAndWait } from './fixtures';

test('self-test passes in Electron main', async () => {
  const tmp = makeUserDataDir();
  try {
    const report = path.join(tmp, 'r.json');
    const result = await spawnAndWait(
      appExecutable(),
      [...appArgs(), '--self-test', `--self-test-report=${report}`],
      appEnv(path.join(tmp, 'ud')),
      90_000,
    );
    expect(result.timedOut).toBe(false);
    expect(result.code, result.stderr).toBe(0);
    const parsed = JSON.parse(fs.readFileSync(report, 'utf8')) as {
      ok: boolean;
      driver: string;
      sqliteVersion: string;
      errors: string[];
      checks: Record<string, boolean>;
      runtime: { electron?: string; modules: string; platform: string };
      loadedBinary?: string;
    };
    expect(parsed.errors).toEqual([]);
    expect(parsed.ok).toBe(true);
    expect(parsed.driver).toBe('better-sqlite3');
    expect(parsed.sqliteVersion).toBe('3.53.4');
    expect(parsed.runtime.electron).toBe('44.7.0');
    expect(parsed.runtime.modules).toBe('149');
    for (const [name, value] of Object.entries(parsed.checks)) expect(value, name).toBe(true);
    expect(parsed.loadedBinary).toContain(path.join('better-sqlite3', 'prebuilds'));
    expect(result.stdout).toContain('INFINITY_SELF_TEST ');
  } finally {
    await removeDir(tmp);
  }
});

test('self-test requires an absolute report path', async () => {
  const tmp = makeUserDataDir();
  try {
    const result = await spawnAndWait(appExecutable(), [...appArgs(), '--self-test'], appEnv(path.join(tmp, 'ud')), 60_000);
    expect(result.code).toBe(3);
    expect(result.stderr).toContain('--self-test-report');
  } finally {
    await removeDir(tmp);
  }
});

import { describe, expect, it } from 'vitest';
import { runSqliteSelfTest } from '../../src/main/db/self-test';
import { mkTmp } from './helpers';

describe('sqlite capabilities (INF-FND-12)', () => {
  it('self-test passes in Node with every check true', async () => {
    const report = await runSqliteSelfTest(mkTmp(), {
      runtime: {
        node: process.versions.node,
        modules: process.versions.modules,
        napi: process.versions.napi ?? '',
        platform: process.platform,
        arch: process.arch,
      },
    });
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.driver).toBe('better-sqlite3');
    const [major, minor] = report.sqliteVersion.split('.').map(Number);
    expect(major! > 3 || (major === 3 && minor! >= 45)).toBe(true);
    for (const [name, value] of Object.entries(report.checks)) {
      expect(value, name).toBe(true);
    }
    expect(Object.keys(report.checks)).toEqual(
      expect.arrayContaining([
        'walMode',
        'compileOptionFts5',
        'json',
        'ftsCategoriesTokenizer',
        'ftsBanglaMatch',
        'ftsPrefixMatch',
        'blobRoundTrip',
        'backupApi',
        'migrationsToLatest',
        'docKeyStableAfterVacuum',
        'ftsIntegrity',
      ]),
    );
  });
});

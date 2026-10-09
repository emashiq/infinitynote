import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LATEST, MIGRATIONS } from '../../src/main/db/migrations';

const dir = path.resolve('src/main/db/migrations');

describe('migration set (INF-FND-05)', () => {
  it('versions are contiguous from 1 and LATEST is 6', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    expect(LATEST).toBe(6);
  });

  it('accepted migrations 1 to 5 are frozen: their checksums never change (A05-F3)', () => {
    const checksums = JSON.parse(fs.readFileSync(path.join(dir, 'checksums.json'), 'utf8')) as Record<string, string>;
    expect({ 1: checksums['1'], 2: checksums['2'], 3: checksums['3'], 4: checksums['4'], 5: checksums['5'] }).toEqual({
      1: '303c9fc2aba30a8b19b50b5a463f925ab289a305cca2dea36551b88a27b98cbd',
      2: '224e179b23706f97799892d77bb85d9f1ac57db5669dcb089251735a3e88aaab',
      3: 'af4dace8238ca9854914a6010fa51a2c186b43434d448422d42f521e45ea74a3',
      4: '4d1f211ae1d55d4c0f0d59fca4226271502e5b1484d7977b7212dd2fb319dac9',
      5: '8f394b6b052d9296feb69575f5204cfd4bb38486497caa94401bb3f2e55c3947',
    });
  });

  it('checksums.json matches the LF-normalized migration files', () => {
    const checksums = JSON.parse(fs.readFileSync(path.join(dir, 'checksums.json'), 'utf8')) as Record<string, string>;
    expect(Object.keys(checksums)).toEqual(MIGRATIONS.map((m) => String(m.version)));
    for (const m of MIGRATIONS) {
      const file = fs.readdirSync(dir).find((f) => f.startsWith(String(m.version).padStart(3, '0')) && f.endsWith('.sql'));
      expect(file, `file for migration ${m.version}`).toBeTruthy();
      const text = fs.readFileSync(path.join(dir, file!), 'utf8').replace(/\r\n/g, '\n');
      expect(createHash('sha256').update(text).digest('hex')).toBe(checksums[String(m.version)]);
      expect(m.sql.replace(/\r\n/g, '\n')).toBe(text);
    }
  });

  it('the migration file does not set user_version (the runner does)', () => {
    for (const m of MIGRATIONS) expect(m.sql.toLowerCase()).not.toContain('user_version');
  });
});

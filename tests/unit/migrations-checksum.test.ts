import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LATEST, MIGRATIONS } from '../../src/main/db/migrations';

const dir = path.resolve('src/main/db/migrations');

describe('migration set (INF-FND-05)', () => {
  it('versions are contiguous from 1 and LATEST is 5', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    expect(LATEST).toBe(5);
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

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

const REQUIRED = [
  'dev', 'build', 'lint', 'typecheck', 'test:unit', 'test:integration', 'test:e2e', 'check',
  'package:current', 'package:win', 'package:linux',
  'check:traceability', 'verify:native', 'setup:electron', 'test:e2e:packaged',
];

describe('npm scripts (INF-FND-09)', () => {
  it('all standard scripts exist', () => {
    for (const name of REQUIRED) expect(pkg.scripts[name], name).toBeTruthy();
  });

  it('none is a placeholder that always succeeds', () => {
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      expect(cmd, name).not.toMatch(/^\s*(echo|exit\s+0|true)\b/);
      expect(cmd, name).not.toMatch(/\|\|\s*(true|exit\s+0)/);
      expect(cmd, name).not.toMatch(/--passWithNoTests/);
    }
  });

  it('referenced tools/*.mjs files exist', () => {
    const files = new Set<string>();
    for (const cmd of Object.values(pkg.scripts)) for (const m of cmd.matchAll(/tools\/[\w./-]+\.mjs/g)) files.add(m[0]);
    expect(files.size).toBeGreaterThan(0);
    for (const f of files) expect(fs.existsSync(f), f).toBe(true);
  });

  it('check runs lint, typecheck, both test projects and traceability', () => {
    const check = pkg.scripts.check!;
    for (const part of ['lint', 'typecheck', 'test:unit', 'test:integration', 'check:traceability']) {
      expect(check).toContain(`npm run ${part}`);
    }
  });

  it('vitest does not pass with no tests', () => {
    expect(fs.readFileSync('vitest.config.ts', 'utf8')).not.toContain('passWithNoTests');
  });

  it('package.mjs refuses the wrong host and unknown targets with exit 2', () => {
    const wrong = process.platform === 'win32' ? 'linux' : 'win';
    const r = spawnSync(process.execPath, ['tools/package.mjs', wrong], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(wrong === 'linux' ? 'must run on Linux' : 'must run on Windows');
    const bogus = spawnSync(process.execPath, ['tools/package.mjs', 'bogus'], { encoding: 'utf8' });
    expect(bogus.status).toBe(2);
    expect(bogus.stderr).toContain('Unknown');
    const none = spawnSync(process.execPath, ['tools/package.mjs'], { encoding: 'utf8' });
    expect(none.status).toBe(2);
  });

  it('test:e2e:packaged without a build exits 1 with a clear message', () => {
    // Isolated: point the script at an empty temp release dir so the result never depends on a real release/ build.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inf-release-'));
    const r = spawnSync(process.execPath, ['tools/run-e2e.mjs', '--packaged'], {
      encoding: 'utf8',
      env: { ...process.env, INFINITY_RELEASE_DIR: tmp },
    });
    fs.rmSync(tmp, { recursive: true, force: true });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('No packaged build at');
    expect(r.stderr).toContain(tmp);
  });
});

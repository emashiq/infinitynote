import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const checker = path.resolve('tools/check-traceability.mjs');
const temps: string[] = [];

function makeRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-trace-'));
  temps.push(repo);
  fs.mkdirSync(path.join(repo, 'docs', 'plans'), { recursive: true });
  for (const f of fs.readdirSync('docs')) {
    if (f.endsWith('.md')) fs.copyFileSync(path.join('docs', f), path.join(repo, 'docs', f));
  }
  fs.copyFileSync('docs/plans/phase-00.md', path.join(repo, 'docs', 'plans', 'phase-00.md'));
  return repo;
}

function run(repo: string, extra: string[] = []) {
  const r = spawnSync(process.execPath, [checker, '--repo', repo, ...extra], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('check-traceability product-spec comparison (F-5)', () => {
  it('the unmodified docs pass', () => {
    const r = run(makeRepo());
    expect(r.out).toContain('fails=0');
    expect(r.code).toBe(0);
  });

  it('a PRODUCT_SPEC phase change fails with product-spec-phase', () => {
    const repo = makeRepo();
    const file = path.join(repo, 'docs', 'PRODUCT_SPEC.md');
    const text = fs.readFileSync(file, 'utf8');
    const changed = text.replace(/(\| INF-FND-01 \|.*\| )01( \|)\s*$/m, (_m, a: string, b: string) => `${a}02${b}`);
    expect(changed).not.toBe(text);
    fs.writeFileSync(file, changed);
    const r = run(repo);
    expect(r.code).toBe(1);
    expect(r.out).toContain('FAIL product-spec-phase: INF-FND-01 spec 02 backlog 01');
  });

  it('--allow-phase-moves downgrades the phase difference to a warning', () => {
    const repo = makeRepo();
    const file = path.join(repo, 'docs', 'PRODUCT_SPEC.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/(\| INF-FND-01 \|.*\| )01( \|)\s*$/m, (_m, a: string, b: string) => `${a}02${b}`));
    const r = run(repo, ['--allow-phase-moves']);
    expect(r.out).toContain('WARN product-spec-phase: INF-FND-01 spec 02 backlog 01');
    expect(r.out).not.toContain('FAIL product-spec-phase');
  });

  it('a BACKLOG requirement text change fails with product-spec-text', () => {
    const repo = makeRepo();
    const file = path.join(repo, 'docs', 'BACKLOG.md');
    const text = fs.readFileSync(file, 'utf8');
    const changed = text.replace('| INF-FND-01 | One offline Electron app;', '| INF-FND-01 | One mostly offline Electron app;');
    expect(changed).not.toBe(text);
    fs.writeFileSync(file, changed);
    const r = run(repo);
    expect(r.code).toBe(1);
    expect(r.out).toContain('FAIL product-spec-text: INF-FND-01');
  });

  it('a PRODUCT_SPEC row missing from BACKLOG fails', () => {
    const repo = makeRepo();
    const file = path.join(repo, 'docs', 'PRODUCT_SPEC.md');
    const text = fs.readFileSync(file, 'utf8');
    const row = text.split(/\r?\n/).find((l) => l.startsWith('| INF-FND-13 |'))!;
    const extra = row.replace('INF-FND-13', 'INF-FND-99');
    fs.writeFileSync(file, text.replace(row, `${row}\n${extra}`));
    const r = run(repo);
    expect(r.code).toBe(1);
    expect(r.out).toContain('INF-FND-99');
  });
});

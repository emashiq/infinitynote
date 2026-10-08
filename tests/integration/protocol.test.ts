import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { memoryLogger } from '../../src/main/services/logger';
import { createAttachmentHandler } from '../../src/main/windows/attachment-protocol';
import { createRendererHandler } from '../../src/main/windows/renderer-protocol';
import { PROD_CSP } from '../../src/shared/csp';
import { makePng } from '../support/png';
import { mkTmp, openFresh } from './helpers';

const PNG = makePng(2, 2);

async function setupAttachments() {
  const t = await openFresh();
  const dataDir = path.join(t.dir, 'data');
  fs.mkdirSync(path.join(dataDir, 'attachments', 'ab'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'attachments', 'ab', 'pic.png'), PNG);
  fs.writeFileSync(path.join(dataDir, 'attachments', 'ab', 'doc.pdf'), '%PDF-1.4');
  fs.writeFileSync(path.join(dataDir, 'secret.txt'), 'top secret');
  const add = (id: string, rel: string, mime: string, kind: string, sha: string) =>
    t.db
      .prepare<[string, string, string, string, string]>(
        "INSERT INTO attachments(id, managed_relative_path, sha256, mime, size_bytes, kind, created_at) VALUES (?, ?, ?, ?, 1, ?, 1)",
      )
      .run(id, rel, sha.padEnd(64, '0'), mime, kind);
  const pngId = randomUUID();
  const pdfId = randomUUID();
  const missingId = randomUUID();
  add(pngId, 'attachments/ab/pic.png', 'image/png', 'image', 'a');
  add(pdfId, 'attachments/ab/doc.pdf', 'application/pdf', 'document', 'b');
  add(missingId, 'attachments/ab/gone.png', 'image/png', 'image', 'c');
  const logger = memoryLogger();
  const handler = createAttachmentHandler({ db: t.db, dataDir, logger });
  const get = (url: string, method = 'GET') => handler(new Request(url, { method }));
  return { t, dataDir, pngId, pdfId, missingId, handler, get, logger };
}

describe('attachment protocol (INF-FND-08)', () => {
  it('serves a registered image with hardened headers', async () => {
    const s = await setupAttachments();
    const res = await s.get(`infinity-attachment://${s.pngId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it('unknown id, non-UUID host, non-root path, document kind and missing file give 404', async () => {
    const s = await setupAttachments();
    expect((await s.get(`infinity-attachment://${randomUUID()}`)).status).toBe(404);
    expect((await s.get('infinity-attachment://not-a-uuid')).status).toBe(404);
    expect((await s.get(`infinity-attachment://${s.pngId}/extra`)).status).toBe(404);
    expect((await s.get(`infinity-attachment://${s.pdfId}`)).status).toBe(404);
    expect((await s.get(`infinity-attachment://${s.missingId}`)).status).toBe(404);
    expect((await s.get(`infinity-attachment://${s.pngId.toUpperCase()}`)).status).toBe(404);
  });

  it('traversal attempts are rejected and never read files outside attachments', async () => {
    const s = await setupAttachments();
    for (const url of [
      `infinity-attachment://${s.pngId}/../../infinity-notes.sqlite3`,
      `infinity-attachment://${s.pngId}/%2e%2e%2f%2e%2e%2fsecret.txt`,
      `infinity-attachment://${s.pngId}/..%5c..%5csecret.txt`,
      'infinity-attachment://..%2fsecret.txt',
      'infinity-attachment://%2e%2e/secret.txt',
    ]) {
      const res = await s.get(url);
      expect(res.status, url).toBe(404);
      expect(await res.text()).toBe('');
    }
  });

  it('a row whose path escapes attachments cannot be inserted, and a tampered stored path is refused', async () => {
    const s = await setupAttachments();
    expect(() =>
      s.t.db
        .prepare("INSERT INTO attachments(id, managed_relative_path, sha256, mime, size_bytes, kind, created_at) VALUES ('" + randomUUID() + "', 'attachments/ab/../../x', '" + 'd'.repeat(64) + "', 'image/png', 1, 'image', 1)")
        .run(),
    ).toThrow();
    // Simulate a row that bypassed the CHECK (for example a future bug): the handler still refuses it.
    s.t.db.exec('PRAGMA ignore_check_constraints = ON');
    const evil = randomUUID();
    s.t.db
      .prepare<[string, string]>(
        "INSERT INTO attachments(id, managed_relative_path, sha256, mime, size_bytes, kind, created_at) VALUES (?, ?, '" + 'e'.repeat(64) + "', 'image/png', 1, 'image', 1)",
      )
      .run(evil, 'attachments/../secret.txt');
    s.t.db.exec('PRAGMA ignore_check_constraints = OFF');
    const res = await s.get(`infinity-attachment://${evil}`);
    expect(res.status).toBe(404);
    expect(s.logger.lines.some((l) => l.includes(`attachment: containment violation id=${evil}`))).toBe(true);
  });

  it('junction or symlink escape refused (F-01-2)', async () => {
    const s = await setupAttachments();
    const outside = path.join(s.t.dir, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'leak.png'), PNG);
    // A directory junction (Windows, no admin needed) or a directory symlink (Linux) under attachments/ pointing outside.
    fs.symlinkSync(outside, path.join(s.dataDir, 'attachments', 'cd'), process.platform === 'win32' ? 'junction' : 'dir');
    const viaLink = randomUUID();
    s.t.db
      .prepare<[string]>(
        "INSERT INTO attachments(id, managed_relative_path, sha256, mime, size_bytes, kind, created_at) VALUES (?, 'attachments/cd/leak.png', '" + 'f'.repeat(64) + "', 'image/png', 1, 'image', 1)",
      )
      .run(viaLink);
    expect(fs.readFileSync(path.join(s.dataDir, 'attachments', 'cd', 'leak.png')).equals(PNG)).toBe(true);
    const res = await s.get(`infinity-attachment://${viaLink}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('');
    expect(s.logger.lines.some((l) => l.includes(`attachment: containment violation id=${viaLink}`))).toBe(true);
    // The regular image next to it is still served.
    expect((await s.get(`infinity-attachment://${s.pngId}`)).status).toBe(200);
  });

  // Platform condition: creating a file symlink on Windows needs administrator rights or Developer Mode; the
  // junction case above covers Windows.
  it.skipIf(process.platform === 'win32')('a file symlink inside attachments is refused', async () => {
    const s = await setupAttachments();
    const target = path.join(s.dataDir, 'attachments', 'ab', 'pic.png');
    const link = path.join(s.dataDir, 'attachments', 'ab', 'link.png');
    fs.symlinkSync(target, link, 'file');
    const id = randomUUID();
    s.t.db
      .prepare<[string]>(
        "INSERT INTO attachments(id, managed_relative_path, sha256, mime, size_bytes, kind, created_at) VALUES (?, 'attachments/ab/link.png', '" + '9'.repeat(64) + "', 'image/png', 1, 'image', 1)",
      )
      .run(id);
    expect((await s.get(`infinity-attachment://${id}`)).status).toBe(404);
  });

  it('non-GET gives 405 and a closed database gives 404', async () => {
    const s = await setupAttachments();
    expect((await s.get(`infinity-attachment://${s.pngId}`, 'POST')).status).toBe(405);
    const none = createAttachmentHandler({ db: null, dataDir: s.dataDir });
    expect((await none({ url: `infinity-attachment://${s.pngId}`, method: 'GET' } as Request)).status).toBe(404);
  });
});

describe('renderer protocol (D-035)', () => {
  function rendererRoot() {
    const root = mkTmp('infinity-renderer-');
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>x</title>');
    fs.writeFileSync(path.join(root, 'assets', 'x.js'), 'export {};');
    fs.writeFileSync(path.join(root, 'assets', 'x.exe'), 'MZ');
    fs.writeFileSync(path.join(path.dirname(root), 'package.json.secret.json'), '{}');
    return root;
  }
  const get = (h: ReturnType<typeof createRendererHandler>, url: string) => h({ url, method: 'GET' } as Request);

  it('serves index.html with the CSP header and js with the right MIME type', async () => {
    const h = createRendererHandler({ root: rendererRoot() });
    for (const url of ['infinity-app://renderer/', 'infinity-app://renderer/index.html', 'infinity-app://renderer']) {
      const res = await get(h, url);
      expect(res.status, url).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(res.headers.get('content-security-policy')).toBe(PROD_CSP);
    }
    const js = await get(h, 'infinity-app://renderer/assets/x.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toBe('text/javascript');
  });

  it('rejects traversal, unknown extensions, missing files and a wrong host', async () => {
    const root = rendererRoot();
    const h = createRendererHandler({ root });
    for (const url of [
      'infinity-app://renderer/../package.json',
      'infinity-app://renderer/%2e%2e/package.json.secret.json',
      'infinity-app://renderer/assets/%2e%2e%2f%2e%2e%2fpackage.json.secret.json',
      'infinity-app://renderer/assets/x.exe',
      'infinity-app://renderer/missing.js',
      'infinity-app://evil/index.html',
      'infinity-app://renderer/%00.html',
      'infinity-app://renderer/%E0%A4%A.html',
    ]) {
      expect((await get(h, url)).status, url).toBe(404);
    }
  });
});

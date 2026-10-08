import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dbFileOf, openDb } from './fixtures';
import { useApp } from './harness';

const h = useApp();

test.beforeEach(() => {
  fs.mkdirSync(path.join(h.userData, 'data'), { recursive: true });
});

const sha = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('upgrade failure screen', async () => {
  const file = dbFileOf(h.userData);
  const legacy = new Database(file);
  legacy.exec("CREATE TABLE notes(legacy TEXT); INSERT INTO notes(legacy) VALUES ('keep me')");
  legacy.close();
  const before = sha(file);

  const { app, page } = await h.start();
  await expect(page.getByRole('alert')).toContainText('Database upgrade failed; your data was not changed');
  await expect(page.getByRole('button', { name: 'Show data folder' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Quit' })).toBeVisible();

  await page.getByRole('button', { name: 'Show data folder' }).click();
  await expect
    .poll(() => app.evaluate(() => globalThis.__infinityTest?.shellCalls ?? []))
    .toEqual([{ op: 'openPath', path: path.join(h.userData, 'data') }]);

  const exited = new Promise<number | null>((resolve) => app.process().once('exit', (code) => resolve(code)));
  await page.getByRole('button', { name: 'Quit' }).click();
  expect(await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 20_000))])).not.toBe('timeout');
  await h.stop();

  expect(sha(file)).toBe(before);
  const db = openDb(file, { readonly: true });
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name);
  expect(db.pragma('user_version', { simple: true })).toBe(0);
  expect(tables).toEqual(['notes']);
  expect(db.prepare('SELECT legacy FROM notes').all()).toEqual([{ legacy: 'keep me' }]);
  db.close();
  const copies = fs.readdirSync(path.join(h.userData, 'data', 'pre-migration'));
  expect(copies).toHaveLength(1);
  const copy = openDb(path.join(h.userData, 'data', 'pre-migration', copies[0]!), { readonly: true });
  expect(copy.prepare('SELECT legacy FROM notes').all()).toEqual([{ legacy: 'keep me' }]);
  copy.close();
});

test('newer schema', async () => {
  const file = dbFileOf(h.userData);
  const future = new Database(file);
  future.exec('CREATE TABLE future(a TEXT)');
  future.pragma('user_version = 99');
  future.close();
  const before = sha(file);

  const { page } = await h.start();
  await expect(page.getByRole('alert')).toContainText(
    'This notebook was created by a newer version of Infinity Notes. Your data was not changed.',
  );
  await h.stop();
  expect(sha(file)).toBe(before);
  expect(fs.existsSync(file + '-wal')).toBe(false);
  const pre = path.join(h.userData, 'data', 'pre-migration');
  expect(fs.existsSync(pre) ? fs.readdirSync(pre) : []).toEqual([]);
});

test('unreadable database', async () => {
  const file = dbFileOf(h.userData);
  fs.writeFileSync(file, randomBytes(4096));
  const before = sha(file);
  const { page } = await h.start();
  await expect(page.getByRole('alert')).toContainText(
    'Infinity Notes could not open its database. Your data was not changed.',
  );
  await h.stop();
  expect(sha(file)).toBe(before);
});

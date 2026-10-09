import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { useApp } from './harness';
import { chooseNoteMenu, editorText } from './editor-ui';
import { COMMON, createNote, saveText } from './seed';
import { settingsSection } from './portability-ui';
import { dialogByName, openFromTree, railGo } from './ui';

const h = useApp({ failOnMainErrors: true });
const DAY = 86_400_000;

test('version history with restore, and the retention settings prune automatic versions (INF-PORT-07)', async () => {
  const { page } = await h.start();
  const id = await createNote(page, COMMON, 'Draft');
  await saveText(page, id, 'current text');
  await h.stop();
  // Fifteen automatic versions: the oldest five are 40 days old, the newest is one hour old.
  const now = Date.now();
  h.writeWhileClosed((db) => {
    const insert = db.prepare("INSERT INTO note_versions(id, note_id, revision, format, content_snapshot, reason, created_at) VALUES (?, ?, 1, 'rich', ?, 'auto', ?)");
    for (let i = 0; i < 15; i += 1) {
      const doc = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'text', text: `version ${i}` }] }] };
      insert.run(randomUUID(), id, JSON.stringify(doc), i < 5 ? now - 40 * DAY - i : now - 3_600_000 * (15 - i));
    }
  });

  const { app, page: second } = await h.start();
  await railGo(second, 'Settings');
  const notes = settingsSection(second, 'Notes and attachments');
  const max = notes.getByLabel('Most automatic versions per note');
  await max.fill('10');
  await max.press('Enter');
  await expect.poll(() => h.setting('retention.autoVersionMax')).toEqual({ v: 1, value: 10 });
  await app.evaluate(() => globalThis.__infinityTest!.maintenance());
  const kept = () => h.all<{ created_at: number }>("SELECT created_at FROM note_versions WHERE note_id = ? AND reason = 'auto'", id);
  // Older than 30 days go first (5), then all but the newest 10 remain.
  expect(kept()).toHaveLength(10);
  expect(kept().every((v) => v.created_at > now - 30 * DAY)).toBe(true);

  await openFromTree(second, id);
  await chooseNoteMenu(second, 'Version history…');
  const history = dialogByName(second, 'Version history');
  await expect(history.locator('.version-row')).toHaveCount(10);
  const newest = history.locator('.version-row').first();
  await expect(newest).toContainText('Automatic');
  await expect(newest).toContainText('version 14');
  await newest.getByRole('button', { name: 'Restore' }).press('Enter');
  const confirm = dialogByName(second, 'Restore this version?');
  await confirm.getByRole('button', { name: 'Restore' }).press('Enter');
  await expect.poll(() => editorText(second)).toBe('version 14');
  // The text it replaced is kept as a version first.
  await expect.poll(() => h.all("SELECT id FROM note_versions WHERE note_id = ? AND reason = 'restore'", id).length).toBe(1);
});

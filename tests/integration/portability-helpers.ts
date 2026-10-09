import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { openDatabase } from '../../src/main/db/open-database';
import { openWithPendingRestore, type MoveFn } from '../../src/main/portability/restore';
import { memoryLogger } from '../../src/main/services/logger';
import type { RichDocLike } from '../../src/shared/editor/doc-schema';
import { makePng } from '../support/png';
import { setupServices, type Services } from './hierarchy-helpers';
import { mkTmp, trackDb, type TestDb } from './helpers';

/** Saves rich content through the real writer (lease, revision, indexing), like an editor does. */
export function saveDoc(s: Services, noteId: string, doc: RichDocLike): void {
  const viewId = randomUUID();
  const revision = s.row<{ revision: number }>('SELECT revision FROM notes WHERE id = ?', noteId)!.revision;
  s.writer.save({ noteId, viewId, baseRevision: revision, requestId: randomUUID(), format: 'rich', content: doc });
}

export const paragraph = (id: string, text: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });

/**
 * A notebook with what a faithful copy must keep: a project and folder, a rich note with an image and a block, a second
 * note referencing that block, tags, favorites, a sticky, a plain note and a reminder anchored on the block.
 */
export async function seedNotebook(s: Services) {
  const alpha = s.project('Alpha');
  const plans = s.folder(alpha.id, null, 'Plans');
  const design = s.note(alpha.id, plans.id, 'Design');
  const index = s.note(null, null, 'Index');
  const plain = s.hierarchy.createNote({ projectId: null, folderId: null }, false, 'Plain', 'plain').note;
  const png = makePng(8, 6, [10, 120, 200, 255]);
  const { attachment } = await s.attachments.importBytes({ kind: 'image', originalName: 'chart.png', bytes: png });
  const block = randomUUID();
  const imageBlock = randomUUID();
  saveDoc(s, design.id, {
    type: 'doc',
    content: [paragraph(block, 'Ship the backup on Friday'), { type: 'image', attrs: { id: imageBlock, attachmentId: attachment.id, alt: 'chart', size: 'medium' } }],
  });
  saveDoc(s, index.id, {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { id: randomUUID() },
        content: [{ type: 'text', text: 'See ' }, { type: 'noteRef', attrs: { noteId: design.id, blockId: block, label: 'Design', excerpt: null } }],
      },
    ],
  });
  const viewId = randomUUID();
  s.writer.save({ noteId: plain.id, viewId, baseRevision: 0, requestId: randomUUID(), format: 'plain', content: 'plain body' });
  s.hierarchy.setFavorite('note', design.id, true);
  s.hierarchy.setPinned(index.id, true);
  s.tags.set(design.id, ['work', 'q4']);
  s.stickies.enable(index.id);
  s.stickies.setColor(index.id, 'blue');
  const reminder = s.reminders.create({
    noteId: design.id,
    blockId: block,
    title: 'Ship it',
    zoneId: 'Asia/Dhaka',
    date: '2030-01-02',
    time: '09:00',
    recurrence: null,
    foldPreference: 'earlier',
    followup: null,
    allowPast: false,
  });
  return { alpha, plans, design, index, plain, attachment, png, block, reminder };
}

/** A second, empty profile: the clean data a backup is restored into. */
export async function cleanProfile(): Promise<Services> {
  return setupServices();
}

/**
 * Simulates the restart after a scheduled restore: closes the profile's database and starts again the way main does,
 * applying the pending restore before the database opens.
 */
export async function restartWithRestore(s: Services, opts: { failOpen?: number; move?: MoveFn } = {}) {
  s.t.db.close();
  let failures = opts.failOpen ?? 0;
  const logger = memoryLogger();
  const result = await openWithPendingRestore({
    paths: s.paths,
    logger,
    move: opts.move,
    openDatabase: async () => {
      if (failures > 0) {
        failures -= 1;
        return { ok: false, code: 'MIGRATION_FAILED', detail: 'injected' };
      }
      return openDatabase({ dbFile: s.paths.dbFile, preMigrationDir: s.paths.preMigrationDir, logger });
    },
  });
  if (!result.opened.ok) throw new Error(`open failed: ${result.opened.code}`);
  const testDb: TestDb = { ...s.t, db: trackDb(result.opened.db), logger };
  return { restore: result.restore, services: await setupServices({ testDb, restoreOutcome: result.restore }), logger };
}

export function tmpFile(name: string): string {
  return path.join(mkTmp('infinity-port-'), name);
}

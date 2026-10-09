import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AppHandlerDeps } from '../../src/main/ipc/handlers/app-handlers';
import { catalogueRouter } from './ipc-helpers';
import { doc, para, setupReminders } from './reminder-helpers';

const MAIN = 1;
const STICKY = 3;
const FORBIDDEN = { ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } };

const app: AppHandlerDeps = {
  getInfo: () => {
    throw new Error('not used');
  },
  getCapabilities: () => {
    throw new Error('not used');
  },
  shell: { openPath: async () => '', openExternal: async () => {}, showItemInFolder: () => {} },
  dataDir: '/data',
  quit: () => {},
  flushed: () => false,
};

async function setup() {
  const s = await setupReminders();
  const B = randomUUID();
  const target = s.editable('Target');
  target.save(doc(para(B, 'Block text')));
  const own = s.editable('Own');
  own.save(doc({ type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'noteRef', attrs: { noteId: target.note.id, blockId: B, label: 'Target', excerpt: 'Block text' } }] }));
  const r = catalogueRouter(s.services, app, { stickyNoteId: own.note.id });
  return { s, B, target: target.note, own: own.note, call: r.call };
}

describe('Phase 07 channels (D-098)', () => {
  it('main: refs, picker blocks, search and tags through the catalogue with response validation', async () => {
    const t = await setup();
    expect((await t.call('refs:list', { noteId: t.own.id }, MAIN)).data).toMatchObject({ outgoing: [{ targetNoteId: t.target.id, targetBlockId: t.B, state: 'ok' }], backlinks: [] });
    expect((await t.call('notes:pick', { noteId: t.target.id, query: 'block' }, MAIN)).data).toEqual({ format: 'rich', blocks: [{ blockId: t.B, kind: 'paragraph', text: 'Block text' }] });
    expect((await t.call('search:query', { query: 'block', scope: { kind: 'common' } }, MAIN)).data.results.map((r: { note: { id: string } }) => r.note.id)).toEqual([t.target.id]);
    expect((await t.call('tags:set', { noteId: t.own.id, tags: ['work'] }, MAIN)).data).toEqual({ tags: ['work'] });
    expect((await t.call('tags:list', {}, MAIN)).data).toEqual({ tags: [{ name: 'work', count: 1 }] });
  });

  it('validation: bad tags, oversized limits and unknown fields are refused before any service runs', async () => {
    const t = await setup();
    for (const [channel, payload] of [
      ['tags:set', { noteId: t.own.id, tags: ['Has Space'] }],
      ['search:query', { query: 'x', limit: 51 }],
      ['search:query', { query: 'x'.repeat(201) }],
      ['refs:list', { noteId: 'nope' }],
      ['notes:pick', { noteId: t.target.id }],
      ['attachment:open', { attachmentId: randomUUID() }],
    ] as const) {
      expect((await t.call(channel, payload, MAIN)).error?.code, channel).toBe('VALIDATION_FAILED');
    }
  });

  it('a sticky may hand off only its own note files and has no reference, search or tag channels', async () => {
    const t = await setup();
    const handoff = { noteId: t.target.id, attachmentId: randomUUID() };
    expect(await t.call('attachment:open', handoff, STICKY)).toEqual(FORBIDDEN);
    expect(await t.call('attachment:showInFolder', handoff, STICKY)).toEqual(FORBIDDEN);
    expect((await t.call('attachment:open', { ...handoff, noteId: t.own.id }, STICKY)).error?.code).toBe('NOT_FOUND');
    for (const [channel, payload] of [
      ['refs:list', { noteId: t.own.id }],
      ['notes:pick', { noteId: t.own.id, query: '' }],
      ['search:query', { query: 'block' }],
      ['tags:list', {}],
      ['tags:set', { noteId: t.own.id, tags: [] }],
    ] as const) {
      expect(await t.call(channel, payload, STICKY), channel).toEqual(FORBIDDEN);
    }
  });
});

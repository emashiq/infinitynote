import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteController, CONTENT_ERROR, SAVE_FAILED } from '../../../../src/renderer/notes/note-controller';
import { realTimers } from '../../../../src/renderer/state/store';
import type { InfinityBridge } from '../../../../src/shared/contracts/bridge';
import { NOTE_TOO_LARGE_MESSAGE } from '../../../../src/shared/contracts/notes';
import { createFakeBridge, type FakeBridge } from '../support/fake-bridge';
import { TestSource } from '../support/editor-source';

let n = 0;
const uuid = () => `11111111-1111-4111-8111-${String(++n).padStart(12, '0')}`;
const VIEW = '22222222-2222-4222-8222-222222222222';
const OTHER_VIEW = '33333333-3333-4333-8333-333333333333';

async function setup(opts: { format?: 'rich' | 'plain' } = {}) {
  const fake = createFakeBridge();
  const created = await fake.bridge.note.create({ location: { projectId: null, folderId: null }, sticky: false, title: 'T', ...(opts.format ? { format: opts.format } : {}) });
  if (!created.ok) throw new Error('create');
  const note = created.data.note;
  const make = (bridge: InfinityBridge = fake.bridge, viewId = VIEW) => new NoteController({ bridge, noteId: note.id, viewId, timers: realTimers, uuid });
  /** An opened controller with a test editor attached, receiving the live-sync events main sends. */
  const opened = async (bridge?: InfinityBridge, viewId?: string) => {
    const c = make(bridge, viewId);
    connect(fake, c);
    await c.open();
    return { c, editor: new TestSource(c) };
  };
  return { fake, note, make, opened, stored: () => fake.data.notes.find((x) => x.id === note.id)! };
}

/** Routes main's live-sync events to a controller, as the window's event wiring does. */
function connect(fake: FakeBridge, c: NoteController): void {
  fake.bridge.subscribe('collab:steps', (e) => c.onSteps(e));
  fake.bridge.subscribe('collab:status', (e) => c.onStatus(e));
  fake.bridge.subscribe('collab:reset', (e) => c.onReset(e));
}

const pushes = (fake: FakeBridge) => fake.callsTo('collab:push');
const storedText = (fake: FakeBridge, noteId: string) => JSON.stringify(fake.data.notes.find((x) => x.id === noteId)!.content);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('NoteController: open and save through live sync (INF-SAVE-01, D-103)', () => {
  it('opens a note: summary and drafts, then joins its session with the document main holds', async () => {
    const { fake, make, note } = await setup();
    const c = make();
    await c.open();
    expect(c.store.getState()).toMatchObject({ status: 'ready', format: 'rich', revision: 0, save: 'saved', title: 'T', contentKey: 1, syncVersion: 0, drafts: [] });
    // Main gives the blocks their IDs when the session starts, so no editor has to.
    expect(c.store.getState().content).toEqual({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: expect.stringMatching(/^[0-9a-f-]{36}$/) } }] });
    expect(fake.calls.map((x) => x.channel).filter((ch) => ['note:open', 'drafts:list', 'collab:join'].includes(ch))).toEqual(['note:open', 'drafts:list', 'collab:join']);
    expect(c.store.getState().note?.id).toBe(note.id);
  });

  it('a plain note opens as a document of its lines', async () => {
    const { make, stored } = await setup({ format: 'plain' });
    stored().content = 'line one\nline two';
    const c = make();
    await c.open();
    expect(c.store.getState()).toMatchObject({ format: 'plain' });
    expect(new TestSource(c).text).toBe('line one\nline two');
  });

  it('opening a note never saves: no edit, no request', async () => {
    const { fake, opened } = await setup();
    await opened();
    await vi.advanceTimersByTimeAsync(2000);
    expect(pushes(fake)).toHaveLength(0);
    expect(fake.callsTo('collab:flush')).toHaveLength(0);
  });

  it('an edit goes to main at once; main saves it a moment later and the indicator follows', async () => {
    const { fake, opened, note } = await setup();
    const { c, editor } = await opened();
    editor.type('he');
    await vi.advanceTimersByTimeAsync(0);
    expect(pushes(fake)).toHaveLength(1);
    expect(editor.sendable()).toBeNull();
    expect(c.store.getState().save).toBe('saving');
    await vi.advanceTimersByTimeAsync(400);
    expect(c.store.getState()).toMatchObject({ revision: 1, save: 'saved' });
    expect(storedText(fake, note.id)).toContain('"he"');
  });

  it('one push at a time: edits made while one is in flight go together in the next', async () => {
    const { fake, opened } = await setup();
    let release: () => void = () => {};
    let inFlight = 0;
    let maxInFlight = 0;
    const slow: InfinityBridge = {
      ...fake.bridge,
      collab: {
        ...fake.bridge.collab,
        push: async (req) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          if (pushes(fake).length === 0) await new Promise<void>((r) => (release = r));
          const res = await fake.bridge.collab.push(req);
          inFlight -= 1;
          return res;
        },
      },
    };
    const { c, editor } = await opened(slow);
    editor.append('one');
    await vi.advanceTimersByTimeAsync(0);
    editor.append(' two');
    editor.append(' three');
    release();
    expect(await c.flush()).toEqual({ ok: true });
    expect(maxInFlight).toBe(1);
    expect(pushes(fake)).toHaveLength(2);
    expect((pushes(fake)[1]!.req as { steps: unknown[] }).steps).toHaveLength(2);
    expect(c.store.getState()).toMatchObject({ revision: 1, save: 'saved' });
  });

  it('flush sends at once (the editor calls it on blur), has main save, and resolves after', async () => {
    const { fake, opened, note } = await setup();
    const { c, editor } = await opened();
    editor.type('flush me');
    expect(await c.flush()).toEqual({ ok: true });
    expect(fake.callsTo('collab:flush')).toHaveLength(1);
    expect(storedText(fake, note.id)).toContain('flush me');
    expect(c.store.getState()).toMatchObject({ revision: 1, save: 'saved' });
  });

  it('flush waits for image imports, then saves the finished content', async () => {
    const { fake, opened, note } = await setup();
    const { c, editor } = await opened();
    editor.type('with image uploading');
    editor.uploads = 1;
    let done = false;
    const flushed = c.flush().then((r) => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(done).toBe(false);
    editor.finishUploads('with image done');
    expect(await flushed).toEqual({ ok: true });
    expect(storedText(fake, note.id)).toContain('with image done');
    expect(c.store.getState().save).toBe('saved');
  });

  it('a push main refuses keeps the edits unconfirmed with the message; the next flush sends them again', async () => {
    const { fake, opened, note } = await setup();
    const { c, editor } = await opened();
    fake.failNext('collab:push', { code: 'LIMIT_EXCEEDED', message: NOTE_TOO_LARGE_MESSAGE });
    editor.type('big');
    expect(await c.flush()).toMatchObject({ ok: false, code: 'LIMIT_EXCEEDED' });
    expect(c.store.getState()).toMatchObject({ save: 'error', message: NOTE_TOO_LARGE_MESSAGE });
    expect(editor.sendable()).not.toBeNull();
    fake.failNext('collab:push', { code: 'VALIDATION_FAILED', message: 'These edits could not be applied' });
    expect(await c.flush()).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(c.store.getState()).toMatchObject({ save: 'error', message: SAVE_FAILED });
    expect(await c.flush()).toEqual({ ok: true });
    expect(storedText(fake, note.id)).toContain('big');
    expect(c.store.getState().save).toBe('saved');
  });

  it("main's save status shows in every view: retrying and failed saves, and saved only once its text is in", async () => {
    const { opened } = await setup();
    const { c, editor } = await opened();
    editor.type('x');
    await vi.advanceTimersByTimeAsync(0);
    const epoch = (c as unknown as { epoch: string }).epoch;
    const status = (state: 'saved' | 'retrying' | 'error', savedVersion: number, message: string | null = null) =>
      c.onStatus({ noteId: c.noteId, epoch, savedVersion, revision: 1, state, message });
    status('retrying', 0, 'Could not save the note');
    expect(c.store.getState()).toMatchObject({ save: 'retrying' });
    status('error', 0, 'Could not save the note');
    expect(c.store.getState()).toMatchObject({ save: 'error', message: 'Could not save the note' });
    status('saved', 0);
    expect(c.store.getState().save).toBe('error');
    status('saved', 1);
    expect(c.store.getState()).toMatchObject({ save: 'saved', revision: 1 });
    c.onStatus({ noteId: c.noteId, epoch: 'another-session', savedVersion: 9, revision: 9, state: 'error', message: 'x' });
    expect(c.store.getState().save).toBe('saved');
  });

  it('dispose flushes, then leaves the session, once', async () => {
    const { fake, opened } = await setup();
    const { c, editor } = await opened();
    editor.type('bye');
    await c.dispose();
    const order = fake.calls.map((x) => x.channel).filter((ch) => ch === 'collab:flush' || ch === 'collab:leave');
    expect(order).toEqual(['collab:flush', 'collab:leave']);
    await c.dispose();
    expect(fake.callsTo('collab:leave')).toHaveLength(1);
  });

  it('rename is debounced, validated and does not change the text', async () => {
    const { fake, opened } = await setup();
    const { c } = await opened();
    c.rename('N');
    c.rename('New title');
    await vi.advanceTimersByTimeAsync(399);
    expect(fake.callsTo('note:rename')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.callsTo('note:rename')[0]?.req).toEqual({ noteId: c.noteId, title: 'New title' });
    c.rename('x'.repeat(201));
    expect(c.store.getState().titleError).toMatch(/Titles can be at most 200/);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.callsTo('note:rename')).toHaveLength(1);
    c.rename('Flushed');
    expect(await c.flush()).toEqual({ ok: true });
    expect(fake.callsTo('note:rename')).toHaveLength(2);
    expect(pushes(fake)).toHaveLength(0);
  });

  it('a content error shows the message and leaves the session without sending anything', async () => {
    const { fake, opened } = await setup();
    const { c } = await opened();
    c.contentError();
    expect(c.store.getState()).toMatchObject({ status: 'error', message: CONTENT_ERROR });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsTo('collab:leave')).toHaveLength(1);
    expect(pushes(fake)).toHaveLength(0);
  });

  it('a trashed note opens as trashed, a missing one as missing', async () => {
    const { fake, make, note } = await setup();
    const trashed = await fake.bridge.note.trash({ noteId: note.id });
    if (!trashed.ok) throw new Error('trash');
    const c = make();
    await c.open();
    expect(c.store.getState()).toMatchObject({ status: 'trashed', trashBatchId: trashed.data.trashBatchId });
    expect(fake.callsTo('collab:join')).toHaveLength(0);
    fake.data.notes.length = 0;
    const gone = make();
    await gone.open();
    expect(gone.store.getState().status).toBe('missing');
  });
});

describe('NoteController: two views of one note (D-103)', () => {
  it('both edit at once: each sees the other, concurrent edits rebase and both converge with the stored note', async () => {
    const { fake, opened, note } = await setup();
    const a = await opened(undefined, VIEW);
    const b = await opened(undefined, OTHER_VIEW);
    a.editor.append('tab ');
    await vi.advanceTimersByTimeAsync(0);
    expect(b.editor.text).toBe('tab ');
    // Typed at the same time: the second push is behind, rebases on the first and goes through.
    a.editor.append('one ');
    b.editor.append('two ');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(a.editor.sendable()).toBeNull();
    expect(b.editor.sendable()).toBeNull();
    expect(a.editor.text).toBe(b.editor.text);
    expect(a.editor.text).toMatch(/^tab (one two |two one )$/);
    expect(fake.callsTo('collab:push').some((call, i) => i > 0 && (call.req as { viewId: string }).viewId === OTHER_VIEW)).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(storedText(fake, note.id)).toContain(a.editor.text.trim());
    expect(a.c.store.getState().save).toBe('saved');
    expect(b.c.store.getState().save).toBe('saved');
  });

  it('a conversion in one view starts the session over: the other joins again and keeps unsynced edits as a draft', async () => {
    const { fake, opened } = await setup();
    const a = await opened(undefined, VIEW);
    const b = await opened(undefined, OTHER_VIEW);
    a.editor.type('Plan');
    expect(await a.c.flush()).toEqual({ ok: true });
    // B has an edit main never got: its push is still to come when the note is replaced.
    const held: Array<() => void> = [];
    const slowB: InfinityBridge = { ...fake.bridge, collab: { ...fake.bridge.collab, push: (req) => new Promise((r) => held.push(() => r(fake.bridge.collab.push(req)))) } };
    (b.c as unknown as { deps: { bridge: InfinityBridge } }).deps.bridge = slowB;
    b.editor.append(' unsynced');
    expect(await a.c.convert('plain')).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(a.c.store.getState()).toMatchObject({ format: 'plain', contentKey: 2 });
    expect(b.c.store.getState()).toMatchObject({ format: 'plain', contentKey: 2, conflict: { reason: 'stale' } });
    const draft = fake.data.drafts.find((d) => d.id === b.c.store.getState().conflict!.draftId)!;
    expect(JSON.stringify(draft.content)).toContain('Plan unsynced');
    for (const go of held) go();
  });

  it('a reset that names a draft shows the conflict banner with it', async () => {
    const { opened } = await setup();
    const { c } = await opened();
    const draftId = '44444444-4444-4444-8444-444444444444';
    c.onReset({ noteId: c.noteId, conflict: { draftId, reason: 'stale' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.store.getState().conflict).toEqual({ draftId, reason: 'stale' });
  });

  it('handleTrashed flushes pending edits into a trashed draft, leaves and shows the trash state; reopen brings it back', async () => {
    const { fake, opened, stored } = await setup();
    const { c, editor } = await opened();
    editor.type('pending words');
    Object.assign(stored(), { deletedAt: 5, batch: OTHER_VIEW });
    const flushed = await c.handleTrashed(OTHER_VIEW);
    expect(flushed).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'trashed' } });
    expect(fake.data.drafts).toHaveLength(1);
    expect(JSON.stringify(fake.data.drafts[0]!.content)).toContain('pending words');
    expect(fake.callsTo('collab:leave')).toHaveLength(1);
    expect(c.store.getState()).toMatchObject({ status: 'trashed', trashBatchId: OTHER_VIEW, save: 'saved' });

    Object.assign(stored(), { deletedAt: null, batch: null });
    await c.reopen();
    expect(c.store.getState()).toMatchObject({ status: 'ready', trashBatchId: undefined, conflict: null });
    expect(c.store.getState().drafts).toHaveLength(1);
  });
});

describe('NoteController: conversion, versions and drafts (INF-EDIT-05, INF-SAVE-06)', () => {
  it('convert to plain text saves first, joins the new session and offers the formatted version back', async () => {
    const { fake, opened } = await setup();
    const { c, editor } = await opened();
    editor.type('Plan');
    expect(await c.convert('plain')).toEqual({ ok: true });
    const convertReq = fake.callsTo('note:convertFormat')[0]!.req as { confirmLossy?: boolean; baseRevision: number };
    expect(convertReq).toMatchObject({ confirmLossy: true, baseRevision: 1 });
    const versionId = fake.data.versions[0]!.id;
    expect(c.store.getState()).toMatchObject({ format: 'plain', revision: 2, contentKey: 2, converted: { versionId } });
    expect(new TestSource(c).text).toBe('Plan');
    expect(await c.restoreVersion(versionId)).toEqual({ ok: true });
    expect(c.store.getState()).toMatchObject({ format: 'rich', revision: 3, converted: null });
    expect(JSON.stringify(c.store.getState().content)).toContain('Plan');
  });

  it('convert to rich text sends no confirmation', async () => {
    const { fake, opened } = await setup({ format: 'plain' });
    const { c } = await opened();
    expect(await c.convert('rich')).toEqual({ ok: true });
    expect(fake.callsTo('note:convertFormat')[0]!.req).not.toHaveProperty('confirmLossy');
    expect(c.store.getState()).toMatchObject({ format: 'rich', converted: null });
  });

  it('edits main refused stop the conversion', async () => {
    const { fake, opened } = await setup();
    const { c, editor } = await opened();
    fake.failNext('collab:push', { code: 'LIMIT_EXCEEDED', message: 'too big' });
    editor.type('x');
    expect(await c.convert('plain')).toEqual({ ok: false, message: 'too big' });
    expect(fake.callsTo('note:convertFormat')).toHaveLength(0);
  });

  it('restore draft applies it and refreshes; dismiss resolves it', async () => {
    const { fake, opened } = await setup();
    const { c } = await opened();
    const draftId = '55555555-5555-4555-8555-555555555555';
    fake.data.drafts.push({ id: draftId, noteId: c.noteId, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'my lost words' }] }] }, format: 'rich', baseRevision: 0, reason: 'conflict', createdAt: 1, resolved: false });
    c.store.setState({ conflict: { draftId, reason: 'stale' } });
    expect(await c.restoreDraft(draftId)).toEqual({ ok: true });
    expect(c.store.getState()).toMatchObject({ conflict: null, drafts: [], revision: 1, contentKey: 2 });
    expect(JSON.stringify(c.store.getState().content)).toContain('my lost words');
    expect(fake.data.versions.map((v) => v.reason)).toEqual(['conflict']);

    const second = '66666666-6666-4666-8666-666666666666';
    fake.data.drafts.push({ id: second, noteId: c.noteId, content: 'x', format: 'rich', baseRevision: 0, reason: 'conflict', createdAt: 2, resolved: false });
    c.store.setState({ conflict: { draftId: second, reason: 'stale' } });
    expect(await c.dismissDraft(second)).toEqual({ ok: true });
    expect(c.store.getState()).toMatchObject({ conflict: null, drafts: [] });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteController, CONTENT_ERROR, SAVE_FAILED, TAKE_CONTROL_FIRST } from '../../../../src/renderer/notes/note-controller';
import { realTimers } from '../../../../src/renderer/state/store';
import type { InfinityBridge } from '../../../../src/shared/contracts/bridge';
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
  const make = (bridge: InfinityBridge = fake.bridge) => new NoteController({ bridge, noteId: note.id, viewId: VIEW, timers: realTimers, uuid });
  /** An opened controller with a test editor attached. */
  const opened = async (bridge?: InfinityBridge) => {
    const c = make(bridge);
    await c.open();
    return { c, editor: new TestSource(c) };
  };
  return { fake, note, make, opened, stored: () => fake.data.notes.find((x) => x.id === note.id)! };
}

const saves = (fake: FakeBridge) => fake.callsTo('note:save');
const savedText = (fake: FakeBridge, i: number) => JSON.stringify((saves(fake)[i]!.req as { content: unknown }).content);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('NoteController: open and save (INF-SAVE-01)', () => {
  it('opens a note: content, format, revision and drafts, then takes the lease', async () => {
    const { fake, make, note } = await setup();
    const c = make();
    await c.open();
    expect(c.store.getState()).toMatchObject({ status: 'ready', format: 'rich', revision: 0, save: 'saved', title: 'T', contentKey: 1, drafts: [] });
    expect(c.store.getState().content).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(fake.calls.map((x) => x.channel).filter((ch) => ['note:open', 'drafts:list', 'lease:acquire'].includes(ch))).toEqual(['note:open', 'drafts:list', 'lease:acquire']);
    expect(c.store.getState().note?.id).toBe(note.id);
  });

  it('a plain note opens with its text', async () => {
    const { make, stored } = await setup({ format: 'plain' });
    stored().content = 'line one\nline two';
    const c = make();
    await c.open();
    expect(c.store.getState()).toMatchObject({ format: 'plain', content: 'line one\nline two' });
  });

  it('opening a note never saves: no edit, no request', async () => {
    const { fake, opened } = await setup();
    await opened();
    await vi.advanceTimersByTimeAsync(2000);
    expect(saves(fake)).toHaveLength(0);
  });

  it('debounces edits by 400 ms into one save of the current content', async () => {
    const { fake, opened } = await setup();
    const { c, editor } = await opened();
    editor.type('h');
    await vi.advanceTimersByTimeAsync(200);
    editor.type('he');
    expect(c.store.getState().save).toBe('pending');
    await vi.advanceTimersByTimeAsync(399);
    expect(saves(fake)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(saves(fake)).toHaveLength(1);
    expect(savedText(fake, 0)).toContain('"he"');
    expect(c.store.getState()).toMatchObject({ revision: 1, save: 'saved' });
  });

  it('edits during a save cause exactly one follow-up save with one request in flight', async () => {
    const { fake, opened } = await setup();
    let release: () => void = () => {};
    let inFlight = 0;
    let maxInFlight = 0;
    const slow: InfinityBridge = {
      ...fake.bridge,
      note: {
        ...fake.bridge.note,
        save: async (req) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          if (saves(fake).length === 0) await new Promise<void>((r) => (release = r));
          const res = await fake.bridge.note.save(req);
          inFlight -= 1;
          return res;
        },
      },
    };
    const { c, editor } = await opened(slow);
    editor.type('one');
    await vi.advanceTimersByTimeAsync(400);
    expect(c.store.getState().save).toBe('saving');
    editor.type('one two');
    editor.type('one two three');
    await vi.advanceTimersByTimeAsync(400);
    release();
    expect(await c.flush()).toEqual({ ok: true });
    expect(saves(fake)).toHaveLength(2);
    expect(maxInFlight).toBe(1);
    expect(savedText(fake, 1)).toContain('one two three');
    expect(c.store.getState().revision).toBe(2);
  });

  it('flush sends at once (the editor calls it on blur) and resolves after the ack', async () => {
    const { fake, opened } = await setup();
    const { c, editor } = await opened();
    editor.type('flush me');
    expect(await c.flush()).toEqual({ ok: true });
    expect(saves(fake)).toHaveLength(1);
    expect(c.store.getState()).toMatchObject({ revision: 1, save: 'saved' });
  });

  it('flush waits for image imports, then saves the finished content', async () => {
    const { fake, opened } = await setup();
    const { c, editor } = await opened();
    editor.type('with image uploading');
    editor.uploads = 1;
    let done = false;
    const flushed = c.flush().then((r) => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(done).toBe(false);
    editor.finishUploads('with image done');
    expect(await flushed).toEqual({ ok: true });
    expect(savedText(fake, saves(fake).length - 1)).toContain('with image done');
    expect(c.store.getState().save).toBe('saved');
  });

  it('INTERNAL is retried 3 times at 1 s with one request id, then the save fails and stays dirty', async () => {
    const { fake, opened } = await setup();
    const { c, editor } = await opened();
    fake.failNext('note:save', { code: 'INTERNAL', message: 'Something went wrong' }, 4);
    editor.type('x');
    const flushed = c.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.store.getState().save).toBe('retrying');
    await vi.advanceTimersByTimeAsync(3000);
    expect(await flushed).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(saves(fake)).toHaveLength(4);
    expect(new Set(saves(fake).map((s) => (s.req as { requestId: string }).requestId)).size).toBe(1);
    expect(c.store.getState().save).toBe('error');
    // Still dirty: the next flush sends the same text again.
    expect(await c.flush()).toEqual({ ok: true });
    expect(savedText(fake, 4)).toContain('"x"');
  });

  it('LIMIT_EXCEEDED and VALIDATION_FAILED keep the content dirty with the message', async () => {
    const { fake, opened } = await setup();
    const { c, editor } = await opened();
    fake.failNext('note:save', { code: 'LIMIT_EXCEEDED', message: 'This note is too large to save (over 5 MB). Remove some content to keep editing safely.' });
    editor.type('big');
    expect(await c.flush()).toMatchObject({ ok: false, code: 'LIMIT_EXCEEDED' });
    expect(c.store.getState()).toMatchObject({ save: 'error', message: 'This note is too large to save (over 5 MB). Remove some content to keep editing safely.' });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.failNext('note:save', { code: 'VALIDATION_FAILED', message: 'This note contains content that cannot be saved' });
    expect(await c.flush()).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(c.store.getState()).toMatchObject({ save: 'error', message: SAVE_FAILED });
    expect(error).toHaveBeenCalled();
    expect(await c.flush()).toEqual({ ok: true });
    expect(saves(fake)).toHaveLength(3);
  });

  it('dispose flushes, then releases the lease, once', async () => {
    const { fake, opened } = await setup();
    const { c, editor } = await opened();
    editor.type('bye');
    await c.dispose();
    const order = fake.calls.map((x) => x.channel).filter((ch) => ch === 'note:save' || ch === 'lease:release');
    expect(order).toEqual(['note:save', 'lease:release']);
    await c.dispose();
    expect(fake.callsTo('lease:release')).toHaveLength(1);
  });

  it('rename is debounced, validated and does not use a save', async () => {
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
    expect(saves(fake)).toHaveLength(0);
  });

  it('a content error shows the message and releases the lease without saving', async () => {
    const { fake, opened } = await setup();
    const { c } = await opened();
    c.contentError();
    expect(c.store.getState()).toMatchObject({ status: 'error', message: CONTENT_ERROR });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsTo('lease:release')).toHaveLength(1);
    expect(saves(fake)).toHaveLength(0);
  });

  it('a trashed note opens as trashed, a missing one as missing', async () => {
    const { fake, make, note } = await setup();
    const trashed = await fake.bridge.note.trash({ noteId: note.id });
    if (!trashed.ok) throw new Error('trash');
    const c = make();
    await c.open();
    expect(c.store.getState()).toMatchObject({ status: 'trashed', trashBatchId: trashed.data.trashBatchId });
    expect(fake.callsTo('lease:acquire')).toHaveLength(0);
    fake.data.notes.length = 0;
    const gone = make();
    await gone.open();
    expect(gone.store.getState().status).toBe('missing');
  });
});

describe('NoteController: conflicts and leases (INF-SAVE-03, INF-SAVE-04)', () => {
  it('a stale save reloads the stored content and shows the conflict with its draft', async () => {
    const { fake, opened, stored } = await setup();
    const { c, editor } = await opened();
    // Another writer saved in the meantime.
    Object.assign(stored(), { revision: 3, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'theirs' }] }] } });
    editor.type('mine');
    const result = await c.flush();
    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
    const draftId = fake.data.drafts[0]!.id;
    expect(c.store.getState()).toMatchObject({ status: 'ready', revision: 3, contentKey: 2, save: 'saved', conflict: { draftId, reason: 'stale' } });
    expect(JSON.stringify(c.store.getState().content)).toContain('theirs');
    expect(c.store.getState().drafts.map((d) => d.id)).toEqual([draftId]);
  });

  it('typing during a refused save is submitted once more before the reload, so it becomes a draft too', async () => {
    const { fake, opened, stored } = await setup();
    let release: () => void = () => {};
    const slow: InfinityBridge = {
      ...fake.bridge,
      note: {
        ...fake.bridge.note,
        save: async (req) => {
          if (saves(fake).length === 0) await new Promise<void>((r) => (release = r));
          return fake.bridge.note.save(req);
        },
      },
    };
    const { c, editor } = await opened(slow);
    stored().revision = 5;
    editor.type('first');
    const flushed = c.flush();
    await vi.advanceTimersByTimeAsync(0);
    editor.type('first and more');
    release();
    await flushed;
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.data.drafts.map((d) => JSON.stringify(d.content))).toEqual([expect.stringContaining('"first"'), expect.stringContaining('first and more')]);
    const secondRequest = saves(fake)[1]!.req as { baseRevision: number; requestId: string };
    expect(secondRequest.baseRevision).toBe(0);
    expect(c.store.getState().conflict).toEqual({ draftId: fake.data.drafts[1]!.id, reason: 'stale' });
  });

  it('a lost lease makes the note read-only with the lease-lost draft; edits are not sent', async () => {
    const { fake, opened } = await setup();
    const { c, editor } = await opened();
    fake.data.leases.set(c.noteId, 'someone-else');
    editor.type('late words');
    expect(await c.flush()).toMatchObject({ ok: false, code: 'LEASE_REQUIRED' });
    const draftId = fake.data.drafts[0]!.id;
    expect(c.store.getState()).toMatchObject({ status: 'readOnly', readOnlyReason: 'leaseLost', conflict: { draftId, reason: 'lease_lost' } });
    editor.type('ignored');
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves(fake)).toHaveLength(1);
  });

  it('a save to a note trashed meanwhile reports the trashed conflict and keeps the draft', async () => {
    const { fake, opened, note } = await setup();
    const { c, editor } = await opened();
    editor.type('pending');
    await fake.bridge.note.trash({ noteId: note.id });
    expect(await c.flush()).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'trashed' } });
    expect(c.store.getState().status).toBe('trashed');
    expect(fake.data.drafts).toHaveLength(1);
  });

  it('a lease held elsewhere opens read-only; take edit control flushes the holder and reloads', async () => {
    const { fake, make } = await setup();
    const held: InfinityBridge = {
      ...fake.bridge,
      lease: { ...fake.bridge.lease, acquire: async () => ({ ok: true, data: { granted: false, holderViewId: OTHER_VIEW } }) },
    };
    const c = make(held);
    await c.open();
    expect(c.store.getState()).toMatchObject({ status: 'readOnly', readOnlyReason: 'lease', holderElsewhere: true });
    const editor = new TestSource(c);
    editor.type('not allowed');
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves(fake)).toHaveLength(0);
    expect(await c.restoreDraft(OTHER_VIEW)).toEqual({ ok: false, message: TAKE_CONTROL_FIRST });

    const taking = c.takeEditControl();
    expect(c.store.getState().busy).toBe('take');
    expect(await taking).toEqual({ ok: true });
    expect(c.store.getState()).toMatchObject({ status: 'ready', readOnlyReason: null, holderElsewhere: false, busy: null, contentKey: 2 });
    editor.type('mine now');
    expect(await c.flush()).toEqual({ ok: true });
    expect(saves(fake)).toHaveLength(1);
  });

  it('a release request flushes pending edits, releases and turns read-only', async () => {
    const { fake, opened } = await setup();
    const { c, editor } = await opened();
    editor.type('handing over');
    await c.onReleaseRequest();
    expect(fake.calls.map((x) => x.channel).filter((ch) => ch === 'note:save' || ch === 'lease:release')).toEqual(['note:save', 'lease:release']);
    expect(c.store.getState()).toMatchObject({ status: 'readOnly', readOnlyReason: 'lease', holderElsewhere: true });
  });

  it('revision events from another view reload read-only and idle editors; own and busy ones are ignored', async () => {
    const { fake, opened, stored } = await setup();
    const { c, editor } = await opened();
    c.onRevision({ noteId: c.noteId, revision: 1, sourceViewId: VIEW });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.store.getState().contentKey).toBe(1);
    Object.assign(stored(), { revision: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'from other' }] }] } });
    c.onRevision({ noteId: c.noteId, revision: 1, sourceViewId: OTHER_VIEW });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.store.getState()).toMatchObject({ contentKey: 2, revision: 1 });
    expect(JSON.stringify(c.store.getState().content)).toContain('from other');
    // While edits are pending the event is ignored: the next save conflicts and keeps a draft instead.
    editor.type('typing');
    c.onRevision({ noteId: c.noteId, revision: 2, sourceViewId: OTHER_VIEW });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.store.getState().contentKey).toBe(2);
    c.onRevision({ noteId: 'another-note', revision: 9, sourceViewId: OTHER_VIEW });
    expect(fake.callsTo('note:open')).toHaveLength(2);
  });

  it('lease events track whether another view holds the note', async () => {
    const { opened } = await setup();
    const { c } = await opened();
    c.onLease({ noteId: c.noteId, holderViewId: OTHER_VIEW });
    expect(c.store.getState().holderElsewhere).toBe(true);
    c.onLease({ noteId: c.noteId, holderViewId: null });
    expect(c.store.getState().holderElsewhere).toBe(false);
    c.onLease({ noteId: c.noteId, holderViewId: VIEW });
    expect(c.store.getState().holderElsewhere).toBe(false);
  });
});

describe('NoteController: conversion, versions and drafts (INF-EDIT-05, INF-SAVE-06)', () => {
  it('convert to plain text flushes first, applies the result and offers the formatted version back', async () => {
    const { fake, opened } = await setup();
    const { c, editor } = await opened();
    editor.type('Plan');
    expect(await c.convert('plain')).toEqual({ ok: true });
    const convertReq = fake.callsTo('note:convertFormat')[0]!.req as { confirmLossy?: boolean; baseRevision: number };
    expect(convertReq).toMatchObject({ confirmLossy: true, baseRevision: 1 });
    const versionId = fake.data.versions[0]!.id;
    expect(c.store.getState()).toMatchObject({ format: 'plain', content: 'Plan', revision: 2, contentKey: 2, converted: { versionId } });
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

  it('a failed flush stops the conversion', async () => {
    const { fake, opened } = await setup();
    const { c, editor } = await opened();
    fake.failNext('note:save', { code: 'LIMIT_EXCEEDED', message: 'too big' });
    editor.type('x');
    expect(await c.convert('plain')).toEqual({ ok: false, message: 'too big' });
    expect(fake.callsTo('note:convertFormat')).toHaveLength(0);
  });

  it('restore draft applies it and refreshes; dismiss resolves it', async () => {
    const { fake, opened, stored } = await setup();
    const { c, editor } = await opened();
    stored().revision = 1;
    editor.type('my lost words');
    await c.flush();
    const draftId = c.store.getState().conflict!.draftId;
    expect(await c.restoreDraft(draftId)).toEqual({ ok: true });
    expect(c.store.getState()).toMatchObject({ conflict: null, drafts: [], revision: 2 });
    expect(JSON.stringify(c.store.getState().content)).toContain('my lost words');
    expect(fake.data.versions.map((v) => v.reason)).toEqual(['conflict']);

    stored().revision = 7;
    editor.type('another');
    await c.flush();
    const second = c.store.getState().conflict!.draftId;
    expect(await c.dismissDraft(second)).toEqual({ ok: true });
    expect(c.store.getState()).toMatchObject({ conflict: null, drafts: [] });
  });
});

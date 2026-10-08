import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InfinityBridge } from '../../../../src/shared/contracts/bridge';
import { NoteController, READONLY_CHANGED, READONLY_ELSEWHERE } from '../../../../src/renderer/notes/note-controller';
import { realTimers } from '../../../../src/renderer/state/store';
import { createFakeBridge, type FakeBridge } from '../support/fake-bridge';

let n = 0;
const uuid = () => `11111111-1111-4111-8111-${String(++n).padStart(12, '0')}`;
const VIEW = '22222222-2222-4222-8222-222222222222';

async function setup(opts: { content?: unknown; sticky?: boolean } = {}) {
  const fake = createFakeBridge();
  const created = await fake.bridge.note.create({ location: { projectId: null, folderId: null }, sticky: false, title: 'T' });
  if (!created.ok) throw new Error('create');
  const note = created.data.note;
  if (opts.content) fake.data.notes.find((x) => x.id === note.id)!.content = opts.content;
  const make = (bridge: InfinityBridge = fake.bridge) => new NoteController({ bridge, noteId: note.id, viewId: VIEW, timers: realTimers, uuid });
  return { fake, note, make };
}

const saves = (fake: FakeBridge) => fake.callsTo('note:save');
const contentOf = (fake: FakeBridge, id: string) => fake.data.notes.find((x) => x.id === id)!.content;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('NoteController', () => {
  it('opens a note, takes the lease and exposes text and revision', async () => {
    const { fake, make, note } = await setup();
    const c = make();
    await c.open();
    expect(c.store.getState()).toMatchObject({ status: 'ready', text: '', revision: 0, save: 'saved', title: 'T' });
    expect(fake.callsTo('lease:acquire')).toHaveLength(1);
    expect(c.store.getState().note?.id).toBe(note.id);
  });

  it('debounces typing by 400 ms into a single save', async () => {
    const { fake, make } = await setup();
    const c = make();
    await c.open();
    c.setText('h');
    await vi.advanceTimersByTimeAsync(200);
    c.setText('he');
    await vi.advanceTimersByTimeAsync(399);
    expect(saves(fake)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(saves(fake)).toHaveLength(1);
    expect(c.store.getState()).toMatchObject({ revision: 1, save: 'saved' });
    expect(JSON.stringify(contentOf(fake, c.noteId))).toContain('he');
  });

  it('typing during a save queues exactly one follow-up and keeps one request in flight', async () => {
    const { fake, make } = await setup();
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
    const c = make(slow);
    await c.open();
    c.setText('one');
    await vi.advanceTimersByTimeAsync(400);
    expect(c.store.getState().save).toBe('saving');
    c.setText('one two');
    c.setText('one two three');
    await vi.advanceTimersByTimeAsync(400);
    release();
    await vi.advanceTimersByTimeAsync(0);
    const flushed = await c.flush();
    expect(flushed).toEqual({ ok: true });
    expect(saves(fake)).toHaveLength(2);
    expect(maxInFlight).toBe(1);
    expect(c.store.getState().revision).toBe(2);
    expect(JSON.stringify(contentOf(fake, c.noteId))).toContain('one two three');
  });

  it('reports a pending save state as soon as text changes, never Saved', async () => {
    const { make } = await setup();
    const c = make();
    await c.open();
    expect(c.store.getState().save).toBe('saved');
    c.setText('a');
    expect(c.store.getState().save).toBe('pending');
    await c.flush();
    expect(c.store.getState().save).toBe('saved');
  });

  it('flush() sends pending text immediately and resolves after the ack', async () => {
    const { fake, make } = await setup();
    const c = make();
    await c.open();
    c.setText('flush me');
    expect(saves(fake)).toHaveLength(0);
    expect(await c.flush()).toEqual({ ok: true });
    expect(saves(fake)).toHaveLength(1);
    expect(c.store.getState()).toMatchObject({ revision: 1, save: 'saved' });
  });

  it('retries INTERNAL failures 3 times at 1 s, then reports an error and flush fails', async () => {
    const { fake, make } = await setup();
    const c = make();
    await c.open();
    fake.failNext('note:save', { code: 'INTERNAL', message: 'Something went wrong' }, 4);
    c.setText('x');
    const flushed = c.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.store.getState().save).toBe('retrying');
    await vi.advanceTimersByTimeAsync(3000);
    const result = await flushed;
    expect(result).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(saves(fake)).toHaveLength(4);
    expect(c.store.getState().save).toBe('error');
    // the retries reuse one request id
    expect(new Set(saves(fake).map((s) => (s.req as { requestId: string }).requestId)).size).toBe(1);
  });

  it('recovers when a retry succeeds', async () => {
    const { fake, make } = await setup();
    const c = make();
    await c.open();
    fake.failNext('note:save', { code: 'INTERNAL' }, 2);
    c.setText('x');
    const flushed = c.flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await flushed).toEqual({ ok: true });
    expect(c.store.getState()).toMatchObject({ save: 'saved', revision: 1 });
  });

  it('CONFLICT and LEASE_REQUIRED make the note read-only with the recovered-draft message', async () => {
    for (const code of ['CONFLICT', 'LEASE_REQUIRED'] as const) {
      const { fake, make } = await setup();
      const c = make();
      await c.open();
      fake.failNext('note:save', { code });
      c.setText('x');
      const result = await c.flush();
      expect(result).toMatchObject({ ok: false, code });
      expect(c.store.getState()).toMatchObject({ status: 'readOnly', message: READONLY_CHANGED });
      c.setText('ignored');
      expect(saves(fake)).toHaveLength(1);
    }
  });

  it('dispose flushes, then releases the lease', async () => {
    const { fake, make } = await setup();
    const c = make();
    await c.open();
    c.setText('bye');
    await c.dispose();
    const order = fake.calls.map((x) => x.channel).filter((ch) => ch === 'note:save' || ch === 'lease:release');
    expect(order).toEqual(['note:save', 'lease:release']);
    expect(fake.data.leases.size).toBe(0);
    await c.dispose();
    expect(fake.callsTo('lease:release')).toHaveLength(1);
  });

  it('a trashed note opens as trashed with its batch id', async () => {
    const { fake, make, note } = await setup();
    const trashed = await fake.bridge.note.trash({ noteId: note.id });
    if (!trashed.ok) throw new Error('trash');
    const c = make();
    await c.open();
    expect(c.store.getState()).toMatchObject({ status: 'trashed', trashBatchId: trashed.data.trashBatchId });
    expect(fake.callsTo('lease:acquire')).toHaveLength(0);
  });

  it('a missing note opens as missing', async () => {
    const { make, fake } = await setup();
    fake.data.notes.length = 0;
    const c = make();
    await c.open();
    expect(c.store.getState().status).toBe('missing');
  });

  it('an incompatible document opens read-only without acquiring a lease', async () => {
    const heading = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'H' }] }] };
    const { fake, make } = await setup({ content: heading });
    const c = make();
    await c.open();
    expect(c.store.getState().status).toBe('readOnly');
    expect(fake.callsTo('lease:acquire')).toHaveLength(0);
    c.setText('nope');
    expect(await c.flush()).toEqual({ ok: true });
    expect(saves(fake)).toHaveLength(0);
    expect(contentOf(fake, c.noteId)).toEqual(heading);
  });

  it('a lease held elsewhere makes the note read-only with the other-window message', async () => {
    const { fake, make } = await setup();
    const other: InfinityBridge = {
      ...fake.bridge,
      lease: { ...fake.bridge.lease, acquire: async () => ({ ok: true, data: { granted: false, holderViewId: '33333333-3333-4333-8333-333333333333' } }) },
    };
    const c = make(other);
    await c.open();
    expect(c.store.getState()).toMatchObject({ status: 'readOnly', message: READONLY_ELSEWHERE });
  });

  it('rename is debounced, validated and does not use a save', async () => {
    const { fake, make } = await setup();
    const c = make();
    await c.open();
    c.rename('N');
    c.rename('New title');
    await vi.advanceTimersByTimeAsync(399);
    expect(fake.callsTo('note:rename')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.callsTo('note:rename')).toHaveLength(1);
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
});

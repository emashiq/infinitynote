import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotesRepo } from '../../src/main/db/repositories/notes-repo';
import { AppError } from '../../src/main/services/app-error';
import { LeaseManager, type LeaseHolder } from '../../src/main/services/lease-manager';
import { NoteWriter } from '../../src/main/services/note-writer';
import type { NoteLeaseEventType } from '../../src/shared/contracts/notes';
import { fixedClock, openFresh, seqIds } from './helpers';

function mk() {
  const events: NoteLeaseEventType[] = [];
  const releaseRequests: Array<{ holder: LeaseHolder; noteId: string }> = [];
  const leases = new LeaseManager({
    ids: seqIds(),
    clock: fixedClock(),
    requestRelease: (holder, noteId) => releaseRequests.push({ holder, noteId }),
    emit: (e) => events.push(e),
    takeTimeoutMs: 3000,
  });
  return { leases, events, releaseRequests, note: randomUUID(), a: randomUUID(), b: randomUUID() };
}

function granted(r: ReturnType<LeaseManager['acquire']>): string {
  if (!r.granted) throw new Error('not granted');
  return r.leaseToken;
}

describe('writer lease (INF-FND-13)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('grants a free note, refuses a second view, and is idempotent for the holder', () => {
    const m = mk();
    const t1 = granted(m.leases.acquire(m.note, m.a, 1));
    expect(m.leases.acquire(m.note, m.b, 2)).toEqual({ granted: false, holderViewId: m.a });
    expect(granted(m.leases.acquire(m.note, m.a, 1))).toBe(t1);
    expect(m.leases.verify(m.note, m.a, t1, 1)).toBe('ok');
    expect(m.events).toEqual([{ noteId: m.note, holderViewId: m.a }]);
  });

  it('release requires the token and frees the note', () => {
    const m = mk();
    const t1 = granted(m.leases.acquire(m.note, m.a, 1));
    expect(m.leases.release(m.note, m.a, randomUUID(), 1)).toEqual({ released: false });
    expect(m.leases.release(m.note, m.a, t1, 1)).toEqual({ released: true });
    expect(m.leases.verify(m.note, m.a, t1, 1)).toBe('lost');
    expect(m.events.at(-1)).toEqual({ noteId: m.note, holderViewId: null });
  });

  it('take with a cooperating holder grants a new token and the old one is lost', async () => {
    const m = mk();
    const t1 = granted(m.leases.acquire(m.note, m.a, 1));
    const pending = m.leases.take(m.note, m.b, 2);
    expect(m.releaseRequests).toEqual([{ holder: { viewId: m.a, webContentsId: 1 }, noteId: m.note }]);
    m.leases.release(m.note, m.a, t1, 1);
    const { leaseToken } = await pending;
    expect(m.leases.verify(m.note, m.b, leaseToken, 2)).toBe('ok');
    expect(m.leases.verify(m.note, m.a, t1, 1)).toBe('lost');
    expect(m.events).toEqual([
      { noteId: m.note, holderViewId: m.a },
      { noteId: m.note, holderViewId: null },
      { noteId: m.note, holderViewId: m.b },
    ]);
  });

  it('take with a silent holder revokes after the timeout', async () => {
    const m = mk();
    const t1 = granted(m.leases.acquire(m.note, m.a, 1));
    const pending = m.leases.take(m.note, m.b, 2);
    await vi.advanceTimersByTimeAsync(2999);
    expect(m.leases.holderOf(m.note)).toBe(m.a);
    await vi.advanceTimersByTimeAsync(2);
    const { leaseToken } = await pending;
    expect(m.leases.verify(m.note, m.b, leaseToken, 2)).toBe('ok');
    expect(m.leases.verify(m.note, m.a, t1, 1)).toBe('lost');
    expect(m.leases.isRevoked(t1)).toBe(true);
  });

  it('a concurrent second take gives CONFLICT', async () => {
    const m = mk();
    granted(m.leases.acquire(m.note, m.a, 1));
    const first = m.leases.take(m.note, m.b, 2);
    const other = randomUUID();
    await expect(m.leases.take(m.note, other, 3)).rejects.toMatchObject({ code: 'CONFLICT' });
    await vi.advanceTimersByTimeAsync(3001);
    await first;
  });

  it('take on a free note or by the holder resolves immediately', async () => {
    const m = mk();
    const free = await m.leases.take(m.note, m.a, 1);
    expect(m.leases.verify(m.note, m.a, free.leaseToken, 1)).toBe('ok');
    expect((await m.leases.take(m.note, m.a, 1)).leaseToken).toBe(free.leaseToken);
  });

  it('webContentsDestroyed frees the lease and resolves a pending take', async () => {
    const m = mk();
    const t1 = granted(m.leases.acquire(m.note, m.a, 1));
    const pending = m.leases.take(m.note, m.b, 2);
    m.leases.webContentsDestroyed(1);
    const { leaseToken } = await pending;
    expect(m.leases.verify(m.note, m.b, leaseToken, 2)).toBe('ok');
    expect(m.leases.verify(m.note, m.a, t1, 1)).toBe('lost');
    // the destroyed view binding is gone, so the id can be reused by another webContents
    expect(m.leases.acquire(randomUUID(), m.a, 9).granted).toBe(true);
  });

  it('a viewId reused from another webContents is FORBIDDEN', () => {
    const m = mk();
    const t1 = granted(m.leases.acquire(m.note, m.a, 1));
    expect(m.leases.verify(m.note, m.a, t1, 2)).toBe('forbidden');
    expect(() => m.leases.acquire(randomUUID(), m.a, 2)).toThrow(AppError);
    expect(() => m.leases.release(m.note, m.a, t1, 2)).toThrow(/another window/);
    return expect(m.leases.take(randomUUID(), m.a, 2)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('lease and save integration', () => {
  it('a save with a revoked token gives LEASE_REQUIRED plus a lease_lost draft', async () => {
    vi.useRealTimers();
    const t = await openFresh();
    const clock = fixedClock();
    const ids = seqIds();
    const leases = new LeaseManager({ ids, clock, requestRelease: () => {}, emit: () => {}, takeTimeoutMs: 5 });
    const writer = new NoteWriter({ db: t.db, leases, clock, ids, emit: () => {} });
    const noteId = randomUUID();
    new NotesRepo(t.db).createNote({ id: noteId, format: 'plain', contentText: '', now: 1 });
    const a = randomUUID();
    const b = randomUUID();
    const token = granted(leases.acquire(noteId, a, 1));
    await leases.take(noteId, b, 2);
    let caught: AppError | null = null;
    try {
      writer.save(
        { noteId, viewId: a, leaseToken: token, baseRevision: 0, requestId: randomUUID(), format: 'plain', content: 'late edit' },
        { webContentsId: 1 },
      );
    } catch (err) {
      caught = err as AppError;
    }
    expect(caught?.code).toBe('LEASE_REQUIRED');
    expect(caught?.details).toMatchObject({ draftId: expect.any(String) });
    const draft = t.db.prepare<[], { reason: string; content: string }>('SELECT reason, content FROM note_drafts').all();
    expect(draft).toEqual([{ reason: 'lease_lost', content: 'late edit' }]);
    // a forged webContents is rejected with no draft
    const forged = () =>
      writer.save(
        { noteId, viewId: a, leaseToken: token, baseRevision: 0, requestId: randomUUID(), format: 'plain', content: 'spoof' },
        { webContentsId: 99 },
      );
    expect(forged).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(t.db.prepare<[], { n: number }>('SELECT count(*) AS n FROM note_drafts').get()?.n).toBe(1);
  });
});

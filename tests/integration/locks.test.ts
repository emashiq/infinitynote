import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppHandlerDeps } from '../../src/main/ipc/handlers/app-handlers';
import { createFakeOsKeyVerifier, createMemoryKeyProtector } from '../../src/main/locks/os-key';
import { openBetterSqlite } from '../../src/main/db/better-sqlite3-driver';
import { SWEEP_INTERVAL_MS } from '../../src/main/locks/lock-service';
import { createFakePowerEvents } from '../../src/main/services/power-events';
import { LOCK_MESSAGES } from '../../src/shared/contracts/locks';
import { ReminderCreateRequest } from '../../src/shared/contracts/reminders';
import type { RichDocLike } from '../../src/shared/editor/doc-schema';
import { setupServices, type Services } from './hierarchy-helpers';
import { catalogueRouter } from './ipc-helpers';
import { tmpFile } from './portability-helpers';

/** One word (one search token) and a phrase that appear nowhere but in the note being locked. */
const MARKER = 'zebrasecretmarker';
const PHRASE = 'Vault combination 7319';
const PASSWORD = 'correct horse battery';
const P = randomUUID();
const P2 = randomUUID();

const opened: Services[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) {
    s.collab.closeAll();
    s.locks.stop();
  }
});

async function setup() {
  const hello = createFakeOsKeyVerifier();
  const power = createFakePowerEvents();
  const s = await setupServices({ locks: { verifier: hello.verifier, protector: createMemoryKeyProtector(), power } });
  opened.push(s);
  return { s, hello, power };
}

const doc = (...texts: Array<[string, string]>): RichDocLike => ({
  type: 'doc',
  content: texts.map(([id, text]) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] })),
});

function save(s: Services, noteId: string, content: RichDocLike | string) {
  const revision = s.row<{ revision: number }>('SELECT revision FROM notes WHERE id = ?', noteId)!.revision;
  return s.writer.save({ noteId, viewId: randomUUID(), baseRevision: revision, requestId: randomUUID(), format: typeof content === 'string' ? 'plain' : 'rich', content });
}

const lock = (s: Services, noteId: string, password = PASSWORD, hello = false) => s.locks.lock({ noteId, password, hello });

/** A rich note with the marker in two saved revisions, an automatic version, a conflict draft, a reminder source and a dismissal. */
async function secretNote(s: Services) {
  const note = s.note(null, null, 'Bank');
  save(s, note.id, doc([P, `First ${MARKER} draft`], [P2, PHRASE]));
  s.clock.advance(11 * 60_000);
  save(s, note.id, doc([P, `Call ${MARKER} tomorrow`], [P2, PHRASE]));
  // A stale save from another view becomes a conflict draft with the text.
  expect(() => s.writer.save({ noteId: note.id, viewId: randomUUID(), baseRevision: 0, requestId: randomUUID(), format: 'rich', content: doc([P, `Stale ${MARKER}`]) })).toThrow(/changed elsewhere/);
  const reminder = s.reminders.create(
    ReminderCreateRequest.parse({ noteId: note.id, blockId: P, title: 'Call', zoneId: 'Asia/Dhaka', date: '2027-06-01', time: '09:00', recurrence: null, followup: null }),
  );
  s.t.db
    .prepare<[string, string, string, number, number, number]>(
      "INSERT INTO reminder_sources(reminder_id, note_id, block_id, source_text, span_start, span_end, span_ordinal, reference_instant_utc, reference_zone, parser_version, origin, created_at, updated_at) VALUES (?, ?, ?, 'zebrasecretmarker tomorrow', 0, 26, 0, ?, 'Asia/Dhaka', 1, 'suggestion', ?, ?)",
    )
    .run(reminder.id, note.id, P, s.clock.now(), s.clock.now(), s.clock.now());
  s.suggestions.dismiss({ noteId: note.id, blockId: P, text: `${MARKER} tomorrow`, spanOrdinal: 0, referenceDate: '2027-01-15' });
  return { note, reminder };
}

const counts = (s: Services, noteId: string) =>
  Object.fromEntries(
    ['note_versions', 'note_drafts', 'reminder_sources', 'suggestion_dismissals'].map((table) => [table, s.row<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE note_id = ?`, noteId)!.n]),
  );

const searchBody = (s: Services, text: string) => s.search.query({ query: text }).results.map((r) => r.note.id);

/** Every FTS term the index holds (fts5vocab reads the merged index). */
function ftsTerms(s: Services): string[] {
  s.t.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.vocab USING fts5vocab(main, 'notes_fts', 'row')");
  return s.rows<{ term: string }>('SELECT term FROM temp.vocab').map((r) => r.term);
}

function fileBytes(file: string): Buffer {
  return fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
}

describe('locking destroys every plaintext copy (D-112)', () => {
  it('encrypts the content, empties every table and index of the note and leaves no marker in the database or WAL', async () => {
    const { s } = await setup();
    const { note, reminder } = await secretNote(s);
    expect(counts(s, note.id)).toEqual({ note_versions: 1, note_drafts: 1, reminder_sources: 1, suggestion_dismissals: 1 });
    expect(searchBody(s, MARKER)).toEqual([note.id]);
    expect(ftsTerms(s)).toContain(MARKER);
    // The scan below means something: before the lock the files hold the marker.
    expect(Buffer.concat([fileBytes(s.t.dbFile), fileBytes(`${s.t.dbFile}-wal`)]).includes(Buffer.from(MARKER))).toBe(true);

    const status = await lock(s, note.id);
    expect(status).toEqual({ noteId: note.id, locked: true, unlocked: false, hello: false, retryInSeconds: 0 });
    expect(counts(s, note.id)).toEqual({ note_versions: 0, note_drafts: 0, reminder_sources: 0, suggestion_dismissals: 0 });
    expect(s.row('SELECT content_json, content_text, plain_text, locked FROM notes WHERE id = ?', note.id)).toEqual({ content_json: null, content_text: null, plain_text: '', locked: 1 });
    const stored = s.row<{ content: Buffer; password_key: Buffer; kdf: string }>('SELECT content, password_key, kdf FROM note_locks WHERE note_id = ?', note.id)!;
    expect(stored.content.includes(Buffer.from(MARKER))).toBe(false);
    expect(JSON.parse(stored.kdf)).toEqual({ name: 'scrypt', N: 1024, r: 8, p: 1 });
    // The body is out of search; the title still finds it.
    expect(searchBody(s, MARKER)).toEqual([]);
    expect(searchBody(s, 'Vault combination')).toEqual([]);
    expect(searchBody(s, 'Bank')).toEqual([note.id]);
    expect(ftsTerms(s)).not.toContain(MARKER);
    expect(ftsTerms(s)).not.toContain('combination');
    // The reminder stays, without its source text.
    expect(s.reminders.listForNote(note.id).reminders.map((r) => [r.id, r.source])).toEqual([[reminder.id, null]]);

    // Raw bytes: neither the database file nor the WAL holds the text in any form SQLite wrote it.
    const db = fileBytes(s.t.dbFile);
    const wal = fileBytes(`${s.t.dbFile}-wal`);
    expect(wal.length).toBe(0);
    for (const needle of [MARKER, PHRASE, 'combination']) {
      expect(db.includes(Buffer.from(needle, 'utf8')), needle).toBe(false);
      expect(db.includes(Buffer.from(needle, 'utf16le')), needle).toBe(false);
    }
    expect(s.logger.lines.join('\n')).toMatch(/locks: locked note=.* purged versions=1 drafts=1 sources=1 dismissals=1/);
    expect(s.logger.lines.join('\n')).not.toContain(PASSWORD);
  });

  it('refuses a short password, a sticky and a note that is already locked; Trash and purge take the lock with the note', async () => {
    const { s } = await setup();
    const note = s.note(null, null, 'n');
    await expect(lock(s, note.id, 'short')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: LOCK_MESSAGES.tooShort });
    const sticky = s.note(null, null, 'sticky', true);
    await expect(lock(s, sticky.id)).rejects.toMatchObject({ message: LOCK_MESSAGES.sticky });
    await lock(s, note.id);
    await expect(lock(s, note.id)).rejects.toMatchObject({ message: LOCK_MESSAGES.alreadyLocked });
    expect(() => s.stickies.enable(note.id)).toThrow(LOCK_MESSAGES.noFloat);
    const trashed = s.trash.trashNote(note.id);
    s.trash.purge({ target: { kind: 'batch', batchId: trashed.trashBatchId }, confirmed: true });
    expect(s.row('SELECT count(*) AS n FROM note_locks')).toEqual({ n: 0 });
  });
});

describe('a blocked scrub is retried (D-112)', () => {
  it('when another reader keeps the WAL busy, the lock still succeeds and the next sweep or quit empties the WAL', async () => {
    const { s } = await setup();
    const { note } = await secretNote(s);
    // A second connection inside a read transaction pins the WAL, so it cannot be truncated.
    const reader = openBetterSqlite(s.t.dbFile, { readonly: true, fileMustExist: true });
    s.t.db.pragma('busy_timeout = 50');
    try {
      reader.exec('BEGIN');
      reader.prepare('SELECT count(*) FROM notes').get();
      expect(await lock(s, note.id)).toMatchObject({ locked: true });
      expect(s.logger.lines.join('\n')).toMatch(/the WAL could not be emptied after a lock \(busy\); retrying later/);
      expect(fileBytes(`${s.t.dbFile}-wal`).length).toBeGreaterThan(0);
      s.locks.sweep();
      expect(fileBytes(`${s.t.dbFile}-wal`).length).toBeGreaterThan(0);
      reader.exec('COMMIT');
    } finally {
      reader.close();
    }
    s.locks.sweep();
    expect(fileBytes(`${s.t.dbFile}-wal`).length).toBe(0);
    for (const needle of [MARKER, PHRASE]) expect(fileBytes(s.t.dbFile).includes(Buffer.from(needle, 'utf8')), needle).toBe(false);
    // Done: no further retry.
    const warnings = s.logger.lines.filter((l) => l.includes('retrying later')).length;
    s.locks.sweep();
    expect(s.logger.lines.filter((l) => l.includes('retrying later')).length).toBe(warnings);
  });

  it('quitting retries a blocked scrub once more', async () => {
    const { s } = await setup();
    const { note } = await secretNote(s);
    const reader = openBetterSqlite(s.t.dbFile, { readonly: true, fileMustExist: true });
    s.t.db.pragma('busy_timeout = 50');
    reader.exec('BEGIN');
    reader.prepare('SELECT count(*) FROM notes').get();
    await lock(s, note.id);
    reader.exec('COMMIT');
    reader.close();
    expect(fileBytes(`${s.t.dbFile}-wal`).length).toBeGreaterThan(0);
    s.locks.stop();
    expect(fileBytes(`${s.t.dbFile}-wal`).length).toBe(0);
  });
});

describe('unlocking and editing a locked note (D-111)', () => {
  it('is FORBIDDEN while locked; after the password it reads, saves only ciphertext and keeps no versions', async () => {
    const { s } = await setup();
    const { note } = await secretNote(s);
    await lock(s, note.id);
    for (const read of [() => s.reader.open(note.id), () => s.collab.join(note.id, randomUUID(), 1)]) {
      expect(read).toThrow(expect.objectContaining({ code: 'FORBIDDEN', details: { locked: true } }));
    }
    expect(() => save(s, note.id, doc([P, 'overwrite']))).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));

    expect(await s.locks.unlock({ noteId: note.id, password: PASSWORD })).toMatchObject({ locked: true, unlocked: true });
    const open = s.reader.open(note.id);
    expect(open.note.locked).toBe(true);
    expect(JSON.stringify(open.content)).toContain(`Call ${MARKER} tomorrow`);
    for (let i = 0; i < 3; i += 1) {
      s.clock.advance(11 * 60_000);
      save(s, note.id, doc([P, `Edited ${i} ${MARKER}`], [P2, PHRASE]));
    }
    expect(counts(s, note.id).note_versions).toBe(0);
    expect(s.versions.list(note.id).versions).toEqual([]);
    expect(s.row('SELECT content_json, plain_text FROM notes WHERE id = ?', note.id)).toEqual({ content_json: null, plain_text: '' });
    expect(JSON.stringify(s.reader.open(note.id).content)).toContain(`Edited 2 ${MARKER}`);
    // Saves of a locked note never reach the search index.
    expect(searchBody(s, 'Edited')).toEqual([]);

    // Live sync works on the decrypted document and saves ciphertext.
    const viewId = randomUUID();
    const snap = s.collab.join(note.id, viewId, 1);
    expect(JSON.stringify(snap.doc)).toContain('Edited 2');
    expect(s.collab.leave(note.id, viewId, 1)).toEqual({ left: true });

    // After a restart nothing is unlocked.
    s.locks.stop();
    expect(() => s.reader.open(note.id)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('answers a wrong password generically and makes repeated failures wait', async () => {
    const { s } = await setup();
    const note = s.note(null, null, 'n');
    save(s, note.id, doc([P, 'body']));
    await lock(s, note.id);
    const wrong = () => s.locks.unlock({ noteId: note.id, password: 'not the password' });
    for (let i = 0; i < 2; i += 1) await expect(wrong()).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: LOCK_MESSAGES.wrongPassword });
    await expect(wrong()).rejects.toMatchObject({ details: { wrongPassword: true, retryInSeconds: 1 } });
    await expect(s.locks.unlock({ noteId: note.id, password: PASSWORD })).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED', message: LOCK_MESSAGES.wait(1) });
    expect(s.locks.status(note.id).retryInSeconds).toBe(1);
    s.clock.advance(1000);
    await expect(wrong()).rejects.toMatchObject({ details: { retryInSeconds: 2 } });
    s.clock.advance(2000);
    expect(await s.locks.unlock({ noteId: note.id, password: PASSWORD })).toMatchObject({ unlocked: true, retryInSeconds: 0 });
    expect(s.logger.lines.join('\n')).not.toContain('not the password');
  });

  it("live sync never logs a locked note's text: a decrypted document the editor schema refuses is logged without details", async () => {
    const { s } = await setup();
    const note = s.note(null, null, 'n');
    save(s, note.id, doc([P, 'body']));
    await lock(s, note.id);
    await s.locks.unlock({ noteId: note.id, password: PASSWORD });
    // Stored content that the schema gate accepts but ProseMirror rejects with a message quoting the text (a list item
    // must start with a paragraph): "Invalid content for node listItem: <codeBlock(...)>".
    const listItem = { type: 'listItem', attrs: { id: randomUUID() }, content: [{ type: 'codeBlock', content: [{ type: 'text', text: PHRASE }] }] };
    save(s, note.id, { type: 'doc', content: [{ type: 'bulletList', content: [listItem] }] });
    expect(() => s.collab.join(note.id, randomUUID(), 1)).toThrow(expect.objectContaining({ code: 'INTERNAL' }));
    const log = s.logger.lines.join('\n');
    expect(log).toMatch(/collab: stored note .* does not fit the editor schema \(RangeError; details withheld for a locked note\)/);
    expect(log).not.toContain(PHRASE);
  });

  it('parallel wrong passwords cannot get past the delay: attempts run one at a time and count before they are verified', async () => {
    const { s } = await setup();
    const note = s.note(null, null, 'n');
    save(s, note.id, doc([P, 'body']));
    await lock(s, note.id);
    const outcomes = await Promise.allSettled(Array.from({ length: 10 }, () => s.locks.unlock({ noteId: note.id, password: 'not the password' })));
    const codes = outcomes.map((o) => (o.status === 'rejected' ? (o.reason as { code: string }).code : 'unlocked'));
    // Three free attempts are verified; every later one waits, as if they had been sent one after another.
    expect(codes).toEqual([...Array(3).fill('VALIDATION_FAILED'), ...Array(7).fill('LIMIT_EXCEEDED')]);
    // Even the right password, sent alongside, waits behind them.
    const [right] = await Promise.allSettled([s.locks.unlock({ noteId: note.id, password: PASSWORD }), s.locks.unlock({ noteId: note.id, password: 'nope again' })]);
    expect(right).toMatchObject({ status: 'rejected', reason: { code: 'LIMIT_EXCEEDED' } });
    s.clock.advance(1000);
    expect(await s.locks.unlock({ noteId: note.id, password: PASSWORD })).toMatchObject({ unlocked: true, retryInSeconds: 0 });
  });

  it('seals conflict drafts of a locked note and opens them while it is unlocked', async () => {
    const { s } = await setup();
    const note = s.note(null, null, 'n');
    save(s, note.id, doc([P, 'base']));
    await lock(s, note.id);
    await s.locks.unlock({ noteId: note.id, password: PASSWORD });
    save(s, note.id, doc([P, 'current']));
    expect(() => s.writer.save({ noteId: note.id, viewId: randomUUID(), baseRevision: 0, requestId: randomUUID(), format: 'rich', content: doc([P, `draft ${MARKER}`]), title: 'New title' })).toThrow(/changed elsewhere/);
    const draft = s.row<{ content: string; title: string | null }>('SELECT content, title FROM note_drafts WHERE note_id = ?', note.id)!;
    expect(draft.content.startsWith('sealed:')).toBe(true);
    expect(draft.content).not.toContain(MARKER);
    expect(draft.title).toBeNull();
    expect(s.drafts.list(note.id).drafts.map((d) => d.plainText)).toEqual([`draft ${MARKER}`]);
    s.locks.lockNow(note.id);
    expect(() => s.drafts.list(note.id)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('refuses conversion, reminders from text and suggestion dismissals; a reminder on a block works while unlocked', async () => {
    const { s } = await setup();
    const note = s.note(null, null, 'n');
    save(s, note.id, doc([P, 'Pay rent tomorrow']));
    await lock(s, note.id);
    await s.locks.unlock({ noteId: note.id, password: PASSWORD });
    const revision = s.row<{ revision: number }>('SELECT revision FROM notes WHERE id = ?', note.id)!.revision;
    expect(() => s.formats.convert({ noteId: note.id, viewId: randomUUID(), baseRevision: revision, requestId: randomUUID(), targetFormat: 'plain', confirmLossy: true })).toThrow(LOCK_MESSAGES.noConvert);
    expect(() => s.suggestions.dismiss({ noteId: note.id, blockId: P, text: 'tomorrow', spanOrdinal: 0, referenceDate: '2027-01-15' })).toThrow(LOCK_MESSAGES.noSuggestions);
    const reminder = s.reminders.create(
      ReminderCreateRequest.parse({ noteId: note.id, blockId: P, title: 'Rent', zoneId: 'Asia/Dhaka', date: '2027-06-01', time: '09:00', recurrence: null, followup: null }),
    );
    expect(reminder.blockId).toBe(P);
  });
});

describe('locking again (D-111)', () => {
  it('Lock now, Lock all, the idle timeout, screen lock and suspend drop the key and close the live session', async () => {
    const { s, power } = await setup();
    const a = s.note(null, null, 'a');
    const b = s.note(null, null, 'b');
    save(s, a.id, doc([P, 'alpha']));
    save(s, b.id, doc([P, 'bravo']));
    await lock(s, a.id);
    await lock(s, b.id);
    const unlockBoth = async () => {
      await s.locks.unlock({ noteId: a.id, password: PASSWORD });
      await s.locks.unlock({ noteId: b.id, password: PASSWORD });
    };
    await unlockBoth();
    s.collab.join(a.id, randomUUID(), 7);
    expect(s.locks.lockNow(a.id)).toMatchObject({ unlocked: false });
    expect(s.collabEvents.filter((e) => e.channel === 'collab:reset' && e.webContentsId === 7)).toHaveLength(1);
    expect(s.collab.documentOf(a.id)).toBeNull();
    expect(s.locks.status(b.id).unlocked).toBe(true);
    expect(s.locks.lockAll()).toBe(1);

    for (const event of ['lock-screen', 'suspend'] as const) {
      await unlockBoth();
      s.locks.start();
      power.emit(event);
      expect([s.locks.status(a.id).unlocked, s.locks.status(b.id).unlocked], event).toEqual([false, false]);
      s.locks.stop();
    }

    // Idle: the setting decides; a note used recently stays unlocked.
    s.settings.set('locks.autoLockMinutes', 1);
    await unlockBoth();
    s.clock.advance(50_000);
    s.reader.open(b.id);
    s.clock.advance(20_000);
    expect(s.locks.sweep()).toBe(1);
    expect([s.locks.status(a.id).unlocked, s.locks.status(b.id).unlocked]).toEqual([false, true]);
    expect(SWEEP_INTERVAL_MS).toBeLessThanOrEqual(60_000);
  });
});

describe('changing a lock (D-111, D-113)', () => {
  it('changes the password (the old one stops working) and removes the lock with it', async () => {
    const { s } = await setup();
    const { note } = await secretNote(s);
    await lock(s, note.id);
    await expect(s.locks.changePassword({ noteId: note.id, currentPassword: 'wrong password', newPassword: 'another long one' })).rejects.toMatchObject({ message: LOCK_MESSAGES.wrongPassword });
    await expect(s.locks.changePassword({ noteId: note.id, currentPassword: PASSWORD, newPassword: 'short' })).rejects.toMatchObject({ message: LOCK_MESSAGES.tooShort });
    await s.locks.changePassword({ noteId: note.id, currentPassword: PASSWORD, newPassword: 'another long one' });
    await expect(s.locks.unlock({ noteId: note.id, password: PASSWORD })).rejects.toMatchObject({ message: LOCK_MESSAGES.wrongPassword });

    await s.locks.remove({ noteId: note.id, password: 'another long one' });
    expect(s.row('SELECT locked, plain_text FROM notes WHERE id = ?', note.id)).toEqual({ locked: 0, plain_text: `Call ${MARKER} tomorrow\n${PHRASE}` });
    expect(searchBody(s, MARKER)).toEqual([note.id]);
    expect(JSON.stringify(s.reader.open(note.id).content)).toContain(`Call ${MARKER} tomorrow`);
    // What locking destroyed stays gone.
    expect(counts(s, note.id)).toEqual({ note_versions: 0, note_drafts: 0, reminder_sources: 0, suggestion_dismissals: 0 });
    expect(s.events.filter((e) => e.reason === 'lock')).toHaveLength(2);
    await expect(s.locks.unlock({ noteId: note.id, password: 'another long one' })).rejects.toMatchObject({ message: LOCK_MESSAGES.notLocked });
  });

  it('opens sealed drafts when the lock is removed', async () => {
    const { s } = await setup();
    const note = s.note(null, null, 'n');
    save(s, note.id, doc([P, 'base']));
    await lock(s, note.id);
    await s.locks.unlock({ noteId: note.id, password: PASSWORD });
    save(s, note.id, doc([P, 'current']));
    expect(() => s.writer.save({ noteId: note.id, viewId: randomUUID(), baseRevision: 0, requestId: randomUUID(), format: 'rich', content: doc([P, 'kept draft']) })).toThrow();
    await s.locks.remove({ noteId: note.id, password: PASSWORD });
    expect(s.row<{ content: string }>('SELECT content FROM note_drafts WHERE note_id = ?', note.id)!.content).toContain('kept draft');
  });

  it('Windows Hello: set up with a verification, unlocks after Verified only, can be turned off; never Hello-only', async () => {
    const { s, hello } = await setup();
    const note = s.note(null, null, 'n');
    save(s, note.id, doc([P, 'hello body']));
    hello.state.availability = { status: 'unavailable', reason: 'Windows Hello is not set up for this Windows account.' };
    await expect(lock(s, note.id, PASSWORD, true)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(s.locks.status(note.id).locked).toBe(false);
    expect(await s.locks.availability()).toEqual({ status: 'unavailable', reason: 'Windows Hello is not set up for this Windows account.' });

    hello.state.availability = { status: 'available' };
    hello.state.answers.push('canceled');
    await expect(lock(s, note.id, PASSWORD, true)).rejects.toMatchObject({ message: LOCK_MESSAGES.helloCanceled });
    expect(await lock(s, note.id, PASSWORD, true)).toMatchObject({ locked: true, hello: true });
    expect(s.row<{ password_key: Buffer | null }>('SELECT password_key FROM note_locks WHERE note_id = ?', note.id)!.password_key).not.toBeNull();

    hello.state.answers.push('canceled', 'timeout', 'failed');
    await expect(s.locks.unlockWithHello(note.id)).rejects.toMatchObject({ code: 'FORBIDDEN', message: LOCK_MESSAGES.helloCanceled });
    await expect(s.locks.unlockWithHello(note.id)).rejects.toMatchObject({ message: LOCK_MESSAGES.helloTimeout });
    await expect(s.locks.unlockWithHello(note.id)).rejects.toMatchObject({ message: LOCK_MESSAGES.helloFailed });
    expect(s.locks.status(note.id).unlocked).toBe(false);
    expect(await s.locks.unlockWithHello(note.id)).toMatchObject({ unlocked: true });
    expect(JSON.stringify(s.reader.open(note.id).content)).toContain('hello body');

    await s.locks.setHello({ noteId: note.id, password: PASSWORD, enabled: false });
    s.locks.lockNow(note.id);
    await expect(s.locks.unlockWithHello(note.id)).rejects.toMatchObject({ message: LOCK_MESSAGES.helloOff });
    const calls = hello.state.calls;
    await s.locks.setHello({ noteId: note.id, password: PASSWORD, enabled: true });
    expect(hello.state.calls).toBe(calls + 1);
    expect(s.locks.status(note.id).hello).toBe(true);
  });

  it('offers no Windows Hello without key protection, and none on a platform without an OS key', async () => {
    const s = await setupServices({ locks: { protector: null } });
    opened.push(s);
    expect((await s.locks.availability()).status).toBe('unsupported');
    const noProtection = await setupServices({ locks: { verifier: createFakeOsKeyVerifier().verifier, protector: null } });
    opened.push(noProtection);
    expect(await noProtection.locks.availability()).toEqual({ status: 'unavailable', reason: 'Windows cannot protect keys for this account right now.' });
  });
});

describe('exports and notifications of locked notes (D-111, D-112)', () => {
  it('the portable export leaves locked notes, their reminders and attachments out; Markdown needs the note unlocked', async () => {
    const { s } = await setup();
    const open = s.note(null, null, 'Open note');
    save(s, open.id, doc([P, 'open text']));
    const { note } = await secretNote(s);
    await lock(s, note.id);
    const file = tmpFile('all.infinityexport');
    s.pathQueue.push(file);
    const res = await s.portability.exportPortable({ webContentsId: 1 });
    expect(res).toMatchObject({ canceled: false, skippedLocked: 1, counts: { notes: 1, reminders: 0 } });
    expect(fs.readFileSync(file).includes(Buffer.from(MARKER))).toBe(false);

    const md = tmpFile('note.md');
    await expect(s.portability.exportNote({ noteId: note.id, format: 'markdown' }, { webContentsId: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN', message: LOCK_MESSAGES.exportLocked });
    await s.locks.unlock({ noteId: note.id, password: PASSWORD });
    s.pathQueue.push(md);
    await s.portability.exportNote({ noteId: note.id, format: 'markdown' }, { webContentsId: 1 });
    expect(fs.readFileSync(md, 'utf8')).toContain(`Call ${MARKER} tomorrow`);
  });

  it('references into a locked note show the note without the block text, and backlinks from it show no context', async () => {
    const { s } = await setup();
    const target = s.note(null, null, 'Target');
    save(s, target.id, doc([P, 'secret block']));
    const source = s.note(null, null, 'Source');
    save(s, source.id, {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { id: P2 }, content: [{ type: 'text', text: 'see ' }, { type: 'noteRef', attrs: { noteId: target.id, blockId: P, label: 'Target', excerpt: null } }] }],
    });
    expect(s.references.list(source.id).outgoing[0]).toMatchObject({ state: 'ok', blockText: 'secret block' });
    await lock(s, target.id);
    expect(s.references.list(source.id).outgoing[0]).toMatchObject({ state: 'ok', blockText: null, title: 'Target' });
    await lock(s, source.id);
    expect(s.references.list(target.id).backlinks[0]).toMatchObject({ sourceNoteId: source.id, context: '' });
  });
});

describe('lock channels (D-111)', () => {
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

  it('validates every request, requires the acknowledgement, answers only main windows and never echoes a password', async () => {
    const { s } = await setup();
    const note = s.note(null, null, 'n');
    save(s, note.id, doc([P, 'body']));
    const r = catalogueRouter(s.services, app, { stickyNoteId: note.id });
    const secret = 'Pa55word-that-must-not-leak';
    expect(await r.call('lock:set', { noteId: note.id, password: secret, hello: false })).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'Invalid request: acknowledged' } });
    expect(await r.call('lock:set', { noteId: note.id, password: secret, hello: false, acknowledged: false })).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(await r.call('lock:set', { noteId: 'not-a-uuid', password: secret, hello: false, acknowledged: true })).toMatchObject({ error: { message: 'Invalid request: noteId' } });
    expect(await r.call('lock:unlock', { noteId: note.id, password: 'x'.repeat(1025) })).toMatchObject({ error: { message: 'Invalid request: password' } });
    expect(await r.call('lock:unlock', { noteId: note.id, password: '' })).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(await r.call('lock:changePassword', { noteId: note.id, currentPassword: secret, newPassword: secret, extra: 1 })).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const sticky = await r.call('lock:unlock', { noteId: note.id, password: secret }, 3);
    expect(sticky).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } });
    expect(await r.call('lock:availability', {}, 4)).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } });

    expect(await r.call('lock:set', { noteId: note.id, password: secret, hello: false, acknowledged: true })).toMatchObject({ ok: true, data: { locked: true, unlocked: false } });
    const wrong = await r.call('lock:unlock', { noteId: note.id, password: `${secret}!` });
    expect(wrong).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED', message: LOCK_MESSAGES.wrongPassword } });
    expect(await r.call('note:open', { noteId: note.id })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', details: { locked: true } } });
    expect(await r.call('lock:unlock', { noteId: note.id, password: secret })).toMatchObject({ ok: true, data: { unlocked: true } });
    expect(await r.call('note:open', { noteId: note.id })).toMatchObject({ ok: true, data: { note: { locked: true } } });
    expect(await r.call('tree:list', {})).toMatchObject({ ok: true, data: { notes: [{ id: note.id, locked: true }] } });
    expect(await r.call('lock:lockAll', {})).toEqual({ ok: true, data: { locked: 1 } });
    expect(await r.call('lock:availability', {})).toEqual({ ok: true, data: { status: 'available', reason: '' } });
    expect(JSON.stringify([wrong, s.logger.lines])).not.toContain(secret);
  });
});

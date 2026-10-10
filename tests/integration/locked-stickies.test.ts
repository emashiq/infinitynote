import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { collab, sendableSteps } from 'prosemirror-collab';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppHandlerDeps } from '../../src/main/ipc/handlers/app-handlers';
import { createFakeOsKeyVerifier, createMemoryKeyProtector } from '../../src/main/locks/os-key';
import { BLUR_CHECK_INTERVAL_MS } from '../../src/main/locks/sticky-locks';
import { createFakePowerEvents } from '../../src/main/services/power-events';
import { LOCK_MESSAGES, PIN_STRIKES } from '../../src/shared/contracts/locks';
import { noteSchema } from '../../src/shared/editor/schema';
import { setupServices, type Services } from './hierarchy-helpers';
import { catalogueRouter } from './ipc-helpers';

const PASSWORD = 'correct horse battery';
const PIN = '4821';
/** A word that appears nowhere but in the locked note's text. */
const MARKER = 'quokkasecretmarker';
/** Window 3 is the sticky window of the note given to catalogueRouter (ipc-helpers). */
const STICKY_WC = 3;

const opened: Services[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) {
    s.stickyLocks.stop();
    s.collab.closeAll();
    s.locks.stop();
  }
});

async function setup() {
  const hello = createFakeOsKeyVerifier();
  const power = createFakePowerEvents();
  const s = await setupServices({ locks: { verifier: hello.verifier, protector: createMemoryKeyProtector(), power } });
  opened.push(s);
  s.stickyLocks.start();
  return { s, hello, power };
}

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

const createLocked = (s: Services, sticky: boolean, pin: string | null = null) =>
  s.locks.create({ location: { projectId: null, folderId: null }, sticky, password: PASSWORD, hello: false, pin });

/** A locked sticky floating in window 3, its key in memory (made locked) and a PIN set. */
async function floatingLockedSticky(s: Services) {
  const { note } = await createLocked(s, true, PIN);
  s.stickyLocks.windowOpened(note.id, STICKY_WC);
  const r = catalogueRouter(s.services, app, { stickyNoteId: note.id });
  return { note, r };
}

/** Types text into the note through live sync from a window, as an editor would. */
function typeInto(s: Services, noteId: string, webContentsId: number, text: string) {
  const viewId = randomUUID();
  const snap = s.collab.join(noteId, viewId, webContentsId);
  const schema = noteSchema(snap.format);
  let state = EditorState.create({ schema, doc: schema.nodeFromJSON(snap.doc), plugins: [collab({ version: snap.version, clientID: viewId })] });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)).insertText(text));
  const sendable = sendableSteps(state)!;
  return s.collab.push({ noteId, viewId, epoch: snap.epoch, version: sendable.version, steps: sendable.steps.map((st) => st.toJSON()) }, webContentsId);
}

const fileBytes = (file: string): Buffer => (fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0));

describe('notes created locked (D-171)', () => {
  it('never stores the content in plaintext: row, versions, drafts, search index, reminder sources and comments', async () => {
    const { s } = await setup();
    const { note } = await createLocked(s, false);
    expect(note).toMatchObject({ locked: true, sticky: false });
    // Created unlocked for this session: the user just typed the password.
    expect(s.locks.status(note.id)).toMatchObject({ locked: true, unlocked: true, pin: false });
    expect(s.row('SELECT content_json, content_text, plain_text, locked FROM notes WHERE id = ?', note.id)).toEqual({ content_json: null, content_text: null, plain_text: '', locked: 1 });

    // Editing and saving it, and a comment on it, keep it sealed.
    expect(typeInto(s, note.id, 1, `Safe ${MARKER} code`)).toMatchObject({ status: 'accepted' });
    s.collab.settle(note.id);
    const { thread } = s.comments.create({ target: { kind: 'note', id: note.id }, anchor: { type: 'text', blockId: null }, quote: MARKER, body: `Remember ${MARKER}` });
    expect(thread.quote).toBe(MARKER);
    s.collab.closeAll();

    expect(s.row('SELECT content_json, content_text, plain_text FROM notes WHERE id = ?', note.id)).toEqual({ content_json: null, content_text: null, plain_text: '' });
    for (const table of ['note_versions', 'note_drafts', 'reminder_sources', 'suggestion_dismissals']) {
      expect(s.row<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE note_id = ?`, note.id)!.n, table).toBe(0);
    }
    expect(s.rows('SELECT quote FROM comment_threads WHERE quote IS NOT NULL')).toEqual([]);
    expect(s.rows('SELECT body FROM comments WHERE body IS NOT NULL')).toEqual([]);
    s.t.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.vocab USING fts5vocab(main, 'notes_fts', 'row')");
    s.t.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.cvocab USING fts5vocab(main, 'comments_fts', 'row')");
    expect(s.rows<{ term: string }>('SELECT term FROM temp.vocab').map((r) => r.term)).not.toContain(MARKER);
    expect(s.rows<{ term: string }>('SELECT term FROM temp.cvocab').map((r) => r.term)).not.toContain(MARKER);
    expect(s.search.query({ query: MARKER }).results).toEqual([]);
    const stored = s.row<{ content: Buffer }>('SELECT content FROM note_locks WHERE note_id = ?', note.id)!;
    expect(stored.content.includes(Buffer.from(MARKER))).toBe(false);
    // The text is readable through the vault only.
    expect(s.reader.open(note.id).note.locked).toBe(true);
    s.t.db.pragma('wal_checkpoint(TRUNCATE)');
    const bytes = Buffer.concat([fileBytes(s.t.dbFile), fileBytes(`${s.t.dbFile}-wal`)]);
    expect(bytes.includes(Buffer.from(MARKER, 'utf8'))).toBe(false);
    expect(bytes.includes(Buffer.from(MARKER, 'utf16le'))).toBe(false);
    expect(s.logger.lines.join('\n')).not.toContain(PASSWORD);
    expect(s.logger.lines.join('\n')).not.toContain(MARKER);
  });

  it('refuses a short password or a bad PIN before anything is written; lock:create is main-window only', async () => {
    const { s } = await setup();
    const before = s.row<{ n: number }>('SELECT count(*) AS n FROM notes')!.n;
    await expect(s.locks.create({ location: { projectId: null, folderId: null }, sticky: false, password: 'short', hello: false })).rejects.toMatchObject({ message: LOCK_MESSAGES.tooShort });
    await expect(createLocked(s, true, '12')).rejects.toMatchObject({ message: LOCK_MESSAGES.pinFormat });
    await expect(createLocked(s, true, '12ab')).rejects.toMatchObject({ message: LOCK_MESSAGES.pinFormat });
    expect(s.row<{ n: number }>('SELECT count(*) AS n FROM notes')!.n).toBe(before);

    const other = s.note(null, null, 'x', true);
    const r = catalogueRouter(s.services, app, { stickyNoteId: other.id });
    const req = { location: { projectId: null, folderId: null }, sticky: false, password: PASSWORD, hello: false, acknowledged: true };
    expect(await r.call('lock:create', req, STICKY_WC)).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } });
    expect(await r.call('lock:create', { ...req, acknowledged: false })).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    const created = await r.call('lock:create', req);
    expect(created).toMatchObject({ ok: true, data: { note: { locked: true, sticky: false } } });
    expect(JSON.stringify(created)).not.toContain(PASSWORD);
  });
});

describe('locked stickies: reveal and blur (D-172)', () => {
  it('a locked note may float; locking a floating sticky keeps it floating and blurred', async () => {
    const { s } = await setup();
    const sticky = s.note(null, null, 'Floating', true);
    s.stickyLocks.windowOpened(sticky.id, STICKY_WC);
    await s.locks.lock({ noteId: sticky.id, password: PASSWORD, hello: false, pin: PIN });
    expect(s.stickies.meta(sticky.id)).toMatchObject({ locked: true });
    expect(s.row('SELECT sticky_enabled FROM notes WHERE id = ?', sticky.id)).toEqual({ sticky_enabled: 1 });
    expect(s.stickyLocks.status(sticky.id, STICKY_WC)).toEqual({
      noteId: sticky.id,
      locked: true,
      revealed: false,
      keyInMemory: false,
      pinSet: true,
      pinBlocked: false,
      hello: false,
      retryInSeconds: 0,
    });
    s.stickies.enable(sticky.id);
  });

  it('withholds the content from a blurred sticky even while the key is in memory, and serves it once revealed', async () => {
    const { s } = await setup();
    const { note, r } = await floatingLockedSticky(s);
    // The main window has the key (the note was made locked); the sticky is still blurred.
    expect(s.locks.status(note.id).unlocked).toBe(true);
    for (const [channel, payload] of [
      ['note:open', { noteId: note.id }],
      ['collab:join', { noteId: note.id, viewId: randomUUID() }],
      ['drafts:list', { noteId: note.id }],
      ['versions:list', { noteId: note.id }],
      ['reminder:listForNote', { noteId: note.id }],
    ] as const) {
      expect(await r.call(channel, payload, STICKY_WC), channel).toEqual({
        ok: false,
        error: { code: 'FORBIDDEN', message: LOCK_MESSAGES.blurred, details: { locked: true, blurred: true } },
      });
    }
    expect(await r.call('note:open', { noteId: note.id })).toMatchObject({ ok: true });

    expect(await r.call('sticky:reveal', { noteId: note.id, with: { kind: 'pin', pin: PIN } }, STICKY_WC)).toMatchObject({ ok: true, data: { revealed: true } });
    expect(await r.call('note:open', { noteId: note.id }, STICKY_WC)).toMatchObject({ ok: true, data: { note: { id: note.id } } });
    expect(await r.call('collab:join', { noteId: note.id, viewId: randomUUID() }, STICKY_WC)).toMatchObject({ ok: true });
    // Another window cannot use the sticky's reveal.
    expect(await r.call('sticky:reveal', { noteId: note.id, with: { kind: 'pin', pin: PIN } }, 1)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(s.stickyLockEvents.at(-1)).toMatchObject({ webContentsId: STICKY_WC, state: { revealed: true } });
  });

  it('blurs after the setting without interaction, saving the edits first; activity moves the blur out', async () => {
    const { s } = await setup();
    const { note, r } = await floatingLockedSticky(s);
    await s.stickyLocks.reveal(note.id, STICKY_WC, { kind: 'pin', pin: PIN });
    expect(typeInto(s, note.id, STICKY_WC, MARKER)).toMatchObject({ status: 'accepted' });

    s.clock.advance(50_000);
    expect(await r.call('sticky:activity', { noteId: note.id }, STICKY_WC)).toEqual({ ok: true, data: {} });
    s.clock.advance(50_000);
    expect(s.stickyLocks.check()).toBe(0);
    s.clock.advance(10_001);
    expect(s.stickyLocks.check()).toBe(1);

    expect(s.stickyLocks.status(note.id, STICKY_WC)).toMatchObject({ revealed: false, keyInMemory: true });
    expect(s.stickyLockEvents.at(-1)).toMatchObject({ webContentsId: STICKY_WC, state: { revealed: false } });
    expect(s.collabEvents.at(-1)).toMatchObject({ webContentsId: STICKY_WC, channel: 'collab:reset' });
    expect(await r.call('collab:join', { noteId: note.id, viewId: randomUUID() }, STICKY_WC)).toMatchObject({ ok: false, error: { details: { blurred: true } } });
    // The text typed before the blur was saved (sealed) and is readable in the main window.
    expect(JSON.stringify(s.reader.open(note.id).content)).toContain(MARKER);
    expect(s.row<{ content_json: string | null }>('SELECT content_json FROM notes WHERE id = ?', note.id)!.content_json).toBeNull();
  });

  it('follows the blur setting, which only takes the offered values', async () => {
    const { s } = await setup();
    expect(s.settings.getInternal('locks.blurStickySeconds')).toBe(60);
    expect(() => s.settings.set('locks.blurStickySeconds', 45 as never)).toThrow();
    expect(() => s.settings.set('locks.blurStickySeconds', '60' as never)).toThrow();
    s.settings.set('locks.blurStickySeconds', 30);
    const { note } = await floatingLockedSticky(s);
    await s.stickyLocks.reveal(note.id, STICKY_WC, { kind: 'pin', pin: PIN });
    s.clock.advance(30_000);
    expect(s.stickyLocks.check()).toBe(1);
    expect(BLUR_CHECK_INTERVAL_MS).toBeLessThanOrEqual(1_000);
  });

  it('blurs at once on Lock now, on screen lock and when the key is dropped; then the PIN is refused and the password is needed', async () => {
    const { s, power } = await setup();
    const { note, r } = await floatingLockedSticky(s);
    await s.stickyLocks.reveal(note.id, STICKY_WC, { kind: 'pin', pin: PIN });
    s.locks.lockNow(note.id);
    expect(s.stickyLocks.status(note.id, STICKY_WC)).toMatchObject({ revealed: false, keyInMemory: false });
    expect(await r.call('sticky:reveal', { noteId: note.id, with: { kind: 'pin', pin: PIN } }, STICKY_WC)).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: LOCK_MESSAGES.pinNeedsKey, details: { needsPassword: true } },
    });
    expect(await r.call('sticky:reveal', { noteId: note.id, with: { kind: 'password', password: 'wrong password' } }, STICKY_WC)).toMatchObject({
      ok: false,
      error: { message: LOCK_MESSAGES.wrongPassword },
    });
    expect(await r.call('sticky:reveal', { noteId: note.id, with: { kind: 'password', password: PASSWORD } }, STICKY_WC)).toMatchObject({ ok: true, data: { revealed: true, keyInMemory: true } });

    s.locks.start();
    power.emit('lock-screen');
    expect(s.stickyLocks.status(note.id, STICKY_WC)).toMatchObject({ revealed: false, keyInMemory: false });
    await s.stickyLocks.reveal(note.id, STICKY_WC, { kind: 'password', password: PASSWORD });
    s.locks.lockAll();
    expect(s.stickyLocks.status(note.id, STICKY_WC).revealed).toBe(false);
  });

  it('reveals with Windows Hello where it is set up', async () => {
    const { s, hello } = await setup();
    const { note } = await s.locks.create({ location: { projectId: null, folderId: null }, sticky: true, password: PASSWORD, hello: true });
    s.stickyLocks.windowOpened(note.id, STICKY_WC);
    s.locks.lockNow(note.id);
    hello.state.answers.push('canceled');
    await expect(s.stickyLocks.reveal(note.id, STICKY_WC, { kind: 'hello' })).rejects.toMatchObject({ message: LOCK_MESSAGES.helloCanceled });
    expect(await s.stickyLocks.reveal(note.id, STICKY_WC, { kind: 'hello' })).toMatchObject({ revealed: true });
  });

  it('a closed window forgets its reveal; a new window starts blurred', async () => {
    const { s } = await setup();
    const { note } = await floatingLockedSticky(s);
    await s.stickyLocks.reveal(note.id, STICKY_WC, { kind: 'pin', pin: PIN });
    s.stickyLocks.windowClosed(note.id, STICKY_WC);
    s.stickyLocks.windowOpened(note.id, 7);
    expect(s.stickyLocks.status(note.id, 7).revealed).toBe(false);
    expect(() => s.stickyLocks.assertRevealed(note.id, 7)).toThrow(LOCK_MESSAGES.blurred);
    expect(() => s.stickyLocks.assertRevealed(note.id, STICKY_WC)).toThrow(LOCK_MESSAGES.blurred);
  });
});

describe('sticky PINs (D-173)', () => {
  it('stores only a scrypt verifier with its own salt, never the PIN or anything that opens the note', async () => {
    const { s } = await setup();
    const { note } = await createLocked(s, true, PIN);
    const row = s.row<{ kdf: string; salt: Buffer; verifier: Buffer }>('SELECT kdf, salt, verifier FROM note_pins WHERE note_id = ?', note.id)!;
    expect(JSON.parse(row.kdf)).toEqual({ name: 'scrypt', N: 1024, r: 8, p: 1 });
    expect(row.salt).toHaveLength(16);
    expect(row.verifier).toHaveLength(32);
    const lock = s.row<{ salt: Buffer; password_key: Buffer }>('SELECT salt, password_key FROM note_locks WHERE note_id = ?', note.id)!;
    expect(row.salt.equals(lock.salt)).toBe(false);
    expect(lock.password_key.includes(row.verifier)).toBe(false);
    expect(s.logger.lines.join('\n')).not.toContain(PIN);
    // The PIN goes with the lock.
    s.stickies.disable(note.id);
    await s.locks.remove({ noteId: note.id, password: PASSWORD });
    expect(s.rows('SELECT note_id FROM note_pins')).toEqual([]);
  });

  it('is set, changed and cleared with the password, from the sticky or the main window', async () => {
    const { s } = await setup();
    const sticky = s.note(null, null, 'S', true);
    await s.locks.lock({ noteId: sticky.id, password: PASSWORD, hello: false });
    s.stickyLocks.windowOpened(sticky.id, STICKY_WC);
    const r = catalogueRouter(s.services, app, { stickyNoteId: sticky.id });
    expect(await r.call('sticky:setPin', { noteId: sticky.id, password: 'not the password', pin: PIN }, STICKY_WC)).toMatchObject({ ok: false, error: { message: LOCK_MESSAGES.wrongPassword } });
    expect(await r.call('sticky:setPin', { noteId: sticky.id, password: PASSWORD, pin: '123' }, STICKY_WC)).toMatchObject({ ok: false, error: { message: LOCK_MESSAGES.pinFormat } });
    expect(await r.call('sticky:setPin', { noteId: sticky.id, password: PASSWORD, pin: PIN }, STICKY_WC)).toMatchObject({ ok: true, data: { pinSet: true } });
    expect(await r.call('lock:setPin', { noteId: sticky.id, password: PASSWORD, pin: '99887766' })).toMatchObject({ ok: true, data: { pin: true } });
    // The sticky window cannot use the main-window channel, nor change another note.
    expect(await r.call('lock:setPin', { noteId: sticky.id, password: PASSWORD, pin: null }, STICKY_WC)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await r.call('sticky:setPin', { noteId: randomUUID(), password: PASSWORD, pin: PIN }, STICKY_WC)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    await s.stickyLocks.reveal(sticky.id, STICKY_WC, { kind: 'password', password: PASSWORD });
    await s.stickyLocks.blur(sticky.id, STICKY_WC);
    await expect(s.stickyLocks.reveal(sticky.id, STICKY_WC, { kind: 'pin', pin: PIN })).rejects.toMatchObject({ message: LOCK_MESSAGES.wrongPin });
    expect(await s.stickyLocks.reveal(sticky.id, STICKY_WC, { kind: 'pin', pin: '99887766' })).toMatchObject({ revealed: true });
    expect(await r.call('lock:setPin', { noteId: sticky.id, password: PASSWORD, pin: null })).toMatchObject({ ok: true, data: { pin: false } });
    s.stickyLocks.blur(sticky.id, STICKY_WC);
    await expect(s.stickyLocks.reveal(sticky.id, STICKY_WC, { kind: 'pin', pin: '99887766' })).rejects.toMatchObject({ message: LOCK_MESSAGES.pinNotSet });
  });

  it('slows wrong PINs down like passwords and needs the password after five in a row', async () => {
    const { s } = await setup();
    const { note } = await floatingLockedSticky(s);
    const tryPin = (pin: string) => s.stickyLocks.reveal(note.id, STICKY_WC, { kind: 'pin', pin });
    await expect(tryPin('0000')).rejects.toMatchObject({ message: LOCK_MESSAGES.wrongPin, details: { retryInSeconds: 0 } });
    await expect(tryPin('0001')).rejects.toMatchObject({ message: LOCK_MESSAGES.wrongPin });
    await expect(tryPin('0002')).rejects.toMatchObject({ message: LOCK_MESSAGES.wrongPin, details: { retryInSeconds: 1 } });
    // Waiting is enforced, even for the right PIN.
    await expect(tryPin(PIN)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED', message: LOCK_MESSAGES.wait(1) });
    s.clock.advance(1_000);
    await expect(tryPin('0003')).rejects.toMatchObject({ message: LOCK_MESSAGES.wrongPin, details: { retryInSeconds: 2 } });
    s.clock.advance(2_000);
    await expect(tryPin('0004')).rejects.toMatchObject({ message: LOCK_MESSAGES.pinStrikes, details: { needsPassword: true } });
    expect(PIN_STRIKES).toBe(5);
    expect(s.stickyLocks.status(note.id, STICKY_WC)).toMatchObject({ pinBlocked: true, keyInMemory: true });
    s.clock.advance(60_000);
    await expect(tryPin(PIN)).rejects.toMatchObject({ code: 'FORBIDDEN', message: LOCK_MESSAGES.pinStrikes });
    // A malformed PIN is refused without counting.
    expect(await s.stickyLocks.reveal(note.id, STICKY_WC, { kind: 'password', password: PASSWORD })).toMatchObject({ revealed: true, pinBlocked: false });
    s.stickyLocks.blur(note.id, STICKY_WC);
    await expect(tryPin('12ab')).rejects.toMatchObject({ message: LOCK_MESSAGES.pinFormat });
    expect(await tryPin(PIN)).toMatchObject({ revealed: true });
  });

  it('runs parallel PIN attempts one at a time, so they meet the same wait', async () => {
    const { s } = await setup();
    const { note } = await floatingLockedSticky(s);
    const results = await Promise.allSettled(['1111', '2222', '3333', '4444', '5555'].map((pin) => s.stickyLocks.reveal(note.id, STICKY_WC, { kind: 'pin', pin })));
    const messages = results.map((r) => (r.status === 'rejected' ? (r.reason as Error).message : 'revealed'));
    expect(messages.slice(0, 3)).toEqual([LOCK_MESSAGES.wrongPin, LOCK_MESSAGES.wrongPin, LOCK_MESSAGES.wrongPin]);
    expect(messages.slice(3)).toEqual([LOCK_MESSAGES.wait(1), LOCK_MESSAGES.wait(1)]);
  });
});

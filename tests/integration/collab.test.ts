import { collab, getVersion, receiveTransaction, sendableSteps } from 'prosemirror-collab';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { Step } from '@tiptap/pm/transform';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { CollabResetEventType, CollabStepsEventType } from '../../src/shared/contracts/collab';
import { noteSchema } from '../../src/shared/editor/schema';
import { docToText } from '../../src/shared/text/textarea-doc';
import { AppError } from '../../src/main/services/app-error';
import { setupServices } from './hierarchy-helpers';

type Services = Awaited<ReturnType<typeof setupServices>>;

const opened: Services[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.collab.closeAll();
});

async function services(): Promise<Services> {
  const s = await setupServices();
  opened.push(s);
  return s;
}

/** A view in a window: an editor state with the collab plugin, talking to the hub like a renderer does. */
class Client {
  readonly viewId = randomUUID();
  state!: EditorState;
  epoch = '';
  resets: CollabResetEventType[] = [];
  private seen = 0;

  constructor(
    private readonly s: Services,
    readonly noteId: string,
    readonly webContentsId: number,
  ) {
    this.join();
  }

  join(): void {
    const snap = this.s.collab.join(this.noteId, this.viewId, this.webContentsId);
    const schema = noteSchema(snap.format);
    this.epoch = snap.epoch;
    this.state = EditorState.create({ schema, doc: schema.nodeFromJSON(snap.doc), plugins: [collab({ version: snap.version, clientID: this.viewId })] });
    this.seen = this.s.collabEvents.length;
  }

  type(text: string, at: 'start' | 'end'): void {
    const pos = at === 'start' ? 1 : this.state.doc.content.size - 1;
    this.state = this.state.apply(this.state.tr.setSelection(TextSelection.create(this.state.doc, pos)).insertText(text));
  }

  /** Sends the unconfirmed steps; returns the hub's answer. */
  push() {
    const sendable = sendableSteps(this.state);
    if (!sendable) return null;
    return this.s.collab.push(
      { noteId: this.noteId, viewId: this.viewId, epoch: this.epoch, version: sendable.version, steps: sendable.steps.map((st) => st.toJSON()) },
      this.webContentsId,
    );
  }

  /** Applies the events main sent to this window since the last call. */
  receive(): void {
    const events = this.s.collabEvents.slice(this.seen).filter((e) => e.webContentsId === this.webContentsId);
    this.seen = this.s.collabEvents.length;
    for (const e of events) {
      if (e.channel === 'collab:reset') this.resets.push(e.payload as CollabResetEventType);
      if (e.channel !== 'collab:steps') continue;
      const ev = e.payload as CollabStepsEventType;
      const skip = getVersion(this.state) - ev.version;
      if (ev.epoch !== this.epoch || skip >= ev.steps.length) continue;
      const steps = ev.steps.slice(skip).map((j) => Step.fromJSON(this.state.schema, j));
      this.state = this.state.apply(receiveTransaction(this.state, steps, ev.clientIDs.slice(skip)));
    }
  }

  /** Pushes until main confirmed everything this view has, receiving what others pushed first. */
  sync(): void {
    for (let i = 0; i < 10 && sendableSteps(this.state); i += 1) {
      this.push();
      this.receive();
    }
    expect(sendableSteps(this.state)).toBeNull();
  }
}

const storedRow = (s: Services, noteId: string) =>
  s.row<{ content_json: string | null; content_text: string | null; plain_text: string; revision: number }>(
    'SELECT content_json, content_text, plain_text, revision FROM notes WHERE id = ?',
    noteId,
  )!;

const textNote = (s: Services, text: string, format: 'rich' | 'plain' = 'rich') => {
  const note = s.hierarchy.createNote({ projectId: null, folderId: null }, false, 'Shared', format).note;
  const doc = { type: 'doc' as const, content: [{ type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'text', text }] }] };
  s.writer.save({ noteId: note.id, viewId: randomUUID(), baseRevision: 0, requestId: randomUUID(), format, content: format === 'rich' ? doc : text });
  return note.id;
};

describe('live sync of one note between views (D-103)', () => {
  it('two views that interleave edits converge on the authority, and the saved note equals it (INF-SAVE-04)', async () => {
    const s = await services();
    const noteId = textNote(s, 'base');
    const a = new Client(s, noteId, 1);
    const b = new Client(s, noteId, 2);
    expect(a.state.doc.eq(b.state.doc)).toBe(true);

    // Concurrent edits on the same version: the second push is behind, rebases on the first and goes through.
    a.type(' A1', 'end');
    b.type('B1 ', 'start');
    expect(a.push()).toEqual({ status: 'accepted', version: 1 });
    expect(b.push()).toEqual({ status: 'behind', version: 1 });
    a.receive();
    b.receive();
    expect(sendableSteps(a.state)).toBeNull();
    b.sync();
    a.receive();

    // Alternating typing with deliveries in between.
    for (let i = 0; i < 6; i += 1) {
      const [writer, other] = i % 2 === 0 ? [a, b] : [b, a];
      writer.type(` ${i}`, i % 3 === 0 ? 'start' : 'end');
      other.type(`<${i}>`, 'end');
      writer.sync();
      other.receive();
      other.sync();
      writer.receive();
    }

    const authority = s.collab.documentOf(noteId)!;
    expect(a.state.doc.eq(authority)).toBe(true);
    expect(b.state.doc.eq(authority)).toBe(true);
    expect(authority.textContent).toContain('B1 base A1');

    const { revision } = await s.collab.flush({ noteId, viewId: a.viewId }, 1);
    const row = storedRow(s, noteId);
    expect(row.revision).toBe(revision);
    expect(noteSchema('rich').nodeFromJSON(JSON.parse(row.content_json!)).eq(authority)).toBe(true);
    expect(row.plain_text).toBe(authority.textContent);
    expect(s.revisions.at(-1)).toMatchObject({ noteId, revision });
  });

  it('plain-text notes sync the same way and are saved as text', async () => {
    const s = await services();
    const noteId = textNote(s, 'milk', 'plain');
    const a = new Client(s, noteId, 1);
    const b = new Client(s, noteId, 2);
    a.type(' and eggs', 'end');
    b.type('Buy ', 'start');
    a.sync();
    b.receive();
    b.sync();
    a.receive();
    expect(a.state.doc.eq(b.state.doc)).toBe(true);
    await s.collab.flush({ noteId, viewId: b.viewId }, 2);
    expect(storedRow(s, noteId).content_text).toBe(docToText(s.collab.documentOf(noteId)!.toJSON()));
    expect(storedRow(s, noteId).content_text).toBe('Buy milk and eggs');
  });

  it('opening never saves; block IDs given on open are saved only with an edit or a forced flush', async () => {
    const s = await services();
    const note = s.note(null, null, 'No ids');
    s.writer.save({
      noteId: note.id,
      viewId: randomUUID(),
      baseRevision: 0,
      requestId: randomUUID(),
      format: 'rich',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
    });
    const before = storedRow(s, note.id).revision;
    const a = new Client(s, note.id, 1);
    expect(a.state.doc.firstChild!.attrs.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.collab.leave(note.id, a.viewId, 1)).toEqual({ left: true });
    expect(storedRow(s, note.id).revision).toBe(before);

    const b = new Client(s, note.id, 1);
    await s.collab.flush({ noteId: note.id, viewId: b.viewId, force: true }, 1);
    expect(storedRow(s, note.id).revision).toBe(before + 1);
    expect(JSON.parse(storedRow(s, note.id).content_json!).content[0].attrs.id).toBe(b.state.doc.firstChild!.attrs.id);
  });

  it('a write from outside starts the session over and keeps unsaved edits as a recovered draft (INF-SAVE-04)', async () => {
    const s = await services();
    const noteId = textNote(s, 'base');
    const a = new Client(s, noteId, 1);
    const b = new Client(s, noteId, 2);
    a.type(' typed', 'end');
    a.sync();
    const revision = storedRow(s, noteId).revision;
    s.writer.save({
      noteId,
      viewId: randomUUID(),
      baseRevision: revision,
      requestId: randomUUID(),
      format: 'rich',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'replaced' }] }] },
    });
    a.receive();
    b.receive();
    const [reset] = a.resets;
    expect(reset).toMatchObject({ noteId, conflict: { reason: 'stale', draftId: expect.any(String) } });
    expect(b.resets).toEqual([reset]);
    const draft = s.row<{ content: string; reason: string }>('SELECT content, reason FROM note_drafts WHERE id = ?', reset!.conflict!.draftId)!;
    expect(draft).toMatchObject({ reason: 'conflict' });
    expect(draft.content).toContain('base typed');

    // A push on the old session is told to join again; the new session has the replacement.
    a.type('!', 'end');
    expect(a.push()).toEqual({ status: 'reset' });
    a.join();
    expect(a.state.doc.textContent).toBe('replaced');
  });

  it('refuses steps that do not apply, views from another window and pulls from an old session', async () => {
    const s = await services();
    const noteId = textNote(s, 'base');
    const a = new Client(s, noteId, 1);
    const push = (steps: unknown[]) => () =>
      s.collab.push({ noteId, viewId: a.viewId, epoch: a.epoch, version: 0, steps: steps as Array<{ stepType: string }> }, 1);
    expect(push([{ stepType: 'replace', from: 500, to: 501 }])).toThrow(AppError);
    expect(push([{ stepType: 'addMark', from: 1, to: 2, mark: { type: 'script' } }])).toThrow(/could not be applied/);
    expect(s.collab.documentOf(noteId)!.textContent).toBe('base');
    expect(() => s.collab.join(noteId, a.viewId, 9)).toThrow(/another window/);
    expect(s.collab.pull({ noteId, viewId: a.viewId, epoch: randomUUID(), version: 0 }, 1)).toEqual({ status: 'reset' });
    a.type('!', 'end');
    a.sync();
    expect(s.collab.pull({ noteId, viewId: a.viewId, epoch: a.epoch, version: 0 }, 1)).toMatchObject({ status: 'steps', version: 0, clientIDs: [a.viewId] });
  });

  it('a note trashed while a view edits keeps the edits as a draft when the view flushes', async () => {
    const s = await services();
    const noteId = textNote(s, 'milk');
    const a = new Client(s, noteId, 1);
    a.type(' more', 'end');
    a.sync();
    s.trash.trashNote(noteId);
    await expect(s.collab.flush({ noteId, viewId: a.viewId }, 1)).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'trashed' } });
    const drafts = s.rows<{ content: string }>('SELECT content FROM note_drafts WHERE note_id = ?', noteId);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.content).toContain('milk more');
  });

  it('the last view leaving saves its session, and a window going away takes its views along', async () => {
    const s = await services();
    const noteId = textNote(s, 'base');
    const a = new Client(s, noteId, 1);
    const b = new Client(s, noteId, 2);
    a.type(' a', 'end');
    a.sync();
    b.receive();
    s.collab.webContentsReset(1);
    expect(storedRow(s, noteId).plain_text).toBe('base');
    b.type(' b', 'end');
    b.sync();
    s.collab.leave(noteId, b.viewId, 2);
    expect(storedRow(s, noteId).plain_text).toBe('base a b');
    expect(s.collab.documentOf(noteId)).toBeNull();
  });
});

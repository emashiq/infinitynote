import { EditorState, TextSelection } from '@tiptap/pm/state';
import { Step } from '@tiptap/pm/transform';
import { collab, getVersion, receiveTransaction, sendableSteps } from 'prosemirror-collab';
import type { ContentSource } from '../../../../src/renderer/editor/content';
import type { NoteController } from '../../../../src/renderer/notes/note-controller';
import { toSavable } from '../../../../src/shared/editor/savable';
import { noteSchema } from '../../../../src/shared/editor/schema';
import { docToText, textToDoc } from '../../../../src/shared/text/textarea-doc';

/**
 * Stands in for the mounted editor: a ProseMirror state with the collab plugin over the controller's document,
 * reported as the controller's content source (live sync, D-103).
 */
export class TestSource implements ContentSource {
  uploads = 0;
  state: EditorState;
  private readonly idle: Array<() => void> = [];

  constructor(private readonly controller: NoteController) {
    const s = controller.store.getState();
    const schema = noteSchema(s.format);
    this.state = EditorState.create({
      schema,
      doc: schema.nodeFromJSON(s.content ?? { type: 'doc', content: [{ type: 'paragraph' }] }),
      plugins: [collab({ version: s.syncVersion, clientID: controller.viewId })],
    });
    controller.attachSource(this);
  }

  /** The text, one line per paragraph. */
  get text(): string {
    return docToText(this.state.doc.toJSON());
  }

  /** Like typing over the whole text: replaces the content and tells the controller. */
  type(text: string): void {
    const doc = this.state.schema.nodeFromJSON(textToDoc(text));
    this.state = this.state.apply(this.state.tr.replaceWith(0, this.state.doc.content.size, doc.content));
    this.controller.markDirty();
  }

  /** Like typing at the end of the text. */
  append(text: string): void {
    const end = this.state.doc.content.size - 1;
    this.state = this.state.apply(this.state.tr.setSelection(TextSelection.create(this.state.doc, end)).insertText(text));
    this.controller.markDirty();
  }

  getContent() {
    const json = this.state.doc.toJSON() as { content?: unknown[] };
    return this.controller.store.getState().format === 'rich' ? toSavable(json) : docToText(json);
  }

  getPlainText(): string {
    return this.text;
  }

  /** The test source has no block ids. */
  blockText(): string | null {
    return null;
  }

  /** The whole text stands for a plain-text note; there are no blocks. */
  phraseText(blockId: string | null): string | null {
    return blockId === null ? this.text : null;
  }

  hasPendingUploads(): boolean {
    return this.uploads > 0;
  }

  waitForUploads(): Promise<boolean> {
    return this.uploads === 0 ? Promise.resolve(true) : new Promise((resolve) => this.idle.push(() => resolve(true)));
  }

  /** Finishes the pending uploads: their completion is an edit, like the real uploader's. */
  finishUploads(text: string): void {
    this.uploads = 0;
    this.type(text);
    for (const done of this.idle.splice(0)) done();
  }

  version(): number {
    return getVersion(this.state);
  }

  sendable() {
    const s = sendableSteps(this.state);
    return s ? { version: s.version, steps: s.steps.map((step) => step.toJSON() as { stepType: string }) } : null;
  }

  receive(version: number, steps: ReadonlyArray<{ stepType: string }>, clientIDs: readonly string[]): 'applied' | 'gap' {
    const local = getVersion(this.state);
    if (version > local) return 'gap';
    const skip = local - version;
    if (skip >= steps.length) return 'applied';
    const parsed = steps.slice(skip).map((json) => Step.fromJSON(this.state.schema, json));
    this.state = this.state.apply(receiveTransaction(this.state, parsed, clientIDs.slice(skip)));
    return 'applied';
  }
}

const sources = new WeakMap<NoteController, TestSource>();

/** Types into a controller through a test source (attached on first use). */
export function typeInto(controller: NoteController, text: string): TestSource {
  let source = sources.get(controller);
  if (!source) {
    source = new TestSource(controller);
    sources.set(controller, source);
  }
  source.type(text);
  return source;
}

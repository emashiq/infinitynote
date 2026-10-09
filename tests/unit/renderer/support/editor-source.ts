import type { ContentSource } from '../../../../src/renderer/editor/content';
import type { NoteController } from '../../../../src/renderer/notes/note-controller';
import { textToDoc } from '../../../../src/shared/text/textarea-doc';

/** Stands in for the mounted editor: holds text and reports it as the controller's content source. */
export class TestSource implements ContentSource {
  text = '';
  uploads = 0;
  private readonly idle: Array<() => void> = [];

  constructor(private readonly controller: NoteController) {
    controller.attachSource(this);
  }

  /** Like typing in the editor: changes the content and marks the note dirty. */
  type(text: string): void {
    this.text = text;
    this.controller.markDirty();
  }

  getContent() {
    return this.controller.store.getState().format === 'rich' ? textToDoc(this.text) : this.text;
  }

  getPlainText(): string {
    return this.text;
  }

  /** The test source has one unnamed block: no block ids. */
  blockText(): string | null {
    return null;
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

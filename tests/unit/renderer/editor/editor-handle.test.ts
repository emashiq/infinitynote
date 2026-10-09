// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorHandle } from '../../../../src/renderer/editor/editor-handle';
import { makeEditor } from './support';

const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'last' }] }] };

function titleField(): HTMLInputElement {
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();
  return input;
}

describe('EditorHandle: Enter in the title moves into the text (A08-F1)', () => {
  it('focuses an attached editor synchronously, at the start or the end', () => {
    const { editor } = makeEditor({ content: doc });
    const handle = new EditorHandle();
    handle.attach(editor);
    const title = titleField();
    handle.focus('start', title);
    expect(document.activeElement).toBe(editor.view.dom);
    expect(editor.state.selection.from).toBe(1);
    title.focus();
    handle.focus('end');
    expect(document.activeElement).toBe(editor.view.dom);
    expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
  });

  it('keeps a request made before the editor exists and applies it when the editor is attached', () => {
    const handle = new EditorHandle();
    const title = titleField();
    handle.focus('start', title);
    expect(document.activeElement).toBe(title);
    const { editor } = makeEditor({ content: doc });
    handle.attach(editor);
    expect(document.activeElement).toBe(editor.view.dom);
    expect(editor.state.selection.from).toBe(1);
  });

  it('waits while the editor is read-only and applies the request once it becomes editable', () => {
    const { editor } = makeEditor({ content: doc });
    editor.setEditable(false);
    const handle = new EditorHandle();
    handle.attach(editor);
    const title = titleField();
    handle.focus('start', title);
    expect(document.activeElement).toBe(title);
    editor.setEditable(true);
    handle.editableChanged();
    expect(document.activeElement).toBe(editor.view.dom);
  });

  it('drops a waiting request when the user has moved the focus elsewhere, and applies a request only once', () => {
    const handle = new EditorHandle();
    const title = titleField();
    handle.focus('start', title);
    const other = titleField();
    const { editor } = makeEditor({ content: doc });
    handle.attach(editor);
    expect(document.activeElement).toBe(other);

    handle.focus('end');
    expect(document.activeElement).toBe(editor.view.dom);
    other.focus();
    handle.editableChanged();
    expect(document.activeElement).toBe(other);
  });

  it('detaching the editor stops it from receiving later requests; another editor gets them', () => {
    const first = makeEditor({ content: doc }).editor;
    const handle = new EditorHandle();
    handle.attach(first);
    handle.detach(first);
    const title = titleField();
    handle.focus('start', title);
    expect(document.activeElement).toBe(title);
    const second = makeEditor({ content: doc }).editor;
    handle.attach(second);
    expect(document.activeElement).toBe(second.view.dom);
  });
});

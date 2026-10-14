// @vitest-environment jsdom
import type { Editor, JSONContent } from '@tiptap/core';
import { undo } from '@tiptap/pm/history';
import { describe, expect, it } from 'vitest';
import type { MathSettings } from '../../../../src/renderer/editor/calc/calc-results';
import { REMOTE_META } from '../../../../src/renderer/editor/content';
import { normalizeRichDoc } from '../../../../src/shared/editor/doc-schema';
import { makeEditor, TEST_MATH } from './support';

const text = (t: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const p = (...content: Array<string | JSONContent>): JSONContent => ({ type: 'paragraph', content: content.filter((c) => c !== '').map((c) => (typeof c === 'string' ? text(c) : c)) });
const result = (t: string) => text(t, [{ type: 'calcResult' }]);

/** A rich editor holding the blocks, with the cursor at the end of the last one, and the math setting given. */
function editorWith(blocks: JSONContent[], math: Partial<MathSettings> = {}): Editor {
  const settings: MathSettings = { ...TEST_MATH, ...math };
  const { editor } = makeEditor({ content: { type: 'doc', content: blocks }, mathResults: () => settings });
  editor.commands.focus('end');
  return editor;
}

const ghost = (editor: Editor) => editor.view.dom.querySelector('.calc-ghost')?.textContent ?? null;

/** Types at the cursor as one transaction, like a key press (no input rules). */
function type(editor: Editor, t: string) {
  editor.view.dispatch(editor.state.tr.insertText(t));
}

function press(editor: Editor, key: string) {
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** Text the user types through ProseMirror's text input path (what a key press with a character does). */
function typeInput(editor: Editor, t: string) {
  const { from, to } = editor.state.selection;
  const handled = editor.view.someProp('handleTextInput', (f) => f(editor.view, from, to, t, () => editor.state.tr.insertText(t, from, to)));
  if (!handled) type(editor, t);
}

/** The paragraphs as text, each text node's marks shown as [calc] after it. */
function lines(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    if (!node.isTextblock) return true;
    let line = '';
    node.forEach((child) => {
      line += child.text ?? '';
      if (child.marks.some((m) => m.type.name === 'calcResult')) line += '[calc]';
    });
    out.push(line);
    return false;
  });
  return out;
}

describe('math results in the editor (D-188)', () => {
  it('suggests the result after "=" as muted text; Tab inserts it marked and typing goes on unmarked', () => {
    const editor = editorWith([p('')]);
    type(editor, '7+5=');
    expect(ghost(editor)).toBe('12');
    press(editor, 'Tab');
    expect(ghost(editor)).toBeNull();
    expect(lines(editor)).toEqual(['7+5=12[calc]']);
    type(editor, ' apples');
    expect(lines(editor)).toEqual(['7+5=12[calc] apples']);
  });

  it('Enter inserts too, keeping the spacing of the "="; only the number is the result', () => {
    const editor = editorWith([p('Total: 7 + 5 =')]);
    expect(ghost(editor)).toBeNull();
    const plain = editorWith([p('')]);
    type(plain, '7 + 5 =');
    expect(ghost(plain)).toBe(' 12');
    press(plain, 'Enter');
    expect(lines(plain)).toEqual(['7 + 5 = 12[calc]']);
    expect(plain.getJSON().content).toHaveLength(1);
  });

  it('Esc dismisses the suggestion until the line changes; Enter then makes a new line', () => {
    const editor = editorWith([p('')]);
    type(editor, '2*3=');
    press(editor, 'Escape');
    expect(ghost(editor)).toBeNull();
    press(editor, 'Enter');
    expect(lines(editor)).toEqual(['2*3=', '']);
    type(editor, '4*3 =');
    expect(ghost(editor)).toBe(' 12');
  });

  it('uses variables defined above, in list items, headings and table cells too', () => {
    const editor = editorWith([p('Lunch = 25'), { type: 'heading', attrs: { level: 2 }, content: [text('Dinner = 40')] }, p('Lunch + Dinner =')]);
    expect(ghost(editor)).toBe(' 65');
    const list = editorWith([{ type: 'bulletList', content: [{ type: 'listItem', content: [p('20% of 50 =')] }] }]);
    expect(ghost(list)).toBe(' 10');
    const table = editorWith([{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('2^10 =')] }] }] }]);
    expect(ghost(table)).toBe(' 1024');
  });

  it('a line after a hard break is a line of its own', () => {
    const editor = editorWith([p('x = 4', { type: 'hardBreak' }, 'x * 2 =')]);
    expect(ghost(editor)).toBe(' 8');
  });

  it('never in code blocks, inline code, with text after the cursor, or for a bare number or word', () => {
    expect(ghost(editorWith([{ type: 'codeBlock', attrs: { language: null }, content: [text('7+5=')] }]))).toBeNull();
    expect(ghost(editorWith([p(text('7+5=', [{ type: 'code' }]))]))).toBeNull();
    const middle = editorWith([p('7+5= apples')]);
    middle.commands.setTextSelection(5);
    expect(ghost(middle)).toBeNull();
    expect(ghost(editorWith([p('12 =')]))).toBeNull();
    expect(ghost(editorWith([p('hello =')]))).toBeNull();
  });

  it('Insert automatically writes the result as "=" is typed; Off shows and writes nothing', () => {
    const insert = editorWith([p('9 * 9 ')], { mode: 'insert' });
    typeInput(insert, '=');
    expect(lines(insert)).toEqual(['9 * 9 = 81[calc]']);
    expect(ghost(insert)).toBeNull();
    const off = editorWith([p('')], { mode: 'off' });
    type(off, '7+5=');
    expect(ghost(off)).toBeNull();
    typeInput(off, '=');
    expect(lines(off)).toEqual(['7+5==']);
  });
});

describe('recalculating math results (D-189)', () => {
  /** "a = 2", then "a * 3 = 6" with 6 a result, then "7 + 5 = 13" whose 13 reads no variable. */
  const doc = () => [p('a = 2'), p('a * 3 = ', result('6')), p('7 + 5 = ', result('13'))];

  it('rewrites the results that read a changed variable in one transaction outside the undo history', () => {
    const editor = editorWith(doc());
    editor.commands.setTextSelection(6);
    editor.view.dispatch(editor.state.tr.insertText('5', 5, 6));
    expect(lines(editor)).toEqual(['a = 5', 'a * 3 = 15[calc]', '7 + 5 = 13[calc]']);
    // One undo takes back the edit; the result follows the variable again.
    undo(editor.state, editor.view.dispatch);
    expect(lines(editor)).toEqual(['a = 2', 'a * 3 = 6[calc]', '7 + 5 = 13[calc]']);
  });

  it('follows chains of variables and a new definition in between', () => {
    const editor = editorWith([p('a = 2'), p('b = a * 10'), p('b + 1 = ', result('21'))]);
    editor.view.dispatch(editor.state.tr.insertText('3', 5, 6));
    expect(lines(editor)[2]).toBe('b + 1 = 31[calc]');
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize, editor.state.schema.nodes.paragraph!.create(null, editor.state.schema.text('b = 1'))));
    expect(lines(editor)).toEqual(['a = 3', 'b = a * 10', 'b = 1', 'b + 1 = 2[calc]']);
  });

  it('leaves results alone when no variable changed, for another view’s steps, and when math results are off', () => {
    const editor = editorWith(doc());
    editor.view.dispatch(editor.state.tr.insertText('x', 1, 1));
    expect(lines(editor)).toEqual(['xa = 2', 'a * 3 = 6[calc]', '7 + 5 = 13[calc]']);

    const remote = editorWith(doc());
    remote.view.dispatch(remote.state.tr.insertText('5', 5, 6).setMeta(REMOTE_META, true));
    expect(lines(remote)[1]).toBe('a * 3 = 6[calc]');

    const off = editorWith(doc(), { mode: 'off' });
    off.view.dispatch(off.state.tr.insertText('5', 5, 6));
    expect(lines(off)[1]).toBe('a * 3 = 6[calc]');
  });

  it('keeps a result whose expression lost its variable', () => {
    const editor = editorWith(doc());
    editor.view.dispatch(editor.state.tr.delete(1, 6));
    expect(lines(editor)).toEqual(['', 'a * 3 = 6[calc]', '7 + 5 = 13[calc]']);
  });

  it('stores results as a mark of the shared schema', () => {
    const editor = editorWith(doc());
    const second = normalizeRichDoc(editor.getJSON()).content?.[1] as JSONContent;
    expect(second.content?.[1]).toEqual({ type: 'text', text: '6', marks: [{ type: 'calcResult' }] });
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { hasLongRun, LONG_RUN_CHARS, LONG_RUN_CLASS } from '../../../../src/renderer/editor/long-runs';
import { makeEditor, tick } from './support';

const BANGLA = 'ক';
const longRun = BANGLA.repeat(LONG_RUN_CHARS + 1);
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

function marked(dom: HTMLElement): string[] {
  return [...dom.querySelectorAll(`.${LONG_RUN_CLASS}`)].map((el) => (el.textContent ?? '').slice(0, 8));
}

describe('very long unbroken runs wrap with break-all, text unchanged (F-03-1)', () => {
  it('hasLongRun counts characters between whitespace', () => {
    expect(hasLongRun(BANGLA.repeat(LONG_RUN_CHARS))).toBe(false);
    expect(hasLongRun(longRun)).toBe(true);
    expect(hasLongRun(`${BANGLA.repeat(LONG_RUN_CHARS)} ${BANGLA.repeat(LONG_RUN_CHARS)}`)).toBe(false);
    expect(hasLongRun(`${BANGLA.repeat(3000)}\u2009${BANGLA.repeat(3000)}`)).toBe(false);
    expect(hasLongRun(`short words ${'a'.repeat(LONG_RUN_CHARS + 1)} end`)).toBe(true);
  });

  it('only the block holding the run is marked, in rich and plain notes, and the text is byte-exact', async () => {
    const rich = makeEditor({ content: { type: 'doc', content: [paragraph('normal text'), paragraph(longRun), paragraph('after')] } });
    await tick();
    expect(marked(rich.editor.view.dom)).toEqual([BANGLA.repeat(8)]);
    expect(rich.editor.getText({ blockSeparator: '\n' })).toBe(`normal text\n${longRun}\nafter`);

    const plain = makeEditor({ format: 'plain', content: { type: 'doc', content: [paragraph(longRun), paragraph('x')] } });
    await tick();
    expect(marked(plain.editor.view.dom)).toEqual([BANGLA.repeat(8)]);
  });

  it('typing a space into the run removes the mark; a pasted run adds it; edits next to a marked block keep its mark', async () => {
    const { editor } = makeEditor({ content: { type: 'doc', content: [paragraph(longRun), paragraph('next')] } });
    await tick();
    const middle = 1 + Math.floor(longRun.length / 2);
    editor.commands.insertContentAt(middle, ' ');
    expect(marked(editor.view.dom)).toEqual([]);
    editor.commands.undo();
    expect(marked(editor.view.dom)).toEqual([BANGLA.repeat(8)]);

    // Typing at the start of the following block (touching the marked block's end) keeps the mark.
    const nextStart = editor.state.doc.child(0).nodeSize + 1;
    editor.commands.insertContentAt(nextStart, 'more ');
    expect(marked(editor.view.dom)).toEqual([BANGLA.repeat(8)]);
    expect(editor.state.doc.child(1).textContent).toBe('more next');

    editor.commands.insertContentAt(editor.state.doc.content.size, paragraph('x'.repeat(LONG_RUN_CHARS + 10)));
    expect(marked(editor.view.dom)).toEqual([BANGLA.repeat(8), 'xxxxxxxx']);
  });
});

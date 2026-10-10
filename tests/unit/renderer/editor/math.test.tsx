// @vitest-environment jsdom
import type { Editor } from '@tiptap/core';
import { act } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { richToMarkdown } from '../../../../src/main/portability/markdown';
import { mathToHtml } from '../../../../src/renderer/editor/math/katex-render';
import { DocSchemaError, MAX_MATH_BLOCK, MAX_MATH_INLINE, normalizeRichDoc } from '../../../../src/shared/editor/doc-schema';
import { extractPlainText } from '../../../../src/shared/text/plain-text';
import { makeEditor, mountEditor, tick } from './support';

// jsdom has no layout: ranges get empty rectangles, so the editor can scroll the selection into view after an edit.
beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

/** Types text through ProseMirror's text input path, so input rules run as they do for keys. */
function typeText(editor: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', (f) => f(editor.view, from, to, ch, () => editor.state.tr.insertText(ch, from, to)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
  }
}

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await act(async () => new Promise((r) => setTimeout(r, 20)));
};

const types = (editor: Editor) => JSON.stringify(editor.getJSON()).match(/"type":"(math\w+)","attrs":\{"latex":"[^"]*"/g);

describe('math input (D-161)', () => {
  it('$…$ after a space becomes inline math; prices and spaced dollars stay text', async () => {
    const { editor } = makeEditor({ content: '<p>Area</p>' });
    await tick();
    editor.commands.setTextSelection(5);
    typeText(editor, ' is $\\pi r^2$');
    expect(types(editor)).toEqual(['"type":"mathInline","attrs":{"latex":"\\\\pi r^2"']);
    typeText(editor, ' costs $5 and $');
    expect(types(editor)).toHaveLength(1);
    expect(editor.getText()).toBe('Area is \\pi r^2 costs $5 and $');
  });

  it('$$ and a space at the start of a line becomes a math block', async () => {
    const { editor } = makeEditor({ content: '<p>x</p><p></p>' });
    await tick();
    editor.commands.setTextSelection(4);
    typeText(editor, '$$ ');
    expect(editor.getJSON().content!.map((n) => n.type).slice(0, 2)).toEqual(['paragraph', 'mathBlock']);
  });
});

describe('math in the shared schema and exports (D-161)', () => {
  it('keeps the TeX within its limits, reads it as text and writes $…$ and $$…$$ to Markdown', () => {
    const doc = normalizeRichDoc({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'E is ' }, { type: 'mathInline', attrs: { latex: 'mc^2', extra: true } }] }, { type: 'mathBlock', attrs: { latex: '\\int_0^1 x\\,dx' } }],
    });
    expect(extractPlainText('rich', doc)).toBe('E is mc^2\n\\int_0^1 x\\,dx');
    expect(richToMarkdown('', doc, { linkOf: () => null, linkedFileUrl: () => null })).toBe('E is $mc^2$\n\n$$\n\\int_0^1 x\\,dx\n$$\n');
    const tooLong = (type: string, n: number) => () => normalizeRichDoc({ type: 'doc', content: type === 'mathBlock' ? [{ type, attrs: { latex: 'x'.repeat(n) } }] : [{ type: 'paragraph', content: [{ type, attrs: { latex: 'x'.repeat(n) } }] }] });
    expect(tooLong('mathInline', MAX_MATH_INLINE + 1)).toThrow(DocSchemaError);
    expect(tooLong('mathBlock', MAX_MATH_BLOCK + 1)).toThrow(DocSchemaError);
    expect(tooLong('mathBlock', MAX_MATH_BLOCK)).not.toThrow();
  });

  it('KaTeX trusts nothing: links and HTML commands are not produced', () => {
    const html = mathToHtml('\\href{javascript:alert(1)}{x} \\url{https://example.com} \\htmlId{a}{b}', false);
    // The commands show as red text; the TeX source stays only in the MathML annotation.
    expect(html).not.toContain('href=');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('id="a"');
    expect(html).toContain('<span class="mord" style="color:#cc0000;">\\href</span>');
  });
});

describe('the formula view (D-161)', () => {
  it('draws the formula; a click edits it in place, Enter keeps the change and an emptied formula is removed', async () => {
    const { editor } = await mountEditor({ content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a ' }, { type: 'mathInline', attrs: { latex: 'x^2' } }] }] } });
    await settle();
    const view = editor.view.dom.querySelector('.math-inline')!;
    expect(view.querySelector('.katex')).not.toBeNull();
    await act(async () => view.querySelector<HTMLElement>('.math-render')!.click());
    const input = view.querySelector<HTMLInputElement>('input[aria-label="Formula (TeX)"]')!;
    expect(input.value).toBe('x^2');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'y_1');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(JSON.stringify(editor.getJSON())).toContain('"latex":"y_1"');

    await act(async () => editor.view.dom.querySelector<HTMLElement>('.math-render')!.click());
    await settle();
    const again = editor.view.dom.querySelector<HTMLInputElement>('.math-inline input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(again, '  ');
      again.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => void again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(JSON.stringify(editor.getJSON())).not.toContain('mathInline');
  });

  it('invalid TeX shows KaTeX\'s message', async () => {
    const { editor } = await mountEditor({ content: { type: 'doc', content: [{ type: 'mathBlock', attrs: { latex: '\\frac{1' } }] } });
    await settle();
    expect(editor.view.dom.querySelector('.math-block .math-error')?.textContent).toMatch(/end of input/);
  });
});

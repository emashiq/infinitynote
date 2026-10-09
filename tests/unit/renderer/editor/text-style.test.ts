// @vitest-environment jsdom
import type { Editor, JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { normalizeRichDoc } from '../../../../src/shared/editor/doc-schema';
import { normalizeHexColor } from '../../../../src/shared/color';
import { fontFamilyFromCss } from '../../../../src/shared/editor/formatting';
import { toSavable } from '../../../../src/shared/editor/savable';
import { makeEditor, pasteEvent, tick } from './support';

/** The textStyle attributes of every text run, with their text. */
function styledRuns(editor: Editor): Array<{ text: string; style: Record<string, unknown> }> {
  const out: Array<{ text: string; style: Record<string, unknown> }> = [];
  editor.state.doc.descendants((node) => {
    const mark = node.isText ? node.marks.find((m) => m.type.name === 'textStyle') : undefined;
    if (mark) out.push({ text: node.text!, style: Object.fromEntries(Object.entries(mark.attrs).filter(([, v]) => v !== null)) });
  });
  return out;
}

async function styled(run: (editor: Editor) => void): Promise<Editor> {
  const { editor } = makeEditor({ content: '<p>word</p>' });
  await tick();
  editor.commands.selectAll();
  run(editor);
  return editor;
}

describe('font, size, text color and highlight in rich notes', () => {
  it('the commands store listed values; the note saves, reloads and renders them', async () => {
    const editor = await styled((e) => e.chain().setFontFamily('georgia').setFontSize('20px').setColor('#e03131').setBackgroundColor('#fff3a3').run());
    expect(styledRuns(editor)).toEqual([{ text: 'word', style: { fontFamily: 'georgia', fontSize: '20px', color: '#e03131', backgroundColor: '#fff3a3' } }]);
    const normalized = normalizeRichDoc(toSavable(editor.getJSON()));
    const reloaded = makeEditor({ content: normalized as JSONContent }).editor;
    await tick();
    expect(styledRuns(reloaded)).toEqual(styledRuns(editor));
    const span = reloaded.view.dom.querySelector<HTMLElement>('span[style]')!;
    expect(normalizeHexColor(span.style.color)).toBe('#e03131');
    expect(normalizeHexColor(span.style.backgroundColor)).toBe('#fff3a3');
    expect(span.style.fontSize).toBe('20px');
    expect(fontFamilyFromCss(span.style.fontFamily)).toBe('georgia');
    // Text on a light highlight gets the dark ink unless it has its own color.
    expect(span.getAttribute('data-ink')).toBe('dark');
  });

  it('Default and None remove one style each; the mark goes when nothing is left', async () => {
    const editor = await styled((e) => e.chain().setColor('#1c7ed6').setBackgroundColor('#22344f').run());
    expect(editor.view.dom.querySelector('span[data-ink]')?.getAttribute('data-ink')).toBe('light');
    editor.chain().selectAll().unsetColor().run();
    expect(styledRuns(editor)).toEqual([{ text: 'word', style: { backgroundColor: '#22344f' } }]);
    editor.chain().selectAll().unsetBackgroundColor().run();
    expect(styledRuns(editor)).toEqual([]);
  });

  it('values outside the lists never render and are dropped when the note is saved', async () => {
    const editor = await styled((e) => e.chain().setColor('red').setFontFamily('Comic Sans MS').setFontSize('13px').setBackgroundColor('url(https://evil.example/x)').run());
    expect(editor.view.dom.querySelector('span[style]')).toBeNull();
    const saved = JSON.stringify(normalizeRichDoc(toSavable(editor.getJSON())));
    expect(saved).not.toContain('textStyle');
    expect(saved).not.toContain('evil.example');
  });

  it('a paste keeps listed fonts and sizes and hex or rgb colors, and drops every other style', async () => {
    const { editor } = makeEditor({ content: '<p></p>' });
    await tick();
    pasteEvent(editor, {
      html:
        '<p><span style="color: rgb(224, 49, 49); font-family: Arial, sans-serif; font-size: 13.5pt">kept</span> ' +
        '<span style="color: red; position: fixed; background-image: url(https://evil.example/x.png); font-family: Papyrus; font-size: 13px">dropped</span> ' +
        '<span style="background-color: #C5E1FF; font-size: 24px">highlight</span></p>',
      text: 'kept dropped highlight',
    });
    expect(styledRuns(editor)).toEqual([
      { text: 'kept', style: { color: '#e03131', fontFamily: 'arial', fontSize: '18px' } },
      { text: 'highlight', style: { backgroundColor: '#c5e1ff', fontSize: '24px' } },
    ]);
    expect(editor.getText()).toBe('kept dropped highlight');
    expect(editor.getHTML()).not.toMatch(/evil\.example|position|Papyrus/);
  });

  it('a paste from a document drops its default black or white text and white highlight, and merges nested spans', async () => {
    const { editor } = makeEditor({ content: '<p></p>' });
    await tick();
    pasteEvent(editor, {
      html: '<p><span style="color:#000000;background-color:#ffffff;font-family:Arial">plain</span><span style="color:#ffffff"> white</span><span style="color:#2b8a3e"><span style="font-size:12pt">nested</span></span></p>',
      text: 'plain white nested',
    });
    expect(styledRuns(editor)).toEqual([
      { text: 'plain', style: { fontFamily: 'arial' } },
      { text: 'nested', style: { color: '#2b8a3e', fontSize: '16px' } },
    ]);
  });

  it('copying styled text out of a note and pasting it back keeps its formatting', async () => {
    const source = await styled((e) => e.chain().setFontFamily('mono').setColor('#8b5cf6').run());
    const html = source.getHTML();
    const { editor } = makeEditor({ content: '<p></p>' });
    await tick();
    pasteEvent(editor, { html, text: 'word' });
    expect(styledRuns(editor)).toEqual([{ text: 'word', style: { fontFamily: 'mono', color: '#8b5cf6' } }]);
  });
});

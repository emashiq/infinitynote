// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorHandle } from '../../../../src/renderer/editor/editor-handle';
import { outlineOf, revealHeading } from '../../../../src/renderer/editor/outline';
import { formatStats, textStats } from '../../../../src/shared/text/text-stats';
import { makeEditor, tick } from './support';

describe('note outline (D-162)', () => {
  it('lists headings in order with their level, including headings inside lists and quotes', async () => {
    const { editor } = makeEditor({
      content: '<h1>Plan</h1><p>x</p><h2>Goals</h2><ul><li><h3>Nested</h3></li></ul><blockquote><h2>Quoted</h2></blockquote><h3></h3>',
    });
    await tick();
    expect(outlineOf(editor.state.doc).map((i) => [i.level, i.text])).toEqual([
      [1, 'Plan'],
      [2, 'Goals'],
      [3, 'Nested'],
      [2, 'Quoted'],
      [3, ''],
    ]);
    const goals = outlineOf(editor.state.doc)[1]!;
    revealHeading(editor, goals.pos);
    expect(editor.state.selection.$from.parent.textContent).toBe('Goals');
  });

  it('the editor handle tells listeners when an editor is attached and detached', async () => {
    const { editor } = makeEditor();
    await tick();
    const handle = new EditorHandle();
    const seen: Array<unknown> = [];
    handle.subscribe(() => seen.push(handle.current()));
    handle.attach(editor);
    handle.detach(editor);
    expect(seen).toEqual([editor, null]);
  });
});

describe('word and character counts (D-162)', () => {
  it('counts words by script, characters as graphemes without line breaks, and reading time at 200 words a minute', () => {
    expect(textStats('')).toEqual({ words: 0, characters: 0, readingMinutes: 0 });
    expect(textStats('Hello, world!\nবাংলা লেখা 😀')).toEqual({ words: 4, characters: 20, readingMinutes: 1 });
    expect(textStats(Array.from({ length: 500 }, () => 'word').join(' ')).readingMinutes).toBe(3);
    expect(formatStats({ words: 1, characters: 1234, readingMinutes: 1 })).toBe('1 word · 1,234 characters · 1 min read');
  });
});

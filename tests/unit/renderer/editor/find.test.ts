// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { findMatches, findPrefill, MAX_FIND_MATCHES } from '../../../../src/renderer/editor/find-core';
import { findState } from '../../../../src/renderer/editor/find';
import { makeEditor, tick } from './support';

const matchedTexts = (editor: ReturnType<typeof makeEditor>['editor']) =>
  findMatches(editor.state.doc, findState(editor.state).query).map((m) => editor.state.doc.textBetween(m.from, m.to));

describe('find in note (INF-KEY-04, D-058)', () => {
  it('matches literally, case-insensitively and in Unicode text', async () => {
    const { editor } = makeEditor({ content: '<p>alpha beta Alpha ALPHA বাংলা</p><p>a.b a*b (x)</p>' });
    await tick();
    editor.commands.setFindQuery('alpha');
    expect(matchedTexts(editor)).toEqual(['alpha', 'Alpha', 'ALPHA']);
    editor.commands.setFindQuery('বাংলা');
    expect(findState(editor.state).matches).toHaveLength(1);
    editor.commands.setFindQuery('a.b');
    expect(matchedTexts(editor)).toEqual(['a.b']);
    editor.commands.setFindQuery('(x)');
    expect(matchedTexts(editor)).toEqual(['(x)']);
    editor.commands.setFindQuery('zzz');
    expect(findState(editor.state)).toMatchObject({ matches: [], index: -1 });
  });

  it('next and previous wrap around and select the current match; the document never changes', async () => {
    const { editor, updates } = makeEditor({ content: '<p>alpha beta Alpha ALPHA</p>' });
    await tick();
    const doc = editor.state.doc;
    const editsBefore = updates.length;
    editor.commands.setFindQuery('alpha');
    expect(findState(editor.state).index).toBe(0);
    const selected = () => editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);
    expect(selected()).toBe('alpha');
    editor.commands.findNext();
    expect(findState(editor.state).index).toBe(1);
    expect(selected()).toBe('Alpha');
    editor.commands.findPrevious();
    expect(findState(editor.state).index).toBe(0);
    editor.commands.findPrevious();
    expect(findState(editor.state).index).toBe(2);
    editor.commands.findNext();
    expect(findState(editor.state).index).toBe(0);
    expect(editor.state.doc.eq(doc)).toBe(true);
    expect(updates.length).toBe(editsBefore);
  });

  it('draws decorations for every match and the current one, and clears them', async () => {
    const { editor } = makeEditor({ content: '<p>one two one</p>' });
    await tick();
    editor.commands.setFindQuery('one');
    expect(editor.view.dom.querySelectorAll('.find-match')).toHaveLength(2);
    expect(editor.view.dom.querySelectorAll('.find-match-current')).toHaveLength(1);
    editor.commands.clearFind();
    expect(editor.view.dom.querySelectorAll('.find-match')).toHaveLength(0);
    expect(findState(editor.state).query).toBe('');
  });

  it('recomputes matches when the document changes', async () => {
    const { editor } = makeEditor({ content: '<p>cat</p>' });
    await tick();
    editor.commands.setFindQuery('cat');
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' cat');
    expect(findState(editor.state).matches).toHaveLength(2);
  });

  it('works in read-only and plain-text editors', async () => {
    const { editor } = makeEditor({ format: 'plain', content: '<p>first line</p><p>second line</p>' });
    await tick();
    editor.setEditable(false);
    editor.commands.setFindQuery('LINE');
    expect(findState(editor.state).matches).toHaveLength(2);
    editor.commands.findNext();
    expect(findState(editor.state).index).toBe(1);
  });

  it('caps matches at 1,000, never spans blocks or hard breaks, and prefills one line of the selection', async () => {
    const { editor } = makeEditor({ content: `<p>${'x'.repeat(1500)}</p><p>ab</p><p>cd</p><p>a<br>b</p>` });
    await tick();
    expect(findMatches(editor.state.doc, 'x')).toHaveLength(MAX_FIND_MATCHES);
    expect(findMatches(editor.state.doc, 'bc')).toEqual([]);
    expect(findMatches(editor.state.doc, 'ab')).toHaveLength(1);
    expect(findPrefill('first line\nsecond')).toBe('first line');
    expect(findPrefill('y'.repeat(300))).toHaveLength(200);
  });
});

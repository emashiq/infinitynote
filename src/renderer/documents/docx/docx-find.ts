import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

export interface DocxFindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface TextMatch {
  from: number;
  to: number;
}

/** More matches than this are not highlighted or counted (a find for "e" in a long report). */
export const MAX_FIND_MATCHES = 10_000;

/** An inline object (a tab, a picture, a note reference) in the searched text: a match never runs across one. */
const OBJECT = '￼';
const WORD_CHAR = '[\\p{L}\\p{N}_]';

function pattern(query: string, options: DocxFindOptions): RegExp {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const source = options.wholeWord ? `(?<!${WORD_CHAR})${escaped}(?!${WORD_CHAR})` : escaped;
  return new RegExp(source, options.caseSensitive ? 'gu' : 'giu');
}

/**
 * Every match of the query in the document body, in document order (F4, D-145): text is searched paragraph by
 * paragraph (table cells included), so a match never spans two paragraphs; marks such as bold or a font change do not
 * split it. Headers, footers and notes are their own stories and are not searched here.
 */
export function findMatches(doc: PmNode, query: string, options: DocxFindOptions): TextMatch[] {
  if (query === '') return [];
  const re = pattern(query, options);
  const matches: TextMatch[] = [];
  doc.descendants((node, pos) => {
    if (matches.length >= MAX_FIND_MATCHES) return false;
    if (!node.isTextblock) return true;
    let text = '';
    // The document position of each character of `text`.
    const at: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      const piece = child.isText ? child.text! : OBJECT;
      for (let i = 0; i < piece.length; i += 1) at.push(start + i);
      text += piece;
    });
    for (const m of text.matchAll(re)) {
      if (m[0] === '' || matches.length >= MAX_FIND_MATCHES) break;
      matches.push({ from: at[m.index]!, to: at[m.index + m[0].length - 1]! + 1 });
    }
    return false;
  });
  return matches;
}

/** One step through the matches, wrapping around; -1 when there are none. */
export function stepIndex(count: number, current: number, previous: boolean): number {
  if (count === 0) return -1;
  if (current < 0) return previous ? count - 1 : 0;
  return (current + (previous ? count - 1 : 1)) % count;
}

interface FindState {
  query: string;
  options: DocxFindOptions;
  matches: TextMatch[];
  current: number;
  decorations: DecorationSet;
}

type FindMeta = { query: string; options: DocxFindOptions } | { current: number };

const findKey = new PluginKey<FindState>('infinityDocxFind');
const EMPTY: FindState = { query: '', options: { caseSensitive: false, wholeWord: false }, matches: [], current: -1, decorations: DecorationSet.empty };

function decorate(doc: PmNode, matches: TextMatch[], current: number): DecorationSet {
  return DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? 'docx-find-match docx-find-current' : 'docx-find-match' })),
  );
}

function withMatches(doc: PmNode, state: Pick<FindState, 'query' | 'options'>, current: number): FindState {
  const matches = findMatches(doc, state.query, state.options);
  const at = matches.length === 0 ? -1 : Math.min(Math.max(current, 0), matches.length - 1);
  return { ...state, matches, current: at, decorations: decorate(doc, matches, at) };
}

/**
 * The app's find in a Word document: highlights every match and the current one. It is the editor's consumer plugin,
 * so it runs in read-only versions too; edits search again, so the count stays right while typing.
 */
export function docxFindPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: () => EMPTY,
      apply(tr, value) {
        const meta = tr.getMeta(findKey) as FindMeta | undefined;
        if (meta && 'query' in meta) return withMatches(tr.doc, meta, 0);
        if (meta) return { ...value, current: meta.current, decorations: decorate(tr.doc, value.matches, meta.current) };
        if (tr.docChanged && value.query !== '') return withMatches(tr.doc, value, value.current);
        return value;
      },
    },
    props: {
      decorations: (state) => findKey.getState(state)?.decorations,
    },
  });
}

/** The matches and the current one (-1 when none). */
export function findState(state: EditorState): { count: number; current: number } {
  const s = findKey.getState(state) ?? EMPTY;
  return { count: s.matches.length, current: s.current };
}

/** Selects the current match and scrolls it into view. */
function reveal(view: EditorView): void {
  const s = findKey.getState(view.state);
  const match = s?.matches[s.current];
  if (!match) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, match.from, match.to)).scrollIntoView().setMeta('addToHistory', false));
}

/** Searches for the query and shows the first match. */
export function runFind(view: EditorView, query: string, options: DocxFindOptions): void {
  view.dispatch(view.state.tr.setMeta(findKey, { query, options } satisfies FindMeta).setMeta('addToHistory', false));
  reveal(view);
}

/** Shows the next or previous match. */
export function stepFind(view: EditorView, previous: boolean): void {
  const { count, current } = findState(view.state);
  if (count === 0) return;
  view.dispatch(view.state.tr.setMeta(findKey, { current: stepIndex(count, current, previous) } satisfies FindMeta).setMeta('addToHistory', false));
  reveal(view);
}

/** Clears the highlights (the find bar closed). */
export function clearFind(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(findKey, { query: '', options: EMPTY.options } satisfies FindMeta).setMeta('addToHistory', false));
}

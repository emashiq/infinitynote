import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findMatches, type FindMatch } from './find-core';

export interface FindState {
  query: string;
  matches: FindMatch[];
  /** The current match, or -1 when there is none. */
  index: number;
}

type FindMeta = { query: string } | { step: 1 | -1 } | { clear: true };

export const findKey = new PluginKey<FindState>('findInNote');
const EMPTY: FindState = { query: '', matches: [], index: -1 };

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findInNote: {
      setFindQuery: (query: string) => ReturnType;
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
      clearFind: () => ReturnType;
    };
  }
}

export function findState(state: EditorState): FindState {
  return findKey.getState(state) ?? EMPTY;
}

/** Selects (and scrolls to) a match; the selection is set without moving keyboard focus (D-058). */
function selectMatch(tr: Transaction, match: FindMatch | undefined): Transaction {
  if (!match) return tr;
  return tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).scrollIntoView();
}

/**
 * Find in note (INF-KEY-04, D-058): highlights every match with decorations, tracks the current one and moves
 * the selection to it. It never changes the document, so it works in read-only and plain-text notes.
 */
export const FindExtension = Extension.create({
  name: 'findInNote',

  addCommands() {
    return {
      setFindQuery:
        (query) =>
        ({ tr, dispatch }) => {
          if (dispatch) selectMatch(tr.setMeta(findKey, { query } satisfies FindMeta), findMatches(tr.doc, query)[0]);
          return true;
        },
      findNext:
        () =>
        ({ state, tr, dispatch }) => step(state, tr, 1, dispatch !== undefined),
      findPrevious:
        () =>
        ({ state, tr, dispatch }) => step(state, tr, -1, dispatch !== undefined),
      clearFind:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(findKey, { clear: true } satisfies FindMeta);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => EMPTY,
          apply(tr, prev): FindState {
            const meta = tr.getMeta(findKey) as FindMeta | undefined;
            if (meta && 'clear' in meta) return EMPTY;
            if (meta && 'query' in meta) {
              const matches = findMatches(tr.doc, meta.query);
              return { query: meta.query, matches, index: matches.length > 0 ? 0 : -1 };
            }
            if (meta && 'step' in meta) {
              const n = prev.matches.length;
              return n === 0 ? prev : { ...prev, index: (prev.index + meta.step + n) % n };
            }
            if (tr.docChanged && prev.query !== '') {
              const matches = findMatches(tr.doc, prev.query);
              return { ...prev, matches, index: Math.min(Math.max(prev.index, 0), matches.length - 1) };
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            const { matches, index } = findState(state);
            if (matches.length === 0) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === index ? 'find-match find-match-current' : 'find-match' })),
            );
          },
        },
      }),
    ];
  },
});

function step(state: EditorState, tr: Transaction, direction: 1 | -1, dispatch: boolean): boolean {
  const { matches, index } = findState(state);
  if (matches.length === 0) return false;
  if (dispatch) {
    const next = (index + direction + matches.length) % matches.length;
    selectMatch(tr.setMeta(findKey, { step: direction } satisfies FindMeta), matches[next]);
  }
  return true;
}

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { MAX_CANDIDATES, SKIP_INSERT_CHARS } from '../../shared/nlp/constants';
import type { CardCandidate } from '../reminders/card-request';
import { isUserEdit } from './content';

/** A document range (positions). */
export interface Range {
  from: number;
  to: number;
}

/** A phrase underlined in the editor (plan section 9.3). */
export interface LiveCandidate extends Range {
  /** Stable while the phrase stays (decoration key). */
  id: string;
  /** The block's ID (rich notes) or null (plain-text notes). */
  blockId: string | null;
  /** The line of a plain-text note; -1 in rich notes. */
  line: number;
  /** The phrase with block- (or line-) relative offsets and its ordinal. */
  candidate: CardCandidate;
  /** Needs a choice before it can be added (an underline variant). */
  needsChoice: boolean;
  /** The reminder whose source changed and this phrase may update (D-092). */
  updateFor: string | null;
}

export interface SuggestionsState {
  /** Text changed in this editor session that detection has not read yet. */
  changed: Range[];
  candidates: LiveCandidate[];
  decorations: DecorationSet;
}

type SuggestionsMeta =
  /** Detection read these blocks: their pending changes are done; new phrases replace the ones they overlap. */
  | { type: 'apply'; blocks: Range[]; candidates: LiveCandidate[] }
  /** Replaces every candidate (a dismissal, a confirmed phrase, the setting switched off). */
  | { type: 'set'; candidates: LiveCandidate[]; clearChanged?: boolean };

export const suggestionsKey = new PluginKey<SuggestionsState>('suggestions');

const overlaps = (a: Range, b: Range) => a.from < b.to && b.from < a.to;

/**
 * Whether an edit touched a phrase: text written inside it, or a deletion inside it or at its edges. Typing right
 * after (or before) a phrase leaves it as it is, so continuing to type keeps its underline.
 */
export function touchesEdit(span: Range, edit: Range): boolean {
  return edit.from === edit.to ? span.from <= edit.from && edit.from <= span.to : overlaps(span, edit);
}
const inside = (inner: Range, outer: Range) => inner.from >= outer.from && inner.to <= outer.to;

/** The ranges a transaction's steps wrote, in the new document, and how many characters it inserted. */
function editedRanges(tr: Transaction): { ranges: Range[]; inserted: number } {
  const ranges: Range[] = [];
  let inserted = 0;
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      inserted += newEnd - newStart;
      ranges.push({ from: rest.map(newStart, -1), to: rest.map(newEnd, 1) });
    });
  });
  return { ranges, inserted };
}

/** Sorted, with overlapping or adjacent ranges joined. */
function merged(ranges: Range[]): Range[] {
  const out: Range[] = [];
  for (const r of [...ranges].sort((a, b) => a.from - b.from)) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else out.push({ ...r });
  }
  return out;
}

function decorationsOf(state: { doc: EditorState['doc'] }, candidates: readonly LiveCandidate[]): DecorationSet {
  if (candidates.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    state.doc,
    candidates.map((c) =>
      Decoration.inline(c.from, c.to, { class: c.needsChoice ? 'nlp-candidate nlp-candidate-choice' : 'nlp-candidate', 'data-candidate': c.id, title: 'Reminder suggestion' }, { key: c.id }),
    ),
  );
}

function apply(tr: Transaction, value: SuggestionsState, newState: EditorState): SuggestionsState {
  let { changed, candidates } = value;
  if (tr.docChanged) {
    changed = changed.map((r) => ({ from: tr.mapping.map(r.from, -1), to: tr.mapping.map(r.to, 1) }));
    candidates = candidates
      .map((c) => ({ ...c, from: tr.mapping.map(c.from, 1), to: tr.mapping.map(c.to, -1) }))
      .filter((c) => c.from < c.to);
    if (isUserEdit(tr)) {
      const edit = editedRanges(tr);
      // An edited phrase is read again at the next pass; a large paste is not scanned automatically (D-091).
      candidates = candidates.filter((c) => !edit.ranges.some((r) => touchesEdit(c, r)));
      if (edit.inserted <= SKIP_INSERT_CHARS) changed = merged([...changed, ...edit.ranges]);
    }
  }
  const meta = tr.getMeta(suggestionsKey) as SuggestionsMeta | undefined;
  if (meta?.type === 'apply') {
    changed = changed.filter((r) => !meta.blocks.some((b) => inside(r, b)));
    candidates = [...candidates.filter((c) => !meta.candidates.some((n) => overlaps(n, c))), ...meta.candidates].slice(-MAX_CANDIDATES);
  } else if (meta?.type === 'set') {
    candidates = meta.candidates;
    if (meta.clearChanged) changed = [];
  }
  if (candidates === value.candidates && changed === value.changed) return value;
  const decorations = candidates === value.candidates ? value.decorations.map(tr.mapping, tr.doc) : decorationsOf(newState, candidates);
  return { changed, candidates, decorations };
}

/** A meta-only transaction: no document change, not in undo history, never saved (D-091). */
export function suggestionsMeta(state: EditorState, meta: SuggestionsMeta): Transaction {
  return state.tr.setMeta(suggestionsKey, meta).setMeta('addToHistory', false);
}

export function suggestionsOf(state: EditorState): SuggestionsState {
  return suggestionsKey.getState(state) ?? { changed: [], candidates: [], decorations: DecorationSet.empty };
}

/** The phrase at or around a position (its edges included), or null. */
export function candidateAt(state: EditorState, pos: number): LiveCandidate | null {
  return suggestionsOf(state).candidates.find((c) => c.from <= pos && pos <= c.to) ?? null;
}

/**
 * Reminder suggestion underlines (D-091): decorations over detected phrases, never document content. The plugin keeps
 * the text changed in this session (mapped through every transaction) so detection reads only that, and drops a
 * phrase as soon as an edit touches it.
 */
export const SuggestionDecorations = Extension.create({
  name: 'suggestionDecorations',
  addProseMirrorPlugins() {
    return [
      new Plugin<SuggestionsState>({
        key: suggestionsKey,
        state: {
          init: () => ({ changed: [], candidates: [], decorations: DecorationSet.empty }),
          apply,
        },
        props: {
          decorations: (state) => suggestionsKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});

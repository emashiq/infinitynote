import { Extension } from '@tiptap/core';
import type { Mark, Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { CalcOptions } from '../../../shared/calc/calculator';
import type { MathResultsMode } from '../../../shared/contracts/settings';
import { isRemote, markPersistent } from '../content';
import { caretResult, definitionsSignature, staleResults, type CaretResult } from './calc-lines';

/** The setting and what the calculator needs, read at each use (the setting can change while a note is open). */
export interface MathSettings extends CalcOptions {
  mode: MathResultsMode;
}

export interface CalcResultsOptions {
  /** Null where math results are not offered (the plain-text editor has its own schema). */
  settings: (() => MathSettings) | null;
}

interface CalcState {
  suggestion: CaretResult | null;
  /** The suggestion Esc dismissed; it stays hidden until the line or the caret changes. */
  dismissed: string | null;
}

type CalcMeta = { dismiss: string };

export const calcResultsKey = new PluginKey<CalcState>('calcResults');

/** The marks typing has at the caret (stored ones, or those of the text before it). */
const caretMarks = (at: Transaction | EditorState): readonly Mark[] => at.storedMarks ?? at.selection.$from.marks();

/**
 * Adds a result after the caret's "=" to a transaction: the result marked, a leading space not, both with the formatting
 * at the caret. The caret ends after it, so typing goes on there, unmarked.
 */
function insertResult(tr: Transaction, at: CaretResult): Transaction {
  const schema = tr.doc.type.schema;
  const marks = caretMarks(tr).filter((m) => m.type.name !== 'calcResult');
  const space = at.insertion.slice(0, at.insertion.length - at.result.length);
  if (space) tr.insert(at.pos, schema.text(space, marks));
  tr.insert(at.pos + space.length, schema.text(at.result, schema.marks.calcResult!.create().addToSet(marks)));
  return tr.setStoredMarks(marks).scrollIntoView();
}

/** Whether a transaction's steps touched a text block holding "=" (before or after the step). */
function touchesEquals(tr: Transaction): boolean {
  const holdsEquals = (doc: PmNode, from: number, to: number): boolean => {
    let found = false;
    const check = (node: PmNode) => {
      if (node.isTextblock && node.textContent.includes('=')) found = true;
    };
    check(doc.resolve(from).parent);
    check(doc.resolve(to).parent);
    doc.nodesBetween(from, to, (node) => {
      check(node);
      return !found && !node.isTextblock;
    });
    return found;
  };
  return tr.mapping.maps.some((map, i) => {
    const before = tr.docs[i]!;
    const after = tr.docs[i + 1] ?? tr.doc;
    let touched = false;
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      touched ||= holdsEquals(before, oldStart, oldEnd) || holdsEquals(after, newStart, newEnd);
    });
    return touched;
  });
}

/**
 * Math results (D-188, D-189), like Apple Notes' Math Notes. A line that ends with "=" after an expression gets its
 * result: Suggest shows it as muted text after the caret (Tab or Enter inserts it, Esc dismisses it, typing goes on as
 * usual); Insert automatically writes it as "=" is typed; Off does neither. Inserted results carry the `calcResult`
 * mark. When an edit changes a variable, the marked results that read variables are written again in one transaction
 * outside the undo history; only the editor that made the edit does it (another view gets its steps through live
 * sync), and the result depends only on the text, so every view agrees.
 */
export const CalcResults = Extension.create<CalcResultsOptions>({
  name: 'calcResults',
  // Before lists and tables, which take Tab and Enter too.
  priority: 1000,

  addOptions() {
    return { settings: null };
  },

  addProseMirrorPlugins() {
    const read = this.options.settings;
    if (!read) return [];

    const suggestionAt = (at: Transaction | EditorState): CaretResult | null =>
      at.selection.empty ? caretResult(at.doc, at.selection.from, caretMarks(at), read()) : null;

    return [
      new Plugin<CalcState>({
        key: calcResultsKey,
        state: {
          init: () => ({ suggestion: null, dismissed: null }),
          apply(tr, value, _old, state) {
            const meta = tr.getMeta(calcResultsKey) as CalcMeta | undefined;
            const dismissed = meta?.dismiss ?? value.dismissed;
            if (!tr.docChanged && !tr.selectionSet && !meta) return value;
            if (read().mode !== 'suggest') return { suggestion: null, dismissed };
            const suggestion = suggestionAt(state);
            return { suggestion: suggestion && suggestion.key !== dismissed ? suggestion : null, dismissed };
          },
        },
        props: {
          decorations(state) {
            const { suggestion } = calcResultsKey.getState(state)!;
            if (!suggestion) return null;
            const ghost = () => {
              const span = document.createElement('span');
              span.className = 'calc-ghost';
              span.setAttribute('aria-hidden', 'true');
              span.textContent = suggestion.insertion;
              return span;
            };
            return DecorationSet.create(state.doc, [Decoration.widget(suggestion.pos, ghost, { side: 1, key: `calc:${suggestion.insertion}`, ignoreSelection: true })]);
          },
          handleKeyDown(view: EditorView, event: KeyboardEvent) {
            const { suggestion } = calcResultsKey.getState(view.state)!;
            if (!suggestion || view.composing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
            if (event.key === 'Tab' || event.key === 'Enter') {
              view.dispatch(insertResult(view.state.tr, suggestion));
              return true;
            }
            if (event.key === 'Escape') {
              view.dispatch(view.state.tr.setMeta(calcResultsKey, { dismiss: suggestion.key } satisfies CalcMeta));
              return true;
            }
            return false;
          },
          // Insert automatically: typing "=" after an expression writes its result at once.
          handleTextInput(view: EditorView, from: number, to: number, text: string) {
            if (text !== '=' || read().mode !== 'insert' || view.composing) return false;
            const typed = view.state.tr.insertText(text, from, to);
            const found = suggestionAt(typed);
            if (!found) return false;
            view.dispatch(insertResult(typed, found));
            return true;
          },
        },
        appendTransaction(transactions, oldState, newState) {
          const options = read();
          const local = transactions.filter((tr) => tr.docChanged && !isRemote(tr));
          if (options.mode === 'off' || !local.some(touchesEquals)) return null;
          if (definitionsSignature(oldState.doc, options) === definitionsSignature(newState.doc, options)) return null;
          const stale = staleResults(newState.doc, options);
          if (stale.length === 0) return null;
          const tr = newState.tr;
          for (const s of [...stale].reverse()) tr.replaceWith(s.from, s.to, newState.schema.text(s.text, s.marks));
          return markPersistent(tr);
        },
      }),
    ];
  },
});

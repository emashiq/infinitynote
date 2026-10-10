import { Extension, type Editor } from '@tiptap/core';
import type { Mark, Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { AddMarkStep, RemoveMarkStep, ReplaceAroundStep, ReplaceStep, type Step } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { COMMENT_MESSAGES, MAX_COMMENT_QUOTE } from '../../../shared/contracts/comments';
import { BLOCK_ID_TYPES } from '../../../shared/editor/doc-schema';
import { markPersistent } from '../content';

/** How long a comment's text stays flashed after the sidebar revealed it. */
export const COMMENT_FLASH_MS = 1500;

/** What the note tab shows of its threads (D-165): open threads are highlighted, the selected one more strongly. */
export interface CommentLook {
  open: ReadonlySet<string>;
  active: string | null;
  flash: string | null;
  /** The text a comment is being written for, until it is saved or canceled. */
  pending: { from: number; to: number } | null;
}

interface CommentMarksState extends CommentLook {
  decorations: DecorationSet;
}

const EMPTY_LOOK: CommentLook = { open: new Set(), active: null, flash: null, pending: null };
export const commentMarksKey = new PluginKey<CommentMarksState>('commentMarks');
const ID_TYPES = new Set<string>(BLOCK_ID_TYPES);

const isComment = (mark: Mark): boolean => mark.type.name === 'comment';

/** Whether a step adds, removes or brings in text with comment marks: only then must the highlights be rebuilt. */
function touchesComments(step: Step): boolean {
  if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return isComment(step.mark);
  if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) return false;
  let found = false;
  step.slice.content.descendants((node) => {
    if (found) return false;
    found = node.marks.some(isComment);
    return !found;
  });
  return found;
}

function decorate(doc: PmNode, look: CommentLook): DecorationSet {
  const decorations: Decoration[] = [];
  if (look.open.size > 0) {
    doc.descendants((node, pos) => {
      if (!node.isText) return true;
      for (const mark of node.marks) {
        const id = mark.attrs.threadId as string;
        if (!isComment(mark) || !look.open.has(id)) continue;
        const cls = ['comment-anchor', id === look.active ? 'comment-anchor-active' : '', id === look.flash ? 'comment-anchor-flash' : ''].filter(Boolean).join(' ');
        decorations.push(Decoration.inline(pos, pos + node.nodeSize, { class: cls, 'data-comment-anchor': id }));
      }
      return false;
    });
  }
  if (look.pending) decorations.push(Decoration.inline(look.pending.from, look.pending.to, { class: 'comment-anchor comment-anchor-pending' }));
  return DecorationSet.create(doc, decorations);
}

/** A transaction that only changes the highlights: no document change and no undo step. */
export function commentLookMeta(state: EditorState, look: Partial<CommentLook>): Transaction {
  return state.tr.setMeta(commentMarksKey, look).setMeta('addToHistory', false);
}

/**
 * The note tab's side of comments (D-165): highlights of the listed threads and of the text a comment is being written
 * for (decorations, never saved), and Ctrl+Alt+M to comment on the selection where the window offers it.
 */
export const CommentMarks = Extension.create<{ start: (() => boolean) | null }>({
  name: 'commentMarks',

  addOptions() {
    return { start: null };
  },

  addKeyboardShortcuts() {
    return { 'Mod-Alt-m': () => (this.editor.isEditable ? (this.options.start?.() ?? false) : false) };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<CommentMarksState>({
        key: commentMarksKey,
        state: {
          init: (_config, state) => ({ ...EMPTY_LOOK, decorations: decorate(state.doc, EMPTY_LOOK) }),
          apply(tr, prev, _old, state) {
            const meta = tr.getMeta(commentMarksKey) as Partial<CommentLook> | undefined;
            const pending = prev.pending && tr.docChanged ? mapRange(prev.pending, tr) : prev.pending;
            const look: CommentLook = { open: prev.open, active: prev.active, flash: prev.flash, pending, ...meta };
            if (meta || (tr.docChanged && tr.steps.some(touchesComments))) return { ...look, decorations: decorate(state.doc, look) };
            if (!tr.docChanged) return { ...prev, ...look };
            const decorations = pending === prev.pending ? prev.decorations.map(tr.mapping, tr.doc) : decorate(state.doc, look);
            return { ...look, decorations };
          },
        },
        props: {
          decorations: (state) => commentMarksKey.getState(state)?.decorations ?? DecorationSet.empty,
        },
      }),
    ];
  },
});

function mapRange(range: { from: number; to: number }, tr: Transaction): { from: number; to: number } | null {
  const from = tr.mapping.map(range.from, 1);
  const to = tr.mapping.map(range.to, -1);
  return to > from ? { from, to } : null;
}

// Anchors -------------------------------------------------------------------------------------------------------------

/** The block holding a position (its nearest ancestor with an ID). */
function blockIdAt(state: EditorState, pos: number): string | null {
  const $pos = state.doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d -= 1) {
    const node = $pos.node(d);
    if (ID_TYPES.has(node.type.name) && typeof node.attrs.id === 'string') return node.attrs.id;
  }
  return null;
}

/** The selected text to comment on, or why there is none: a text selection inside the note (one table cell at most). */
export function commentableSelection(state: EditorState): { from: number; to: number; quote: string; blockId: string | null } | { error: string } {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || selection.empty) return { error: COMMENT_MESSAGES.quoteNeeded };
  const quote = state.doc.textBetween(selection.from, selection.to, ' ', ' ').replace(/\s+/g, ' ').trim();
  if (quote === '') return { error: COMMENT_MESSAGES.quoteNeeded };
  return { from: selection.from, to: selection.to, quote: quote.slice(0, MAX_COMMENT_QUOTE), blockId: blockIdAt(state, selection.from) };
}

/** Marks a range with a thread (saved with the note, outside the undo history so undo does not orphan the thread). */
export function addCommentMark(editor: Editor, range: { from: number; to: number }, threadId: string): void {
  const type = editor.schema.marks.comment!;
  editor.view.dispatch(markPersistent(editor.state.tr.addMark(range.from, range.to, type.create({ threadId }))));
}

/** Removes a thread's mark wherever it is. */
export function removeCommentMark(editor: Editor, threadId: string): void {
  const ranges = threadRanges(editor.state.doc, threadId);
  if (ranges.length === 0) return;
  const type = editor.schema.marks.comment!;
  const tr = editor.state.tr;
  for (const r of ranges) tr.removeMark(r.from, r.to, type.create({ threadId }));
  editor.view.dispatch(markPersistent(tr));
}

/** The text ranges carrying a thread's mark, in document order (adjacent text merged). */
export function threadRanges(doc: PmNode, threadId: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    if (!node.marks.some((m) => isComment(m) && m.attrs.threadId === threadId)) return false;
    const last = ranges[ranges.length - 1];
    if (last && last.to === pos) last.to = pos + node.nodeSize;
    else ranges.push({ from: pos, to: pos + node.nodeSize });
    return false;
  });
  return ranges;
}

/** Every thread marked in a document. */
export function markedThreads(doc: PmNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (!node.isText) return true;
    for (const m of node.marks) if (isComment(m)) ids.add(m.attrs.threadId as string);
    return false;
  });
  return ids;
}

/** Selects the start of a thread's text, scrolls to it and flashes it; false when the text is gone. */
export function revealCommentMark(editor: Editor, threadId: string): boolean {
  const range = threadRanges(editor.state.doc, threadId)[0];
  if (!range) return false;
  const tr = commentLookMeta(editor.state, { active: threadId, flash: threadId }).setSelection(TextSelection.create(editor.state.doc, range.from, range.to)).scrollIntoView();
  editor.view.dispatch(tr);
  setTimeout(() => {
    if (!editor.isDestroyed && commentMarksKey.getState(editor.state)?.flash === threadId) editor.view.dispatch(commentLookMeta(editor.state, { flash: null }));
  }, COMMENT_FLASH_MS);
  return true;
}

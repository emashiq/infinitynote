import { TextSelection, type EditorState } from '@tiptap/pm/state';

export interface SlashMatch {
  /** The "/" position. */
  from: number;
  /** The cursor, at the end of the typed query. */
  to: number;
  query: string;
}

/** "/" at the start of a line or after a space, then up to 20 letters (with their marks) or digits, right before the cursor. */
const SLASH = /(?:^|\s)\/([\p{L}\p{M}\p{N}]{0,20})$/u;
/** Enough text before the cursor for the longest query and the character before its "/". */
const LOOK_BEHIND = 24;

/**
 * The "/" command the user is typing at the cursor, or null. Code blocks and selections never open the insert menu,
 * and "/" inside a word ("and/or", "10/9") is plain text.
 */
export function slashMatch(state: EditorState): SlashMatch | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  const start = Math.max($from.start(), $from.pos - LOOK_BEHIND);
  const match = SLASH.exec(state.doc.textBetween(start, $from.pos, undefined, '￼'));
  if (!match) return null;
  const query = match[1]!;
  return { from: $from.pos - query.length - 1, to: $from.pos, query };
}

import type { EditorState } from '@tiptap/pm/state';
import type { ReminderDtoType } from '../../shared/contracts/reminders';
import type { SuggestionListDismissedResponseType } from '../../shared/contracts/suggestions';
import { MAX_SELECTION_CHARS } from '../../shared/nlp/constants';
import { findCandidates } from '../../shared/nlp/parse';
import type { Candidate } from '../../shared/nlp/types';
import { UTC_ZONE } from '../../shared/time/zones';
import { closestToSource, manualTitleOf, withOrdinals, type CardCandidate, type CardRequest } from '../reminders/card-request';
import { textBlockAt, textBlocks, textOfBlock, type BlockText, type TextBlockRef } from './block-text';
import type { LiveCandidate } from './suggestions';

export const SELECT_ONE_PARAGRAPH = 'Select text within one paragraph.';
export const SELECT_SHORTER = 'Select a shorter part (up to 2,000 characters).';

/** The note a request is for. */
export interface NoteRef {
  noteId: string;
  noteTitle: string;
  format: 'rich' | 'plain';
}

/** What an ordinal counts over: the block in a rich note, the whole text in a plain note (plan section 9.9). */
export function ordinalScope(state: EditorState, format: 'rich' | 'plain', block: TextBlockRef): { text: string; lineStart: number } {
  if (format === 'rich') return { text: textOfBlock(block.node, block.pos + 1).text, lineStart: 0 };
  return { text: textBlocks(state.doc, 'plain').map((b) => b.node.textContent).join('\n'), lineStart: block.lineStart };
}

function baseRequest(note: NoteRef, block: TextBlockRef, blockText: string): Omit<CardRequest, 'candidates' | 'selected' | 'origin' | 'manualTitle'> {
  const blockId = note.format === 'rich' ? block.blockId : null;
  return { mode: 'create', noteId: note.noteId, noteTitle: note.noteTitle, format: note.format, blockId, blockText, reminder: null, manualBlockId: blockId };
}

/** A card for phrases already found in a block (the suggestion bar, or the phrase at the cursor). */
export function requestForCandidates(
  state: EditorState,
  note: NoteRef,
  block: TextBlockRef,
  candidates: readonly Candidate[],
  opts: { selected?: number; reminder?: ReminderDtoType | null } = {},
): CardRequest {
  const blockText = textOfBlock(block.node, block.pos + 1).text;
  const withOrdinal = withOrdinals(candidates, ordinalScope(state, note.format, block));
  const reminder = opts.reminder ?? null;
  return {
    ...baseRequest(note, block, blockText),
    mode: reminder ? 'update' : 'create',
    reminder,
    candidates: withOrdinal,
    selected: reminder ? closestToSource(withOrdinal, reminder.source) : (opts.selected ?? 0),
    origin: 'suggestion',
    manualTitle: manualTitleOf(blockText),
  };
}

/**
 * A live phrase where it is now: its block and its offsets read from its current positions (edits earlier in the
 * block move it), with its ordinal counted again. Null when its block is gone.
 */
export function placeLive(state: EditorState, format: 'rich' | 'plain', live: LiveCandidate): { block: TextBlockRef; text: BlockText; candidate: CardCandidate } | null {
  const block = textBlockAt(state.doc, format, live.from);
  if (!block) return null;
  const text = textOfBlock(block.node, block.pos + 1);
  const moved = { ...live.candidate, start: text.offsetAt(live.from), end: text.offsetAt(live.to) };
  const [candidate] = withOrdinals([{ ...moved, text: text.text.slice(moved.start, moved.end) }], ordinalScope(state, format, block));
  return { block, text, candidate: candidate! };
}

/** The card for the phrase under the cursor or in the suggestion bar; update mode for a changed source. */
export function requestForLive(state: EditorState, note: NoteRef, live: LiveCandidate, reminder: ReminderDtoType | null = null): CardRequest | null {
  const placed = placeLive(state, note.format, live);
  return placed ? requestForCandidates(state, note, placed.block, [placed.candidate], { reminder }) : null;
}

/** The reference context a phrase is read with: main's clock and zone (D-089). */
export function parseOptions(context: Pick<SuggestionListDismissedResponseType, 'asOf' | 'defaultZone'>, zoneId?: string | null) {
  return { referenceInstantUtc: context.asOf, zoneId: zoneId ?? context.defaultZone ?? UTC_ZONE };
}

/**
 * "Update from text…" (plan section 9.7): the reminder's phrase read again in its current text (the block, or a plain
 * note's whole text) against main's clock now and in the reminder's zone. Without a phrase the card opens for manual
 * entry; so does a note-level source in a rich note (a phrase needs a block there).
 */
export function updateRequestFromText(
  note: NoteRef,
  reminder: ReminderDtoType & { source: NonNullable<ReminderDtoType['source']> },
  text: string | null,
  context: Pick<SuggestionListDismissedResponseType, 'asOf' | 'defaultZone'>,
): CardRequest {
  const { source } = reminder;
  const readable = text !== null && (note.format === 'plain' || source.blockId !== null);
  const candidates = readable ? withOrdinals(findCandidates(text, parseOptions(context, reminder.zoneId)), { text, lineStart: 0 }) : [];
  return {
    mode: 'update',
    noteId: note.noteId,
    noteTitle: note.noteTitle,
    format: note.format,
    blockId: note.format === 'rich' ? source.blockId : null,
    blockText: text ?? '',
    candidates,
    selected: closestToSource(candidates, source),
    origin: source.origin,
    reminder,
    manualBlockId: reminder.blockId,
    manualTitle: reminder.title,
  };
}

export type TextRequest = { ok: true; request: CardRequest } | { ok: false; notice: string | null };

/**
 * More → "Create reminder from text" (plan section 9.5): the selection within one textblock (at most 2,000 characters),
 * else the whole textblock at the cursor. Phrases are read in that text against main's reference context; none found
 * opens the card for manual entry.
 */
export function requestFromText(state: EditorState, note: NoteRef, context: Pick<SuggestionListDismissedResponseType, 'asOf' | 'defaultZone'>): TextRequest {
  const { from, to, empty, $from, $to } = state.selection;
  if (!empty && !($from.sameParent($to) && $from.parent.isTextblock)) return { ok: false, notice: SELECT_ONE_PARAGRAPH };
  const block = textBlockAt(state.doc, note.format, from);
  if (!block) return { ok: false, notice: empty ? null : SELECT_ONE_PARAGRAPH };
  const text = textOfBlock(block.node, block.pos + 1);
  const [start, end] = empty ? [0, text.text.length] : [text.offsetAt(from), text.offsetAt(to)];
  if (end - start > MAX_SELECTION_CHARS) return { ok: false, notice: SELECT_SHORTER };
  const part = text.text.slice(start, end);
  const found = findCandidates(part, parseOptions(context)).map((c) => ({ ...c, start: c.start + start, end: c.end + start }));
  const candidates: CardCandidate[] = withOrdinals(found, ordinalScope(state, note.format, block));
  return {
    ok: true,
    request: { ...baseRequest(note, block, text.text), candidates, selected: 0, origin: 'selection', manualTitle: manualTitleOf(part) },
  };
}

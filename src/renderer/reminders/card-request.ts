import type { ReminderDtoType, SourceOriginType } from '../../shared/contracts/reminders';
import { MAX_MANUAL_TITLE } from '../../shared/nlp/constants';
import { normalizePhrase, spanOrdinal } from '../../shared/nlp/source-text';
import type { Candidate } from '../../shared/nlp/types';

/** A phrase offered by the card, with how many earlier occurrences of it the block (or plain note) holds. */
export interface CardCandidate extends Candidate {
  spanOrdinal: number;
}

/**
 * What the confirmation card opens with (plan section 9.6). Candidate offsets are relative to `blockText`: the block's
 * text in a rich note, the line in a plain-text note.
 */
export interface CardRequest {
  mode: 'create' | 'update';
  noteId: string;
  noteTitle: string;
  format: 'rich' | 'plain';
  /** The block the phrases are in; null in plain-text notes. */
  blockId: string | null;
  blockText: string;
  candidates: CardCandidate[];
  selected: number;
  origin: SourceOriginType;
  /** The reminder to update (update mode). */
  reminder: ReminderDtoType | null;
  /** Manual entry (no phrase found) anchors to this paragraph; null for note-level. */
  manualBlockId: string | null;
  /** Manual entry's title: the selected text or the paragraph. */
  manualTitle: string;
}

/**
 * Adds ordinals to phrases: `scope.text` is what the ordinal counts over (the block, or a plain note's whole text) and
 * `scope.lineStart` where the candidates' block or line starts in it.
 */
export function withOrdinals(candidates: readonly Candidate[], scope: { text: string; lineStart: number }): CardCandidate[] {
  return candidates.map((c) => ({ ...c, spanOrdinal: spanOrdinal(scope.text, scope.lineStart + c.start, c.text) }));
}

/** Manual entry's title from the selected text or paragraph (whitespace collapsed, at most 200 characters). */
export function manualTitleOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_MANUAL_TITLE);
}

/**
 * In update mode, the phrase that most likely replaced the reminder's source: one with the same text, else one at the
 * same ordinal, else the first.
 */
export function closestToSource(candidates: readonly CardCandidate[], source: ReminderDtoType['source']): number {
  if (!source || candidates.length === 0) return 0;
  const text = normalizePhrase(source.text);
  const sameText = candidates.findIndex((c) => normalizePhrase(c.text) === text);
  if (sameText >= 0) return sameText;
  return Math.max(0, candidates.findIndex((c) => c.spanOrdinal === source.spanOrdinal));
}

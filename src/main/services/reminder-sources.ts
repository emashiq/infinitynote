import { REMINDER_MESSAGES as M, type SourceStateType } from '../../shared/contracts/reminders';
import type { SuggestionSourceType } from '../../shared/contracts/suggestions';
import { collectBlockIds } from '../../shared/editor/doc-schema';
import { containsPhrase, occurrences, richBlockTexts, spanOrdinal } from '../../shared/nlp/source-text';
import type { ContentRow } from '../db/repositories/notes-repo';
import type { ReminderSourceRow } from '../db/repositories/reminder-sources-repo';
import { AppError } from './app-error';

const mismatch = () => new AppError('VALIDATION_FAILED', M.sourceMismatch, { sourceMismatch: true });
const wrongFormat = () => new AppError('VALIDATION_FAILED', M.sourceFormat, { sourceFormat: true });

/**
 * Checks a phrase against the stored note (plan section 8.3, D-092), inside the caller's transaction. Rich notes: the
 * block must be stored (else `blockMissing`, so the renderer saves and retries) and hold the phrase at the span with
 * the same ordinal. Plain-text notes carry no block or offsets: the text must hold more occurrences than the ordinal.
 */
export function checkSource(note: Pick<ContentRow, 'format' | 'content_json' | 'content_text'>, source: SuggestionSourceType): void {
  if (note.format === 'plain') {
    if (source.blockId !== null) throw wrongFormat();
    if (occurrences(note.content_text ?? '', source.text) <= source.spanOrdinal) throw mismatch();
    return;
  }
  if (source.blockId === null || source.spanStart === null || source.spanEnd === null) throw wrongFormat();
  const doc: unknown = JSON.parse(note.content_json ?? '{}');
  if (!collectBlockIds(doc).has(source.blockId)) throw new AppError('VALIDATION_FAILED', M.blockMissing, { blockMissing: true });
  const blockText = richBlockTexts(doc, new Set([source.blockId])).get(source.blockId);
  if (blockText === undefined || blockText.slice(source.spanStart, source.spanEnd) !== source.text) throw mismatch();
  if (spanOrdinal(blockText, source.spanStart, source.text) !== source.spanOrdinal) throw mismatch();
}

/**
 * The state of a tracked source after a content write (plan section 8.4): `missing` when its block is gone (or the note
 * became plain text), `ok` while the block (or, without a block, the note's text) still holds the phrase, else
 * `changed`. `blockTexts` holds the texts of the referenced blocks of a rich note.
 */
export function sourceStateFor(
  row: Pick<ReminderSourceRow, 'block_id' | 'source_text'>,
  content: { format: 'rich' | 'plain'; plainText: string; blockTexts: ReadonlyMap<string, string> },
): Exclude<SourceStateType, 'detached'> {
  if (row.block_id === null) return containsPhrase(content.plainText, row.source_text) ? 'ok' : 'changed';
  const text = content.format === 'rich' ? content.blockTexts.get(row.block_id) : undefined;
  if (text === undefined) return 'missing';
  return containsPhrase(text, row.source_text) ? 'ok' : 'changed';
}

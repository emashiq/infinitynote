import { MEMORY_NOTES } from '../../shared/nlp/constants';
import type { CardCandidate } from './card-request';

/** The phrases detected in one block (or plain-note line), with the text they were found in. */
export interface MemoryEntry {
  /** The block ID, or `line:<n>` in a plain-text note. */
  key: string;
  blockText: string;
  candidates: CardCandidate[];
}

/**
 * Detected phrases per note for the window session (D-091): an editor that mounts again (a tab switch, a reload) shows
 * the phrases of blocks whose text is unchanged. At most 20 notes, least recently used first out; never persisted.
 */
export class SuggestionMemory {
  private readonly notes = new Map<string, Map<string, MemoryEntry>>();

  /** Replaces the entries of the blocks a pass read (an entry without candidates removes the block). */
  store(noteId: string, entries: readonly MemoryEntry[]): void {
    const blocks = this.notes.get(noteId) ?? new Map<string, MemoryEntry>();
    for (const entry of entries) {
      if (entry.candidates.length > 0) blocks.set(entry.key, entry);
      else blocks.delete(entry.key);
    }
    this.notes.delete(noteId);
    this.notes.set(noteId, blocks);
    while (this.notes.size > MEMORY_NOTES) this.notes.delete(this.notes.keys().next().value!);
  }

  entries(noteId: string): MemoryEntry[] {
    return [...(this.notes.get(noteId)?.values() ?? [])];
  }

  /** Forgets one phrase (dismissed, or confirmed). */
  forget(noteId: string, key: string, candidate: Pick<CardCandidate, 'start' | 'end'>): void {
    const entry = this.notes.get(noteId)?.get(key);
    if (!entry) return;
    this.store(noteId, [{ ...entry, candidates: entry.candidates.filter((c) => c.start !== candidate.start || c.end !== candidate.end) }]);
  }
}

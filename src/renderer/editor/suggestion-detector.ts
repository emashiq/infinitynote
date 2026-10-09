import type { Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import type { ReminderDtoType } from '../../shared/contracts/reminders';
import { IDLE_MS, LONG_BLOCK_CHARS, LONG_BLOCK_WINDOW, MAX_BLOCKS_PER_PASS, SLICE_MS } from '../../shared/nlp/constants';
import { findCandidates, type ParseOptions } from '../../shared/nlp/parse';
import { resolveCandidate } from '../../shared/nlp/resolve-candidate';
import { normalizePhrase } from '../../shared/nlp/source-text';
import type { Candidate } from '../../shared/nlp/types';
import { localParts } from '../../shared/time/resolve';
import { withOrdinals, type CardCandidate } from '../reminders/card-request';
import type { SuggestionContext } from '../reminders/suggestion-context';
import type { MemoryEntry } from '../reminders/suggestion-memory';
import { realTimers, type Timers } from '../state/store';
import { textBlocks, textOfBlock, type TextBlockRef } from './block-text';
import { isUserEdit } from './content';
import { parseOptions, placeLive } from './suggestion-requests';
import { suggestionsMeta, suggestionsOf, touchesEdit, type LiveCandidate, type Range } from './suggestions';

export interface DetectorDeps {
  editor: Editor;
  noteId: string;
  format: 'rich' | 'plain';
  context: SuggestionContext;
  /** The note's live reminders: confirmed phrases are hidden, changed ones offer Update. */
  reminders: () => readonly ReminderDtoType[];
  /** Replaceable for tests (parse counts and budgets). */
  parse?: (text: string, opts: ParseOptions) => Candidate[];
  timers?: Timers;
  now?: () => number;
}

/** What one pass found in one block. */
interface BlockResult extends MemoryEntry {
  blockId: string | null;
  line: number;
}

const keyOf = (blockId: string | null, line: number) => blockId ?? `line:${line}`;

/** The changed offsets of a block, each widened to the window a long block is read in, merged. */
function windowsOf(changed: Array<{ start: number; end: number }>, length: number): Array<{ start: number; end: number }> {
  if (length <= LONG_BLOCK_CHARS) return [{ start: 0, end: length }];
  const windows: Array<{ start: number; end: number }> = [];
  for (const r of [...changed].sort((a, b) => a.start - b.start)) {
    const w = { start: Math.max(0, r.start - LONG_BLOCK_WINDOW), end: Math.min(length, r.end + LONG_BLOCK_WINDOW) };
    const last = windows[windows.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else windows.push(w);
  }
  return windows;
}

/** The textblocks the changed ranges touch, in document order (code blocks are not scanned automatically). */
function touchedBlocks(doc: PmNode, format: 'rich' | 'plain', changed: readonly Range[]): TextBlockRef[] {
  const size = doc.content.size;
  if (format === 'plain') {
    const lines = textBlocks(doc, 'plain');
    return lines.filter((b) => changed.some((r) => r.from <= b.pos + b.node.nodeSize && b.pos <= r.to)).slice(0, MAX_BLOCKS_PER_PASS);
  }
  const found = new Map<number, TextBlockRef>();
  for (const r of changed) {
    doc.nodesBetween(Math.max(0, r.from - 1), Math.min(size, r.to + 1), (node, pos) => {
      if (!node.isTextblock) return true;
      if (node.type.name !== 'codeBlock' && typeof node.attrs.id === 'string') found.set(pos, { node, pos, blockId: node.attrs.id, line: -1, lineStart: 0 });
      return false;
    });
    if (found.size >= MAX_BLOCKS_PER_PASS) break;
  }
  return [...found.values()].sort((a, b) => a.pos - b.pos).slice(0, MAX_BLOCKS_PER_PASS);
}

/**
 * Idle-time detection for one mounted editor (plan section 9.3, D-091): 1000 ms after the last user edit it reads the
 * blocks changed in this session, in slices of at most 8 ms, keeps the phrases the edits touched, hides dismissed and
 * confirmed ones, and applies them with one meta-only transaction. An edit during a pass stops it (finished blocks
 * whose text is unchanged are kept); nothing is applied during an IME composition, and focus is never taken.
 */
export class SuggestionDetector {
  private readonly parse: NonNullable<DetectorDeps['parse']>;
  private readonly timers: Timers;
  private readonly now: () => number;
  private timer: unknown = null;
  private running = false;
  private aborted = false;
  private waitForComposition = false;
  private disposed = false;
  private readonly offSettings: () => void;

  constructor(private readonly deps: DetectorDeps) {
    this.parse = deps.parse ?? findCandidates;
    this.timers = deps.timers ?? realTimers;
    this.now = deps.now ?? (() => performance.now());
    deps.editor.on('transaction', this.onTransaction);
    deps.editor.view.dom.addEventListener('compositionend', this.onCompositionEnd);
    let enabled = this.enabled();
    this.offSettings = deps.context.settings.subscribe(() => {
      const now = this.enabled();
      if (enabled && !now) this.switchOff();
      enabled = now;
    });
    if (enabled) this.restore();
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
    this.offSettings();
    this.deps.editor.off('transaction', this.onTransaction);
    this.deps.editor.view.dom.removeEventListener('compositionend', this.onCompositionEnd);
  }

  private enabled(): boolean {
    return this.deps.context.settings.getState().suggestFromText;
  }

  private get view() {
    return this.deps.editor.view;
  }

  private onTransaction = ({ transaction }: { transaction: Transaction }): void => {
    if (!isUserEdit(transaction) || !this.enabled()) return;
    if (this.running) this.aborted = true;
    this.schedule();
  };

  private onCompositionEnd = (): void => {
    if (!this.waitForComposition) return;
    this.waitForComposition = false;
    this.schedule();
  };

  private cancelTimer(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.cancelTimer();
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      if (this.running) return;
      if (this.view.composing) this.waitForComposition = true;
      else void this.pass();
    }, IDLE_MS);
  }

  /** The setting was switched off: no passes, no underlines. */
  private switchOff(): void {
    this.cancelTimer();
    if (!this.deps.editor.isDestroyed) this.view.dispatch(suggestionsMeta(this.view.state, { type: 'set', candidates: [], clearChanged: true }));
  }

  /** One detection pass; resolves when its results were applied (or dropped). */
  async pass(): Promise<void> {
    this.running = true;
    try {
      const context = await this.deps.context.load(this.deps.noteId);
      if (!context || this.disposed || !this.enabled()) return;
      this.aborted = false;
      const opts = parseOptions(context);
      const state = this.view.state;
      const { changed } = suggestionsOf(state);
      if (changed.length === 0) return;
      const fullText = this.deps.format === 'plain' ? textBlocks(state.doc, 'plain').map((b) => b.node.textContent).join('\n') : '';
      const results: BlockResult[] = [];
      let sliceStart = this.now();
      for (const block of touchedBlocks(state.doc, this.deps.format, changed)) {
        if (this.aborted || this.disposed) break;
        results.push(this.readBlock(block, changed, opts, fullText));
        if (this.now() - sliceStart >= SLICE_MS) {
          await new Promise<void>((resolve) => this.timers.setTimeout(resolve, 0));
          sliceStart = this.now();
        }
      }
      if (!this.disposed) this.apply(results);
    } finally {
      this.running = false;
      if (this.aborted && !this.disposed) this.schedule();
    }
  }

  private readBlock(block: TextBlockRef, changed: readonly Range[], opts: ParseOptions, fullText: string): BlockResult {
    const text = textOfBlock(block.node, block.pos + 1);
    const end = block.pos + block.node.nodeSize;
    const edits = changed.filter((r) => r.from <= end && block.pos <= r.to).map((r) => ({ start: text.offsetAt(r.from), end: text.offsetAt(r.to) }));
    const found: Candidate[] = [];
    for (const w of windowsOf(edits, text.text.length)) {
      for (const c of this.parse(text.text.slice(w.start, w.end), opts)) found.push({ ...c, start: c.start + w.start, end: c.end + w.start });
    }
    const touched = found.filter((c) => edits.some((r) => touchesEdit({ from: c.start, to: c.end }, { from: r.start, to: r.end })));
    const scope = this.deps.format === 'rich' ? { text: text.text, lineStart: 0 } : { text: fullText, lineStart: block.lineStart };
    return { key: keyOf(block.blockId, block.line), blockId: block.blockId, line: block.line, blockText: text.text, candidates: withOrdinals(touched, scope) };
  }

  /** Applies results for blocks whose text is still what was read; never during a composition. */
  private apply(results: readonly BlockResult[]): void {
    if (results.length === 0 || this.deps.editor.isDestroyed) return;
    if (this.view.composing) {
      this.waitForComposition = true;
      return;
    }
    const applied = this.place(results);
    if (applied.blocks.length === 0) return;
    this.view.dispatch(suggestionsMeta(this.view.state, { type: 'apply', blocks: applied.blocks, candidates: applied.candidates }));
    this.remember(applied.keys);
  }

  /** Stores what the given blocks show now (earlier phrases included) for a remount. */
  private remember(keys: ReadonlySet<string>): void {
    const state = this.view.state;
    const entries = new Map<string, MemoryEntry>();
    for (const b of textBlocks(state.doc, this.deps.format)) {
      const key = keyOf(b.blockId, b.line);
      if (keys.has(key)) entries.set(key, { key, blockText: textOfBlock(b.node, b.pos + 1).text, candidates: [] });
    }
    for (const live of suggestionsOf(state).candidates) {
      const placed = placeLive(state, this.deps.format, live);
      const entry = placed && entries.get(keyOf(placed.block.blockId, placed.block.line));
      if (entry) entry.candidates.push(placed.candidate);
    }
    this.deps.context.memory.store(this.deps.noteId, [...entries.values()]);
  }

  /** Document positions for block results whose text is unchanged, with suppression applied. */
  private place(results: readonly MemoryEntry[]): { blocks: Range[]; candidates: LiveCandidate[]; keys: Set<string> } {
    const state = this.view.state;
    const current = new Map(textBlocks(state.doc, this.deps.format).map((b) => [keyOf(b.blockId, b.line), b]));
    const filter = this.suppression();
    const blocks: Range[] = [];
    const candidates: LiveCandidate[] = [];
    const keys = new Set<string>();
    for (const result of results) {
      const block = current.get(result.key);
      if (!block) continue;
      const text = textOfBlock(block.node, block.pos + 1);
      if (text.text !== result.blockText) continue;
      keys.add(result.key);
      blocks.push({ from: block.pos, to: block.pos + block.node.nodeSize });
      for (const c of result.candidates) {
        const shown = filter(block.blockId, c);
        if (shown) candidates.push({ ...shown, id: `${result.key}@${c.start}-${c.end}`, from: text.posAt(c.start), to: text.posAt(c.end), blockId: block.blockId, line: block.line, candidate: c });
      }
    }
    return { blocks, candidates, keys };
  }

  /**
   * Hides dismissed phrases (same block, phrase, ordinal and reference date) and phrases already confirmed (a linked
   * source in state `ok`); a phrase in the block of a changed source offers to update that reminder (D-092).
   */
  private suppression(): (blockId: string | null, c: CardCandidate) => Pick<LiveCandidate, 'needsChoice' | 'updateFor'> | null {
    const dismissed = new Set(this.deps.context.dismissalsOf(this.deps.noteId).map((d) => `${d.blockId ?? ''}|${d.text}|${d.spanOrdinal}|${d.referenceDate}`));
    const confirmed = new Set<string>();
    const changed = new Map<string, string>();
    for (const r of this.deps.reminders()) {
      if (r.source?.state === 'ok') confirmed.add(`${r.source.blockId ?? ''}|${normalizePhrase(r.source.text)}|${r.source.spanOrdinal}`);
      if (r.source?.state === 'changed') changed.set(r.source.blockId ?? '', r.id);
    }
    const { endOfDayTime, dateOnlyTime } = this.deps.context.settings.getState();
    return (blockId, c) => {
      const phrase = `${blockId ?? ''}|${normalizePhrase(c.text)}|${c.spanOrdinal}`;
      const referenceDate = localParts(c.referenceInstantUtc, c.parseZone).date;
      if (dismissed.has(`${phrase}|${referenceDate}`) || confirmed.has(phrase)) return null;
      const needsChoice = resolveCandidate(c, { zoneId: c.parseZone, choices: {}, endOfDayTime, dateOnlyTime }).status === 'needsChoice';
      return { needsChoice, updateFor: changed.get(blockId ?? '') ?? null };
    };
  }

  /** On mount: the phrases this window found earlier in blocks whose text is unchanged. */
  private restore(): void {
    const entries = this.deps.context.memory.entries(this.deps.noteId);
    if (entries.length === 0) return;
    const placed = this.place(entries);
    if (placed.candidates.length > 0) this.view.dispatch(suggestionsMeta(this.view.state, { type: 'set', candidates: placed.candidates }));
  }

  /** The note's reminders or dismissals changed: confirmed phrases disappear, changed sources offer Update. */
  refresh(): void {
    if (this.deps.editor.isDestroyed) return;
    const filter = this.suppression();
    const live = suggestionsOf(this.view.state).candidates;
    const next = live.flatMap((c) => {
      const shown = filter(c.blockId, c.candidate);
      return shown ? [{ ...c, ...shown }] : [];
    });
    const same = next.length === live.length && next.every((c, i) => c.updateFor === live[i]!.updateFor);
    if (!same) this.view.dispatch(suggestionsMeta(this.view.state, { type: 'set', candidates: next }));
  }

  /** Dismiss from the bar: stored in main, then removed here at once. False when main refused it. */
  async dismiss(live: LiveCandidate): Promise<boolean> {
    const c = placeLive(this.view.state, this.deps.format, live)?.candidate ?? live.candidate;
    const ok = await this.deps.context.dismiss({
      noteId: this.deps.noteId,
      blockId: live.blockId,
      text: c.text,
      spanOrdinal: c.spanOrdinal,
      referenceDate: localParts(c.referenceInstantUtc, c.parseZone).date,
    });
    if (!ok) return false;
    this.deps.context.memory.forget(this.deps.noteId, keyOf(live.blockId, live.line), c);
    if (!this.deps.editor.isDestroyed) {
      const rest = suggestionsOf(this.view.state).candidates.filter((x) => x.id !== live.id);
      this.view.dispatch(suggestionsMeta(this.view.state, { type: 'set', candidates: rest }));
    }
    return true;
  }
}

// @vitest-environment jsdom
import type { Content, Editor } from '@tiptap/core';
import { undoDepth } from '@tiptap/pm/history';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReminderDtoType } from '../../../../src/shared/contracts/reminders';
import { findCandidates, type ParseOptions } from '../../../../src/shared/nlp/parse';
import { isUserEdit } from '../../../../src/renderer/editor/content';
import { SuggestionDetector } from '../../../../src/renderer/editor/suggestion-detector';
import { barText } from '../../../../src/renderer/editor/SuggestionBar';
import { suggestionsOf, type LiveCandidate } from '../../../../src/renderer/editor/suggestions';
import { SuggestionContext } from '../../../../src/renderer/reminders/suggestion-context';
import { createFakeBridge } from '../support/fake-bridge';
import { makeEditor, pasteHtml, tick } from './support';

const NOTE = '0f8fad5b-d9cb-469f-a165-70867728950e';

interface Setup {
  editor: Editor;
  detector: SuggestionDetector;
  context: SuggestionContext;
  parsed: string[];
  updates: import('@tiptap/pm/state').Transaction[];
  fake: ReturnType<typeof createFakeBridge>;
  reminders: ReminderDtoType[];
}

const detectors: SuggestionDetector[] = [];
afterEach(() => {
  for (const d of detectors.splice(0)) d.dispose();
  vi.useRealTimers();
});

async function setup(opts: { content?: Content; format?: 'rich' | 'plain'; context?: SuggestionContext; fake?: ReturnType<typeof createFakeBridge> } = {}): Promise<Setup> {
  const { editor, updates } = makeEditor({ format: opts.format, content: opts.content ?? '<p></p>' });
  await tick();
  const fake = opts.fake ?? createFakeBridge();
  const context = opts.context ?? new SuggestionContext(fake.bridge);
  const parsed: string[] = [];
  const reminders: ReminderDtoType[] = [];
  const parse = (text: string, o: ParseOptions) => {
    parsed.push(text);
    return findCandidates(text, o);
  };
  const detector = new SuggestionDetector({ editor, noteId: NOTE, format: opts.format ?? 'rich', context, reminders: () => reminders, parse });
  detectors.push(detector);
  return { editor, detector, context, parsed, updates, fake, reminders };
}

/** Types like a user: one transaction per character at the end of the first paragraph (or at `pos`). */
function type(editor: Editor, text: string, pos?: number): void {
  let at = pos ?? editor.state.doc.firstChild!.nodeSize - 1;
  for (const ch of text) {
    editor.view.dispatch(editor.state.tr.insertText(ch, at));
    at += 1;
  }
}

const underlined = (editor: Editor) => suggestionsOf(editor.state).candidates.map((c) => editor.state.doc.textBetween(c.from, c.to));
const domUnderlines = (editor: Editor) => [...editor.view.dom.querySelectorAll('.nlp-candidate')].map((e) => e.textContent);

describe('suggestion detection (INF-SUG-01, D-091)', () => {
  it('underlines a typed phrase only after 1000 ms of idle time, without changing the document, history or save state', async () => {
    const t = await setup();
    vi.useFakeTimers();
    type(t.editor, 'Have to submit this by tomorrow end of the day');
    const json = JSON.stringify(t.editor.getJSON());
    const depth = undoDepth(t.editor.state);
    const edits = t.updates.length;
    await vi.advanceTimersByTimeAsync(999);
    expect(underlined(t.editor)).toEqual([]);
    const transactions: import('@tiptap/pm/state').Transaction[] = [];
    t.editor.on('transaction', ({ transaction }) => transactions.push(transaction));
    await vi.advanceTimersByTimeAsync(50);
    expect(underlined(t.editor)).toEqual(['tomorrow end of the day']);
    expect(domUnderlines(t.editor)).toEqual(['tomorrow end of the day']);
    expect(t.editor.view.dom.querySelector('.nlp-candidate')!.getAttribute('title')).toBe('Reminder suggestion');
    expect(JSON.stringify(t.editor.getJSON())).toBe(json);
    expect(undoDepth(t.editor.state)).toBe(depth);
    expect(transactions.length).toBeGreaterThan(0);
    expect(transactions.every((tr) => !tr.docChanged && !isUserEdit(tr) && tr.getMeta('addToHistory') === false)).toBe(true);
    expect(t.updates.length).toBe(edits);
  });

  it('typing again restarts the idle timer; an edit during a pass stops it and the next pass reads the new text', async () => {
    const t = await setup();
    vi.useFakeTimers();
    type(t.editor, 'Call the bank tomorrow');
    await vi.advanceTimersByTimeAsync(800);
    type(t.editor, ' at 5pm');
    await vi.advanceTimersByTimeAsync(800);
    expect(underlined(t.editor)).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    expect(underlined(t.editor)).toEqual(['tomorrow at 5pm']);

    const pass = t.detector.pass();
    type(t.editor, ' and Friday');
    await pass;
    await vi.advanceTimersByTimeAsync(1100);
    expect(underlined(t.editor)).toEqual(['tomorrow at 5pm', 'Friday']);
  });

  it('nothing is applied during an IME composition; it is applied after compositionend', async () => {
    const t = await setup();
    vi.useFakeTimers();
    let composing = true;
    Object.defineProperty(t.editor.view, 'composing', { get: () => composing, configurable: true });
    type(t.editor, 'Pay rent tomorrow');
    await vi.advanceTimersByTimeAsync(2000);
    expect(underlined(t.editor)).toEqual([]);
    composing = false;
    t.editor.view.dom.dispatchEvent(new Event('compositionend'));
    await vi.advanceTimersByTimeAsync(1100);
    expect(underlined(t.editor)).toEqual(['tomorrow']);
  });

  it('only phrases the edits touched: old text is never suggested, an edit inside a phrase is', async () => {
    const t = await setup({ content: '<p>Pay rent on Oct 20. Then more</p>' });
    type(t.editor, ' words');
    await t.detector.pass();
    expect(underlined(t.editor)).toEqual([]);
    expect(t.parsed).toHaveLength(1);
    const two = t.editor.state.doc.textContent.indexOf('20') + 1;
    t.editor.view.dispatch(t.editor.state.tr.insertText('1', two + 1, two + 2));
    await t.detector.pass();
    expect(underlined(t.editor)).toEqual(['Oct 21']);
  });

  it('opening a note never suggests its text; the setting switched off stops passes and clears underlines', async () => {
    const t = await setup({ content: '<p>Call the bank tomorrow</p>' });
    await t.detector.pass();
    expect(t.parsed).toEqual([]);
    type(t.editor, ' and Friday');
    await t.detector.pass();
    expect(underlined(t.editor)).toEqual(['Friday']);
    t.context.applySetting('reminders.suggestFromText', false);
    expect(underlined(t.editor)).toEqual([]);
    vi.useFakeTimers();
    type(t.editor, ' next Monday');
    await vi.advanceTimersByTimeAsync(2000);
    expect(underlined(t.editor)).toEqual([]);
    expect(t.parsed).toHaveLength(1);
  });

  it('plain-text notes are read per line', async () => {
    const t = await setup({ format: 'plain', content: '<p>first line</p><p>second</p>' });
    type(t.editor, ' tomorrow', t.editor.state.doc.content.size - 1);
    await t.detector.pass();
    expect(underlined(t.editor)).toEqual(['tomorrow']);
    expect(suggestionsOf(t.editor.state).candidates[0]).toMatchObject({ blockId: null, line: 1, candidate: { start: 7, end: 15, spanOrdinal: 0 } });
  });

  it('suppression: dismissed and confirmed phrases are hidden; a changed source offers Update; another day is not suppressed', async () => {
    const fake = createFakeBridge();
    const t = await setup({ fake, content: '<p>x</p>' });
    const blockId = t.editor.state.doc.firstChild!.attrs.id as string;
    type(t.editor, ' tomorrow and Friday and next Monday');
    await t.detector.pass();
    expect(underlined(t.editor)).toEqual(['tomorrow', 'Friday', 'next Monday']);
    const [tomorrow, friday] = suggestionsOf(t.editor.state).candidates;
    expect(await t.detector.dismiss(tomorrow!)).toBe(true);
    expect(fake.callsTo('suggestion:dismiss').map((c) => c.req)).toEqual([{ noteId: NOTE, blockId, text: 'tomorrow', spanOrdinal: 0, referenceDate: '2026-10-08' }]);
    expect(underlined(t.editor)).toEqual(['Friday', 'next Monday']);

    const source = (text: string, state: 'ok' | 'changed') => ({ blockId, text, spanOrdinal: 0, origin: 'suggestion' as const, state, referenceInstantUtc: 0, referenceZone: 'Asia/Dhaka' });
    t.reminders.push({ id: 'r-ok', source: source('FRIDAY', 'ok') } as unknown as ReminderDtoType);
    t.detector.refresh();
    expect(underlined(t.editor)).toEqual(['next Monday']);
    t.reminders.push({ id: 'r-changed', source: source('Thursday', 'changed') } as unknown as ReminderDtoType);
    t.detector.refresh();
    expect(suggestionsOf(t.editor.state).candidates.map((c) => c.updateFor)).toEqual(['r-changed']);
    void friday;

    // Read again on the same reference date the dismissed phrase stays hidden; on another date it shows.
    const touchTomorrow = async () => {
      type(t.editor, ' ', 3);
      t.editor.view.dispatch(t.editor.state.tr.delete(3, 4));
      await t.detector.pass();
    };
    await touchTomorrow();
    expect(t.parsed.at(-1)).toContain('tomorrow');
    expect(underlined(t.editor)).not.toContain('tomorrow');
    fake.data.reminders.zones = { ...fake.data.reminders.zones, asOf: Date.parse('2026-10-09T07:00:00Z') };
    await touchTomorrow();
    expect(underlined(t.editor)).toContain('tomorrow');
  });

  it('candidates survive a remount in the same window session when their block is unchanged', async () => {
    const context = new SuggestionContext(createFakeBridge().bridge);
    const first = await setup({ context });
    type(first.editor, 'Pay rent tomorrow');
    await first.detector.pass();
    const json = first.editor.getJSON();
    first.detector.dispose();
    const { editor } = makeEditor({ content: json });
    await tick();
    const again = new SuggestionDetector({ editor, noteId: NOTE, format: 'rich', context, reminders: () => [] });
    detectors.push(again);
    expect(underlined(editor)).toEqual(['tomorrow']);
    const { editor: changedEditor } = makeEditor({ content: { ...json, content: [{ ...json.content![0]!, content: [{ type: 'text', text: 'Pay rent soon' }] }] } });
    await tick();
    detectors.push(new SuggestionDetector({ editor: changedEditor, noteId: NOTE, format: 'rich', context, reminders: () => [] }));
    expect(underlined(changedEditor)).toEqual([]);
  });
});

/** A rich document of paragraphs that already carry block IDs (as a stored note does). */
function storedDoc(texts: string[]) {
  return { type: 'doc', content: texts.map((text) => ({ type: 'paragraph', attrs: { id: crypto.randomUUID() }, content: [{ type: 'text', text }] })) };
}

describe('detection budgets (plan section 9.4)', () => {
  it('one keystroke in a 10,000-paragraph note parses exactly one block, within 50 ms', async () => {
    const t = await setup({ content: storedDoc(Array.from({ length: 10_000 }, (_, i) => `Paragraph ${i} due tomorrow`)) });
    type(t.editor, '!');
    const started = performance.now();
    await t.detector.pass();
    const ms = performance.now() - started;
    expect(t.parsed).toEqual(['Paragraph 0 due tomorrow!']);
    expect(ms).toBeLessThan(50);
    console.log(`budget: 10,000 paragraphs, 1 keystroke: ${t.parsed.length} block parsed in ${ms.toFixed(1)} ms`);
  });

  it('a paste of over 64 KiB is not scanned automatically', async () => {
    const t = await setup();
    const html = Array.from({ length: 12_000 }, (_, i) => `<p>Pasted ${i} tomorrow</p>`).join('');
    expect(html.length).toBeGreaterThan(65_536);
    pasteHtml(t.editor, html);
    expect(t.editor.state.doc.childCount).toBeGreaterThanOrEqual(12_000);
    await t.detector.pass();
    expect(t.parsed).toEqual([]);
    expect(underlined(t.editor)).toEqual([]);
  });

  it('an edit in the middle of a 6,000-character paragraph reads only the window around it', async () => {
    const long = `${'word '.repeat(600)}${'more '.repeat(600)}`;
    const t = await setup({ content: storedDoc([long]) });
    type(t.editor, 'tomorrow ', 3001);
    await t.detector.pass();
    expect(t.parsed).toHaveLength(1);
    expect(t.parsed[0]!.length).toBeLessThanOrEqual(2 * 300 + 'tomorrow '.length);
    expect(underlined(t.editor)).toEqual(['tomorrow']);
  });
});

describe('suggestion bar text (UX_SPEC section 5)', () => {
  const live = (text: string): LiveCandidate => {
    const [candidate] = findCandidates(text, { referenceInstantUtc: Date.parse('2026-10-08T07:00:00Z'), zoneId: 'Asia/Dhaka' });
    return { id: 'x', from: 1, to: 2, blockId: null, line: 0, needsChoice: false, updateFor: null, candidate: { ...candidate!, spanOrdinal: 0 } };
  };
  const settings = { endOfDayTime: '17:00', dateOnlyTime: '09:00' };
  it('the due time in the phrase zone, "(past)", or a choice to make', () => {
    expect(barText(live('tomorrow end of the day'), settings)).toBe('Reminder: Fri 9 Oct, 17:00');
    expect(barText(live('on Oct 1'), settings)).toBe('Reminder: Thu 1 Oct, 09:00 (past)');
    expect(barText(live('03/04 at 5'), settings)).toBe('Reminder: needs a choice');
    expect(barText(live('tomorrow'), { ...settings, dateOnlyTime: '07:45' })).toBe('Reminder: Fri 9 Oct, 07:45');
  });
});

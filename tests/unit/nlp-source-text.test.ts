import { describe, expect, it } from 'vitest';
import { containsPhrase, normalizePhrase, occurrences, richBlockText, richBlockTexts, spanOrdinal } from '../../src/shared/nlp/source-text';
import { titleFor } from '../../src/shared/nlp/title';
import { formatDayMonth, formatLongDate } from '../../src/shared/time/format';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const LI = '33333333-3333-4333-8333-333333333333';
const IMG = '44444444-4444-4444-8444-444444444444';
const ATT = '55555555-5555-4555-8555-555555555555';

const text = (t: string, marks?: unknown[]) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });

describe('source text (D-092)', () => {
  it('normalizes phrases for dismissals: NFC, whitespace collapsed, trimmed, lower case', () => {
    expect(normalizePhrase('  Tomorrow \n End\tof the day ')).toBe('tomorrow end of the day');
    expect(normalizePhrase('Café')).toBe('café');
  });

  it('counts earlier non-overlapping occurrences, ignoring case', () => {
    const t = 'Tomorrow call; tomorrow again; TOMORROW';
    expect(spanOrdinal(t, 0, 'tomorrow')).toBe(0);
    expect(spanOrdinal(t, 15, 'tomorrow')).toBe(1);
    expect(spanOrdinal(t, 31, 'tomorrow')).toBe(2);
    expect(occurrences(t, 'TOMORROW')).toBe(3);
    // Non-overlapping, stepping by the phrase length: "aaaa" holds "aa" twice, not three times.
    expect(occurrences('aaaa', 'aa')).toBe(2);
    expect(spanOrdinal('aaaa', 2, 'aa')).toBe(1);
    expect(occurrences('anything', '')).toBe(0);
  });

  it('keeps indices for characters whose lower case changes length', () => {
    const t = 'İstanbul on Friday';
    expect(spanOrdinal(t, 12, 'Friday')).toBe(0);
    expect(containsPhrase(t, 'friday')).toBe(true);
    expect(containsPhrase(t, 'monday')).toBe(false);
  });

  it('reads a textblock as the editor shows it: marks ignored, a hard break is a newline', () => {
    const para = { type: 'paragraph', attrs: { id: P1 }, content: [text('Pay '), text('rent', [{ type: 'bold' }]), { type: 'hardBreak' }, text('tomorrow')] };
    expect(richBlockText(para)).toBe('Pay rent\ntomorrow');
    expect(richBlockText({ type: 'paragraph' })).toBe('');
  });

  it('reads the asked-for textblocks in one walk; containers, images and absent ids are left out', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: P1, level: 1 }, content: [text('Plan for Friday')] },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', attrs: { id: LI }, content: [{ type: 'paragraph', attrs: { id: P2 }, content: [text('call Bob tomorrow')] }] }],
        },
        { type: 'image', attrs: { id: IMG, attachmentId: ATT } },
      ],
    };
    const texts = richBlockTexts(doc, new Set([P1, P2, LI, IMG, ATT]));
    expect(Object.fromEntries(texts)).toEqual({ [P1]: 'Plan for Friday', [P2]: 'call Bob tomorrow' });
  });
});

describe('titles (D-093)', () => {
  it('removes the phrase and one connector before it', () => {
    expect(titleFor('Have to submit this by tomorrow end of the day', { start: 23, end: 46 }, '')).toBe('Have to submit this');
    expect(titleFor('Pay rent on Oct 20', { start: 12, end: 18 }, '')).toBe('Pay rent');
  });

  it('removes a connector after the phrase only at the end of the text', () => {
    expect(titleFor('tomorrow at', { start: 0, end: 8 }, '')).toBe('');
    expect(titleFor('Tomorrow: at least call Bob', { start: 0, end: 8 }, '')).toBe('at least call Bob');
  });

  it('trims punctuation, collapses spaces and falls back when nothing is left', () => {
    expect(titleFor('tomorrow -  call   Bob,', { start: 0, end: 8 }, '')).toBe('call Bob');
    expect(titleFor('by tomorrow', { start: 3, end: 11 }, 'My note')).toBe('My note');
  });

  it('cuts long titles at 120 characters on a word boundary', () => {
    const long = `${'word '.repeat(40)}tomorrow`;
    const title = titleFor(long, { start: long.length - 8, end: long.length }, '');
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith('word…')).toBe(true);
  });
});

describe('date lines for the card', () => {
  it('full weekday dates and day-month labels in English whatever the locale', () => {
    expect(formatLongDate('2026-10-09')).toBe('Friday, 9 October 2026');
    expect(formatLongDate('2026-10-20')).toBe('Tuesday, 20 October 2026');
    expect(formatDayMonth(3, 4)).toBe('4 March');
    expect(formatDayMonth(4, 3)).toBe('3 April');
  });
});

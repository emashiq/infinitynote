// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReminderDtoType } from '../../../src/shared/contracts/reminders';
import { findCandidates } from '../../../src/shared/nlp/parse';
import { withOrdinals, type CardRequest } from '../../../src/renderer/reminders/card-request';
import { PAST_TEXT } from '../../../src/renderer/reminders/reminder-form';
import { SuggestionCard } from '../../../src/renderer/reminders/SuggestionCard';
import {
  cardProblem,
  cardReducer,
  disclosureText,
  EXISTS,
  initialCard,
  NO_PHRASE,
  toCreateRequest,
  type CardAction,
  type CardContext,
  type CardState,
} from '../../../src/renderer/reminders/suggestion-form';
import { createFakeBridge, type FakeBridge } from './support/fake-bridge';

const NOTE = '0f8fad5b-d9cb-469f-a165-70867728950e';
const BLOCK = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const R = Date.parse('2026-10-08T07:00:00Z');
const ZONES = { zones: ['America/Chicago', 'America/New_York', 'Asia/Dhaka', 'UTC'], systemZone: 'Asia/Dhaka', defaultZone: 'Asia/Dhaka', asOf: R };
const followupDefault = { enabled: true, intervalMinutes: 15 as const, maxFollowups: 2 as const };

/** A card request for the phrases of `text`, read at R in Dhaka, as the editor builds it for a rich block. */
function request(text: string, over: Partial<CardRequest> = {}): CardRequest {
  const candidates = withOrdinals(findCandidates(text, { referenceInstantUtc: R, zoneId: 'Asia/Dhaka' }), { text, lineStart: 0 });
  return { mode: 'create', noteId: NOTE, noteTitle: 'Work', format: 'rich', blockId: BLOCK, blockText: text, candidates, selected: 0, origin: 'suggestion', reminder: null, manualBlockId: BLOCK, manualTitle: text, ...over };
}

function card(text: string, over: Partial<CardRequest> = {}) {
  const ctx: CardContext = { request: request(text, over), zones: ZONES, followupDefault, endOfDayTime: '17:00', dateOnlyTime: '09:00' };
  let state: CardState = initialCard(ctx);
  return {
    ctx,
    get state() {
      return state;
    },
    act(action: CardAction) {
      state = cardReducer(ctx, state, action);
      return state;
    },
  };
}

describe('suggestion card rules (plan section 9.6, D-093)', () => {
  it('a phrase fills title, date, time and zone and discloses the default time', () => {
    const c = card('Have to submit this by tomorrow end of the day');
    expect(c.state.form).toMatchObject({ title: 'Have to submit this', date: '2026-10-09', time: '17:00', zoneId: 'Asia/Dhaka', repeat: 'none', followupOn: true });
    expect(disclosureText(c.ctx, c.state)).toBe('17:00 (default end of day)');
    expect(cardProblem(c.ctx, c.state)).toBeNull();
    expect(disclosureText(card('Call the bank tomorrow').ctx, card('Call the bank tomorrow').state)).toBe('09:00 (default time for date-only phrases)');
    const tonight = card('Movie tonight');
    expect(disclosureText(tonight.ctx, tonight.state)).toBe('20:00 (default for “tonight”)');
  });

  it('the gate names the first missing choice: zone, then date order, then AM or PM, then the time, then the title', () => {
    const ambiguous = card('Meet 03/04 at 5');
    expect(cardProblem(ambiguous.ctx, ambiguous.state)).toBe('Choose the date order');
    ambiguous.act({ type: 'choice', choices: { order: 'swapped' } });
    expect(cardProblem(ambiguous.ctx, ambiguous.state)).toBe('Choose AM or PM');
    ambiguous.act({ type: 'choice', choices: { meridiem: 'pm' } });
    expect(ambiguous.state.form).toMatchObject({ date: '2026-04-03', time: '17:00' });
    expect(cardProblem(ambiguous.ctx, ambiguous.state)).toBeNull();
    ambiguous.act({ type: 'fields', patch: { title: '  ' } });
    expect(cardProblem(ambiguous.ctx, ambiguous.state)).toBe('Enter a title');

    const cst = card('Report by 5 CST');
    expect(cst.state.form.zoneId).toBe('');
    expect(cardProblem(cst.ctx, cst.state)).toBe('Choose a time zone');
    cst.act({ type: 'zone', zoneId: 'America/Chicago' });
    expect(cardProblem(cst.ctx, cst.state)).toBe('Choose AM or PM');

    const midnight = card('Deploy tomorrow midnight');
    expect(cardProblem(midnight.ctx, midnight.state)).toBe('Enter a time');
    midnight.act({ type: 'time', value: '23:30' });
    expect(midnight.state.form).toMatchObject({ date: '2026-10-09', time: '23:30' });
    expect(cardProblem(midnight.ctx, midnight.state)).toBeNull();
  });

  it('a zone change reads the phrase again in that zone, until the user types a date or time', () => {
    const c = card('Have to submit this by tomorrow end of the day');
    c.act({ type: 'zone', zoneId: 'America/New_York' });
    expect(c.state.form).toMatchObject({ date: '2026-10-09', time: '17:00', zoneId: 'America/New_York' });
    expect(toCreateRequest(c.ctx, c.state, false)).toMatchObject({ zoneId: 'America/New_York', date: '2026-10-09', time: '17:00' });
    c.act({ type: 'time', value: '10:00' });
    expect(disclosureText(c.ctx, c.state)).toBeNull();
    c.act({ type: 'zone', zoneId: 'Asia/Dhaka' });
    expect(c.state.form).toMatchObject({ time: '10:00', zoneId: 'Asia/Dhaka' });
    const duration = card('Call back in 2 hours');
    duration.act({ type: 'zone', zoneId: 'America/New_York' });
    expect(duration.state.form).toMatchObject({ date: '2026-10-08', time: '05:00' });
  });

  it('the create request carries the literal phrase, its span, ordinal, reference and the chosen zone, never an instant', () => {
    const c = card('Have to submit this by tomorrow end of the day');
    expect(toCreateRequest(c.ctx, c.state, false)).toEqual({
      noteId: NOTE,
      title: 'Have to submit this',
      zoneId: 'Asia/Dhaka',
      date: '2026-10-09',
      time: '17:00',
      recurrence: null,
      foldPreference: 'earlier',
      followup: { intervalMinutes: 15, maxFollowups: 2 },
      allowPast: false,
      source: { blockId: BLOCK, text: 'tomorrow end of the day', spanStart: 23, spanEnd: 46, spanOrdinal: 0, referenceInstantUtc: R, referenceZone: 'Asia/Dhaka', origin: 'suggestion' },
    });
    const plain = card('Pay rent tomorrow', { format: 'plain', blockId: null, manualBlockId: null });
    expect(toCreateRequest(plain.ctx, plain.state, false).source).toMatchObject({ blockId: null, spanStart: null, spanEnd: null, text: 'tomorrow' });
  });

  it('several phrases: the selected one decides the date and the title', () => {
    const c = card('call Bob tomorrow at 9 and send report on Friday');
    expect(c.ctx.request.candidates.map((x) => x.text)).toEqual(['tomorrow at 9', 'on Friday']);
    c.act({ type: 'select', index: 1 });
    expect(c.state.form).toMatchObject({ title: 'call Bob tomorrow at 9 and send report', date: '2026-10-09', time: '09:00' });
  });
});

describe('SuggestionCard', () => {
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  async function render(req: CardRequest, opts: { fake?: FakeBridge; persist?: () => Promise<boolean> } = {}) {
    const fake = opts.fake ?? createFakeBridge();
    const notices: string[] = [];
    const persists: string[] = [];
    let closed = false;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const settle = async () => {
      for (let i = 0; i < 6; i += 1) await act(async () => new Promise((r) => setTimeout(r, 0)));
    };
    await act(async () =>
      root.render(
        <SuggestionCard
          request={req}
          bridge={fake.bridge}
          persist={async () => {
            persists.push('flush');
            return opts.persist ? opts.persist() : true;
          }}
          persistBlocks={async () => {
            persists.push('blocks');
            return true;
          }}
          notify={(m) => notices.push(m)}
          onClose={() => (closed = true)}
        />,
      ),
    );
    await settle();
    const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined;
    const click = async (el: Element | undefined) => {
      expect(el).toBeTruthy();
      await act(async () => (el as HTMLElement).click());
      await settle();
    };
    return { host, fake, notices, persists, closed: () => closed, button, click, settle, unmount: () => act(() => root.unmount()) };
  }

  it('shows the fields in order and adds the reminder with its source; nothing is sent before Add', async () => {
    const t = await render(request('Have to submit this by tomorrow end of the day'));
    expect(t.host.querySelector('h2')?.textContent).toBe('Create reminder');
    const text = t.host.textContent!;
    for (const part of ['From your note', '“tomorrow end of the day”'.slice(1, -1), 'Read on Thu 8 Oct 2026, 13:00 · Asia/Dhaka', 'Friday, 9 October 2026', '17:00 (default end of day)', 'Fri 9 Oct 2026, 17:00 · Asia/Dhaka', 'Repeat', 'Follow up if not done']) {
      expect(text, part).toContain(part);
    }
    expect((t.host.querySelector('input[type="time"]') as HTMLInputElement).value).toBe('17:00');
    expect(t.fake.callsTo('reminder:createFromSuggestion')).toEqual([]);
    await t.click(t.button('Add'));
    expect(t.persists).toEqual(['flush']);
    expect(t.fake.callsTo('reminder:createFromSuggestion').map((c) => c.req)).toEqual([expect.objectContaining({ date: '2026-10-09', time: '17:00', source: expect.objectContaining({ text: 'tomorrow end of the day' }) })]);
    expect(t.closed()).toBe(true);
    t.unmount();
  });

  it('choices gate Add: both radio groups start unchecked; the hint names the missing choice', async () => {
    const t = await render(request('Meet 03/04 at 5'));
    expect(t.button('Add')!.disabled).toBe(true);
    expect(t.host.querySelector('.dialog-hint')?.textContent).toBe('Choose the date order');
    const radios = [...t.host.querySelectorAll<HTMLInputElement>('.choice-group input[type="radio"]')];
    expect(radios.map((r) => r.parentElement!.textContent)).toEqual(['4 March', '3 April', '05:00', '17:00']);
    expect(radios.some((r) => r.checked)).toBe(false);
    await t.click(radios[1]);
    expect(t.host.querySelector('.dialog-hint')?.textContent).toBe('Choose AM or PM');
    await t.click([...t.host.querySelectorAll<HTMLInputElement>('.choice-group input[type="radio"]')][3]);
    expect(t.button('Add')!.disabled).toBe(false);
    expect(t.host.textContent).toContain('Friday, 3 April 2026');
    expect(t.host.textContent).toContain(PAST_TEXT);
    await t.click(t.button('Use next year'));
    expect(t.host.textContent).toContain('Saturday, 3 April 2027');
    expect(t.host.textContent).not.toContain(PAST_TEXT);
    t.unmount();
  });

  it('zone abbreviation: the select starts empty and the suggestions pick the zone', async () => {
    const t = await render(request('Report by 5 CST'));
    expect(t.host.textContent).toContain('“CST” can mean more than one time zone. Choose one.');
    expect((t.host.querySelector('select') as HTMLSelectElement).value).toBe('');
    await t.click(t.button('America/Chicago'));
    expect((t.host.querySelector('select') as HTMLSelectElement).value).toBe('America/Chicago');
    expect(t.host.querySelector('.dialog-hint')?.textContent).toBe('Choose AM or PM');
    t.unmount();
  });

  it('Cancel writes nothing; an existing reminder closes with a notice; a past time needs Add anyway', async () => {
    const cancel = await render(request('Call the bank tomorrow'));
    await cancel.click(cancel.button('Cancel'));
    expect(cancel.closed()).toBe(true);
    expect(cancel.fake.calls.filter((c) => c.channel.startsWith('reminder:'))).toEqual([]);
    cancel.unmount();

    const fake = createFakeBridge();
    const existing = request('Call the bank tomorrow');
    await fake.bridge.reminder.createFromSuggestion(toCreateRequest({ request: existing, zones: ZONES, followupDefault, endOfDayTime: '17:00', dateOnlyTime: '09:00' }, initialCard({ request: existing, zones: ZONES, followupDefault, endOfDayTime: '17:00', dateOnlyTime: '09:00' }), false));
    const again = await render(existing, { fake });
    await again.click(again.button('Add'));
    expect(again.notices).toEqual([EXISTS]);
    expect(again.closed()).toBe(true);
    again.unmount();

    const pastFake = createFakeBridge();
    pastFake.failNext('reminder:createFromSuggestion', { code: 'VALIDATION_FAILED', message: 'This time has already passed', details: { past: true, dueAtUtc: 0 } });
    const past = await render(request('Pay invoice on Oct 1'), { fake: pastFake });
    expect(past.host.textContent).toContain(PAST_TEXT);
    expect(past.button('Use next year')).toBeTruthy();
    await past.click(past.button('Add'));
    expect(past.closed()).toBe(false);
    await past.click(past.button('Add anyway'));
    expect(pastFake.callsTo('reminder:createFromSuggestion').map((c) => (c.req as { allowPast: boolean; date: string }))).toEqual([
      expect.objectContaining({ allowPast: false, date: '2026-10-01' }),
      expect.objectContaining({ allowPast: true, date: '2026-10-01' }),
    ]);
    expect(past.closed()).toBe(true);
    past.unmount();
  });

  it('a phrase main has not seen yet saves the editor once and tries again; an unsaved note says so', async () => {
    const fake = createFakeBridge();
    fake.failNext('reminder:createFromSuggestion', { code: 'VALIDATION_FAILED', message: 'The note text changed. Try again.', details: { sourceMismatch: true } }, 2);
    const t = await render(request('Call the bank tomorrow'), { fake });
    await t.click(t.button('Add'));
    expect(t.persists).toEqual(['flush', 'blocks']);
    expect(fake.callsTo('reminder:createFromSuggestion')).toHaveLength(2);
    expect(t.host.querySelector('[role="alert"].field-error')?.textContent).toBe('The note text changed. Try again.');
    t.unmount();

    const unsaved = await render(request('Call the bank tomorrow'), { persist: async () => false });
    await unsaved.click(unsaved.button('Add'));
    expect(unsaved.host.querySelector('[role="alert"].field-error')?.textContent).toBe('The note could not be saved. Try again.');
    expect(unsaved.fake.callsTo('reminder:createFromSuggestion')).toEqual([]);
    unsaved.unmount();
  });

  it('manual mode: no phrase found, an ordinary reminder on the paragraph', async () => {
    const t = await render(request("Let's do it sometime"));
    expect(t.host.textContent).toContain(NO_PHRASE);
    expect((t.host.querySelector('input.text-input') as HTMLInputElement).value).toBe("Let's do it sometime");
    await t.click(t.button('Add'));
    expect(t.fake.callsTo('reminder:createFromSuggestion')).toEqual([]);
    expect(t.fake.callsTo('reminder:create').map((c) => c.req)).toEqual([expect.objectContaining({ blockId: BLOCK, title: "Let's do it sometime", date: '2026-10-09', time: '09:00' })]);
    t.unmount();
  });

  it('update mode: "Update reminder" with the current due time; Update applies the new phrase', async () => {
    const fake = createFakeBridge();
    const created = await fake.bridge.reminder.createFromSuggestion({
      noteId: NOTE,
      title: 'Call the bank',
      zoneId: 'Asia/Dhaka',
      date: '2026-10-09',
      time: '09:00',
      recurrence: null,
      followup: null,
      source: { blockId: BLOCK, text: 'tomorrow', spanStart: 14, spanEnd: 22, spanOrdinal: 0, referenceInstantUtc: R, referenceZone: 'Asia/Dhaka', origin: 'suggestion' },
    });
    const reminder = (created.ok ? created.data.reminder : null) as ReminderDtoType;
    const t = await render(request('Call the bank next Friday', { mode: 'update', reminder }), { fake });
    expect(t.host.querySelector('h2')?.textContent).toBe('Update reminder');
    expect(t.host.textContent).toContain('Now: Fri 9 Oct 2026, 09:00 · Asia/Dhaka');
    expect(t.host.textContent).toContain('Friday, 16 October 2026');
    expect((t.host.querySelector('input.text-input') as HTMLInputElement).value).toBe('Call the bank');
    await t.click(t.button('Update'));
    expect(fake.callsTo('reminder:updateFromSource').map((c) => c.req)).toEqual([
      expect.objectContaining({ action: 'apply', reminderId: reminder.id, expectedRevision: 1, date: '2026-10-16', time: '09:00', source: expect.objectContaining({ text: 'next Friday' }) }),
    ]);
    t.unmount();
  });
});

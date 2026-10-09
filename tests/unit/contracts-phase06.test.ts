import { describe, expect, it } from 'vitest';
import { STICKY_ALLOWED_CHANNELS, WIDGET_ALLOWED_CHANNELS, isChannelAllowed } from '../../src/shared/contracts/channel-roles';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '../../src/shared/contracts/channel-names';
import { CHANNEL_SCHEMAS } from '../../src/shared/contracts/channels';
import { ReminderDto, ReminderSourceDto } from '../../src/shared/contracts/reminders';
import { SETTINGS, SettingsSetRequest } from '../../src/shared/contracts/settings';
import {
  DismissalDto,
  ReminderCreateFromSuggestionRequest,
  ReminderUpdateFromSourceRequest,
  SuggestionDismissRequest,
  SuggestionListDismissedResponse,
  SuggestionSource,
} from '../../src/shared/contracts/suggestions';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const B = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const T0 = Date.parse('2026-10-08T07:00:00Z');

const source = { blockId: B, text: 'tomorrow end of the day', spanStart: 23, spanEnd: 46, spanOrdinal: 0, referenceInstantUtc: T0, referenceZone: 'Asia/Dhaka', origin: 'suggestion' };
const input = { title: 'Have to submit this', zoneId: 'Asia/Dhaka', date: '2026-10-09', time: '17:00', recurrence: null, followup: null };

describe('Phase 06 catalogue (D-089)', () => {
  it('the four channels are appended after autostart:set in order, no new event', () => {
    expect(INVOKE_CHANNELS.slice(63, 68)).toEqual(['autostart:set', 'reminder:createFromSuggestion', 'reminder:updateFromSource', 'suggestion:dismiss', 'suggestion:listDismissed']);
    expect(EVENT_CHANNELS).toHaveLength(13);
  });

  it('stickies may add reminders and confirm or dismiss suggestions, never edit reminders; the widget gets nothing new', () => {
    for (const channel of ['zones:list', 'reminder:create', 'reminder:createFromSuggestion', 'suggestion:dismiss', 'suggestion:listDismissed'] as const) {
      expect(STICKY_ALLOWED_CHANNELS.has(channel), channel).toBe(true);
      expect(WIDGET_ALLOWED_CHANNELS.has(channel), channel).toBe(false);
    }
    for (const channel of ['reminder:updateFromSource', 'reminder:update', 'reminder:delete', 'reminder:undoDelete'] as const) {
      expect(isChannelAllowed('sticky', channel), channel).toBe(false);
      expect(isChannelAllowed('main', channel), channel).toBe(true);
    }
    // 35 after Phase 06; Phase 07 adds attachment:open and attachment:showInFolder (D-098).
    // The three lease channels gave way to the five live-sync channels (D-103); v0.2.0 adds sticky:setTextColor, and the
    // picker (attachment:pickFiles replacing attachment:importFromDialog, attachment:addPicked) and the five fileLink
    // channels (D-108).
    expect(STICKY_ALLOWED_CHANNELS.size).toBe(46);
    expect([...WIDGET_ALLOWED_CHANNELS]).toEqual([
      'app:getInfo',
      'app:quit',
      'app:flushed',
      'capabilities:get',
      'settings:get',
      'window:getState',
      'reminders:listView',
      'occurrence:complete',
      'occurrence:snooze',
      'reminder:open',
      'widget:hide',
      'widget:setPinned',
      'widget:setCollapsed',
    ]);
  });
});

describe('Phase 06 request schemas (plan section 6.1)', () => {
  it('a source keeps block and span together and its span as long as its text', () => {
    expect(SuggestionSource.safeParse(source).success).toBe(true);
    expect(SuggestionSource.safeParse({ ...source, blockId: null, spanStart: null, spanEnd: null }).success).toBe(true);
    expect(SuggestionSource.safeParse({ ...source, blockId: null }).success).toBe(false);
    expect(SuggestionSource.safeParse({ ...source, spanEnd: null }).success).toBe(false);
    expect(SuggestionSource.safeParse({ ...source, spanEnd: 45 }).success).toBe(false);
    for (const text of ['', '   ', 'two\nlines', 'tab\there', 'x'.repeat(501)]) {
      expect(SuggestionSource.safeParse({ ...source, text, spanEnd: source.spanStart + Math.max(1, text.length) }).success, JSON.stringify(text)).toBe(false);
    }
    expect(SuggestionSource.safeParse({ ...source, origin: 'guess' }).success).toBe(false);
    expect(SuggestionSource.safeParse({ ...source, spanOrdinal: -1 }).success).toBe(false);
    expect(SuggestionSource.safeParse({ ...source, referenceZone: 'not a zone' }).success).toBe(false);
  });

  it('create requests are strict: no instant, no separate block; defaults like reminder:create', () => {
    const req = { noteId: ID, ...input, source };
    expect(ReminderCreateFromSuggestionRequest.parse(req)).toMatchObject({ foldPreference: 'earlier', allowPast: false });
    for (const extra of [{ dueAtUtc: T0 }, { instantUtc: T0 }, { blockId: B }]) expect(ReminderCreateFromSuggestionRequest.safeParse({ ...req, ...extra }).success, JSON.stringify(extra)).toBe(false);
    expect(CHANNEL_SCHEMAS['reminder:createFromSuggestion'].request).toBe(ReminderCreateFromSuggestionRequest);
  });

  it('update from source is apply (schedule, revision, pending policy, source) or keep (the reminder only)', () => {
    const apply = { action: 'apply', reminderId: ID, expectedRevision: 1, ...input, source };
    expect(ReminderUpdateFromSourceRequest.parse(apply)).toMatchObject({ action: 'apply', pendingPolicy: 'keep', foldPreference: 'earlier' });
    expect(ReminderUpdateFromSourceRequest.safeParse({ ...apply, expectedRevision: 0 }).success).toBe(false);
    expect(ReminderUpdateFromSourceRequest.safeParse({ ...apply, source: undefined }).success).toBe(false);
    expect(ReminderUpdateFromSourceRequest.parse({ action: 'keep', reminderId: ID })).toEqual({ action: 'keep', reminderId: ID });
    expect(ReminderUpdateFromSourceRequest.safeParse({ action: 'keep', reminderId: ID, date: '2026-10-09' }).success).toBe(false);
    expect(ReminderUpdateFromSourceRequest.safeParse({ action: 'move', reminderId: ID }).success).toBe(false);
  });

  it('dismissals carry the parts of the key; the list answers main’s reference context and at most 500', () => {
    const req = { noteId: ID, blockId: B, text: 'Friday', spanOrdinal: 0, referenceDate: '2026-10-08' };
    expect(SuggestionDismissRequest.safeParse(req).success).toBe(true);
    expect(SuggestionDismissRequest.safeParse({ ...req, referenceDate: '8 Oct' }).success).toBe(false);
    expect(SuggestionDismissRequest.safeParse({ ...req, dedupeKey: 'x' }).success).toBe(false);
    const dismissal = { blockId: B, text: 'friday', spanOrdinal: 0, referenceDate: '2026-10-08', createdAt: T0 };
    expect(DismissalDto.safeParse(dismissal).success).toBe(true);
    const list = { asOf: T0, systemZone: 'Asia/Dhaka', defaultZone: null, dismissals: [dismissal] };
    expect(SuggestionListDismissedResponse.safeParse(list).success).toBe(true);
    expect(SuggestionListDismissedResponse.safeParse({ ...list, dismissals: Array.from({ length: 501 }, () => dismissal) }).success).toBe(false);
    expect(SuggestionListDismissedResponse.safeParse({ ...list, asOf: undefined }).success).toBe(false);
  });

  it('ReminderDto always carries its source (or null)', () => {
    const sourceDto = { blockId: B, text: 'tomorrow', spanOrdinal: 0, origin: 'selection', state: 'changed', referenceInstantUtc: T0, referenceZone: 'Asia/Dhaka' };
    expect(ReminderSourceDto.safeParse(sourceDto).success).toBe(true);
    expect(ReminderSourceDto.safeParse({ ...sourceDto, state: 'stale' }).success).toBe(false);
    const dto = { id: ID, noteId: ID, blockId: B, anchorState: 'ok', ...input, foldPreference: 'earlier', revision: 1, createdAt: 1, updatedAt: 1, resolution: { status: 'ok' }, current: null };
    expect(ReminderDto.safeParse({ ...dto, source: sourceDto }).success).toBe(true);
    expect(ReminderDto.safeParse({ ...dto, source: null }).success).toBe(true);
    expect(ReminderDto.safeParse(dto).success).toBe(false);
  });
});

describe('Phase 06 settings keys (D-094)', () => {
  it('end of day 17:00, date-only 09:00 and suggestions on by default, all public; times must be HH:mm', () => {
    expect(SETTINGS['reminders.endOfDayTime']).toMatchObject({ version: 1, default: '17:00', public: true });
    expect(SETTINGS['reminders.dateOnlyTime']).toMatchObject({ version: 1, default: '09:00', public: true });
    expect(SETTINGS['reminders.suggestFromText']).toMatchObject({ version: 1, default: true, public: true });
    expect(SettingsSetRequest.safeParse({ key: 'reminders.endOfDayTime', value: '18:30' }).success).toBe(true);
    expect(SettingsSetRequest.safeParse({ key: 'reminders.endOfDayTime', value: '6pm' }).success).toBe(false);
    expect(SettingsSetRequest.safeParse({ key: 'reminders.suggestFromText', value: 'yes' }).success).toBe(false);
  });
});

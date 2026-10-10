import { describe, expect, it } from 'vitest';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '../../src/shared/contracts/channel-names';
import { CHANNEL_SCHEMAS } from '../../src/shared/contracts/channels';
import {
  AppOpenRemindersEvent,
  OccurrenceItem,
  OccurrenceSnoozeRequest,
  ReminderAlertEvent,
  ReminderChangedEvent,
  ReminderCreateRequest,
  ReminderDto,
  ReminderUpdateRequest,
  RemindersListViewRequest,
  ZoneId,
  ZonesListResponse,
} from '../../src/shared/contracts/reminders';
import { SETTINGS, SettingsSetRequest } from '../../src/shared/contracts/settings';
import { AutostartState, WidgetState } from '../../src/shared/contracts/widget';
import { AppOpenNoteEvent, WindowGetStateResponse } from '../../src/shared/contracts/windows';
import { collectBlockIds } from '../../src/shared/editor/doc-schema';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const B = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const input = { blockId: null, title: 'Submit report', zoneId: 'Asia/Dhaka', date: '2026-10-09', time: '17:00', recurrence: null, followup: null };
const item = {
  occurrenceId: ID,
  reminderId: ID,
  noteId: ID,
  blockId: null,
  anchorState: 'ok',
  noteTitle: 'Report',
  notePath: ['Common'],
  title: 'Submit report',
  zoneId: 'Asia/Dhaka',
  dueAtUtc: 1,
  localDateTime: '2026-10-09T17:00',
  state: 'pending',
  snoozedUntilUtc: null,
  effectiveAtUtc: 1,
  overdue: false,
  alertsSent: 0,
  followupsSent: 0,
  repeat: null,
  lastOutcome: null,
  completedAt: null,
};

describe('Phase 05 reminder schemas (D-074, plan section 6.1)', () => {
  it('create: defaults for fold and allowPast, strict keys, canonical ids', () => {
    const parsed = ReminderCreateRequest.parse({ noteId: ID, ...input });
    expect(parsed).toMatchObject({ foldPreference: 'earlier', allowPast: false });
    expect(ReminderCreateRequest.safeParse({ noteId: ID, ...input, extra: 1 }).success).toBe(false);
    expect(ReminderCreateRequest.safeParse({ noteId: ID.toUpperCase(), ...input }).success).toBe(false);
    expect(ReminderCreateRequest.safeParse({ noteId: ID, ...input, blockId: 'abc' }).success).toBe(false);
    expect(ReminderCreateRequest.safeParse({ ...input }).success).toBe(false);
  });

  it('title: trimmed, 1..200, no control characters', () => {
    expect(ReminderCreateRequest.parse({ noteId: ID, ...input, title: '  Pay rent  ' }).title).toBe('Pay rent');
    for (const title of ['', '   ', 'x'.repeat(201), 'a\u0007b', 'line\nbreak']) {
      expect(ReminderCreateRequest.safeParse({ noteId: ID, ...input, title }).success, JSON.stringify(title)).toBe(false);
    }
  });

  it('zone, date and time formats', () => {
    for (const z of ['Asia/Dhaka', 'America/Argentina/Buenos_Aires', 'UTC', 'Etc/GMT+5']) expect(ZoneId.safeParse(z).success, z).toBe(true);
    for (const z of ['', 'Asia/', '../etc', 'A/B/C/D', 'x'.repeat(65), 'Asia Dhaka']) expect(ZoneId.safeParse(z).success, z).toBe(false);
    for (const date of ['2026-02-30', '1999-12-31', '2101-01-01', '2026-1-1']) expect(ReminderCreateRequest.safeParse({ noteId: ID, ...input, date }).success, date).toBe(false);
    for (const time of ['24:00', '9:00', '09:60', '09:00:00']) expect(ReminderCreateRequest.safeParse({ noteId: ID, ...input, time }).success, time).toBe(false);
  });

  it('recurrence: daily or weekly with 1..7 unique weekdays, stored sorted', () => {
    const weekly = ReminderCreateRequest.parse({ noteId: ID, ...input, recurrence: { freq: 'weekly', byWeekday: [5, 1, 3] } });
    expect(weekly.recurrence).toEqual({ freq: 'weekly', byWeekday: [1, 3, 5] });
    expect(ReminderCreateRequest.safeParse({ noteId: ID, ...input, recurrence: { freq: 'daily' } }).success).toBe(true);
    for (const recurrence of [{ freq: 'weekly', byWeekday: [] }, { freq: 'weekly', byWeekday: [1, 1] }, { freq: 'weekly', byWeekday: [0] }, { freq: 'weekly', byWeekday: [8] }, { freq: 'monthly' }, { freq: 'daily', extra: 1 }]) {
      expect(ReminderCreateRequest.safeParse({ noteId: ID, ...input, recurrence }).success, JSON.stringify(recurrence)).toBe(false);
    }
  });

  it('update: revision and pending policy (default keep)', () => {
    expect(ReminderUpdateRequest.parse({ reminderId: ID, expectedRevision: 1, ...input }).pendingPolicy).toBe('keep');
    expect(ReminderUpdateRequest.safeParse({ reminderId: ID, expectedRevision: 0, ...input }).success).toBe(false);
    expect(ReminderUpdateRequest.safeParse({ reminderId: ID, expectedRevision: 1, pendingPolicy: 'drop', ...input }).success).toBe(false);
  });

  it('views, snooze presets and scope default', () => {
    expect(RemindersListViewRequest.parse({ view: 'today' }).scope).toEqual({ kind: 'all' });
    expect(RemindersListViewRequest.safeParse({ view: 'later' }).success).toBe(false);
    for (const preset of [5, 10, 15, 30, 60, 'tomorrow']) expect(OccurrenceSnoozeRequest.safeParse({ occurrenceId: ID, preset }).success).toBe(true);
    for (const preset of [1, 45, 'nextweek']) expect(OccurrenceSnoozeRequest.safeParse({ occurrenceId: ID, preset }).success).toBe(false);
  });

  it('responses and events', () => {
    expect(OccurrenceItem.safeParse(item).success).toBe(true);
    expect(OccurrenceItem.safeParse({ ...item, state: 'done' }).success).toBe(false);
    expect(OccurrenceItem.safeParse({ ...item, notePath: Array.from({ length: 67 }, () => 'f') }).success).toBe(false);
    const dto = { id: ID, noteId: ID, blockId: B, anchorState: 'block_missing', title: 'T', zoneId: 'Asia/Dhaka', date: '2026-10-09', time: '17:00', recurrence: null, foldPreference: 'earlier', followup: { intervalMinutes: 15, maxFollowups: 2 }, revision: 1, createdAt: 1, updatedAt: 1, resolution: { status: 'gap' }, current: item, source: null };
    expect(ReminderDto.safeParse(dto).success).toBe(true);
    expect(ReminderDto.safeParse({ ...dto, revision: 0 }).success).toBe(false);
    expect(ZonesListResponse.safeParse({ zones: ['UTC'], systemZone: null, defaultZone: null, asOf: 1 }).success).toBe(true);
    expect(ReminderChangedEvent.safeParse({ reason: 'zone', noteIds: [] }).success).toBe(true);
    expect(ReminderChangedEvent.safeParse({ reason: 'fired', noteIds: [] }).success).toBe(false);
    expect(ReminderAlertEvent.safeParse({ batchId: ID, outcome: 'failed', presentation: 'single', total: 1, items: [item] }).success).toBe(true);
    expect(ReminderAlertEvent.safeParse({ batchId: ID, outcome: 'failed', presentation: 'summary', total: 4, items: [item, item, item, item] }).success).toBe(false);
    expect(AppOpenRemindersEvent.safeParse({ view: 'overdue' }).success).toBe(true);
    expect(WidgetState.safeParse({ open: true, collapsed: false, alwaysOnTop: false }).success).toBe(true);
    expect(AutostartState.safeParse({ enabled: false, capability: { status: 'unsupported', reason: 'development-build' } }).success).toBe(true);
  });
});

describe('Phase 05 settings keys (D-083)', () => {
  it('defaults: follow the computer zone, follow-ups off, quiet hours off 22:00 to 07:00', () => {
    expect(SETTINGS['reminders.defaultZone']).toMatchObject({ default: null, public: true });
    expect(SETTINGS['reminders.quietHours']).toMatchObject({ default: { enabled: false, start: '22:00', end: '07:00', zoneId: null }, public: true });
  });

  it('quiet hours need different start and end, and a zone when enabled', () => {
    const set = (value: unknown) => SettingsSetRequest.safeParse({ key: 'reminders.quietHours', value }).success;
    expect(set({ enabled: true, start: '22:00', end: '07:00', zoneId: 'Asia/Dhaka' })).toBe(true);
    expect(set({ enabled: false, start: '22:00', end: '07:00', zoneId: null })).toBe(true);
    expect(set({ enabled: true, start: '22:00', end: '07:00', zoneId: null })).toBe(false);
    expect(set({ enabled: true, start: '22:00', end: '22:00', zoneId: 'Asia/Dhaka' })).toBe(false);
    expect(set({ enabled: true, start: '25:00', end: '07:00', zoneId: 'Asia/Dhaka' })).toBe(false);
  });
});

describe('collectBlockIds (D-080)', () => {
  it('collects ids of every block type, nested, and ignores invalid ids', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { id: ID }, content: [{ type: 'text', text: 'a' }] },
        { type: 'bulletList', content: [{ type: 'listItem', attrs: { id: B }, content: [{ type: 'paragraph', attrs: { id: 'not-a-uuid' } }] }] },
        { type: 'horizontalRule', attrs: { id: '2b4e28ba-2fa1-41d2-883f-0016d3cca427' } },
      ],
    };
    expect([...collectBlockIds(doc)].sort()).toEqual([ID, B].sort());
    expect(collectBlockIds('plain text').size).toBe(0);
  });
});

describe('Phase 05 catalogue (D-074)', () => {
  it('the Phase 05 channels are appended in order after the Phase 04 channels, 12 events', () => {
    expect(INVOKE_CHANNELS.slice(47, 64)).toEqual([
      'zones:list',
      'reminder:create',
      'reminder:update',
      'reminder:delete',
      'reminder:undoDelete',
      'reminder:listForNote',
      'reminder:open',
      'reminders:listView',
      'reminders:summary',
      'occurrence:complete',
      'occurrence:snooze',
      'widget:show',
      'widget:hide',
      'widget:setPinned',
      'widget:setCollapsed',
      'autostart:get',
      'autostart:set',
    ]);
    expect(EVENT_CHANNELS.slice(6, 10)).toEqual(['reminder:changed', 'reminder:alert', 'widget:state', 'app:openReminders']);
    // Later events (live sync, locked stickies) come after these.
    expect(EVENT_CHANNELS).toHaveLength(14);
  });

  it('app:openNote takes an optional block (default null); the main window state carries a pending Reminders view', () => {
    expect(AppOpenNoteEvent.parse({ noteId: ID })).toEqual({ noteId: ID, blockId: null });
    expect(AppOpenNoteEvent.parse({ noteId: ID, blockId: B })).toEqual({ noteId: ID, blockId: B });
    expect(AppOpenNoteEvent.safeParse({ noteId: ID, blockId: 'x' }).success).toBe(false);
    expect(WindowGetStateResponse.safeParse({ role: 'main', openNotes: [], openReminders: 'overdue', widget: { open: true, collapsed: false, alwaysOnTop: false } }).success).toBe(true);
    expect(WindowGetStateResponse.safeParse({ role: 'main', openNotes: [], openReminders: null, widget: { open: false, collapsed: false, alwaysOnTop: false } }).success).toBe(true);
    expect(WindowGetStateResponse.safeParse({ role: 'main', openNotes: [], openReminders: null }).success).toBe(false);
    expect(WindowGetStateResponse.safeParse({ role: 'main', openNotes: [] }).success).toBe(false);
    expect(CHANNEL_SCHEMAS['reminder:open'].request.safeParse({ reminderId: ID }).success).toBe(true);
    expect(CHANNEL_SCHEMAS['zones:list'].request.safeParse({ zone: 'UTC' }).success).toBe(false);
    expect(WindowGetStateResponse.safeParse({ role: 'widget', widget: { open: true, collapsed: false, alwaysOnTop: false } }).success).toBe(true);
    expect(WindowGetStateResponse.safeParse({ role: 'widget', sticky: {} }).success).toBe(false);
    expect(CHANNEL_SCHEMAS['widget:setPinned'].request.safeParse({ pinned: 'yes' }).success).toBe(false);
    expect(CHANNEL_SCHEMAS['autostart:set'].request.safeParse({ enabled: true }).success).toBe(true);
    expect(CHANNEL_SCHEMAS['widget:show'].request.safeParse({ x: 1 }).success).toBe(false);
  });
});

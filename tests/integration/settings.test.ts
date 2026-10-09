import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/main/db/open-database';
import { SettingsRepo } from '../../src/main/db/repositories/settings-repo';
import { AppError } from '../../src/main/services/app-error';
import { memoryLogger } from '../../src/main/services/logger';
import { SettingsService } from '../../src/main/services/settings-service';
import type { SettingsChangedPayload } from '../../src/shared/contracts/settings';
import { fixedClock, openFresh, trackDb } from './helpers';

async function setup() {
  const t = await openFresh();
  const clock = fixedClock(1_800_000_000_000);
  const logger = memoryLogger();
  const events: SettingsChangedPayload[] = [];
  const service = new SettingsService({
    repo: new SettingsRepo(t.db),
    clock,
    logger,
    emit: (p) => events.push(p),
  });
  return { t, clock, logger, events, service };
}

describe('settings (INF-FND-06)', () => {
  it('returns defaults for missing rows', async () => {
    const { service } = await setup();
    expect(service.get(['appearance.theme'])).toEqual({ 'appearance.theme': 'system' });
  });

  it('rejects unknown keys and invalid values without writing', async () => {
    const { t, service, events } = await setup();
    expect(() => service.set('x.y', 1)).toThrow(AppError);
    expect(() => service.set('appearance.theme', 'neon')).toThrow(AppError);
    expect(t.db.prepare<[], { n: number }>('SELECT count(*) AS n FROM settings').get()?.n).toBe(0);
    expect(events).toHaveLength(0);
    expect(() => service.get(['nope' as never])).toThrow(AppError);
  });

  it('stores {"v":1,"value":...}, emits one settings:changed and uses the injected clock', async () => {
    const { t, service, events, clock } = await setup();
    const out = service.set('appearance.theme', 'dark');
    expect(out).toEqual({ key: 'appearance.theme', value: 'dark', updatedAt: 1_800_000_000_000 });
    expect(events).toEqual([out]);
    const row = t.db.prepare<[], { value: string; updated_at: number }>("SELECT value, updated_at FROM settings WHERE key = 'appearance.theme'").get();
    expect(row).toEqual({ value: '{"v":1,"value":"dark"}', updated_at: 1_800_000_000_000 });
    clock.advance(10);
    service.set('appearance.theme', 'light');
    expect(events).toHaveLength(2);
    expect(service.get(['appearance.theme'])).toEqual({ 'appearance.theme': 'light' });
  });

  it('falls back to the default and logs on invalid stored values, without rewriting', async () => {
    const { t, service, logger } = await setup();
    const put = (v: string) =>
      t.db.prepare<[string]>("INSERT INTO settings(key, value, updated_at) VALUES ('appearance.theme', ?, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(v);
    for (const bad of ['{"v":1,"value":"neon"}', '{"v":2,"value":"dark"}', '"dark"', '123', 'null']) {
      put(bad);
      expect(service.get(['appearance.theme'])).toEqual({ 'appearance.theme': 'system' });
    }
    expect(logger.lines.filter((l) => l.includes('settings: invalid stored value key=appearance.theme')).length).toBe(5);
    expect(t.db.prepare<[], { value: string }>("SELECT value FROM settings WHERE key = 'appearance.theme'").get()?.value).toBe('null');
  });

  it('Phase 02 keys: defaults, validation, public-only get/set, and internal access without events', async () => {
    const { t, service, events } = await setup();
    expect(service.get(['layout.treeOpen', 'layout.treeWidth', 'layout.panelOpen', 'home.scope', 'tree.expanded'])).toEqual({
      'layout.treeOpen': true,
      'layout.treeWidth': 248,
      'layout.panelOpen': true,
      'home.scope': { kind: 'all' },
      'tree.expanded': ['common', 'projects'],
    });
    expect(() => service.set('layout.treeWidth', 219)).toThrow(AppError);
    expect(() => service.set('layout.treeWidth', 281)).toThrow(AppError);
    expect(() => service.set('tree.expanded', ['note:x'])).toThrow(AppError);
    expect(service.set('layout.treeWidth', 240).value).toBe(240);
    expect(events).toHaveLength(1);
    // the internal session key is main-only
    expect(() => service.get(['session.tabs'])).toThrow(AppError);
    expect(() => service.set('session.tabs', { version: 1, tabs: [{ id: 'home', kind: 'home' }], activeTabId: 'home' })).toThrow(AppError);
    expect(service.getInternal('session.tabs').activeTabId).toBe('home');
    service.setInternal('session.tabs', { version: 1, tabs: [{ id: 'home', kind: 'home' }, { id: 'page:settings', kind: 'settings' }], activeTabId: 'page:settings' });
    expect(events).toHaveLength(1);
    expect(service.getInternal('session.tabs').activeTabId).toBe('page:settings');
    expect(() => service.setInternal('session.tabs', { version: 2 })).toThrow(AppError);
    expect(t.db.prepare<[], { n: number }>('SELECT count(*) AS n FROM settings').get()?.n).toBe(2);
  });

  it('Phase 05 reminder keys: defaults, a fresh profile writes nothing, unknown zones refused by name (D-083)', async () => {
    const { t, service, events } = await setup();
    expect(service.get(['reminders.defaultZone', 'reminders.followupDefault', 'reminders.quietHours'])).toEqual({
      'reminders.defaultZone': null,
      'reminders.followupDefault': { enabled: false, intervalMinutes: 15, maxFollowups: 2 },
      'reminders.quietHours': { enabled: false, start: '22:00', end: '07:00', zoneId: null },
    });
    expect(t.db.prepare<[], { n: number }>('SELECT count(*) AS n FROM settings').get()?.n).toBe(0);
    for (const zone of ['Mars/Base', 'CST', 'EST']) {
      expect(() => service.set('reminders.defaultZone', zone)).toThrow('Choose a time zone from the list');
      expect(() => service.set('reminders.quietHours', { enabled: true, start: '22:00', end: '07:00', zoneId: zone })).toThrow('Choose a time zone from the list');
    }
    expect(events).toHaveLength(0);
    expect(service.set('reminders.defaultZone', 'Asia/Dhaka').value).toBe('Asia/Dhaka');
    expect(service.set('reminders.defaultZone', null).value).toBeNull();
    service.set('reminders.quietHours', { enabled: true, start: '22:00', end: '07:00', zoneId: 'Asia/Dhaka' });
    expect(service.get(['reminders.quietHours'])['reminders.quietHours']).toEqual({ enabled: true, start: '22:00', end: '07:00', zoneId: 'Asia/Dhaka' });
    // A stored zone the runtime no longer knows reads as the default.
    t.db.prepare("UPDATE settings SET value = '{\"v\":1,\"value\":\"Mars/Base\"}' WHERE key = 'reminders.defaultZone'").run();
    expect(service.get(['reminders.defaultZone'])).toEqual({ 'reminders.defaultZone': null });
  });

  it('Phase 06 suggestion keys: defaults, invalid values refused, stored invalid values read as the default (D-094)', async () => {
    const { t, service, events, logger } = await setup();
    const keys = ['reminders.endOfDayTime', 'reminders.dateOnlyTime', 'reminders.suggestFromText'] as const;
    expect(service.get([...keys])).toEqual({ 'reminders.endOfDayTime': '17:00', 'reminders.dateOnlyTime': '09:00', 'reminders.suggestFromText': true });
    for (const bad of ['5pm', '24:00', '9:00', '', null]) {
      expect(() => service.set('reminders.endOfDayTime', bad)).toThrow(AppError);
      expect(() => service.set('reminders.dateOnlyTime', bad)).toThrow(AppError);
    }
    expect(() => service.set('reminders.suggestFromText', 'no')).toThrow(AppError);
    expect(t.db.prepare<[], { n: number }>('SELECT count(*) AS n FROM settings').get()?.n).toBe(0);
    expect(events).toHaveLength(0);
    expect(service.set('reminders.endOfDayTime', '18:30').value).toBe('18:30');
    expect(service.set('reminders.dateOnlyTime', '07:45').value).toBe('07:45');
    expect(service.set('reminders.suggestFromText', false).value).toBe(false);
    expect(events.map((e) => e.key)).toEqual([...keys]);
    expect(service.get([...keys])).toEqual({ 'reminders.endOfDayTime': '18:30', 'reminders.dateOnlyTime': '07:45', 'reminders.suggestFromText': false });
    t.db.prepare("UPDATE settings SET value = '{\"v\":1,\"value\":\"25:00\"}' WHERE key = 'reminders.endOfDayTime'").run();
    t.db.prepare("UPDATE settings SET value = '{\"v\":1,\"value\":\"yes\"}' WHERE key = 'reminders.suggestFromText'").run();
    expect(service.get(['reminders.endOfDayTime', 'reminders.suggestFromText'])).toEqual({ 'reminders.endOfDayTime': '17:00', 'reminders.suggestFromText': true });
    expect(logger.lines).toContain('WARN settings: invalid stored value key=reminders.endOfDayTime');
    expect(logger.lines).toContain('WARN settings: invalid stored value key=reminders.suggestFromText');
  });

  it('quiet hours switched on need a zone: refused on write; a stored value without one reads as off (QA5-04, D-083)', async () => {
    const { t, service, events, logger } = await setup();
    const zoneless = { enabled: true, start: '22:00', end: '07:00', zoneId: null };
    expect(() => service.set('reminders.quietHours', zoneless)).toThrow(AppError);
    expect(t.db.prepare<[], { n: number }>('SELECT count(*) AS n FROM settings').get()?.n).toBe(0);
    expect(events).toHaveLength(0);
    t.db.prepare<[string]>("INSERT INTO settings(key, value, updated_at) VALUES ('reminders.quietHours', ?, 0)").run(JSON.stringify({ v: 1, value: zoneless }));
    expect(service.getInternal('reminders.quietHours')).toEqual({ enabled: false, start: '22:00', end: '07:00', zoneId: null });
    expect(logger.lines).toContain('WARN settings: invalid stored value key=reminders.quietHours');
  });

  it('persists across close and reopen', async () => {
    const { t, service } = await setup();
    service.set('appearance.theme', 'dark');
    t.db.close();
    const reopened = await openDatabase({ dbFile: t.dbFile, preMigrationDir: t.preMigrationDir });
    if (!reopened.ok) throw new Error('reopen failed');
    trackDb(reopened.db);
    const again = new SettingsService({
      repo: new SettingsRepo(reopened.db),
      clock: fixedClock(),
      logger: memoryLogger(),
      emit: () => {},
    });
    expect(again.get(['appearance.theme'])).toEqual({ 'appearance.theme': 'dark' });
  });
});

import { describe, expect, it } from 'vitest';
import { CHANNEL_SCHEMAS } from '../../src/shared/contracts/channels';
import { DEFAULT_SESSION, type TabSessionType } from '../../src/shared/contracts/session';
import { setupServices } from './hierarchy-helpers';

const noteTab = (id: string) => ({ id: `note:${id}`, kind: 'note' as const, noteId: id });

describe('session service (INF-TABS-05, INF-TABS-06, INF-HOME-01)', () => {
  it('returns the default session and never writes on get', async () => {
    const s = await setupServices();
    expect(s.sessions.get()).toEqual({ session: DEFAULT_SESSION, dropped: { trashed: 0, missing: 0, duplicates: 0 } });
    expect(s.row<{ n: number }>('SELECT count(*) AS n FROM settings')?.n).toBe(0);
  });

  it('round-trips set and get without emitting settings:changed', async () => {
    const s = await setupServices();
    const a = s.note(null, null, 'A');
    const b = s.note(null, null, 'B');
    const session: TabSessionType = {
      version: 1,
      tabs: [{ id: 'home', kind: 'home' }, noteTab(a.id), { id: 'page:stickies', kind: 'stickies' }, { ...noteTab(b.id), scrollTop: 120 }],
      activeTabId: `note:${b.id}`,
    };
    expect(s.sessions.set(session)).toEqual({ savedAt: s.clock.now() });
    expect(s.sessions.get()).toEqual({ session, dropped: { trashed: 0, missing: 0, duplicates: 0 } });
    expect(s.settingsEvents).toEqual([]);
    expect(s.row<{ value: string }>("SELECT value FROM settings WHERE key = 'session.tabs'")?.value).toContain('"v":1');
  });

  it('sanitizes live, trashed and missing notes and duplicate entries', async () => {
    const s = await setupServices();
    const live = s.note(null, null, 'live');
    const trashed = s.note(null, null, 'trashed');
    const missing = s.note(null, null, 'missing');
    s.sessions.set({
      version: 1,
      tabs: [{ id: 'home', kind: 'home' }, noteTab(live.id), noteTab(trashed.id), noteTab(missing.id)],
      activeTabId: `note:${missing.id}`,
    });
    s.trash.trashNote(trashed.id);
    const mb = s.trash.trashNote(missing.id);
    s.trash.purge({ target: { kind: 'batch', batchId: mb.trashBatchId }, confirmed: true });
    const got = s.sessions.get();
    expect(got.dropped).toEqual({ trashed: 1, missing: 1, duplicates: 0 });
    expect(got.session.tabs.map((t) => t.id)).toEqual(['home', `note:${live.id}`]);
    expect(got.session.activeTabId).toBe(`note:${live.id}`);
    // still unchanged in storage until the renderer persists the sanitized copy
    expect(s.settings.getInternal('session.tabs').tabs).toHaveLength(4);
  });

  it('collapses a tampered session with duplicates and a misplaced Home', async () => {
    const s = await setupServices();
    const a = s.note(null, null, 'A');
    s.t.db
      .prepare<[string]>("INSERT INTO settings(key, value, updated_at) VALUES ('session.tabs', ?, 1)")
      .run(
        JSON.stringify({
          v: 1,
          value: { version: 1, tabs: [noteTab(a.id), { id: 'home', kind: 'home' }, noteTab(a.id)], activeTabId: `note:${a.id}` },
        }),
      );
    const got = s.sessions.get();
    expect(got.session.tabs.map((t) => t.id)).toEqual(['home', `note:${a.id}`]);
    expect(got.dropped.duplicates).toBe(1);
  });

  it('corrupt stored JSON gives the default and a log line', async () => {
    const s = await setupServices();
    s.t.db.prepare("INSERT INTO settings(key, value, updated_at) VALUES ('session.tabs', '{\"v\":1,\"value\":\"nonsense\"}', 1)").run();
    expect(s.sessions.get().session).toEqual(DEFAULT_SESSION);
    expect(s.logger.lines.some((l) => l.includes('settings: invalid stored value key=session.tabs'))).toBe(true);
  });

  it('session.tabs is not reachable through the settings channels', async () => {
    expect(CHANNEL_SCHEMAS['settings:get'].request.safeParse({ keys: ['session.tabs'] }).success).toBe(false);
    expect(CHANNEL_SCHEMAS['settings:set'].request.safeParse({ key: 'session.tabs', value: DEFAULT_SESSION }).success).toBe(false);
    const s = await setupServices();
    expect(() => s.settings.get(['session.tabs'])).toThrow(/Unknown setting/);
    expect(() => s.settings.set('session.tabs', DEFAULT_SESSION)).toThrow(/Unknown setting/);
  });
});

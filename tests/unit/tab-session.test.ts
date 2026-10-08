import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION, type TabSessionType, type TabType } from '../../src/shared/contracts/session';
import {
  activateTab,
  closeTab,
  nextTab,
  noteTabId,
  openTab,
  prevTab,
  removeNoteTabs,
  sanitizeSession,
} from '../../src/shared/tabs/tab-session';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const noteTab = (n: number): TabType => ({ id: noteTabId(uid(n)), kind: 'note', noteId: uid(n) });
const session = (tabs: TabType[], active: string): TabSessionType => ({ version: 1, tabs: [{ id: 'home', kind: 'home' }, ...tabs], activeTabId: active });
const ids = (s: TabSessionType) => s.tabs.map((t) => t.id);

describe('openTab', () => {
  it('appends and activates new tabs, and activates existing ones without duplicating', () => {
    let s = DEFAULT_SESSION;
    const a = openTab(s, noteTab(1));
    if ('error' in a) throw new Error('unexpected');
    expect(a.existed).toBe(false);
    s = a.session;
    const b = openTab(s, noteTab(2));
    if ('error' in b) throw new Error('unexpected');
    s = b.session;
    expect(ids(s)).toEqual(['home', noteTabId(uid(1)), noteTabId(uid(2))]);
    expect(s.activeTabId).toBe(noteTabId(uid(2)));
    const again = openTab(s, noteTab(1));
    if ('error' in again) throw new Error('unexpected');
    expect(again.existed).toBe(true);
    expect(ids(again.session)).toEqual(ids(s));
    expect(again.session.activeTabId).toBe(noteTabId(uid(1)));
  });

  it('refuses a 201st tab', () => {
    const tabs = Array.from({ length: 199 }, (_, i) => noteTab(i + 1));
    const full = session(tabs, 'home');
    expect(full.tabs).toHaveLength(200);
    expect(openTab(full, noteTab(500))).toEqual({ error: 'LIMIT' });
    const existing = openTab(full, noteTab(5));
    expect('error' in existing).toBe(false);
  });
});

describe('closeTab, activate and cycling', () => {
  const s = session([noteTab(1), noteTab(2), noteTab(3)], noteTabId(uid(2)));

  it('never closes Home', () => {
    expect(closeTab(s, 'home')).toBe(s);
  });

  it('closing the active tab activates the right neighbour, else the left', () => {
    expect(closeTab(s, noteTabId(uid(2))).activeTabId).toBe(noteTabId(uid(3)));
    const last = session([noteTab(1), noteTab(2)], noteTabId(uid(2)));
    expect(closeTab(last, noteTabId(uid(2))).activeTabId).toBe(noteTabId(uid(1)));
    const onlyOne = session([noteTab(1)], noteTabId(uid(1)));
    expect(closeTab(onlyOne, noteTabId(uid(1))).activeTabId).toBe('home');
  });

  it('closing an inactive tab keeps the active one', () => {
    const closed = closeTab(s, noteTabId(uid(3)));
    expect(closed.activeTabId).toBe(noteTabId(uid(2)));
    expect(ids(closed)).toEqual(['home', noteTabId(uid(1)), noteTabId(uid(2))]);
  });

  it('activateTab ignores unknown ids; next and prev wrap around', () => {
    expect(activateTab(s, 'nope')).toBe(s);
    expect(activateTab(s, 'home').activeTabId).toBe('home');
    const atEnd = session([noteTab(1)], noteTabId(uid(1)));
    expect(nextTab(atEnd).activeTabId).toBe('home');
    expect(prevTab(DEFAULT_SESSION).activeTabId).toBe('home');
    expect(prevTab(session([noteTab(1)], 'home')).activeTabId).toBe(noteTabId(uid(1)));
  });
});

describe('removeNoteTabs', () => {
  it('removes the listed notes and falls back like closeTab', () => {
    const s = session([noteTab(1), noteTab(2), noteTab(3)], noteTabId(uid(2)));
    const r = removeNoteTabs(s, [uid(2), uid(3)]);
    expect(r.removed).toBe(2);
    expect(ids(r.session)).toEqual(['home', noteTabId(uid(1))]);
    expect(r.session.activeTabId).toBe(noteTabId(uid(1)));
    expect(removeNoteTabs(s, [uid(9)])).toEqual({ session: s, removed: 0 });
    const keepActive = removeNoteTabs(s, [uid(1)]);
    expect(keepActive.session.activeTabId).toBe(noteTabId(uid(2)));
  });
});

describe('sanitizeSession', () => {
  const live = () => 'live' as const;

  it('returns the default for an invalid value', () => {
    for (const raw of [null, 'x', 42, { version: 2 }, { version: 1, tabs: [], activeTabId: 'home' }, { version: 1, tabs: [{ id: 'home', kind: 'home' }] }]) {
      const r = sanitizeSession(raw, live);
      expect(r.invalid).toBe(true);
      expect(r.session).toEqual(DEFAULT_SESSION);
    }
  });

  it('forces exactly one Home at index 0', () => {
    const raw = { version: 1, tabs: [noteTab(1), { id: 'home', kind: 'home' }, { id: 'home', kind: 'home' }, { id: 'page:settings', kind: 'settings' }], activeTabId: 'page:settings' };
    const r = sanitizeSession(raw, live);
    expect(ids(r.session)).toEqual(['home', noteTabId(uid(1)), 'page:settings']);
    expect(r.dropped.duplicates).toBe(1);
    expect(r.session.activeTabId).toBe('page:settings');
    const noHome = sanitizeSession({ version: 1, tabs: [noteTab(1)], activeTabId: noteTabId(uid(1)) }, live);
    expect(ids(noHome.session)).toEqual(['home', noteTabId(uid(1))]);
    expect(noHome.dropped).toEqual({ trashed: 0, missing: 0, duplicates: 0 });
  });

  it('collapses duplicate ids and counts them', () => {
    const raw = { version: 1, tabs: [{ id: 'home', kind: 'home' }, noteTab(1), noteTab(1), noteTab(1)], activeTabId: 'home' };
    const r = sanitizeSession(raw, live);
    expect(ids(r.session)).toEqual(['home', noteTabId(uid(1))]);
    expect(r.dropped.duplicates).toBe(2);
  });

  it('drops trashed and missing notes with separate counts and picks the nearest earlier tab as active', () => {
    const state = (id: string) => (id === uid(2) ? 'trashed' : id === uid(3) ? 'missing' : 'live');
    const raw = {
      version: 1,
      tabs: [{ id: 'home', kind: 'home' }, noteTab(1), noteTab(2), noteTab(3), noteTab(4)],
      activeTabId: noteTabId(uid(3)),
    };
    const r = sanitizeSession(raw, state);
    expect(ids(r.session)).toEqual(['home', noteTabId(uid(1)), noteTabId(uid(4))]);
    expect(r.dropped).toEqual({ trashed: 1, missing: 1, duplicates: 0 });
    expect(r.session.activeTabId).toBe(noteTabId(uid(1)));
    const firstGone = sanitizeSession({ ...raw, activeTabId: noteTabId(uid(2)), tabs: [{ id: 'home', kind: 'home' }, noteTab(2), noteTab(4)] }, state);
    expect(firstGone.session.activeTabId).toBe('home');
  });

  it('truncates to 200 tabs', () => {
    const tabs: TabType[] = [{ id: 'home', kind: 'home' }, ...Array.from({ length: 199 }, (_, i) => noteTab(i + 1))];
    const r = sanitizeSession({ version: 1, tabs, activeTabId: 'home' }, live);
    expect(r.session.tabs).toHaveLength(200);
  });
});

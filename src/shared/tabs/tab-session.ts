import { DEFAULT_SESSION, MAX_TABS, TabSession, type TabSessionType, type TabType } from '../contracts/session';

export type NoteState = 'live' | 'trashed' | 'missing';

export const HOME_TAB: TabType = { id: 'home', kind: 'home' };

export function noteTabId(noteId: string): string {
  return `note:${noteId}`;
}

export type OpenTabResult = { session: TabSessionType; existed: boolean } | { error: 'LIMIT' };

export function openTab(s: TabSessionType, tab: TabType): OpenTabResult {
  if (s.tabs.some((t) => t.id === tab.id)) {
    return { session: s.activeTabId === tab.id ? s : { ...s, activeTabId: tab.id }, existed: true };
  }
  if (s.tabs.length >= MAX_TABS) return { error: 'LIMIT' };
  return { session: { ...s, tabs: [...s.tabs, tab], activeTabId: tab.id }, existed: false };
}

/** Fallback active tab after the tab at `index` (in the original list) disappears. */
function fallbackActive(original: readonly TabType[], index: number, survivors: readonly TabType[]): string {
  const alive = new Set(survivors.map((t) => t.id));
  for (let i = index + 1; i < original.length; i += 1) if (alive.has(original[i]!.id)) return original[i]!.id;
  for (let i = index - 1; i >= 0; i -= 1) if (alive.has(original[i]!.id)) return original[i]!.id;
  return 'home';
}

export function closeTab(s: TabSessionType, id: string): TabSessionType {
  if (id === 'home') return s;
  const index = s.tabs.findIndex((t) => t.id === id);
  if (index < 0) return s;
  const tabs = s.tabs.filter((t) => t.id !== id);
  const activeTabId = s.activeTabId === id ? fallbackActive(s.tabs, index, tabs) : s.activeTabId;
  return { ...s, tabs, activeTabId };
}

export function activateTab(s: TabSessionType, id: string): TabSessionType {
  if (s.activeTabId === id || !s.tabs.some((t) => t.id === id)) return s;
  return { ...s, activeTabId: id };
}

function step(s: TabSessionType, delta: 1 | -1): TabSessionType {
  const n = s.tabs.length;
  const i = s.tabs.findIndex((t) => t.id === s.activeTabId);
  if (n === 0 || i < 0) return s;
  return { ...s, activeTabId: s.tabs[(i + delta + n) % n]!.id };
}
export const nextTab = (s: TabSessionType) => step(s, 1);
export const prevTab = (s: TabSessionType) => step(s, -1);

export function removeNoteTabs(s: TabSessionType, noteIds: readonly string[]): { session: TabSessionType; removed: number } {
  const ids = new Set(noteIds.map(noteTabId));
  const tabs = s.tabs.filter((t) => !ids.has(t.id));
  const removed = s.tabs.length - tabs.length;
  if (removed === 0) return { session: s, removed: 0 };
  let activeTabId = s.activeTabId;
  if (ids.has(activeTabId)) {
    const index = s.tabs.findIndex((t) => t.id === activeTabId);
    activeTabId = fallbackActive(s.tabs, index, tabs);
  }
  return { session: { ...s, tabs, activeTabId }, removed };
}

export function setTabScroll(s: TabSessionType, tabId: string, scrollTop: number): TabSessionType {
  const value = Math.max(0, Math.min(10_000_000, Math.round(scrollTop)));
  let changed = false;
  const tabs = s.tabs.map((t) => {
    if (t.id === tabId && t.kind === 'note' && t.scrollTop !== value) {
      changed = true;
      return { ...t, scrollTop: value };
    }
    return t;
  });
  return changed ? { ...s, tabs } : s;
}

export interface SanitizeResult {
  session: TabSessionType;
  invalid: boolean;
  dropped: { trashed: number; missing: number; duplicates: number };
}

export function sanitizeSession(raw: unknown, noteState: (noteId: string) => NoteState): SanitizeResult {
  const dropped = { trashed: 0, missing: 0, duplicates: 0 };
  const parsed = TabSession.safeParse(raw);
  if (!parsed.success) return { session: DEFAULT_SESSION, invalid: true, dropped };
  const original = parsed.data.tabs;
  const seen = new Set<string>(['home']);
  const kept: TabType[] = [HOME_TAB];
  let homeSeen = false;
  for (const tab of original) {
    if (tab.kind === 'home') {
      if (homeSeen) dropped.duplicates += 1;
      homeSeen = true;
      continue;
    }
    if (seen.has(tab.id)) {
      dropped.duplicates += 1;
      continue;
    }
    if (tab.kind === 'note') {
      const state = noteState(tab.noteId);
      if (state === 'trashed') {
        dropped.trashed += 1;
        continue;
      }
      if (state === 'missing') {
        dropped.missing += 1;
        continue;
      }
    }
    seen.add(tab.id);
    kept.push(tab);
  }
  const tabs = kept.slice(0, MAX_TABS);
  const alive = new Set(tabs.map((t) => t.id));
  let activeTabId = parsed.data.activeTabId;
  if (!alive.has(activeTabId)) {
    const originalIndex = original.findIndex((t) => t.id === activeTabId);
    activeTabId = 'home';
    if (originalIndex > 0) {
      for (let i = originalIndex - 1; i >= 0; i -= 1) {
        if (alive.has(original[i]!.id)) {
          activeTabId = original[i]!.id;
          break;
        }
      }
    }
  }
  return { session: { version: 1, tabs, activeTabId }, invalid: false, dropped };
}

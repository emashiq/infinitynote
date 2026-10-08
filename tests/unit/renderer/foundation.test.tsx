// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppInfoType } from '../../../src/shared/contracts/app';
import type { InfinityBridge } from '../../../src/shared/contracts/bridge';
import { App } from '../../../src/renderer/App';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

const info = (over: Partial<AppInfoType> = {}): AppInfoType => ({
  name: 'Infinity Notes',
  version: '0.1.0',
  isPackaged: false,
  unsignedBuild: true,
  platform: 'win32',
  arch: 'x64',
  versions: { electron: '44.7.0', chrome: '152', node: '24' },
  sqlite: { driver: 'better-sqlite3', version: '3.53.4', fts5: true, json: true },
  schemaVersion: 1,
  startup: { status: 'ok' },
  ...over,
});

function makeBridge(opts: { stored?: string; setResult?: 'ok' | 'error'; info?: AppInfoType } = {}) {
  const unsubscribe = vi.fn();
  let listener: ((p: unknown) => void) | null = null;
  const set = vi.fn(async (req: { key: 'appearance.theme'; value: string }) =>
    opts.setResult === 'error'
      ? { ok: false as const, error: { code: 'INTERNAL' as const, message: 'Storage is unavailable' } }
      : { ok: true as const, data: { key: req.key, value: req.value, updatedAt: 1 } },
  );
  const bridge = {
    app: { getInfo: async () => ({ ok: true, data: opts.info ?? info() }) },
    settings: { get: async () => ({ ok: true, data: { values: { 'appearance.theme': opts.stored ?? 'system' } } }), set },
    subscribe: (_c: string, cb: (p: unknown) => void) => {
      listener = cb;
      return unsubscribe;
    },
  } as unknown as InfinityBridge;
  return { bridge, set, unsubscribe, emit: (p: unknown) => listener?.(p) };
}

async function mount(bridge: InfinityBridge): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<App bridge={bridge} />));
  return host;
}

const radios = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLInputElement>('input[type="radio"]'));

describe('FoundationScreen', () => {
  it('shows version, storage line and the stored theme', async () => {
    const m = makeBridge({ stored: 'dark' });
    const el = await mount(m.bridge);
    expect(el.querySelector('h1')?.textContent).toBe('Infinity Notes');
    expect(el.textContent).toContain('Version 0.1.0');
    expect(el.textContent).toContain('Storage ready (SQLite 3.53.4)');
    expect(radios(el).map((r) => [r.value, r.checked])).toEqual([['system', false], ['light', false], ['dark', true]]);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('changing the radio calls settings:set and applies the theme', async () => {
    const m = makeBridge();
    const el = await mount(m.bridge);
    await act(async () => radios(el)[2]!.click());
    expect(m.set).toHaveBeenCalledWith({ key: 'appearance.theme', value: 'dark' });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('reverts and shows the message when settings:set fails', async () => {
    const m = makeBridge({ setResult: 'error' });
    const el = await mount(m.bridge);
    await act(async () => radios(el)[1]!.click());
    expect(radios(el)[0]!.checked).toBe(true);
    expect(el.querySelector('[role="status"]')?.textContent).toBe('Storage is unavailable');
  });

  it('follows settings:changed and unsubscribes on unmount', async () => {
    const m = makeBridge();
    const el = await mount(m.bridge);
    await act(async () => m.emit({ key: 'appearance.theme', value: 'light', updatedAt: 2 }));
    expect(radios(el)[1]!.checked).toBe(true);
    act(() => root!.unmount());
    expect(m.unsubscribe).toHaveBeenCalled();
    root = null;
  });

  it('renders the startup error screen when the database failed', async () => {
    const m = makeBridge({ info: info({ sqlite: null, schemaVersion: null, startup: { status: 'error', code: 'SCHEMA_TOO_NEW' } }) });
    const el = await mount(m.bridge);
    expect(el.querySelector('[role="alert"] h1')?.textContent).toContain('newer version');
  });
});

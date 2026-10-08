// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { InfinityBridge } from '../../../src/shared/contracts/bridge';
import { StartupErrorScreen, STARTUP_ERROR_COPY } from '../../../src/renderer/startup/StartupErrorScreen';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mockBridge(show: InfinityBridge['app']['showDataFolder'] = async () => ({ ok: true, data: { opened: true } })) {
  const quit = vi.fn(async () => ({ ok: true as const, data: {} as Record<string, never> }));
  const showDataFolder = vi.fn(show);
  const bridge = { app: { showDataFolder, quit } } as unknown as InfinityBridge;
  return { bridge, quit, showDataFolder };
}

function mount(bridge: InfinityBridge, code: keyof typeof STARTUP_ERROR_COPY): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<StartupErrorScreen bridge={bridge} code={code} />));
  return host;
}

const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll('button'));
const button = (el: HTMLElement, name: string) => buttons(el).find((b) => b.textContent === name)!;

describe('StartupErrorScreen', () => {
  const cases = [
    ['MIGRATION_FAILED', 'Database upgrade failed; your data was not changed'],
    ['SCHEMA_TOO_NEW', 'This notebook was created by a newer version of Infinity Notes. Your data was not changed.'],
    ['DB_OPEN_FAILED', 'Infinity Notes could not open its database. Your data was not changed.'],
  ] as const;

  for (const [code, heading] of cases) {
    it(`${code}: exact copy, alert role, two buttons, focus on Show data folder`, () => {
      const { bridge } = mockBridge();
      const el = mount(bridge, code);
      expect(STARTUP_ERROR_COPY[code]).toBe(heading);
      const alert = el.querySelector('[role="alert"]');
      expect(alert?.querySelector('h1')?.textContent).toBe(heading);
      expect(buttons(el).map((b) => b.textContent)).toEqual(['Show data folder', 'Quit']);
      expect(document.activeElement).toBe(button(el, 'Show data folder'));
    });
  }

  it('buttons call the bridge', async () => {
    const { bridge, quit, showDataFolder } = mockBridge();
    const el = mount(bridge, 'MIGRATION_FAILED');
    await act(async () => button(el, 'Show data folder').click());
    expect(showDataFolder).toHaveBeenCalledTimes(1);
    await act(async () => button(el, 'Quit').click());
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('shows the message inline when Show data folder fails', async () => {
    const { bridge } = mockBridge(async () => ({
      ok: false,
      error: { code: 'UNSUPPORTED', message: 'The data folder could not be opened on this desktop' },
    }));
    const el = mount(bridge, 'DB_OPEN_FAILED');
    await act(async () => button(el, 'Show data folder').click());
    expect(el.querySelector('[role="status"]')?.textContent).toBe('The data folder could not be opened on this desktop');
  });
});

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WidgetHeader } from '../../../src/renderer/widget/WidgetHeader';
import { createWidgetServices } from '../../../src/renderer/widget/widget-services';
import { createFakeBridge } from './support/fake-bridge';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  document.body.innerHTML = '';
});

async function render(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

describe('widget header (INF-WIDG-02, D-081)', () => {
  it('names its controls; collapse says what it will do; pin is unavailable where unsupported', async () => {
    const actions = { togglePinned: vi.fn(), toggleCollapsed: vi.fn(), hide: vi.fn() };
    const { host, root } = await render(<WidgetHeader state={{ open: true, collapsed: false, alwaysOnTop: true }} pinSupported actions={actions} />);
    const toolbar = host.querySelector('[role="toolbar"]')!;
    expect(toolbar.getAttribute('aria-label')).toBe('Reminder widget');
    expect(host.querySelector('h1')!.textContent).toBe('Reminders');
    const pin = host.querySelector('[aria-label="Keep on top"]') as HTMLButtonElement;
    expect(pin.getAttribute('aria-pressed')).toBe('true');
    const collapse = host.querySelector('[aria-label="Collapse widget"]') as HTMLButtonElement;
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    await act(async () => {
      pin.click();
      collapse.click();
      (host.querySelector('[aria-label="Hide widget"]') as HTMLButtonElement).click();
    });
    expect([actions.togglePinned, actions.toggleCollapsed, actions.hide].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
    await act(async () => root.render(<WidgetHeader state={{ open: true, collapsed: true, alwaysOnTop: false }} pinSupported={false} actions={actions} />));
    const disabledPin = host.querySelector('[aria-label="Keep on top"]') as HTMLButtonElement;
    expect(disabledPin.getAttribute('aria-disabled')).toBe('true');
    expect(disabledPin.title).toBe('Not supported by this desktop');
    await act(async () => disabledPin.click());
    expect(actions.togglePinned).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[aria-label="Expand widget"]')!.getAttribute('aria-expanded')).toBe('false');
    act(() => root.unmount());
  });

  it('widget services: Overdue first when something is overdue, else Today; flush requests are answered at once', async () => {
    const fake = createFakeBridge();
    fake.data.setCapabilities({ alwaysOnTop: { status: 'unsupported', reason: 'wayland-or-wslg' } } as never);
    const services = createWidgetServices(fake.bridge, { open: true, collapsed: false, alwaysOnTop: false }, { themeEnv: null });
    await services.ready;
    expect(services.store.getState()).toMatchObject({ view: 'today', pinSupported: false });
    fake.emit('app:flush-request', { flushId: '55555555-5555-4555-8555-000000000001', reason: 'quit' });
    await Promise.resolve();
    expect(fake.callsTo('app:flushed')[0]!.req).toEqual({ flushId: '55555555-5555-4555-8555-000000000001', saved: true });
    await services.togglePinned();
    expect(fake.callsTo('widget:setPinned')).toHaveLength(0);
    await services.toggleCollapsed();
    expect(services.store.getState().window.collapsed).toBe(true);
    services.dispose();
  });
});

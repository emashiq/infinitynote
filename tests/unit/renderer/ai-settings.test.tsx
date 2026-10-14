// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AI_SETTING_LABEL, AiSettings } from '../../../src/renderer/settings/AiSettings';
import { createAppServices } from '../../../src/renderer/state/app-services';
import { AppServicesContext } from '../../../src/renderer/state/use-store';
import { createFakeBridge } from './support/fake-bridge';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  document.body.innerHTML = '';
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));
const button = (root: ParentNode, label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;

async function render() {
  const fake = createFakeBridge();
  const services = createAppServices(fake.bridge, { themeEnv: null, lifecycle: null });
  await services.ready;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <AppServicesContext.Provider value={services}>
        <AiSettings />
      </AppServicesContext.Provider>,
    ),
  );
  await settle();
  return { fake, services, host, unmount: () => act(async () => root.unmount()) };
}

describe('Settings > AI (D-190)', () => {
  it('starts off; the switch, the engine and its program, model and Test', async () => {
    const { fake, host, services, unmount } = await render();
    const toggle = host.querySelector<HTMLButtonElement>('button[role="switch"]')!;
    expect(host.textContent).toContain(AI_SETTING_LABEL);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await act(async () => toggle.click());
    expect(fake.callsTo('settings:set').at(-1)!.req).toEqual({ key: 'ai.enabled', value: true });
    expect(services.features.getState().aiActions).toBe(true);

    expect(host.textContent).toContain('Claude Code program');
    expect(host.textContent).toContain('Found on PATH (claude)');
    await act(async () => button(host, 'Test Claude Code (headless)').click());
    await settle();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('claude-code 1.0.0');

    fake.data.documentPicks.push([{ name: 'C:\\tools\\claude.cmd', sizeBytes: 1 }]);
    await act(async () => button(host, 'Choose…').click());
    await settle();
    expect(host.textContent).toContain('C:\\tools\\claude.cmd');
    await act(async () => button(host, 'Use PATH').click());
    await settle();
    expect(host.textContent).toContain('Found on PATH (claude)');
    await unmount();
  });

  it('an API engine takes a key that never comes back, with its model and effort', async () => {
    const { fake, host, unmount } = await render();
    const engine = host.querySelector<HTMLSelectElement>('select')!;
    await act(async () => {
      engine.value = 'anthropic-api';
      engine.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    const key = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(key).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(key, 'sk-ant-0123456789');
      key.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button(host, 'Save key').click());
    await settle();
    expect(fake.callsTo('ai:setKey')[0]!.req).toEqual({ provider: 'anthropic', key: 'sk-ant-0123456789' });
    expect(host.textContent).toContain('Anthropic API key (stored)');
    expect(key.value).toBe('');
    expect([...host.querySelectorAll('select')].map((s) => s.value)).toEqual(['anthropic-api', 'claude-opus-5-5', 'medium']);
    expect(button(host, 'Remove key')).toBeTruthy();
    await unmount();
  });
});

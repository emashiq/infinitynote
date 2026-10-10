import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, expect } from 'vitest';
import { App } from '../../../../src/renderer/App';
import { createFakeBridge, type FakeBridge } from './fake-bridge';

/** jsdom harness for component tests over the fake bridge. Call once at the top of a test file. */
export function setupDom(width = 1400) {
  let root: Root | null = null;
  let host: HTMLElement | null = null;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.matchMedia = ((query: string) =>
      ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    document.body.innerHTML = '';
  });

  const settle = async (rounds = 6): Promise<void> => {
    for (let i = 0; i < rounds; i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  };

  /**
   * Settles until `find` returns an element, for content behind a lazily imported chunk whose first import can take
   * longer than a few rounds on a loaded machine. Fails after `timeoutMs`.
   */
  const until = async <T,>(find: () => T | null | undefined, timeoutMs = 5_000): Promise<T> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = find();
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`not found within ${timeoutMs} ms`);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
  };

  return {
    settle,
    until,
    async mount(fake: FakeBridge = createFakeBridge()): Promise<{ el: HTMLElement; fake: FakeBridge }> {
      host = document.createElement('div');
      document.body.appendChild(host);
      root = createRoot(host);
      await act(async () => root!.render(<App bridge={fake.bridge} />));
      await settle();
      return { el: host, fake };
    },
    async click(target: Element | null): Promise<void> {
      expect(target).not.toBeNull();
      await act(async () => {
        (target as HTMLElement).click();
      });
      await settle();
    },
    async key(target: Element, k: string, init: KeyboardEventInit = {}): Promise<void> {
      await act(async () => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
      });
      await settle(3);
    },
    async type(input: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
      await act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
  };
}

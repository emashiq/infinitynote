import { describe, expect, it } from 'vitest';
import { decideRequest, installNetworkGuard } from '../../src/main/services/network-guard';
import { memoryLogger } from '../../src/main/services/logger';

describe('network guard (INF-FND-01)', () => {
  it('cancels network schemes', () => {
    for (const url of ['http://example.com/', 'https://example.com/a', 'ws://example.com/', 'wss://example.com/', 'http://localhost:5173/']) {
      expect(decideRequest(url), url).toBe('cancel');
    }
  });

  it('allows app-internal schemes', () => {
    for (const url of [
      'infinity-app://renderer/index.html',
      'infinity-attachment://11111111-1111-4111-8111-111111111111',
      'blob:infinity-app://renderer/abc',
      'data:text/plain,hi',
      'devtools://devtools/bundled/inspector.html',
    ]) {
      expect(decideRequest(url, null), url).toBe('allow');
    }
  });

  it('allows the dev server and HMR websocket only when a dev origin is given', () => {
    const dev = 'http://localhost:5173';
    expect(decideRequest('http://localhost:5173/src/main.tsx', dev)).toBe('allow');
    expect(decideRequest('ws://localhost:5173/?token=x', dev)).toBe('allow');
    expect(decideRequest('http://localhost:5173/', null)).toBe('cancel');
  });

  it('rejects near-match hosts and other ports', () => {
    const dev = 'http://localhost:5173';
    expect(decideRequest('http://localhost.evil:5173/', dev)).toBe('cancel');
    expect(decideRequest('http://localhost:5174/', dev)).toBe('cancel');
    expect(decideRequest('https://example.com/', dev)).toBe('cancel');
  });

  it('cancels unparsable URLs', () => {
    expect(decideRequest('not a url')).toBe('cancel');
  });

  it('install() cancels, logs the origin without the path and reports the url', () => {
    let listener: ((d: { url: string }, cb: (r: { cancel: boolean }) => void) => void) | null = null;
    const logger = memoryLogger();
    const blocked: string[] = [];
    installNetworkGuard(
      { webRequest: { onBeforeRequest: (_f, l) => (listener = l) } },
      { logger, onBlocked: (u) => blocked.push(u) },
    );
    const results: boolean[] = [];
    listener!({ url: 'https://example.com/secret/path?q=1' }, (r) => results.push(r.cancel));
    listener!({ url: 'infinity-app://renderer/index.html' }, (r) => results.push(r.cancel));
    expect(results).toEqual([true, false]);
    expect(blocked).toEqual(['https://example.com/secret/path?q=1']);
    expect(logger.lines).toEqual(['WARN network: blocked https://example.com']);
  });
});

import { describe, expect, it } from 'vitest';
import { NOTE_HTML_CSP } from '../../src/main/portability/note-html';
import { createPrintPages } from '../../src/main/windows/print-pages';

const get = (url: string) => ({ url, method: 'GET' });

describe('print pages served from memory (D-176)', () => {
  it('serves a registered page at its token with the page policy, and nothing once it is released', async () => {
    const pages = createPrintPages();
    const page = pages.add('<p>secret</p>');
    expect(page.url).toMatch(/^infinity-print:\/\/[0-9a-f-]{36}\/$/);
    const res = pages.respond(get(page.url));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<p>secret</p>');
    expect(Object.fromEntries(res.headers)).toEqual({
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': NOTE_HTML_CSP,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    });
    page.release();
    expect(pages.respond(get(page.url)).status).toBe(404);
  });

  it('gives every page its own random token, and releasing one keeps the other', async () => {
    const pages = createPrintPages();
    const a = pages.add('<p>a</p>');
    const b = pages.add('<p>b</p>');
    expect(a.url).not.toBe(b.url);
    a.release();
    expect(pages.respond(get(a.url)).status).toBe(404);
    expect(await pages.respond(get(b.url)).text()).toBe('<p>b</p>');
  });

  it('answers 404 for unknown tokens, other paths, queries, methods and schemes, and unreadable URLs', () => {
    let n = 0;
    const pages = createPrintPages(() => `token${(n += 1)}`);
    pages.add('<p>x</p>');
    expect(pages.respond(get('infinity-print://token1/')).status).toBe(200);
    for (const url of ['infinity-print://token2/', 'infinity-print://token1/other', 'infinity-print://token1/?a=1', 'infinity-html://token1/', 'not a url']) {
      expect(pages.respond(get(url)).status, url).toBe(404);
    }
    expect(pages.respond({ url: 'infinity-print://token1/', method: 'POST' }).status).toBe(404);
  });
});

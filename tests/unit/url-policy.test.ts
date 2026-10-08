import { describe, expect, it } from 'vitest';
import { MAX_URL_LENGTH, parseExternalUrl } from '../../src/shared/url-policy';

describe('parseExternalUrl (INF-SEC-01)', () => {
  it('accepts absolute http and https addresses', () => {
    expect(parseExternalUrl('https://example.com/docs')).toEqual({ ok: true, href: 'https://example.com/docs' });
    expect(parseExternalUrl('http://example.com')).toEqual({ ok: true, href: 'http://example.com/' });
    expect(parseExternalUrl('HTTPS://Example.COM/a?b=1#c')).toEqual({ ok: true, href: 'https://example.com/a?b=1#c' });
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'vbscript:msgbox(1)',
    'file:///C:/Windows/system32/calc.exe',
    'data:text/html,<script>alert(1)</script>',
    'mailto:someone@example.com',
    'ftp://example.com/file',
    '/relative/path',
    'example.com',
    '//example.com/x',
    'https://user:secret@example.com/',
    'https://user@example.com/',
    '',
  ])('rejects %s', (raw) => {
    expect(parseExternalUrl(raw)).toEqual({ ok: false });
  });

  it('rejects non-strings and addresses over 2048 characters', () => {
    expect(parseExternalUrl(undefined)).toEqual({ ok: false });
    expect(parseExternalUrl(42)).toEqual({ ok: false });
    const base = 'https://example.com/';
    expect(parseExternalUrl(base + 'a'.repeat(MAX_URL_LENGTH - base.length)).ok).toBe(true);
    expect(parseExternalUrl(base + 'a'.repeat(MAX_URL_LENGTH - base.length + 1))).toEqual({ ok: false });
  });
});

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEV_CSP, PROD_CSP } from '../../src/shared/csp';

describe('CSP (INF-FND-03)', () => {
  it('PROD_CSP is frozen byte for byte', () => {
    expect(PROD_CSP).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' infinity-attachment: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
    );
  });

  it('matches the directive list in ARCHITECTURE section 14', () => {
    const arch = fs.readFileSync('docs/ARCHITECTURE.md', 'utf8');
    for (const directive of PROD_CSP.split('; ')) {
      expect(arch, directive).toContain(directive.replace(/;$/, ''));
    }
  });

  it('never allows eval or remote sources', () => {
    expect(PROD_CSP).not.toContain('unsafe-eval');
    expect(DEV_CSP).not.toContain('unsafe-eval');
    expect(PROD_CSP).not.toMatch(/https?:|wss?:|localhost/);
  });

  it('DEV_CSP differs only by the localhost additions', () => {
    const stripped = DEV_CSP.replace(" 'unsafe-inline' http://localhost:*;", ';')
      .replace(' ws://localhost:* http://localhost:*', '');
    expect(stripped.replace("script-src 'self';", "script-src 'self';")).toBe(PROD_CSP);
  });
});

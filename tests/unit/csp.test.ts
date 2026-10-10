import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEV_CSP, HTML_DOCUMENT_CSP, PDF_WORKER_CSP, PROD_CSP } from '../../src/shared/csp';

describe('CSP (INF-FND-03)', () => {
  it('PROD_CSP is frozen byte for byte', () => {
    expect(PROD_CSP).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' infinity-attachment: blob: data:; font-src 'self'; connect-src 'self' infinity-document:; object-src 'none'; worker-src 'self'; frame-src infinity-html:; base-uri 'none'; form-action 'none'",
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

  it('the app may read document bytes and frame HTML documents by scheme, nothing remote (D-118)', () => {
    const directive = (name: string) => PROD_CSP.split('; ').find((d) => d.startsWith(`${name} `));
    expect(directive('connect-src')).toBe("connect-src 'self' infinity-document:");
    expect(directive('frame-src')).toBe('frame-src infinity-html:');
    expect(HTML_DOCUMENT_CSP).not.toMatch(/script-src|connect-src|frame-src|https?:|unsafe-eval/);
    expect(HTML_DOCUMENT_CSP.startsWith("default-src 'none';")).toBe(true);
    expect(HTML_DOCUMENT_CSP.endsWith('; sandbox')).toBe(true);
  });

  it('images come from the app, attachments, object URLs and data URLs (pictures inside Word documents, D-148), never the network', () => {
    const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `));
    expect(directive(PROD_CSP, 'img-src')).toBe("img-src 'self' infinity-attachment: blob: data:");
    expect(directive(DEV_CSP, 'img-src')).toBe(directive(PROD_CSP, 'img-src'));
  });

  it('workers come only from the app; WebAssembly compiles only in the pdf.js worker, never JavaScript eval (D-128)', () => {
    const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `));
    expect(directive(PROD_CSP, 'worker-src')).toBe("worker-src 'self'");
    expect(directive(DEV_CSP, 'worker-src')).toBe("worker-src 'self'");
    expect(PROD_CSP).not.toContain('wasm-unsafe-eval');
    expect(PDF_WORKER_CSP).toBe("default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'");
    expect(PDF_WORKER_CSP.replace("'wasm-unsafe-eval'", '')).not.toMatch(/unsafe|https?:|\*/);
  });

  it('DEV_CSP differs only by the localhost additions', () => {
    const stripped = DEV_CSP.replace(" 'unsafe-inline' http://localhost:*;", ';')
      .replace(' ws://localhost:* http://localhost:*', '');
    expect(stripped.replace("script-src 'self';", "script-src 'self';")).toBe(PROD_CSP);
  });
});

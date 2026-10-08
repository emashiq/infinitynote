import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const yml = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
const indexOfStep = (needle: string) => yml.indexOf(needle);

describe('CI definition (INF-FND-10)', () => {
  it('runs on Windows and Ubuntu', () => {
    expect(yml).toMatch(/os:\s*\[windows-2025,\s*ubuntu-24\.04\]/);
  });

  it('has the required steps in order', () => {
    const order = [
      'npm ci',
      'npm run setup:electron',
      'Linux prerequisites',
      'npm run check',
      'npm run build',
      'npm run verify:native\n',
      'npm run test:e2e\n',
      'npm run package:current',
      'npm run verify:native -- --packaged',
      'npm run test:e2e:packaged',
      'actions/upload-artifact',
    ];
    let last = -1;
    for (const step of order) {
      const at = indexOfStep(step);
      expect(at, step).toBeGreaterThan(last);
      last = at;
    }
  });

  it('keeps the Chromium sandbox enabled and installs xvfb', () => {
    expect(yml).not.toContain('--no-sandbox');
    expect(yml).toContain('chmod 4755 node_modules/electron/dist/chrome-sandbox');
    expect(yml).toContain('apt-get install -y xvfb');
  });

  it('is read-only, never publishes, and states the headless limitations', () => {
    expect(yml).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(yml).not.toMatch(/GH_TOKEN|NPM_TOKEN|--publish always|npm publish|gh release|softprops\/action-gh-release/i);
    expect(yml).toContain('headless CI validates application logic only');
  });

  it('uses the pinned Node version', () => {
    expect(yml).toContain("node-version: '24.21.0'");
    expect(yml).not.toContain('24.15.0');
  });
});

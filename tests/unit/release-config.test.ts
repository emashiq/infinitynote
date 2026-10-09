import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const release = fs.readFileSync('.github/workflows/release.yml', 'utf8');
const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
const pages = fs.readFileSync('.github/workflows/pages.yml', 'utf8');
const site = fs.readFileSync('website/index.html', 'utf8');
const PAGES = [['index.html', site], ['docs.html', fs.readFileSync('website/docs.html', 'utf8')]] as const;
const SITE_BASE = 'https://emashiq.github.io/infinitynote/';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string; dependencies: Record<string, string> };

// The website links to releases/latest/download/<name>; these names must stay the same in every release.
const STABLE_ASSETS = ['Infinity-Notes-Setup-x64.exe', 'infinity-notes_amd64.deb', 'Infinity-Notes-x86_64.AppImage'];
const DOWNLOAD_BASE = 'https://github.com/emashiq/infinitynote/releases/latest/download/';

const releaseNotes = (args: string[]) => spawnSync(process.execPath, ['tools/release-notes.mjs', ...args], { encoding: 'utf8' });

describe('release workflow', () => {
  it('runs for v* tags and for an existing tag chosen by hand', () => {
    expect(release).toMatch(/push:\s*\n\s*tags: \['v\*'\]/);
    expect(release).toMatch(/workflow_dispatch:\s*\n\s*inputs:\s*\n\s*tag:/);
    expect(release).toContain('ref: refs/tags/${{ env.TAG }}');
  });

  it('checks the tag against the version before building', () => {
    const prepare = release.indexOf('node tools/release-notes.mjs "$TAG"');
    expect(prepare).toBeGreaterThan(0);
    expect(prepare).toBeLessThan(release.indexOf('npm ci'));
    expect(release).toContain('needs: prepare');
  });

  it('builds the installers on Windows and Ubuntu: clean install, Electron download, packaging, artifacts, in order', () => {
    expect(release).toMatch(/os:\s*\[windows-2025,\s*ubuntu-24\.04\]/);
    const order = ['npm ci', 'npm run setup:electron', 'npm run package:current', 'actions/upload-artifact'];
    let last = release.indexOf('build:');
    for (const step of order) {
      const at = release.indexOf(step, last);
      expect(at, step).toBeGreaterThan(last);
      last = at;
    }
    for (const pattern of ['release/*.exe', 'release/*.AppImage', 'release/*.deb']) expect(release).toContain(pattern);
    expect(release).toContain('if-no-files-found: error');
  });

  it('leaves the gates and the end-to-end tests to ci.yml, which runs them on both systems', () => {
    // Commit 62e8a67: release.yml only builds and publishes; ci.yml runs on every push to main before a tag.
    for (const step of ['npm run check', 'npm run test:e2e', 'npm run verify:native']) {
      expect(release, step).not.toContain(step);
      expect(ci, step).toContain(step);
    }
    expect(ci).toMatch(/os:\s*\[windows-2025,\s*ubuntu-24\.04\]/);
  });

  it('pins Node like ci.yml and never turns the Chromium sandbox off', () => {
    const pins = (yml: string) => [...yml.matchAll(/node-version: '([^']+)'/g)].map((m) => m[1]);
    expect(new Set(pins(release))).toEqual(new Set(pins(ci)));
    expect(pins(release).length).toBeGreaterThanOrEqual(2);
    expect(release).not.toContain('--no-sandbox');
  });

  it('only the publish job may write, and it publishes stable names, checksums and notices with gh', () => {
    expect(release).toMatch(/^permissions:\s*\n\s*contents: read/m);
    expect(release.match(/contents: write/g)).toHaveLength(1);
    expect(release.indexOf('contents: write')).toBeGreaterThan(release.indexOf('publish:'));
    // The publish job starts the Pages deploy itself, since its GITHUB_TOKEN release triggers no workflow.
    expect(release.indexOf('actions: write')).toBeGreaterThan(release.indexOf('publish:'));
    expect(release).toContain('gh workflow run pages.yml --ref main');
    for (const name of STABLE_ASSETS) expect(release).toContain(` ${name}\n`);
    expect(release).toContain('sha256sum -- * > ../SHA256SUMS.txt');
    expect(release).toContain('cp text/THIRD_PARTY_NOTICES.md assets/');
    expect(release).toContain('gh release create "$TAG" assets/* --verify-tag --title "$title" --notes-file text/release-notes.md --latest');
    expect(release).toContain('gh release upload "$TAG" assets/* --clobber');
    expect(release).toContain('title="Infinity Notes $TAG"');
    expect(release).not.toMatch(/--prerelease(?!=false)|--draft/);
  });
});

describe('release notes (tools/release-notes.mjs)', () => {
  it('prints the CHANGELOG section for the package version and the unsigned-build notice', () => {
    const r = releaseNotes([`v${pkg.version}`]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('### Downloads');
    expect(r.stdout).toContain('### Known limitations');
    expect(r.stdout).not.toContain(`## [${pkg.version}]`);
    expect(r.stdout).toContain('**Unsigned builds.**');
    expect(r.stdout).toContain('SHA256SUMS.txt');
  });

  it('fails when the tag does not name the package version or is malformed', () => {
    const wrong = releaseNotes(['v99.0.0']);
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain(`does not match package.json version ${pkg.version}`);
    const bare = releaseNotes([pkg.version]);
    expect(bare.status).toBe(1);
    expect(bare.stderr).toContain('is not of the form v<major>.<minor>.<patch>');
    expect(releaseNotes([]).status).toBe(1);
  });

  it('fails when APP_VERSION disagrees or the CHANGELOG has no section for the version', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'inf-notes-'));
    try {
      fs.mkdirSync(path.join(repo, 'src/shared'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ version: '1.2.3' }));
      fs.writeFileSync(path.join(repo, 'src/shared/app-identity.ts'), "export const APP_VERSION = '1.2.2';\n");
      fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '# Changelog\n\n## [1.2.2] - 2026-01-01\n\nOld.\n');
      const stale = releaseNotes(['v1.2.3', '--repo', repo]);
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain('does not match APP_VERSION 1.2.2');

      fs.writeFileSync(path.join(repo, 'src/shared/app-identity.ts'), "export const APP_VERSION = '1.2.3';\n");
      const missing = releaseNotes(['v1.2.3', '--repo', repo]);
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain('CHANGELOG.md has no "## [1.2.3]" section');

      fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '# Changelog\r\n\r\n## [1.2.3] - 2026-02-01\r\n\r\nNew.\r\n\r\n## [1.2.2] - 2026-01-01\r\n\r\nOld.\r\n');
      const ok = releaseNotes(['v1.2.3', '--repo', repo]);
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.stdout.startsWith('New.\n\n---\n')).toBe(true);
      expect(ok.stdout).not.toContain('Old.');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('third-party notices', () => {
  it('THIRD_PARTY_NOTICES.md is current and lists every runtime dependency', () => {
    const r = spawnSync(process.execPath, ['tools/third-party-notices.mjs', '--check'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const notices = fs.readFileSync('THIRD_PARTY_NOTICES.md', 'utf8');
    for (const [name, version] of Object.entries(pkg.dependencies)) expect(notices).toContain(`| ${name} | ${version} |`);
    for (const bundled of ['react', 'prosemirror-model', 'dompurify', 'chrono-node', 'lucide-react', 'electron']) {
      expect(notices).toContain(`| ${bundled} |`);
    }
    expect(notices).not.toContain('| @types/');
  });
});

describe('GitHub Pages workflow and website', () => {
  it('deploys website/ with the Pages actions and only the Pages permissions it needs', () => {
    expect(pages).toMatch(/branches: \[main\]\s*\n\s*paths:\s*\n\s*- 'website\/\*\*'/);
    expect(pages).toContain('workflow_dispatch:');
    expect(pages).toMatch(/pages: write\s*\n\s*id-token: write/);
    for (const action of ['actions/configure-pages@', 'actions/upload-pages-artifact@', 'actions/deploy-pages@']) expect(pages).toContain(action);
    expect(pages).toMatch(/path: website\n/);
  });

  it('writes releases.json on every deploy and deploys again when a release is published, edited or deleted', () => {
    expect(pages).toMatch(/release:\s*\n\s*types: \[published, edited, deleted\]/);
    const resolve = pages.indexOf('node .github/scripts/pages-releases.mjs website');
    expect(resolve).toBeGreaterThan(0);
    expect(resolve).toBeLessThan(pages.indexOf('actions/upload-pages-artifact@'));
    expect(fs.readFileSync('.github/scripts/pages-releases.mjs', 'utf8')).toContain("'releases.json'");
    expect(fs.readFileSync('website/app.js', 'utf8')).toContain("fetch('releases.json'");
  });

  it('download links are plain links to the stable latest-release assets, so they work without JavaScript', () => {
    // The <a> tag that holds href="<url>"; app.js finds it by its data-asset name to point it at a newer release.
    const anchorWith = (url: string): string => {
      const at = site.indexOf(`href="${url}"`);
      return at < 0 ? '' : site.slice(site.lastIndexOf('<a', at), at);
    };
    for (const name of [...STABLE_ASSETS, 'SHA256SUMS.txt']) expect(anchorWith(`${DOWNLOAD_BASE}${name}`), name).toMatch(/^<a\s[^>]*data-asset="[^"]+"/);
  });

  it('loads no third-party scripts, styles or fonts, and every local asset and page exists', () => {
    for (const [page, html] of PAGES) {
      expect([...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]), page).toEqual(['app.js']);
      expect(html, page).not.toMatch(/<link[^>]+href="https?:\/\/(?!emashiq\.github\.io\/infinitynote\/)/);
      const local = [...html.matchAll(/\s(?:src|srcset|href|content)="([^"]+)"/g)]
        .flatMap((m) => m[1]!.split(',').map((entry) => entry.trim().split(/\s+/)[0]!))
        .map((url) => (url.startsWith(SITE_BASE) ? url.slice(SITE_BASE.length) : url))
        .filter((url) => /^(\.\/|assets\/|[\w-]+\.(?:html|css|js)(?:#|$))/.test(url) || url === '')
        .map((url) => url.replace(/^\.\//, '').replace(/#.*$/, '') || 'index.html');
      expect(local.length, page).toBeGreaterThan(5);
      for (const file of local) expect(fs.existsSync(path.join('website', file)), `${page}: ${file}`).toBe(true);
    }
    for (const asset of ['website/style.css', 'website/app.js']) expect(fs.readFileSync(asset, 'utf8'), asset).not.toMatch(/@import|fonts\.googleapis|<script|createElement\(['"]script/);
  });
});
